// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CLAVE_VENTANA, marcarVentana } from "../campana/invitada";

/**
 * El arranque de las campañas en la herramienta (`arrancar`), con la página de mentira: la pestaña que deja la ventana de
 * Google, la entrada de quien ganó, y que quien entra desde la portada se quede en la portada con la ventana del saldo.
 */

const h = vi.hoisted(() => ({
  sesion: null as { address: string } | null,
  sala: false,
  abrirSaldo: vi.fn(),
  callar: vi.fn(),
  esperarla: vi.fn(),
  permitir: vi.fn(),
}));

vi.mock("../stellar/config", async (orig) => {
  const o = await orig<typeof import("../stellar/config")>();
  return { ...o, network: { ...o.network, name: "mainnet" } };
});
vi.mock("../ensayo-modo", () => ({ sinGrabar: () => false, enPractica: () => false }));
vi.mock("./wallet-ui", () => ({ currentSession: () => h.sesion }));
vi.mock("./saldo", () => ({ abrirSaldo: (...a: unknown[]) => h.abrirSaldo(...a) }));
vi.mock("./cuenta-lista-flujo", () => ({
  callarPasoEnEstaCarga: () => h.callar(),
  esperarAQuienGano: () => h.esperarla(),
  nadaSeAbreSolo: () => h.sala,
  permitirPasoDelPremio: (c: string | null) => h.permitir(c),
}));

/** Deja correr lo que baja aparte (la ventana del saldo) antes de afirmar que no pasó nada. */
const dejarCorrer = (): Promise<void> => new Promise((r) => setTimeout(r, 20));
const arrancar = async (): Promise<void> => (await import("./campana-arranque")).arrancar();
const enSesion = (cuenta: string | null): void => void document.dispatchEvent(new CustomEvent("tinkazo:sesion", { detail: cuenta }));

/** Las escuchas que el arranque deja en la página, para sacarlas al terminar cada prueba. */
type Escucha = [string, EventListenerOrEventListenerObject, boolean | AddEventListenerOptions | undefined];
const escuchas: Escucha[] = [];

beforeEach(() => {
  const agregar = document.addEventListener.bind(document);
  vi.spyOn(document, "addEventListener").mockImplementation((tipo, f, o) => {
    if (f) escuchas.push([tipo, f, o]);
    agregar(tipo, f, o);
  });
  vi.resetModules();
  vi.stubEnv("VITE_CAMPANAS", "1");
  vi.stubEnv("VITE_RAMPA", "premios");
  h.sesion = null;
  h.sala = false;
  for (const f of [h.abrirSaldo, h.callar, h.esperarla, h.permitir]) f.mockReset();
  h.abrirSaldo.mockResolvedValue(undefined);
  sessionStorage.clear();
  document.body.innerHTML = "";
  history.replaceState(null, "", "/");
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const [tipo, f, o] of escuchas) document.removeEventListener(tipo, f, o);
  escuchas.length = 0;
  vi.unstubAllEnvs();
  history.replaceState(null, "", "/");
});

describe("la pestaña que deja la ventana de Google", () => {
  it("con la marca de la ventana: dice que vuelvan al sorteo, intenta cerrarse, calla el paso y no arranca el premio", async () => {
    const cerrar = vi.spyOn(window, "close").mockImplementation(() => undefined);
    marcarVentana(sessionStorage, Date.now());
    await arrancar();
    expect(document.querySelector('.campana-ventana[role="status"]')?.textContent).toBe("Listo. Volvé a la pestaña del sorteo.");
    expect(cerrar).toHaveBeenCalledTimes(1);
    expect(h.callar).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem(CLAVE_VENTANA)).toBeNull();
    expect(h.esperarla).not.toHaveBeenCalled();
  });

  it("con la marca de la ventana y el premio en la dirección: no pinta nada, no se cierra y suelta la marca", async () => {
    const cerrar = vi.spyOn(window, "close").mockImplementation(() => undefined);
    marcarVentana(sessionStorage, Date.now());
    history.replaceState(null, "", "/?red=oficial&premio=1");
    h.sesion = { address: "GAAA" };
    await arrancar();
    expect(document.querySelector(".campana-ventana")).toBeNull();
    expect(cerrar).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(CLAVE_VENTANA)).toBeNull();
    await vi.waitFor(() => expect(h.abrirSaldo).toHaveBeenCalledWith({ address: "GAAA" }));
  });

  it("sin ninguna marca ni premio, no hace nada", async () => {
    await arrancar();
    expect(document.querySelector(".campana-ventana")).toBeNull();
    expect(h.callar).not.toHaveBeenCalled();
    expect(h.permitir).not.toHaveBeenCalled();
    await dejarCorrer();
    expect(h.abrirSaldo).not.toHaveBeenCalled();
  });
});

