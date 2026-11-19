import { afterEach, describe, expect, it, vi } from "vitest";
import { fotoDelJuegoActiva, fotoDelJuegoPara, JUEGOS_CON_FOTO } from "./foto-juego-bandera";

describe("la bandera de la foto con el dibujo del juego", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("está prendida si no se dice nada", () => {
    expect(fotoDelJuegoActiva(undefined)).toBe(true);
    expect(fotoDelJuegoActiva("")).toBe(true);
    expect(fotoDelJuegoActiva("1")).toBe(true);
    expect(fotoDelJuegoActiva("true")).toBe(true);
  });

  it("solo la apagan 0 y false", () => {
    expect(fotoDelJuegoActiva("0")).toBe(false);
    expect(fotoDelJuegoActiva("false")).toBe(false);
  });

  it("lee la variable de construcción VITE_FOTO_JUEGO", () => {
    vi.stubEnv("VITE_FOTO_JUEGO", "0");
    expect(fotoDelJuegoActiva()).toBe(false);
    vi.stubEnv("VITE_FOTO_JUEGO", "1");
    expect(fotoDelJuegoActiva()).toBe(true);
    vi.stubEnv("VITE_FOTO_JUEGO", "");
    expect(fotoDelJuegoActiva()).toBe(true);
  });
});

describe("qué juegos ofrecen la foto con su dibujo", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("los diez juegos del selector, que pasaron la mirada a tamaño real y en miniatura", () => {
    expect([...JUEGOS_CON_FOTO].sort()).toEqual(["chovena", "guajojo", "oruro", "pinata", "race", "sapo", "teleferico", "toborochi", "trompo", "wheel"]);
  });

  it("un juego de la lista, con la bandera prendida: sí. Apagada, ninguno", () => {
    expect(fotoDelJuegoPara("race", undefined)).toBe(true);
    expect(fotoDelJuegoPara("sapo", "1")).toBe(true);
    expect(fotoDelJuegoPara("race", "0")).toBe(false);
    vi.stubEnv("VITE_FOTO_JUEGO", "false");
    expect(fotoDelJuegoPara("race")).toBe(false);
  });

  it("sin juego, o con uno que no está en la lista (los que salieron del selector), la foto de siempre", () => {
    expect(fotoDelJuegoPara(undefined, undefined)).toBe(false);
    expect(fotoDelJuegoPara("", undefined)).toBe(false);
    expect(fotoDelJuegoPara("tombola", undefined)).toBe(false);
    expect(fotoDelJuegoPara("trueque", undefined)).toBe(false);
  });

  it("cada juego de la lista tiene su dibujo en la foto", async () => {
    const lienzo = new Proxy({} as Record<string | symbol, unknown>, {
      get: (t, p) => (p in t ? t[p] : () => undefined),
      set: (t, p, v) => {
        t[p] = v;
        return true;
      },
    }) as unknown as CanvasRenderingContext2D;
    const { pintarFondoJuego } = await import("./foto-fondos");
    for (const juego of JUEGOS_CON_FOTO) expect(pintarFondoJuego(lienzo, juego, 1080, 1350), juego).toBe(true);
  });
});
