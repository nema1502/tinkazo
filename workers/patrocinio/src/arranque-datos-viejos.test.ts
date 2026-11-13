import { DatabaseSync } from "node:sqlite";
import { StrKey } from "@stellar/stellar-sdk/base";
import { describe, expect, it } from "vitest";
import { Altas } from "./altas";
import { Cobros } from "./cobros";
import { ComprasQr } from "./compras";
import { DIA_MS, leerConfig } from "./config";
import { Cupos } from "./cupos";
import { sqlDePrueba } from "./sqlite-prueba";

/**
 * El arranque del objeto con el código de la venta sobre los datos del portero de antes (el que está en la red principal
 * desde el 11 de noviembre). El constructor del objeto solo hace `new Cupos(sql)`, que crea las tablas que faltan y suma
 * las columnas nuevas. Si sumar una columna fallara, el objeto sigue y solo la venta queda cerrada
 * (`columnas-fallidas.test.ts`); si fallara crear una tabla, se caería todo el objeto: sellos, sorteos y canjes.
 *
 * Los datos son una exportación SINTÉTICA (la forma de `GET /v1/patrocinio/exportar`) con el esquema anterior, sacado
 * del código de antes de la venta: las mismas tablas sin `compras_qr`, `compras_qr_ordenes` ni `compras_piloto`, y
 * `ordenes` sin la columna `reemplazada`. Cuentas de ejemplo, ninguna persona de verdad.
 */

/** El esquema del portero de antes de la venta, tabla por tabla, como lo creaba su constructor. */
const ESQUEMA_ANTERIOR = [
  "CREATE TABLE uso (hash TEXT PRIMARY KEY, cuenta TEXT NOT NULL, metodo TEXT NOT NULL, mes TEXT NOT NULL, creado INTEGER NOT NULL, estado TEXT NOT NULL, estimado INTEGER NOT NULL, real INTEGER, vence INTEGER NOT NULL)",
  "CREATE INDEX uso_cuenta ON uso (cuenta, creado)",
  "CREATE INDEX uso_creado ON uso (creado)",
  "CREATE TABLE cuentas (cuenta TEXT NOT NULL, mes TEXT NOT NULL, sellos INTEGER NOT NULL DEFAULT 0, sorteos INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (cuenta, mes))",
  "CREATE TABLE reserva (hash TEXT PRIMARY KEY, cuenta TEXT NOT NULL, creado INTEGER NOT NULL, stroops INTEGER NOT NULL, usada TEXT)",
  "CREATE INDEX reserva_creado ON reserva (creado)",
  "CREATE TABLE ajustes (clave TEXT PRIMARY KEY, valor TEXT NOT NULL, cambiado INTEGER NOT NULL)",
  "CREATE TABLE cuenta_app (cuenta TEXT PRIMARY KEY, visto INTEGER NOT NULL, motivo TEXT, permanente INTEGER NOT NULL DEFAULT 0)",
  "CREATE INDEX cuenta_app_visto ON cuenta_app (visto)",
  "CREATE TABLE cupones (huella TEXT PRIMARY KEY, lote TEXT NOT NULL, creado INTEGER NOT NULL, vence INTEGER NOT NULL, usos_max INTEGER NOT NULL DEFAULT 1, usos INTEGER NOT NULL DEFAULT 0, sorteos INTEGER NOT NULL, dias INTEGER NOT NULL, anulado INTEGER NOT NULL DEFAULT 0)",
  "CREATE INDEX cupones_lote ON cupones (lote)",
  "CREATE TABLE canjes (huella TEXT NOT NULL, usuario TEXT NOT NULL, lote TEXT NOT NULL, creado INTEGER NOT NULL, PRIMARY KEY (huella, usuario))",
  "CREATE UNIQUE INDEX canjes_lote_usuario ON canjes (lote, usuario)",
  "CREATE TABLE altas (usuario TEXT PRIMARY KEY, motivo TEXT NOT NULL, ref TEXT NOT NULL, cuenta TEXT, pedido TEXT, estado TEXT NOT NULL, creada INTEGER NOT NULL, actualizada INTEGER NOT NULL)",
  "CREATE UNIQUE INDEX altas_cuenta ON altas (cuenta) WHERE cuenta IS NOT NULL",
  "CREATE TABLE derechos (id INTEGER PRIMARY KEY AUTOINCREMENT, usuario TEXT NOT NULL, cuenta TEXT, origen TEXT NOT NULL, ref TEXT NOT NULL UNIQUE, sorteos INTEGER NOT NULL, usados INTEGER NOT NULL DEFAULT 0, creado INTEGER NOT NULL, vence INTEGER NOT NULL)",
  "CREATE INDEX derechos_cuenta ON derechos (cuenta, vence)",
  "CREATE INDEX derechos_usuario ON derechos (usuario)",
  "CREATE TABLE consumos (hash TEXT NOT NULL, derecho INTEGER NOT NULL, cuantos INTEGER NOT NULL DEFAULT 1, PRIMARY KEY (hash, derecho))",
  "CREATE TABLE sellos_portero (hash TEXT PRIMARY KEY, organizador TEXT NOT NULL, huella_lista TEXT NOT NULL, ronda INTEGER NOT NULL, ms INTEGER NOT NULL)",
  "CREATE INDEX sellos_portero_clave ON sellos_portero (organizador, huella_lista, ronda)",
  "CREATE TABLE ordenes (id TEXT PRIMARY KEY, usuario TEXT NOT NULL, producto TEXT NOT NULL, monto INTEGER NOT NULL, sorteos INTEGER NOT NULL, dias INTEGER NOT NULL, creada INTEGER NOT NULL, vence INTEGER NOT NULL, pagada INTEGER, metodo TEXT, ref TEXT)",
  "CREATE INDEX ordenes_usuario ON ordenes (usuario, producto, pagada)",
  "CREATE TABLE pagos (operacion TEXT PRIMARY KEY, paging_token TEXT NOT NULL, tx TEXT NOT NULL, orden TEXT NOT NULL, de TEXT NOT NULL, monto INTEGER NOT NULL, ms INTEGER NOT NULL)",
  "CREATE INDEX pagos_orden ON pagos (orden)",
  "CREATE TABLE pagos_sueltos (operacion TEXT PRIMARY KEY, tx TEXT NOT NULL, de TEXT NOT NULL, activo TEXT NOT NULL, monto INTEGER NOT NULL, nota TEXT, motivo TEXT NOT NULL, estado TEXT NOT NULL DEFAULT 'suelto', orden TEXT, ref TEXT, ms INTEGER NOT NULL)",
];