describe("la entrada de quien ganó", () => {
  beforeEach(() => history.replaceState(null, "", "/?red=oficial&premio=1&lang=es"));

  it("con la sesión abierta: limpia la dirección, deja el permiso de la cuenta y abre el saldo", async () => {
    h.sesion = { address: "GAAA" };
    await arrancar();
    expect(location.search).toBe("?red=oficial&lang=es");
    expect(h.permitir).toHaveBeenCalledWith("GAAA");
    await vi.waitFor(() => expect(h.abrirSaldo).toHaveBeenCalledWith({ address: "GAAA" }));
    expect(h.abrirSaldo).toHaveBeenCalledTimes(1);
  });

  it("sin sesión: deja el permiso esperando y no abre nada; al entrar con Google abre el saldo", async () => {
    await arrancar();
    expect(h.esperarla).toHaveBeenCalledTimes(1);
    await dejarCorrer();
    expect(h.abrirSaldo).not.toHaveBeenCalled();
    enSesion("GAAA");
    expect(h.permitir).toHaveBeenCalledWith("GAAA");
    await vi.waitFor(() => expect(h.abrirSaldo).toHaveBeenCalledWith({ address: "GAAA" }));
  });

  it("quien entra desde la portada se queda en la portada: la marca de ir a sortear se borra antes que lo vea la página", async () => {
    await arrancar();
    sessionStorage.setItem("tinkazo.abrir", "app");
    // Lo que hace `main.ts` al llegar la sesión, escuchando después y sin captura.
    let vistaPorLaPagina: string | null = "sin mirar";
    document.addEventListener("tinkazo:sesion", () => {
      vistaPorLaPagina = sessionStorage.getItem("tinkazo.abrir");
    });
    enSesion("GAAA");
    expect(vistaPorLaPagina).toBeNull();
  });

  it("con la sala a la vista no abre el saldo, pero deja el permiso", async () => {
    h.sala = true;
    h.sesion = { address: "GAAA" };
    await arrancar();
    await dejarCorrer();
    expect(h.abrirSaldo).not.toHaveBeenCalled();
    expect(h.permitir).toHaveBeenCalledWith("GAAA");
  });

  it("si llega otra cuenta después, el permiso se apaga", async () => {
    h.sesion = { address: "GAAA" };
    await arrancar();
    await vi.waitFor(() => expect(h.abrirSaldo).toHaveBeenCalledTimes(1));
    enSesion("GBBB");
    expect(h.permitir).toHaveBeenLastCalledWith(null);
    expect(h.abrirSaldo).toHaveBeenCalledTimes(1);
  });

  it("con la ventana del saldo apagada en el build, no toca la dirección ni el permiso", async () => {
    vi.stubEnv("VITE_RAMPA", "");
    h.sesion = { address: "GAAA" };
    await arrancar();
    expect(location.search).toBe("?red=oficial&premio=1&lang=es");
    expect(h.permitir).not.toHaveBeenCalled();
    expect(h.esperarla).not.toHaveBeenCalled();
    await dejarCorrer();
    expect(h.abrirSaldo).not.toHaveBeenCalled();
  });

  it("con las campañas apagadas en el build, no hace nada", async () => {
    vi.stubEnv("VITE_CAMPANAS", "");
    h.sesion = { address: "GAAA" };
    await arrancar();
    expect(location.search).toBe("?red=oficial&premio=1&lang=es");
    await dejarCorrer();
    expect(h.abrirSaldo).not.toHaveBeenCalled();
  });
});
