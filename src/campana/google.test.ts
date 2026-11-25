// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tokenCon = (datos: unknown): string => {
  const parte = (o: unknown): string => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${parte({ alg: "RS256" })}.${parte(datos)}.firma`;
};

interface Ventana {
  google?: unknown;
}

function guionFalso(): HTMLScriptElement[] {
  const guiones: HTMLScriptElement[] = [];
  vi.spyOn(document.head, "append").mockImplementation((...nodos: (Node | string)[]) => {
    for (const nodo of nodos) if (nodo instanceof HTMLScriptElement) guiones.push(nodo);
  });
  return guiones;
}

const gis = () => ({ initialize: vi.fn(), renderButton: vi.fn() });

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  delete (window as unknown as Ventana).google;
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("cargarElGuionDeGoogle", () => {
  it("pide el guion oficial de Google una sola vez aunque se llame dos", async () => {
    const guiones = guionFalso();
    const { cargarElGuionDeGoogle, URL_DEL_GUION_DE_GOOGLE } = await import("./google");
    const api = gis();
    const a = cargarElGuionDeGoogle();
    const b = cargarElGuionDeGoogle();
    expect(guiones).toHaveLength(1);
    expect(guiones[0]?.src).toBe(URL_DEL_GUION_DE_GOOGLE);
    expect(URL_DEL_GUION_DE_GOOGLE).toBe("https://accounts.google.com/gsi/client");
    expect(guiones[0]?.async).toBe(true);
    (window as unknown as Ventana).google = { accounts: { id: api } };
    guiones[0]?.dispatchEvent(new Event("load"));
    expect(await a).toBe(api);
    expect(await b).toBe(api);
  });

  it("con la API ya a mano no vuelve a pedir el guion", async () => {
    const guiones = guionFalso();
    const { cargarElGuionDeGoogle } = await import("./google");
    const api = gis();
    (window as unknown as Ventana).google = { accounts: { id: api } };
    expect(await cargarElGuionDeGoogle()).toBe(api);
    expect(guiones).toHaveLength(0);
  });

  it("si el guion no baja, falla con un mensaje fijo y la próxima vez vuelve a intentar", async () => {
    const guiones = guionFalso();
    const { cargarElGuionDeGoogle } = await import("./google");
    const primera = cargarElGuionDeGoogle();
    const caida = expect(primera).rejects.toThrow("google");
    guiones[0]?.dispatchEvent(new Event("error"));
    await caida;
    const segunda = cargarElGuionDeGoogle();
    expect(guiones).toHaveLength(2);
    (window as unknown as Ventana).google = { accounts: { id: gis() } };
    guiones[1]?.dispatchEvent(new Event("load"));
    await expect(segunda).resolves.toBeDefined();
  });

  it("si baja pero Google no deja su API, falla", async () => {
    const guiones = guionFalso();
    const { cargarElGuionDeGoogle } = await import("./google");
    const intento = cargarElGuionDeGoogle();
    const caida = expect(intento).rejects.toThrow("google");
    guiones[0]?.dispatchEvent(new Event("load"));
    await caida;
  });

  it("si tarda más del tope, falla", async () => {
    guionFalso();
    const { cargarElGuionDeGoogle, ESPERA_DEL_GUION_MS } = await import("./google");
    const intento = cargarElGuionDeGoogle();
    const caida = expect(intento).rejects.toThrow("google");
    await vi.advanceTimersByTimeAsync(ESPERA_DEL_GUION_MS + 1);
    await caida;
  });
});

describe("botonDeGoogle", () => {
  async function armar(api = gis(), opciones: { oscuro?: boolean; idioma?: "es" | "en" } = {}) {
    const { botonDeGoogle } = await import("./google");
    return {
      api,
      boton: botonDeGoogle({
        clienteId: "cliente.apps.example.org",
        idioma: () => opciones.idioma ?? "es",
        oscuro: () => opciones.oscuro === true,
        cargar: async () => api,
      }),
    };
  }

  it("inicia Google una sola vez con el cliente del sitio, sin entrar solo, y arma el botón en el idioma de la página", async () => {
    const { api, boton } = await armar(gis(), { idioma: "en" });
    const a = document.createElement("div");
    const b = document.createElement("div");
    boton.montar(a, () => undefined, () => undefined);
    boton.montar(b, () => undefined, () => undefined);
    await vi.advanceTimersByTimeAsync(0);
    expect(api.initialize).toHaveBeenCalledTimes(1);
    expect(api.initialize.mock.calls[0]?.[0]).toMatchObject({ client_id: "cliente.apps.example.org", auto_select: false });
    expect(api.renderButton).toHaveBeenCalledTimes(2);
    expect(api.renderButton.mock.calls[0]?.[0]).toBe(a);
    expect(api.renderButton.mock.calls[0]?.[1]).toMatchObject({ type: "standard", text: "continue_with", locale: "en", theme: "outline" });
    const ancho = (api.renderButton.mock.calls[0]?.[1] as { width: number }).width;
    expect(ancho).toBeGreaterThanOrEqual(200);
    expect(ancho).toBeLessThanOrEqual(400);
  });

  it("en tema oscuro usa los colores oscuros", async () => {
    const { api, boton } = await armar(gis(), { oscuro: true });
    boton.montar(document.createElement("div"), () => undefined, () => undefined);
    await vi.advanceTimersByTimeAsync(0);
    expect(api.renderButton.mock.calls[0]?.[1]).toMatchObject({ theme: "filled_black" });
  });

  it("entrega el token de identidad al último botón montado", async () => {
    const { api, boton } = await armar();
    const viejo = vi.fn();
    const nuevo = vi.fn();
    boton.montar(document.createElement("div"), viejo, () => undefined);
    boton.montar(document.createElement("div"), nuevo, () => undefined);
    await vi.advanceTimersByTimeAsync(0);
    const callback = (api.initialize.mock.calls[0]?.[0] as { callback: (r: { credential?: string }) => void }).callback;
    callback({ credential: "token-de-google" });
    expect(nuevo).toHaveBeenCalledWith("token-de-google");
    expect(viejo).not.toHaveBeenCalled();
  });

  it("sin credencial avisa la falla y no entra nadie", async () => {
    const { api, boton } = await armar();
    const entrar = vi.fn();
    const fallar = vi.fn();
    boton.montar(document.createElement("div"), entrar, fallar);
    await vi.advanceTimersByTimeAsync(0);
    const callback = (api.initialize.mock.calls[0]?.[0] as { callback: (r: { credential?: unknown }) => void }).callback;
    callback({});
    callback({ credential: "" });
    callback({ credential: 7 });
    expect(entrar).not.toHaveBeenCalled();
    expect(fallar).toHaveBeenCalledTimes(3);
    expect(fallar).toHaveBeenCalledWith("google");
  });

  it("sacar el botón lo limpia y ya no escucha a Google", async () => {
    const { api, boton } = await armar();
    const contenedor = document.createElement("div");
    const entrar = vi.fn();
    const sacar = boton.montar(contenedor, entrar, () => undefined);
    await vi.advanceTimersByTimeAsync(0);
    contenedor.append(document.createElement("i"));
    sacar();
    expect(contenedor.childElementCount).toBe(0);
    (api.initialize.mock.calls[0]?.[0] as { callback: (r: { credential?: string }) => void }).callback({ credential: "tarde" });
    expect(entrar).not.toHaveBeenCalled();
  });

  it("sacar el botón antes de que baje el guion no arma nada", async () => {
    const { api, boton } = await armar();
    const sacar = boton.montar(document.createElement("div"), () => undefined, () => undefined);
    sacar();
    await vi.advanceTimersByTimeAsync(0);
    expect(api.renderButton).not.toHaveBeenCalled();
    expect(api.initialize).not.toHaveBeenCalled();
  });

  it("si el guion no baja avisa la falla", async () => {
    const { botonDeGoogle } = await import("./google");
    const boton = botonDeGoogle({ clienteId: "c", idioma: () => "es", cargar: () => Promise.reject(new Error("google")) });
    const fallar = vi.fn();
    boton.montar(document.createElement("div"), () => undefined, fallar);
    await vi.advanceTimersByTimeAsync(0);
    expect(fallar).toHaveBeenCalledWith("google");
  });
});

describe("nombreDeLaCredencial", () => {
  it("lee el nombre corto del perfil, con tildes", async () => {
    const { nombreDeLaCredencial } = await import("./google");
    expect(nombreDeLaCredencial(tokenCon({ name: "Ana Pérez" }))).toBe("Ana P.");
    expect(nombreDeLaCredencial(tokenCon({ name: "Nora" }))).toBe("Nora");
  });

  it("sin nombre usa el de pila, y sin ninguno da null", async () => {
    const { nombreDeLaCredencial } = await import("./google");
    expect(nombreDeLaCredencial(tokenCon({ given_name: "Beto" }))).toBe("Beto");
    expect(nombreDeLaCredencial(tokenCon({ name: "   ", given_name: "Beto" }))).toBe("Beto");
    expect(nombreDeLaCredencial(tokenCon({ sub: "1" }))).toBeNull();
  });

  it("un token roto da null y nunca lanza", async () => {
    const { nombreDeLaCredencial } = await import("./google");
    const sinJson = Buffer.from("no es json").toString("base64url");
    const lista = Buffer.from("[1]").toString("base64url");
    for (const roto of ["", "a", "a.b", "a.!!!.c", `a.${sinJson}.c`, `a.${lista}.c`]) {
      expect(nombreDeLaCredencial(roto), roto).toBeNull();
    }
  });
});
