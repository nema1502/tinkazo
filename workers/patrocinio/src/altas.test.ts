import { createHmac } from "node:crypto";
import { Keypair } from "@stellar/stellar-sdk/base";
import { describe, expect, it } from "vitest";
import { ALFABETO, Altas, LARGO_CUPON, MAX_SORTEOS_POR_CUPON, TECHO_CUPONES_DIA, TECHO_SORTEOS_CUPONES_DIA, huella, mostrar, normalizar } from "./altas";
import { DIA_MS } from "./config";
import { Cupos } from "./cupos";
import vectores from "./cupon-vectores.json";
import { sqlDePrueba } from "./sqlite-prueba";

const T0 = Date.UTC(2026, 10, 14, 12, 0, 0);
const VENCE = Date.UTC(2026, 11, 15, 3, 59, 0);
/** Inventado, solo para las pruebas. */
const SECRETO = "s".repeat(32);

const nuevo = () => {
  const sql = sqlDePrueba();
  const cupos = new Cupos(sql);
  return { sql, cupos, a: new Altas(sql, cupos) };
};
let n = 0;
/** Una huella inventada, distinta cada vez. */
const hh = () => (++n).toString(16).padStart(64, "0");
const lote = (a: Altas, huellas: string[], extra: Partial<Parameters<Altas["crearCupones"]>[0]> = {}, ahora = T0) =>
  a.crearCupones({ lote: "space-apps-14nov", huellas, sorteos: 3, dias: 60, vence: VENCE, usos: 1, ...extra }, ahora);
const filas = (sql: ReturnType<typeof sqlDePrueba>, q: string, ...e: unknown[]) => sql.exec(q, ...e).toArray();
const cuantas = (sql: ReturnType<typeof sqlDePrueba>, tabla: string) => Number(filas(sql, `SELECT COUNT(*) AS n FROM ${tabla}`)[0]?.n);

describe("normalizar, con el vector que comparten el portero, el sitio y la herramienta", () => {
  it("el vector dice el mismo alfabeto y el mismo largo que el código", () => {
    expect(vectores.alfabeto).toBe(ALFABETO);
    expect(vectores.largo).toBe(LARGO_CUPON);
    expect(ALFABETO).toHaveLength(32);
    for (const c of "ILOU") expect(ALFABETO).not.toContain(c);
  });

  for (const caso of vectores.casos) {
    it(`${JSON.stringify(caso.entrada)} da ${JSON.stringify(caso.normalizado)}`, () => {
      expect(normalizar(caso.entrada)).toBe(caso.normalizado);
      if (caso.normalizado !== null) {
        expect(mostrar(caso.normalizado)).toBe((caso as { mostrado?: string }).mostrado);
        // Normalizar lo normalizado o lo mostrado da lo mismo.
        expect(normalizar(caso.normalizado)).toBe(caso.normalizado);
        expect(normalizar(mostrar(caso.normalizado))).toBe(caso.normalizado);
      }
    });
  }

  it("lo que no es texto, o es enorme, da null sin recorrerlo", () => {
    for (const x of [undefined, null, 12, {}, ["K7M29QXA4HTR"]]) expect(normalizar(x)).toBeNull();
    expect(normalizar(`K7M29QXA4HTR${" ".repeat(100)}`)).toBeNull();
  });

  it("mostrar no acepta lo que no está normalizado", () => {
    expect(() => mostrar("k7m29qxa4htr")).toThrow();
    expect(() => mostrar("K7M2-9QXA-4HTR")).toThrow();
  });
});

describe("huella", () => {
  it("es HMAC-SHA256 del código normalizado con el secreto, en hexadecimal", async () => {
    const esperada = createHmac("sha256", SECRETO).update("K7M29QXA4HTR").digest("hex");
    expect(await huella("K7M29QXA4HTR", SECRETO)).toBe(esperada);
    expect(await huella("K7M29QXA4HTR", `${SECRETO}x`)).not.toBe(esperada);
  });

  it("sin secreto, con uno corto o con un código sin normalizar, no hay huella", async () => {
    await expect(huella("K7M29QXA4HTR", "")).rejects.toThrow();
    await expect(huella("K7M29QXA4HTR", "s".repeat(31))).rejects.toThrow();
    await expect(huella("K7M2-9QXA-4HTR", SECRETO)).rejects.toThrow();
    await expect(huella("k7m29qxa4htr", SECRETO)).rejects.toThrow();
  });
});

