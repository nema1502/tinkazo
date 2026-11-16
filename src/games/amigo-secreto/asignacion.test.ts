import { describe, expect, it } from "vitest";
import { asignarAmigos } from "./asignacion";

/**
 * La asignación del amigo secreto (S2): permutación completa, determinista
 * desde la semilla del faro, nadie se regala a sí mismo. Es la misma función
 * que usará la verificación del comprobante (T3), así que sus reglas se
 * prueban acá y no en el juego.
 */
describe("asignarAmigos: las reglas del amigo secreto", () => {
  it("con ninguna o una sola persona no hay juego: devuelve null", () => {
    expect(asignarAmigos([], "abc")).toBeNull();
    expect(asignarAmigos(["Ana"], "abc")).toBeNull();
  });

  it("con dos personas, se intercambian: cada una le regala a la otra", () => {
    expect(asignarAmigos(["Ana", "Beto"], "faro-de-prueba-1")).toEqual([1, 0]);
    expect(asignarAmigos(["Ana", "Beto"], "otra-semilla-2")).toEqual([1, 0]);
  });

  it("nadie se autoasigna, en ningún tamaño ni con ninguna semilla", () => {
    for (let n = 2; n <= 60; n++) {
      const nombres = Array.from({ length: n }, (_, i) => `Persona ${i + 1}`);
      for (let s = 0; s < 8; s++) {
        const asignacion = asignarAmigos(nombres, `faro-${n}-${s}`);
        expect(asignacion, `con ${n} personas y semilla ${s}`).not.toBeNull();
        for (let i = 0; i < n; i++) expect(asignacion?.[i], `persona ${i} con n=${n}, semilla ${s}`).not.toBe(i);
      }
    }
  });

  it("es una permutación completa: todos dan y todos reciben exactamente una vez", () => {
    for (const n of [2, 3, 5, 8, 18, 30, 200]) {
      const nombres = Array.from({ length: n }, (_, i) => `P${i}`);
      const a = asignarAmigos(nombres, "faro-completa") as readonly number[];
      expect(a).toHaveLength(n);
      expect([...a].sort((x, y) => x - y)).toEqual(Array.from({ length: n }, (_, i) => i));
    }
  });

  it("cada uno da a exactamente una persona y el que recibe de uno no repite", () => {
    // Es la misma propiedad de la permutación, dicha del lado del regalo: quien recibe de Ana no vuelve a recibir de Beto.
    const a = asignarAmigos(["Ana", "Beto", "Cami", "Dario"], "intercambio") as readonly number[];
    expect(new Set(a).size).toBe(4);
  });

  it("la misma semilla da siempre la misma asignación, en cualquier tamaño", () => {
    for (const n of [2, 8, 18, 200]) {
      const nombres = Array.from({ length: n }, (_, i) => `P${i}`);
      const a = asignarAmigos(nombres, "faro-igual") as readonly number[];
      expect(asignarAmigos(nombres, "faro-igual")).toEqual(a);
      expect(asignarAmigos(nombres, "faro-igual")).toEqual(a);
    }
  });

  it("otras semillas cuentan otra historia: la asignación cambia (al menos una vez en muchas)", () => {
    const nombres = Array.from({ length: 12 }, (_, i) => `P${i}`);
    const base = asignarAmigos(nombres, "faro-base") as readonly number[];
    const distintas = Array.from({ length: 12 }, (_, s) => asignarAmigos(nombres, `faro-${s}`)).filter((a): a is readonly number[] => a !== null).filter((a) => a.join(",") !== base.join(","));
    expect(distintas.length).toBeGreaterThan(0);
  });

  it("acepta la semilla del faro tal como llega: una cadena hexadecimal larga", () => {
    const semilla = "6e049991d7e23bdc566d3adfff08cd81798c644bc54dd5daa18eb0a8938b2829";
    const nombres = Array.from({ length: 18 }, (_, i) => `P${i}`);
    const a = asignarAmigos(nombres, semilla) as readonly number[];
    for (let i = 0; i < 18; i++) expect(a[i]).not.toBe(i);
    expect(asignarAmigos(nombres, semilla)).toEqual(a);
  });

  it("acepta la semilla del faro tal como llega: una cadena hexadecimal larga", () => {
    const semilla = "6e049991d7e23bdc566d3adfff08cd81798c644bc54dd5daa18eb0a8938b2829";
    const nombres = Array.from({ length: 18 }, (_, i) => `P${i}`);
    const a = asignarAmigos(nombres, semilla) as readonly number[];
  });
});
