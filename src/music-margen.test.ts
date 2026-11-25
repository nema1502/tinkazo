import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MARGEN_BASE, MARGEN_GRACIA_MAX, MARGEN_MAX, FRENO_MS, adelgazadoPrendido, horizonteDeMusica, margenMusica, nivelDeGracia, prenderAdelgazado } from "./music-margen";

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

  it("apagado el adelgazado, el margen baja siempre de a 0,01 por tick, como en producción", () => {
    expect(margenMusica(1, 40)).toBe(0.99);
    expect(margenMusica(1, 40, false)).toBe(0.99);
    expect(margenMusica(1, 160)).toBeCloseTo(0.99);
  });

  it("con el adelgazado prendido, cuando los ticks ya vuelven a tiempo el margen que sobró baja más rápido", () => {
    expect(margenMusica(1, 40, true)).toBe(1 - 0.06);
    expect(margenMusica(1, 400, true)).toBe(0.99);
    expect(margenMusica(1, 160, true)).toBeCloseTo(1 - 0.06);
  });
});

/*
 * El freno del procesador, con el adelgazado prendido (`?musicagracia=1`, apagado por defecto).
 *
 * El procesador frenado 4, 8 y 16 veces deja los temporizadores en 160, 320 y 640 ms, y la red lenta traba el hilo con
 * tirones largos. En cada caso, o la música suena entera, o baja con gracia a algo más simple: nunca un silencio, nunca rota.
 * Con la pestaña escondida el adelgazado no actúa: la música se salta en silencio (`music-escondida.test.ts`).
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
    // Un tick por segundo: el horizonte los cubre.
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
      margen = margenMusica(margen, anterior, true);
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

  it("temporizadores a uno por segundo con la pestaña a la vista (la pantalla que se apaga y vuelve): sin agujeros y a la vuelta queda limpia", () => {
    expect(silencioConGracia([...Array(10).fill(1000)], 1000)).toBe(0);
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
    expect(src).toMatch(/s\.margen = escondida \? MARGEN_BASE : margenMusica\(s\.margen, intervalo, s\.adelgazar\);/);
    expect(src).toMatch(/while \(s\.next < s\.ctx\.currentTime \+ \(s\.adelgazar && !escondida \? horizonteDeMusica\(s\.margen, intervalo\) : s\.margen\)\)/);
    expect(src).toMatch(/const espera = \(at - s\.ctx\.currentTime - Math\.max\(0\.15, s\.margen\)\) \* 1000;/);
  });

  it("el tick mide cuánto frenó el procesador y con gracia el horizonte llega hasta el próximo tick", async () => {
    const src = readFileSync(new URL("./music.ts", import.meta.url), "utf8");
    expect(src).toMatch(/const intervalo = ahora - s\.ultimoTick;/);
    expect(src).toMatch(/s\.gracia = s\.adelgazar && !escondida \? nivelDeGracia\(s\.gracia, intervalo\) : 0;/);
    expect(src).toMatch(/horizonteDeMusica\(s\.margen, intervalo\)/);
  });
});

describe("el interruptor del adelgazado", () => {
  it("nace apagado: sin nada en la dirección, producción suena como siempre", () => {
    expect(adelgazadoPrendido("")).toBe(false);
    expect(adelgazadoPrendido("?demo=race&lang=en")).toBe(false);
    expect(adelgazadoPrendido("?musicagracia=0")).toBe(false);
  });

  it("la dirección con ?musicagracia=1 lo prende", () => {
    expect(adelgazadoPrendido("?musicagracia=1")).toBe(true);
    expect(adelgazadoPrendido("?demo=race&musicagracia=1")).toBe(true);
  });

  it("las pruebas y la escucha lo fuerzan, y null vuelve a lo de siempre", () => {
    prenderAdelgazado(true);
    expect(adelgazadoPrendido("")).toBe(true);
    prenderAdelgazado(false);
    expect(adelgazadoPrendido("?musicagracia=1")).toBe(false);
    prenderAdelgazado(null);
    expect(adelgazadoPrendido("?musicagracia=1")).toBe(true);
  });
});
