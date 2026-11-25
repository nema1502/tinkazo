import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MARGEN_BASE, MARGEN_GRACIA_MAX, MARGEN_MAX, FRENO_MS, horizonteDeMusica, margenMusica, nivelDeGracia } from "./music-margen";

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

  it("cuando los ticks ya vuelven a tiempo, el margen que sobró baja más rápido (la vuelta de la pestaña escondida no carga el equipo)", () => {
    expect(margenMusica(1, 40)).toBe(1 - 0.06);
    expect(margenMusica(1, 400)).toBe(0.99);
    expect(margenMusica(1, 160)).toBeCloseTo(1 - 0.06);
  });
});

/*
 * El freno del procesador y la pestaña escondida (S1, S7).
 *
 * Los mismos insumos del audit-harness: el procesador frenado 4, 8 y 16 veces deja los temporizadores en 160,
 * 320 y 640 ms; la pestaña escondida los baja a uno por segundo; la red lenta traba el hilo con tirones largos.
 * En cada caso, o la música suena entera, o baja con gracia a algo más simple: nunca un silencio, nunca rota.
 */
describe("el freno del procesador y la pestaña escondida", () => {
  it("cuánto frenó el procesador: sube al toque y baja de a poco", () => {
    expect(FRENO_MS).toBe(160);
    // 4× del audit-harness todavía respira; 8× y 16× son freno.
    expect(nivelDeGracia(0, 40)).toBe(0);
    expect(nivelDeGracia(0, 160)).toBe(0);
    expect(nivelDeGracia(0, 320)).toBe(0.5);
    expect(nivelDeGracia(0, 640)).toBe(1);
    expect(nivelDeGracia(0, 1000)).toBe(1); // la pestaña escondida: un tick por segundo
    // Se frena, se nota en el primer tick que llega tarde.
    expect(nivelDeGracia(0.5, 640)).toBe(1);
    // Y se recupera de a poco, que no vaya a brincare las capas.
    expect(nivelDeGracia(1, 40)).toBeCloseTo(0.97);
    expect(nivelDeGracia(0.02, 40)).toBe(0);
    for (const ms of [Number.NaN, -10, 0, Number.POSITIVE_INFINITY]) expect(nivelDeGracia(0.5, ms)).toBe(0.5);
  });

  it("el horizonte de gracia alcanza hasta el próximo tick cuando el procesador frenó", () => {
    expect(MARGEN_GRACIA_MAX).toBe(2);
    // Equipo sano (y 4×): el margen de siempre.
    expect(horizonteDeMusica(0.22, 40)).toBe(0.22);
    expect(horizonteDeMusica(0.22, 160)).toBe(0.22);
    // 8×: hasta 1,2 del intervalo medido, más un resto.
    expect(horizonteDeMusica(0.22, 320)).toBeCloseTo(0.464);
    // 16×: el margen ya está en el tope de 1 s, y alcanza de sobra.
    expect(horizonteDeMusica(1, 640)).toBe(1);
    // La pestaña escondida: los temporizadores van a uno por segundo y el horizonte los cubre.
    expect(horizonteDeMusica(1, 1000)).toBe(1.28);
    // Red lenta con un tirón de 1,5 s: cubre, y hasta dos segundos, nunca más.
    expect(horizonteDeMusica(1, 1500)).toBe(1.88);
    expect(horizonteDeMusica(1, 3000)).toBe(2);
    for (const ms of [Number.NaN, -10, 0, Number.POSITIVE_INFINITY]) expect(horizonteDeMusica(0.4, ms)).toBe(0.4);
  });

  /**
   * El mismo reloj del audit-harness, con la máquina de gracia de music.ts: en cada tick se programa hasta la hora
   * más el horizonte, que con el procesador frenado llega hasta el intervalo medido (el próximo tick).
   */
  function silencioConGracia(intervalos: number[], anterior = 40): number {
    let ahora = 0, hasta = 0, margen = MARGEN_BASE, callado = 0;
    for (const ms of intervalos) {
      margen = margenMusica(margen, anterior);
      hasta = Math.max(hasta, ahora + horizonteDeMusica(margen, anterior));
      const proximo = ahora + ms / 1000;
      if (proximo > hasta) callado += proximo - hasta;
      ahora = proximo;
      anterior = ms;
    }
    return callado;
  }

  it("procesador frenado 4× (160 ms): cero silencios", () => {
    expect(silencioConGracia([...Array(40).fill(160)])).toBe(0);
  });

  it("procesador frenado 8× (320 ms): el traspiso apenas y después nada", () => {
    expect(silencioConGracia([...Array(40).fill(320)])).toBeLessThan(0.2);
    expect(silencioConGracia([...Array(30).fill(320)], 320)).toBe(0);
  });

  it("procesador frenado 16× (640 ms): el traspiso y después suena entera", () => {
    expect(silencioConGracia([...Array(40).fill(640)])).toBeLessThan(0.5);
    expect(silencioConGracia([...Array(30).fill(640)], 640)).toBe(0);
  });

  it("pestaña escondida y vuelta: la música sigue entera mientras está escondida y a la vuelta queda limpia", () => {
    // Escondida (los temporizadores a uno por segundo), con el reloj ya en ese paso: nada callado.
    expect(silencioConGracia([...Array(10).fill(1000)], 1000)).toBe(0);
    // Y a la vuelta, con ticks a tiempo, tampoco queda ningún agujero.
    expect(silencioConGracia([...Array(5).fill(1000), ...Array(50).fill(40)], 1000)).toBe(0);
  });

  it("red lenta: un tirón largo y los que siguen, sin cortar a la mitad del show", () => {
    // Hoy, con el tope de 1 s, cada tirón deja medio segundo callado.
    expect(silencioConGracia([1500, 1200, 900, 800], 1500)).toBe(0);
    // La única hendija es la primera del tirón, que nadie puede prever.
    expect(silencioConGracia([...Array(40).fill(40), 1500, 1200, 900, 800, ...Array(60).fill(40)])).toBeLessThan(1.4);
  });
});

describe("music.ts usa el margen", () => {
  it("el tick programa hasta la hora más el margen, no 0,22 fijo, y el remate se arma con el mismo margen", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("./music.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/s\.ctx\.currentTime \+ 0\.22/);
    expect(src).toMatch(/s\.margen = escondida \? MARGEN_BASE : margenMusica\(s\.margen, intervalo\);/);
    expect(src).toMatch(/while \(s\.next < s\.ctx\.currentTime \+ \(escondida \? s\.margen : horizonteDeMusica\(s\.margen, intervalo\)\)\)/);
    expect(src).toMatch(/const espera = \(at - s\.ctx\.currentTime - Math\.max\(0\.15, s\.margen\)\) \* 1000;/);
  });

  it("el tick mide cuánto frenó el procesador y con gracia el horizonte llega hasta el próximo tick", async () => {
    const src = readFileSync(new URL("./music.ts", import.meta.url), "utf8");
    expect(src).toMatch(/const intervalo = ahora - s\.ultimoTick;/);
    expect(src).toMatch(/s\.gracia = escondida \? 0 : nivelDeGracia\(s\.gracia, intervalo\);/);
    expect(src).toMatch(/horizonteDeMusica\(s\.margen, intervalo\)/);
  });
});
