import { Keypair } from "@stellar/stellar-sdk/base";
import { describe, expect, it } from "vitest";
import { ALTAS_PREMIO_POR_ORGANIZADOR_DIA, ALTAS_PREMIO_POR_SORTEO, AltasPorPremio, type PedidoDeAltaPorPremio } from "./altas-premio";
import { DIA_MS } from "./config";
import { Cupos } from "./cupos";
import { sqlDePrueba, sqlQueFallaEn } from "./sqlite-prueba";

const T0 = Date.UTC(2026, 10, 18, 12, 0, 0);
const CONTRATO = `C${"A".repeat(55)}`;
const LIMITES = { altasPremioDia: 100 };
const LIBRE = () => null;

/** El objeto de verdad de las altas, sin Cloudflare: el SQLite de prueba, los cupos y la tabla del alta de quien ganó. */
function montar(sql = sqlDePrueba()) {
  const cupos = new Cupos(sql);
  const altas = new AltasPorPremio(sql, cupos);
  const filas = (tabla: string) => sql.exec(`SELECT * FROM ${tabla}`).toArray();
  return { sql, cupos, altas, filas };
}

/**
 * Un pedido bien hecho: un sorteo de 3 ganadores, el puesto 0, de quien organiza `ORG`. Cada uno trae su cuenta nueva. Cada sorteo
 * se apoya en su propio sello del portero, salvo que la prueba diga otro.
 */
const ORG = Keypair.random().publicKey();
const selloDe = (sorteo: string) => `sello-del-sorteo-${sorteo}`;
const pedido = (o: Partial<PedidoDeAltaPorPremio> = {}): PedidoDeAltaPorPremio => ({
  contrato: CONTRATO,
  sorteo: "5",
  puesto: 0,
  cuenta: Keypair.random().publicKey(),
  organizador: ORG,
  ganadores: 3,
  sello: selloDe(o.sorteo ?? "5"),
  ...o,
});

