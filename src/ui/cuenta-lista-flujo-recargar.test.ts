// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { recargarElPaso } from "./cuenta-lista-flujo";

/**
 * Qué hace Volver a cargar en el paso de la cuenta: recarga la página, y antes deja la dirección donde la herramienta
 * vuelve a abrirse (`/` sola abre la portada). La lista que la persona escribió se guarda sola al irse la página, y eso lo
 * fijan las pruebas del borrador.
 */

const dejar = (vista: string | null, tab: string | null, ruta: string): void => {
  if (vista === null) delete document.body.dataset.vista;
  else document.body.dataset.vista = vista;
  if (tab === null) delete document.body.dataset.tab;
  else document.body.dataset.tab = tab;
  history.replaceState(null, "", ruta);
};

beforeEach(() => dejar(null, null, "/"));
afterEach(() => {
  vi.restoreAllMocks();
  dejar(null, null, "/");
});

describe("recargarElPaso", () => {
  it("en la herramienta, con la dirección sola, deja el fragmento de sortear y recarga una vez", () => {
    dejar("app", "nuevo", "/");
    const recargar = vi.fn(() => expect(location.hash).toBe("#sortear"));
    recargarElPaso(recargar);
    expect(recargar).toHaveBeenCalledTimes(1);
    expect(location.hash).toBe("#sortear");
  });

  it("en Mis sorteos deja ese fragmento, y si ya hay uno de la herramienta no lo cambia", () => {
    dejar("app", "historial", "/");
    recargarElPaso(() => undefined);
    expect(location.hash).toBe("#mis-sorteos");
    for (const [ruta, tab] of [["/#mis-sorteos", "nuevo"], ["/#sortear", "historial"], ["/#ta", "historial"]] as const) {
      dejar("app", tab, ruta);
      const hash = location.hash;
      recargarElPaso(() => undefined);
      expect(location.hash).toBe(hash);
    }
  });

  it("fuera de la herramienta (la portada o una página de campaña) la dirección no cambia", () => {
    for (const vista of ["portada", null]) {
      dejar(vista, null, "/campana/sala?x=1");
      const antes = location.href;
      const recargar = vi.fn();
      recargarElPaso(recargar);
      expect(location.href).toBe(antes);
      expect(recargar).toHaveBeenCalledTimes(1);
    }
  });

  it("si no se puede cambiar la dirección, recarga igual", () => {
    dejar("app", "nuevo", "/");
    vi.spyOn(history, "replaceState").mockImplementation(() => {
      throw new Error("sin historial");
    });
    const recargar = vi.fn();
    expect(() => recargarElPaso(recargar)).not.toThrow();
    expect(recargar).toHaveBeenCalledTimes(1);
  });
});
