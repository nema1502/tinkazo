import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { type AltaDePersona, VENTANA_CAMPANA_MS, anotarPersona, crearTablasDeCampana, sellar } from "../../workers/sala/src/campana";
import type { Ejecutar, ValorSql } from "../../workers/sala/src/registro";
import { bytesToHex } from "../protocol/quicknet";
import { canonicalList, listHash } from "../protocol/canonical";
import { roundTime } from "../protocol/quicknet";
import { cuentaDePrueba } from "./cuentas-de-prueba";
import { type DatosDeAnotada, listaYEtiquetas } from "./lista";

const persona = (n: number): string => `Persona ${n}`;
const datos = (n: number, nombre: string, revisar = false, mostrar = false): DatosDeAnotada => ({ n, nombre, revisar, mostrar });
const mapa = (...pares: [string, DatosDeAnotada][]): Map<string, DatosDeAnotada> => new Map(pares);

/** Tres cuentas en un orden de llegada que no es el de la lista. */
const A = cuentaDePrueba(1);
const B = cuentaDePrueba(2);
const C = cuentaDePrueba(3);
const ordenadas = [A, B, C].sort();

describe("la lista y las etiquetas de una campaña", () => {
  it("tres anotadas que llegaron en otro orden salen ordenadas por cuenta", () => {
    const r = listaYEtiquetas([ordenadas[2] as string, ordenadas[0] as string, ordenadas[1] as string], mapa(), persona);
    expect(r?.lineas).toEqual(ordenadas);
  });

  it("una cuenta repetida sale una sola vez", () => {
    const r = listaYEtiquetas([A, B, A], mapa(), persona);
    expect(r?.lineas).toEqual([A, B].sort());
  });

  it("dos con el mismo nombre, aunque cambie una mayúscula, salen con su nombre y con el nombre y (2) en el orden de la lista", () => {
    const [primera, segunda] = [A, B].sort() as [string, string];
    const r = listaYEtiquetas([segunda, primera], mapa([primera, datos(1, "Ana")], [segunda, datos(2, "ana")]), persona);
    expect(r?.etiquetas.get(primera)).toBe("Ana");
    expect(r?.etiquetas.get(segunda)).toBe("ana (2)");
  });

  it("un nombre vacío sale como Persona con su número de la sala", () => {
    const r = listaYEtiquetas([A], mapa([A, datos(7, "  ")]), persona);
    expect(r?.etiquetas.get(A)).toBe("Persona 7");
  });

  it("una marcada sin mostrar sale como Persona y una marcada y mostrada sale con su nombre", () => {
    const r = listaYEtiquetas([A, B], mapa([A, datos(1, "Nora", true, false)], [B, datos(2, "Beto", true, true)]), persona);
    expect(r?.etiquetas.get(A)).toBe("Persona 1");
    expect(r?.etiquetas.get(B)).toBe("Beto");
  });

  it("las marcadas entran a las líneas igual que las demás", () => {
    const r = listaYEtiquetas([A, B], mapa([A, datos(1, "Nora", true, false)]), persona);
    expect(r?.lineas).toEqual([A, B].sort());
  });

  it("una cuenta que está en las anotadas pero no en la lectura de la sala no entra en las líneas", () => {
    const r = listaYEtiquetas([A, B], mapa([A, datos(1, "Ana")], [B, datos(2, "Beto")], [C, datos(3, "Nora")]), persona);
    expect(r?.lineas).toEqual([A, B].sort());
    expect(r?.etiquetas.has(C)).toBe(false);
  });

  it("una cuenta que no tiene forma de cuenta hace fallar la lectura y no se descarta en silencio", () => {
    expect(listaYEtiquetas([A, `G${"B".repeat(55)}`], mapa(), persona)).toBeNull();
    expect(listaYEtiquetas([A, "CUENTA2"], mapa(), persona)).toBeNull();
  });

  it("canonicalList de las líneas es la misma lista", () => {
    const r = listaYEtiquetas([C, A, B, A], mapa(), persona);
    expect(canonicalList((r?.lineas ?? []).join("\n"))).toEqual(r?.lineas);
  });
});

describe("la huella de las líneas es la que la sala acepta al sellar", () => {
  const T0 = 1_000 * VENTANA_CAMPANA_MS;
  const RONDA = 30_000_000;
  const huella = (s: string): string => createHash("sha256").update(s).digest("hex");

  function sala(cuentas: readonly string[]): Ejecutar {
    const db = new DatabaseSync(":memory:");
    const sql: Ejecutar = <T,>(consulta: string, ...p: ValorSql[]): T[] => db.prepare(consulta).all(...p) as unknown as T[];
    crearTablasDeCampana(sql);
    sql("INSERT INTO sala (k, v) VALUES ('fase', 'abierta'), ('cierra', ?), ('premios', '1')", String(T0 + 3_600_000));
    cuentas.forEach((cuenta, i) => {
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
