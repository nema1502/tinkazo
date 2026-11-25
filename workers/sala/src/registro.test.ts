import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { VENTANA_EQUIPOS_MS, anotarEquipo, crearTablasDeEquipos, type AltaDeEquipo, type Ejecutar, type ValorSql } from "./registro";

/**
 * La corrección de la cuenta de un equipo (issue #119): la página avisa que es una corrección (lleva la cuenta
 * anterior) y el registro mueve la fila solo si la llave del celular es la misma. Nada se renumera: la fila
 * conserva su número, y una tableta que anota a varios equipos de verdad sigue sumando filas.
 */

function nuevaSala(): { sql: Ejecutar; db: DatabaseSync } {
  const db = new DatabaseSync(":memory:");
  const sql: Ejecutar = <T,>(consulta: string, ...p: ValorSql[]): T[] => db.prepare(consulta).all(...p) as unknown as T[];
  crearTablasDeEquipos(sql);
  return { sql, db };
}

const llaveNueva = (): string => Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("base64url");
const cuentaN = (i: number): string => `G${String(i).padStart(55, "B")}`;
const D = (marca: string): string => Buffer.from(`equipo cifrado de prueba: ${marca}`.padEnd(40, ".")).toString("base64url");
/** Una hora fija al principio de una ventana, para que las cuentas no dependan del reloj. */
const T0 = 1_000 * VENTANA_EQUIPOS_MS;
const siempre = (): boolean => true;

function alta(o: Partial<AltaDeEquipo> = {}): AltaDeEquipo {
  return { cuenta: cuentaN(1), d: D("a"), llave: "", ip: "200.87.1.10", ahora: T0, modo: "sorteo", ...o };
}

const filas = (sql: Ejecutar) => sql<{ n: number; cuenta: string; d: string; estado: string; v: number }>("SELECT n, cuenta, d, estado, v FROM equipos ORDER BY n");
const deCuenta = (sql: Ejecutar, cuenta: string) => sql<{ n: number; d: string; estado: string; v: number }>("SELECT n, d, estado, v FROM equipos WHERE cuenta = ?", cuenta)[0];

