import { describe, expect, it, vi } from "vitest";
import { COLORES, GRUPOS, MAX_GRUPOS, cuantosGrupos, grupoDe } from "./grupos";

describe("grupos automáticos: cuántos", () => {
  it("de a cuatro por grupo, hasta diez", () => {
    expect(cuantosGrupos(1)).toBe(1);
    expect(cuantosGrupos(4)).toBe(1);
    expect(cuantosGrupos(5)).toBe(2);
    expect(cuantosGrupos(16)).toBe(4);
    expect(cuantosGrupos(18)).toBe(5);
    expect(cuantosGrupos(40)).toBe(10);
    expect(cuantosGrupos(200)).toBe(MAX_GRUPOS);
    expect(cuantosGrupos(2000)).toBe(MAX_GRUPOS);
  });

  it("hay un nombre por grupo posible, y ninguno se repite", () => {
    expect(GRUPOS.length).toBe(MAX_GRUPOS);
    expect(new Set(GRUPOS.map((g) => g.nombre)).size).toBe(MAX_GRUPOS);
  });

  it("cada grupo tiene su color, el de su línea del teleférico, en todos los juegos", async () => {
    expect(COLORES.length).toBe(MAX_GRUPOS);
    expect(new Set(COLORES).size).toBe(MAX_GRUPOS);
    // El plan del teleférico toma `clamp` de overlay.ts, que lee `location` al cargarse.
    vi.stubGlobal("location", { search: "" });
    const { LINES } = await import("./pixi/cablecar-plan");
    expect([...COLORES]).toEqual(LINES);
  }, 60_000);
});

describe("grupos automáticos: el reparto", () => {
  it.each([2, 8, 16, 18, 40, 50, 200])("con %i personas, los grupos son parejos y cubren a todos", (n) => {
    const k = cuantosGrupos(n);
    const tamanos = Array.from({ length: k }, () => 0);
    for (let i = 0; i < n; i++) tamanos[grupoDe(i, n)] = (tamanos[grupoDe(i, n)] ?? 0) + 1;
    const suma = tamanos.reduce((a, b) => a + b, 0);
    expect(suma).toBe(n);
    expect(Math.max(...tamanos) - Math.min(...tamanos)).toBeLessThanOrEqual(1);
    expect(Math.min(...tamanos)).toBeGreaterThanOrEqual(1);
  });

  it("con 200 personas son diez grupos de veinte", () => {
    const tamanos = Array.from({ length: 10 }, () => 0);
    for (let i = 0; i < 200; i++) tamanos[grupoDe(i, 200)] = (tamanos[grupoDe(i, 200)] ?? 0) + 1;
    expect(tamanos.every((t) => t === 20)).toBe(true);
  });

  it("el reparto sale solo del orden de la lista, sin azar", () => {
    const a = Array.from({ length: 30 }, (_, i) => grupoDe(i, 30));
    const b = Array.from({ length: 30 }, (_, i) => grupoDe(i, 30));
    expect(a).toEqual(b);
    expect(a.slice(0, 4)).toEqual([0, 1, 2, 3]);
  });
});
