import { Keypair } from "@stellar/stellar-sdk/base";
import { describe, expect, it } from "vitest";
import { DIA_MS } from "./config";
import { Cupos, type Limites, sorteosDeUnSello } from "./cupos";
import { sqlDePrueba } from "./sqlite-prueba";

const T0 = Date.UTC(2026, 10, 14, 12, 0, 0);
const LIM: Limites = { maxSellos: 100, maxSorteos: 100, topeGeneral: 150_000_000, reservaSorteo: 82_000, porSorteos: true };

const nuevo = () => {
  const sql = sqlDePrueba();
  return { sql, c: new Cupos(sql) };
};
const cuenta = () => Keypair.random().publicKey();
let n = 0;
const hash = () => (++n).toString(16).padStart(64, "0");
const sello = (c: Cupos, g: string, ahora = T0, extra: { hash?: string; ganadores?: number | null; lim?: Limites } = {}) =>
  c.reservar({ hash: extra.hash ?? hash(), cuenta: g, metodo: "seal", estimado: 130_000, vence: Math.floor(ahora / 1000) + 240, ganadores: extra.ganadores === undefined ? 3 : extra.ganadores }, ahora, extra.lim ?? LIM);
const cuantasFilas = (sql: ReturnType<typeof sqlDePrueba>, tabla: string) => Number(sql.exec(`SELECT COUNT(*) AS n FROM ${tabla}`).toArray()[0]?.n);
const dar = (c: Cupos, g: string, sorteos: number, dias: number, ref = `admin:${hash()}`, ahora = T0) => c.otorgar({ usuario: `cuenta:${g}`, cuenta: g, origen: "admin", ref, sorteos, dias }, ahora);

describe("otorgar y quedan", () => {
  it("un ref repetido no suma, aunque traiga otra cantidad", () => {
    const { c } = nuevo();
    const g = cuenta();
    expect(dar(c, g, 3, 60, "cupon:h:u")).toEqual({ repetido: false });
    expect(dar(c, g, 10, 365, "cupon:h:u")).toEqual({ repetido: true });
    expect(c.quedan({ cuenta: g }, T0)).toEqual({ quedan: 3, proximoVence: { fecha: T0 + 60 * DIA_MS, cuantos: 3 }, vencieron: 0 });
  });

  it("quedan suma lo sin vencer y da el próximo vencimiento con cuántos vencen ese momento", () => {
    const { c } = nuevo();
    const g = cuenta();
    dar(c, g, 10, 365);
    dar(c, g, 3, 60);
    expect(c.quedan({ cuenta: g }, T0)).toEqual({ quedan: 13, proximoVence: { fecha: T0 + 60 * DIA_MS, cuantos: 3 }, vencieron: 0 });
    // A los 61 días los 3 vencieron: no cuentan, y el próximo vencimiento es el de los 10.
    expect(c.quedan({ cuenta: g }, T0 + 61 * DIA_MS)).toEqual({ quedan: 10, proximoVence: { fecha: T0 + 365 * DIA_MS, cuantos: 10 }, vencieron: 3 });
    expect(c.quedan({ cuenta: cuenta() }, T0)).toEqual({ quedan: 0, proximoVence: null, vencieron: 0 });
  });

  it("por persona: lo que todavía no tiene cuenta se ve por el usuario y no por ninguna cuenta", () => {
    const { c } = nuevo();
    c.otorgar({ usuario: "u-1", cuenta: null, origen: "cupon", ref: "cupon:h1:u-1", sorteos: 3, dias: 60 }, T0);
    expect(c.quedan({ usuario: "u-1" }, T0).quedan).toBe(3);
    expect(c.quedan({ usuario: "u-2" }, T0).quedan).toBe(0);
  });

  it("lo mal escrito no se escribe", () => {
    const { c, sql } = nuevo();
    const g = cuenta();
    const base = { usuario: "u", cuenta: g, origen: "admin" as const, ref: "admin:x", sorteos: 3, dias: 60 };
    for (const malo of [{ sorteos: 0 }, { sorteos: 1.5 }, { sorteos: 1001 }, { dias: 0 }, { dias: 3651 }, { usuario: "" }, { ref: "" }, { cuenta: "GNOESUNACUENTA" }, { origen: "regalo" }]) {
      expect(() => c.otorgar({ ...base, ...malo } as never, T0), JSON.stringify(malo)).toThrow();
    }
    expect(cuantasFilas(sql, "derechos")).toBe(0);
  });
});

