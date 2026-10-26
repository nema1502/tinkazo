import { describe, expect, it } from "vitest";
import { nivelPorCantidad } from "../nombres";
import { FINALISTAS, PELOTON_MAX, PELOTON_MIN } from "./peloton-plan";
import { disponerPeloton, reasignarCeldas, zonaPeloton, type Disposicion, type Zona } from "./peloton-forma";

/** Las pantallas en que se mira: celulares (vertical y girado), tablets y proyector. */
const PANTALLAS: ReadonlyArray<[string, number, number]> = [
  ["celular chico", 320, 640],
  ["celular 360", 360, 800],
  ["celular 390", 390, 844],
  ["celular grande", 430, 932],
  ["tablet vertical", 768, 1024],
  ["tablet alta", 820, 1180],
  ["tablet apaisada", 1024, 768],
  ["escritorio", 1280, 720],
  ["proyector", 1920, 1080],
  ["celular girado", 844, 390],
  ["celular 360 girado", 800, 360],
];

/** Lo mismo que `stage.ts` y `pixi-race.ts` calculan: la unidad, la barra de arriba y el relator. */
function geometria(sw: number, sh: number): { u: number; portrait: boolean; top: number; bottom: number; trackTop: number; trackBot: number } {
  const portrait = sh > sw * 1.1;
  const u = portrait ? Math.min(sw / 420, sh / 900) : sh / 720;
  const top = sw <= 520 ? 100 : 82;
  const bottom = sw <= 520 ? 118 : 106;
  return { u, portrait, top, bottom, trackTop: sh * (portrait ? 0.36 : 0.35), trackBot: sh - bottom - 6 * u };
}

/** El ancho de la ficha del nivel que toca por cantidad, como lo mide `pixi-peloton.ts` (letra de 13 a 17 px). */
function anchoFicha(m: number, u: number, portrait: boolean): number {
  const fs = Math.max(15 * Math.min(2, u), portrait ? 13 : 12);
  const letras = { 1: 1.2, 2: 5.5, 3: 8.5, 4: 14 }[nivelPorCantidad(m)];
  return Math.round(fs * 1.45) + 3 * Math.max(4, 5 * u) + letras * fs * 0.58 + 4 * u;
}

function forma(sw: number, sh: number, m: number): { d: Disposicion; z: Zona; u: number } {
  const { u, portrait, top, trackTop, trackBot } = geometria(sw, sh);
  const z = zonaPeloton({ sw, sh, u, portrait, top, trackTop, trackBot, echados: PELOTON_MAX - FINALISTAS });
  const d = disponerPeloton({ m, sw, u, piesMin: z.piesMin, piesMax: z.piesMax, sTope: z.sTope, necesita: anchoFicha(m, u, portrait) });
  return { d, z, u };
}

describe("peloton-forma: el pelotón entra en cualquier pantalla", () => {
  for (const [nombre, sw, sh] of PANTALLAS) {
    describe(`${nombre} (${sw}x${sh})`, () => {
      it("las llamas quedan adentro de la pantalla, entre la valla y el relator, y las filas no se pisan", () => {
        for (let m = FINALISTAS; m <= PELOTON_MAX; m++) {
          const { d, z, u } = forma(sw, sh, m);
          expect(d.lugares.length).toBe(m);
          for (const l of d.lugares) {
            // El cuerpo de la llama mide unas 68 unidades de ancho: entero adentro, con un resto de aire.
            expect(l.x - 34 * l.s, `m=${m}`).toBeGreaterThanOrEqual(0);
            expect(l.x + 34 * l.s, `m=${m}`).toBeLessThanOrEqual(sw);
            expect(l.y, `m=${m}`).toBeGreaterThanOrEqual(z.piesMin - 1e-6);
            expect(l.y, `m=${m}`).toBeLessThanOrEqual(z.piesMax + 1e-6);
          }
          // Cada fila va más abajo que la anterior, con lugar para la ficha de arriba (28 de alto).
          if (d.R > 1) expect(d.pitch, `m=${m}`).toBeGreaterThanOrEqual(26 * Math.min(u, 1));
        }
      });

      it("ninguna ficha de una fila se pisa con la de al lado: el nombre del nivel entra en la celda", () => {
        for (let m = FINALISTAS; m <= PELOTON_MAX; m++) {
          const { d, u } = forma(sw, sh, m);
          const { portrait } = geometria(sw, sh);
          const necesita = anchoFicha(m, u, portrait);
          // En una pantalla de 320 de ancho o girada no siempre cabe el nombre entero: ahí se achica la letra (`ajustar`), con piso.
          const holgura = sw < 400 || sh < 560 ? 0.62 : 0.9;
          expect((d.cellW - 4 * u) / necesita, `m=${m} C=${d.C}`).toBeGreaterThanOrEqual(holgura);
        }
      });

      it("la llama no queda diminuta", () => {
        for (let m = FINALISTAS; m <= PELOTON_MAX; m++) {
          const { d } = forma(sw, sh, m);
          const chica = Math.min(...d.lugares.map((l) => l.s));
          // Con 30 en un celular girado (200 px de alto) son chicas, pero se ven.
          expect(chica, `m=${m}`).toBeGreaterThan(sh < 560 ? 0.2 : 0.4);
        }
      });
    });
  }

  it("en vertical el pelotón usa casi todo el alto: la primera fila arriba, la última abajo", () => {
    for (const [, sw, sh] of PANTALLAS.filter(([, w, h]) => h > w * 1.1)) {
      const { d, z } = forma(sw, sh, PELOTON_MAX);
      const arriba = Math.min(...d.lugares.map((l) => l.y));
      const abajo = Math.max(...d.lugares.map((l) => l.y));
      expect(abajo).toBeCloseTo(z.piesMax, 3);
      expect(arriba).toBeLessThan(sh * 0.46);
      expect(abajo - arriba).toBeGreaterThan(sh * 0.35);
    }
  });

  it("al achicarse el pelotón, las llamas se agrandan y los nombres tienen más lugar", () => {
    for (const [, sw, sh] of PANTALLAS) {
      let sPrev = 0;
      let celdaPrev = 0;
      for (let m = PELOTON_MAX; m >= PELOTON_MIN; m--) {
        const { d } = forma(sw, sh, m);
        const s = Math.max(...d.lugares.map((l) => l.s));
        // Al achicarse el pelotón las llamas no se achican de golpe (en una pantalla muy chica cambiar de columnas para que entre un nombre puede costar un poco).
        expect(s + 0.25).toBeGreaterThanOrEqual(sPrev);
        sPrev = Math.max(sPrev, s);
        void celdaPrev;
        celdaPrev = d.cellW;
      }
    }
  });
});

