import { describe, expect, it } from "vitest";
import { fondoGuajojo } from "./guajojo";
import type { Pincel } from "./lapiz";

/**
 * El fondo del Guajojó para la foto del juego. En Node no hay lienzo: uno de
 * mentira anota cada llamada y cada propiedad que se cambia (como en
 * `foto-fondos.test.ts`), y con eso se comprueba el dibujo de la marca, que no
 * se salga de la foto, que sea siempre el mismo y que el guajojó entero quede
 * en la ventana sin paneles (y = 250–540).
 */

interface Llamada {
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

function pintar(w = 1080, h = 1350): Llamada[] {
  const log: Llamada[] = [];
  const p: Pincel = { c: lienzoFalso(log), fx: w / 1080, fy: h / 1350 };
  fondoGuajojo(p);
  return log;
}

const texto = (log: Llamada[]): string[] => log.map((l) => `${l.que}(${l.args.map(String).join(",")})`);
const FRANJA = ["#ff5cb3", "#ff8b3d", "#ffd24d", "#17c3b2", "#9b7bff"];

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

interface Forma {
  como: "fill" | "stroke";
  color: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  elipse: boolean;
}

function formas(log: Llamada[]): Forma[] {
  const out: Forma[] = [];
  let cajas: Array<[number, number, number, number]> = [];
  let elipses = 0;
  let relleno = "", trazo = "";
  for (const l of log) {
    const n = l.args as number[];
    if (l.que === "beginPath") {
      cajas = [];
      elipses = 0;
    } else if (l.que === "moveTo" || l.que === "lineTo") cajas.push([n[0]!, n[1]!, n[0]!, n[1]!]);
    else if (l.que === "ellipse") {
      elipses++;
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
        elipse: elipses === 1 && cajas.length === 1,
      });
    }
  }
  return out;
}

const VENTANA = { arriba: 250, abajo: 540 } as const;
const enVentana = (f: Forma): boolean => f.y0 >= VENTANA.arriba && f.y1 <= VENTANA.abajo && f.x0 >= 0 && f.x1 <= 1080;

/** Los colores del guajojó: el plumaje de corteza y sus ojos amarillos enormes. */
const PLUMA = "#8a7660";
const OJO = "#ffd23a";

describe("fondoGuajojo", () => {
  it("dibuja bastante", () => {
    const log = pintar();
    expect(log.filter((l) => l.que === "fill" || l.que === "fillRect").length).toBeGreaterThan(40);
  });

  it("si usa save y restore, van equilibrados", () => {
    let hondo = 0;
    for (const l of pintar()) {
      if (l.que === "save") hondo++;
      else if (l.que === "restore") hondo--;
      expect(hondo).toBeGreaterThanOrEqual(0);
    }
    expect(hondo).toBe(0);
  });

  it("no se sale de la foto", () => {
    for (const [w, h] of [[1080, 1350], [540, 675]] as const) {
      for (const l of pintar(w, h)) {
        for (const [x, y, r] of puntos(l)) {
          const dentro = x - r >= -1e-6 && y - r >= -1e-6 && x + r <= w + 1e-6 && y + r <= h + 1e-6;
          expect(dentro, `${w}x${h} ${l.que}(${l.args.join(",")})`).toBe(true);
        }
      }
    }
  });

  it("siempre es el mismo dibujo", () => {
    expect(texto(pintar())).toEqual(texto(pintar()));
  });

  it("escala con el tamaño: a la mitad, las mismas llamadas con la mitad de medida", () => {
    const grande = pintar(1080, 1350);
    const chica = pintar(540, 675);
    expect(chica.map((l) => l.que)).toEqual(grande.map((l) => l.que));
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
    const prohibidos = new Set([
      "createLinearGradient", "createRadialGradient", "createConicGradient", "createPattern", "drawImage",
      "putImageData", "fillText", "strokeText", "translate", "rotate", "scale", "transform", "setTransform", "clip",
      "set filter", "set shadowBlur", "set shadowColor", "set shadowOffsetX", "set shadowOffsetY", "set globalCompositeOperation",
    ]);
    for (const l of pintar()) {
      expect(prohibidos.has(l.que), l.que).toBe(false);
      if (l.que === "set globalAlpha") expect(l.args[0]).toBe(1);
      if (l.que === "set fillStyle" || l.que === "set strokeStyle") expect(String(l.args[0]), l.que).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it("lleva los cinco colores de la franja, la tinta de los bordes y la sombra dura", () => {
    const log = pintar();
    const rellenos = new Set(log.filter((l) => l.que === "set fillStyle").map((l) => String(l.args[0])));
    for (const color of FRANJA) expect(rellenos.has(color), color).toBe(true);
    expect(rellenos.has("#0b0814")).toBe(true);
    const trazos = log.filter((l) => l.que === "set strokeStyle").map((l) => String(l.args[0]));
    expect(trazos).toContain("#191919");
    expect(log.filter((l) => l.que === "stroke").length).toBeGreaterThan(20);
  });

  it("el guajojó entero, con sus dos ojos amarillos, queda en la ventana sin paneles", () => {
    const fs = formas(pintar());
    const ojos = fs.filter((f) => f.como === "fill" && f.color === OJO && f.elipse);
    expect(ojos.length).toBe(2);
    for (const o of ojos) {
      expect(enVentana(o), `ojo y ${o.y0.toFixed(0)}–${o.y1.toFixed(0)}`).toBe(true);
      expect(o.x1 - o.x0, "ojos grandes").toBeGreaterThan(40);
    }
    const pluma = fs.filter((f) => f.como === "fill" && f.color === PLUMA);
    expect(pluma.length).toBeGreaterThanOrEqual(2);
    for (const b of pluma) expect(enVentana(b), `plumaje y ${b.y0.toFixed(0)}–${b.y1.toFixed(0)}`).toBe(true);
    // Parado derecho como un palo: el cuerpo es largo y angosto.
    const cuerpo = pluma.reduce((a, b) => (b.y1 - b.y0 > a.y1 - a.y0 ? b : a));
    expect(cuerpo.y1 - cuerpo.y0).toBeGreaterThan(220);
    expect(cuerpo.y1 - cuerpo.y0).toBeGreaterThan(2 * (cuerpo.x1 - cuerpo.x0));
  });
});
