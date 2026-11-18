// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Soltar el sello que la sala no aceptó para sellar de nuevo, también con el show ya hecho (la sala se pregunta recién
 * pasada la ronda): con un sorteo hecho en pantalla es el camino de Usar otra lista, y un juego en marcha no se corta.
 */

const h = vi.hoisted(() => ({ unfreeze: vi.fn(), newDraw: vi.fn(), enMarcha: false }));

vi.mock("./freeze", () => ({ unfreeze: (...a: unknown[]) => h.unfreeze(...a) }));
vi.mock("./draw", () => ({ newDraw: (...a: unknown[]) => h.newDraw(...a) }));
vi.mock("./sorteo-en-marcha", () => ({ sorteoEnMarcha: () => h.enMarcha }));

const SELLO = { names: ["GA", "GB"] };

async function modulos() {
  const { app } = await import("../state");
  const { soltarParaSellarDeNuevo } = await import("./campana-resultado-real");
  return { app, soltarParaSellarDeNuevo };
}

beforeEach(() => {
  vi.resetModules();
  h.unfreeze.mockReset();
  h.newDraw.mockReset();
  h.enMarcha = false;
  Object.defineProperty(document, "fullscreenElement", { configurable: true, get: () => null });
});

describe("soltar para sellar de nuevo", () => {
  it("con el sello en pantalla y sin sorteo hecho, deja el cuadro vacío", async () => {
    const { app, soltarParaSellarDeNuevo } = await modulos();
    app.frozen = SELLO as never;
    app.drawn = null;
    await soltarParaSellarDeNuevo();
    expect(h.unfreeze).toHaveBeenCalledWith("");
    expect(h.newDraw).not.toHaveBeenCalled();
  });

  it("con el sorteo ya hecho en pantalla, usa el camino de Usar otra lista", async () => {
    const { app, soltarParaSellarDeNuevo } = await modulos();
    app.frozen = SELLO as never;
    app.drawn = { beacon: {}, winners: [0] } as never;
    await soltarParaSellarDeNuevo();
    expect(h.newDraw).toHaveBeenCalledWith("otraLista");
    expect(h.unfreeze).not.toHaveBeenCalled();
  });

  it("con un juego en marcha no corta nada", async () => {
    const { app, soltarParaSellarDeNuevo } = await modulos();
    app.frozen = SELLO as never;
    app.drawn = { beacon: {}, winners: [0] } as never;
    h.enMarcha = true;
    await soltarParaSellarDeNuevo();
    expect(h.newDraw).not.toHaveBeenCalled();
    expect(h.unfreeze).not.toHaveBeenCalled();
  });

  it("con la pantalla grande abierta no corta nada", async () => {
    const { app, soltarParaSellarDeNuevo } = await modulos();
    app.frozen = SELLO as never;
    app.drawn = { beacon: {}, winners: [0] } as never;
    Object.defineProperty(document, "fullscreenElement", { configurable: true, get: () => document.body });
    await soltarParaSellarDeNuevo();
    expect(h.newDraw).not.toHaveBeenCalled();
    expect(h.unfreeze).not.toHaveBeenCalled();
  });

  it("sin sello en pantalla, igual deja el cuadro vacío para pasar la lista", async () => {
    const { app, soltarParaSellarDeNuevo } = await modulos();
    app.frozen = null;
    await soltarParaSellarDeNuevo();
    expect(h.unfreeze).toHaveBeenCalledWith("");
  });
});
