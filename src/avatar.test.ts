import { describe, expect, it } from "vitest";
import { avatar, drawAvatar } from "./avatar";

/**
 * El avatar tiene dos caminos: el SVG para la página y el dibujo directo para
 * los juegos. Tienen que ser el mismo dibujo, si no la ficha de alguien en el
 * estadio no se parece a su foto en la lista.
 */

const NOMBRES = ["María Quispe", "Jorge Mamani", "Óscar Limachi", "Ana", "山田", ""];

/** Las celdas de tinta del SVG, en la grilla de 7 por 7. */
function celdasSvg(name: string): string[] {
  const svg = decodeURIComponent(avatar(name, 64).replace("data:image/svg+xml,", ""));
  const tinta = svg.slice(svg.indexOf("<g"));
  return [...tinta.matchAll(/<rect x="(\d)" y="(\d)" width="1" height="1"\/>/g)].map((m) => `${m[1]},${m[2]}`).sort();
}

/** Un lienzo de mentira que anota cada rectángulo y su color. */
function lienzo(): { c: CanvasRenderingContext2D; rects: { x: number; y: number; w: number; h: number; fill: string }[] } {
  const rects: { x: number; y: number; w: number; h: number; fill: string }[] = [];
  const c = {
    fillStyle: "",
    fillRect(x: number, y: number, w: number, h: number) {
      rects.push({ x, y, w, h, fill: String(this.fillStyle) });
    },
  };
  return { c: c as unknown as CanvasRenderingContext2D, rects };
}

describe("avatar", () => {
  it("el mismo nombre da siempre el mismo dibujo, y nombres distintos no", () => {
    expect(avatar("María Quispe", 64)).toBe(avatar("María Quispe", 64));
    expect(avatar("María Quispe", 64)).not.toBe(avatar("Maria Quispe", 64));
  });

  it("es simétrico: cada celda tiene su espejo", () => {
    for (const n of NOMBRES) {
      const cs = new Set(celdasSvg(n));
      for (const c of cs) {
        const [x, y] = c.split(",").map(Number) as [number, number];
        expect(cs.has(`${6 - x},${y}`)).toBe(true);
      }
    }
  });

  it("el lienzo pinta exactamente las celdas del SVG", () => {
    for (const n of NOMBRES) {
      const { c, rects } = lienzo();
      drawAvatar(c, n, 0, 0, 70);
      const [fondo, ...tinta] = rects;
      expect(fondo?.w).toBe(70);
      // Con 70 px la celda mide 10 exactos: la grilla se lee sin redondeo.
      const celdas = tinta.map((r) => `${r.x / 10},${r.y / 10}`).sort();
      expect(celdas).toEqual(celdasSvg(n));
      expect(tinta.every((r) => r.fill === "#191919")).toBe(true);
    }
  });

  it("a cualquier tamaño las celdas vecinas se tocan: no hay rayas entre ellas", () => {
    for (const size of [17, 23.5, 41.3, 64]) {
      const { c, rects } = lienzo();
      drawAvatar(c, "Jorge Mamani", 3.7, 9.2, size);
      const tinta = rects.slice(1);
      for (const a of tinta) {
        expect(Number.isInteger(a.x) && Number.isInteger(a.y) && Number.isInteger(a.w) && Number.isInteger(a.h)).toBe(true);
        // El vecino de la derecha, si existe, empieza donde este termina.
        const derecha = tinta.find((b) => b.y === a.y && b.x > a.x && b.x <= a.x + a.w + 1);
        if (derecha) expect(derecha.x).toBe(a.x + a.w);
      }
    }
  });
});
