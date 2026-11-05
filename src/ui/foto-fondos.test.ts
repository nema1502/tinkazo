import { describe, expect, it } from "vitest";
import { pintarFondoJuego } from "./foto-fondos";

/**
 * El fondo dibujado de la foto del juego. En Node no hay lienzo: uno de
 * mentira anota cada llamada y cada propiedad que se cambia, y con eso se
 * comprueba lo que pide la marca (formas planas, colores macizos, sin
 * degradados ni desenfoque), que el dibujo no se salga de la foto, que deje el
 * lienzo como estaba y que sea siempre el mismo.
 */

interface Llamada {
  /** El método llamado, o `set <propiedad>`. */
  que: string;
  args: unknown[];
}

function lienzoFalso(registro: Llamada[]): CanvasRenderingContext2D {
  const estado: Record<string | symbol, unknown> = {};
  return new Proxy(estado, {
    get: (t, p) => {
      if (p in t) return t[p];
      return (...args: unknown[]) => {
        registro.push({ que: String(p), args });
        return undefined;
      };
    },
    set: (t, p, v) => {
      registro.push({ que: `set ${String(p)}`, args: [v] });
      t[p] = v;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

function pintar(juego: string, w = 1080, h = 1350): { pinto: boolean; log: Llamada[] } {
  const log: Llamada[] = [];
  const pinto = pintarFondoJuego(lienzoFalso(log), juego, w, h);
  return { pinto, log };
}

const texto = (log: Llamada[]): string[] => log.map((l) => `${l.que}(${l.args.map(String).join(",")})`);

const CON_FONDO = ["race", "sapo"] as const;
const FRANJA = ["#ff5cb3", "#ff8b3d", "#ffd24d", "#17c3b2", "#9b7bff"];

/** Los puntos (x, y) que toca cada llamada de trazado, con el radio que los rodea. */
function puntos(l: Llamada): Array<[number, number, number]> {
  const n = l.args as number[];
  switch (l.que) {
    case "fillRect":
    case "strokeRect":
    case "rect":
    case "roundRect":
      return [[n[0]!, n[1]!, 0], [n[0]! + n[2]!, n[1]! + n[3]!, 0]];
    case "moveTo":
    case "lineTo":
      return [[n[0]!, n[1]!, 0]];
    case "quadraticCurveTo":
      return [[n[0]!, n[1]!, 0], [n[2]!, n[3]!, 0]];
    case "bezierCurveTo":
      return [[n[0]!, n[1]!, 0], [n[2]!, n[3]!, 0], [n[4]!, n[5]!, 0]];
    case "arc":
      return [[n[0]!, n[1]!, n[2]!]];
    case "ellipse":
      return [[n[0]!, n[1]!, Math.max(n[2]!, n[3]!)]];
    default:
      return [];
  }
}

describe("pintarFondoJuego", () => {
  it("un juego sin fondo dibujado devuelve false y no toca el lienzo", () => {
    for (const juego of ["trompo", "chovena", "pinata", "wheel", "cablecar", "oruro", "guajojo", "toborochi", "", "Race", "SAPO", "nope", "__proto__", "constructor", "toString", "hasOwnProperty"]) {
      const { pinto, log } = pintar(juego);
      expect(pinto, juego).toBe(false);
      expect(log, juego).toEqual([]);
    }
  });

  for (const juego of CON_FONDO) {
    describe(juego, () => {
      it("devuelve true y dibuja bastante", () => {
        const { pinto, log } = pintar(juego);
        expect(pinto).toBe(true);
        expect(log.filter((l) => l.que === "fill" || l.que === "fillRect").length).toBeGreaterThan(40);
      });

      it("arranca pintando la foto entera, de borde a borde", () => {
        const { log } = pintar(juego);
        expect(texto(log)).toContain("fillRect(0,0,1080,1350)");
      });

      it("deja el lienzo como estaba: todo cambio de estado va entre save y restore equilibrados", () => {
        const { log } = pintar(juego);
        expect(log[0]?.que).toBe("save");
        expect(log[log.length - 1]?.que).toBe("restore");
        let hondo = 0;
        for (const l of log) {
          if (l.que === "save") hondo++;
          else if (l.que === "restore") hondo--;
          else if (l.que.startsWith("set ")) expect(hondo, l.que).toBeGreaterThan(0);
          expect(hondo).toBeGreaterThanOrEqual(0);
        }
        expect(hondo).toBe(0);
      });

      it("no se sale de la foto", () => {
        for (const [w, h] of [[1080, 1350], [540, 675]] as const) {
          const { log } = pintar(juego, w, h);
          for (const l of log) {
            for (const [x, y, r] of puntos(l)) {
              const dentro = x - r >= -1e-6 && y - r >= -1e-6 && x + r <= w + 1e-6 && y + r <= h + 1e-6;
              expect(dentro, `${w}x${h} ${l.que}(${l.args.join(",")})`).toBe(true);
            }
          }
        }
      });

      it("siempre es el mismo dibujo", () => {
        expect(texto(pintar(juego).log)).toEqual(texto(pintar(juego).log));
      });

      it("escala con el tamaño: a la mitad, las mismas llamadas con la mitad de medida", () => {
        const grande = pintar(juego, 1080, 1350).log;
        const chica = pintar(juego, 540, 675).log;
        expect(chica.map((l) => l.que)).toEqual(grande.map((l) => l.que));
        // Los ángulos de arc y ellipse no escalan: solo las medidas.
        const medidas = (l: Llamada): number => (l.que === "arc" ? 3 : l.que === "ellipse" ? 4 : l.args.length);
        grande.forEach((g, i) => {
          const ch = chica[i]!;
          g.args.forEach((a, j) => {
            const b = ch.args[j];
            if (typeof a === "number" && (j < medidas(g) || g.que === "set lineWidth")) expect(b as number, `${g.que} #${i}`).toBeCloseTo(a / 2, 6);
            else expect(b, `${g.que} #${i}`).toEqual(a);
          });
        });
      });

      it("es plano, como la marca: sin degradados, desenfoque, transparencia, imágenes ni texto", () => {
        const { log } = pintar(juego);
        const prohibidos = new Set([
          "createLinearGradient", "createRadialGradient", "createConicGradient", "createPattern", "drawImage",
          "putImageData", "fillText", "strokeText", "translate", "rotate", "scale", "transform", "setTransform", "clip",
          "set filter", "set shadowBlur", "set shadowColor", "set shadowOffsetX", "set shadowOffsetY", "set globalCompositeOperation",
        ]);
        for (const l of log) {
          expect(prohibidos.has(l.que), l.que).toBe(false);
          if (l.que === "set globalAlpha") expect(l.args[0]).toBe(1);
          if (l.que === "set fillStyle" || l.que === "set strokeStyle") expect(String(l.args[0]), l.que).toMatch(/^#[0-9a-f]{6}$/);
        }
      });

      it("lleva los cinco colores de la franja y la tinta de los bordes", () => {
        const { log } = pintar(juego);
        const rellenos = new Set(log.filter((l) => l.que === "set fillStyle").map((l) => String(l.args[0])));
        for (const color of FRANJA) expect(rellenos.has(color), color).toBe(true);
        const trazos = log.filter((l) => l.que === "set strokeStyle").map((l) => String(l.args[0]));
        expect(trazos).toContain("#191919");
        expect(log.filter((l) => l.que === "stroke").length).toBeGreaterThan(20);
      });
    });
  }

  it("cada juego tiene su dibujo", () => {
    expect(texto(pintar("race").log)).not.toEqual(texto(pintar("sapo").log));
  });
});

/**
 * Lo que se ve en la foto del juego: entre el panel de arriba (hasta y≈220) y
 * el del nombre (desde y≈556) queda una ventana de borde a borde sin paneles.
 * El motivo principal de cada juego tiene que caber entero ahí.
 */
const VENTANA = { arriba: 236, abajo: 548 } as const;
const CREMA = "#f6efe2";

/** Una forma pintada: su relleno o su trazo, el color y la caja que ocupa. */
interface Forma {
  como: "fill" | "stroke";
  color: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Los puntos del camino, si fue un polígono. */
  pts: Array<[number, number]>;
  /** Los argumentos de la elipse, si fue una elipse sola. */
  elipse?: number[];
}

/** Sigue los caminos del registro y devuelve cada fill y stroke con su color y su caja. */
function formas(log: Llamada[]): Forma[] {
  const out: Forma[] = [];
  let pts: Array<[number, number]> = [];
  let cajas: Array<[number, number, number, number]> = [];
  let elipses: number[][] = [];
  let relleno = "", trazo = "";
  for (const l of log) {
    const n = l.args as number[];
    if (l.que === "beginPath") {
      pts = [];
      cajas = [];
      elipses = [];
    } else if (l.que === "moveTo" || l.que === "lineTo") {
      pts.push([n[0]!, n[1]!]);
      cajas.push([n[0]!, n[1]!, n[0]!, n[1]!]);
    } else if (l.que === "ellipse") {
      elipses.push(n);
      cajas.push([n[0]! - n[2]!, n[1]! - n[3]!, n[0]! + n[2]!, n[1]! + n[3]!]);
    } else if (l.que === "set fillStyle") relleno = String(l.args[0]);
    else if (l.que === "set strokeStyle") trazo = String(l.args[0]);
    else if ((l.que === "fill" || l.que === "stroke") && cajas.length) {
      out.push({
        como: l.que,
        color: l.que === "fill" ? relleno : trazo,
        x0: Math.min(...cajas.map((b) => b[0])),
        y0: Math.min(...cajas.map((b) => b[1])),
        x1: Math.max(...cajas.map((b) => b[2])),
        y1: Math.max(...cajas.map((b) => b[3])),
        pts: [...pts],
        elipse: elipses.length === 1 && pts.length === 0 ? elipses[0] : undefined,
      });
    }
  }
  return out;
}

/** El cuerpo de cada llama: el óvalo del lomo (24 × 13 en sus unidades) da dónde está y su tamaño. */
function llamas(fs: Forma[]): Array<{ x0: number; y0: number; x1: number; y1: number; u: number }> {
  return fs
    .filter((f) => f.como === "fill" && f.elipse && f.elipse[2]! > 30 && Math.abs(f.elipse[2]! / f.elipse[3]! - 24 / 13) < 0.01)
    .map((f) => {
      const [x, y, rx] = f.elipse as [number, number, number];
      const u = rx / 24;
      // Del rabo (-36) al hocico (+40); de las orejas y el pompón del líder (-102) a las pezuñas (+2), con el lomo a -36.
      return { x0: x - 36 * u, x1: x + 40 * u, y0: y + (36 - 102) * u, y1: y + (36 + 2) * u, u };
    });
}

const cruza = (a: { x0: number; y0: number; x1: number; y1: number }, b: { x0: number; y0: number; x1: number; y1: number }): boolean =>
  a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
const enVentana = (f: { y0: number; y1: number }): boolean => f.y0 >= VENTANA.arriba && f.y1 <= VENTANA.abajo;

describe("el motivo de cada juego cabe en la ventana sin paneles", () => {
  it("race: las cuatro llamas al galope, enteras, en la ventana", () => {
    const ls = llamas(formas(pintar("race").log));
    expect(ls.length).toBe(4);
    for (const l of ls) {
      expect(enVentana(l), `llama y ${l.y0.toFixed(0)}–${l.y1.toFixed(0)}`).toBe(true);
      expect(l.x0 >= 0 && l.x1 <= 1080, `llama x ${l.x0.toFixed(0)}–${l.x1.toFixed(0)}`).toBe(true);
    }
  });

  it("race: las rayas de velocidad quedan atrás de cada llama, nunca encima de ninguna", () => {
    const fs = formas(pintar("race").log);
    const ls = llamas(fs);
    const u = ls[0]!.u;
    // Las rayas: barras crema horizontales de 5 unidades de alto.
    const rayas = fs.filter((f) => f.como === "fill" && f.color === CREMA && f.pts.length === 4 && Math.abs(f.y1 - f.y0 - 5 * u) < 0.01);
    expect(rayas.length).toBe(12);
    for (const r of rayas) for (const l of ls) expect(cruza(r, l), `raya x ${r.x0.toFixed(0)}–${r.x1.toFixed(0)} y ${r.y0.toFixed(0)} sobre llama x ${l.x0.toFixed(0)}–${l.x1.toFixed(0)}`).toBe(false);
  });

  it("sapo: la rana de bronce entera y al menos dos argollas (una en la boca) en la ventana", () => {
    const fs = formas(pintar("sapo").log);
    const bronce = fs.filter((f) => f.como === "fill" && f.color === "#b98a3e");
    expect(bronce.length).toBeGreaterThanOrEqual(3);
    for (const b of bronce) expect(enVentana(b), `bronce y ${b.y0.toFixed(0)}–${b.y1.toFixed(0)}`).toBe(true);
    const argollas = fs.filter((f) => f.como === "stroke" && f.color === "#ffc629" && f.elipse && enVentana(f));
    expect(argollas.length).toBeGreaterThanOrEqual(2);
  });
});
