import { describe, expect, it } from "vitest";
import { elegirAlAzar, pausasDe, type JuegoAzar } from "./azar";

/**
 * El «Al azar» del panel Elegí el juego (`azar.ts`): elige con semilla entre
 * los juegos que encajan con la cantidad de personas, y arma el recorrido de
 * resaltados de la animación (tipo ruleta, desacelerando) que termina en el
 * elegido.
 *
 * Es un módulo puro: nada de `Math.random`, ni `Date.now`, ni DOM. Dado el
 * mismo catálogo, la misma cantidad de personas y la misma semilla, sale
 * siempre lo mismo: la elegibilidad y el orden de la animación se pueden
 * reproducir en pruebas. El sorteo de verdad (el ganador) no pasa por acá: lo
 * fija el protocolo antes de que exista este botón.
 */

/** Los rangos de `ui/recomendar.ts` (los que muestra el selector), tal cual. */
const CATALOGO: JuegoAzar[] = [
  { game: "race", rango: { minimo: 2, maximo: 200 } },
  { game: "sapo", rango: { minimo: 2, maximo: 40 } },
  { game: "trompo", rango: { minimo: 2, maximo: 14 } },
  { game: "chovena", rango: { minimo: 8, maximo: 80 } },
  { game: "teleferico", rango: { minimo: 16, maximo: 200 } },
  { game: "wheel", rango: { maximo: 200 } },
  { game: "pinata", rango: { maximo: 200 } },
];

const juegoDe = (azar: ReturnType<typeof elegirAlAzar>, indice: number): string => {
  const e = azar.recorrido[indice];
  return CATALOGO[e?.indice ?? -1]?.game ?? `#${e?.indice}`;
};

describe("la elegibilidad por rango", () => {
  it("con 3 participantes nunca salen Chovena (8–80) ni Teleférico (16–200)", () => {
    const prohibidos = new Set(["chovena", "teleferico"]);
    for (let semilla = 0; semilla < 400; semilla++) {
      const { elegido } = elegirAlAzar(CATALOGO, 3, semilla);
      expect(elegido?.game).toBeDefined();
      expect(prohibidos.has(elegido?.game ?? "")).toBe(false);
    }
  });

  it("con 3 salen todos los que encajan (race, sapo, trompo, wheel, piñata), no uno solo", () => {
    const salieron = new Set<string>();
    for (let semilla = 0; semilla < 300; semilla++) {
      const { elegido } = elegirAlAzar(CATALOGO, 3, semilla);
      salieron.add(elegido?.game ?? "");
    }
    expect([...salieron].sort()).toEqual(["pinata", "race", "sapo", "trompo", "wheel"]);
  });

  it("la elección es parejita entre los que encajan: ninguna queda casi siempre o casi nunca", () => {
    const cuentas = new Map<string, number>();
    for (let semilla = 0; semilla < 300; semilla++) {
      const { elegido } = elegirAlAzar(CATALOGO, 3, semilla);
      cuentas.set(elegido?.game ?? "", (cuentas.get(elegido?.game ?? "") ?? 0) + 1);
    }
    // Esperado: 60 por juego. Un sesgo de semilla (el resto del hash, por
    // ejemplo) dejaría a alguna por debajo de 10 sin necesidad de chi-cuadrado.
    for (const game of ["race", "sapo", "trompo", "wheel", "pinata"]) {
      expect(cuentas.get(game) ?? 0).toBeGreaterThanOrEqual(10);
    }
  });

  it("los bordes del rango cuentan: con 8 Chovena puede salir, con 81 ya no", () => {
    const saleCon8 = new Set<string>();
    for (let semilla = 0; semilla < 200; semilla++) saleCon8.add(elegirAlAzar(CATALOGO, 8, semilla).elegido?.game ?? "");
    expect(saleCon8).toContain("chovena");
    for (let semilla = 0; semilla < 200; semilla++) {
      const { elegido } = elegirAlAzar(CATALOGO, 81, semilla);
      expect(elegido?.game).not.toBe("chovena");
    }
  });
});

