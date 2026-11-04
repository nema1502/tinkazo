import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ARCHIVOS } from "./archivos";

/** La dirección que devuelve `urlMusica` en cada prueba; `null` es lo que hace en localhost. */
const remota = vi.hoisted(() => ({ url: null as string | null }));
vi.mock("./musica-remota", () => ({ urlMusica: (): string | null => remota.url }));

import { elegirJuego, reiniciar } from "./banco";

const ctx = { decodeAudioData: vi.fn(async () => ({ duration: 24 }) as AudioBuffer) } as unknown as BaseAudioContext;

describe("el banco pide la cama de música", () => {
  let fetchFalso: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    reiniciar();
    fetchFalso = vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }));
    vi.stubGlobal("fetch", fetchFalso);
  });
  afterEach(() => vi.unstubAllGlobals());

  const pedidos = (): string[] => fetchFalso.mock.calls.map((c) => String(c[0]));

  it("la música no está declarada en el índice de archivos", () => {
    expect(ARCHIVOS["race/musica"]).toBeUndefined();
  });

  it("con una dirección del servicio, la pide aunque el índice no declare música", () => {
    remota.url = "https://m.tinkazo.app/race.mp3";
    elegirJuego("race", ctx);
    expect(pedidos()).toContain("https://m.tinkazo.app/race.mp3");
  });

  it("en localhost (sin dirección) no pide ninguna música", () => {
    remota.url = null;
    elegirJuego("race", ctx);
    expect(pedidos().filter((u) => /musica|m\.tinkazo\.app/.test(u))).toEqual([]);
  });
});
