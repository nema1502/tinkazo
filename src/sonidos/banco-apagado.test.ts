import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./musica-remota", () => ({ urlMusica: (): string | null => "https://m.tinkazo.app/race.mp3" }));

import { ARCHIVOS_PRENDIDOS, archivosPrendidos, elegirJuego, juegoElegido, prender, reiniciar } from "./banco";

const ctx = { decodeAudioData: vi.fn(async () => ({ duration: 1 }) as AudioBuffer) } as unknown as BaseAudioContext;

describe("los archivos de sonido están apagados hasta que alguien los elija con oídos", () => {
  let fetchFalso: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    reiniciar();
    prender(null);
    fetchFalso = vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }));
    vi.stubGlobal("fetch", fetchFalso);
  });
  afterEach(() => {
    prender(null);
    vi.unstubAllGlobals();
  });

  it("la constante dice apagado", () => {
    expect(ARCHIVOS_PRENDIDOS).toBe(false);
  });

  it("sin la dirección especial no elige juego, no baja efectos ni pide música", () => {
    vi.stubGlobal("location", { search: "" });
    expect(archivosPrendidos()).toBe(false);
    elegirJuego("race", ctx);
    expect(juegoElegido()).toBeNull();
    expect(fetchFalso).not.toHaveBeenCalled();
  });

  it("sin `location` (otro motor, pruebas) también queda apagado, sin error", () => {
    vi.stubGlobal("location", undefined);
    expect(archivosPrendidos()).toBe(false);
  });

  it("con `?sonidoarchivo=1` se prende: elige el juego, baja los efectos y pide la música", () => {
    vi.stubGlobal("location", { search: "?demo=race&sonidoarchivo=1" });
    expect(archivosPrendidos()).toBe(true);
    elegirJuego("race", ctx);
    expect(juegoElegido()).toBe("race");
    const pedidos = fetchFalso.mock.calls.map((c) => String(c[0]));
    expect(pedidos.some((u) => u.includes("sonidos/race/"))).toBe(true);
    expect(pedidos).toContain("https://m.tinkazo.app/race.mp3");
  });

  it("`prender` manda sobre la dirección, en los dos sentidos", () => {
    vi.stubGlobal("location", { search: "?sonidoarchivo=1" });
    prender(false);
    expect(archivosPrendidos()).toBe(false);
    elegirJuego("race", ctx);
    expect(juegoElegido()).toBeNull();

    vi.stubGlobal("location", { search: "" });
    prender(true);
    expect(archivosPrendidos()).toBe(true);
    elegirJuego("race", ctx);
    expect(juegoElegido()).toBe("race");
  });
});
