import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { MAX_EQUIPOS } from "../../workers/sala/src/logica";
import {
  ALTAS_POR_CONEXION,
  ENVIOS_POR_CONEXION,
  ES_LLAVE,
  VENTANA_EQUIPOS_MS,
  anotarEquipo,
  crearTablasDeEquipos,
  quitarEquipo,
  type AltaDeEquipo,
  type Ejecutar,
  type ValorSql,
} from "../../workers/sala/src/registro";

/**
 * El registro de equipos del Worker de la sala (`workers/sala/src/registro.ts`) con un SQLite de verdad: una cuenta
 * anotada solo la reescribe el celular que la anotó, y una sola conexión no llena el registro.
 */

function nuevaSala(): { sql: Ejecutar; db: DatabaseSync } {
  const db = new DatabaseSync(":memory:");
  const sql: Ejecutar = <T,>(consulta: string, ...p: ValorSql[]): T[] => db.prepare(consulta).all(...p) as unknown as T[];
  crearTablasDeEquipos(sql);
  return { sql, db };
}

const llaveNueva = (): string => Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("base64url");
const huella = (s: string): string => createHash("sha256").update(s).digest("hex");
/** Una cuenta distinta por número. El registro no revisa la forma de la cuenta: eso lo hace el Worker antes. */
const cuentaN = (i: number): string => `G${String(i).padStart(55, "B")}`;
const D = (marca: string): string => Buffer.from(`equipo cifrado de prueba: ${marca}`.padEnd(40, ".")).toString("base64url");
/** Una hora fija al principio de una ventana, para que las cuentas no dependan del reloj. */
const T0 = 1_000 * VENTANA_EQUIPOS_MS;
const siempre = (): boolean => true;

function alta(o: Partial<AltaDeEquipo> = {}): AltaDeEquipo {
  return { cuenta: cuentaN(1), d: D("a"), llave: "", ip: "200.87.1.10", ahora: T0, modo: "sorteo", ...o };
}

const fila = (sql: Ejecutar, cuenta: string) => sql<{ n: number; d: string; estado: string; v: number; llave: string }>("SELECT n, d, estado, v, llave FROM equipos WHERE cuenta = ?", cuenta)[0];

describe("una cuenta anotada es del celular que la anotó", () => {
  it("la primera alta guarda la huella de la llave, nunca la llave", async () => {
    const { sql } = nuevaSala();
    const llave = llaveNueva();
    const r = await anotarEquipo(sql, alta({ llave }), siempre);
    expect(r).toMatchObject({ ok: true, estado: "solicitud" });
    const f = fila(sql, cuentaN(1));
    expect(f?.llave).toBe(huella(llave));
    expect(JSON.stringify(sql("SELECT * FROM equipos"))).not.toContain(llave);
    const enCupon = await anotarEquipo(sql, alta({ cuenta: cuentaN(2), llave: llaveNueva(), modo: "cupon" }), siempre);
    expect(enCupon).toMatchObject({ ok: true, estado: "aceptado" });
  });

  it("con la misma llave cambia los datos y conserva el número y el estado", async () => {
    const { sql } = nuevaSala();
    const llave = llaveNueva();
    const a = await anotarEquipo(sql, alta({ llave, d: D("primero") }), siempre);
    sql("UPDATE equipos SET estado = 'aceptado'");
    const b = await anotarEquipo(sql, alta({ llave, d: D("corregido") }), siempre);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(b.n).toBe(a.n);
    expect(b.estado).toBe("aceptado");
    expect(b.v).toBeGreaterThan(a.v);
    expect(fila(sql, cuentaN(1))?.d).toBe(D("corregido"));
    expect(sql<{ c: number }>("SELECT COUNT(*) AS c FROM equipos")[0]?.c).toBe(1);
  });

  it("con otra llave se rechaza y el registro que estaba queda intacto", async () => {
    const { sql } = nuevaSala();
    await anotarEquipo(sql, alta({ llave: llaveNueva(), d: D("de verdad") }), siempre);
    const antes = fila(sql, cuentaN(1));
    // Desde otra conexión, con la dirección pública de la víctima y datos que la pantalla no puede descifrar.
    const r = await anotarEquipo(sql, alta({ llave: llaveNueva(), d: D("pisado"), ip: "181.115.9.9" }), siempre);
    expect(r).toEqual({ ok: false, motivo: "ajena" });
    expect(fila(sql, cuentaN(1))).toEqual(antes);
  });

  it("sin llave, o con una que no es, no se anota nada", async () => {
    const { sql } = nuevaSala();
    for (const llave of ["", "corta", "x".repeat(21), "con espacios y otras cosas que no son!!", "y".repeat(65)]) {
      expect(ES_LLAVE.test(llave)).toBe(false);
      await expect(anotarEquipo(sql, alta({ llave }), siempre)).rejects.toThrow();
    }
    expect(sql("SELECT * FROM equipos")).toEqual([]);
    expect(ES_LLAVE.test(llaveNueva())).toBe(true);
  });

  it("quitarlo con el token de quien organiza libera la cuenta para anotarse desde otro celular", async () => {
    const { sql } = nuevaSala();
    const a = await anotarEquipo(sql, alta({ llave: llaveNueva() }), siempre);
    if (!a.ok) throw new Error("no se anotó");
    const otra = llaveNueva();
    expect(await anotarEquipo(sql, alta({ llave: otra }), siempre)).toMatchObject({ ok: false, motivo: "ajena" });
    quitarEquipo(sql, a.n);
    const b = await anotarEquipo(sql, alta({ llave: otra, d: D("celular nuevo") }), siempre);
    expect(b).toMatchObject({ ok: true });
    expect(fila(sql, cuentaN(1))?.llave).toBe(huella(otra));
  });
});

