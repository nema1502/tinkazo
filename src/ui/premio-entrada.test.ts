import { describe, expect, it, vi } from "vitest";
import { type DepsDelPremio, arrancarPremio } from "./premio-entrada";

/**
 * La entrada de quien ganó (`arrancarPremio`), con las dependencias de mentira: qué abre, cuándo y para qué cuenta.
 * Sin reloj, sin red y sin página.
 */

/** Las dependencias falsas, con la sesión que se les diga y la forma de que llegue una sesión después. */
function mundo(o: { pide?: boolean; sesion?: string | null; sala?: boolean } = {}) {
  let aviso: ((cuenta: string | null) => void) | null = null;
  const llamadas: string[] = [];
  const marcar = <T extends unknown[]>(nombre: string, f?: (...a: T) => void) => vi.fn((...a: T) => {
    llamadas.push(nombre);
    f?.(...a);
  });
  const deps = {
    pideElPremio: vi.fn(() => o.pide ?? true),
    cuentaDeLaSesion: vi.fn(() => o.sesion ?? null),
    alEntrar: marcar("alEntrar", (f: (cuenta: string | null) => void) => void (aviso = f)),
    nadaSeAbreSolo: vi.fn(() => o.sala ?? false),
    esperarla: marcar("esperarla"),
    permitir: marcar("permitir", (_cuenta: string | null) => undefined),
    abrir: marcar("abrir", (_cuenta: string) => undefined),
    quitarDeLaDireccion: marcar("quitarDeLaDireccion"),
  } satisfies DepsDelPremio;
  return { deps, llamadas, llega: (cuenta: string | null) => aviso?.(cuenta) };
}

describe("la entrada del premio", () => {
  it("sin la entrada del premio en esta página, no llama a nada", () => {
    const m = mundo({ pide: false, sesion: "GAAA" });
    arrancarPremio(m.deps);
    expect(m.llamadas).toEqual([]);
    expect(m.deps.cuentaDeLaSesion).not.toHaveBeenCalled();
  });

  it("con sesión: saca premio de la dirección, deja el permiso a nombre de esa cuenta y abre el saldo una vez", () => {
    const m = mundo({ sesion: "GAAA" });
    arrancarPremio(m.deps);
    expect(m.deps.quitarDeLaDireccion).toHaveBeenCalledTimes(1);
    expect(m.deps.permitir).toHaveBeenCalledTimes(1);
    expect(m.deps.permitir).toHaveBeenCalledWith("GAAA");
    expect(m.deps.abrir).toHaveBeenCalledTimes(1);
    expect(m.deps.abrir).toHaveBeenCalledWith("GAAA");
    expect(m.deps.esperarla).not.toHaveBeenCalled();
  });

  it("la dirección se limpia antes de dejar el permiso, en el mismo turno", () => {
    const m = mundo({ sesion: "GAAA" });
    arrancarPremio(m.deps);
    expect(m.llamadas.indexOf("quitarDeLaDireccion")).toBeLessThan(m.llamadas.indexOf("permitir"));
  });

  it("sin sesión: deja el permiso esperando y solo se queda escuchando, sin abrir nada ni entrar por su cuenta", () => {
    const m = mundo();
    arrancarPremio(m.deps);
    expect(m.llamadas).toEqual(["quitarDeLaDireccion", "esperarla", "alEntrar"]);
    expect(m.deps.abrir).not.toHaveBeenCalled();
    expect(m.deps.permitir).not.toHaveBeenCalled();
  });

  it("sin sesión: abre cuando llega la sesión, y una sola vez aunque llegue dos veces", () => {
    const m = mundo();
    arrancarPremio(m.deps);
    m.llega(null);
    expect(m.deps.abrir).not.toHaveBeenCalled();
    m.llega("GAAA");
    m.llega("GAAA");
    expect(m.deps.abrir).toHaveBeenCalledTimes(1);
    expect(m.deps.abrir).toHaveBeenCalledWith("GAAA");
    expect(m.deps.permitir).toHaveBeenCalledTimes(1);
    expect(m.deps.permitir).toHaveBeenCalledWith("GAAA");
  });

  it("con una sesión que llega antes de empezar y otra después, escucha igual y no abre dos veces", () => {
    const m = mundo({ sesion: "GAAA" });
    arrancarPremio(m.deps);
    m.llega("GAAA");
    expect(m.deps.abrir).toHaveBeenCalledTimes(1);
  });

  it("después de abrir, llega otra cuenta: el permiso se apaga y no se abre otra ventana", () => {
    const m = mundo({ sesion: "GAAA" });
    arrancarPremio(m.deps);
    m.llega("GBBB");
    expect(m.deps.permitir).toHaveBeenLastCalledWith(null);
    expect(m.deps.abrir).toHaveBeenCalledTimes(1);
  });

  it("después de abrir, se cierra la sesión: el permiso se apaga", () => {
    const m = mundo();
    arrancarPremio(m.deps);
    m.llega("GAAA");
    m.llega(null);
    expect(m.deps.permitir).toHaveBeenLastCalledWith(null);
    expect(m.deps.abrir).toHaveBeenCalledTimes(1);
  });

  it("con la sala a la vista no abre nada, pero el permiso queda a nombre de la cuenta", () => {
    const m = mundo({ sesion: "GAAA", sala: true });
    arrancarPremio(m.deps);
    expect(m.deps.abrir).not.toHaveBeenCalled();
    expect(m.deps.permitir).toHaveBeenCalledWith("GAAA");
    m.llega("GAAA");
    expect(m.deps.abrir).not.toHaveBeenCalled();
  });

  it("con la sala a la vista y una segunda sesión que llega después, tampoco abre", () => {
    const m = mundo({ sala: true });
    arrancarPremio(m.deps);
    m.llega("GAAA");
    m.llega("GBBB");
    expect(m.deps.abrir).not.toHaveBeenCalled();
  });
});
