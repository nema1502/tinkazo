import { describe, expect, it } from "vitest";
import { SIN_REPETIR, figurasDe, repetidas } from "./figuras";

const RONDA = "6e049991d7e23bdc566d3adfff08cd81798c644bc54dd5daa18eb0a8938b2829";
const lista = (n: number): string[] => Array.from({ length: n }, (_, i) => `Persona ${i + 1}`);

describe("figuras", () => {
  it("por defecto todos tienen la cara de siempre", () => {
    expect(figurasDe(lista(5), RONDA).every((f) => f.tipo === "cara")).toBe(true);
  });

  it("con emblemas, cada uno el suyo: determinista, sin azar", () => {
    const a = figurasDe(lista(20), RONDA, "emblemas");
    const b = figurasDe(lista(20), RONDA, "emblemas");
    expect(a).toEqual(b);
    expect(a.every((f) => f.tipo === "emblema")).toBe(true);
  });

  it("hasta 32 personas nadie repite emblema", () => {
    for (const n of [2, 8, 18, 30, SIN_REPETIR]) {
      expect(repetidas(figurasDe(lista(n), RONDA, "emblemas")), `con ${n}`).toBe(0);
    }
  });

  it("con más de 32 nadie repite emblema y color, hasta 256", () => {
    const f = figurasDe(lista(200), RONDA, "emblemas");
    const pares = new Set(f.map((x) => (x.tipo === "emblema" ? `${x.emblema.clave}|${x.emblema.color}` : "cara")));
    expect(pares.size).toBe(200);
  });

  it("reordenar la lista no cambia el emblema de nadie", () => {
    const nombres = lista(24);
    const a = figurasDe(nombres, RONDA, "emblemas");
    const revuelta = [...nombres].reverse();
    const b = figurasDe(revuelta, RONDA, "emblemas");
    nombres.forEach((nm, i) => expect(b[revuelta.indexOf(nm)]).toEqual(a[i]));
  });

  it("otra ronda reparte distinto", () => {
    const a = figurasDe(lista(20), RONDA, "emblemas");
    const b = figurasDe(lista(20), RONDA.replace(/^6e04/, "a1b2"), "emblemas");
    expect(a).not.toEqual(b);
  });

  it("si la hoja no cargó, todos con su cara: un juego nunca espera por una imagen", () => {
    expect(figurasDe(lista(10), RONDA, "emblemas", false).every((f) => f.tipo === "cara")).toBe(true);
  });

  it("una lista vacía no rompe nada", () => {
    expect(figurasDe([], RONDA, "emblemas")).toEqual([]);
  });
});
