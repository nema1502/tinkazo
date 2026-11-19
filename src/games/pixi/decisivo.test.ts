// @vitest-environment jsdom
// (El plan del teleférico toma `clamp` de overlay.ts, que lee `location` al cargarse.)
import { describe, expect, it } from "vitest";
import { writeStory } from "../drama";
import { azarDe, sembrar } from "./kit/azar";
import type { Contexto } from "./kit/tipos";
import { MARGEN_DECISIVO, decisivo, primeraQueDejaSoloPremiados, soloPremiados } from "./decisivo";
import { decisivoDelGuajojo, enPieEn, planGuajojo } from "./guajojo-plan";
import { TEXTOS as TEXTOS_GUAJOJO } from "./guajojo-textos";
import { decisivoDelToborochi, planToborochi } from "./toborochi-plan";
import { TEXTOS as TEXTOS_TOBOROCHI } from "./toborochi-textos";
import { ANTES_DEL_SALTO, decisivoDeLaEntrada, planEntrada } from "./entrada-plan";
import { decisivoDelTeleferico, planCableCar } from "./cablecar-plan";
import { ANTES_DEL_TIRO, decisivoDelSapo, tiemposDeTiros } from "./sapo-tiempos";
import { optsForArc, planThrows } from "./sapo-plan";
import { decisivoDeLaChovena } from "./chovena-nino";
import { ANTES_DEL_CRUCE, planCarrera } from "../llamas/carrera-show";
import { ctxDe } from "../llamas/carrera-prueba";
import { ARCS } from "../drama";

/**
 * El momento decisivo de cada juego (`decisivo.ts`): el celular de quien mira no pasa de ahí sin saber que la sala ya lo
 * pasó. Se comprueba con los hechos de cada plan, con muchas semillas, todos los arcos y 1, 2, 3 y 8 premios: antes del
 * momento decisivo nada nombra a quien gana el primer premio, ni a nadie con premio (nadie se va con su premio y quienes
 * siguen nunca son solo premiados).
 */

const SEMILLAS = Array.from({ length: 12 }, (_, i) => i * 7919 + 3);
const PREMIOS = [1, 2, 3, 8];
/** Los premios de una lista de `n`: `k` distintos, sembrados (el primero es el primer premio). */
function premiosDe(n: number, k: number, semilla: number): number[] {
  const r = sembrar(semilla * 31 + n);
  const todos = Array.from({ length: n }, (_, i) => i);
  for (let i = todos.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [todos[i], todos[j]] = [todos[j] as number, todos[i] as number];
  }
  return todos.slice(0, Math.min(k, n));
}
const hexDe = (s: number): string => Array.from({ length: 8 }, (_, i) => ((s * 2654435761 + i * 40503) >>> 0).toString(16).padStart(8, "0")).join("");

function contexto(n: number, ganadores: number[], semilla: number, textos: Record<string, unknown>): Contexto {
  const rng = sembrar(semilla);
  const ronda = hexDe(semilla);
  return {
    nombres: Array.from({ length: n }, (_, i) => `Persona ${i + 1}`),
    ganadores,
    ronda,
    rng,
    idioma: "es",
    txt: (clave, ...args) => {
      const v = textos[clave];
      return typeof v === "function" ? (v as (...a: unknown[]) => string)(...args) : typeof v === "string" ? v : clave;
    },
    azar: (etiqueta) => azarDe(ronda, etiqueta),
    historia: (actores, ganador) => writeStory(rng, actores, ganador),
  };
}

/** Las horas de 0 a `hasta`, de a 0,05 s. */
const horas = (hasta: number): number[] => Array.from({ length: Math.max(0, Math.floor(hasta / 0.05)) }, (_, i) => i * 0.05);

describe("lo común", () => {
  it("solo premiados: todos los que siguen tienen premio, y queda alguien", () => {
    const p = new Set([1, 4]);
    expect(soloPremiados([1, 4], p)).toBe(true);
    expect(soloPremiados([4], p)).toBe(true);
    expect(soloPremiados([1, 2], p)).toBe(false);
    expect(soloPremiados([], p)).toBe(false);
  });

  it("el primer tramo que deja solo a premiados, y nada con tantos premios como personas (un orden de turnos)", () => {
    const tramos = [
      { desde: 3, siguen: [0, 1, 2, 3] },
      { desde: 6, siguen: [0, 1, 2] },
      { desde: 9, siguen: [0, 1] },
    ];
    expect(primeraQueDejaSoloPremiados(tramos, new Set([0, 1]), 5)).toBe(9);
    expect(primeraQueDejaSoloPremiados(tramos, new Set([0, 1, 2]), 5)).toBe(6);
    expect(primeraQueDejaSoloPremiados(tramos, new Set([0]), 5)).toBe(Infinity);
    expect(primeraQueDejaSoloPremiados(tramos, new Set([0, 1, 2, 3, 4]), 5)).toBe(Infinity);
  });

  it("el momento es el primero de los hechos, con su margen, y nunca antes de empezar", () => {
    expect(decisivo(10, 7, Infinity)).toBeCloseTo(7 - MARGEN_DECISIVO, 9);
    expect(decisivo(0.1)).toBe(0);
    expect(decisivo(Infinity)).toBe(0);
  });
});

