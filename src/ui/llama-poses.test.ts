// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { BORDE, CAJA, POSES, POSES_DE_LLAMA, SOMBRA, svgDeLlama, type PoseDeLlama, type Rect } from "./llama-poses";

/**
 * Las poses de la llama que acompaña: la llama del logo en cinco poses, como SVG en línea, liviano y con los colores
 * del tema. Se mira también la geometría: de pie apoya en el piso del camino, en el festejo está en el aire, y nada se
 * sale de la caja común.
 */

type M = [number, number, number, number, number, number];
const mul = (A: M, B: M): M => [A[0] * B[0] + A[2] * B[1], A[1] * B[0] + A[3] * B[1], A[0] * B[2] + A[2] * B[3], A[1] * B[2] + A[3] * B[3], A[0] * B[4] + A[2] * B[5] + A[4], A[1] * B[4] + A[3] * B[5] + A[5]];
function matriz(t?: string): M {
  let m: M = [1, 0, 0, 1, 0, 0];
  for (const x of (t ?? "").matchAll(/(translate|rotate)\(([^)]*)\)/g)) {
    const v = (x[2] as string).trim().split(/[\s,]+/).map(Number);
    if (x[1] === "translate") m = mul(m, [1, 0, 0, 1, v[0] ?? 0, v[1] ?? 0]);
    else {
      const r = ((v[0] ?? 0) * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r), cx = v[1] ?? 0, cy = v[2] ?? 0;
      m = mul(mul(mul(m, [1, 0, 0, 1, cx, cy]), [c, s, -s, c, 0, 0]), [1, 0, 0, 1, -cx, -cy]);
    }
  }
  return m;
}
const esquinas = (m: M, [x, y, w, h]: Rect): Array<[number, number]> =>
  [[x, y], [x + w, y], [x + w, y + h], [x, y + h]].map(([a, b]): [number, number] => [m[0] * (a as number) + m[2] * (b as number) + m[4], m[1] * (a as number) + m[3] * (b as number) + m[5]]);
/** Los puntos de la llama (sin el papel picado ni los trazos), ya girados. */
const puntos = (pose: PoseDeLlama): Array<[number, number]> => {
  const p = POSES_DE_LLAMA[pose];
  const todo = matriz(p.todo);
  return p.partes.flatMap((x) => esquinas(mul(todo, matriz(x.t)), x.r));
};
const piso = (pose: PoseDeLlama): number => Math.max(...puntos(pose).map(([, y]) => y));

describe("cada pose es un SVG en línea con la llama del logo", () => {
  for (const pose of POSES) {
    it(`${pose}: decorativo, en la caja común, con sombra, borde y relleno de las mismas partes`, () => {
      const svg = svgDeLlama(pose);
      const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
      const raiz = doc.documentElement;
      expect(raiz.getAttribute("aria-hidden")).toBe("true");
      expect(raiz.getAttribute("focusable")).toBe("false");
      expect(raiz.getAttribute("viewBox")).toBe(`${CAJA.x} ${CAJA.y} ${CAJA.ancho} ${CAJA.alto}`);
      expect(raiz.getAttribute("data-pose")).toBe(pose);
      const capas = [...raiz.children].slice(0, 3);
      expect(capas.map((c) => c.getAttribute("style"))).toEqual([
        expect.stringContaining("fill:var(--ink"),
        expect.stringContaining("fill:var(--ink"),
        expect.stringContaining("fill:var(--magenta"),
      ]);
      expect(capas[0]?.getAttribute("transform")).toMatch(/^translate\(/);
      const n = POSES_DE_LLAMA[pose].partes.length;
      for (const c of capas) expect(c.querySelectorAll("rect")).toHaveLength(n);
      expect(svg).not.toMatch(/<script|<image|href=|on[a-z]+=/i);
    });
  }

  it("los colores son los del tema: ningún color fijo fuera de los de respaldo de cada variable", () => {
    for (const pose of POSES) {
      const sinRespaldo = svgDeLlama(pose).replace(/var\(--[a-z]+,#[0-9a-f]{6}\)/g, "");
      expect(sinRespaldo, pose).not.toMatch(/#[0-9a-f]{3,6}\b/i);
    }
  });

  it("el papel picado del festejo lleva los cinco colores de la marca, y ninguna otra pose lleva papel", () => {
    const colores = new Set((POSES_DE_LLAMA.festeja.papel ?? []).map((p) => p.color));
    expect([...colores].sort()).toEqual(["magenta", "orange", "purple", "teal", "yellow"]);
    for (const pose of POSES) if (pose !== "festeja") expect(POSES_DE_LLAMA[pose].papel, pose).toBeUndefined();
  });

  it("es liviano: cada pose, ya armada, pesa menos de 3 KB en la página", () => {
    for (const p of POSES) expect(new TextEncoder().encode(svgDeLlama(p)).length, p).toBeLessThan(3000);
  });

  it("se arma una sola vez por pose", () => {
    expect(svgDeLlama("anima")).toBe(svgDeLlama("anima"));
  });
});

describe("la geometría de las poses", () => {
  it("de pie y echada apoya en el piso del camino (y = 24), sin flotar ni hundirse", () => {
    for (const pose of ["saluda", "anima", "espera", "preocupa"] as const) {
      expect(piso(pose), pose).toBeGreaterThan(23);
      expect(piso(pose), pose).toBeLessThan(24.8);
    }
  });

  it("en el festejo está en el aire", () => {
    expect(piso("festeja")).toBeLessThan(22);
  });

  it("nada se sale de la caja común: la llama con su borde y su sombra, los trazos y el papel picado", () => {
    const der = CAJA.x + CAJA.ancho, abajo = CAJA.y + CAJA.alto;
    for (const pose of POSES) {
      const p = POSES_DE_LLAMA[pose];
      for (const [x, y] of puntos(pose)) {
        expect(x - BORDE / 2, pose).toBeGreaterThanOrEqual(CAJA.x);
        expect(y - BORDE / 2, pose).toBeGreaterThanOrEqual(CAJA.y);
        expect(x + BORDE / 2 + SOMBRA, pose).toBeLessThanOrEqual(der);
        expect(y + BORDE / 2 + SOMBRA, pose).toBeLessThanOrEqual(abajo + 1.2);
      }
      for (const [x, y] of [...(p.detalle ?? []), ...(p.papel ?? [])].flatMap((x) => esquinas(matriz(x.t), x.r))) {
        expect(x, pose).toBeGreaterThanOrEqual(CAJA.x);
        expect(x, pose).toBeLessThanOrEqual(der);
        expect(y, pose).toBeGreaterThanOrEqual(CAJA.y);
        expect(y, pose).toBeLessThanOrEqual(abajo);
      }
    }
  });

  it("la pata que saluda nace adentro del pecho y apunta hacia adelante y arriba", () => {
    const pata = POSES_DE_LLAMA.saluda.partes.find((x) => x.anima === "pata");
    expect(pata).toBeDefined();
    const pts = esquinas(mul(matriz(POSES_DE_LLAMA.saluda.todo), matriz(pata?.t)), pata?.r as Rect);
    // Ningún punto de la pata baja del vientre (y = 18): no asoma por debajo como una pata más.
    for (const [, y] of pts) expect(y).toBeLessThan(18.6);
    expect(Math.max(...pts.map(([x]) => x))).toBeGreaterThan(20);
  });
});