describe("crearCupones", () => {
  it("crea el lote; una huella que ya existe cuenta como repetida y no se toca", () => {
    const { a, sql } = nuevo();
    const [x, y] = [hh(), hh()];
    expect(lote(a, [x, y])).toEqual({ ok: true, creados: 2, repetidos: 0 });
    expect(lote(a, [x, hh()], { lote: "otro", sorteos: 9 })).toEqual({ ok: true, creados: 1, repetidos: 1 });
    expect(filas(sql, "SELECT lote, sorteos, usos, usos_max, anulado, vence, dias FROM cupones WHERE huella = ?", x)).toEqual([
      { lote: "space-apps-14nov", sorteos: 3, usos: 0, usos_max: 1, anulado: 0, vence: VENCE, dias: 60 },
    ]);
  });

  it("el techo: más de 500 usos nuevos en el día no crea ninguno; al otro día se puede", () => {
    const { a, sql } = nuevo();
    // Con cupones de un sorteo, para que el techo que se mira sea el de los usos y no el de los sorteos.
    const lote = (a: Altas, huellas: string[], extra: Partial<Parameters<Altas["crearCupones"]>[0]> = {}, ahora = T0) =>
      a.crearCupones({ lote: "space-apps-14nov", huellas, sorteos: 1, dias: 60, vence: VENCE, usos: 1, ...extra }, ahora);
    expect(lote(a, Array.from({ length: 400 }, hh))).toMatchObject({ ok: true, creados: 400 });
    const pasan = Array.from({ length: 101 }, hh);
    expect(lote(a, pasan)).toEqual({ ok: false, motivo: "techo" });
    expect(cuantas(sql, "cupones")).toBe(400);
    // Un código compartido cuenta por sus usos.
    expect(lote(a, [hh()], { usos: 101 })).toEqual({ ok: false, motivo: "techo" });
    expect(lote(a, Array.from({ length: 100 }, hh))).toMatchObject({ ok: true, creados: 100 });
    expect(lote(a, [hh()])).toEqual({ ok: false, motivo: "techo" });
    // Las repetidas no gastan techo.
    expect(lote(a, [filas(sql, "SELECT huella FROM cupones LIMIT 1")[0]?.huella as string])).toEqual({ ok: true, creados: 0, repetidos: 1 });
    expect(lote(a, pasan, {}, T0 + DIA_MS)).toMatchObject({ ok: true, creados: 101 });
    expect(TECHO_CUPONES_DIA).toBe(500);
  });

  it(`el techo de sorteos: ${TECHO_SORTEOS_CUPONES_DIA} sorteos de cupones nuevos por día, contando usos por sorteos`, () => {
    expect(TECHO_SORTEOS_CUPONES_DIA).toBe(500);
    const { a, sql } = nuevo();
    // El lote del sábado y su reserva: 30 y 10 tarjetas de 3 sorteos.
    expect(lote(a, Array.from({ length: 30 }, hh))).toMatchObject({ ok: true, creados: 30 });
    expect(lote(a, Array.from({ length: 10 }, hh), { lote: "space-apps-14nov-reserva" })).toMatchObject({ ok: true, creados: 10 });
    // Llevan 120; 380 más pasan justo.
    expect(lote(a, Array.from({ length: 19 }, hh), { lote: "venta", sorteos: 20 })).toMatchObject({ ok: true, creados: 19 });
    expect(cuantas(sql, "cupones")).toBe(59);
    // Uno más en el mismo día ya se pasa: no se escribe ninguno, tampoco en un lote propio.
    expect(lote(a, [hh()], { lote: "otro", sorteos: 1 })).toEqual({ ok: false, motivo: "techo" });
    expect(cuantas(sql, "cupones")).toBe(59);
    // Al otro día se puede.
    expect(lote(a, [hh()], { lote: "otro", sorteos: 1 }, T0 + DIA_MS)).toMatchObject({ ok: true, creados: 1 });
  });

  it("con la clave filtrada, 500 cupones de 50 sorteos en lotes propios no pasan: el techo cuenta sorteos, no cupones", () => {
    const { a, sql } = nuevo();
    let creados = 0;
    for (let i = 0; i < 500; i++) if (lote(a, [hh()], { lote: `lote-${i}`, sorteos: MAX_SORTEOS_POR_CUPON }).ok) creados++;
    expect(creados).toBe(10);
    expect(cuantas(sql, "cupones")).toBe(10);
    // Un código compartido cuenta usos por sorteos.
    const { a: b } = nuevo();
    expect(lote(b, [hh()], { usos: 11, sorteos: 50 })).toEqual({ ok: false, motivo: "techo" });
    expect(lote(b, [hh()], { usos: 10, sorteos: 50 })).toMatchObject({ ok: true, creados: 1 });
  });

  it(`un cupón trae de 1 a ${MAX_SORTEOS_POR_CUPON} sorteos: el paquete de 50 que se vende por fuera entra, 51 no`, () => {
    expect(MAX_SORTEOS_POR_CUPON).toBe(50);
    const { a } = nuevo();
    expect(lote(a, [hh()], { sorteos: 50 })).toMatchObject({ ok: true, creados: 1 });
    expect(lote(a, [hh()], { sorteos: 51 })).toEqual({ ok: false, motivo: "cuerpo" });
  });

  it("lo mal escrito no crea nada", () => {
    const { a, sql } = nuevo();
    const malos: Array<Partial<Parameters<Altas["crearCupones"]>[0]>> = [
      { lote: "" },
      { lote: "Space Apps" },
      { lote: "x".repeat(65) },
      { huellas: [] },
      { huellas: ["no-es-huella"] },
      { huellas: ["A".repeat(64)] },
      { huellas: Array.from({ length: 501 }, hh) },
      { sorteos: 0 },
      { sorteos: 101 },
      { sorteos: 2.5 },
      { dias: 0 },
      { dias: 366 },
      { usos: 0 },
      { usos: 501 },
      { vence: T0 },
      { vence: T0 + 3651 * DIA_MS },
    ];
    for (const m of malos) expect(lote(a, [hh()], m), JSON.stringify(m).slice(0, 60)).toEqual({ ok: false, motivo: "cuerpo" });
    expect(cuantas(sql, "cupones")).toBe(0);
  });
});