describe("la carrera de llamas", () => {
  it("antes de tres segundos de la meta, y antes de que las que siguen sean solo premiadas", { timeout: 120_000 }, () => {
    for (const n of [2, 6, 9, 12, 30, 45]) {
      for (const k of [1, 3, 8]) {
        for (const s of SEMILLAS.slice(0, 3)) {
          const ctx = ctxDe(n, s);
          const ganadores = premiosDe(n, k, s);
          const plan = planCarrera({ ...ctx, ganadores });
          const d = plan.decisivo ?? -1;
          expect(d, `n=${n} k=${k} s=${s}`).toBeGreaterThan(0);
          expect(d).toBeLessThanOrEqual(plan.duracion - ANTES_DEL_CRUCE - MARGEN_DECISIVO + 1e-9);
          // Con menos premios que personas, mientras quedan más que premios nadie queda nombrado por seguir corriendo.
          if (ganadores.length < n) for (const t of horas(d)) expect(plan.marcador(t), `n=${n} k=${k} s=${s} t=${t}`).toBeGreaterThan(ganadores.length);
        }
      }
    }
  });
});

describe("el Guajojó", () => {
  it("antes del último silencio, del susto de la ganadora y de que las que siguen sean solo premiadas", { timeout: 120_000 }, () => {
    const arcos = new Set<string>();
    for (const n of [2, 3, 4, 8, 18, 30, 60]) {
      for (const k of PREMIOS) {
        for (const s of SEMILLAS) {
          const ganadores = premiosDe(n, k, s);
          const plan = planGuajojo(contexto(n, ganadores, s, TEXTOS_GUAJOJO.es as Record<string, unknown>));
          const d = plan.datos;
          arcos.add(d.arco);
          const ultimo = d.ciclos[d.ciclos.length - 1];
          const dec = plan.decisivo ?? -1;
          expect(dec).toBe(decisivoDelGuajojo(d, ganadores));
          // El último silencio: la mirada va a una y a la otra y se queda en la rival.
          if (ultimo) expect(dec).toBeLessThanOrEqual(ultimo.tSil0 - MARGEN_DECISIVO + 1e-9);
          // El susto: la mirada se detiene en la ganadora (tambalea más que nadie y aguanta).
          for (const c of d.ciclos) {
            if (c.ultimo) continue;
            for (const e of c.tambaleos) if (e.quien === d.ganador && !e.cae && e.t1 - e.t0 > 0.7) expect(e.t0).toBeGreaterThan(dec);
          }
          // Mientras no es el momento, quienes siguen de pie nunca son solo premiadas.
          const premiados = new Set(ganadores);
          if (premiados.size < n) for (const t of horas(dec)) expect(soloPremiados(enPieEn(d, t), premiados), `n=${n} k=${k} s=${s} t=${t}`).toBe(false);
        }
      }
    }
    expect(arcos.size).toBe(ARCS.length);
  });
});

describe("el Toborochi", () => {
  it("antes del colibrí, de la primera que se va con premio y de que las que siguen sean solo premiadas", { timeout: 120_000 }, () => {
    for (const n of [2, 3, 5, 8, 18, 30, 60]) {
      for (const k of PREMIOS) {
        for (const s of SEMILLAS) {
          const ganadores = premiosDe(n, k, s);
          const plan = planToborochi(contexto(n, ganadores, s, TEXTOS_TOBOROCHI.es as Record<string, unknown>));
          const d = plan.datos;
          const dec = plan.decisivo ?? -1;
          expect(dec).toBe(decisivoDelToborochi(d, ganadores));
          expect(dec).toBeLessThanOrEqual(d.tColibri0 - MARGEN_DECISIVO + 1e-9);
          for (const c of d.calmas) for (const p of c.premios) expect(p.t, `n=${n} k=${k} s=${s}`).toBeGreaterThan(dec);
          const premiados = new Set(ganadores);
          if (premiados.size < n) {
            for (const t of horas(dec)) expect(soloPremiados(plan.respuestas(t).adelante.quienes, premiados), `n=${n} k=${k} s=${s} t=${t}`).toBe(false);
          }
        }
      }
    }
  });
});

