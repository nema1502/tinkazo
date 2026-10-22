import { describe, expect, it } from "vitest";
import { esSerpentina, reves, tira } from "./papel-picado";

const W = 1280, H = 720;
const visibles = (tt: number, n = 240, k = 1): number => {
  let v = 0;
  for (let i = 0; i < n; i++) {
    const p = tira(i, tt, k, W, H);
    if (p && p.y > -10 && p.y < H && p.x > 0 && p.x < W) v++;
  }
  return v;
};

describe("papel picado", () => {
  it("la misma tira a la misma hora está en el mismo lugar: sale de la hora, no se acumula", () => {
    for (const i of [0, 3, 57, 239]) {
      for (const tt of [0.4, 1.3, 2.7]) expect(tira(i, tt, 1, W, H)).toEqual(tira(i, tt, 1, W, H));
    }
  });

  it("antes de salir y después de caer no se dibuja", () => {
    expect(tira(0, -0.1, 1, W, H)).toBeNull();
    expect(visibles(30)).toBe(0);
  });

  it("frenada por el aire, sigue en el aire mientras está el cartel (antes, al segundo y medio no quedaba casi nada)", () => {
    expect(visibles(1.5)).toBeGreaterThan(150);
    expect(visibles(3)).toBeGreaterThan(110);
  });

  it("crece con la pantalla, y las serpentinas son largas y finitas", () => {
    const a = tira(10, 1, 1, W, H)!;
    const b = tira(10, 1, 2, W * 2, H * 2)!;
    expect(b.w).toBeCloseTo(a.w * 2, 6);
    const s = [...Array(240).keys()].filter(esSerpentina).map((i) => tira(i, 0.9, 1, W, H)).find((p) => p && !p.reves);
    expect(s).toBeTruthy();
    expect(s!.w).toBeGreaterThanOrEqual(20);
    expect(s!.h).toBeLessThanOrEqual(3);
  });

  it("al darse vuelta muestra el revés: el mismo color, más oscuro y plano", () => {
    expect(reves(0xffffff)).toBe(0xadadad);
    expect(reves(0x000000)).toBe(0);
    const caras = new Set<boolean>();
    for (let f = 0; f < 60; f++) caras.add(tira(5, 0.5 + f / 30, 1, W, H)!.reves);
    expect(caras).toEqual(new Set([true, false]));
  });
});
