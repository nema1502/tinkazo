import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import vectores from "./cupon-vectores.json";
import { ALFABETO, LARGO_CUPON, mostrar, normalizar } from "./cupon-codigo";

interface Caso {
  entrada: string;
  normalizado: string | null;
  mostrado?: string;
}

describe("cupon-codigo: el vector compartido con el portero y la herramienta", () => {
  it("el alfabeto y el largo son los del vector", () => {
    expect(ALFABETO).toBe(vectores.alfabeto);
    expect(LARGO_CUPON).toBe(vectores.largo);
  });

  it("cada caso da lo que dice el vector", () => {
    expect(vectores.casos.length).toBeGreaterThan(20);
    for (const c of vectores.casos as Caso[]) {
      expect(normalizar(c.entrada), JSON.stringify(c.entrada)).toBe(c.normalizado);
      if (c.normalizado !== null && c.mostrado !== undefined) expect(mostrar(c.normalizado)).toBe(c.mostrado);
    }
  });

  it("lo que no es un texto no es un cupón, y un pegado enorme no se recorre", () => {
    for (const x of [null, undefined, 12, {}, []]) expect(normalizar(x)).toBeNull();
    expect(normalizar("A".repeat(10_000))).toBeNull();
  });

  it("mostrar rechaza lo que no está normalizado", () => {
    expect(() => mostrar("k7m2-9qxa-4htr")).toThrow();
  });

  it("si el portero ya está en esta copia, su vector es idéntico al del sitio", () => {
    const del = new URL("../../workers/patrocinio/src/cupon-vectores.json", import.meta.url);
    if (!existsSync(del)) return;
    expect(JSON.parse(readFileSync(del, "utf8"))).toEqual(vectores);
  });
});
