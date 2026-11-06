import { describe, expect, it, vi } from "vitest";
import { fondoTeleferico } from "./teleferico";

/**
 * El fondo del Teleférico. En Node no hay lienzo: uno de mentira anota cada
 * llamada y cada propiedad que se cambia (como en `foto-fondos.test.ts`), y con
 * eso se comprueba el dibujo de la marca, que no se salga de la foto, que sea
 * siempre el mismo y que las cabinas queden en la ventana libre de la foto.
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
  fondoTeleferico({ c: lienzoFalso(log), fx: w / 1080, fy: h / 1350 });
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

/** Una forma pintada: su relleno o su trazo, el color, la caja que ocupa y cuántos puntos tiene su camino. */
interface Forma {
  como: "fill" | "stroke";
  color: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  n: number;
}

function formas(log: Llamada[]): Forma[] {
  const out: Forma[] = [];
  let cajas: Array<[number, number, number, number]> = [];
  let n = 0;
  let relleno = "", trazo = "";
  for (const l of log) {
    const a = l.args as number[];
    if (l.que === "beginPath") {
      cajas = [];
      n = 0;
    } else if (l.que === "moveTo" || l.que === "lineTo") {
      cajas.push([a[0]!, a[1]!, a[0]!, a[1]!]);
      n++;
    } else if (l.que === "ellipse") cajas.push([a[0]! - a[2]!, a[1]! - a[3]!, a[0]! + a[2]!, a[1]! + a[3]!]);
    else if (l.que === "set fillStyle") relleno = String(l.args[0]);
    else if (l.que === "set strokeStyle") trazo = String(l.args[0]);
    else if ((l.que === "fill" || l.que === "stroke") && cajas.length) {
      out.push({
        como: l.que,
        color: l.que === "fill" ? relleno : trazo,
        x0: Math.min(...cajas.map((b) => b[0])),
        y0: Math.min(...cajas.map((b) => b[1])),
        x1: Math.max(...cajas.map((b) => b[2])),
        y1: Math.max(...cajas.map((b) => b[3])),
        n,
      });
    }
  }
  return out;
}

/** La franja libre de la foto del juego, entre el panel de arriba y el del nombre. */
const VENTANA = { arriba: 250, abajo: 540 } as const;
const enVentana = (f: { y0: number; y1: number }): boolean => f.y0 >= VENTANA.arriba && f.y1 <= VENTANA.abajo;

describe("fondoTeleferico", () => {
  it("dibuja bastante, con rellenos y bordes", () => {
    const log = pintar();
    expect(log.filter((l) => l.que === "fill" || l.que === "fillRect").length).toBeGreaterThan(40);
    expect(log.filter((l) => l.que === "stroke").length).toBeGreaterThan(20);
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

  it("siempre es el mismo dibujo y no usa Math.random", () => {
    const azar = vi.spyOn(Math, "random");
    expect(texto(pintar())).toEqual(texto(pintar()));
    expect(azar).not.toHaveBeenCalled();
    azar.mockRestore();
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
    expect(log.filter((l) => l.que === "set strokeStyle").map((l) => String(l.args[0]))).toContain("#191919");
  });

  it("el motivo cabe en la ventana sin paneles: las cinco cabinas, la ganadora prendida con su contorno amarillo, y los cables", () => {
    const fs = formas(pintar());
    // El cuerpo de cada cabina: un octógono (las esquinas cortadas) de un color de la franja.
    const cabinas = fs.filter((f) => f.como === "fill" && f.n === 8 && FRANJA.includes(f.color));
    expect(cabinas.length).toBe(5);
    for (const c of cabinas) expect(enVentana(c), `cabina ${c.color} y ${c.y0.toFixed(0)}–${c.y1.toFixed(0)}`).toBe(true);
    expect(new Set(cabinas.map((c) => c.color)).size).toBe(5);
    // La ganadora: el contorno amarillo y la ventana prendida, una sola vez.
    const contorno = fs.filter((f) => f.como === "fill" && f.n === 8 && f.color === "#ffc629" && f.x1 - f.x0 > 100);
    expect(contorno.length).toBe(1);
    expect(enVentana(contorno[0]!)).toBe(true);
    const prendida = fs.filter((f) => f.como === "fill" && f.color === "#fff1c4");
    expect(prendida.length).toBe(1);
    expect(enVentana(prendida[0]!)).toBe(true);
    // Los cables de acero cruzan la foto de borde a borde dentro de la ventana.
    const cables = fs.filter((f) => f.como === "stroke" && f.color === "#9aa1ad" && f.x0 === 0 && f.x1 === 1080);
    expect(cables.length).toBe(4);
    for (const c of cables) expect(enVentana(c), `cable y ${c.y0.toFixed(0)}–${c.y1.toFixed(0)}`).toBe(true);
  });
});
