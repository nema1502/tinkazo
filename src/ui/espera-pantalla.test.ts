// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * La espera en grande cuando se pierde la pantalla completa (`espera.ts`). Salir de la pantalla completa cerraba la
 * espera y la marcaba como rechazada para la pestaña: el sorteo ya no arrancaba solo. El sábado la pantalla completa
 * la puede soltar Windows al cambiar de proyector, sin que nadie lo pida. Ahora la espera se queda arriba como capa, y
 * la cierran Escape y Volver a la página.
 */

const h = vi.hoisted(() => ({ rechazos: 0, soltadas: 0 }));

vi.mock("../sound", () => ({ beep: () => undefined, note: (n: number) => n }));
vi.mock("./vista-grande", () => ({ rechazarGrande: () => void h.rechazos++ }));
vi.mock("./pantalla-completa", () => ({ soltarPantallaCompleta: () => void h.soltadas++ }));

async function abrirEspera(): Promise<void> {
  const { mostrarEspera } = await import("./espera");
  const { app } = await import("../state");
  app.drawn = null;
  app.frozen = { names: ["Ana", "Beto", "Nora"], listHash: "ab", ts: 1, at: "", prize: "Un premio", round: 1 };
  app.game = "race";
  mostrarEspera(() => 30, { sortear: vi.fn(), aMano: () => false, graba: false, juegos: () => [], elegirJuego: vi.fn(), premios: () => 1 });
}

const abierta = (): boolean => document.querySelector(".espera") !== null;

// jsdom no trae matchMedia, y la espera lo usa para acomodarse a la pantalla.
beforeAll(() => {
  window.matchMedia = ((q: string) =>
    ({ matches: false, media: q, onchange: null, addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined, dispatchEvent: () => false })) as typeof window.matchMedia;
});

beforeEach(() => {
  vi.resetModules();
  document.body.innerHTML = "";
  h.rechazos = 0;
  h.soltadas = 0;
});

// Una espera que quedó abierta escucha el teclado de la ventana: se cierra, para que no conteste en la prueba siguiente.
afterEach(() => {
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
});

describe("la espera en grande sin la pantalla completa", () => {
  it("si se pierde la pantalla completa, la espera se queda arriba y no se marca como rechazada", async () => {
    await abrirEspera();
    expect(abierta()).toBe(true);
    document.dispatchEvent(new Event("fullscreenchange"));
    expect(abierta()).toBe(true);
    expect(h.rechazos).toBe(0);
  });

  it("después, Escape la cierra como siempre", async () => {
    await abrirEspera();
    document.dispatchEvent(new Event("fullscreenchange"));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(abierta()).toBe(false);
    expect(h.rechazos).toBe(1);
  });
});
