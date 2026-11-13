import { describe, expect, it } from "vitest";
import { ajusteGanador } from "./ganador-altura";

/**
 * Cuando el cartel de cinco premios obliga a achicar al ganador, el despeje lo achica alrededor de su centro y lo
 * corre solo lo que haga falta. Antes lo achicaba desde la esquina de arriba a la izquierda de la pantalla, y el
 * caramelo de la piñata se iba 260 px a la izquierda justo cuando entraba el cartel (1366 x 768, cinco premios).
 */

const centroX = (c: { x: number; w: number }): number => c.x + c.w / 2;

/** Lo que hace `despejarGanador` con la escena: escala alrededor del centro del cuerpo y corre `dx`, `dy`. */
function aplicar(cuerpo: { x: number; y: number; w: number; h: number }, a: ReturnType<typeof ajusteGanador>) {
  const cx = cuerpo.x + cuerpo.w / 2, cy = cuerpo.y + cuerpo.h / 2;
  const punto = (px: number, py: number) => ({ x: cx + (px - cx) * a.s + a.dx, y: cy + (py - cy) * a.s + a.dy });
  const p0 = punto(cuerpo.x, cuerpo.y), p1 = punto(cuerpo.x + cuerpo.w, cuerpo.y + cuerpo.h);
  return { x: p0.x, y: p0.y, w: p1.x - p0.x, h: p1.y - p0.y };
}

describe("el despeje achica al ganador alrededor de su centro", () => {
  // El caramelo y la zona del cuadro de 35,25 s de la piñata con cinco premios en 1366 x 768.
  const caramelo = { x: 593, y: 284, w: 191, h: 237 };
  const zona = { x0: 2, y0: 441, x1: 1364, y1: 596 };

  it("con el cartel de cinco premios lo achica sin llevarlo a la izquierda", () => {
    const a = ajusteGanador(caramelo, zona);
    expect(a.s).toBeLessThan(0.7);
    expect(a.dx).toBe(0);
    expect(centroX(a.caja)).toBeCloseTo(centroX(caramelo), 9);
    expect(a.caja.y).toBeGreaterThanOrEqual(zona.y0 - 1e-9);
    expect(a.caja.y + a.caja.h).toBeLessThanOrEqual(zona.y1 + 1e-9);
  });

  it("la caja que devuelve es la que deja el estadio al aplicarlo", () => {
    for (const [c, z] of [
      [caramelo, zona],
      [{ x: 40, y: 100, w: 300, h: 400 }, { x0: 2, y0: 260, x1: 842, y1: 380 }],
      [{ x: 700, y: 80, w: 160, h: 300 }, { x0: 2, y0: 200, x1: 842, y1: 330 }],
      [{ x: 400, y: 260, w: 140, h: 100 }, { x0: 2, y0: 230, x1: 1022, y1: 400 }],
    ] as const) {
      const a = ajusteGanador(c, z), visto = aplicar(c, a);
      expect(visto.x).toBeCloseTo(a.caja.x, 9);
      expect(visto.y).toBeCloseTo(a.caja.y, 9);
      expect(visto.w).toBeCloseTo(a.caja.w, 9);
      expect(visto.h).toBeCloseTo(a.caja.h, 9);
    }
  });

  it("en un celular apaisado con banda angosta, achicado sigue en su lugar si entra de costado", () => {
    const c = { x: -20, y: 100, w: 300, h: 400 }, z = { x0: 2, y0: 260, x1: 842, y1: 380 };
    const a = ajusteGanador(c, z);
    expect(a.s).toBeCloseTo(120 / 400, 9);
    expect(a.dx).toBe(0);
    expect(centroX(a.caja)).toBeCloseTo(centroX(c), 9);
    expect(a.caja.y).toBeCloseTo(z.y0, 9);
    expect(a.caja.y + a.caja.h).toBeCloseTo(z.y1, 9);
  });

  it("si achicado todavía asoma por un costado, lo corre lo justo para que entre entero", () => {
    const c = { x: -200, y: 100, w: 300, h: 400 }, z = { x0: 2, y0: 260, x1: 842, y1: 380 };
    const a = ajusteGanador(c, z);
    expect(a.caja.x).toBeCloseTo(z.x0, 9);
    expect(a.dx).toBeCloseTo(97, 9);
    expect(a.caja.x + a.caja.w).toBeLessThanOrEqual(z.x1);
  });

  it("si ya cabe no lo toca, y si solo hace falta correrlo lo corre sin achicar", () => {
    const quieto = { x: 407.63272576999157, y: 260.1, w: 140.3, h: 100.7 };
    expect(ajusteGanador(quieto, { x0: 2, y0: 230, x1: 1022, y1: 400 })).toEqual({ s: 1, dx: 0, dy: 0, caja: quieto });
    const a = ajusteGanador({ x: 400, y: 200, w: 140, h: 100 }, { x0: 2, y0: 230, x1: 1022, y1: 400 });
    expect(a.s).toBe(1);
    expect(a.dx).toBe(0);
    expect(a.dy).toBe(30);
  });
});