describe("corregir la cuenta de un equipo", () => {
  it("la misma llave con otra cuenta como corrección deja una sola fila: se mueve, con su número", async () => {
    const { sql } = nuevaSala();
    const llave = llaveNueva();
    const a = await anotarEquipo(sql, alta({ llave, d: D("primero") }), siempre);
    if (!a.ok) throw new Error("el alta inicial debió entrar");
    sql("UPDATE equipos SET estado = 'aceptado' WHERE n = ?", a.n);
    const r = await anotarEquipo(sql, alta({ cuenta: cuentaN(2), correccion: cuentaN(1), llave, d: D("corregido") }), siempre);
    expect(r).toMatchObject({ ok: true, n: a.n, estado: "solicitud" });
    expect(sql<{ c: number }>("SELECT COUNT(*) AS c FROM equipos")[0]?.c).toBe(1);
    expect(deCuenta(sql, cuentaN(1))).toBeUndefined();
    expect(deCuenta(sql, cuentaN(2))).toEqual({ n: a.n, d: D("corregido"), estado: "solicitud", v: expect.any(Number) });
  });

  it("en el modo con sorteo propio, un equipo aceptado al cambiar de cuenta vuelve a solicitud: la aceptación era de otra cuenta", async () => {
    const { sql } = nuevaSala();
    const llave = llaveNueva();
    const a = await anotarEquipo(sql, alta({ llave, modo: "sorteo" }), siempre);
    sql("UPDATE equipos SET estado = 'sorteo' WHERE cuenta = ?", cuentaN(1));
    const r = await anotarEquipo(sql, alta({ cuenta: cuentaN(2), correccion: cuentaN(1), llave, modo: "sorteo" }), siempre);
    expect(r).toMatchObject({ ok: true, n: a.n, estado: "solicitud" });
  });

  it("en el modo de reserva, al cambiar de cuenta sigue aceptado (no hay aceptación que heredar)", async () => {
    const { sql } = nuevaSala();
    const llave = llaveNueva();
    const a = await anotarEquipo(sql, alta({ llave, modo: "cupon" }), siempre);
    const r = await anotarEquipo(sql, alta({ cuenta: cuentaN(2), correccion: cuentaN(1), llave, modo: "cupon" }), siempre);
    expect(r).toMatchObject({ ok: true, n: a.n, estado: "aceptado" });
  });

  it("con el cupón ya entregado no se puede cambiar: se rechaza con «cupon» y la fila queda como estaba", async () => {
    const { sql } = nuevaSala();
    const llave = llaveNueva();
    await anotarEquipo(sql, alta({ llave, modo: "cupon" }), siempre);
    sql("UPDATE equipos SET estado = 'cupon' WHERE cuenta = ?", cuentaN(1));
    const antes = filas(sql);
    const r = await anotarEquipo(sql, alta({ cuenta: cuentaN(2), correccion: cuentaN(1), llave, modo: "cupon" }), siempre);
    expect(r).toEqual({ ok: false, motivo: "cupon" });
    expect(filas(sql)).toEqual(antes);
  });

  it("la misma llave como equipo nuevo (sin corrección) suma otra fila: la tableta del stand sigue pudiendo", async () => {
    const { sql } = nuevaSala();
    const llave = llaveNueva();
    await anotarEquipo(sql, alta({ llave, d: D("equipo 1") }), siempre);
    const r = await anotarEquipo(sql, alta({ cuenta: cuentaN(2), llave, d: D("equipo 2") }), siempre);
    expect(r).toMatchObject({ ok: true, estado: "solicitud" });
    expect(sql<{ c: number }>("SELECT COUNT(*) AS c FROM equipos")[0]?.c).toBe(2);
  });

  it("una llave distinta no puede mover la fila de otro: «ajena», y la fila queda intacta", async () => {
    const { sql } = nuevaSala();
    await anotarEquipo(sql, alta({ llave: llaveNueva(), d: D("de verdad") }), siempre);
    const antes = filas(sql);
    const r = await anotarEquipo(sql, alta({ cuenta: cuentaN(2), correccion: cuentaN(1), llave: llaveNueva(), d: D("pisado"), ip: "181.115.9.9" }), siempre);
    expect(r).toEqual({ ok: false, motivo: "ajena" });
    expect(filas(sql)).toEqual(antes);
  });

  it("la corrección de una cuenta que ya no está (la quitaron para liberarla) anota de nuevo, como equipo nuevo", async () => {
    const { sql } = nuevaSala();
    const llave = llaveNueva();
    await anotarEquipo(sql, alta({ llave }), siempre);
    sql("DELETE FROM equipos WHERE cuenta = ?", cuentaN(1));
    const r = await anotarEquipo(sql, alta({ cuenta: cuentaN(2), correccion: cuentaN(1), llave, d: D("de vuelta") }), siempre);
    expect(r).toMatchObject({ ok: true, estado: "solicitud" });
    expect(sql<{ c: number }>("SELECT COUNT(*) AS c FROM equipos")[0]?.c).toBe(1);
    expect(deCuenta(sql, cuentaN(2))?.d).toBe(D("de vuelta"));
  });

  it("repetir la misma corrección no suma nada (el reintento tras una respuesta perdida es idempotente)", async () => {
    const { sql } = nuevaSala();
    const llave = llaveNueva();
    await anotarEquipo(sql, alta({ llave, d: D("primero") }), siempre);
    const pedido = alta({ cuenta: cuentaN(2), correccion: cuentaN(1), llave, d: D("corregido") });
    const a = await anotarEquipo(sql, pedido, siempre);
    expect(a).toMatchObject({ ok: true });
    const b = await anotarEquipo(sql, pedido, siempre);
    expect(b).toMatchObject({ ok: true, n: a.ok ? a.n : 0, estado: a.ok ? a.estado : "" });
    expect(sql<{ c: number }>("SELECT COUNT(*) AS c FROM equipos")[0]?.c).toBe(1);
  });

  it("corregir es un envío de corrección, no gasta una alta nueva", async () => {
    const { sql } = nuevaSala();
    const llave = llaveNueva();
    await anotarEquipo(sql, alta({ llave }), siempre);
    const ventana = Math.floor(T0 / VENTANA_EQUIPOS_MS);
    await anotarEquipo(sql, alta({ cuenta: cuentaN(2), correccion: cuentaN(1), llave }), siempre);
    const ritmo = sql<{ altas: number; envios: number }>("SELECT altas, envios FROM ritmo WHERE ventana = ?", ventana)[0];
    expect(ritmo).toEqual({ altas: 1, envios: 2 });
  });

  it("la huella de la llave sigue siendo lo único que se guarda (y viaja con la fila que se movió)", async () => {
    const { sql } = nuevaSala();
    const llave = llaveNueva();
    await anotarEquipo(sql, alta({ llave }), siempre);
    await anotarEquipo(sql, alta({ cuenta: cuentaN(2), correccion: cuentaN(1), llave }), siempre);
    const f = deCuenta(sql, cuentaN(2));
    if (!f) throw new Error("la fila movida no está");
    const conHuella = sql<{ llave: string }>("SELECT llave FROM equipos")[0];
    expect(conHuella.llave).toBe(createHash("sha256").update(llave).digest("hex"));
    expect(JSON.stringify(sql("SELECT * FROM equipos"))).not.toContain(llave);
  });
});
