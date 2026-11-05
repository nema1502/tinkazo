import { Container, Graphics } from "pixi.js";
import { describe, expect, it } from "vitest";
import { enPantalla } from "../pixi/encuadre";
import { resolverToma } from "../pixi/kit/director";
import { alMundo, cajaVisible, cajaVisual, primerPlanoFinal, primerPlanoHorizontal, tomaPrimerPlano3D } from "./carrera-zoom-final";

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

  it("the final close-up is the same gate in 2D and 3D: landscape phone, from the crown on", () => {
    const telefono = { w: 844, h: 390, retrato: false };
    expect(primerPlanoFinal(telefono, 20, 20)).toBe(true);
    expect(primerPlanoFinal(telefono, 19.99, 20)).toBe(false);
    expect(primerPlanoFinal({ w: 390, h: 844, retrato: true }, 25, 20)).toBe(false);
    expect(primerPlanoFinal({ w: 1280, h: 720, retrato: false }, 25, 20)).toBe(false);
  });

  it("turns what the 3D drew on screen back into the director's world with the camera that drew it", () => {
    const cam = { x: 5000, y: 300, zoom: 1.6, rot: 0.01 };
    const visto = { x: 300, y: 210, w: 90, h: 70 };
    const mundo = alMundo(visto, cam, 844, 390);
    const vuelta = enPantalla(mundo, { x: cam.x, y: cam.y, z: cam.zoom }, 844, 390);
    expect(vuelta.x).toBeCloseTo(visto.x, 9);
    expect(vuelta.y).toBeCloseTo(visto.y, 9);
    expect(vuelta.w).toBeCloseTo(visto.w, 9);
    expect(vuelta.h).toBeCloseTo(visto.h, 9);
  });

  it("the 3D close-up shot keeps the 2D close-up shape (zone, pace) and caps the zoom", () => {
    const cam = { x: 5000, y: 300, zoom: 1, rot: 0 };
    const zona = { x0: 4, y0: 184, x1: 840, y1: 340 };
    const toma = tomaPrimerPlano3D({ x: 400, y: 250, w: 20, h: 16 }, cam, 844, 390, zona, 2.5);
    expect(toma).toEqual({ caja: alMundo({ x: 400, y: 250, w: 20, h: 16 }, cam, 844, 390), zona, ritmo: 3, zoomMax: 2.5 });
    // A tiny box would ask for ~10x: the cap holds it.
    expect(resolverToma(toma, { w: 844, h: 390, zona }).z).toBe(2.5);
    const amplia = tomaPrimerPlano3D({ x: 300, y: 200, w: 200, h: 100 }, cam, 844, 390, zona, 2.5);
    expect(resolverToma(amplia, { w: 844, h: 390, zona }).z).toBeCloseTo(Math.min(836 / 200, 156 / 100), 9);
  });
});

