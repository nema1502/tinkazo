// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { JUEGOS_DEL_SELECTOR, semillaDelJuego, trazaDeShows, type PasoDelGuion, type TrazaDelShow } from "./music-traza";

/**
 * El remate del ganador: veinte rasgueos de charango, uno cada 70 ms, que la música arma poco antes de que suenen con
 * un temporizador (armarlos todos juntos tardaba más de 100 ms en el cuadro del ganador). Lo que tiene que cumplir:
 *
 * - con el equipo sano suenan los veinte, cada uno a su hora y armado antes de que le toque (nunca ya pasado);
 * - con el procesador frenado (el margen sube) suenan igual los veinte: el margen decide con cuánta anticipación se
 *   arma cada uno, y con 0,15 s fijos los de la cola llegarían tarde;
 * - con la pestaña escondida los temporizadores llegan de a uno por segundo: el rasgueo que ya pasó no suena, ninguno
 *   suena atrasado y no se amontonan;
 * - si el show se salta o se para, ningún rasgueo pendiente suena después.
 *
 * Se mira el rasgueo por sus cuerdas de sierra (cinco por rasgueo): ninguna otra voz del remate usa esa onda.
 */

const CUERDAS = 5;
const SEPARACION = 0.07;
const RASGUEOS = 20;
/** Lo que la música deja pasar de atraso antes de saltarse un rasgueo (`ATRASO_MAXIMO` en `music.ts`). */
const ATRASO = 0.04;
/** Los juegos con el remate de siempre (la chovena tiene el suyo, de redoble, sin rasgueos). */
const CON_RASGUEOS = JUEGOS_DEL_SELECTOR.filter((j) => j !== "chovena");

const lentos = (cuantos: number, ms: number, extra: Partial<PasoDelGuion> = {}): PasoDelGuion[] => Array.from({ length: cuantos }, (): PasoDelGuion => ({ ms, ...extra }));

/**
 * Un show que llega al ganador con la música cortada por el juego (así no hay otras notas programadas por delante) y
 * sigue `despues` ticks de `msDespues`. `msAntes` es el ritmo de los ticks hasta el ganador.
 */
function guionHastaElGanador(msAntes: number, despues: PasoDelGuion[]): { guion: PasoDelGuion[]; cue: number } {
  const antes = [...lentos(40, 40), ...lentos(6, msAntes), { ms: msAntes, antes: (m: typeof import("./music")) => m.musicHold(true) }, ...lentos(4, msAntes)];
  const guion = [...antes, { ms: msAntes, antes: (m: typeof import("./music")) => m.musicCue(1) }, ...despues];
  return { guion, cue: antes.length };
}

interface Rasgueo {
  /** Cuántas cuerdas de sierra arrancaron en este rasgueo. */
  cuerdas: number;
  /** La hora de audio más temprana de sus cuerdas. */
  hora: number;
  /** La hora de audio del tick que lo programó. */
  programadoEn: number;
}

