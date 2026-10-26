import { describe, expect, it } from "vitest";
import { unidadDe } from "../pixi/kit/nombres";
import { ECHADA_DUR, carrilesDe, formaDe, hudDe, ordenDeFilas, plegada, type Pantalla } from "./carrera-forma";

const pantalla = (w: number, h: number): Pantalla => ({ w, h, u: unidadDe(w, h), retrato: h > w * 1.1, top: Math.round(0.06 * h), bottom: Math.round(h - Math.max(110, 0.14 * h)) });
const PANTALLAS: [string, Pantalla][] = [["1080p", pantalla(1920, 1080)], ["720p", pantalla(1280, 720)], ["celular 390", pantalla(390, 844)], ["celular de lado", pantalla(844, 390)]];
const px = (p: Pantalla): number => Math.max(p.h * 0.026, 16, 19 * Math.min(2, p.u));

describe("echarse se ve en el cuerpo a los 0,3 s", () => {
  it("a los 0,3 s de la línea del relator la llama ya va más de la mitad echada, y a los 0,5 s del todo", () => {
    expect(plegada(0)).toBe(0);
    expect(plegada(0.3)).toBeGreaterThanOrEqual(0.55);
    expect(plegada(ECHADA_DUR)).toBe(1);
    expect(plegada(2)).toBe(1);
  });
});

describe("la forma de la carrera", () => {
  it("las filas alternan arriba y abajo del medio: el grupo es una flecha", () => {
    expect(ordenDeFilas(5)).toEqual([2, 1, 3, 0, 4]);
    expect(ordenDeFilas(1)).toEqual([0]);
    expect([...ordenDeFilas(6)].sort()).toEqual([0, 1, 2, 3, 4, 5]);
  });

  for (const [nombre, p] of PANTALLAS) {
    it(`${nombre}: la cinta no pisa el marcador y la pista queda debajo`, () => {
      const h = hudDe(p);
      expect(h.cinta.x1).toBeGreaterThan(h.cinta.x0);
      expect(h.bajo).toBeGreaterThan(h.cinta.y + h.cinta.h - 1);
      expect(h.bajo).toBeLessThan(p.bottom - 60);
    });

    it(`${nombre}: con 2 a 30 nadie se encima, el primero es el de más a la derecha y todo entra en la pista`, () => {
      for (let m = 2; m <= 30; m++) {
        const f = formaDe(p, m, px(p), 120 * p.u);
        const vistos = new Set<string>();
        let maxDx = 0;
        for (let r = 0; r < m; r++) {
          const s = f.slot(r);
          const clave = `${s.dx.toFixed(2)}:${s.fila}`;
          expect(vistos.has(clave), `puesto ${r} repetido con ${m}`).toBe(false);
          vistos.add(clave);
          expect(s.fila).toBeGreaterThanOrEqual(0);
          expect(s.fila).toBeLessThan(f.filas);
          const y = f.yPie(s.fila);
          expect(y).toBeGreaterThan(f.y0);
          expect(y).toBeLessThanOrEqual(f.y1);
          if (r > 0) expect(s.dx, `el primero tiene que ir más adelante que el puesto ${r}`).toBeGreaterThan(f.slot(0).dx);
          maxDx = Math.max(maxDx, s.dx);
        }
        expect(f.slot(0).dx).toBe(0);
        expect(maxDx).toBeLessThanOrEqual(f.profundidad + 1e-6);
        expect(f.alto).toBeGreaterThanOrEqual(20 * p.u);
        expect(f.filas * f.columnas).toBeGreaterThanOrEqual(m);
      }
    });

    it(`${nombre}: el grupo entra en el plano con su frente en el ancla, y ningún nombre tapa el cuerpo de otra`, () => {
      for (let m = 2; m <= 30; m++) {
        const nombreW = 120 * p.u;
        const f = formaDe(p, m, px(p), nombreW);
        const sobra = f.arriba ? nombreW / 2 + f.largo / 2 : nombreW + f.largo;
        // La que va más atrás queda adentro de la pantalla, con su nombre.
        expect(f.ancla - f.profundidad - sobra, `${m} en ${nombre}`).toBeGreaterThanOrEqual(-2);
        expect(f.ancla + f.largo).toBeLessThanOrEqual(p.w + 1);
        // El nombre (arriba de la cabeza) de una llama nunca cae sobre el cuerpo de otra: el hueco entre filas lo cubre.
        if (f.arriba) expect(f.altoFila).toBeGreaterThanOrEqual(f.alto + f.altoNombre);
      }
    });

    it(`${nombre}: las ocho de la final tienen un carril cada una, parejos y dentro de la pista`, () => {
      const c = carrilesDe(p, 8, px(p));
      for (let j = 0; j < 8; j++) {
        expect(c.yPie(j)).toBeGreaterThan(c.y0);
        expect(c.yPie(j)).toBeLessThanOrEqual(c.y1);
        if (j) expect(c.yPie(j) - c.yPie(j - 1)).toBeCloseTo(c.altoFila, 6);
      }
      expect(c.alto).toBeGreaterThanOrEqual(20 * p.u);
    });
  }
});
