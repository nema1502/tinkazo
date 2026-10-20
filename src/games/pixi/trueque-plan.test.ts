import { describe, expect, it } from "vitest";
import { MAX_CAMBIOS, N_PRODUCTOS, cambiosPara, llega, planTrueque, type Trueque } from "./trueque-plan";

/** Un rng sembrado y simple, solo para las pruebas (mulberry32). */
function rngOf(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const casos: [number, number[]][] = [
  [1, [0]], [2, [0]], [2, [1]], [3, [0, 2]], [8, [0]], [8, [3, 5]], [12, [0]], [12, [4, 9]],
  [18, [17]], [18, [0, 1, 2]], [50, [10]], [50, [3, 20, 40]], [200, [0]], [200, [5, 99, 150, 199]],
];

/** Cuándo cambia cada puesto: el pase (1-based), o Infinity si nunca. */
function cambioEnDe(p: Trueque): number[] {
  const cambioEn = p.puestos.map(() => Infinity);
  for (const e of p.encargos) e.cambios.forEach((s, t) => (cambioEn[s] = t + 1));
  return cambioEn;
}

/** Lo que el juego afirma de un callejón: en el pase t, el puesto acepta lo que lleva el encargo y no hay camino hasta el destino. */
function esCallejonVerdadero(p: Trueque, cambioEn: number[], e: Trueque["encargos"][number], t: number, quien: number): boolean {
  const libre = (i: number): boolean => !p.encargos.some((x) => x.destino === i) && (cambioEn[i] ?? Infinity) >= t;
  const aristas: [number, number][] = [];
  for (let f = 0; f < p.puestos.length; f++) if (f !== quien && libre(f)) aristas.push([p.puestos[f]?.acepta ?? 0, p.puestos[f]?.da ?? 0]);
  const meta = p.puestos[e.destino]?.acepta ?? 0;
  return p.puestos[quien]?.acepta === e.pases[t - 1]?.producto && !llega(p.puestos[quien]?.da ?? 0, meta, MAX_CAMBIOS - t, aristas);
}

function invariantes(n: number, ganadores: number[], p: Trueque): void {
  const destinos = [...new Set(ganadores)].filter((i) => i >= 0 && i < n);
  expect(p.puestos).toHaveLength(n);
  for (const x of p.puestos) {
    expect(x.acepta).toBeGreaterThanOrEqual(0);
    expect(x.acepta).toBeLessThan(N_PRODUCTOS);
    expect(x.da).not.toBe(x.acepta);
  }
  expect(p.encargos.map((e) => e.destino)).toEqual(destinos);
  expect(p.cambios).toBeLessThanOrEqual(MAX_CAMBIOS);
  expect(p.pases).toBe(p.cambios + 1);
  expect(p.prendidos).toHaveLength(p.pases);

  // Cada puesto cambia una sola vez, y nunca cambia quien espera el encargo.
  const cambian = p.encargos.flatMap((e) => e.cambios);
  expect(new Set(cambian).size).toBe(cambian.length);
  for (const c of cambian) expect(destinos).not.toContain(c);

  const cambioEn = cambioEnDe(p);
  for (const e of p.encargos) {
    const k = p.cambios;
    expect(e.cambios).toHaveLength(k);
    expect(e.productos).toHaveLength(k + 1);
    expect(e.origen).toBe(e.productos[0]);
    // La cadena: cada puesto que cambia acepta lo que lleva y da lo siguiente.
    for (let t = 0; t < k; t++) {
      const s = e.cambios[t] as number;
      expect(p.puestos[s]?.acepta).toBe(e.productos[t]);
      expect(p.puestos[s]?.da).toBe(e.productos[t + 1]);
      expect(e.productos[t]).not.toBe(e.productos[t + 1]);
    }
    // Llega al destino con lo que él acepta, y antes no llega a él.
    expect(p.puestos[e.destino]?.acepta).toBe(e.productos[k]);
    for (let t = 0; t < k; t++) expect(e.productos[t]).not.toBe(p.puestos[e.destino]?.acepta);

    expect(e.pases).toHaveLength(k + 1);
    e.pases.forEach((pase, i) => {
      expect(pase.producto).toBe(e.productos[i]);
      const t = i + 1;
      const ultimo = pase.intentos[pase.intentos.length - 1];
      const quienCambia = t === k + 1 ? e.destino : (e.cambios[i] as number);
      expect(ultimo).toEqual({ quien: quienCambia, ok: true });
      // Lo que se prueba antes del que cambia son callejones, y son verdaderos.
      for (const intento of pase.intentos.slice(0, -1)) {
        expect(intento.ok).toBe(false);
        expect(destinos).not.toContain(intento.quien);
        expect(cambioEn[intento.quien] ?? Infinity).toBeGreaterThanOrEqual(t);
        expect(esCallejonVerdadero(p, cambioEn, e, t, intento.quien)).toBe(true);
      }
      // Todos los que se prueban están prendidos en ese pase.
      for (const intento of pase.intentos) expect(p.prendidos[i]).toContain(intento.quien);
    });
  }
}

describe("El Trueque: la feria y los encargos", () => {
  it("cambios por encargo: tres con menos de doce, cuatro hasta sesenta, cinco después", () => {
    expect([cambiosPara(3), cambiosPara(11), cambiosPara(12), cambiosPara(59), cambiosPara(60), cambiosPara(200)]).toEqual([3, 3, 4, 4, 5, 5]);
  });

  it("con dos personas, la que no espera cambia una vez: el mano a mano", () => {
    const p = planTrueque(2, [0], rngOf(4));
    expect(p.cambios).toBe(1);
    expect(p.encargos[0]?.cambios).toEqual([1]);
    invariantes(2, [0], p);
  });

  it("sin nadie que espere no hay encargos", () => {
    const p = planTrueque(10, [], rngOf(1));
    expect(p.encargos).toEqual([]);
    expect(p.pases).toBe(1);
  });

  it("con una sola persona, el encargo llega directo: no hay nadie que cambie", () => {
    const p = planTrueque(1, [0], rngOf(9));
    expect(p.cambios).toBe(0);
    expect(p.encargos[0]?.origen).toBe(p.puestos[0]?.acepta);
    invariantes(1, [0], p);
  });

  it("es determinista: la misma semilla arma la misma feria", () => {
    for (const [n, w] of casos) {
      expect(planTrueque(n, w, rngOf(77))).toEqual(planTrueque(n, w, rngOf(77)));
    }
  });

  it("cumple las invariantes en todos los casos y muchas semillas", () => {
    for (const [n, w] of casos) {
      for (let seed = 1; seed <= 25; seed++) invariantes(n, w, planTrueque(n, w, rngOf(seed)));
    }
  });

  it("con doscientas personas, cada producto lo acepta mucha gente: nadie se queda sin con qué cambiar", () => {
    for (let seed = 1; seed <= 10; seed++) {
      const p = planTrueque(200, [0], rngOf(seed));
      const conteo = Array.from({ length: N_PRODUCTOS }, (_, q) => p.puestos.filter((x) => x.acepta === q).length);
      expect(Math.min(...conteo)).toBeGreaterThanOrEqual(10);
    }
  });

  it("el último pase trae un callejón cuando hay alguien que lo acepte y no llega: son dos puestos", () => {
    let conDos = 0;
    let total = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const p = planTrueque(60, [seed % 60], rngOf(seed));
      for (const e of p.encargos) {
        total++;
        if ((e.pases[e.pases.length - 1]?.intentos.length ?? 0) === 2) conDos++;
      }
    }
    expect(conDos / total).toBeGreaterThan(0.8);
  });

  it("con varios premios, cada encargo tiene su destino y ninguno cambia", () => {
    const p = planTrueque(50, [3, 20, 40], rngOf(12));
    expect(p.encargos.map((e) => e.destino)).toEqual([3, 20, 40]);
    const cambian = new Set(p.encargos.flatMap((e) => e.cambios));
    for (const d of [3, 20, 40]) expect(cambian.has(d)).toBe(false);
  });
});