describe("reservar gasta sorteos oficiales", () => {
  it("un sello gasta uno, y si la red lo rechaza sin que entre, vuelve", () => {
    const { c } = nuevo();
    const g = cuenta();
    dar(c, g, 3, 60);
    const h = hash();
    expect(sello(c, g, T0, { hash: h })).toMatchObject({ ok: true });
    expect(c.quedan({ cuenta: g }, T0).quedan).toBe(2);
    c.devolver(h);
    expect(c.quedan({ cuenta: g }, T0).quedan).toBe(3);
    // Reservarlo de nuevo vuelve a gastar uno.
    expect(sello(c, g, T0, { hash: h })).toMatchObject({ ok: true });
    expect(c.quedan({ cuenta: g }, T0).quedan).toBe(2);
  });

  it("si entró y falló, cuenta: la red ya cobró", () => {
    const { c } = nuevo();
    const g = cuenta();
    dar(c, g, 3, 60);
    const h = hash();
    sello(c, g, T0, { hash: h });
    c.cerrar(h, "fallo", 60_000);
    expect(c.quedan({ cuenta: g }, T0).quedan).toBe(2);
  });

  it("sin derechos da sin-sorteos y no escribe nada", () => {
    const { c, sql } = nuevo();
    const g = cuenta();
    expect(sello(c, g)).toEqual({ ok: false, motivo: "sin-sorteos", vencieron: 0 });
    for (const t of ["uso", "cuentas", "reserva", "consumos", "derechos"]) expect(cuantasFilas(sql, t), t).toBe(0);
  });

  it("los vencidos no cuentan, y dice cuántos vencieron", () => {
    const { c, sql } = nuevo();
    const g = cuenta();
    dar(c, g, 3, 60);
    expect(sello(c, g, T0 + 60 * DIA_MS)).toEqual({ ok: false, motivo: "sin-sorteos", vencieron: 3 });
    expect(cuantasFilas(sql, "uso")).toBe(0);
  });

  it("gasta primero el que vence antes", () => {
    const { c, sql } = nuevo();
    const g = cuenta();
    dar(c, g, 10, 365, "orden:LARGO");
    dar(c, g, 1, 60, "cupon:CORTO");
    const h = hash();
    sello(c, g, T0, { hash: h });
    const usados = Object.fromEntries(sql.exec("SELECT ref, usados FROM derechos").toArray().map((f) => [f.ref, f.usados]));
    expect(usados).toEqual({ "orden:LARGO": 0, "cupon:CORTO": 1 });
    expect(sql.exec("SELECT d.ref FROM consumos k JOIN derechos d ON d.id = k.derecho WHERE k.hash = ?", h).toArray()).toEqual([{ ref: "cupon:CORTO" }]);
    sello(c, g);
    expect(Object.fromEntries(sql.exec("SELECT ref, usados FROM derechos").toArray().map((f) => [f.ref, f.usados]))).toEqual({ "orden:LARGO": 1, "cupon:CORTO": 1 });
  });

  it("treinta sellos seguidos con cinco derechos: pasan cinco", () => {
    const { c } = nuevo();
    const g = cuenta();
    dar(c, g, 5, 60);
    const res = Array.from({ length: 30 }, () => sello(c, g));
    expect(res.filter((r) => r.ok)).toHaveLength(5);
    expect(res.filter((r) => !r.ok && r.motivo === "sin-sorteos")).toHaveLength(25);
    expect(c.quedan({ cuenta: g }, T0).quedan).toBe(0);
    expect(c.consultar(g, T0, LIM).sellos).toBe(5);
  });

  it("con 60 ganadores gasta dos, aunque salgan de dos derechos; y con uno solo no alcanza", () => {
    const { c, sql } = nuevo();
    const g = cuenta();
    dar(c, g, 1, 30);
    dar(c, g, 1, 60);
    const h = hash();
    expect(sello(c, g, T0, { hash: h, ganadores: 60 })).toMatchObject({ ok: true });
    expect(c.quedan({ cuenta: g }, T0).quedan).toBe(0);
    expect(sql.exec("SELECT cuantos FROM consumos WHERE hash = ?", h).toArray()).toHaveLength(2);
    c.devolver(h);
    expect(c.quedan({ cuenta: g }, T0).quedan).toBe(2);
    expect(cuantasFilas(sql, "consumos")).toBe(0);

    const otra = cuenta();
    dar(c, otra, 1, 60);
    expect(sello(c, otra, T0, { ganadores: 60 })).toMatchObject({ ok: false, motivo: "sin-sorteos" });
    expect(sello(c, otra, T0, { ganadores: 50 })).toMatchObject({ ok: true });
  });

  it("cuántos gasta un sello: hasta 50 ganadores uno; de 51 en adelante, o si no se sabe, dos", () => {
    expect([1, 3, 50, 51, 60, 300].map(sorteosDeUnSello)).toEqual([1, 1, 1, 2, 2, 2]);
    expect([null, undefined, 0, 1.5, Number.NaN].map((x) => sorteosDeUnSello(x as never))).toEqual([2, 2, 2, 2, 2]);
  });

  it("un draw no gasta sorteos oficiales, tampoco sin derechos", () => {
    const { c } = nuevo();
    const g = cuenta();
    expect(c.reservar({ hash: hash(), cuenta: g, metodo: "draw", estimado: 90_000, vence: Math.floor(T0 / 1000) + 240 }, T0, LIM)).toMatchObject({ ok: true });
    dar(c, g, 1, 60);
    expect(c.reservar({ hash: hash(), cuenta: g, metodo: "draw", estimado: 90_000, vence: Math.floor(T0 / 1000) + 240 }, T0, LIM)).toMatchObject({ ok: true });
    expect(c.quedan({ cuenta: g }, T0).quedan).toBe(1);
  });

  it("el mismo hash dos veces gasta uno", () => {
    const { c } = nuevo();
    const g = cuenta();
    dar(c, g, 3, 60);
    const h = hash();
    expect(sello(c, g, T0, { hash: h })).toMatchObject({ ok: true, yaContado: false });
    expect(sello(c, g, T0, { hash: h })).toMatchObject({ ok: true, yaContado: true });
    expect(c.quedan({ cuenta: g }, T0).quedan).toBe(2);
  });

  it("si el sello no pasa el tope del mes ni el presupuesto, no gasta sorteos", () => {
    const { c } = nuevo();
    const g = cuenta();
    dar(c, g, 3, 60);
    expect(sello(c, g, T0, { lim: { ...LIM, maxSellos: 0 } })).toMatchObject({ ok: false, motivo: "cupo-cuenta" });
    expect(sello(c, g, T0, { lim: { ...LIM, topeGeneral: 1 } })).toMatchObject({ ok: false, motivo: "fondo" });
    expect(c.quedan({ cuenta: g }, T0).quedan).toBe(3);
  });

  it("sin porSorteos (testnet, o mainnet sin altas) los derechos ni se miran", () => {
    const { c, sql } = nuevo();
    const g = cuenta();
    const sinDerechos = { ...LIM, porSorteos: false };
    expect(sello(c, g, T0, { lim: sinDerechos })).toMatchObject({ ok: true });
    const { porSorteos: _, ...sinCampo } = LIM;
    expect(sello(c, g, T0, { lim: sinCampo })).toMatchObject({ ok: true });
    expect(cuantasFilas(sql, "consumos")).toBe(0);
  });
});

