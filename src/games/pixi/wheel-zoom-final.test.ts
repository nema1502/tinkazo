import { describe, expect, it } from "vitest";
import { Container, Graphics } from "pixi.js";
import { cabe, enPantalla, type Caja } from "./encuadre";
import { wheelFinalView, wheelInBox, wheelSelectedBody, type WheelFrame } from "./wheel-zoom-final";

const g: WheelFrame = { R: 130, u: 390 / 720, cx: 550, sw: 844, sh: 390 };
// Bounds of one selected wedge (including its centre), extrusion and pointer;
// not the disc, neighbouring wedges, glow or a focus proxy.
const selected: Caja = { x: -25, y: -150, w: 50, h: 155 };
const safe = { x0: 8, y0: 190, x1: 836, y1: 280 };

describe("wheel final framing", () => {
  it("replaces the low-landscape open ending with the largest fitting selected-body shot", () => {
    const view = wheelFinalView(g, false, selected, safe);
    const open = wheelInBox(g, safe.y0, safe.y1, 0.84, false);
    expect(view.z).toBeGreaterThan(open.z);
    expect(view.z).toBeCloseTo(cabe(selected, safe));
    const box = enPantalla(selected, view, g.sw, g.sh);
    expect(box.y).toBeCloseTo(safe.y0);
    expect(box.y + box.h).toBeCloseTo(safe.y1);
  });

  it("uses the real selected geometry and the name/narrator band, even below the old 0.3 floor", () => {
    const body = { x: -80, y: -160, w: 160, h: 180 };
    const band = { ...safe, y0: 240, y1: 272 };
    const view = wheelFinalView(g, false, body, band);
    expect(view.z).toBeCloseTo(32 / 180);
    const box = enPantalla(body, view, g.sw, g.sh);
    expect(box.y).toBeCloseTo(240);
    expect(box.y + box.h).toBeCloseTo(272);
    expect(box.x).toBeGreaterThanOrEqual(band.x0);
    expect(box.x + box.w).toBeLessThanOrEqual(band.x1);
  });

  it("preserves the previous whole-wheel helper including its shadow and minimum", () => {
    expect(wheelInBox({ R: 100, u: 1, cx: 500, sw: 1000, sh: 400 }, 100, 312, 1, false))
      .toEqual({ x: 0, y: 0, z: 1 });
    expect(wheelInBox(g, 240, 272, 0.84, false).z).toBe(0.3);
  });

  it("measures only the transformed selected Graphics and pointer, independent of camera and other sectors", () => {
    const scene = new Container();
    const wheel = scene.addChild(new Container());
    const sector = wheel.addChild(new Graphics().moveTo(0, 0).lineTo(40, 0).lineTo(0, 100).closePath().fill(0xffff00));
    wheel.addChild(new Graphics().circle(0, 0, 900).fill(0x000000));
    const pointer = scene.addChild(new Graphics().rect(-5, -20, 10, 10).fill(0xffff00));
    wheel.rotation = Math.PI;
    sector.position.y = 10;
    scene.position.set(422, 195);
    scene.scale.set(2);
    try {
      const body = wheelSelectedBody(sector, pointer, scene);
      expect(body.x).toBeCloseTo(-40);
      expect(body.y).toBeCloseTo(-110);
      expect(body.w).toBeCloseTo(45);
      expect(body.h).toBeCloseTo(100);
      const screen = wheelSelectedBody(sector, pointer);
      expect(screen.x).toBeCloseTo(342);
      expect(screen.y).toBeCloseTo(-25);
      expect(screen.w).toBeCloseTo(90);
      expect(screen.h).toBeCloseTo(200);
      // Measurement cannot reposition the game or change the selected drawing.
      expect(sector.position.y).toBe(10);
      expect(wheel.rotation).toBe(Math.PI);
      expect(scene.scale.x).toBe(2);
    } finally {
      scene.destroy({ children: true });
    }
  });

  it.each([
    [true, 390, 844],
    [false, 1280, 720],
    [false, 1024, 560],
  ])("preserves the original ending for portrait=%s at %sx%s", (portrait, sw, sh) => {
    const frame = { ...g, sw, sh };
    expect(wheelFinalView(frame, portrait, selected, safe)).toEqual(
      wheelInBox(frame, safe.y0, safe.y1, portrait ? 0.96 : 0.84, false),
    );
  });
});
