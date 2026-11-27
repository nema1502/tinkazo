// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { MARGEN_BASE } from "./music-margen";
import { JUEGOS_DEL_SELECTOR, semillaDelJuego, trazaDelShow, type PasoDelGuion, type TrazaDelShow } from "./music-traza";

/**
 * Con la pestaña escondida, el navegador deja los temporizadores en uno por segundo y el show está frenado. La música
 * no se pone a sonar entera en segundo plano: sigue saltándose en silencio, programando solo el margen de siempre
 * (decisión del 2 de noviembre de 2026). Al volver, retoma en el paso que toca por la hora.
 */

/** La hora de arranque de un `start` programado: `Oscillator#3 start 12.5`. */
function arranques(eventos: string[], desde: number, hasta: number): number[] {
  const horas: number[] = [];
  for (const e of eventos.slice(desde, hasta)) {
    const m = /^\S+#\d+ start (-?[\d.]+)/.exec(e);
    if (m) horas.push(Number(m[1]));
  }
  return horas;
}

const guion = (): PasoDelGuion[] => [
  ...Array.from({ length: 60 }, (): PasoDelGuion => ({ ms: 40 })),
  ...Array.from({ length: 8 }, (): PasoDelGuion => ({ ms: 1000, escondida: true })),
  ...Array.from({ length: 40 }, (): PasoDelGuion => ({ ms: 40 })),
];

/** Lo que suena en un tramo de ticks: la hora de cada arranque, con el tick que lo programó. */
function notasDelTramo(t: TrazaDelShow, ticks: TrazaDelShow["porTick"]): { hora: number; programadoEn: number }[] {
  return ticks.flatMap((p) => arranques(t.eventos, p.desde, p.hasta).map((hora) => ({ hora, programadoEn: p.ahora })));
}

/**
 * Lo que tiene que cumplir la música con la pestaña escondida y al volver. Las pruebas de antes ponían solo un tope y
 * pasaban también si no sonaba nada: acá se exige que suene, que avance con la hora y que al volver retome.
 */
function comprobarLaPestanaEscondida(t: TrazaDelShow): void {
  const escondidos = t.porTick.filter((p) => p.escondida);
  expect(escondidos).toHaveLength(8);
  const notas = notasDelTramo(t, escondidos);
  // Sigue saltándose en silencio: programa solo el margen de siempre por delante de la hora de cada tick.
  for (const n of notas) expect(n.hora).toBeLessThanOrEqual(n.programadoEn + MARGEN_BASE + 0.35);
  // Suena: en varios ticks de los ocho hay notas (un paso sin notas es posible, ocho seguidos no).
  const ticksConNotas = escondidos.filter((p) => arranques(t.eventos, p.desde, p.hasta).length > 0).length;
  expect(ticksConNotas).toBeGreaterThanOrEqual(3);
  // Avanza con la hora: el compás no se queda repitiendo el mismo paso, llega hasta el final del tramo escondido.
  const horas = notas.map((n) => n.hora);
  expect(Math.max(...horas) - Math.min(...horas)).toBeGreaterThan(4);
  const ultimoEscondido = escondidos[escondidos.length - 1]!;
  expect(Math.max(...horas)).toBeGreaterThan(ultimoEscondido.ahora - 1.5);

  // Al volver retoma en el paso que toca por la hora: suena enseguida, sin repetir lo que ya pasó ni amontonar lo atrasado.
  const volvio = t.porTick.slice(t.porTick.indexOf(ultimoEscondido) + 1);
  const alVolver = notasDelTramo(t, volvio.slice(0, 10));
  expect(alVolver.length).toBeGreaterThan(0);
  const primera = volvio[0]!;
  for (const n of alVolver) {
    expect(n.hora).toBeGreaterThanOrEqual(primera.ahora - 0.15);
    expect(n.hora).toBeLessThanOrEqual(n.programadoEn + MARGEN_BASE + 0.35);
  }
  // Sigue sonando el resto del show.
  expect(notasDelTramo(t, volvio).length).toBeGreaterThan(alVolver.length);
}

describe("la música con la pestaña escondida", () => {
  it.each(JUEGOS_DEL_SELECTOR)("%s: no programa más allá del margen de siempre mientras la pestaña no se ve, suena y retoma al volver", async (juego) => {
    comprobarLaPestanaEscondida(await trazaDelShow(juego, semillaDelJuego(juego), guion()));
  });

  it.each(JUEGOS_DEL_SELECTOR)("%s: con el adelgazado prendido sigue saltándose en silencio con la pestaña escondida", async (juego) => {
    comprobarLaPestanaEscondida(
      await trazaDelShow(juego, semillaDelJuego(juego), guion(), async () => {
        (await import("./music-margen")).prenderAdelgazado(true);
      }),
    );
  });
});
