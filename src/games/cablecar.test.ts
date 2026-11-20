import { beforeAll, describe, expect, it, vi } from "vitest";

/**
 * El final del teleférico en el motor de respaldo (`cablecar.ts`, con
 * `?motor=clasico` o sin WebGL).
 *
 * El contrato es el mismo que el del motor nuevo (`pixi/cablecar-plan.test.ts`
 * y `pixi/premios-muchos.test.ts`): a la cumbre llegan exactamente quienes
 * ganan, con un premio y con muchos, en una sola cabina. Con un premio, el
 * plan es el de siempre: la mitad se baja en cada parada hasta quedar uno.
 */

let planCableCarClasico: typeof import("./cablecar").planCableCarClasico;
let T_DOCK: number;
beforeAll(async () => {
  // El plan toma `clamp` de overlay.ts, que lee `location` al cargarse.
  vi.stubGlobal("location", { search: "" });
  ({ planCableCarClasico, T_DOCK } = await import("./cablecar"));
}, 60_000);

function rngDe(semilla: number): () => number {
  let a = semilla >>> 0;
  return () => {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Pares (personas, premios): uno, varios, la mitad, casi todos y todos. */
const PARES: ReadonlyArray<readonly [number, number]> = [
  [20, 1], [33, 2], [40, 3], [64, 8], [100, 10], [150, 50], [33, 33], [200, 200],
];
/** Quiénes ganan: repartidos por la lista, distintos y en un orden fijo. */
const ganadoresDe = (n: number, k: number): number[] =>
  Array.from({ length: k }, (_, i) => (3 + i * 7) % n).filter((v, i, a) => a.indexOf(v) === i);

describe("el final del teleférico clásico", () => {
  it.each(PARES)("con %i personas y %i premios, a la cumbre llegan exactamente quienes ganan", (n, k) => {
    const gs = ganadoresDe(n, k);
    const P = planCableCarClasico(Array.from({ length: n }, (_, i) => `Persona ${i + 1}`), gs, rngDe(3));
    // Los primeros del orden de bajada son los ganadores: nadie con premio se baja nunca.
    expect([...P.rank.slice(0, gs.length)].sort((a, b) => a - b)).toEqual([...gs].sort((a, b) => a - b));
    for (let r = 0; r < P.R; r++) {
      for (const i of P.rank.slice(P.left[r + 1] as number, P.left[r] as number)) {
        expect(gs).not.toContain(i);
      }
    }
    expect(P.leftAt(T_DOCK)).toBe(gs.length);
    // En una sola cabina, con todos los que ganan.
    expect(P.aboard(P.winnerCab, T_DOCK)).toHaveLength(gs.length);
    // Y en el resto del convoy no quedó nadie: sumadas todas las cabinas, siguen los que ganan.
    const arriba = Array.from({ length: P.C }, (_, cab) => P.aboard(cab, T_DOCK).length).reduce((a, b) => a + b, 0);
    expect(arriba).toBe(gs.length);
  });

  it("con varios premios, la junta pasa los demás premios a la cabina del ganador apenas bajan los que deciden", () => {
    const n = 40;
    const gs = ganadoresDe(n, 3);
    const P = planCableCarClasico(Array.from({ length: n }, (_, i) => `Persona ${i + 1}`), gs, rngDe(7));
    expect(Number.isFinite(P.tJunta)).toBe(true);
    // Antes de la junta, la cabina del ganador lleva al primero y los otros premios van en las suyas.
    expect(P.aboard(P.winnerCab, P.tJunta - 0.01)).toEqual([gs[0]]);
    // Después de volar, suben todos juntos.
    const despues = P.aboard(P.winnerCab, P.tJunta + 0.6);
    expect([...despues].sort((a, b) => a - b)).toEqual([...gs].sort((a, b) => a - b));
  });

  it("con un premio, el horario es el de siempre: la mitad se baja en cada parada hasta quedar uno", () => {
    for (const n of [16, 20, 33, 100, 200]) {
      const P = planCableCarClasico(Array.from({ length: n }, (_, i) => `Persona ${i + 1}`), [n - 1], rngDe(5));
      const esperado: number[] = [n];
      while ((esperado[esperado.length - 1] as number) > 1) esperado.push(Math.ceil((esperado[esperado.length - 1] as number) / 2));
      expect(P.left).toEqual(esperado);
      expect(P.rank[0]).toBe(n - 1);
      expect(P.aboard(P.winnerCab, T_DOCK)).toEqual([n - 1]);
    }
  });

  it("la misma semilla arma el mismo plan, con uno y con varios premios", () => {
    const nombres = Array.from({ length: 40 }, (_, i) => `Persona ${i + 1}`);
    for (const gs of [[7], [1, 2, 3]]) {
      const a = planCableCarClasico(nombres, gs, rngDe(9));
      const b = planCableCarClasico(nombres, gs, rngDe(9));
      expect(a.rank).toEqual(b.rank);
      expect(a.left).toEqual(b.left);
    }
  });
});
