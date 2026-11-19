import { describe, expect, it } from "vitest";
import { unidadDe } from "../pixi/kit/nombres";
import { ECHADA_DUR, FONDO_CARTEL, arribaDelCartel, carrilesDe, formaDe, hudDe, ordenDeFilas, plegada, type Pantalla } from "./carrera-forma";
import { MARCADOR, medidasMarcador } from "../pixi/kit/marcador";

const pantalla = (w: number, h: number): Pantalla => ({ w, h, u: unidadDe(w, h), retrato: h > w * 1.1, top: Math.round(0.06 * h), bottom: Math.round(h - Math.max(110, 0.14 * h)) });
const PANTALLAS: [string, Pantalla][] = [["1080p", pantalla(1920, 1080)], ["720p", pantalla(1280, 720)], ["celular 390", pantalla(390, 844)], ["celular de lado", pantalla(844, 390)]];
const px = (p: Pantalla): number => Math.max(p.h * 0.026, 16, 19 * Math.min(2, p.u));

describe("la forma con un mínimo de filas", () => {
  const OCHO: [string, Pantalla][] = [
    ...PANTALLAS,
    ["1366x768", pantalla(1366, 768)],
    ["1024x768", pantalla(1024, 768)],
    ["800x1280", pantalla(800, 1280)],
    ["360x640", pantalla(360, 640)],
  ];
  // Lo que da hoy sin opciones, fijado antes de admitir el mínimo: filas, columnas y tamaño para 2, 8, 9, 12, 18, 24 y 30 personas.
  const DE_HOY: Record<string, string[]> = {
    "1080p": ["2/1/1.9957", "4/2/1.6047", "4/3/1.6047", "5/3/1.1954", "6/3/0.9226", "6/4/0.9226", "7/5/0.7277"],
    "720p": ["2/1/1.3304", "4/2/1.0453", "4/3/1.0453", "5/3/0.7774", "6/3/0.5988", "6/4/0.5988", "7/5/0.4712"],
    "celular 390": ["2/1/1.1009", "8/1/0.7056", "9/1/0.6272", "12/1/0.4704", "18/1/0.3136", "24/1/0.2352", "30/1/0.2220"],
    "celular de lado": ["2/1/0.7207", "4/2/0.3283", "4/3/0.3283", "4/3/0.3283", "4/5/0.3283", "4/6/0.3283", "4/8/0.3283"],
    "1366x768": ["2/1/1.4191", "4/2/1.1346", "4/3/1.1346", "5/3/0.8449", "6/3/0.6517", "6/4/0.6517", "7/5/0.5138"],
    "1024x768": ["2/1/1.4191", "4/2/1.1346", "4/3/1.1346", "5/3/0.8449", "6/3/0.6517", "6/4/0.6517", "7/5/0.5138"],
    "800x1280": ["2/1/1.6696", "8/1/1.0690", "9/1/0.9502", "12/1/0.7126", "18/1/0.4751", "12/2/0.7126", "15/2/0.5701"],
    "360x640": ["2/1/0.8348", "8/1/0.5089", "9/1/0.4524", "12/1/0.3393", "9/2/0.4524", "12/2/0.3393", "15/2/0.2714"],
  };
  const CANTIDADES = [2, 8, 9, 12, 18, 24, 30];

  it("sin opciones da lo mismo que hoy en ocho pantallas", () => {
    for (const [nombre, p] of OCHO) {
      CANTIDADES.forEach((m, i) => {
        const f = formaDe(p, m, px(p), 120 * p.u);
        expect(`${f.filas}/${f.columnas}/${f.esc.toFixed(4)}`, `${nombre} con ${m}`).toBe(DE_HOY[nombre]?.[i]);
        expect(f.filasMax).toBeGreaterThanOrEqual(2);
      });
    }
  });

  it("con un mínimo de filas da esas filas, y nunca más que las que entran en la pantalla", () => {
    for (const [nombre, p] of OCHO) {
      for (const m of CANTIDADES) {
        const base = formaDe(p, m, px(p), 120 * p.u);
        const pedido = base.filas + 2;
        const conMin = formaDe(p, m, px(p), 120 * p.u, { filasMin: pedido });
        // Con el nombre arriba las filas se eligen directamente: da las pedidas, sin pasar de las que entran en la pantalla.
        // En retrato las filas salen de las columnas (una por llama o dos), así que el mínimo solo puede pedir que no bajen de las de hoy.
        if (!p.retrato) expect(conMin.filas, `${nombre} con ${m}`).toBe(Math.min(pedido, base.filasMax));
        else expect(conMin.filas, `${nombre} con ${m}`).toBeGreaterThanOrEqual(base.filas);
        const conMuchas = formaDe(p, m, px(p), 120 * p.u, { filasMin: 99 });
        if (!p.retrato) expect(conMuchas.filas, `${nombre} con ${m} y 99 pedidas`).toBe(base.filasMax);
        expect(conMuchas.filasMax).toBe(base.filasMax);
      }
    }
  });
});

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

    it(`${nombre}: el fondo del cartel de nombres empieza debajo del marcador QUEDAN, con su sombra, y deja lugar para los nombres`, () => {
      const k = p.u;
      const marc = medidasMarcador(k);
      // El marcador del kit: la caja en (MARCADOR.x, top + MARCADOR.y) y una sombra 5 u más abajo.
      const sombraAbajo = p.top + MARCADOR.y * k + marc.alto + 5 * k;
      const fondoArriba = arribaDelCartel(p) - FONDO_CARTEL * k;
      expect(fondoArriba, "el fondo no pisa la sombra del marcador").toBeGreaterThanOrEqual(sombraAbajo + 2 * k);
      expect(arribaDelCartel(p), "nunca más arriba que debajo de la cinta").toBeGreaterThanOrEqual(hudDe(p).bajo + 10 * k);
      // Y no se come la pista: el cartel conserva un buen trozo de pantalla.
      expect(p.bottom - arribaDelCartel(p)).toBeGreaterThan(0.4 * p.h);
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
