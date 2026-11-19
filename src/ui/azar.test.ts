import { describe, expect, it } from "vitest";
import { QUEDA_MS, elegirAlAzar, enRueda, pausasDe, posiblesDe, type JuegoAzar } from "./azar";

/**
 * El botón Sorprendeme del panel Elegí el juego (`azar.ts`): elige con semilla entre
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

describe("los juegos posibles (`posiblesDe`)", () => {
  it("son los que encajan con la gente, en el orden del catálogo", () => {
    // Con 7 la Chovena (desde 8) y el Teleférico (desde 16) no encajan.
    expect(posiblesDe(CATALOGO, 7).map((j) => j.game)).toEqual(["race", "sapo", "trompo", "wheel", "pinata"]);
    expect(posiblesDe(CATALOGO, 30).map((j) => j.game)).toEqual(["race", "sapo", "chovena", "teleferico", "wheel", "pinata"]);
  });

  it("con más de doscientas personas no queda ninguno: ningún juego pasa de 200", () => {
    for (const n of [201, 250, 1000]) expect(posiblesDe(CATALOGO, n), String(n)).toEqual([]);
    expect(elegirAlAzar(CATALOGO, 250, 3)).toEqual({ elegido: null, recorrido: [] });
  });

  it("con una sola persona tampoco: el mínimo de todos es 2", () => {
    expect(posiblesDe(CATALOGO, 1)).toEqual([]);
  });
});

describe("no repetir el juego que ya estaba elegido", () => {
  it("con dos o más posibles, nunca cae en el excluido y los demás siguen saliendo parejo", () => {
    const cuentas = new Map<string, number>();
    for (let semilla = 0; semilla < 600; semilla++) {
      const { elegido } = elegirAlAzar(CATALOGO, 3, semilla, "race");
      expect(elegido?.game).not.toBe("race");
      cuentas.set(elegido?.game ?? "", (cuentas.get(elegido?.game ?? "") ?? 0) + 1);
    }
    // Quedan cuatro (sapo, trompo, wheel, pinata): esperado 150 por juego.
    expect([...cuentas.keys()].sort()).toEqual(["pinata", "sapo", "trompo", "wheel"]);
    for (const [game, cuantas] of cuentas) expect(cuantas, game).toBeGreaterThanOrEqual(80);
  });

  it("el excluido sigue en el camino de la ruleta: recorre todas las tarjetas posibles, no solo las otras", () => {
    const vistas = new Set<string>();
    for (let semilla = 0; semilla < 40; semilla++) {
      for (const p of elegirAlAzar(CATALOGO, 3, semilla, "race").recorrido) vistas.add(CATALOGO[p.indice]?.game ?? "");
    }
    expect(vistas).toContain("race");
  });

  it("el último resaltado sigue siendo el elegido, y con dos posibles el camino no queda quieto", () => {
    const dos: JuegoAzar[] = [CATALOGO[0], CATALOGO[1]].filter((j): j is JuegoAzar => !!j);
    for (let semilla = 0; semilla < 60; semilla++) {
      const azar = elegirAlAzar(dos, 3, semilla, "race");
      expect(azar.elegido?.game).toBe("sapo");
      expect(azar.recorrido[azar.recorrido.length - 1]?.indice).toBe(1);
      // Con dos tarjetas la luz salta de una a otra: nunca dos pasos seguidos en la misma.
      for (let i = 1; i < azar.recorrido.length; i++) expect(azar.recorrido[i]?.indice).not.toBe(azar.recorrido[i - 1]?.indice);
    }
  });

  it("si queda un solo posible, el excluido no se aplica: no hay a dónde ir", () => {
    const solo: JuegoAzar[] = [CATALOGO[0] ?? { game: "race", rango: { minimo: 2, maximo: 200 } }];
    expect(elegirAlAzar(solo, 3, 9, "race").elegido?.game).toBe("race");
  });

  it("un excluido que no encaja o que no existe no cambia nada", () => {
    for (let semilla = 0; semilla < 50; semilla++) {
      expect(elegirAlAzar(CATALOGO, 3, semilla, "chovena")).toEqual(elegirAlAzar(CATALOGO, 3, semilla));
      expect(elegirAlAzar(CATALOGO, 3, semilla, "fantasma")).toEqual(elegirAlAzar(CATALOGO, 3, semilla));
    }
  });
});

describe("la luz da la vuelta (`enRueda`)", () => {
  /** Una grilla de dos filas por cinco columnas: el centro de cada tarjeta, con la fila de arriba primero. */
  const grilla = (columnas: number, filas: number): { id: string; x: number; y: number }[] =>
    Array.from({ length: columnas * filas }, (_, i) => ({ id: `${Math.floor(i / columnas)}${i % columnas}`, x: (i % columnas) * 200 + 100, y: Math.floor(i / columnas) * 160 + 80 }));
  const centroDe = (cuadros: { x: number; y: number }[]): { x: number; y: number } => ({
    x: cuadros.reduce((a, c) => a + c.x, 0) / cuadros.length,
    y: cuadros.reduce((a, c) => a + c.y, 0) / cuadros.length,
  });

  it("en dos filas de cinco, la de arriba va de izquierda a derecha y la de abajo de derecha a izquierda", () => {
    const g = grilla(5, 2);
    // Se las da en un orden cualquiera: el orden sale del lugar de cada una.
    const revueltas = [...g].sort((a, b) => ((a.x * 7 + a.y * 3) % 11) - ((b.x * 7 + b.y * 3) % 11));
    const orden = enRueda(revueltas, (c) => c, centroDe(g)).map((c) => c.id);
    expect(orden).toEqual(["00", "01", "02", "03", "04", "14", "13", "12", "11", "10"]);
  });

  it("ningún paso salta de una punta de la grilla a la otra: cada tarjeta queda pegada a la siguiente", () => {
    for (const [columnas, filas] of [[5, 2], [4, 3], [2, 5], [3, 4]] as const) {
      const g = grilla(columnas, filas);
      const orden = enRueda(g, (c) => c, centroDe(g));
      expect(orden).toHaveLength(columnas * filas);
      // Con la vuelta cerrada (la última con la primera): el salto más largo es de dos tarjetas, nunca de la grilla entera.
      const mayorSalto = Math.max(
        ...orden.map((c, i) => {
          const sig = orden[(i + 1) % orden.length] ?? c;
          return Math.hypot((c.x - sig.x) / 200, (c.y - sig.y) / 160);
        }),
      );
      expect(mayorSalto, `${columnas}x${filas}`).toBeLessThanOrEqual(2.3);
    }
  });

  it("no pierde ni repite ninguna tarjeta", () => {
    const g = grilla(5, 2);
    expect(enRueda(g, (c) => c, centroDe(g)).map((c) => c.id).sort()).toEqual(g.map((c) => c.id).sort());
  });

  it("si no se sabe dónde está cada una (todas en el mismo punto), queda el orden de siempre", () => {
    const g = grilla(5, 2).map((c) => ({ ...c, x: 0, y: 0 }));
    expect(enRueda(g, (c) => c, { x: 0, y: 0 }).map((c) => c.id)).toEqual(g.map((c) => c.id));
  });
});

describe("cuánto se queda la tarjeta donde cayó", () => {
  it("más que un paso de la ruleta, para que la sala vea dónde quedó, y menos de dos segundos", () => {
    const ultimaPausa = pausasDe(12).at(-1) ?? 0;
    expect(QUEDA_MS).toBeGreaterThan(ultimaPausa * 2);
    expect(QUEDA_MS).toBeLessThanOrEqual(2000);
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
