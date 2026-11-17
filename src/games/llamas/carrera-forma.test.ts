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

  describe("los carriles con pocas finalistas (issue 106)", () => {
    /** La banda completa de carriles de cada pantalla, de `carrilesDe` con cualquier n (es la misma). */
    const bandaDe = (p: Pantalla): { y0: number; y1: number } => {
      const k = p.u;
      const y0 = hudDe(p).bajo + 8 * k;
      return { y0, y1: Math.max(y0 + 60, p.bottom - 4 * k) };
    };
    /** Lo que la llama mide hoy (antes de comprimir la banda), fijado con la sonda: esc por pantalla y cantidad. */
    const ESC_DE_HOY: Record<string, Record<number, number>> = {
      "1080p": { 2: 1.9957, 3: 1.9957, 4: 1.6047, 5: 1.1954 },
      "720p": { 2: 1.3304, 3: 1.3304, 4: 1.0453, 5: 0.7774 },
      "celular 390": { 2: 1.1009, 3: 1.1009, 4: 1.1009, 5: 1.1009 },
      "celular de lado": { 2: 0.7207, 3: 0.5182, 4: 0.3283, 5: 0.4284 },
    };
    /** Lo que da hoy para 6, 7 y 8 carriles, fijado con la sonda: [y0, y1, altoFila, alto, esc] para n = 6, 7, 8. */
    const CARRILES_DE_HOY: Record<string, [number, number, number, number, number][]> = {
      "1080p": [
        [170, 923, 125.5, 84.88, 0.9226],
        [170, 923, 107.5714, 66.9514, 0.7277],
        [170, 923, 94.125, 88.4775, 0.9617],
      ],
      "720p": [
        [113, 606, 82.1667, 55.0867, 0.5988],
        [113, 606, 70.4286, 43.3486, 0.4712],
        [113, 606, 61.625, 57.9275, 0.6296],
      ],
      "celular 390": [
        [169.8486, 722.2857, 92.0729, 86.5485, 0.9407],
        [169.8486, 722.2857, 78.9196, 74.1844, 0.8064],
        [169.8486, 722.2857, 69.0546, 64.9114, 0.7056],
      ],
      "celular de lado": [
        [68.2045, 277.8333, 34.9381, 32.8418, 0.357],
        [68.2045, 277.8333, 29.947, 28.1502, 0.306],
        [68.2045, 277.8333, 26.2036, 24.6314, 0.2677],
      ],
    };

    it("con 6 carriles o más la salida es igual a hoy, y es pura (dos llamadas, lo mismo)", () => {
      for (const [nombre, p] of PANTALLAS) {
        [6, 7, 8].forEach((n, i) => {
          const c = carrilesDe(p, n, px(p));
          const [y0, y1, altoFila, alto, esc] = CARRILES_DE_HOY[nombre]![i]!;
          expect(c.y0, `${nombre} n=${n} y0`).toBeCloseTo(y0, 4);
          expect(c.y1, `${nombre} n=${n} y1`).toBeCloseTo(y1, 4);
          expect(c.altoFila, `${nombre} n=${n} altoFila`).toBeCloseTo(altoFila, 4);
          expect(c.alto, `${nombre} n=${n} alto`).toBeCloseTo(alto, 4);
          expect(c.esc, `${nombre} n=${n} esc`).toBeCloseTo(esc, 4);
          const otra = carrilesDe(p, n, px(p));
          expect([otra.y0, otra.y1, otra.altoFila, otra.alto, otra.esc]).toEqual([c.y0, c.y1, c.altoFila, c.alto, c.esc]);
        });
      }
    });

    it("con 2 a 5 la llama mide lo de hoy y la banda se comprime alrededor del centro según el tope de alto", () => {
      for (const [nombre, p] of PANTALLAS) {
        const k = p.u;
        const llena = bandaDe(p);
        const centro = (llena.y0 + llena.y1) / 2;
        for (let n = 2; n <= 5; n++) {
          const c = carrilesDe(p, n, px(p));
          // La llama no cambia: el tope de alto documentado manda, no la compresión.
          expect(c.esc, `${nombre} n=${n} esc`).toBeCloseTo(ESC_DE_HOY[nombre]![n]!, 4);
          // La banda no crece y sigue centrada donde estaba.
          expect(c.y0, `${nombre} n=${n} y0 dentro`).toBeGreaterThanOrEqual(llena.y0 - 1e-9);
          expect(c.y1, `${nombre} n=${n} y1 dentro`).toBeLessThanOrEqual(llena.y1 + 1e-9);
          expect((c.y0 + c.y1) / 2, `${nombre} n=${n} centrada`).toBeCloseTo(centro, 6);
          // Cada carril mide lo que la llama pide (con su nombre y aire arriba, o su 94 % en retrato) cuando el tope deja lugar.
          const pedido = c.arriba ? c.alto + c.altoNombre + 2 * k : c.alto / 0.94;
          const esperada = Math.min(llena.y1 - llena.y0, pedido * n);
          expect(c.y1 - c.y0, `${nombre} n=${n} banda`).toBeCloseTo(esperada, 6);
          expect(c.altoFila, `${nombre} n=${n} altoFila`).toBeCloseTo(esperada / n, 6);
          // Los carriles entran, en orden y parejos, sin que dos llamas se superpongan, y con lugar para el nombre.
          let previa = -Infinity;
          for (let j = 0; j < n; j++) {
            const y = c.yPie(j);
            expect(y, `${nombre} n=${n} carril ${j} dentro`).toBeGreaterThan(c.y0);
            expect(y, `${nombre} n=${n} carril ${j} dentro`).toBeLessThanOrEqual(c.y1);
            if (j) expect(y - previa, `${nombre} n=${n} carril ${j} parejo`).toBeCloseTo(c.altoFila, 9);
            expect(c.altoFila, `${nombre} n=${n} sin superponerse`).toBeGreaterThanOrEqual(c.alto - 1e-9);
            if (c.arriba) expect(c.altoFila, `${nombre} n=${n} con nombre`).toBeGreaterThanOrEqual(c.alto + c.altoNombre - 1e-9);
            previa = y;
          }
        }
      }
    });

    it("casos concretos: con 2 carriles la banda deja de ocupar la pista entera, y con 8 queda como hoy", () => {
      const proyector = PANTALLAS[0]![1]!;
      const c2 = carrilesDe(proyector, 2, px(proyector));
      // Cada carril pide alto + nombre + aire: la banda pasa de 753 a 448,44 px, centrada.
      expect(c2.y1 - c2.y0, "1080p con 2: banda comprimida").toBeCloseTo(448.44, 2);
      expect(c2.y0, "1080p con 2: centrada").toBeCloseTo(170 + (753 - 448.44) / 2, 2);
      // En el celular parado, de 552,4 a 215,5 px.
      const cel = PANTALLAS[2]![1]!;
      const c2c = carrilesDe(cel, 2, px(cel));
      expect(c2c.y1 - c2c.y0, "celular con 2: banda comprimida").toBeCloseTo((2 * 101.28) / 0.94, 2);
      // Con 8 carriles, nada cambió.
      const c8 = carrilesDe(proyector, 8, px(proyector));
      expect(c8.y1 - c8.y0, "1080p con 8: banda de siempre").toBeCloseTo(753, 2);
      expect(c8.y0).toBe(170);
      expect(c8.y1).toBe(923);
    });
  });
});