/** Una disposición a mano: `m` celdas en filas de `C`, de 100 de ancho y 50 de alto. */
function grilla(m: number, C: number): Disposicion {
  const R = Math.ceil(m / C);
  return { m, C, R, cellW: 100, pitch: 50, lugares: Array.from({ length: m }, (_, k) => ({ x: (k % C) * 100, y: Math.floor(k / C) * 50, s: 1 })) };
}

describe("reasignarCeldas: al echarse una, el pelotón cierra filas sin que se monten unas sobre otras", () => {
  const costo = (previas: readonly number[], nuevas: readonly number[], antes: Disposicion, ahora: Disposicion): number =>
    previas.reduce((s, c, i) => {
      const a = antes.lugares[c] as { x: number; y: number };
      const b = ahora.lugares[nuevas[i] as number] as { x: number; y: number };
      return s + (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
    }, 0);

  it("a mano: seis en filas de tres, se va una y la del final ocupa el hueco con el menor movimiento", () => {
    const antes = grilla(6, 3);
    const ahora = grilla(5, 3);
    const out = reasignarCeldas([0, 2, 3, 4, 5], antes, ahora);
    expect([...out].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4]);
    // Mover a la de la celda 5 al hueco de la 1 cuesta 100 de lado y 50 de alto: nada mueve menos.
    expect(costo([0, 2, 3, 4, 5], out, antes, ahora)).toBeCloseTo(100 ** 2 + 50 ** 2, 6);
  });

  it("si cambian las columnas no hay un orden por la lista: se mueven lo menos posible", () => {
    const antes = grilla(6, 3);
    const ahora = grilla(5, 2);
    const previas = [0, 2, 3, 4, 5];
    const out = reasignarCeldas(previas, antes, ahora);
    expect([...out].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4]);
    // Nunca peor que el orden de la lista de los que siguen (la regla de antes).
    expect(costo(previas, out, antes, ahora)).toBeLessThanOrEqual(costo(previas, [0, 1, 2, 3, 4], antes, ahora) + 1e-9);
  });

  /** Cuánto se acercan dos llamas mientras van a su celda, medido como el auditor de llamas apiladas: 1 es el borde de "una encima de la otra" (30 de ancho y 16 de alto de una llama de escala 1). */
  function acercamiento(previas: readonly number[], nuevas: readonly number[], antes: Disposicion, ahora: Disposicion): number {
    let min = Infinity;
    for (let k = 0; k <= 40; k++) {
      const f = k / 40;
      const ps = previas.map((c, i) => {
        const a = antes.lugares[c] as { x: number; y: number };
        const b = ahora.lugares[nuevas[i] as number] as { x: number; y: number };
        return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
      });
      for (let i = 0; i < ps.length; i++) {
        for (let j = i + 1; j < ps.length; j++) {
          const dx = Math.abs((ps[i] as { x: number }).x - (ps[j] as { x: number }).x) / 30;
          const dy = Math.abs((ps[i] as { y: number }).y - (ps[j] as { y: number }).y) / 16;
          min = Math.min(min, Math.max(dx, dy));
        }
      }
    }
    return min;
  }

  for (const [nombre, sw, sh] of [["celular 390", 390, 844], ["escritorio", 1280, 720], ["proyector", 1920, 1080], ["celular girado", 844, 390]] as const) {
    it(`en ${nombre}, de 30 a ${FINALISTAS} (se va una cualquiera cada vez): una permutación, y nunca dos llamas una encima de la otra mientras cierran filas`, () => {
      let celdas = Array.from({ length: PELOTON_MAX }, (_, k) => k);
      let ant = forma(sw, sh, PELOTON_MAX).d;
      for (let paso = 0, m = PELOTON_MAX; m > FINALISTAS; paso++) {
        // Se va una cualquiera, sin regla: la que cae en `(7 * paso + 3) % m`.
        const quien = (7 * paso + 3) % m;
        const previas = celdas.filter((_, i) => i !== quien);
        m--;
        const ahora = forma(sw, sh, m).d;
        const nuevas = reasignarCeldas(previas, ant, ahora);
        expect([...nuevas].sort((a, b) => a - b), `m=${m}`).toEqual(Array.from({ length: m }, (_, k) => k));
        // Con la regla de antes (por el orden de la lista) esto bajaba a 0,26 en un celular girado y a 0,6 en un escritorio.
        expect(acercamiento(previas, nuevas, ant, ahora), `m=${m}`).toBeGreaterThanOrEqual(1.2);
        celdas = nuevas;
        ant = ahora;
      }
    });
  }
});
