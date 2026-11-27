import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { type AltaDePersona, VENTANA_CAMPANA_MS, anotarPersona, crearTablasDeCampana, sellar } from "../../workers/sala/src/campana";
import type { Ejecutar, ValorSql } from "../../workers/sala/src/registro";
import { bytesToHex } from "../protocol/quicknet";
import { listHash } from "../protocol/canonical";
import { roundTime } from "../protocol/quicknet";
import { cuentaDePrueba, lineaDePrueba } from "./cuentas-de-prueba";
import { type DatosDeAnotada, listaYEtiquetas } from "./lista";

/**
 * La lista de una campaña de personas: las líneas de persona se ordenan y se sellan igual que las cuentas, y las etiquetas
 * se ponen por línea. Una lista de una sola forma pasa, y cualquier mezcla no sale.
 */

const persona = (n: number): string => `Persona ${n}`;
const datos = (n: number, nombre: string, revisar = false, mostrar = false): DatosDeAnotada => ({ n, nombre, revisar, mostrar });
const mapa = (...pares: [string, DatosDeAnotada][]): Map<string, DatosDeAnotada> => new Map(pares);

const A = lineaDePrueba(1);
const B = lineaDePrueba(2);
const C = lineaDePrueba(3);
const ordenadas = [A, B, C].sort();

describe("la lista y las etiquetas de una campaña de personas", () => {
  it("tres líneas que llegaron en otro orden salen ordenadas", () => {
    const r = listaYEtiquetas([ordenadas[2] as string, ordenadas[0] as string, ordenadas[1] as string], mapa(), persona);
    expect(r?.lineas).toEqual(ordenadas);
  });

  it("una línea repetida sale una sola vez", () => {
    const r = listaYEtiquetas([A, B, A], mapa(), persona);
    expect(r?.lineas).toEqual([A, B].sort());
  });

  it("cada línea lleva su etiqueta: el nombre, o Persona con su número de la sala", () => {
    const r = listaYEtiquetas([A, B, C], mapa([A, datos(1, "Ana")], [B, datos(2, "  ")], [C, datos(9, "Nora", true, false)]), persona);
    expect(r?.etiquetas.get(A)).toBe("Ana");
    expect(r?.etiquetas.get(B)).toBe("Persona 2");
    expect(r?.etiquetas.get(C)).toBe("Persona 9");
  });

  it("los nombres repetidos llevan (2) en el orden de la lista", () => {
    const [primera, segunda] = [A, B].sort() as [string, string];
    const r = listaYEtiquetas([segunda, primera], mapa([primera, datos(1, "Ana")], [segunda, datos(2, "ana")]), persona);
    expect(r?.etiquetas.get(primera)).toBe("Ana");
    expect(r?.etiquetas.get(segunda)).toBe("ana (2)");
  });

  it("ninguna etiqueta es una línea de persona", () => {
    const r = listaYEtiquetas([A, B, C], mapa(), persona);
    expect([...(r?.etiquetas.values() ?? [])].some((e) => e.startsWith("p1:"))).toBe(false);
  });

  it("una sola línea se acepta, como una sola cuenta", () => {
    expect(listaYEtiquetas([A], mapa(), persona)?.lineas).toEqual([A]);
  });

  it("una lista vacía sigue dando una lista vacía", () => {
    expect(listaYEtiquetas([], mapa(), persona)).toEqual({ lineas: [], etiquetas: new Map() });
  });

  it("una mezcla de cuentas y líneas de persona no sale, esté donde esté la línea", () => {
    expect(listaYEtiquetas([cuentaDePrueba(1), A], mapa(), persona)).toBeNull();
    expect(listaYEtiquetas([A, cuentaDePrueba(1)], mapa(), persona)).toBeNull();
    expect(listaYEtiquetas([A, B, cuentaDePrueba(1), C], mapa(), persona)).toBeNull();
  });

  it("una línea junto a una fila que no es nada no sale", () => {
    expect(listaYEtiquetas([A, "hola"], mapa(), persona)).toBeNull();
    expect(listaYEtiquetas([A, B, `G${"B".repeat(55)}`], mapa(), persona)).toBeNull();
  });

  it("una fila rara sin ninguna línea de persona no sale, como hoy", () => {
    expect(listaYEtiquetas([cuentaDePrueba(1), "GBBB"], mapa(), persona)).toBeNull();
    expect(listaYEtiquetas(["p1:corta"], mapa(), persona)).toBeNull();
  });
});

describe("la huella de las líneas de persona es la que la sala acepta al sellar", () => {
  const T0 = 1_000 * VENTANA_CAMPANA_MS;
  const RONDA = 30_000_000;
  const huella = (s: string): string => createHash("sha256").update(s).digest("hex");

  function sala(lineas: readonly string[]): Ejecutar {
    const db = new DatabaseSync(":memory:");
    const sql: Ejecutar = <T,>(consulta: string, ...p: ValorSql[]): T[] => db.prepare(consulta).all(...p) as unknown as T[];
    crearTablasDeCampana(sql);
    sql("INSERT INTO sala (k, v) VALUES ('fase', 'abierta'), ('cierra', ?), ('premios', '1')", String(T0 + 3_600_000));
    lineas.forEach((cuenta, i) => {
      const alta: AltaDePersona = { persona: huella(`p${i}`), cuenta, d: "x", llave: huella(`l${i}`), grupo: "g", ahora: T0, via: "google" };
      expect(anotarPersona(sql, alta, () => true).ok).toBe(true);
    });
    sql("UPDATE sala SET v = 'cerrada' WHERE k = 'fase'");
    return sql;
  }

  const selloDe = (lineas: readonly string[]) => ({
    listHash: bytesToHex(listHash([...lineas])),
    count: lineas.length,
    numWinners: 1,
    sorteado: false,
    organizador: cuentaDePrueba(9),
    ronda: RONDA,
  });
  const ahora = roundTime(RONDA) * 1000 - 90_000;

  it("la sala acepta la huella de las líneas con las mismas anotadas", () => {
    const r = listaYEtiquetas([C, A, B], mapa(), persona);
    expect(sellar(sala([C, A, B]), "5", selloDe(r?.lineas ?? []), ahora)).toEqual({ ok: true });
  });

  it("con otra anotada quitada antes, la huella ya no es la de la sala", () => {
    const r = listaYEtiquetas([C, A, B], mapa(), persona);
    expect(sellar(sala([C, A]), "5", selloDe(r?.lineas ?? []), ahora)).toEqual({ ok: false, motivo: "lista-distinta" });
  });
});
