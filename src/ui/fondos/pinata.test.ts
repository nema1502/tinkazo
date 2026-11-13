import { describe, expect, it } from "vitest";
import { fondoPinata } from "./pinata";

/**
 * El fondo de la piñata, en un lienzo de mentira que anota cada llamada y cada
 * propiedad que se cambia (como `foto-fondos.test.ts`): plano como la marca,
 * dentro de la foto, siempre el mismo, y la piñata entera en la ventana libre
 * de la foto del juego (y = 250 a 540, entre el panel de arriba y el del nombre).
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
  fondoPinata({ c: lienzoFalso(log), fx: w / 1080, fy: h / 1350 });
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
  elipse?: number[];
}

/** Cada fill y stroke con su color, su caja y, si fue una elipse sola, sus medidas. */
function formas(log: Llamada[]): Forma[] {
  const out: Forma[] = [];
  let cajas: Array<[number, number, number, number]> = [];
  let elipses: number[][] = [];
  let lineas = 0;
  let relleno = "", trazo = "";
  for (const l of log) {
    const n = l.args as number[];
    if (l.que === "beginPath") {
      cajas = [];
      elipses = [];
      lineas = 0;
    } else if (l.que === "moveTo" || l.que === "lineTo") {
      lineas++;
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
        elipse: elipses.length === 1 && lineas === 0 ? elipses[0] : undefined,
      });
    }
  }
  return out;
}

describe("fondoPinata", () => {
  it("dibuja bastante, con bordes de tinta", () => {
    const log = pintar();
    expect(log.filter((l) => l.que === "fill" || l.que === "fillRect").length).toBeGreaterThan(40);
    expect(log.filter((l) => l.que === "stroke").length).toBeGreaterThan(20);
    expect(log.filter((l) => l.que === "set strokeStyle").map((l) => String(l.args[0]))).toContain("#191919");
  });

  it("lleva los cinco colores de la franja", () => {
    const rellenos = new Set(pintar().filter((l) => l.que === "set fillStyle").map((l) => String(l.args[0])));
    for (const color of FRANJA) expect(rellenos.has(color), color).toBe(true);
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

  it("si usa save y restore, van equilibrados", () => {
    let hondo = 0;
    for (const l of pintar()) {
      if (l.que === "save") hondo++;
      else if (l.que === "restore") hondo--;
      expect(hondo).toBeGreaterThanOrEqual(0);
    }
    expect(hondo).toBe(0);
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

  it("la piñata de estrella entera (la olla, los siete picos y sus flecos) cabe en la ventana y = 250 a 540", () => {
    const fs = formas(pintar());
    // La olla: el único círculo naranja grande.
    const ollas = fs.filter((f) => f.como === "fill" && f.color === "#ff8b3d" && f.elipse && f.elipse[2]! >= 50 && f.elipse[2] === f.elipse[3]);
    expect(ollas.length).toBe(1);
    const [cx, cy, r] = ollas[0]!.elipse as [number, number, number];
    // Todo lo pintado cerca de la olla (los picos llegan a 1,75 radios y los flecos cuelgan un poco más) es la piñata o sale de ella.
    const pinata = fs.filter((f) => Math.hypot((f.x0 + f.x1) / 2 - cx, (f.y0 + f.y1) / 2 - cy) <= 2 * r && f.x1 - f.x0 < 4 * r);
    expect(pinata.length).toBeGreaterThan(14);
    const y0 = Math.min(...pinata.map((f) => f.y0)), y1 = Math.max(...pinata.map((f) => f.y1));
    expect(y1 - y0, "la estrella mide de pico a pico").toBeGreaterThan(3.4 * r);
    expect(y0 >= 250 && y1 <= 540, `piñata y ${y0.toFixed(0)} a ${y1.toFixed(0)}`).toBe(true);
    // Los siete picos: triángulos de colores alrededor de la olla.
    const picos = fs.filter((f) => f.como === "fill" && FRANJA.includes(f.color) && !f.elipse && Math.hypot((f.x0 + f.x1) / 2 - cx, (f.y0 + f.y1) / 2 - cy) > r && Math.hypot((f.x0 + f.x1) / 2 - cx, (f.y0 + f.y1) / 2 - cy) < 1.5 * r);
    expect(picos.length).toBeGreaterThanOrEqual(7);
  });

  it("caramelos volando en la ventana, junto a la piñata", () => {
    const fs = formas(pintar());
    // Un caramelo: el cuerpo es un óvalo cerrado de colores (polígono), con sus dos puntas retorcidas; se cuentan los cuerpos.
    const ollas = fs.filter((f) => f.como === "fill" && f.color === "#ff8b3d" && f.elipse && f.elipse[2]! >= 50);
    const [cx, cy, r] = ollas[0]!.elipse as [number, number, number];
    const caramelos = fs.filter((f) => f.como === "fill" && FRANJA.includes(f.color) && !f.elipse && f.y0 >= 250 && f.y1 <= 540 && f.x1 - f.x0 < 70 && Math.hypot((f.x0 + f.x1) / 2 - cx, (f.y0 + f.y1) / 2 - cy) > 1.9 * r);
    expect(caramelos.length).toBeGreaterThanOrEqual(6);
  });
});
