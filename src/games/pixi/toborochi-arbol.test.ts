import { describe, expect, it } from "vitest";
import { anchoAprox, casilla, disposicion, geoDe, poblacionDeRamas, puntoDe, ramasPara, rejillaDe, type Pant } from "./toborochi-arbol";

const PANTALLAS: Pant[] = [
  { w: 1920, h: 1080, k: 1.5, top: 82, bottom: 974 },
  { w: 1280, h: 720, k: 1, top: 82, bottom: 614 },
  { w: 390, h: 844, k: 0.93, top: 100, bottom: 726 },
  { w: 320, h: 568, k: 0.76, top: 90, bottom: 480 },
];
const CUANTOS = [2, 3, 5, 8, 18, 30, 64, 65, 100, 200];

describe("El árbol del Toborochi: la copa", () => {
  it("con 30, seis ramas de cinco; nunca menos de dos ni más de ocho", () => {
    expect(ramasPara(30)).toBe(6);
    expect(ramasPara(2)).toBe(2);
    expect(ramasPara(3)).toBe(2);
    expect(ramasPara(200)).toBe(8);
    const d = disposicion(30);
    expect(poblacionDeRamas(d)).toEqual([5, 5, 5, 5, 5, 5]);
  });

  it("cada flor tiene su lugar, adentro del óvalo de la copa, y ninguna rama queda vacía", () => {
    for (const n of CUANTOS) {
      const d = disposicion(n);
      expect(d.lugares).toHaveLength(n);
      expect(Math.min(...poblacionDeRamas(d)), `con ${n}`).toBeGreaterThan(0);
      for (const l of d.lugares) {
        expect(Math.abs(l.u)).toBeLessThanOrEqual(1);
        expect(l.v).toBeGreaterThan(0);
        expect(l.v).toBeLessThan(1.01);
        expect(l.rama).toBeGreaterThanOrEqual(0);
        expect(l.rama).toBeLessThan(d.ramas);
      }
    }
  });

  it("las flores no se amontonan: la más cercana a otra está a más de la mitad de lo que tocaría en una grilla pareja", () => {
    for (const n of CUANTOS.filter((x) => x >= 5)) {
      const d = disposicion(n);
      let minimo = Infinity;
      for (let a = 0; a < n; a++)
        for (let b = a + 1; b < n; b++) {
          const A = d.lugares[a]!;
          const B = d.lugares[b]!;
          minimo = Math.min(minimo, Math.hypot(A.u - B.u, (A.v - B.v) * 1.7));
        }
      // El óvalo mide unas 1,9 por 0,9 de área efectiva: la separación pareja es raíz(área / n).
      const pareja = Math.sqrt((Math.PI * 0.95 * 0.45 * 1.7) / n);
      expect(minimo, `con ${n}`).toBeGreaterThan(pareja * 0.4);
    }
  });

  it("es una función de la cantidad: la misma gente, la misma copa", () => {
    for (const n of CUANTOS) expect(JSON.stringify(disposicion(n))).toBe(JSON.stringify(disposicion(n)));
  });

  it("las ramas son abanicos de vecinas: ninguna cruza a otra (los ángulos de sus flores no se mezclan)", () => {
    for (const n of CUANTOS.filter((x) => x >= 8)) {
      const d = disposicion(n);
      const ang = (l: { u: number; v: number }): number => Math.atan2(l.u, l.v + 0.04);
      const rangos = Array.from({ length: d.ramas }, (_, r) => {
        const as = d.lugares.filter((l) => l.rama === r).map(ang);
        return [Math.min(...as), Math.max(...as)] as const;
      });
      for (let r = 1; r < d.ramas; r++) expect(rangos[r]![0], `con ${n}`).toBeGreaterThanOrEqual(rangos[r - 1]![1] - 1e-9);
    }
  });
});

describe("El árbol del Toborochi: la pantalla", () => {
  it("el árbol y la alfombra caben en la franja libre, y las flores caen dentro de la pantalla", () => {
    for (const p of PANTALLAS) {
      for (const n of CUANTOS) {
        const g = geoDe(p, n);
        expect(g.suelo).toBeGreaterThan(p.top);
        expect(g.suelo).toBeLessThan(p.bottom);
        expect(g.alfombra.y + g.alfombra.h).toBeLessThanOrEqual(p.bottom + 1e-6);
        expect(g.copa.base - g.copa.alto).toBeGreaterThanOrEqual(p.top - 1e-6);
        expect(g.copa.ancho).toBeLessThanOrEqual(p.w);
        for (const l of disposicion(n).lugares) {
          const q = puntoDe(g, l);
          expect(q.x - g.r, `con ${n} en ${p.w}`).toBeGreaterThanOrEqual(-1);
          expect(q.x + g.r).toBeLessThanOrEqual(p.w + 1);
          expect(q.y - g.r).toBeGreaterThanOrEqual(p.top - 1);
          expect(q.y + g.r).toBeLessThanOrEqual(g.copa.base + g.r + 1);
        }
      }
    }
  });

  it("la flor es grande con poca gente y chica con mucha, y nunca desaparece", () => {
    for (const p of PANTALLAS) {
      const rs = CUANTOS.map((n) => geoDe(p, n).r);
      for (let i = 1; i < rs.length; i++) expect(rs[i]!).toBeLessThanOrEqual(rs[i - 1]! + 1e-9);
      expect(Math.min(...rs)).toBeGreaterThanOrEqual(5 * p.k - 1e-9);
      // Con ocho, la flor entera lleva su cara: al menos 14 px de radio en un celular.
      expect(geoDe(p, 8).r).toBeGreaterThan(p.w < 500 ? 14 : 24);
    }
  });

  it("la rejilla de la alfombra entra en el suelo y tiene lugar para al menos una casilla", () => {
    for (const p of PANTALLAS) {
      const g = geoDe(p, 30);
      for (const [cw, ch] of [[150, 30], [220, 36], [380, 40]] as const) {
        const r = rejillaDe(g, cw * g.k, ch * g.k);
        expect(r.cap).toBeGreaterThanOrEqual(1);
        expect(r.cols * r.colW).toBeLessThanOrEqual(g.w + 1e-6);
        for (let s = 0; s < r.cap; s++) {
          const c = casilla(r, s);
          expect(c.x - r.colW / 2).toBeGreaterThanOrEqual(-1e-6);
          expect(c.x + r.colW / 2).toBeLessThanOrEqual(g.w + 1e-6);
          expect(c.y - r.rowH / 2).toBeGreaterThanOrEqual(g.alfombra.y - 1e-6);
          expect(c.y + r.rowH / 2).toBeLessThanOrEqual(g.alfombra.y + g.alfombra.h + 1e-6);
        }
      }
    }
  });

  it("el ancho a ojo crece con las letras", () => {
    expect(anchoAprox("María", 20)).toBeLessThan(anchoAprox("María Quispe", 20));
  });
});
