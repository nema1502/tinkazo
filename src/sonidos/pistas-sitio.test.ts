// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ContextoFalso } from "./audio-falso";
import { estadoDePistas, permitirPistas, pistaArrancar, pistaDelJuego, precargarPista, reiniciarPistas } from "./pistas-enganche";

/**
 * Con la lista de verdad del sitio (sin reemplazarla) y el interruptor prendido, en el sitio de producción y con la
 * persona ya tocando la pantalla: la carrera pide sus cinco archivos y ningún otro juego pide nada ni suena con pista.
 * Es lo que pasa en una sala el día que se prenda la música nueva.
 */

const OTROS = ["wheel", "trompo", "sapo", "oruro", "pinata", "toborochi", "teleferico", "guajojo", "chovena"];
const DE_LA_CARRERA = ["entrada", "cuerpo", "subida", "golpe", "festejo"].map((s) => `https://m.tinkazo.app/race-d2-${s}.mp3`);

let red: ReturnType<typeof vi.fn>;

beforeEach(() => {
  permitirPistas(() => true);
  red = vi.fn(async () => ({ ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(16), json: async () => ({}) }));
  vi.stubGlobal("fetch", red);
  reiniciarPistas({ modo: "pistas", host: "tinkazo.app", busqueda: "", tocado: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
  reiniciarPistas();
});

describe("con las pistas prendidas, en el sitio, con la lista de verdad", () => {
  it("la carrera pide sus cinco archivos del servicio de la música", async () => {
    precargarPista("race");
    await vi.waitFor(() => expect(estadoDePistas().cargas.race).toBe("bajada"));
    expect(red.mock.calls.map((c) => String(c[0])).sort()).toEqual([...DE_LA_CARRERA].sort());
  });

  it.each(OTROS)("%s no pide nada: no tiene pista aprobada y sigue con la música de siempre", async (juego) => {
    precargarPista(juego);
    await vi.waitFor(() => expect(estadoDePistas().cargas[juego]).toBe("fallo"));
    expect(red).not.toHaveBeenCalled();
    // Al sortear: no hay pista que tome el lugar, y la de osciladores queda como está.
    const ctx = new ContextoFalso();
    pistaDelJuego(juego, ctx.comoContexto);
    const bus = ctx.createGain();
    bus.gain.value = 0.3;
    expect(pistaArrancar(ctx.comoContexto, ctx.destination as unknown as AudioNode, bus, 0.3)).toBe(false);
    expect(bus.gain.value).toBe(0.3);
    expect(red).not.toHaveBeenCalled();
  });
});
