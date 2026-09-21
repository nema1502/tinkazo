import { describe, expect, it } from "vitest";
import { canonicalList, listHash } from "./canonical";
import { MAX_WINNERS, select } from "./select";

/**
 * Prueba de carga del protocolo.
 *
 * El producto dice que funciona "con dos participantes y con doscientos", y en
 * los juegos eso está comprobado. Lo que nadie había medido es el protocolo
 * mismo con listas de verdad grandes: una conferencia con mil inscritos, o el
 * padrón de un colegio con diez mil.
 *
 * No es una prueba de rendimiento con umbrales finos, que serían frágiles en
 * una máquina compartida. Es una cota gruesa: sellar y sortear una lista de
 * diez mil nombres tiene que pasar desapercibido, no tardar segundos. Si algún
 * día alguien mete un algoritmo cuadrático en `select`, acá se ve.
 */
describe("el protocolo con listas grandes", () => {
  const nombres = (n: number): string[] =>
    canonicalList(Array.from({ length: n }, (_, i) => `Participante ${i + 1}`).join("\n"));

  it("sella diez mil nombres sin despeinarse", () => {
    const lista = nombres(10_000);
    expect(lista).toHaveLength(10_000);
    const t0 = performance.now();
    const h = listHash(lista);
    const ms = performance.now() - t0;
    expect(h).toHaveLength(32);
    expect(ms).toBeLessThan(1000);
  });

  it("elige treinta y dos ganadores entre diez mil, sin repetir", () => {
    const lista = nombres(10_000);
    const h = listHash(lista);
    const semilla = new Uint8Array(32).fill(7);
    const t0 = performance.now();
    const ganadores = select(semilla, h, lista.length, MAX_WINNERS);
    const ms = performance.now() - t0;
    expect(ganadores).toHaveLength(MAX_WINNERS);
    expect(new Set(ganadores).size).toBe(MAX_WINNERS);
    for (const i of ganadores) {
      expect(i).toBeGreaterThanOrEqual(0);
      expect(i).toBeLessThan(10_000);
    }
    expect(ms).toBeLessThan(200);
  });

  it("da lo mismo dos veces con mil nombres, que es la promesa entera", () => {
    const lista = nombres(1000);
    const h = listHash(lista);
    const semilla = new Uint8Array(32).fill(3);
    expect(select(semilla, h, lista.length, 5)).toEqual(select(semilla, h, lista.length, 5));
  });

  it("una lista de mil y la misma con un nombre más no comparten huella", () => {
    const a = listHash(nombres(1000));
    const b = listHash(nombres(1001));
    expect(Buffer.from(a).toString("hex")).not.toBe(Buffer.from(b).toString("hex"));
  });
});