/** Los rasgueos que programó el remate, con la hora en que sonarían y el tick que los armó. */
function rasgueos(t: TrazaDelShow, cue: number): Map<number, Rasgueo> {
  const tipos = new Map<string, string>();
  const primero = t.porTick[cue]!;
  const T0 = primero.ahora + 0.03;
  const salida = new Map<number, Rasgueo>();
  for (const p of t.porTick.slice(cue)) {
    for (const e of t.eventos.slice(p.desde, p.hasta)) {
      const tipo = /^(\S+#\d+) =type (\w+)$/.exec(e);
      if (tipo) tipos.set(tipo[1]!, tipo[2]!);
      const inicio = /^(\S+#\d+) start (-?[\d.]+)$/.exec(e);
      if (!inicio || tipos.get(inicio[1]!) !== "sawtooth") continue;
      const hora = Number(inicio[2]);
      const indice = Math.floor((hora - T0 + 1e-6) / SEPARACION);
      const r = salida.get(indice) ?? { cuerdas: 0, hora: hora, programadoEn: p.ahora };
      r.cuerdas += 1;
      r.hora = Math.min(r.hora, hora);
      salida.set(indice, r);
    }
  }
  return salida;
}

const veinte = Array.from({ length: RASGUEOS }, (_, i) => i);

describe("el remate del ganador: los rasgueos armados con temporizador", () => {
  it.each(CON_RASGUEOS)("%s: con el equipo sano suenan los veinte, cada uno a su hora y armado antes de que le toque", async (juego) => {
    const { guion, cue } = guionHastaElGanador(40, lentos(60, 40));
    const t = await trazaDeShows(juego, [{ semilla: semillaDelJuego(juego), guion }], { temporizadores: true });
    const r = rasgueos(t, cue);
    expect([...r.keys()].sort((a, b) => a - b)).toEqual(veinte);
    for (const i of veinte) {
      const uno = r.get(i)!;
      expect(uno.cuerdas, `rasgueo ${i}`).toBe(CUERDAS);
      // Suena a su hora (el rasgueo 0 en el golpe, y uno cada 70 ms).
      expect(uno.hora, `rasgueo ${i}`).toBeCloseTo(t.porTick[cue]!.ahora + 0.03 + i * SEPARACION, 3);
      // Se armó antes de que le tocara: nunca ya pasado.
      expect(uno.programadoEn, `rasgueo ${i}`).toBeLessThanOrEqual(uno.hora + 1e-6);
    }
  });

  it.each(CON_RASGUEOS)("%s: con el procesador frenado (ticks de 640 ms) suenan igual los veinte, ninguno atrasado", async (juego) => {
    const { guion, cue } = guionHastaElGanador(640, lentos(8, 640));
    const t = await trazaDeShows(juego, [{ semilla: semillaDelJuego(juego), guion }], { temporizadores: true });
    const r = rasgueos(t, cue);
    expect([...r.keys()].sort((a, b) => a - b)).toEqual(veinte);
    for (const i of veinte) {
      const uno = r.get(i)!;
      expect(uno.cuerdas, `rasgueo ${i}`).toBe(CUERDAS);
      expect(uno.hora, `rasgueo ${i}`).toBeGreaterThanOrEqual(uno.programadoEn - ATRASO);
    }
  });

  it.each(CON_RASGUEOS)("%s: con la pestaña escondida el que ya pasó no suena y ninguno llega atrasado", async (juego) => {
    const { guion, cue } = guionHastaElGanador(1000, lentos(4, 1000));
    const escondido = guion.map((p): PasoDelGuion => ({ ...p, escondida: true }));
    const t = await trazaDeShows(juego, [{ semilla: semillaDelJuego(juego), guion: escondido }], { temporizadores: true });
    const r = rasgueos(t, cue);
    const sonaron = [...r.keys()].sort((a, b) => a - b);
    // Los primeros caben en el margen del golpe y suenan; los del medio llegaron cuando ya habían pasado y se saltan.
    expect(sonaron.length).toBeGreaterThan(0);
    expect(sonaron.length).toBeLessThan(RASGUEOS);
    expect(sonaron).toContain(0);
    for (const i of sonaron) {
      const uno = r.get(i)!;
      expect(uno.hora, `rasgueo ${i}`).toBeGreaterThanOrEqual(uno.programadoEn - ATRASO);
    }
  });

  it.each(CON_RASGUEOS)("%s: si el show se salta justo después del golpe, ningún rasgueo pendiente suena", async (juego) => {
    const { guion, cue } = guionHastaElGanador(40, lentos(1, 40));
    const t = await trazaDeShows(juego, [{ semilla: semillaDelJuego(juego), guion }], { temporizadores: true });
    const r = rasgueos(t, cue);
    // Sonó el principio y quedó pendiente el resto.
    expect(r.size).toBeGreaterThan(0);
    expect(r.size).toBeLessThan(RASGUEOS);
    // Después del último tick el show se para y los temporizadores pendientes corren: no programan nada.
    const despues = t.eventos.slice(t.porTick[t.porTick.length - 1]!.hasta);
    expect(despues.filter((e) => / start /.test(e))).toEqual([]);
  });
});
