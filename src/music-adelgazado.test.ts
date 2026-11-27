// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { MARGEN_MAX } from "./music-margen";
import { JUEGOS_DEL_SELECTOR, semillaDelJuego, trazaDelShow, type PasoDelGuion, type TrazaDelShow } from "./music-traza";

/**
 * Lo que hace el adelgazado de capas, medido en lo que la música programa y no en cómo está escrito el código:
 * con el procesador frenado suenan menos capas, cuando se recupera vuelve todo, y el remate del ganador suena entero.
 * Apagado (como en producción) no cambia nada: eso lo prueba `music-igual-a-hoy.test.ts`.
 */

const paso = (cuantos: number, ms: number): PasoDelGuion[] => Array.from({ length: cuantos }, (): PasoDelGuion => ({ ms }));

/** Un show con el procesador frenado 16 veces en el medio, su recuperación y el remate del ganador al final. */
const guion = (): PasoDelGuion[] => [
  ...paso(60, 40),
  { ms: 40, antes: (m) => m.musicCue(0.9) },
  ...paso(30, 640),
  ...paso(120, 40),
  { ms: 40, antes: (m) => m.musicFinal() },
  ...paso(60, 40),
];

/** Cuántas notas (arranques de osciladores y de ruido) programó un tramo de ticks. */
function notasDel(t: TrazaDelShow, desdeTick: number, hastaTick: number): number {
  const desde = t.porTick[desdeTick]!.desde;
  const hasta = t.porTick[hastaTick - 1]!.hasta;
  return t.eventos.slice(desde, hasta).filter((e) => / start /.test(e) && !/\.\w+ start/.test(e)).length;
}

const CORRIDAS = { frenado: [61, 91], remate: [211, 272] } as const;

describe("el adelgazado de capas, prendido", () => {
  it.each(["race", "chovena", "wheel"])("%s: con el procesador frenado suenan menos notas y el remate suena entero", async (juego) => {
    const semilla = semillaDelJuego(juego);
    const apagado = await trazaDelShow(juego, semilla, guion());
    const prendido = await trazaDelShow(juego, semilla, guion(), async () => {
      (await import("./music-margen")).prenderAdelgazado(true);
    });
    expect(prendido.porTick).toHaveLength(apagado.porTick.length);
    // Frenado 16 veces: las capas caras caen primero.
    expect(notasDel(prendido, ...CORRIDAS.frenado)).toBeLessThan(notasDel(apagado, ...CORRIDAS.frenado));
    // Con el show recuperado y en el remate no se pierde ninguna nota: el ganador no se degrada nunca.
    expect(notasDel(prendido, ...CORRIDAS.remate)).toBeGreaterThanOrEqual(notasDel(apagado, ...CORRIDAS.remate));
  });

  it("en un equipo que respira (ticks de 40 ms) el interruptor no cambia nada de lo que se programa", async () => {
    const respira = (): PasoDelGuion[] => [...paso(200, 40), { ms: 40, antes: (m) => m.musicFinal() }, ...paso(60, 40)];
    const juego = JUEGOS_DEL_SELECTOR[0];
    const apagado = await trazaDelShow(juego, semillaDelJuego(juego), respira());
    const prendido = await trazaDelShow(juego, semillaDelJuego(juego), respira(), async () => {
      (await import("./music-margen")).prenderAdelgazado(true);
    });
    expect(prendido.eventos).toEqual(apagado.eventos);
  });
});

/** La hora más temprana de un arranque programado (`Oscillator#3 start 12.5`) en un tramo de eventos. */
function primerArranque(eventos: string[]): number {
  let primero = Infinity;
  for (const e of eventos) {
    const m = /^\S+#\d+ start (-?[\d.]+)/.exec(e);
    if (m) primero = Math.min(primero, Number(m[1]));
  }
  return primero;
}