describe("la determinismo con semilla", () => {
  it("la misma semilla da siempre el mismo elegido y el mismo recorrido", () => {
    for (const semilla of [0, 1, 42, 12345, 2147483647]) {
      const a = elegirAlAzar(CATALOGO, 12, semilla);
      const b = elegirAlAzar(CATALOGO, 12, semilla);
      expect(b).toEqual(a);
    }
  });

  it("semillas distintas no quedan clavadas en un mismo juego", () => {
    const elegidos = new Set<string>();
    for (let semilla = 0; semilla < 50; semilla++) elegidos.add(elegirAlAzar(CATALOGO, 12, semilla).elegido?.game ?? "");
    expect(elegidos.size).toBeGreaterThan(1);
  });
});

describe("el recorrido de la animación", () => {
  it("el último resaltado es siempre el juego elegido", () => {
    for (let semilla = 0; semilla < 100; semilla++) {
      for (const n of [3, 8, 30, 150]) {
        const azar = elegirAlAzar(CATALOGO, n, semilla);
        const ultimo = azar.recorrido[azar.recorrido.length - 1];
        expect(ultimo?.indice).toBe(CATALOGO.findIndex((j) => j.game === azar.elegido?.game));
      }
    }
  });

  it("el recorrido recorre varias tarjetas antes de quedar (no cae de una)", () => {
    for (let semilla = 0; semilla < 50; semilla++) {
      expect(elegirAlAzar(CATALOGO, 12, semilla).recorrido.length).toBeGreaterThanOrEqual(5);
    }
  });

  it("entre dos y tres segundos en total, y desacelera: las pausas crecen y el final es el más lento", () => {
    for (const n of [3, 12, 30, 100]) {
      const azar = elegirAlAzar(CATALOGO, n, 7);
      const pausas = azar.recorrido.map((p) => p.pausa);
      const total = pausas.reduce((a: number, b) => a + b, 0);
      expect(total).toBeGreaterThanOrEqual(2000);
      expect(total).toBeLessThanOrEqual(3200);
      // No acelera: cada resaltado se sostiene al menos lo que el anterior.
      for (let i = 1; i < pausas.length; i++) expect(pausas[i] ?? 0).toBeGreaterThanOrEqual(pausas[i - 1] ?? 0);
      // Y frena de verdad: el final se sostiene más del doble que el arranque.
      expect(pausas[pausas.length - 1] ?? 0).toBeGreaterThan((pausas[0] ?? 0) * 2);
      // Los últimos tres pasos frenan de a poco, uno tras otro.
      const fin = pausas.slice(-3);
      expect(fin[1] ?? 0).toBeGreaterThan(fin[0] ?? 0);
      expect(fin[2] ?? 0).toBeGreaterThan(fin[1] ?? 0);
    }
  });

  it("con un solo juego que encaja, igual recorre y queda en él", () => {
    const solo: JuegoAzar[] = [CATALOGO[0] ?? { game: "race", rango: { minimo: 2, maximo: 200 } }];
    const { elegido, recorrido } = elegirAlAzar(solo, 3, 9);
    expect(elegido?.game).toBe("race");
    expect(recorrido.length).toBeGreaterThanOrEqual(1);
    expect(recorrido[recorrido.length - 1]?.indice).toBe(0);
    expect(juegoDe({ elegido, recorrido } as ReturnType<typeof elegirAlAzar>, recorrido.length - 1)).toBe("race");
  });

  it("con ninguna cantidad que encaje, no elige nada", () => {
    const cortos: JuegoAzar[] = [
      { game: "chovena", rango: { minimo: 8, maximo: 80 } },
      { game: "teleferico", rango: { minimo: 16, maximo: 200 } },
    ];
    const { elegido, recorrido } = elegirAlAzar(cortos, 3, 1);
    expect(elegido).toBeNull();
    expect(recorrido).toEqual([]);
  });
});

describe("las pausas (`pausasDe`)", () => {
  it("una pausa por paso, todas positivas", () => {
    for (const pasos of [1, 2, 5, 10, 16, 23]) {
      const pausas = pausasDe(pasos);
      expect(pausas).toHaveLength(pasos);
      expect(pausas.every((p) => p > 0)).toBe(true);
    }
  });

  it("sin pasos no hay pausas", () => {
    expect(pausasDe(0)).toEqual([]);
  });
});
