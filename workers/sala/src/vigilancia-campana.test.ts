import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { crearTablasDeCampana } from "./campana";
import type { Ejecutar, ValorSql } from "./registro";
import { activacionesDeCampana, anotarAltaDeCampana, crearTablasDeVigilancia } from "./vigilancia-campana";

/** El SQLite de una sala de campaña, con sus tablas de siempre y las de la vigilancia. */
function nuevaSala(): { sql: Ejecutar } {
  const db = new DatabaseSync(":memory:");
  const sql: Ejecutar = <T,>(consulta: string, ...p: ValorSql[]): T[] => {
    return db.prepare(consulta).all(...p) as unknown as T[];
  };
  crearTablasDeCampana(sql);
  return { sql };
}

describe("la vigilancia de las altas de campaña (issue #168)", () => {
  it("cuenta las altas nuevas de cada día y las lee como cifras", () => {
    const { sql } = nuevaSala();
    anotarAltaDeCampana(sql, "2026-11-21");
    anotarAltaDeCampana(sql, "2026-11-21");
    anotarAltaDeCampana(sql, "2026-11-22");
    expect(activacionesDeCampana(sql)).toEqual({ "2026-11-21": 2, "2026-11-22": 1 });
  });

  it("las tablas de la sala crean las de la vigilancia: una sala nueva arranca en cero", () => {
    const { sql } = nuevaSala();
    expect(activacionesDeCampana(sql)).toEqual({});
  });

  it("lo guardado no lleva el token, el id de la persona, la cuenta ni el nombre", () => {
    const { sql } = nuevaSala();
    // Los datos personales que corren por el alta y que la vigilancia no debe anotar nunca.
    const personales = [
      "tok_usuario1_xxxxxxxxxxxxxxxxxxxx",
      "5f2a1c70a4b3huela-del-id-del-proveedor",
      "GA5XCAEXC2PQZJGUE5ZJHK5ANXKBJRAJLKZCLGJOCQO4V7AFWZUG4G2",
      "nombre-de-prueba",
      JSON.stringify({ d: "A".repeat(60) }),
    ];
    for (const dia of ["2026-11-21", "2026-11-22"]) {
      anotarAltaDeCampana(sql, dia);
      anotarAltaDeCampana(sql, dia);
    }
    // Todo lo que la tabla guarda, visto entero: solo el día y la cantidad, sin campos extra.
    const filas = sql<Record<string, unknown>>("SELECT * FROM campana_activaciones");
    expect(filas).toEqual([
      { dia: "2026-11-21", n: 2 },
      { dia: "2026-11-22", n: 2 },
    ]);
    const columnas = sql<{ name: string }>("SELECT name FROM pragma_table_info('campana_activaciones')");
    expect(columnas.map((c) => c.name)).toEqual(["dia", "n"]);
    const plano = JSON.stringify(filas);
    for (const dato of personales) expect(plano).not.toContain(dato);
  });
});