describe("dar de alta a quien ganó", () => {
  it("admite a quien ganó: la fila, el alta sin sorteos en autorizada, y la cuenta en el libro con motivo premio", () => {
    const { altas, cupos, filas } = montar();
    const p = pedido({ puesto: 1 });
    expect(altas.admitir(p, T0, LIMITES, LIBRE)).toEqual({ ok: true, estado: "admitida", repetido: false });
    const fila = { contrato: CONTRATO, sorteo: "5", puesto: 1, cuenta: p.cuenta, organizador: ORG, sello: selloDe("5"), ms: T0 };
    expect(filas("altas_premio")).toEqual([fila]);
    const alta = { usuario: `cuenta:${p.cuenta}`, motivo: "premio", cuenta: p.cuenta, pedido: null, estado: "autorizada" };
    expect(cupos.altaDeCuenta(p.cuenta)).toEqual(alta);
    expect(cupos.estaEnElLibro(p.cuenta)).toBe(true);
    expect(filas("cuenta_app")).toMatchObject([{ cuenta: p.cuenta, motivo: "premio", permanente: 1 }]);
    expect(filas("altas")).toMatchObject([{ ref: `premio:${CONTRATO}:5:1`, creada: T0, actualizada: T0 }]);
    // Sin sorteos: ni un derecho, ni uno que le quede.
    expect(filas("derechos")).toEqual([]);
    expect(cupos.quedan({ cuenta: p.cuenta }, T0).quedan).toBe(0);
  });

  it("es todo o nada: si algo falla en el medio no queda ni la fila, ni el alta ni la cuenta en el libro", () => {
    const { altas, cupos, filas } = montar(sqlQueFallaEn(/INSERT INTO altas \(usuario/));
    const p = pedido();
    expect(() => altas.admitir(p, T0, LIMITES, LIBRE)).toThrow();
    expect(filas("altas_premio")).toEqual([]);
    expect(filas("altas")).toEqual([]);
    expect(cupos.estaEnElLibro(p.cuenta)).toBe(false);
  });

  it("el mismo contrato, sorteo y puesto con la misma cuenta da repetido y no escribe nada", () => {
    const { altas, filas } = montar();
    const p = pedido();
    altas.admitir(p, T0, LIMITES, LIBRE);
    const antes = JSON.stringify([filas("altas_premio"), filas("altas"), filas("cuenta_app")]);
    expect(altas.admitir(p, T0 + 5000, LIMITES, LIBRE)).toEqual({ ok: true, estado: "admitida", repetido: true });
    expect(JSON.stringify([filas("altas_premio"), filas("altas"), filas("cuenta_app")])).toBe(antes);
  });

  it("el mismo puesto con otra cuenta da puesto-usado y esa otra cuenta no entra", () => {
    const { altas, cupos, filas } = montar();
    altas.admitir(pedido(), T0, LIMITES, LIBRE);
    const otra = pedido();
    expect(altas.admitir(otra, T0 + 1, LIMITES, LIBRE)).toEqual({ ok: false, motivo: "puesto-usado" });
    expect(cupos.estaEnElLibro(otra.cuenta)).toBe(false);
    expect(filas("altas_premio")).toHaveLength(1);
  });

  it("el mismo puesto de otro contrato no choca: con un contrato nuevo los números de sorteo vuelven a empezar", () => {
    const { altas, filas } = montar();
    altas.admitir(pedido(), T0, LIMITES, LIBRE);
    expect(altas.admitir(pedido({ contrato: `C${"B".repeat(55)}` }), T0, LIMITES, LIBRE)).toMatchObject({ ok: true, repetido: false });
    expect(filas("altas_premio")).toHaveLength(2);
  });

  it("una cuenta que ya está en el libro da ya-tiene-acceso sin escribir nada", () => {
    const { altas, cupos, filas } = montar();
    const p = pedido();
    cupos.admitir(p.cuenta, "cupon", T0);
    expect(altas.admitir(p, T0, LIMITES, LIBRE)).toEqual({ ok: true, estado: "ya-tiene-acceso" });
    expect(filas("altas_premio")).toEqual([]);
    expect(filas("altas")).toEqual([]);
  });

  it("una cuenta que ya es la de un alta (de un cupón o a mano) da ya-tiene-acceso sin escribir nada", () => {
    const { altas, sql, filas } = montar();
    const p = pedido();
    const columnas = "usuario, motivo, ref, cuenta, estado, creada, actualizada";
    sql.exec(`INSERT INTO altas (${columnas}) VALUES ('usr_ana', 'cupon', 'r1', ?, 'autorizada', 1, 1)`, p.cuenta);
    expect(altas.admitir(p, T0, LIMITES, LIBRE)).toEqual({ ok: true, estado: "ya-tiene-acceso" });
    expect(filas("altas_premio")).toEqual([]);
  });

  it("el freno de quien llama (el piso de créditos o la pausa) para el alta antes de escribir", () => {
    const { altas, cupos, filas } = montar();
    const p = pedido();
    expect(altas.admitir(p, T0, LIMITES, () => "altas-pausadas")).toEqual({ ok: false, motivo: "altas-pausadas" });
    expect(filas("altas_premio")).toEqual([]);
    expect(filas("altas")).toEqual([]);
    expect(cupos.estaEnElLibro(p.cuenta)).toBe(false);
  });

  it("(ataque) un sorteo de 300 ganadores da 50 altas como mucho: la 51 da cupo sorteo, también pasado el día", () => {
    const { altas, filas } = montar();
    // Repartidas en varios días para que no frene el tope por organizador: el del sorteo no tiene ventana.
    for (let i = 0; i < ALTAS_PREMIO_POR_SORTEO; i++) {
      const cuando = T0 + Math.floor(i / ALTAS_PREMIO_POR_ORGANIZADOR_DIA) * 2 * DIA_MS;
      expect(altas.admitir(pedido({ puesto: i, ganadores: 300 }), cuando, LIMITES, LIBRE)).toMatchObject({ ok: true, repetido: false });
    }
    expect(filas("altas_premio")).toHaveLength(ALTAS_PREMIO_POR_SORTEO);
    const la51 = pedido({ puesto: 50, ganadores: 300 });
    expect(altas.admitir(la51, T0 + 10 * DIA_MS, LIMITES, LIBRE)).toEqual({ ok: false, motivo: "cupo", que: "sorteo" });
  });

  it("(ataque) otros sorteos con la misma lista y la misma ronda, sellados por fuera, comparten las 50 del sello del portero", () => {
    const { altas } = montar();
    const sello = "s".repeat(64);
    // Diez por sorteo y repartidas en varios días: lo único que las junta es el sello en que se apoyan.
    for (let i = 0; i < ALTAS_PREMIO_POR_SORTEO; i++) {
      const cuando = T0 + Math.floor(i / ALTAS_PREMIO_POR_ORGANIZADOR_DIA) * 2 * DIA_MS;
      const p = pedido({ sorteo: String(10 + Math.floor(i / 10)), puesto: i % 10, ganadores: 300, sello });
      expect(altas.admitir(p, cuando, LIMITES, LIBRE)).toMatchObject({ ok: true, repetido: false });
    }
    const otroIgual = pedido({ sorteo: "99", ganadores: 300, sello });
    expect(altas.admitir(otroIgual, T0 + 10 * DIA_MS, LIMITES, LIBRE)).toEqual({ ok: false, motivo: "cupo", que: "sorteo" });
  });

  it("un sorteo con su propio sello del portero no comparte el tope de otro sello", () => {
    const { altas } = montar();
    const sello = "s".repeat(64);
    for (let i = 0; i < ALTAS_PREMIO_POR_SORTEO; i++) {
      const cuando = T0 + Math.floor(i / ALTAS_PREMIO_POR_ORGANIZADOR_DIA) * 2 * DIA_MS;
      altas.admitir(pedido({ puesto: i, ganadores: 300, sello }), cuando, LIMITES, LIBRE);
    }
    const conSuSello = pedido({ sorteo: "6", sello: "t".repeat(64) });
    expect(altas.admitir(conSuSello, T0 + 10 * DIA_MS, LIMITES, LIBRE)).toMatchObject({ ok: true, repetido: false });
  });

  it("(ataque) un organizador da 30 altas en el día: la 31 da cupo organizador con la hora en que se libera el lugar más viejo", () => {
    const { altas } = montar();
    for (let i = 0; i < ALTAS_PREMIO_POR_ORGANIZADOR_DIA; i++) {
      const p = pedido({ sorteo: String(1 + Math.floor(i / 10)), puesto: i % 10, ganadores: 50 });
      expect(altas.admitir(p, T0 + i * 1000, LIMITES, LIBRE)).toMatchObject({ ok: true, repetido: false });
    }
    const siguiente = pedido({ sorteo: "9", puesto: 0, ganadores: 50 });
    expect(altas.admitir(siguiente, T0 + 60_000, LIMITES, LIBRE)).toEqual({ ok: false, motivo: "cupo", que: "organizador", liberaEn: T0 + DIA_MS });
    // Pasadas las 24 horas del primero, vuelve a haber lugar.
    expect(altas.admitir(siguiente, T0 + DIA_MS + 1, LIMITES, LIBRE)).toMatchObject({ ok: true, repetido: false });
  });

  it("(ataque) entre todos hay 100 altas en el día: la 101 de otra cuenta de organizador da cupo dia", () => {
    const { altas } = montar();
    for (let i = 0; i < 100; i++) {
      const organizador = Keypair.random().publicKey();
      expect(altas.admitir(pedido({ organizador, sorteo: String(i + 1) }), T0 + i, LIMITES, LIBRE)).toMatchObject({ ok: true, repetido: false });
    }
    const una = pedido({ organizador: Keypair.random().publicKey(), sorteo: "500" });
    expect(altas.admitir(una, T0 + 1000, LIMITES, LIBRE)).toEqual({ ok: false, motivo: "cupo", que: "dia", liberaEn: T0 + DIA_MS });
  });

  it("el tope del día es el que pasa quien llama: uno más chico (el que se mueve en caliente) frena antes", () => {
    const { altas } = montar();
    expect(altas.admitir(pedido(), T0, { altasPremioDia: 1 }, LIBRE)).toMatchObject({ ok: true });
    expect(altas.admitir(pedido({ puesto: 1 }), T0, { altasPremioDia: 1 }, LIBRE)).toMatchObject({ ok: false, motivo: "cupo", que: "dia" });
  });

  it("un pedido mal armado lanza sin escribir: puesto que no existe, cuenta que no es una G, sin sello, tope que no es un número", () => {
    const { altas, filas } = montar();
    expect(() => altas.admitir(pedido({ puesto: 3, ganadores: 3 }), T0, LIMITES, LIBRE)).toThrow("alta-premio-forma");
    expect(() => altas.admitir(pedido({ cuenta: "GNOESUNACUENTA" }), T0, LIMITES, LIBRE)).toThrow("alta-premio-forma");
    expect(() => altas.admitir(pedido({ ganadores: 301 }), T0, LIMITES, LIBRE)).toThrow("alta-premio-forma");
    expect(() => altas.admitir(pedido({ sello: "" }), T0, LIMITES, LIBRE)).toThrow("alta-premio-forma");
    expect(() => altas.admitir(pedido(), T0, { altasPremioDia: Number.NaN }, LIBRE)).toThrow("alta-premio-topes");
    expect(filas("altas_premio")).toEqual([]);
  });
});

describe("lo que se ve de afuera", () => {
  it("buscar dice qué cuenta ocupa un puesto y quién la nombró, y null si está libre", () => {
    const { altas } = montar();
    const p = pedido({ puesto: 2 });
    expect(altas.buscar(CONTRATO, "5", 2)).toBeNull();
    altas.admitir(p, T0, LIMITES, LIBRE);
    expect(altas.buscar(CONTRATO, "5", 2)).toEqual({ cuenta: p.cuenta, organizador: ORG });
    expect(altas.buscar(CONTRATO, "5", 1)).toBeNull();
  });

  it("hoy cuenta las altas de las últimas 24 horas", () => {
    const { altas } = montar();
    altas.admitir(pedido({ puesto: 0 }), T0, LIMITES, LIBRE);
    altas.admitir(pedido({ puesto: 1 }), T0 + 1000, LIMITES, LIBRE);
    expect(altas.hoy(T0 + 2000)).toBe(2);
    expect(altas.hoy(T0 + DIA_MS + 500)).toBe(1);
    expect(altas.hoy(T0 + DIA_MS + 1500)).toBe(0);
  });

  it("exportar da la tabla entera, en orden", () => {
    const { altas } = montar();
    const a = pedido({ puesto: 1 });
    const b = pedido({ puesto: 0 });
    altas.admitir(a, T0, LIMITES, LIBRE);
    altas.admitir(b, T0 + 1, LIMITES, LIBRE);
    expect(altas.exportar().altas_premio.map((f) => f.cuenta)).toEqual([a.cuenta, b.cuenta]);
  });
});

describe("si la tabla no se puede crear", () => {
  it("un CREATE que falla deja disponible() en false, nombra lo que falta y no lanza", () => {
    const roto = sqlQueFallaEn(/CREATE TABLE IF NOT EXISTS altas_premio/);
    const { altas, cupos } = montar(roto);
    expect(altas.disponible()).toBe(false);
    expect(altas.faltan()).toContain("altas_premio");
    // El resto del objeto sigue: los cupos y el libro andan.
    cupos.admitir(Keypair.random().publicKey(), "cupon", T0);
  });

  it("un índice que no se pudo crear también lo deja no disponible", () => {
    const { altas } = montar(sqlQueFallaEn(/CREATE INDEX IF NOT EXISTS altas_premio_ms/));
    expect(altas.disponible()).toBe(false);
    expect(altas.faltan()).toEqual(["altas_premio_ms"]);
  });

  it("sin la tabla no se da de alta a nadie: lanza antes de tocar nada", () => {
    const { altas, cupos } = montar(sqlQueFallaEn(/CREATE TABLE IF NOT EXISTS altas_premio/));
    const p = pedido();
    expect(() => altas.admitir(p, T0, LIMITES, LIBRE)).toThrow("alta-premio-sin-tablas");
    expect(cupos.estaEnElLibro(p.cuenta)).toBe(false);
  });

  it("las dos veces que arranca el objeto la tabla queda igual: CREATE IF NOT EXISTS", () => {
    const sql = sqlDePrueba();
    const { altas } = montar(sql);
    const p = pedido();
    altas.admitir(p, T0, LIMITES, LIBRE);
    const otra = new AltasPorPremio(sql, new Cupos(sql));
    expect(otra.disponible()).toBe(true);
    expect(otra.buscar(CONTRATO, "5", 0)).toEqual({ cuenta: p.cuenta, organizador: ORG });
  });
});
