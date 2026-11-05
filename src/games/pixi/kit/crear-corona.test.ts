import { Container, Graphics } from "pixi.js";
import { describe, expect, it, vi } from "vitest";
import { crearJuego } from "./crear";
import type { Anfitrion } from "./anfitrion";
import type { Plan } from "./tipos";
import type { PixiStage } from "../stage";

// Exercise the public creator/host boundary, not a copy of the frame loop.
vi.mock("./anfitrion", () => ({ CHIP_SCALE: 2, anfitrionTinkazo: {} }));
vi.mock("./director", () => ({ crearDirector: () => ({ cuadro: vi.fn(), golpe: vi.fn() }) }));
vi.mock("./marcador-vista", () => ({ crearMarcadorVista: () => ({ pintar: vi.fn(), rearmar: vi.fn(), ocultar: vi.fn() }) }));

async function fixture(previousBottom: number, currentBottom: number, bodyY: number, bodyHeight: number, hook: boolean) {
  const body = new Graphics().rect(0, 0, 70, bodyHeight).fill(0xffffff);
  body.position.set(520, bodyY);
  let plateBottom = previousBottom;
  let run: ((dt: number, now: number) => void) | undefined;
  const order: string[] = [];
  const cam = { update: vi.fn(), apply: vi.fn() };
  const crownAt = vi.fn((_time: number, _show: boolean, _focus?: unknown) => { order.push("crown"); plateBottom = currentBottom; });
  const cleanup = vi.fn();
  const S = {
    rng: vi.fn(() => 0.5), onCleanup: vi.fn(), onResize: vi.fn(), u: () => 1,
    sw: () => 852, sh: () => 393, top: () => 0, bottom: () => 90, portrait: () => false,
    compartir: false, scene: new Container(), cam, say: vi.fn(), breath: vi.fn(),
    crown: vi.fn(() => ({ at: crownAt })), cleanup,
    run: (fn: typeof run) => { run = fn; },
  } as unknown as PixiStage;
  const host: Anfitrion = {
    montar: async () => S, idioma: () => "es", frase: () => undefined, anuncio: () => "unchanged",
    auditar: () => null, calor: vi.fn(), ritmo: () => 1, duracion: vi.fn(), espera: 3,
    voz: { tono: vi.fn(), nota: vi.fn(), fanfarria: vi.fn(), despues: vi.fn() },
    emblemas: { cargar: async () => {}, lista: () => false, lienzo: vi.fn(), textura: vi.fn() },
  };
  const protect = () => { const b = body.getBounds(); body.y += Math.max(0, plateBottom + 4 - b.y); };
  const definition = {
    id: "recorded-race-clearance", foco: false,
    plan: () => ({ duracion: 0.5, arco: "susto", momentos: {}, guion: [], datos: null, marcador: () => 1 } as unknown as Plan<null>),
    arma: () => body,
    cuadro: () => { order.push("draw"); protect(); },
    ...(hook ? { trasCorona: () => { order.push("clear-current"); protect(); } } : {}),
  };
  const names = ["Fabio"], winners = [0] as const;
  await crearJuego(definition, host)(names, winners, { round: 1, signature: "00".repeat(96), randomness: "00".repeat(32) }, vi.fn());
  expect(run).toBeTypeOf("function");
  run!(0.6, 123);
  return { body, plateBottom, order, cam, crownAt, cleanup, host, S, names, winners, run };
}

describe("current-frame crown clearance", () => {
  // Genuine public Race frames450/451, #349,852x393/iPhone13. These literals
  // preserve failed geometry; no browser state or production clock is modified.
  for (const frame of [
    { id: 450, oldBottom: 142.84186054672097, bottom: 156.92264382248424, y: 152.41260721360234, h: 103.0584061670644 },
    { id: 451, oldBottom: 156.92264382248424, bottom: 159.1025629147353, y: 160.92259085638258, h: 97.86613591100253 },
  ]) {
    it(`clears the newly advanced physical plate for recorded frame${frame.id}`, async () => {
      const f = await fixture(frame.oldBottom, frame.bottom, frame.y, frame.h, true);
      const box = f.body.getBounds();
      expect(box.y - f.plateBottom).toBeGreaterThanOrEqual(4 - 1e-4);
      expect(box.y + box.height).toBeLessThanOrEqual(302.5 - 4);
      expect(f.order).toEqual(["draw", "crown", "clear-current"]);
      expect(f.cam.update).toHaveBeenCalledExactlyOnceWith(0.6);
      expect(f.cam.apply).toHaveBeenCalledWith(f.S.scene, 852, 393, 123);
      expect(f.crownAt.mock.calls[0]?.[0]).toBeCloseTo(0.1);
      expect(f.cleanup).not.toHaveBeenCalled();
      expect(f.S.crown).toHaveBeenCalledWith(f.names, f.winners, false);
      expect(f.names).toEqual(["Fabio"]);
      f.body.destroy(); f.S.scene.destroy();
    });
  }

  it("preserves existing games without the optional hook, including crown time, winner and cleanup", async () => {
    const f = await fixture(142, 156, 170, 100, false);
    expect(f.order).toEqual(["draw", "crown"]);
    expect(f.body.y).toBe(170);
    expect(f.cam.update).toHaveBeenCalledExactlyOnceWith(0.6);
    expect(f.crownAt.mock.calls[0]?.[0]).toBeCloseTo(0.1);
    expect(f.S.crown).toHaveBeenCalledWith(["Fabio"], [0], false);
    expect(f.host.duracion).toHaveBeenCalledWith(0.5, 3, null);
    expect(f.cleanup).not.toHaveBeenCalled();
    f.run!(3, 124);
    expect(f.cam.update.mock.calls.at(-1)).toEqual([3]);
    expect(f.cleanup).toHaveBeenCalledTimes(1);
    f.body.destroy(); f.S.scene.destroy();
  });
});