describe("el remate del ganador con el horizonte largo", () => {
  /** Un tropiezo de un segundo y medio y, en el tick siguiente, el golpe del ganador. */
  const conTropiezo = (): PasoDelGuion[] => [...paso(60, 40), { ms: 1500 }, { ms: 40, antes: (m) => m.musicCue(1) }, ...paso(40, 40)];

  it.each(["race", "chovena"])("%s: el remate no llega más tarde que el margen de siempre, ni con el horizonte de dos segundos", async (juego) => {
    const t = await trazaDelShow(juego, semillaDelJuego(juego), conTropiezo(), async () => {
      (await import("./music-margen")).prenderAdelgazado(true);
    });
    const tick = t.porTick[61]!;
    // El golpe se arma al avisar el relator, antes del tick: sus notas son las que quedan entre el tick anterior y este.
    const delGolpe = t.eventos.slice(t.porTick[60]!.hasta, tick.desde);
    const primero = primerArranque(delGolpe);
    expect(primero).toBeGreaterThanOrEqual(tick.ahora);
    expect(primero).toBeLessThanOrEqual(tick.ahora + MARGEN_MAX + 0.1);
  });

  it("apagado, el remate sigue donde estaba: detrás de lo ya programado, como siempre", async () => {
    const t = await trazaDelShow("race", semillaDelJuego("race"), conTropiezo());
    const tick = t.porTick[61]!;
    const primero = primerArranque(t.eventos.slice(t.porTick[60]!.hasta, tick.desde));
    expect(primero).toBeLessThanOrEqual(tick.ahora + MARGEN_MAX + 0.1);
  });
});

/** Cuántas notas programó un tramo largo de ticks, de un tick a otro (con el cuerpo del show igual en los dos lados). */
const notasEnTotal = (t: TrazaDelShow, desdeTick: number, hastaTick: number): number => notasDel(t, desdeTick, hastaTick);

describe("el adelgazado no castiga a un equipo sano por un tropiezo", () => {
  const prender = async (): Promise<void> => {
    (await import("./music-margen")).prenderAdelgazado(true);
  };

  // La chovena no arma nada fuera del ritmo del tick, así que sus notas se cuentan de a una y la cuenta es exacta.
  it.each(["chovena"])("%s: un solo tick tarde no quita capas", async (juego) => {
    const semilla = semillaDelJuego(juego);
    // La tensión alta, donde las capas caras suenan, y un tick de 400 ms aislado.
    const guionConTropiezo = (): PasoDelGuion[] => [{ ms: 40, antes: (m) => m.musicCue(0.9) }, ...paso(120, 40), { ms: 400 }, ...paso(160, 40)];
    const apagado = await trazaDelShow(juego, semilla, guionConTropiezo());
    const prendido = await trazaDelShow(juego, semilla, guionConTropiezo(), prender);
    expect(notasEnTotal(prendido, 121, 282)).toBe(notasEnTotal(apagado, 121, 282));
  });

  it.each(["race", "chovena"])("%s: dos ticks seguidos tarde sí bajan las capas", async (juego) => {
    const semilla = semillaDelJuego(juego);
    const guionFrenado = (): PasoDelGuion[] => [{ ms: 40, antes: (m) => m.musicCue(0.9) }, ...paso(120, 40), ...paso(6, 400), ...paso(10, 40)];
    const apagado = await trazaDelShow(juego, semilla, guionFrenado());
    const prendido = await trazaDelShow(juego, semilla, guionFrenado(), prender);
    expect(notasEnTotal(prendido, 121, 137)).toBeLessThan(notasEnTotal(apagado, 121, 137));
  });

  it.each(["chovena"])("%s: al volver de la pestaña escondida las capas no quedan bajas", async (juego) => {
    const semilla = semillaDelJuego(juego);
    const guionEscondida = (): PasoDelGuion[] => [
      { ms: 40, antes: (m) => m.musicCue(0.9) },
      ...paso(120, 40),
      ...Array.from({ length: 6 }, (): PasoDelGuion => ({ ms: 1000, escondida: true })),
      { ms: 1000 },
      ...paso(160, 40),
    ];
    const apagado = await trazaDelShow(juego, semilla, guionEscondida());
    const prendido = await trazaDelShow(juego, semilla, guionEscondida(), prender);
    expect(notasEnTotal(prendido, 127, 288)).toBe(notasEnTotal(apagado, 127, 288));
  });
});
