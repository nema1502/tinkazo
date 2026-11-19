import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import {
  VENTANA_CAMPANA_MS,
  anotarPersona,
  avisarGanadora,
  crearTablasDeCampana,
  estadoDeCelular,
  quitarPersona,
  quitadasPorMotivo,
  type AltaDePersona,
} from "../../workers/sala/src/campana";
import type { Ejecutar, ValorSql } from "../../workers/sala/src/registro";

/** Las salidas y los avisos contra un SQLite de verdad, sin llamadas al proveedor. */
function nuevaSala(): { sql: Ejecutar; db: DatabaseSync } {
  const db = new DatabaseSync(":memory:");
  const sql: Ejecutar = <T,>(consulta: string, ...p: ValorSql[]): T[] => {
    return db.prepare(consulta).all(...p) as unknown as T[];
  };
  crearTablasDeCampana(sql);
  sql("INSERT INTO sala (k, v) VALUES ('fase', 'abierta'), ('cierra', ?)", String(CIERRA));
  return { sql, db };
}

const T0 = 1_000 * VENTANA_CAMPANA_MS;
const CIERRA = T0 + 3_600_000;
const huella = (s: string): string => createHash("sha256").update(s).digest("hex");
const cuentaN = (i: number): string => `G${String(i).padStart(55, "B")}`;
const siempre = (): boolean => true;

function alta(o: Partial<AltaDePersona> = {}): AltaDePersona {
  return {
    persona: huella("persona-1"),
    cuenta: cuentaN(1),
    d: "datos-cifrados-de-prueba",
    llave: huella("llave-1"),
    grupo: "conexion-1",
    ahora: T0,
    via: "google",
    ...o,
  };
}

function anotarVarias(sql: Ejecutar, cantidad: number): void {
  for (let i = 1; i <= cantidad; i++) {
    const entrada = alta({
      persona: huella(`persona-${i}`),
      cuenta: cuentaN(i),
      llave: huella(`llave-${i}`),
    });
    expect(anotarPersona(sql, entrada, siempre).ok).toBe(true);
  }
}

function faseSorteada(sql: Ejecutar, ganadoras: string[]): void {
  sql("UPDATE sala SET v = 'sorteada' WHERE k = 'fase'");
  sql("INSERT INTO sala (k, v) VALUES ('ganadoras', ?)", JSON.stringify(ganadoras));
}

const total = (sql: Ejecutar, tabla: string): number => {
  return sql<{ c: number }>(`SELECT COUNT(*) AS c FROM ${tabla}`)[0]?.c ?? 0;
};

describe("quitar personas de una campaña", () => {
  it("quita a la persona de equipos y personas, y guarda su salida con el motivo", () => {
    const { sql } = nuevaSala();
    anotarPersona(sql, alta(), siempre);
    expect(quitarPersona(sql, 1, "repetida")).toEqual({ ok: true, cuenta: cuentaN(1) });
    expect(total(sql, "equipos")).toBe(0);
    expect(total(sql, "personas")).toBe(0);
    expect(sql("SELECT cuenta, persona, llave, motivo FROM campana_quitadas")).toEqual([
      {
        cuenta: cuentaN(1),
        persona: huella("persona-1"),
        llave: huella("llave-1"),
        motivo: "repetida",
      },
    ]);
  });

  it("no deja volver a la persona con otra cuenta ni a otra persona con la misma cuenta", () => {
    const { sql } = nuevaSala();
    anotarPersona(sql, alta(), siempre);
    quitarPersona(sql, 1, "repetida");
    const otraCuenta = alta({ cuenta: cuentaN(2), llave: huella("llave-2") });
    expect(anotarPersona(sql, otraCuenta, siempre)).toEqual({ ok: false, motivo: "quitada" });
    const otraPersona = alta({ persona: huella("persona-2"), llave: huella("llave-2") });
    expect(anotarPersona(sql, otraPersona, siempre)).toEqual({ ok: false, motivo: "quitada" });
    expect(total(sql, "equipos")).toBe(0);
  });

  it("con la fase sellada da fase y deja la lista igual", () => {
    const { sql } = nuevaSala();
    anotarPersona(sql, alta(), siempre);
    sql("UPDATE sala SET v = 'sellada' WHERE k = 'fase'");
    const equipos = sql("SELECT * FROM equipos");
    const personas = sql("SELECT * FROM personas");
    expect(quitarPersona(sql, 1, "otro")).toEqual({ ok: false, motivo: "fase" });
    expect(sql("SELECT * FROM equipos")).toEqual(equipos);
    expect(sql("SELECT * FROM personas")).toEqual(personas);
    expect(total(sql, "campana_quitadas")).toBe(0);
  });

  it("con un número que no está da no-esta", () => {
    const { sql } = nuevaSala();
    expect(quitarPersona(sql, 9, "otro")).toEqual({ ok: false, motivo: "no-esta" });
  });

  it("cuenta las salidas por motivo sin incluir ninguna cuenta", () => {
    const { sql } = nuevaSala();
    anotarVarias(sql, 4);
    quitarPersona(sql, 1, "repetida");
    quitarPersona(sql, 2, "repetida");
    quitarPersona(sql, 3, "evento");
    quitarPersona(sql, 4, "pidio");
    const conteo = quitadasPorMotivo(sql);
    expect(conteo).toEqual({ repetida: 2, evento: 1, pidio: 1, otro: 0 });
    expect(Object.values(conteo).every((n) => typeof n === "number")).toBe(true);
    expect(JSON.stringify(conteo)).not.toContain(cuentaN(1));
  });

  it("el celular quitado ve su motivo solo con su llave y ya no figura anotado", () => {
    const { sql } = nuevaSala();
    anotarPersona(sql, alta(), siempre);
    quitarPersona(sql, 1, "evento");
    expect(estadoDeCelular(sql, cuentaN(1), huella("llave-1"))).toEqual({
      fase: "abierta",
      total: 0,
      cierraMs: CIERRA,
      anotada: false,
      quitada: "evento",
    });
    expect(estadoDeCelular(sql, cuentaN(1), huella("llave-2"))).toEqual({
      fase: "abierta",
      total: 0,
      cierraMs: CIERRA,
      anotada: false,
    });
  });
});

