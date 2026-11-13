import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { StrKey } from "@stellar/stellar-sdk/base";
import { describe, expect, it } from "vitest";
import { codigo } from "./altas-prueba";
import { montarPagos } from "./cobros-prueba";
import type { Env } from "./config";
import { Cupos } from "./cupos";
import { sqlDePrueba } from "./sqlite-prueba";

/**
 * Si al arrancar el objeto no se puede sumar una columna nueva a una tabla que ya existía (la base llena, un error raro
 * de SQLite), el objeto NO se cae: los sellos, los sorteos y los cupones del evento siguen como hoy. La columna que falta
 * queda anotada, la venta queda cerrada (ni compra con QR, ni orden nueva, ni carga) y el estado lo dice en `faltaAltas`
 * con `columnas-nuevas`, para que la vigilancia avise.
 */

const cuenta = (n: number) => StrKey.encodeEd25519PublicKey(Buffer.alloc(32, n));
const [ANA, BETO] = [cuenta(21), cuenta(22)] as [string, string];

/** La tabla de órdenes del portero desplegado hoy, sin la columna `reemplazada`. */
const ORDENES_ANTES =
  "CREATE TABLE ordenes (id TEXT PRIMARY KEY, usuario TEXT NOT NULL, producto TEXT NOT NULL, monto INTEGER NOT NULL, sorteos INTEGER NOT NULL, dias INTEGER NOT NULL, creada INTEGER NOT NULL, vence INTEGER NOT NULL, pagada INTEGER, metodo TEXT, ref TEXT)";
/** Una tabla de compras de una versión intermedia, sin la hora del último aviso. */
const COMPRAS_ANTES =
  "CREATE TABLE compras_qr (id INTEGER PRIMARY KEY AUTOINCREMENT, usuario TEXT NOT NULL, producto TEXT NOT NULL, creada INTEGER NOT NULL, desde INTEGER NOT NULL, reserva INTEGER NOT NULL, recargo INTEGER NOT NULL, primera INTEGER NOT NULL, nueva INTEGER NOT NULL, cargada INTEGER, cerrada INTEGER, motivo TEXT)";

/** Un SQLite con esas tablas de antes, donde sumar una columna falla con un error que no es el de una columna repetida. */
function sqlQueNoSuma(tablas: string[], falla: RegExp) {
  const db = new DatabaseSync(":memory:");
  for (const t of tablas) db.exec(t);
  const sql = sqlDePrueba(db);
  const exec = sql.exec;
  sql.exec = (consulta, ...enlaces) => {
    if (falla.test(consulta)) throw new Error("SQLITE_FULL: database or disk is full");
    return exec(consulta, ...enlaces);
  };
  return sql;
}

const PILOTO: Partial<Env> = { COMPRAS_QR: "1", CARGAS: "1", COMPRAS_QR_DIA: "6", COMPRAS_QR_PILOTO: ANA };

