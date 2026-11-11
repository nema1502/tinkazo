import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { DIA_MS } from "./config";
import { Cupos } from "./cupos";
import { sqlDePrueba } from "./sqlite-prueba";

const CUENTA = "GCUENTAUNO";
const OTRA = "GCUENTADOS";
const T0 = Date.UTC(2026, 10, 14, 12, 0, 0);

const nuevo = () => {
  const sql = sqlDePrueba();
  return { sql, c: new Cupos(sql) };
};
const fila = (sql: ReturnType<typeof sqlDePrueba>, cuenta: string) => sql.exec("SELECT * FROM cuenta_app WHERE cuenta = ?", cuenta).toArray()[0];

describe("el libro de cuentas", () => {
  it("una admitida está en el libro; una solo vista, no", () => {
    const { c, sql } = nuevo();
    c.recordarCuenta(OTRA, T0);
    c.admitir(CUENTA, "cupon", T0);
    expect(c.estaEnElLibro(CUENTA)).toBe(true);
    expect(c.estaEnElLibro(OTRA)).toBe(false);
    expect(c.cuentaConocida(OTRA)).toBe(true);
    expect(fila(sql, CUENTA)).toMatchObject({ cuenta: CUENTA, motivo: "cupon", permanente: 1, visto: T0 });
    expect(fila(sql, OTRA)).toMatchObject({ motivo: null, permanente: 0 });
  });

  it("una admitida no se purga a los 401 días; una solo vista sí, como hoy", () => {
    const { c } = nuevo();
    c.admitir(CUENTA, "pago", T0);
    c.recordarCuenta(OTRA, T0);
    c.purgar(T0 + 401 * DIA_MS);
    expect(c.estaEnElLibro(CUENTA)).toBe(true);
    expect(c.cuentaConocida(CUENTA)).toBe(true);
    expect(c.cuentaConocida(OTRA)).toBe(false);
  });

  it("volver a verla no la saca del libro, y admitirla otra vez guarda el primer motivo", () => {
    const { c, sql } = nuevo();
    c.admitir(CUENTA, "cupon", T0);
    c.recordarCuenta(CUENTA, T0 + 1000);
    expect(c.estaEnElLibro(CUENTA)).toBe(true);
    c.admitir(CUENTA, "admin", T0 + 2000);
    expect(fila(sql, CUENTA)).toMatchObject({ motivo: "cupon", permanente: 1, visto: T0 + 2000 });
    c.purgar(T0 + 2000 + 401 * DIA_MS);
    expect(c.estaEnElLibro(CUENTA)).toBe(true);
  });

  it("una vista antes y admitida después entra al libro", () => {
    const { c } = nuevo();
    c.recordarCuenta(CUENTA, T0);
    expect(c.estaEnElLibro(CUENTA)).toBe(false);
    c.admitir(CUENTA, "admin", T0 + 1);
    expect(c.estaEnElLibro(CUENTA)).toBe(true);
  });

  it("un motivo que no es cupón, pago ni admin no se escribe", () => {
    const { c } = nuevo();
    expect(() => c.admitir(CUENTA, "regalo" as never, T0)).toThrow();
    expect(c.estaEnElLibro(CUENTA)).toBe(false);
  });
});

