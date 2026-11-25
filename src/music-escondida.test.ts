// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { MARGEN_BASE } from "./music-margen";
import { trazaDelShow, type PasoDelGuion } from "./music-traza";

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

describe("la música con la pestaña escondida", () => {
  it.each(["race", "chovena"])("%s: no programa más allá del margen de siempre mientras la pestaña no se ve", async (juego) => {
    const t = await trazaDelShow(juego, 7, guion());
    const escondidos = t.porTick.filter((p) => p.escondida);
    expect(escondidos).toHaveLength(8);
    for (const p of escondidos) {
      // Un paso entero (una semicorchea larga) de holgura sobre el margen: el último paso cabe entero.
      for (const hora of arranques(t.eventos, p.desde, p.hasta)) expect(hora).toBeLessThanOrEqual(p.ahora + MARGEN_BASE + 0.35);
    }
  });
});
