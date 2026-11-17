// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { Registro } from "../protocol/verificacion";
import { contratoOficial, type ContratoOficial } from "../stellar/oficiales";
import { DESFASE_MAX_MS, FRENO_MAX, esperarElGrabado, pausaTras, type SorteoDelEnlace } from "./espectador-cadena";

/**
 * Cómo lee la cadena el celular del espectador (`espectador-cadena.ts`). En un evento, cien celulares empiezan a leer en
 * el mismo segundo (la ronda más el margen), por el mismo wifi, contra los RPC públicos con los que la compu de la sala
 * lanza el sorteo. Si el RPC le corta a esa dirección, también frena a la sala: las lecturas se reparten.
 */

const CONTRATO = contratoOficial("testnet", "CDNWNY26VWXM7ISXJD2OFWDUAPIOAJTR5TMAXFFHWWUHZWGCEWDKYV3A") as ContratoOficial;
const SORTEO: SorteoDelEnlace = { contrato: CONTRATO, id: "42", listHash: "ab".repeat(32), count: 6, numWinners: 1, round: 100 };
const CALCULADO = { randomness: "cd".repeat(32), winners: [3] };

function registro(grabado: boolean): Registro {
  return {
    wasm: "w",
    siguiente: 100,
    sello: { id: "42", organizer: "GAAA", listHash: SORTEO.listHash, count: 6, numWinners: 1, round: 100, sealedAt: 1, meta: "Sorteo", drawn: grabado },
    resultado: grabado ? { raffleId: "42", round: 100, signature: "ee".repeat(48), randomness: CALCULADO.randomness, winners: [3], drawnAt: 2 } : null,
  };
}

/** Un reloj de mentira: dormir lo adelanta, y se anota cada pausa. */
function reloj(): { ahora: () => number; dormir: (ms: number) => Promise<void>; pausas: number[] } {
  let t = 0;
  const pausas: number[] = [];
  return {
    ahora: () => t,
    dormir: async (ms) => {
      pausas.push(ms);
      t += ms;
    },
    pausas,
  };
}

describe("el celular reparte sus lecturas de la cadena", () => {
  it("cada 3 a 5 s al azar el primer minuto, y cada 6 a 10 s después", () => {
    expect(pausaTras(0, () => 0)).toBe(3_000);
    expect(pausaTras(0, () => 0.999)).toBeLessThan(5_000);
    expect(pausaTras(59_000, () => 0.5)).toBe(4_000);
    expect(pausaTras(60_000, () => 0)).toBe(6_000);
    expect(pausaTras(60_000, () => 0.999)).toBeLessThan(10_000);
  });

  it("el primer vistazo sale con un desfase al azar de hasta 3 s: no todos en el mismo segundo", async () => {
    const r = reloj();
    let vueltas = 0;
    const leer = async (): Promise<Registro> => registro(++vueltas >= 3);
    expect(await esperarElGrabado(SORTEO, CALCULADO, { leer, ahora: r.ahora, dormir: r.dormir, azar: () => 0.5 })).toBe("grabado");
    expect(r.pausas[0]).toBe(0.5 * DESFASE_MAX_MS);
    // Después, las pausas de siempre, con su azar.
    expect(r.pausas.slice(1)).toEqual([4_000, 4_000]);
  });

  it("si el RPC dice que son demasiados pedidos, la pausa se duplica hasta ocho veces, y vuelve sola cuando contesta", async () => {
    const r = reloj();
    let vueltas = 0;
    const leer = async (): Promise<Registro> => {
      vueltas++;
      if (vueltas <= 4) throw new Error("rpc 429");
      return registro(vueltas >= 6);
    };
    expect(await esperarElGrabado(SORTEO, CALCULADO, { leer, ahora: r.ahora, dormir: r.dormir, azar: () => 0 })).toBe("grabado");
    // El desfase (0), cuatro 429 que frenan (2, 4 y 8 veces, el tope, dos veces), y la vuelta que contestó, ya pasado
    // el primer minuto, a la pausa de siempre.
    expect(r.pausas).toEqual([0, 6_000, 12_000, 24_000, 3_000 * FRENO_MAX, 6_000]);
  });

  it("un RPC caído sin 429 no frena: se pregunta al otro en la vuelta siguiente, a la pausa de siempre", async () => {
    const r = reloj();
    const vistos: string[] = [];
    let vueltas = 0;
    const leer = async (c: ContratoOficial): Promise<Registro> => {
      vistos.push(c.rpcUrl);
      if (++vueltas <= 2) throw new Error("rpc 503");
      return registro(true);
    };
    expect(await esperarElGrabado(SORTEO, CALCULADO, { leer, ahora: r.ahora, dormir: r.dormir, azar: () => 0 })).toBe("grabado");
    expect(r.pausas).toEqual([0, 3_000, 3_000]);
    expect(new Set(vistos).size).toBe(2);
  });
});
