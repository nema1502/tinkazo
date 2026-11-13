// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ContextoFalso } from "./audio-falso";
import { leerPista, SECCIONES } from "./pistas";
import { estadoDePistas, modoDeMusica, permitirPistas, pistaArrancar, pistaDelJuego, precargarPista, reiniciarPistas } from "./pistas-enganche";
import { PISTAS } from "./pistas-lista";

/**
 * Con la lista de verdad del sitio (sin reemplazarla) y el interruptor prendido, en el sitio de producción y con la
 * persona ya tocando la pantalla: cada juego de la lista pide sus cinco archivos y ningún otro juego pide nada ni suena
 * con pista. Es lo que pasa en una sala con la música nueva, que va prendida por defecto. Qué juegos están en la lista lo
 * fija `APROBADAS` en `pistas-lista.test.ts`.
 */

const LOS_DIEZ = ["race", "wheel", "trompo", "sapo", "oruro", "pinata", "toborochi", "teleferico", "guajojo", "chovena"];
const CON_PISTA = Object.keys(PISTAS).sort();
const OTROS = LOS_DIEZ.filter((j) => !CON_PISTA.includes(j));
const DE_LA_CARRERA = ["entrada", "cuerpo", "subida", "golpe", "festejo"].map((s) => `https://m.tinkazo.app/race-d2-${s}.mp3`);
/** Los archivos que un juego de la lista le pide al servicio, según su JSON. */
function archivosDe(juego: string): string[] {
  const p = leerPista(PISTAS[juego], juego);
  if (!p) throw new Error(`la pista de ${juego} no se leyó`);
  return SECCIONES.flatMap((s) => (p.secciones[s] ? [`https://m.tinkazo.app/${p.secciones[s]?.archivo ?? ""}`] : []));
}

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

  it.each(CON_PISTA)("%s, que está en la lista, pide sus cinco archivos y nada más", async (juego) => {
    precargarPista(juego);
    await vi.waitFor(() => expect(estadoDePistas().cargas[juego]).toBe("bajada"));
    expect(archivosDe(juego)).toHaveLength(5);
    expect(red.mock.calls.map((c) => String(c[0])).sort()).toEqual(archivosDe(juego).sort());
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

describe("sin nada pedido, en el sitio: la música nueva va prendida por defecto", () => {
  // La configuración que arma la pestaña sola: la de la dirección, la recordada o la de la bandera de construcción.
  const sitio = (bandera: unknown, busqueda: string): void =>
    reiniciarPistas({ modo: modoDeMusica(bandera, busqueda), host: "tinkazo.app", busqueda, tocado: true });

  afterEach(() => {
    sessionStorage.clear();
  });

  it("sin bandera ni parámetro, la carrera pide sus cinco archivos", async () => {
    sitio(undefined, "");
    precargarPista("race");
    await vi.waitFor(() => expect(estadoDePistas().cargas.race).toBe("bajada"));
    expect(red.mock.calls.map((c) => String(c[0])).sort()).toEqual([...DE_LA_CARRERA].sort());
  });

  it.each(OTROS)("sin bandera ni parámetro, %s sigue sin pedir nada", async (juego) => {
    sitio(undefined, "");
    precargarPista(juego);
    await vi.waitFor(() => expect(estadoDePistas().cargas[juego]).toBe("fallo"));
    expect(red).not.toHaveBeenCalled();
  });

  it("con VITE_MUSICA=sintetizada no baja nada, ni la carrera", () => {
    sitio("sintetizada", "");
    precargarPista("race");
    pistaDelJuego("race", new ContextoFalso().comoContexto);
    expect(estadoDePistas().modo).toBe("sintetizada");
    expect(red).not.toHaveBeenCalled();
  });

  it("con ?musica=sintetizada no baja nada en esa pestaña, ni al volver sin el parámetro", () => {
    sitio(undefined, "?musica=sintetizada");
    precargarPista("race");
    expect(red).not.toHaveBeenCalled();
    sitio(undefined, "");
    precargarPista("race");
    expect(estadoDePistas().modo).toBe("sintetizada");
    expect(red).not.toHaveBeenCalled();
  });

  it("con la música o el sonido apagados por la persona no baja nada", () => {
    permitirPistas(() => false);
    sitio(undefined, "");
    precargarPista("race");
    pistaDelJuego("race", new ContextoFalso().comoContexto);
    expect(red).not.toHaveBeenCalled();
  });
});