describe("atarCuenta", () => {
  const alta = (sql: ReturnType<typeof sqlDePrueba>, usuario: string, cuenta: string | null = null, motivo = "cupon") =>
    sql.exec("INSERT INTO altas (usuario, motivo, ref, cuenta, estado, creada, actualizada) VALUES (?, ?, 'r', ?, 'autorizada', ?, ?)", usuario, motivo, cuenta, T0, T0);

  it("ata la cuenta al alta y a sus derechos sin cuenta, y la mete en el libro con el motivo del alta", () => {
    const { c, sql } = nuevo();
    const g = cuenta();
    alta(sql, "u-1", null, "pago");
    c.otorgar({ usuario: "u-1", cuenta: null, origen: "paquete", ref: "orden:A", sorteos: 3, dias: 365 }, T0);
    expect(c.quedan({ cuenta: g }, T0).quedan).toBe(0);
    expect(c.atarCuenta("u-1", g, T0 + 5)).toBe("ok");
    expect(c.quedan({ cuenta: g }, T0).quedan).toBe(3);
    expect(c.estaEnElLibro(g)).toBe(true);
    expect(sql.exec("SELECT motivo FROM cuenta_app WHERE cuenta = ?", g).toArray()).toEqual([{ motivo: "pago" }]);
    expect(sql.exec("SELECT cuenta, actualizada FROM altas WHERE usuario = 'u-1'").toArray()).toEqual([{ cuenta: g, actualizada: T0 + 5 }]);
    // Otra vez, lo mismo.
    expect(c.atarCuenta("u-1", g, T0 + 9)).toBe("ok");
    expect(c.quedan({ cuenta: g }, T0).quedan).toBe(3);
  });

  it("sin alta no ata nada", () => {
    const { c, sql } = nuevo();
    const g = cuenta();
    c.otorgar({ usuario: "u-1", cuenta: null, origen: "cupon", ref: "cupon:h:u-1", sorteos: 3, dias: 60 }, T0);
    expect(c.atarCuenta("u-1", g, T0)).toBe("sin-alta");
    expect(c.estaEnElLibro(g)).toBe(false);
    expect(sql.exec("SELECT cuenta FROM derechos").toArray()).toEqual([{ cuenta: null }]);
  });

  it("una cuenta de otra persona, o otra cuenta para la misma persona, no se ata", () => {
    const { c, sql } = nuevo();
    const g = cuenta();
    const h = cuenta();
    alta(sql, "u-1", g);
    alta(sql, "u-2");
    expect(c.atarCuenta("u-2", g, T0)).toBe("cuenta-de-otro");
    expect(c.atarCuenta("u-1", h, T0)).toBe("cuenta-de-otro");
    expect(c.estaEnElLibro(g)).toBe(false);
    expect(c.estaEnElLibro(h)).toBe(false);
  });

  it("una cuenta que administración admitió a mano es la misma cuenta: se ata sin chocar", () => {
    const { c, sql } = nuevo();
    const g = cuenta();
    alta(sql, `cuenta:${g}`, g, "admin");
    alta(sql, "u-1");
    c.otorgar({ usuario: "u-1", cuenta: null, origen: "cupon", ref: "cupon:h:u-1", sorteos: 3, dias: 60 }, T0);
    dar(c, g, 20, 60);
    expect(c.cuentaDeOtro("u-1", g)).toBe(false);
    expect(c.atarCuenta("u-1", g, T0)).toBe("ok");
    expect(c.quedan({ cuenta: g }, T0).quedan).toBe(23);
  });
});