describe("canjear", () => {
  const g = () => Keypair.random().publicKey();

  it("un uso: suma los sorteos, abre el alta, ata la cuenta y la mete en el libro", () => {
    const { a, cupos, sql } = nuevo();
    const x = hh();
    lote(a, [x]);
    const cuenta = g();
    expect(a.canjear({ huella: x, usuario: "u-1", cuenta }, T0)).toEqual({ ok: true, repetido: false, sorteosSumados: 3, lote: "space-apps-14nov", altaNueva: true });
    expect(cupos.estaEnElLibro(cuenta)).toBe(true);
    expect(cupos.quedan({ cuenta }, T0)).toEqual({ quedan: 3, proximoVence: { fecha: T0 + 60 * DIA_MS, cuantos: 3 }, vencieron: 0 });
    expect(filas(sql, "SELECT usuario, motivo, ref, cuenta, estado FROM altas")).toEqual([{ usuario: "u-1", motivo: "cupon", ref: `cupon:${x}`, cuenta, estado: "autorizada" }]);
    expect(filas(sql, "SELECT ref, origen FROM derechos")).toEqual([{ ref: `cupon:${x}:u-1`, origen: "cupon" }]);
    expect(filas(sql, "SELECT usos FROM cupones")).toEqual([{ usos: 1 }]);
  });

  it("sin cuenta todavía: los sorteos quedan de la persona y se atan después", () => {
    const { a, cupos } = nuevo();
    const x = hh();
    lote(a, [x]);
    expect(a.canjear({ huella: x, usuario: "u-1", cuenta: null }, T0)).toMatchObject({ ok: true, sorteosSumados: 3 });
    expect(cupos.quedan({ usuario: "u-1" }, T0).quedan).toBe(3);
    const cuenta = g();
    expect(cupos.estaEnElLibro(cuenta)).toBe(false);
    expect(cupos.atarCuenta("u-1", cuenta, T0)).toBe("ok");
    expect(cupos.estaEnElLibro(cuenta)).toBe(true);
    expect(cupos.quedan({ cuenta }, T0).quedan).toBe(3);
  });

  it("la misma persona otra vez: lo mismo, sin gastar otro uso ni sumar sorteos; y si ahora trae la cuenta, la ata", () => {
    const { a, cupos, sql } = nuevo();
    const x = hh();
    lote(a, [x], { usos: 5 });
    a.canjear({ huella: x, usuario: "u-1", cuenta: null }, T0);
    const cuenta = g();
    expect(a.canjear({ huella: x, usuario: "u-1", cuenta }, T0 + 1000)).toEqual({ ok: true, repetido: true, sorteosSumados: 0, lote: "space-apps-14nov", altaNueva: false });
    expect(filas(sql, "SELECT usos FROM cupones")).toEqual([{ usos: 1 }]);
    expect(cupos.quedan({ cuenta }, T0).quedan).toBe(3);
    expect(cupos.estaEnElLibro(cuenta)).toBe(true);
  });

  it("otra persona con un cupón de un uso ya usado da cupon-usado, sin escribir nada", () => {
    const { a, sql } = nuevo();
    const x = hh();
    lote(a, [x]);
    a.canjear({ huella: x, usuario: "u-1", cuenta: g() }, T0);
    expect(a.canjear({ huella: x, usuario: "u-2", cuenta: g() }, T0)).toEqual({ ok: false, motivo: "cupon-usado" });
    expect(cuantas(sql, "canjes")).toBe(1);
    expect(cuantas(sql, "altas")).toBe(1);
    expect(cuantas(sql, "derechos")).toBe(1);
  });

  it("uno que no existe, uno vencido y uno anulado", () => {
    const { a, sql } = nuevo();
    const [x, y] = [hh(), hh()];
    lote(a, [x, y]);
    expect(a.canjear({ huella: hh(), usuario: "u-1", cuenta: null }, T0)).toEqual({ ok: false, motivo: "cupon-no-existe" });
    expect(a.canjear({ huella: x, usuario: "u-1", cuenta: null }, VENCE + 1)).toEqual({ ok: false, motivo: "cupon-vencido", vence: VENCE });
    a.anular({ huella: y });
    expect(a.canjear({ huella: y, usuario: "u-1", cuenta: null }, T0)).toEqual({ ok: false, motivo: "cupon-anulado" });
    // El último minuto todavía vale.
    expect(a.canjear({ huella: x, usuario: "u-1", cuenta: null }, VENCE)).toMatchObject({ ok: true });
    expect(cuantas(sql, "canjes")).toBe(1);
  });

  it("dos del mismo lote para la misma persona dan lote-usado; uno de otro lote, no", () => {
    const { a, cupos } = nuevo();
    const [x, y, z] = [hh(), hh(), hh()];
    lote(a, [x, y]);
    lote(a, [z], { lote: "devfest-tarija" });
    const cuenta = g();
    expect(a.canjear({ huella: x, usuario: "u-1", cuenta }, T0)).toMatchObject({ ok: true });
    expect(a.canjear({ huella: y, usuario: "u-1", cuenta }, T0)).toEqual({ ok: false, motivo: "lote-usado" });
    expect(a.canjear({ huella: z, usuario: "u-1", cuenta }, T0)).toEqual({ ok: true, repetido: false, sorteosSumados: 3, lote: "devfest-tarija", altaNueva: false });
    expect(cupos.quedan({ cuenta }, T0).quedan).toBe(6);
    expect(a.canjear({ huella: y, usuario: "u-2", cuenta: g() }, T0)).toMatchObject({ ok: true });
  });

  it("un código de 50 usos deja pasar a 50 personas y no a la 51", () => {
    const { a, sql } = nuevo();
    const x = hh();
    lote(a, [x], { usos: 50 });
    const res = Array.from({ length: 51 }, (_, i) => a.canjear({ huella: x, usuario: `u-${i}`, cuenta: g() }, T0));
    expect(res.filter((r) => r.ok)).toHaveLength(50);
    expect(res[50]).toEqual({ ok: false, motivo: "cupon-usado" });
    expect(filas(sql, "SELECT usos, usos_max FROM cupones")).toEqual([{ usos: 50, usos_max: 50 }]);
    expect(cuantas(sql, "derechos")).toBe(50);
  });

  it("el freno (el piso, la pausa) lo para antes de escribir: el cupón no se gasta", () => {
    const { a, sql } = nuevo();
    const x = hh();
    lote(a, [x]);
    const vistos: unknown[] = [];
    const freno = (c: { sorteos: number; altaNueva: boolean }) => (vistos.push(c), "altas-pausadas" as const);
    expect(a.canjear({ huella: x, usuario: "u-1", cuenta: g(), freno }, T0)).toEqual({ ok: false, motivo: "altas-pausadas" });
    expect(vistos).toEqual([{ sorteos: 3, altaNueva: true }]);
    for (const t of ["canjes", "altas", "derechos", "cuenta_app"]) expect(cuantas(sql, t), t).toBe(0);
    expect(filas(sql, "SELECT usos FROM cupones")).toEqual([{ usos: 0 }]);
    expect(a.canjear({ huella: x, usuario: "u-1", cuenta: g(), freno: () => null }, T0)).toMatchObject({ ok: true });
  });

  it("una cuenta que ya es de otra persona no se canjea, y no gasta nada", () => {
    const { a, sql } = nuevo();
    const [x, y] = [hh(), hh()];
    lote(a, [x]);
    lote(a, [y], { lote: "otro" });
    const cuenta = g();
    a.canjear({ huella: x, usuario: "u-1", cuenta }, T0);
    expect(a.canjear({ huella: y, usuario: "u-2", cuenta }, T0)).toEqual({ ok: false, motivo: "cuenta-de-otro" });
    expect(filas(sql, "SELECT usos FROM cupones WHERE huella = ?", y)).toEqual([{ usos: 0 }]);
    expect(cuantas(sql, "altas")).toBe(1);
  });

  it("quien ya tenía alta (por un pago) suma solo los sorteos", () => {
    const { a, cupos, sql } = nuevo();
    const x = hh();
    lote(a, [x]);
    const cuenta = g();
    sql.exec("INSERT INTO altas (usuario, motivo, ref, cuenta, estado, creada, actualizada) VALUES ('u-1', 'pago', 'orden:A', ?, 'abierta', 1, 1)", cuenta);
    expect(a.canjear({ huella: x, usuario: "u-1", cuenta }, T0)).toMatchObject({ ok: true, altaNueva: false, sorteosSumados: 3 });
    expect(filas(sql, "SELECT motivo, estado FROM altas")).toEqual([{ motivo: "pago", estado: "abierta" }]);
    expect(filas(sql, "SELECT motivo FROM cuenta_app WHERE cuenta = ?", cuenta)).toEqual([{ motivo: "pago" }]);
    expect(cupos.quedan({ cuenta }, T0).quedan).toBe(3);
  });

  it("lo que no tiene forma no se mira", () => {
    const { a } = nuevo();
    expect(() => a.canjear({ huella: "K7M29QXA4HTR", usuario: "u", cuenta: null }, T0)).toThrow();
    expect(() => a.canjear({ huella: hh(), usuario: "", cuenta: null }, T0)).toThrow();
    expect(() => a.canjear({ huella: hh(), usuario: "cuenta:GX", cuenta: null }, T0)).toThrow();
    expect(() => a.canjear({ huella: hh(), usuario: "u", cuenta: "GNOESCUENTA" }, T0)).toThrow();
  });
});

