import { afterEach, describe, expect, it, vi } from "vitest";
import { PATRONES, setVibracion, vibracionDisponible, vibracionOn, vibrar } from "./vibrar";

const guardado = new Map<string, string>();
const memoria = {
  getItem: (k: string): string | null => guardado.get(k) ?? null,
  setItem: (k: string, v: string): void => void guardado.set(k, v),
};

function aparato(extra: { vibrate?: unknown; activo?: boolean | null; busqueda?: string; reducido?: boolean } = {}): ReturnType<typeof vi.fn> {
  const vibrate = vi.fn(() => true);
  vi.stubGlobal("navigator", {
    ...(extra.vibrate === null ? {} : { vibrate: extra.vibrate ?? vibrate }),
    ...(extra.activo === null ? {} : { userActivation: { hasBeenActive: extra.activo ?? true } }),
  });
  vi.stubGlobal("localStorage", memoria);
  vi.stubGlobal("location", { search: extra.busqueda ?? "" });
  vi.stubGlobal("matchMedia", () => ({ matches: extra.reducido ?? false }));
  return vibrate;
}

afterEach(() => {
  vi.unstubAllGlobals();
  guardado.clear();
});

describe("la vibración del celular", () => {
  it("vibra con el patrón pedido donde el sistema la ofrece y la persona ya tocó la página", () => {
    const v = aparato();
    expect(vibracionDisponible()).toBe(true);
    expect(vibrar("cartel")).toBe(true);
    expect(v).toHaveBeenCalledWith([70, 50, 70, 50, 220]);
    expect(vibrar("caida")).toBe(true);
    expect(v).toHaveBeenLastCalledWith([30]);
  });

  it("los golpes son cortos: ningún toque pasa de 300 ms y el de una caída, de 60", () => {
    for (const p of Object.values(PATRONES)) expect(Math.max(...p)).toBeLessThanOrEqual(300);
    expect(PATRONES.caida.reduce((a, b) => a + b, 0)).toBeLessThan(60);
  });

  it("se apaga y la preferencia queda", () => {
    const v = aparato();
    expect(vibracionOn()).toBe(true);
    setVibracion(false);
    expect(vibracionOn()).toBe(false);
    expect(vibrar("cartel")).toBe(false);
    expect(v).not.toHaveBeenCalled();
  });

  it("con el movimiento reducido no vibra", () => {
    const v = aparato({ reducido: true });
    expect(vibrar("golpe")).toBe(false);
    expect(v).not.toHaveBeenCalled();
  });

  it("sin la API (un iPhone, la compu) no hace nada ni falla", () => {
    aparato({ vibrate: null });
    expect(vibracionDisponible()).toBe(false);
    expect(vibrar("cartel")).toBe(false);
  });

  it("sin un toque previo no vibra: el navegador la bloquearía con un aviso", () => {
    const v = aparato({ activo: false });
    expect(vibrar("cartel")).toBe(false);
    expect(v).not.toHaveBeenCalled();
  });

  it("se apaga con ?vibrar=0 y con la preferencia guardada, y se vuelve a prender", () => {
    const v = aparato({ busqueda: "?vibrar=0" });
    expect(vibracionOn()).toBe(false);
    expect(vibrar("cartel")).toBe(false);
    expect(v).not.toHaveBeenCalled();
    aparato();
    expect(vibracionOn()).toBe(true);
    setVibracion(false);
    expect(vibracionOn()).toBe(false);
    setVibracion(true);
    expect(vibracionOn()).toBe(true);
  });

  it("con el almacenamiento bloqueado queda prendida y no rompe", () => {
    const v = aparato();
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
    expect(vibrar("cartel")).toBe(true);
    expect(v).toHaveBeenCalled();
  });

  it("si vibrate tira un error, no se cae", () => {
    aparato({
      vibrate: () => {
        throw new Error("no");
      },
    });
    expect(vibrar("cartel")).toBe(false);
  });
});
