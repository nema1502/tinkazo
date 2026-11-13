import { describe, expect, it } from "vitest";
import { ZC } from "./carrera-3d-mapa";
import { rocasDeHoy, sembrarRocas, type EntradaRocas, type Roca } from "./carrera-rocas";

/**
 * La prueba de la lista de rocas de este paso: para una pantalla fija, la lista da las mismas rocas y matas que la siembra de siempre
 * (la del hash del lugar en el 3D), en los mismos lugares y con los mismos tamaños pasados a elipse y alto.
 */

const hashViejo = (a: number, b = 0): number => {
  let h = (Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39) >>> 0;
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
};

describe("las rocas de hoy, desde una lista", () => {
  it("da las mismas rocas que la siembra de siempre para una pantalla fija", () => {
    const u = 1366 / 1920;
    const entrada = {
      zonas: [
        { desde: -1e9, hasta: 0, tipo: "corral" },
        { desde: 0, hasta: 900, tipo: "cuesta" },
        { desde: 900, hasta: 2600, tipo: "piedras" },
        { desde: 2600, hasta: 1e9, tipo: "recta" },
      ],
      y0: 180, y1: 560, u, F0: -120, corral: 500, metaX: 5200,
    };
    const esperadas: Roca[] = [];
    const T = 150 * u;
    entrada.zonas.forEach((z, zi) => {
      if (z.tipo !== "piedras" && z.tipo !== "cuesta") return;
      const a = Math.max(entrada.F0 - entrada.corral - 400 * u, z.desde), b = Math.min(entrada.metaX + 400 * u, z.hasta);
      for (let i = Math.floor(a / T); i * T < b; i++) {
        for (let m = 0; m < 4; m++) {
          const px = i * T + hashViejo(i * 31 + m, zi * 7 + 1) * T;
          if (px < a || px > b) continue;
          const py = entrada.y0 + (entrada.y1 + 30 * u - entrada.y0) * hashViejo(i * 17 + m, zi * 5 + 3);
          const r = hashViejo(i * 13 + m, zi * 3 + 9);
          if (z.tipo === "piedras") esperadas.push({ tipo: "roca", x: px, y: py, a: (0.9 + r * 1.1) * 30 * u, b: ((0.8 + r) * 30 * u) / ZC, giro: r * 7, alto: (0.6 + r * 0.7) * 30 * u });
          else esperadas.push({ tipo: "mata", x: px, y: py, a: 0.45 * 30 * u, b: (0.45 * 30 * u) / ZC, giro: 0, alto: (1.2 + r * 0.6) * 30 * u });
        }
      }
    });
    esperadas.sort((p, q) => p.x - q.x);
    const lista = rocasDeHoy(entrada);
    expect(lista.length).toBeGreaterThan(20);
    expect(lista.filter((r) => r.tipo === "roca").length).toBeGreaterThan(10);
    expect(lista.filter((r) => r.tipo === "mata").length).toBeGreaterThan(5);
    expect(lista).toEqual(esperadas);
    // Ordenadas por x, para que quien dibuja busque solo las cercanas.
    expect([...lista].sort((p, q) => p.x - q.x)).toEqual(lista);
  });

  it("sin zonas de piedras ni de cuesta, la lista queda vacía", () => {
    expect(rocasDeHoy({ zonas: [{ desde: 0, hasta: 1000, tipo: "barro" }], y0: 0, y1: 100, u: 1, F0: 0, corral: 0, metaX: 1000 })).toEqual([]);
  });
});

/** Una entrada de la siembra nueva con trayectorias rectas por fila: `porFila` llamas por fila avanzando parejo por las dos zonas. */
function entradaNueva(semilla: number, porFila = 1, conEchadas = false): EntradaRocas {
  const filasY = [180, 270, 360, 450];
  const muestras = new Map<number, Float64Array>();
  let persona = 0;
  for (const y of filasY) {
    for (let k = 0; k < porFila; k++) {
      const n = 180, a = new Float64Array(n * 4);
      for (let i = 0; i < n; i++) {
        a[i * 4] = -100 + i * 30 - k * 90;
        a[i * 4 + 1] = y;
        a[i * 4 + 2] = 0;
        a[i * 4 + 3] = 1;
      }
      muestras.set(persona++, a);
    }
  }
  return {
    semilla,
    zonas: [
      { desde: 0, hasta: 2600, tipo: "piedras" },
      { desde: 2600, hasta: 5200, tipo: "cuesta" },
    ],
    filasY, y0: 130, y1: 500,
    huella: { atras: 39, adelante: 41, medio: 12, alto: 109 },
    cuerpo: 130,
    muestras,
    echadas: conEchadas ? [{ quien: 1, t: 10 }, { quien: 5, t: 14 }] : [],
  };
}

/** ¿La elipse de la roca toca la caja de la huella en el punto (`x`, `y`)? La cuenta de la prueba, hecha aparte de la del módulo. */
function tocaHuella(r: Roca, x: number, y: number, huella: EntradaRocas["huella"]): boolean {
  const cx = x + (huella.adelante - huella.atras) / 2;
  const px = Math.max(cx - (huella.atras + huella.adelante) / 2, Math.min(r.x, cx + (huella.atras + huella.adelante) / 2));
  const py = Math.max(y - huella.medio, Math.min(r.y, y + huella.medio));
  const dx = (px - r.x) / r.a, dy = (py - r.y) / r.b;
  return dx * dx + dy * dy <= 1;
}

