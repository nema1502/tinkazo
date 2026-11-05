import { Container, Graphics } from "pixi.js";
import { describe, expect, it } from "vitest";
import { enPantalla } from "../pixi/encuadre";
import { resolverToma } from "../pixi/kit/director";
import { cajaVisible, cajaVisual, primerPlanoHorizontal } from "./carrera-zoom-final";

// Real Pixi transforms/bounds; these are not browser/font/rendering assertions.
describe("race winner visual measurements", () => {
  it("selects landscape phone viewports without changing portrait or desktop", () => {
    for (const [w, h] of [[844, 390], [915, 412], [740, 360], [932, 430]] as const) {
      expect(primerPlanoHorizontal({ w, h, retrato: false })).toBe(true);
    }
    expect(primerPlanoHorizontal({ w: 390, h: 844, retrato: true })).toBe(false);
    expect(primerPlanoHorizontal({ w: 1280, h: 720, retrato: false })).toBe(false);
    expect(primerPlanoHorizontal({ w: 1024, h: 560, retrato: false })).toBe(false);
  });

  for (const nameWidth of [60, 440]) {
    it(`fits the actual selected elements with a ${nameWidth}px name, ignoring other runners/goal`, () => {
      const scene = new Container();
      scene.position.set(-300, 42);
      scene.scale.set(1.7);
      const runner = new Graphics().rect(-26, -92, 66, 97).fill(0xffffff);
      runner.position.set(540, 180);
      runner.scale.set(0.35);
      const name = new Graphics().rect(-nameWidth / 2, -11, nameWidth, 22).fill(0xffff00);
      name.position.set(450, 175);
      scene.addChild(runner, name);
      scene.addChild(new Graphics().rect(-4000, -4000, 8000, 8000).fill(0x000000));
      const bodyBefore = cajaVisual([runner], scene);
      const actual = cajaVisual([runner, name], scene);
      expect(bodyBefore.w).toBeCloseTo(66 * 0.35);
      expect(bodyBefore.h).toBeCloseTo(97 * 0.35);
      expect(actual.w).toBeLessThan(1000);
      const zona = { x0: 4, y0: 184, x1: 840, y1: 280 };
      const view = resolverToma({ caja: actual, zona }, { w: 844, h: 390, zona });
      const projected = enPantalla(actual, view, 844, 390);
      expect(projected.x).toBeGreaterThanOrEqual(zona.x0 - 1e-4);
      expect(projected.y).toBeGreaterThanOrEqual(zona.y0 - 1e-4);
      expect(projected.x + projected.w).toBeLessThanOrEqual(zona.x1 + 1e-4);
      expect(projected.y + projected.h).toBeLessThanOrEqual(zona.y1 + 1e-4);
      expect(view.z).toBeCloseTo(Math.min(836 / actual.w, 96 / actual.h));
      const visible = cajaVisible([runner, name]);
      expect(visible.w).toBeCloseTo(actual.w * 1.7);
      expect(visible.h).toBeCloseTo(actual.h * 1.7);
      scene.destroy({ children: true });
    });
  }

  it("preserves ordinary single-element bounds and does not accumulate camera transforms", () => {
    const scene = new Container();
    const runner = new Graphics().rect(10, 20, 30, 40).fill(0xffffff);
    scene.addChild(runner);
    expect(cajaVisual([runner], scene)).toEqual({ x: 10, y: 20, w: 30, h: 40 });
    scene.scale.set(2.4);
    scene.position.set(-345, 73);
    const world = cajaVisual([runner], scene);
    expect(world.x).toBeCloseTo(10);
    expect(world.y).toBeCloseTo(20);
    expect(world.w).toBeCloseTo(30);
    expect(world.h).toBeCloseTo(40);
    expect(cajaVisible([runner])).toEqual({ x: -321, y: 121, w: 72, h: 96 });
    scene.destroy({ children: true });
  });
});