describe("el resultado y los avisos en el celular", () => {
  it("antes de sorteada no dice que ganó aunque la clave ganadoras ya esté escrita", () => {
    const { sql } = nuevaSala();
    anotarPersona(sql, alta(), siempre);
    sql("INSERT INTO sala (k, v) VALUES ('ganadoras', ?)", JSON.stringify([cuentaN(1)]));
    const estado = estadoDeCelular(sql, cuentaN(1), huella("llave-1"));
    expect(estado).toEqual({ fase: "abierta", total: 1, cierraMs: CIERRA, anotada: true });
    expect(estado).not.toHaveProperty("gano");
    expect(estado).not.toHaveProperty("puesto");
  });

  it("con la fase sorteada distingue a quien ganó y a otra cuenta anotada", () => {
    const { sql } = nuevaSala();
    anotarVarias(sql, 2);
    faseSorteada(sql, [cuentaN(1)]);
    expect(estadoDeCelular(sql, cuentaN(1), huella("llave-1"))).toEqual({
      fase: "sorteada",
      total: 2,
      cierraMs: CIERRA,
      anotada: true,
      gano: true,
      puesto: 0,
    });
    expect(estadoDeCelular(sql, cuentaN(2), huella("llave-2"))).toEqual({
      fase: "sorteada",
      total: 2,
      cierraMs: CIERRA,
      anotada: true,
      gano: false,
    });
  });

  it("avisar da no-gano a otra cuenta y después la ganadora ve avisado", () => {
    const { sql } = nuevaSala();
    anotarVarias(sql, 2);
    faseSorteada(sql, [cuentaN(1)]);
    expect(avisarGanadora(sql, cuentaN(2))).toEqual({ ok: false, motivo: "no-gano" });
    expect(avisarGanadora(sql, cuentaN(1))).toEqual({ ok: true });
    expect(estadoDeCelular(sql, cuentaN(1), huella("llave-1"))).toEqual({
      fase: "sorteada",
      total: 2,
      cierraMs: CIERRA,
      anotada: true,
      gano: true,
      puesto: 0,
      avisado: true,
    });
  });

  it("avisar dos veces a la misma ganadora da ok y deja una sola fila", () => {
    const { sql } = nuevaSala();
    anotarPersona(sql, alta(), siempre);
    faseSorteada(sql, [cuentaN(1)]);
    expect(avisarGanadora(sql, cuentaN(1))).toEqual({ ok: true });
    expect(avisarGanadora(sql, cuentaN(1))).toEqual({ ok: true });
    expect(total(sql, "campana_avisos")).toBe(1);
  });
});