describe("la siembra nueva, en pasillos entre filas", () => {
  it("la huella crece con la llama: la que se agranda al pasar a su carril también descarta las rocas que toca", () => {
    // La llama de la fila de 270 pasa, en sus últimas muestras, con el doble de tamaño: su huella llega al doble de lejos de costado.
    const e = entradaNueva(7);
    const base = sembrarRocas(e);
    const grande = new Map(e.muestras);
    const a = new Float64Array(grande.get(1) as Float64Array);
    for (let i = 0; i < a.length / 4; i++) a[i * 4 + 3] = 2;
    grande.set(1, a);
    const conTamano = sembrarRocas({ ...e, muestras: grande, esc: 1 });
    // Sin decir con qué tamaño se armó la huella, la siembra no sabe que esa llama creció: da lo mismo que con la de siempre.
    expect(sembrarRocas({ ...e, muestras: grande })).toEqual(base);
    // Con el tamaño, ninguna roca que quede toca la huella agrandada de esa llama.
    const doble = { atras: 2 * e.huella.atras, adelante: 2 * e.huella.adelante, medio: 2 * e.huella.medio, alto: 2 * e.huella.alto };
    for (const r of conTamano) for (let i = 0; i < a.length / 4; i++) expect(tocaHuella(r, a[i * 4] as number, a[i * 4 + 1] as number, doble), `${r.tipo} en ${r.x.toFixed(0)}, ${r.y.toFixed(0)}`).toBe(false);
    expect(conTamano.length).toBeLessThan(base.length);
  });

  it("ninguna roca ni mata toca una trayectoria, en 200 semillas", () => {
    for (let semilla = 1; semilla <= 200; semilla++) {
      const e = entradaNueva(semilla);
      const lista = sembrarRocas(e);
      expect(lista.length).toBeGreaterThan(10);
      expect(lista.some((r) => r.tipo === "roca")).toBe(true);
      expect(lista.some((r) => r.tipo === "mata")).toBe(true);
      for (const r of lista) {
        for (const a of e.muestras.values()) {
          for (let i = 0; i + 3 < a.length; i += 4) {
            if (Math.abs(a[i]! - r.x) > r.a + e.huella.atras + e.huella.adelante) continue;
            expect(tocaHuella(r, a[i]!, a[i + 1]!, e.huella), `semilla ${semilla}, roca en ${r.x},${r.y}`).toBe(false);
          }
        }
      }
      // Ordenadas por x y dentro de los pasillos: ninguna cae sobre una fila.
      expect([...lista].sort((p, q) => p.x - q.x)).toEqual(lista);
      for (const r of lista) for (const y of e.filasY) expect(Math.abs(r.y - y)).toBeGreaterThan(r.b);
    }
  });

  it("con subfilas, cada pasillo deja libre la banda del lado de cada fila; con las bandas en cero, la lista de siempre", () => {
    for (let semilla = 1; semilla <= 40; semilla++) {
      const e = entradaNueva(semilla);
      expect(sembrarRocas({ ...e, bandas: e.filasY.map(() => ({ arriba: 0, abajo: 0 })) })).toEqual(sembrarRocas(e));
      // La fila 270 corre corrida 10 px hacia abajo, y la 360, 10 px hacia arriba y hacia abajo: las demás, en su línea.
      const bandas = [{ arriba: 0, abajo: 0 }, { arriba: 0, abajo: 10 }, { arriba: 10, abajo: 10 }, { arriba: 0, abajo: 0 }];
      const lista = sembrarRocas({ ...e, bandas });
      expect(lista.length).toBeGreaterThan(0);
      e.filasY.forEach((y, f) => {
        const b = bandas[f] as { arriba: number; abajo: number };
        for (const r of lista) {
          // Ninguna roca llega a la banda corrida de una fila: ni a la huella de la que corre arriba ni a la de la que corre abajo.
          if (b.arriba) expect(tocaHuella(r, r.x, y - b.arriba, e.huella), `semilla ${semilla}, fila ${y} arriba`).toBe(false);
          if (b.abajo) expect(tocaHuella(r, r.x, y + b.abajo, e.huella), `semilla ${semilla}, fila ${y} abajo`).toBe(false);
        }
      });
      // El pasillo entre 180 y 270 no tiene banda de ningún lado (la 270 se corre hacia abajo): sigue centrado. El de 360 a 450 tiene banda
      // solo arriba: se corre hacia abajo la mitad de lo que deja libre.
      for (const r of lista.filter((r) => r.y > 180 && r.y < 270)) expect(r.y).toBeCloseTo(225, 9);
      for (const r of lista.filter((r) => r.y > 360 && r.y < 450)) expect(r.y).toBeCloseTo(405 + (10 + 0.02 * e.huella.medio) / 2, 9);
    }
  });

  it("la misma entrada da la misma lista, se la pida como se la pida", () => {
    const e = entradaNueva(42, 2, true);
    expect(sembrarRocas(e)).toEqual(sembrarRocas(e));
    expect(sembrarRocas(entradaNueva(42, 2, true))).toEqual(sembrarRocas(e));
  });

  it("los señuelos solo sacan rocas: con echadas, la lista no crece", () => {
    for (let semilla = 1; semilla <= 20; semilla++) {
      expect(sembrarRocas(entradaNueva(semilla, 1, true)).length).toBeLessThanOrEqual(sembrarRocas(entradaNueva(semilla)).length);
    }
  });

  it("sin zonas de piedras ni de cuesta, la lista queda vacía", () => {
    const e = entradaNueva(7);
    expect(sembrarRocas({ ...e, zonas: [{ desde: 0, hasta: 1000, tipo: "barro" }] })).toEqual([]);
  });

  it("arma la lista de 30 personas en menos de 20 ms en promedio", () => {
    const e = entradaNueva(99, 8);
    sembrarRocas(e);
    const t0 = performance.now();
    for (let i = 0; i < 5; i++) sembrarRocas({ ...e, semilla: 100 + i });
    expect((performance.now() - t0) / 5).toBeLessThan(20);
  });
});