describe("La Entrada", () => {
  it("antes del salto que cae, de un arco de premiados y de que la comparsa sea solo premiados", () => {
    for (const n of [2, 3, 5, 8, 12, 18, 30]) {
      for (const k of PREMIOS) {
        for (const s of SEMILLAS) {
          const ganadores = premiosDe(n, k, s);
          const P = planEntrada(n, ganadores, sembrar(s));
          const dec = decisivoDeLaEntrada(P);
          const cae = P.jumps.find((j) => j.stumble === "fall");
          if (cae) expect(dec).toBeLessThanOrEqual(cae.t - ANTES_DEL_SALTO - MARGEN_DECISIVO + 1e-9);
          const premiados = new Set(ganadores);
          const fuera = new Set<number>();
          for (const a of P.arches) {
            for (const i of a.exit.ids) fuera.add(i);
            if (a.t > dec) continue;
            // Un arco antes del momento: ni se quedan solo premiados, ni deja solo a premiados.
            if (premiados.size < n) {
              expect(a.exit.ids.length > 0 && a.exit.ids.every((i) => premiados.has(i)), `n=${n} k=${k} s=${s}`).toBe(false);
              const siguen = Array.from({ length: n }, (_, i) => i).filter((i) => !fuera.has(i));
              expect(soloPremiados(siguen, premiados)).toBe(false);
            }
          }
        }
      }
    }
  });
});

describe("el teleférico", () => {
  it("antes de la parada que deja arriba solo a quienes ganan, desde que el convoy llega", () => {
    for (const n of [2, 3, 5, 8, 12, 18, 30, 60]) {
      for (const k of PREMIOS) {
        for (const s of SEMILLAS) {
          const ganadores = premiosDe(n, k, s);
          const P = planCableCar(Array.from({ length: n }, (_, i) => `P${i}`), ganadores, sembrar(s));
          const dec = decisivoDelTeleferico(P, ganadores);
          const ultima = P.stops[P.stops.length - 1];
          if (ultima) expect(dec).toBeLessThanOrEqual(ultima.t0 - MARGEN_DECISIVO + 1e-9);
          // Quienes siguen arriba en cada hora antes del momento (se bajan en el `tOff` de su parada): nunca solo premiados.
          const premiados = new Set(ganadores);
          if (premiados.size >= n) continue;
          for (const t of horas(dec)) {
            const siguen = Array.from({ length: n }, (_, i) => i).filter((i) => {
              const r = P.offAt.get(i);
              const st = r === undefined ? undefined : P.stops.find((x) => x.round === r);
              return !st || st.tOff > t;
            });
            expect(soloPremiados(siguen, premiados), `n=${n} k=${k} s=${s} t=${t}`).toBe(false);
          }
        }
      }
    }
  });
});

describe("el sapo", () => {
  it("antes de la primera argolla que entra: con varios premios, también antes del primero", () => {
    for (const n of [2, 3, 5, 8, 12]) {
      for (const k of PREMIOS) {
        if (k > n) continue;
        for (const s of SEMILLAS) {
          for (const arco of ARCS) {
            const slots = premiosDe(n, k, s);
            const tiros = planThrows(n, slots, sembrar(s), optsForArc(arco), true);
            const linea = tiemposDeTiros(tiros, slots.length - 1, 4);
            const conHora = tiros.map((th, i) => ({ kind: th.kind, start: (linea.tiros[i] as { start: number }).start, land: (linea.tiros[i] as { land: number }).land }));
            const dec = decisivoDelSapo(conHora);
            for (const x of conHora) if (x.kind === "hit") expect(x.start, `n=${n} k=${k} s=${s} ${arco}`).toBeGreaterThanOrEqual(dec + ANTES_DEL_TIRO + MARGEN_DECISIVO - 1e-9);
            expect(dec).toBeLessThan(linea.corona);
          }
        }
      }
    }
  });
});

describe("la chovena", () => {
  /** Cortes como los arma el juego: los que no ganan primero, después los premiados del último al segundo. */
  const cortes = [
    { kind: "stop", s0: 5, victims: [5, 6, 7] },
    { kind: "fake", s0: 8, victims: [] },
    { kind: "stop", s0: 11, victims: [4, 3] },
    { kind: "stop", s0: 14, victims: [2] },
  ];
  it("con un premio, el corte de la final", () => {
    expect(decisivoDeLaChovena(8, new Set([0]), cortes, 20)).toBeCloseTo(20 - MARGEN_DECISIVO, 9);
  });
  it("con varios, el corte que deja solo a premiados, desde que se corta la música", () => {
    // Premios 0, 1 y 2: el corte de los 11 s deja a 0, 1 y 2.
    expect(decisivoDeLaChovena(8, new Set([0, 1, 2]), cortes, 20)).toBeCloseTo(11 - MARGEN_DECISIVO, 9);
    // Premios 0 y 1: el de los 14 s deja a la final, que son los dos premiados.
    expect(decisivoDeLaChovena(8, new Set([0, 1]), cortes, 20)).toBeCloseTo(14 - MARGEN_DECISIVO, 9);
  });
  it("un orden de turnos (todos con premio): cada salida dice un puesto, desde el primer corte", () => {
    expect(decisivoDeLaChovena(8, new Set([0, 1, 2, 3, 4, 5, 6, 7]), cortes, 20)).toBeCloseTo(5 - MARGEN_DECISIVO, 9);
  });
});
