import { beforeAll, describe, expect, it, vi } from "vitest";
import { writeStory } from "../drama";
import { azarDe, sembrar } from "./kit/azar";
import type { Contexto } from "./kit/tipos";
import { planEntrada } from "./entrada-plan";
import { planGuajojo } from "./guajojo-plan";
import { TEXTOS as TEXTOS_GUAJOJO } from "./guajojo-textos";
import { planToborochi } from "./toborochi-plan";
import { TEXTOS as TEXTOS_TOBOROCHI } from "./toborochi-textos";
import { planQualifier } from "./qualifier";
import { SAPO_MAX } from "./sapo-plan";
import { MAX_WINNERS } from "../../protocol/select";

/**
 * Los juegos con eliminación frente a muchos premios (el contrato admite hasta `MAX_WINNERS`, 100).
 *
 * La carrera (ocho) y el sapo (doce) tienen un tope duro y el recomendador los saca (`Rango.premios`, `recomendar.ts`).
 * Los demás no tienen ninguno, y esta prueba lo sostiene en lo que se puede probar sin navegador: que el plan de cada uno
 * se arme, con 50 y con 100 premios, sin tirar un error ni dar tiempos que no sean números. Cómo se ve el show con tantos
 * premiados no lo mide ninguna prueba de acá: se mira con un navegador.
 */

const RONDA = "6e049991d7e23bdc566d3adfff08cd81798c644bc54dd5daa18eb0a8938b2829";

function contexto(n: number, ganadores: number[], textos: unknown): Contexto {
  const rng = sembrar(7);
  return {
    nombres: Array.from({ length: n }, (_, i) => `Persona ${i + 1}`),
    ganadores,
    ronda: RONDA,
    rng,
    idioma: "es",
    txt: (clave: string, ...args: unknown[]) => {
      const v = (textos as { es: Record<string, unknown> }).es[clave];
      return typeof v === "function" ? (v as (...a: unknown[]) => string)(...args) : ((v as string | undefined) ?? clave);
    },
    azar: (etiqueta: string) => azarDe(RONDA, etiqueta),
    historia: (actores: number, ganador: number) => writeStory(rng, actores, ganador),
  } as unknown as Contexto;
}

function rngDe(semilla: number): () => number {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Pares (personas, premios): pocos, la mitad, casi todos y todos (el modo orden), hasta el tope. */
const PARES: ReadonlyArray<readonly [number, number]> = [[33, 33], [40, 33], [60, 50], [64, 64], [100, 50], [100, MAX_WINNERS], [150, MAX_WINNERS], [200, MAX_WINNERS]];
/** Quiénes ganan: repartidos por la lista, distintos y en un orden fijo. */
const ganadoresDe = (n: number, k: number): number[] => Array.from({ length: k }, (_, i) => (3 + i * 7) % n).filter((v, i, a) => a.indexOf(v) === i);

let planCableCar: typeof import("./cablecar-plan").planCableCar;
beforeAll(async () => {
  // El plan del teleférico toma `clamp` de overlay.ts, que lee `location` al cargarse.
  vi.stubGlobal("location", { search: "" });
  ({ planCableCar } = await import("./cablecar-plan"));
}, 60_000);

describe("los juegos sin tope de premios arman su plan con muchos premios", () => {
  it.each(PARES)("La Entrada, con %i personas y %i premios: cada premiado se va con premio", (n, k) => {
    const gs = ganadoresDe(n, k);
    const P = planEntrada(n, gs, rngDe(5));
    const premios = P.arches.reduce((a, x) => a + x.exit.prizes, 0);
    expect(premios + (gs.slice(1).includes(P.rival) ? 1 : 0)).toBe(gs.length - 1);
  });

  it.each(PARES)("el teleférico, con %i personas y %i premios: el primero llega arriba", (n, k) => {
    const gs = ganadoresDe(n, k);
    const P = planCableCar(Array.from({ length: n }, (_, i) => `Persona ${i + 1}`), gs, rngDe(3));
    expect(P.rank.slice(0, 2)).toContain(gs[0]);
  });

  it.each(PARES)("Guajojó, con %i personas y %i premios: el plan tiene duración", (n, k) => {
    const p = planGuajojo(contexto(n, ganadoresDe(n, k), TEXTOS_GUAJOJO));
    expect(Number.isFinite(p.duracion)).toBe(true);
    expect(p.duracion).toBeGreaterThan(0);
  });

  it.each(PARES)("Toborochi, con %i personas y %i premios: el plan tiene duración", (n, k) => {
    const p = planToborochi(contexto(n, ganadoresDe(n, k), TEXTOS_TOBOROCHI));
    expect(Number.isFinite(p.duracion)).toBe(true);
    expect(p.duracion).toBeGreaterThan(0);
  });
});

describe("el sapo sí tiene tope: la clasificatoria rechaza más premios que agujeros", () => {
  it("con doce premios arma la final; con trece lanza, y por eso el recomendador lo saca", () => {
    const rng = rngDe(1);
    expect(() => planQualifier(40, ganadoresDe(40, SAPO_MAX), SAPO_MAX, rng)).not.toThrow();
    expect(() => planQualifier(40, ganadoresDe(40, SAPO_MAX + 1), SAPO_MAX, rng)).toThrow();
  });
});
