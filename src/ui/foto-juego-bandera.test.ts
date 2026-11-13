import { afterEach, describe, expect, it, vi } from "vitest";
import { fotoDelJuegoActiva } from "./foto-juego-bandera";

describe("la bandera de la foto con el dibujo del juego", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("está apagada si no se dice nada", () => {
    expect(fotoDelJuegoActiva(undefined)).toBe(false);
    expect(fotoDelJuegoActiva("")).toBe(false);
  });

  it("solo la prenden 1 y true", () => {
    expect(fotoDelJuegoActiva("1")).toBe(true);
    expect(fotoDelJuegoActiva("true")).toBe(true);
    for (const v of ["0", "false", "si", "yes", 1, true]) expect(fotoDelJuegoActiva(v)).toBe(false);
  });

  it("lee la variable de construcción VITE_FOTO_JUEGO", () => {
    vi.stubEnv("VITE_FOTO_JUEGO", "1");
    expect(fotoDelJuegoActiva()).toBe(true);
    vi.stubEnv("VITE_FOTO_JUEGO", "0");
    expect(fotoDelJuegoActiva()).toBe(false);
  });
});
