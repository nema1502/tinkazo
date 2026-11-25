// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
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
