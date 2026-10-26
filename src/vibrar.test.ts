import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setVibracion, vibracionDisponible, vibracionOn, vibrar } from "./vibrar";

describe("la vibración del ganador", () => {
  let golpes: number[][] = [];
  let guardado: Record<string, string> = {};
  beforeEach(() => {
    golpes = [];
    guardado = {};
    vi.stubGlobal("navigator", { vibrate: (p: number[]) => golpes.push(p) });
    vi.stubGlobal("localStorage", { getItem: (k: string) => guardado[k] ?? null, setItem: (k: string, v: string) => (guardado[k] = v) });
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it("vibra con un patrón corto si el celular la ofrece", () => {
    expect(vibracionDisponible()).toBe(true);
    vibrar("cartel");
    expect(golpes).toHaveLength(1);
    expect(Math.max(...(golpes[0] as number[]))).toBeLessThanOrEqual(300);
  });

  it("se apaga y la preferencia queda", () => {
    expect(vibracionOn()).toBe(true);
    setVibracion(false);
    expect(vibracionOn()).toBe(false);
    vibrar("cartel");
    expect(golpes).toHaveLength(0);
  });

  it("con el movimiento reducido no vibra", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    vibrar("golpe");
    expect(golpes).toHaveLength(0);
  });

  it("sin la API (un iPhone) no hace nada ni falla", () => {
    vi.stubGlobal("navigator", {});
    expect(vibracionDisponible()).toBe(false);
    expect(() => vibrar("cartel")).not.toThrow();
  });

  it("con el almacenamiento bloqueado queda prendida", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("bloqueado");
      },
      setItem: () => {
        throw new Error("bloqueado");
      },
    });
    expect(vibracionOn()).toBe(true);
    expect(() => setVibracion(false)).not.toThrow();
  });
});