describe("sellos_portero", () => {
  const conSello = (c: Cupos, g: string, h: string, lim: Limites = LIM) =>
    c.reservar({ hash: h, cuenta: g, metodo: "seal", estimado: 130_000, vence: Math.floor(T0 / 1000) + 240, ganadores: 3, sello: { huellaLista: "cd".repeat(32), ronda: 1234 } }, T0, lim);

  it("el sello que entró y salió bien se queda; el que falló en la red o se devolvió, se borra", () => {
    const { c, sql } = nuevo();
    const g = cuenta();
    dar(c, g, 5, 60);
    const [a, b, d] = [hash(), hash(), hash()];
    for (const h of [a, b, d]) expect(conSello(c, g, h).ok).toBe(true);
    expect(cuantasFilas(sql, "sellos_portero")).toBe(3);
    c.cerrar(a, "ok", 100);
    c.cerrar(b, "fallo", 100);
    c.devolver(d);
    expect(sql.exec("SELECT hash, organizador, huella_lista, ronda FROM sellos_portero").toArray()).toEqual([{ hash: a, organizador: g, huella_lista: "cd".repeat(32), ronda: 1234 }]);
  });

  it("sin porSorteos (testnet, o mainnet sin altas) no se anota nada", () => {
    const { c, sql } = nuevo();
    expect(conSello(c, cuenta(), hash(), { ...LIM, porSorteos: false }).ok).toBe(true);
    expect(cuantasFilas(sql, "sellos_portero")).toBe(0);
  });
});