/** Cuentas de ejemplo con su suma de control, fijas: la misma prueba da siempre lo mismo. */
const cuentaDeEjemplo = (n: number) => StrKey.encodeEd25519PublicKey(Buffer.alloc(32, n));
const [ANA, BETO, NORA, POLVO] = [1, 2, 3, 4].map(cuentaDeEjemplo) as [string, string, string, string];
const T = Date.UTC(2026, 10, 13, 9, 0, 0);
const hex = (c: string) => c.repeat(64);
const [H_USADO, H_LIBRE, H_OTRO] = [hex("a"), hex("b"), hex("c")];

/** La exportación sintética: la forma de `GET /v1/patrocinio/exportar` del portero de antes. */
const EXPORTACION = {
  exportado: T,
  tablas: {
    uso: [{ hash: hex("1"), cuenta: ANA, metodo: "seal", mes: "2026-11", creado: T - 3_600_000, estado: "ok", estimado: 900_000, real: 824_000, vence: T + 300_000 }],
    cuentas: [{ cuenta: ANA, mes: "2026-11", sellos: 1, sorteos: 0 }],
    reserva: [{ hash: hex("1"), cuenta: ANA, creado: T - 3_600_000, stroops: 1_236_000, usada: null }],
    ajustes: [{ clave: "creditos_ultimo", valor: JSON.stringify({ valor: 9_000, ms: T - 60_000 }), cambiado: T - 60_000 }],
    cuenta_app: [
      { cuenta: ANA, visto: T - 3_600_000, motivo: "alta", permanente: 1 },
      { cuenta: BETO, visto: T - 1_800_000, motivo: "alta", permanente: 1 },
    ],
    cupones: [
      { huella: H_USADO, lote: "evento-14nov", creado: T - DIA_MS, vence: T + 30 * DIA_MS, usos_max: 1, usos: 1, sorteos: 3, dias: 60, anulado: 0 },
      { huella: H_LIBRE, lote: "evento-14nov", creado: T - DIA_MS, vence: T + 30 * DIA_MS, usos_max: 1, usos: 0, sorteos: 3, dias: 60, anulado: 0 },
      { huella: H_OTRO, lote: "otro-lote", creado: T - DIA_MS, vence: T + 30 * DIA_MS, usos_max: 5, usos: 0, sorteos: 2, dias: 60, anulado: 0 },
    ],
    canjes: [{ huella: H_USADO, usuario: "usr_ana", lote: "evento-14nov", creado: T - 7_200_000 }],
    altas: [
      { usuario: "usr_ana", motivo: "cupon", ref: `cupon:${H_USADO}`, cuenta: ANA, pedido: null, estado: "abierta", creada: T - 7_200_000, actualizada: T - 3_600_000 },
      { usuario: "usr_beto", motivo: "pago", ref: "orden:ABCD2345", cuenta: BETO, pedido: null, estado: "abierta", creada: T - 1_800_000, actualizada: T - 1_800_000 },
    ],
    derechos: [
      { id: 1, usuario: "usr_ana", cuenta: ANA, origen: "cupon", ref: `cupon:${H_USADO}:usr_ana`, sorteos: 3, usados: 1, creado: T - 7_200_000, vence: T + 60 * DIA_MS },
      { id: 2, usuario: "usr_beto", cuenta: BETO, origen: "pago", ref: "orden:ABCD2345", sorteos: 3, usados: 0, creado: T - 1_800_000, vence: T + 90 * DIA_MS },
    ],
    consumos: [{ hash: hex("1"), derecho: 1, cuantos: 1 }],
    sellos_portero: [{ hash: hex("1"), organizador: ANA, huella_lista: hex("d"), ronda: 5_000_000, ms: T - 3_600_000 }],
    ordenes: [
      { id: "ABCD2345", usuario: "usr_beto", producto: "alta", monto: 40_000_000, sorteos: 3, dias: 90, creada: T - 2_000_000, vence: T - 2_000_000 + 1_800_000, pagada: T - 1_800_000, metodo: "horizon", ref: "usdc:op-1" },
      { id: "K7M29QXA", usuario: "usr_nora", producto: "alta", monto: 40_000_000, sorteos: 3, dias: 90, creada: T - 600_000, vence: T + 1_200_000, pagada: null, metodo: null, ref: null },
    ],
    pagos: [{ operacion: "op-1", paging_token: "1001", tx: hex("e"), orden: "ABCD2345", de: BETO, monto: 40_000_000, ms: T - 1_800_000 }],
    pagos_sueltos: [{ operacion: "op-2", tx: hex("f"), de: POLVO, activo: "native", monto: 1_000, nota: null, motivo: "otro-activo", estado: "suelto", orden: null, ref: null, ms: T - 900_000 }],
  } as Record<string, Array<Record<string, unknown>>>,
};