describe("una columna nueva que no se puede sumar al arrancar", () => {
  it("el constructor no lanza: anota la que falta, suma las demás y crea las tablas nuevas", () => {
    const sql = sqlQueNoSuma([ORDENES_ANTES], /^ALTER TABLE ordenes ADD COLUMN reemplazada/);
    const cupos = new Cupos(sql);
    expect(cupos.columnasQueFaltan()).toEqual(["ordenes.reemplazada"]);
    expect(cupos.faltaColumna("ordenes", "reemplazada")).toBe(true);
    expect(cupos.faltaColumna("compras_qr", "avisada")).toBe(false);
    const columnas = (t: string) => sql.exec(`PRAGMA table_info(${t})`).toArray().map((f) => String(f.name));
    expect(columnas("ordenes")).not.toContain("reemplazada");
    expect(columnas("cuenta_app")).toEqual(expect.arrayContaining(["motivo", "permanente"]));
    expect(columnas("compras_qr")).toContain("avisada");
    // Arrancar otra vez (un reinicio del objeto) tampoco lanza.
    expect(new Cupos(sql).columnasQueFaltan()).toEqual(["ordenes.reemplazada"]);
    // Con todo bien, no falta nada.
    expect(new Cupos(sqlDePrueba()).columnasQueFaltan()).toEqual([]);
  });

  it("los cupones, el acceso y los sorteos siguen como hoy; la venta queda cerrada y el estado lo dice", async () => {
    const m = montarPagos(PILOTO, { sql: sqlQueNoSuma([ORDENES_ANTES], /^ALTER TABLE ordenes ADD COLUMN reemplazada/) });
    expect(m.cfg.faltaAltas).toEqual([]);
    await m.lote([codigo(1)]);
    const ana = m.persona("usr_ana", ANA);
    expect(await m.cupon(ana.token, codigo(1))).toMatchObject({ estado: 200, cuerpo: { ok: true, sorteosSumados: 3 } });
    expect(m.cupos.quedan({ cuenta: ANA }, m.hora()).quedan).toBe(3);
    // Una orden sin pagar de antes: `/estado` lee los pagos sin la columna que falta.
    m.sql.exec("INSERT INTO ordenes (id, usuario, producto, monto, sorteos, dias, creada, vence, pagada, metodo, ref) VALUES ('K7M29QXA', 'usr_ana', 'p10', 50000000, 10, 365, ?, ?, NULL, NULL, NULL)", m.hora(), m.hora() + 3_600_000);
    expect(await m.estado(ana.token)).toMatchObject({ estado: 200, cuerpo: { acceso: "cupon", cuenta: ANA, sorteos: { quedan: 3 }, orden: { id: "K7M29QXA" } } });
    // La venta, cerrada aunque las variables la abran.
    expect(await m.empezar(ana.token, "p10")).toEqual({ estado: 503, cuerpo: { motivo: "compras-cerradas" } });
    expect(await m.cargar(ana.token, "p10")).toEqual({ estado: 503, cuerpo: { motivo: "compras-cerradas" } });
    const beto = m.persona("usr_beto", BETO);
    expect(await m.orden(beto.token, "alta")).toEqual({ estado: 503, cuerpo: { motivo: "pago-apagado" } });
    m.pm.creditos = 1_000_000;
    expect(await m.puerta.cargaAbierta()).toBe(false);
    // El estado lo dice para que la vigilancia avise, y la vigilancia de firmas sigue contestando.
    expect((await m.puerta.resumen()).faltaAltas).toEqual(["columnas-nuevas"]);
    expect(await m.puerta.vigilancia()).toHaveProperty("firmas");
  });

  it("sin la hora del último aviso en las compras, la vigilancia de firmas sigue contando", async () => {
    const sql = sqlQueNoSuma([COMPRAS_ANTES], /^ALTER TABLE compras_qr ADD COLUMN avisada/);
    sql.exec("INSERT INTO compras_qr (usuario, producto, creada, desde, reserva, recargo, primera, nueva, cargada, cerrada, motivo) VALUES ('usr_ana', 'alta', ?, ?, 530, 40000000, 1, 1, ?, NULL, NULL)", Date.UTC(2026, 10, 14, 11), Date.UTC(2026, 10, 14, 11), Date.UTC(2026, 10, 14, 11));
    const m = montarPagos(PILOTO, { sql });
    expect(m.cupos.columnasQueFaltan()).toEqual(["compras_qr.avisada"]);
    const v = (await m.puerta.vigilancia()) as { firmas: { compras: number } };
    expect(v.firmas.compras).toBe(1);
    expect((await m.puerta.resumen()).faltaAltas).toEqual(["columnas-nuevas"]);
  });

  it("el objeto lo anota en el registro al arrancar, y arma la compra con QR sabiendo qué columna falta", () => {
    const index = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
    expect(index).toMatch(/this\.cupos\.columnasQueFaltan\(\)/);
    expect(index).toMatch(/evento: "error-config", faltaAltas: \["columnas-nuevas"\]/);
    expect(index).toMatch(/new ComprasQr\(this\.sql, cfg\);\r?\n.*\r?\n\s*if \(this\.cupos\.faltaColumna\("compras_qr", "avisada"\)\) compras\.sinHoraDeAviso\(\);/);
  });
});
