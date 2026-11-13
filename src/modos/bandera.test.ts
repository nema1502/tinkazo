import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { abreLaHerramienta, modoRecordado, modoVigente, modesFlagOn, modesVisible, recordarModo, requestedMode, withMode } from "./bandera";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("la bandera de los modos nuevos", () => {
  it("apagada por defecto: sin la variable y sin parámetro no hay nada a la vista", () => {
    expect(modesFlagOn()).toBe(false);
    expect(requestedMode("")).toBeNull();
    expect(modesVisible(undefined, "")).toBe(false);
  });

  it("solo el valor 1 prende la bandera de construcción", () => {
    expect(modesFlagOn("1")).toBe(true);
    for (const valor of [undefined, "", "0", "true", "turnos", 1, true]) expect(modesFlagOn(valor), String(valor)).toBe(false);
  });

  it("lee la variable de construcción VITE_MODOS", () => {
    vi.stubEnv("VITE_MODOS", "1");
    expect(modesFlagOn()).toBe(true);
    expect(modesVisible(undefined, "")).toBe(true);
    vi.stubEnv("VITE_MODOS", "0");
    expect(modesFlagOn()).toBe(false);
    expect(modesVisible(undefined, "")).toBe(false);
  });

  it("la dirección pide un modo con ?modo=turnos o ?modo=varias", () => {
    expect(requestedMode("?modo=turnos")).toBe("turnos");
    expect(requestedMode("?modo=varias")).toBe("varias");
    expect(requestedMode("?lead=5&modo=turnos&instant=1")).toBe("turnos");
    expect(requestedMode("?modo=Turnos")).toBe("turnos");
  });

  it("un modo que no existe, vacío o repetido en otro parámetro no cuenta", () => {
    for (const busqueda of ["?modo=", "?modo=otro", "?modo=turnos2", "?modos=turnos", "?turnos=1", "?demo=wheel", "?nw=5"]) {
      expect(requestedMode(busqueda), busqueda).toBeNull();
      expect(modesVisible(undefined, busqueda), busqueda).toBe(false);
    }
  });

  it("con el parámetro los modos están a la vista aunque la bandera esté apagada", () => {
    expect(modesVisible(undefined, "?modo=turnos")).toBe(true);
    expect(modesVisible("0", "?modo=turnos")).toBe(true);
    expect(modesVisible(undefined, "?modo=varias")).toBe(true);
  });

  it("con la bandera los modos están a la vista aunque la dirección no pida nada", () => {
    expect(modesVisible("1", "")).toBe(true);
    expect(modesVisible("1", "?modo=otro")).toBe(true);
  });

  it("el modo pedido queda recordado en la pestaña cuando la dirección ya no lo trae", () => {
    const datos = new Map<string, string>();
    vi.stubGlobal("sessionStorage", {
      getItem: (clave: string) => datos.get(clave) ?? null,
      setItem: (clave: string, valor: string) => datos.set(clave, valor),
      removeItem: (clave: string) => datos.delete(clave),
    });
    expect(modesVisible(undefined, "?modo=varias")).toBe(true);
    expect(modoRecordado()).toBe("varias");
    // Volver de entrar con la cuenta: la dirección ya no trae el parámetro.
    expect(modesVisible(undefined, "")).toBe(true);
    expect(modoVigente("")).toBe("varias");
    recordarModo("turnos");
    expect(modoVigente("")).toBe("turnos");
  });

  it("sin dirección (fuera del navegador) no pide ningún modo", () => {
    expect(requestedMode()).toBeNull();
    expect(modesVisible()).toBe(false);
  });

  it("el enlace de verificación lleva el modo sin tocar el comprobante", () => {
    expect(withMode("https://tinkazo.app/verificar.html#abc", "turnos")).toBe("https://tinkazo.app/verificar.html?modo=turnos#abc");
    expect(withMode("https://tinkazo.app/verificar.html?lang=es#abc", "varias")).toBe("https://tinkazo.app/verificar.html?lang=es&modo=varias#abc");
    expect(withMode("https://tinkazo.app/verificar.html#abc", null)).toBe("https://tinkazo.app/verificar.html#abc");
    expect(withMode("https://tinkazo.app/evento.html#abc", "turnos")).toBe("https://tinkazo.app/evento.html#abc");
  });
});

describe("el enlace de un modo abre la herramienta", () => {
  it("con ?modo=turnos y con ?modo=varias, la dirección pide la herramienta; sin modo o con uno que no existe, no", () => {
    expect(abreLaHerramienta("?modo=turnos")).toBe(true);
    expect(abreLaHerramienta("?modo=varias")).toBe(true);
    expect(abreLaHerramienta("?lead=5&modo=Varias")).toBe(true);
    for (const busqueda of ["", "?modo=", "?modo=otro", "?lang=en", "?demo=wheel"]) expect(abreLaHerramienta(busqueda), busqueda).toBe(false);
  });

  it("la portada lo usa: main.ts abre la herramienta directo con cualquier modo, no solo con el de turnos", () => {
    const main = readFileSync(new URL("../main.ts", import.meta.url), "utf8");
    expect(main).toMatch(/const deApp = .*\|\| abreLaHerramienta\(\);/);
    expect(main).not.toContain('requestedMode() === "turnos"');
  });
});