describe("estadoDelLote y anular", () => {
  it("cuenta creados, canjeados, cuentas y sorteos usados, sin nombrar a nadie", () => {
    const { a, cupos } = nuevo();
    const hs = [hh(), hh(), hh()];
    lote(a, hs);
    lote(a, [hh()], { lote: "otro" });
    const cuenta = Keypair.random().publicKey();
    a.canjear({ huella: hs[0] as string, usuario: "u-1", cuenta }, T0);
    a.canjear({ huella: hs[1] as string, usuario: "u-2", cuenta: null }, T0);
    cupos.reservar({ hash: "f".repeat(64), cuenta, metodo: "seal", estimado: 1, vence: 1, ganadores: 3 }, T0, { maxSellos: 100, maxSorteos: 100, topeGeneral: 1e9, reservaSorteo: 1, porSorteos: true });
    expect(a.estadoDelLote("space-apps-14nov")).toEqual({ lote: "space-apps-14nov", creados: 3, canjeados: 2, cuentas: 1, sorteosUsados: 1, vence: VENCE, anulado: false, anulados: 0 });
    expect(a.estadoDelLote("no-existe")).toBeNull();
  });

  it("anular un lote o un cupón: cuenta los que anuló, una vez; lo canjeado sigue", () => {
    const { a, cupos } = nuevo();
    const hs = [hh(), hh(), hh()];
    lote(a, hs);
    const cuenta = Keypair.random().publicKey();
    a.canjear({ huella: hs[0] as string, usuario: "u-1", cuenta }, T0);
    expect(a.anular({ huella: hs[1] as string })).toEqual({ anulados: 1 });
    expect(a.anular({ huella: hs[1] as string })).toEqual({ anulados: 0 });
    expect(a.estadoDelLote("space-apps-14nov")).toMatchObject({ anulado: false, anulados: 1 });
    expect(a.anular({ lote: "space-apps-14nov" })).toEqual({ anulados: 2 });
    expect(a.estadoDelLote("space-apps-14nov")).toMatchObject({ anulado: true, anulados: 3, canjeados: 1 });
    expect(cupos.quedan({ cuenta }, T0).quedan).toBe(3);
    expect(cupos.estaEnElLibro(cuenta)).toBe(true);
    expect(() => a.anular({ lote: "Lote Raro" })).toThrow();
  });
});