describe("las tablas y los ALTER", () => {
  const TABLAS = ["altas", "canjes", "consumos", "cupones", "derechos", "ordenes", "pagos", "pagos_sueltos", "sellos_portero"];

  it("están las tablas del modelo de datos", () => {
    const { sql } = nuevo();
    const hay = sql.exec("SELECT name FROM sqlite_master WHERE type = 'table'").toArray().map((f) => String(f.name));
    for (const t of TABLAS) expect(hay, t).toContain(t);
    const columnas = sql.exec("PRAGMA table_info(cuenta_app)").toArray().map((f) => String(f.name));
    expect(columnas).toEqual(["cuenta", "visto", "motivo", "permanente"]);
  });

  it("los ALTER corren dos veces sin romper, y una base vieja conserva sus cuentas fuera del libro", () => {
    const db = new DatabaseSync(":memory:");
    // La base de hoy: cuenta_app sin las columnas nuevas y con una cuenta vista.
    db.exec("CREATE TABLE cuenta_app (cuenta TEXT PRIMARY KEY, visto INTEGER NOT NULL)");
    db.prepare("INSERT INTO cuenta_app (cuenta, visto) VALUES (?, ?)").run(CUENTA, T0);
    const sql = sqlDePrueba(db);
    const c = new Cupos(sql);
    expect(c.cuentaConocida(CUENTA)).toBe(true);
    expect(c.estaEnElLibro(CUENTA)).toBe(false);
    expect(fila(sql, CUENTA)).toMatchObject({ visto: T0, motivo: null, permanente: 0 });
    c.admitir(OTRA, "cupon", T0);
    const otraVez = new Cupos(sql);
    const yOtra = new Cupos(sql);
    expect(otraVez.estaEnElLibro(OTRA)).toBe(true);
    expect(yOtra.cuentaConocida(CUENTA)).toBe(true);
    expect(sql.exec("PRAGMA table_info(cuenta_app)").toArray()).toHaveLength(4);
  });

  it("los índices únicos del modelo valen: un canje por lote y persona, un alta por cuenta", () => {
    const { sql } = nuevo();
    sql.exec("INSERT INTO canjes (huella, usuario, lote, creado) VALUES ('h1', 'u1', 'lote', 1)");
    expect(() => sql.exec("INSERT INTO canjes (huella, usuario, lote, creado) VALUES ('h2', 'u1', 'lote', 2)")).toThrow();
    sql.exec("INSERT INTO altas (usuario, motivo, ref, cuenta, estado, creada, actualizada) VALUES ('u1', 'cupon', 'r1', 'G1', 'autorizada', 1, 1)");
    sql.exec("INSERT INTO altas (usuario, motivo, ref, cuenta, estado, creada, actualizada) VALUES ('u2', 'cupon', 'r2', NULL, 'autorizada', 1, 1)");
    sql.exec("INSERT INTO altas (usuario, motivo, ref, cuenta, estado, creada, actualizada) VALUES ('u3', 'cupon', 'r3', NULL, 'autorizada', 1, 1)");
    expect(() => sql.exec("INSERT INTO altas (usuario, motivo, ref, cuenta, estado, creada, actualizada) VALUES ('u4', 'cupon', 'r4', 'G1', 'autorizada', 1, 1)")).toThrow();
    sql.exec("INSERT INTO derechos (usuario, origen, ref, sorteos, creado, vence) VALUES ('u1', 'cupon', 'cupon:h1:u1', 3, 1, 2)");
    expect(() => sql.exec("INSERT INTO derechos (usuario, origen, ref, sorteos, creado, vence) VALUES ('u1', 'cupon', 'cupon:h1:u1', 3, 1, 2)")).toThrow();
  });
});

describe("transaccion", () => {
  it("lo que sale bien queda escrito y devuelve lo que devuelve la función", () => {
    const { c } = nuevo();
    expect(c.transaccion(() => (c.admitir(CUENTA, "cupon", T0), 7))).toBe(7);
    expect(c.estaEnElLibro(CUENTA)).toBe(true);
  });

  it("si algo falla en el medio, no queda nada escrito", () => {
    const { c } = nuevo();
    expect(() =>
      c.transaccion(() => {
        c.admitir(CUENTA, "cupon", T0);
        c.fijarAjuste("altas_pausadas", "1", T0);
        throw new Error("a mitad de camino");
      }),
    ).toThrow("a mitad de camino");
    expect(c.estaEnElLibro(CUENTA)).toBe(false);
    expect(c.ajuste("altas_pausadas")).toBeUndefined();
  });

  it("una adentro de otra: si falla la de afuera, se deshace también lo de adentro", () => {
    const { c } = nuevo();
    c.transaccion(() => c.transaccion(() => c.admitir(OTRA, "pago", T0)));
    expect(c.estaEnElLibro(OTRA)).toBe(true);
    expect(() =>
      c.transaccion(() => {
        c.transaccion(() => c.admitir(CUENTA, "pago", T0));
        throw new Error("afuera");
      }),
    ).toThrow("afuera");
    expect(c.estaEnElLibro(CUENTA)).toBe(false);
    expect(c.estaEnElLibro(OTRA)).toBe(true);
  });
});
