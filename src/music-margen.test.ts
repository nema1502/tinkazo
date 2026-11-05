import { describe, expect, it } from "vitest";
import { MARGEN_BASE, MARGEN_MAX, margenMusica } from "./music-margen";

/** Ticks del temporizador a estos intervalos (ms): devuelve el margen después de cada uno. */
function correr(intervalos: number[], margen = MARGEN_BASE): number[] {
  return intervalos.map((ms) => (margen = margenMusica(margen, ms)));
}

/**
 * Simula el temporizador de la música: en cada tick se programa hasta `ahora + margen`. Devuelve los segundos de
 * silencio, los tramos en los que el audio llega a una hora sin nada programado antes del próximo tick.
 */
function silencio(intervalos: number[], conMargen: (margen: number, ms: number) => number): number {
  // En cada tick el margen solo conoce el intervalo que ya pasó, no el que viene.
  let ahora = 0, hasta = 0, margen = MARGEN_BASE, callado = 0, anterior = 40;
  for (const ms of intervalos) {
    margen = conMargen(margen, anterior);
    anterior = ms;
    hasta = Math.max(hasta, ahora + margen);
    const proximo = ahora + ms / 1000;
    if (proximo > hasta) callado += proximo - hasta;
    ahora = proximo;
  }
  return callado;
}

describe("el margen con que la música se programa por delante", () => {
  it("en un equipo normal sigue siendo 0,22 s, como siempre", () => {
    expect(MARGEN_BASE).toBe(0.22);
    expect(correr(Array(50).fill(40)).every((m) => m === MARGEN_BASE)).toBe(true);
    expect(correr(Array(50).fill(16)).every((m) => m === MARGEN_BASE)).toBe(true);
  });

  it("con cuadros de 300 ms (ahorro de batería) crece y la música no se calla", () => {
    const lento = [...Array(20).fill(40), ...Array(100).fill(300)];
    const fijo = silencio(lento, () => MARGEN_BASE);
    expect(fijo).toBeGreaterThan(5);
    expect(silencio(lento, margenMusica)).toBeLessThan(0.1);
  });

  it("los tirones sueltos de 600 ms tampoco dejan silencios después del primero", () => {
    const tirones = Array.from({ length: 60 }, (_, i) => (i % 4 === 3 ? 600 : 120));
    expect(silencio(tirones, margenMusica)).toBeLessThan(0.4);
  });

  it("nunca pasa de un segundo, aunque el temporizador se frene mucho más", () => {
    expect(MARGEN_MAX).toBe(1);
    expect(Math.max(...correr([5000, 2000, 1500, 1200]))).toBe(MARGEN_MAX);
  });

  it("cuando el equipo se recupera vuelve de a poco a 0,22 s", () => {
    const despues = correr([...Array(10).fill(400), ...Array(200).fill(40)]);
    expect(despues[9]).toBeGreaterThan(0.5);
    expect(despues[10]).toBeGreaterThan(despues[30]!);
    expect(despues.at(-1)).toBe(MARGEN_BASE);
  });

  it("un intervalo inválido no lo mueve", () => {
    for (const ms of [Number.NaN, -10, 0, Number.POSITIVE_INFINITY]) expect(margenMusica(0.5, ms)).toBe(0.5);
  });
});

describe("music.ts usa el margen", () => {
  it("el tick programa hasta la hora más el margen, no 0,22 fijo, y el remate se arma con el mismo margen", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("./music.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/s\.ctx\.currentTime \+ 0\.22/);
    expect(src).toMatch(/s\.margen = document\.hidden \? MARGEN_BASE : margenMusica\(s\.margen, intervalo\);/);
    expect(src).toMatch(/while \(s\.next < s\.ctx\.currentTime \+ s\.margen\)/);
    expect(src).toMatch(/const espera = \(at - s\.ctx\.currentTime - Math\.max\(0\.15, s\.margen\)\) \* 1000;/);
  });
});