/** Un SQLite con el esquema de antes y la exportación cargada, como el objeto desplegado hoy. */
function objetoDeAntes(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  for (const q of ESQUEMA_ANTERIOR) db.exec(q);
  for (const [tabla, filas] of Object.entries(EXPORTACION.tablas)) {
    for (const f of filas) {
      const columnas = Object.keys(f);
      db.prepare(`INSERT INTO ${tabla} (${columnas.join(", ")}) VALUES (${columnas.map(() => "?").join(", ")})`).run(...(Object.values(f) as never[]));
    }
  }
  return db;
}

const columnas = (db: DatabaseSync, tabla: string) => (db.prepare(`PRAGMA table_info(${tabla})`).all() as Array<{ name: string }>).map((c) => c.name);

describe("el arranque del objeto con la venta, sobre los datos del portero de antes", () => {
  it("la exportación sintética tiene el esquema de antes: sin las tablas de la compra ni la columna de los reemplazos", () => {
    const db = objetoDeAntes();
    const tablas = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map((t) => t.name);
    for (const nueva of ["compras_qr", "compras_qr_ordenes", "compras_piloto"]) expect(tablas).not.toContain(nueva);
    expect(columnas(db, "ordenes")).not.toContain("reemplazada");
  });

  it("el constructor suma lo nuevo sin tocar una fila: cada tabla de antes sale igual en la exportación nueva", () => {
    const db = objetoDeAntes();
    const cupos = new Cupos(sqlDePrueba(db));
    const despues = cupos.exportar(true);
    for (const [tabla, filas] of Object.entries(EXPORTACION.tablas)) {
      const esperadas = tabla === "ordenes" ? filas.map((f) => ({ ...f, reemplazada: null })) : filas;
      expect(despues[tabla], tabla).toEqual(esperadas);
    }
    // Lo nuevo: las tres tablas, vacías, y las columnas que suman las compras y los reemplazos.
    for (const nueva of ["compras_qr", "compras_qr_ordenes", "compras_piloto", "compras_anulaciones"]) expect(despues[nueva], nueva).toEqual([]);
    expect(columnas(db, "ordenes")).toContain("reemplazada");
    expect(columnas(db, "compras_qr")).toContain("avisada");
  });

  it("arrancar dos veces (un reinicio del objeto) no cambia nada ni falla", () => {
    const db = objetoDeAntes();
    const sql = sqlDePrueba(db);
    const primera = new Cupos(sql).exportar(true);
    expect(new Cupos(sql).exportar(true)).toEqual(primera);
  });

  it("los accesos siguen: el alta, la cuenta en el libro y los sorteos que quedan", () => {
    const cupos = new Cupos(sqlDePrueba(objetoDeAntes()));
    expect(cupos.altaDe("usr_ana")).toMatchObject({ motivo: "cupon", cuenta: ANA, estado: "abierta" });
    expect(cupos.altaDe("usr_beto")).toMatchObject({ motivo: "pago", cuenta: BETO });
    expect(cupos.estaEnElLibro(ANA)).toBe(true);
    expect(cupos.estaEnElLibro(BETO)).toBe(true);
    expect(cupos.quedan({ cuenta: ANA }, T).quedan).toBe(2);
    expect(cupos.quedan({ cuenta: BETO }, T).quedan).toBe(3);
    // El piso: los cinco sorteos prometidos sin usar, sin altas por activar.
    expect(cupos.prometido(T)).toEqual({ sorteos: 5, altas: 0 });
  });

  it("los cupones siguen: el canjeado es el mismo, el libre se canjea una vez y el usado no se vuelve a usar", () => {
    const sql = sqlDePrueba(objetoDeAntes());
    const cupos = new Cupos(sql);
    const altas = new Altas(sql, cupos);
    expect(altas.canjear({ huella: H_USADO, usuario: "usr_ana", cuenta: ANA }, T)).toMatchObject({ ok: true, repetido: true, sorteosSumados: 0 });
    expect(altas.canjear({ huella: H_USADO, usuario: "usr_nora", cuenta: NORA }, T)).toEqual({ ok: false, motivo: "cupon-usado" });
    expect(altas.canjear({ huella: H_LIBRE, usuario: "usr_nora", cuenta: NORA }, T)).toMatchObject({ ok: true, repetido: false, sorteosSumados: 3, altaNueva: true });
    expect(altas.canjear({ huella: H_OTRO, usuario: "usr_ana", cuenta: ANA }, T)).toMatchObject({ ok: true, repetido: false, sorteosSumados: 2, altaNueva: false });
    expect(cupos.quedan({ cuenta: ANA }, T).quedan).toBe(4);
    expect(cupos.estaEnElLibro(NORA)).toBe(true);
  });

  it("las órdenes y la compra con QR leen bien lo de antes: la orden abierta sigue abierta y no hay nada reservado", () => {
    const sql = sqlDePrueba(objetoDeAntes());
    const cupos = new Cupos(sql);
    const cobros = new Cobros(sql, cupos);
    expect(cobros.ordenAbierta("usr_nora", T)?.id).toBe("K7M29QXA");
    expect(cobros.ordenAbierta("usr_beto", T)).toBeNull();
    const compras = new ComprasQr(sql, leerConfig({ RED: "mainnet", ALTAS: "1", POLLAR_APP_ID: "app" }));
    expect(compras.reservas(T)).toBe(0);
    expect(compras.tuvo("usr_ana")).toBe(false);
    expect(compras.firmas(T - DIA_MS)).toEqual({ compras: 0, pagosConSaldo: 1 });
  });
});