describe("el tope por conexión", () => {
  it("40 equipos detrás de una sola dirección se anotan y corrigen tres veces cada uno en diez minutos", async () => {
    const { sql } = nuevaSala();
    const llaves = Array.from({ length: 40 }, llaveNueva);
    const paso = (VENTANA_EQUIPOS_MS - 1) / 160;
    let k = 0;
    for (let vuelta = 0; vuelta < 4; vuelta++) {
      for (let i = 0; i < 40; i++) {
        const r = await anotarEquipo(sql, alta({ cuenta: cuentaN(i), llave: llaves[i] as string, d: D(`${i}-${vuelta}`), ahora: T0 + k++ * paso }), siempre);
        expect(r.ok, `equipo ${i}, vuelta ${vuelta}`).toBe(true);
      }
    }
    expect(sql<{ c: number }>("SELECT COUNT(*) AS c FROM equipos")[0]?.c).toBe(40);
  });

  it("una sola conexión no llena los 200 lugares en dos minutos, ni cruzando el cambio de ventana", async () => {
    const { sql } = nuevaSala();
    const desde = T0 + VENTANA_EQUIPOS_MS - 60_000;
    let entraron = 0;
    let frenadas = 0;
    for (let i = 0; i < MAX_EQUIPOS; i++) {
      const r = await anotarEquipo(sql, alta({ cuenta: cuentaN(i), llave: llaveNueva(), ahora: desde + i * (120_000 / MAX_EQUIPOS) }), siempre);
      if (r.ok) entraron++;
      else if (r.motivo === "cupo-conexion") {
        frenadas++;
        expect(r.esperaS).toBeGreaterThan(0);
        expect(r.esperaS).toBeLessThanOrEqual(VENTANA_EQUIPOS_MS / 1000);
      }
    }
    expect(entraron).toBe(2 * ALTAS_POR_CONEXION);
    expect(entraron).toBeLessThan(MAX_EQUIPOS);
    expect(frenadas).toBe(MAX_EQUIPOS - entraron);
  });

  it("frenada una conexión, otra sigue anotándose; y en la ventana siguiente la primera vuelve", async () => {
    const { sql } = nuevaSala();
    for (let i = 0; i < ALTAS_POR_CONEXION; i++) expect((await anotarEquipo(sql, alta({ cuenta: cuentaN(i), llave: llaveNueva() }), siempre)).ok).toBe(true);
    expect(await anotarEquipo(sql, alta({ cuenta: cuentaN(500), llave: llaveNueva() }), siempre)).toMatchObject({ ok: false, motivo: "cupo-conexion", esperaS: VENTANA_EQUIPOS_MS / 1000 });
    expect((await anotarEquipo(sql, alta({ cuenta: cuentaN(500), llave: llaveNueva(), ip: "181.115.9.9" }), siempre)).ok).toBe(true);
    expect((await anotarEquipo(sql, alta({ cuenta: cuentaN(501), llave: llaveNueva(), ahora: T0 + VENTANA_EQUIPOS_MS }), siempre)).ok).toBe(true);
  });

  it("frenada en altas nuevas, la conexión todavía corrige a sus equipos", async () => {
    const { sql } = nuevaSala();
    const llave = llaveNueva();
    await anotarEquipo(sql, alta({ cuenta: cuentaN(0), llave }), siempre);
    for (let i = 1; i < ALTAS_POR_CONEXION; i++) await anotarEquipo(sql, alta({ cuenta: cuentaN(i), llave: llaveNueva() }), siempre);
    expect((await anotarEquipo(sql, alta({ cuenta: cuentaN(999), llave: llaveNueva() }), siempre)).ok).toBe(false);
    expect(await anotarEquipo(sql, alta({ cuenta: cuentaN(0), llave, d: D("corrige") }), siempre)).toMatchObject({ ok: true });
  });

  it("los envíos también tienen tope, y frenada la conexión no gasta el tope por minuto de la sala", async () => {
    const { sql } = nuevaSala();
    const llave = llaveNueva();
    let consultas = 0;
    const porMinuto = (): boolean => {
      consultas++;
      return true;
    };
    for (let i = 0; i < ENVIOS_POR_CONEXION; i++) expect((await anotarEquipo(sql, alta({ llave }), porMinuto)).ok).toBe(true);
    const r = await anotarEquipo(sql, alta({ llave }), porMinuto);
    expect(r).toMatchObject({ ok: false, motivo: "cupo-conexion" });
    expect(consultas).toBe(ENVIOS_POR_CONEXION);
  });

  it("los intentos de pisar una cuenta ajena cuentan como envíos de quien los hace", async () => {
    const { sql } = nuevaSala();
    await anotarEquipo(sql, alta({ llave: llaveNueva(), ip: "200.87.1.10" }), siempre);
    for (let i = 0; i < ENVIOS_POR_CONEXION; i++) await anotarEquipo(sql, alta({ llave: llaveNueva(), ip: "181.115.9.9" }), siempre);
    expect(await anotarEquipo(sql, alta({ llave: llaveNueva(), ip: "181.115.9.9" }), siempre)).toMatchObject({ motivo: "cupo-conexion" });
  });

  it("en IPv6 cuenta el bloque /64, y lo que se guarda no es la dirección", async () => {
    const { sql } = nuevaSala();
    for (let i = 0; i < ALTAS_POR_CONEXION; i++) await anotarEquipo(sql, alta({ cuenta: cuentaN(i), llave: llaveNueva(), ip: `2800:cd0:1:2::${(i + 1).toString(16)}` }), siempre);
    expect(await anotarEquipo(sql, alta({ cuenta: cuentaN(900), llave: llaveNueva(), ip: "2800:cd0:1:2:ffff::1" }), siempre)).toMatchObject({ motivo: "cupo-conexion" });
    const guardado = JSON.stringify([sql("SELECT * FROM ritmo"), sql("SELECT * FROM sala"), sql("SELECT * FROM equipos")]);
    expect(guardado).not.toMatch(/2800:cd0|200\.87\./);
  });

  it("las ventanas que pasaron se olvidan", async () => {
    const { sql } = nuevaSala();
    await anotarEquipo(sql, alta({ llave: llaveNueva() }), siempre);
    await anotarEquipo(sql, alta({ cuenta: cuentaN(2), llave: llaveNueva(), ahora: T0 + 3 * VENTANA_EQUIPOS_MS }), siempre);
    expect(sql<{ ventana: number }>("SELECT ventana FROM ritmo").map((x) => x.ventana)).toEqual([T0 / VENTANA_EQUIPOS_MS + 3]);
  });

  it("el registro lleno sigue diciendo que está lleno", async () => {
    const { sql } = nuevaSala();
    for (let i = 0; i < MAX_EQUIPOS; i++) await anotarEquipo(sql, alta({ cuenta: cuentaN(i), llave: llaveNueva(), ip: `10.0.${i}.1` }), siempre);
    expect(await anotarEquipo(sql, alta({ cuenta: cuentaN(9999), llave: llaveNueva(), ip: "10.9.9.9" }), siempre)).toEqual({ ok: false, motivo: "llena" });
  });
});
