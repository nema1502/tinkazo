import { describe, expect, it } from "vitest";
import { DURACION, GRADO_MAX, HZ_MAX, HZ_MIN, VOLUMEN, VOL_MIN, crearSonido, problemasDeTono, type Timbre, type Voz } from "./sonido";

/** La pentatónica de `src/sound.ts`, para comprobar afinación sin cargar el audio. */
const nota = (grado: number): number => {
  const escala = [0, 2, 4, 7, 9];
  const d = Math.max(0, Math.round(grado));
  return 130.81 * Math.pow(2, ((escala[d % 5] ?? 0) + 12 * Math.floor(d / 5)) / 12);
};

interface Toque {
  hz: number;
  dur: number;
  timbre: Timbre;
  vol: number;
}

function vozFalsa(): { voz: Voz; toques: Toque[]; agenda: { ms: number }[]; fanfarias: () => number } {
  const toques: Toque[] = [];
  const agenda: { ms: number }[] = [];
  let fanfarias = 0;
  const voz: Voz = {
    tono: (hz, dur, timbre, vol) => toques.push({ hz, dur, timbre, vol }),
    nota,
    fanfarria: () => void fanfarias++,
    // Se ejecuta de una, anotando para cuándo era.
    despues: (ms, fn) => {
      agenda.push({ ms });
      fn();
    },
  };
  return { voz, toques, agenda, fanfarias: () => fanfarias };
}

describe("sonido: afinación y registro", () => {
  it("los 21 grados caen entre 128 y 2.150 Hz, y el 21 ya se pasa", () => {
    for (let g = 0; g <= GRADO_MAX; g++) {
      expect(nota(g)).toBeGreaterThanOrEqual(HZ_MIN);
      expect(nota(g)).toBeLessThanOrEqual(HZ_MAX);
    }
    expect(nota(GRADO_MAX + 1)).toBeGreaterThan(HZ_MAX);
  });

  it("un grado fuera de rango se acota: nunca suena fuera de la escala ni del registro", () => {
    const { voz, toques } = vozFalsa();
    const s = crearSonido(voz);
    s.tono(25, "evento");
    s.tono(-3, "evento");
    s.tono(2.6, "evento");
    expect(toques.map((x) => x.hz)).toEqual([nota(20), nota(0), nota(3)]);
    for (const x of toques) {
      expect(x.hz).toBeGreaterThanOrEqual(HZ_MIN);
      expect(x.hz).toBeLessThanOrEqual(HZ_MAX);
    }
  });
});

describe("sonido: volumen por categoría", () => {
  it("sin volumen pedido, cada categoría suena en su tramo y nunca bajo el murmullo", () => {
    const { voz, toques } = vozFalsa();
    const s = crearSonido(voz);
    for (const cat of ["fondo", "evento", "climax"] as const) s.tono(7, cat);
    toques.forEach((x, i) => {
      const [lo, hi] = VOLUMEN[(["fondo", "evento", "climax"] as const)[i] as "fondo"];
      expect(x.vol).toBeGreaterThanOrEqual(lo);
      expect(x.vol).toBeLessThanOrEqual(hi);
      expect(x.vol).toBeGreaterThanOrEqual(VOL_MIN);
    });
    expect(toques.map((x) => x.dur)).toEqual([DURACION.fondo, DURACION.evento, DURACION.climax]);
  });

  it("un volumen pedido muy bajo se sube a lo audible", () => {
    const { voz, toques } = vozFalsa();
    crearSonido(voz).tono(3, "fondo", { vol: 0.001 });
    expect(toques[0]?.vol).toBe(VOL_MIN);
  });

  it("las categorías no se pisan entre sí", () => {
    expect(VOLUMEN.fondo[1]).toBeLessThan(VOLUMEN.evento[0]);
    expect(VOLUMEN.evento[1]).toBeLessThan(VOLUMEN.climax[0]);
  });

  it("problemasDeTono marca grado, volumen y duración que rompen las reglas", () => {
    expect(problemasDeTono(7, "evento", { vol: 0.05, dur: 0.1 })).toEqual([]);
    expect(problemasDeTono(21, "evento")).toHaveLength(1);
    expect(problemasDeTono(7, "evento", { vol: 0.09 })).toHaveLength(1);
    expect(problemasDeTono(7, "fondo", { vol: 0.01 })).toHaveLength(2);
    expect(problemasDeTono(7, "fondo", { dur: 0 })).toHaveLength(1);
  });
});

describe("sonido: los gestos", () => {
  it("una(clave) deja pasar solo la primera vez", () => {
    const { voz } = vozFalsa();
    const s = crearSonido(voz);
    let n = 0;
    expect(s.una("ola", () => n++)).toBe(true);
    expect(s.una("ola", () => n++)).toBe(false);
    expect(s.una("otra", () => n++)).toBe(true);
    expect(n).toBe(2);
  });

  it("el tic alterna dos notas y el latido suena arriba y abajo", () => {
    const { voz, toques } = vozFalsa();
    const s = crearSonido(voz);
    s.tic(1);
    s.tic(2);
    s.latido();
    expect(toques.map((x) => x.hz)).toEqual([nota(10), nota(12), nota(5), nota(0)]);
  });

  it("la escalera reparte las notas cada paso", () => {
    const { voz, toques, agenda } = vozFalsa();
    crearSonido(voz).escalera([7, 8, 9, 7], 70);
    expect(agenda.map((a) => a.ms)).toEqual([0, 70, 140, 210]);
    expect(toques.map((x) => x.hz)).toEqual([nota(7), nota(8), nota(9), nota(7)]);
  });

  it("la fanfarria pone el cuerpo, el remate y el adorno a los 520 ms", () => {
    const { voz, toques, agenda, fanfarias } = vozFalsa();
    crearSonido(voz).fanfarria();
    expect(fanfarias()).toBe(1);
    expect(toques.map((x) => x.hz)).toEqual([nota(0), nota(17)]);
    expect(toques[0]?.vol).toBe(0.09);
    expect(agenda.map((a) => a.ms)).toEqual([520]);
  });

  it("despues() pasa el aviso a la voz: la segunda nota de un acorde que se arma de a poco", () => {
    const { voz, toques, agenda } = vozFalsa();
    const s = crearSonido(voz);
    s.despues(110, () => s.tono(12, "evento", { dur: 0.3, vol: 0.05 }));
    expect(agenda.map((a) => a.ms)).toEqual([110]);
    expect(toques.map((x) => x.hz)).toEqual([nota(12)]);
  });

  it("el latido suena con los volúmenes de siempre: 0,045 arriba y 0,035 abajo", () => {
    const { voz, toques } = vozFalsa();
    crearSonido(voz).latido();
    expect(toques.map((x) => x.vol)).toEqual([0.045, 0.035]);
  });

  it("fase() va de 0 a 1 entre dos segundos de juego", () => {
    const s = crearSonido(vozFalsa().voz);
    expect(s.fase(1, 2, 4)).toBe(0);
    expect(s.fase(3, 2, 4)).toBe(0.5);
    expect(s.fase(9, 2, 4)).toBe(1);
    expect(s.fase(1, 2, 2)).toBe(0);
    expect(s.fase(2, 2, 2)).toBe(1);
  });
});
