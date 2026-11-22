// @vitest-environment jsdom
import { readFileSync } from "node:fs";
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
  red: "mainnet" as "mainnet" | "testnet",
  montar: vi.fn(),
  avisar: vi.fn(),
}));

vi.mock("../stellar/config", async (orig) => {
  const o = await orig<typeof import("../stellar/config")>();
  return {
    ...o,
    hayModoOficial: true,
    network: {
      ...o.network,
      get name() {
        return h.red;
      },
    },
  };
});
vi.mock("./campana-sala", () => ({ montarPanelDeCampana: () => h.montar() }));
vi.mock("./campana-pendiente", () => ({ avisarEnPrueba: () => h.avisar() }));
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
  h.red = "mainnet";
  localStorage.clear();
  for (const f of [h.abrirSaldo, h.callar, h.esperarla, h.permitir, h.montar, h.avisar]) f.mockReset();
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

describe("la campaña por activar que dejó crear-campana.html", () => {
  const BORRADOR = JSON.stringify({ evento: "panaderia-la-estrella-x", empresa: { nombre: "Panadería La Estrella" } });

  it("con el borrador y sin ?campana, en Oficial: monta el panel y abre la herramienta", async () => {
    localStorage.setItem("tinkazo.campana.borrador", BORRADOR);
    const cambios: string[] = [];
    const alCambiar = (): void => void cambios.push(location.hash);
    addEventListener("hashchange", alCambiar);
    await arrancar();
    removeEventListener("hashchange", alCambiar);
    await vi.waitFor(() => expect(h.montar).toHaveBeenCalledTimes(1));
    expect(location.hash).toBe("#sortear");
    expect(cambios).toEqual(["#sortear"]);
    expect(h.avisar).not.toHaveBeenCalled();
  });

  it("con sesión y con el borrador: la página abre la herramienta, y ahí la sección del sorteo se ve con el panel adentro", async () => {
    h.sesion = { address: "GORGANIZA" };
    localStorage.setItem("tinkazo.campana.borrador", BORRADOR);
    history.replaceState(null, "", "/?campana&red=oficial");
    // La vista la cambia main.ts con el fragmento: #sortear es la herramienta, la misma que abre Sortear del menú.
    const main = readFileSync("src/main.ts", "utf8");
    expect(main).toMatch(/if \(h === "#sortear" \|\| h === "#ta"\) setVista\("app", "nuevo"\);/);
    expect(main).toContain('addEventListener("hashchange", () => void porHash());');
    const html = readFileSync("index.html", "utf8");
    document.body.innerHTML = /<body[^>]*>([\s\S]*)<\/body>/.exec(html)?.[1] ?? "";
    document.body.dataset.vista = "portada";
    const porHash = (): void => {
      if (location.hash === "#sortear") document.body.dataset.vista = "app";
    };
    addEventListener("hashchange", porHash);
    await arrancar();
    removeEventListener("hashchange", porHash);
    await vi.waitFor(() => expect(h.montar).toHaveBeenCalledTimes(1));
    expect(document.body.dataset.vista).toBe("app");
    // En la herramienta la sección del sorteo se ve (styles.css esconde .app-only solo en la portada), y el panel se monta
    // antes de #origenes, que vive en ella (montarPanelDeCampana).
    const seccion = document.getElementById("sec-participants");
    expect(seccion?.classList.contains("app-only")).toBe(true);
    expect(seccion?.contains(document.getElementById("origenes"))).toBe(true);
    const css = readFileSync("src/styles.css", "utf8");
    expect(css).toContain('body[data-vista="portada"] .app-only { display: none !important; }');
  });

  it("tocar Sortear en el menú (sin ?campana y con #sortear) igual la monta, sin tocar la dirección", async () => {
    localStorage.setItem("tinkazo.campana.borrador", BORRADOR);
    history.replaceState(null, "", "/#sortear");
    await arrancar();
    await vi.waitFor(() => expect(h.montar).toHaveBeenCalledTimes(1));
    expect(location.hash).toBe("#sortear");
  });

  it("Mis sorteos se respeta: monta el panel sin cambiar de vista", async () => {
    localStorage.setItem("tinkazo.campana.borrador", BORRADOR);
    history.replaceState(null, "", "/#mis-sorteos");
    await arrancar();
    await vi.waitFor(() => expect(h.montar).toHaveBeenCalledTimes(1));
    expect(location.hash).toBe("#mis-sorteos");
  });

  it("en Prueba no monta el panel: avisa y deja la portada como está", async () => {
    h.red = "testnet";
    localStorage.setItem("tinkazo.campana.borrador", BORRADOR);
    await arrancar();
    await vi.waitFor(() => expect(h.avisar).toHaveBeenCalledTimes(1));
    await dejarCorrer();
    expect(h.montar).not.toHaveBeenCalled();
    expect(location.hash).toBe("");
  });

  it("sin borrador no baja nada: ni el panel ni el aviso, y la dirección queda igual", async () => {
    await arrancar();
    await dejarCorrer();
    expect(h.montar).not.toHaveBeenCalled();
    expect(h.avisar).not.toHaveBeenCalled();
    expect(location.hash).toBe("");
    h.red = "testnet";
    await arrancar();
    await dejarCorrer();
    expect(h.montar).not.toHaveBeenCalled();
    expect(h.avisar).not.toHaveBeenCalled();
  });

  it("con ?campana y sin borrador sigue montando el panel, y abre la herramienta donde vive", async () => {
    history.replaceState(null, "", "/?campana&red=oficial");
    await arrancar();
    await vi.waitFor(() => expect(h.montar).toHaveBeenCalledTimes(1));
    expect(location.hash).toBe("#sortear");
  });

  it("un borrador roto no cambia nada: ni la vista, ni el panel, ni el aviso", async () => {
    for (const crudo of ["basura", "{}", "null", JSON.stringify({ evento: "x" }), JSON.stringify({ empresa: { nombre: "A" } })]) {
      localStorage.setItem("tinkazo.campana.borrador", crudo);
      history.replaceState(null, "", "/");
      for (const red of ["mainnet", "testnet"] as const) {
        h.red = red;
        await arrancar();
        await dejarCorrer();
        expect(h.montar, crudo).not.toHaveBeenCalled();
        expect(h.avisar, crudo).not.toHaveBeenCalled();
        expect(location.hash, crudo).toBe("");
      }
    }
  });

  it("sin almacenamiento no pasa nada", async () => {
    const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("bloqueado");
    });
    await arrancar();
    await dejarCorrer();
    getItem.mockRestore();
    expect(h.montar).not.toHaveBeenCalled();
    expect(location.hash).toBe("");
  });

  it("la clave del borrador es la misma que usa borrador.ts", async () => {
    const { CLAVE_DEL_BORRADOR } = await import("../campana/borrador");
    const { CLAVE_DEL_BORRADOR_AQUI } = await import("./campana-arranque");
    expect(CLAVE_DEL_BORRADOR_AQUI).toBe(CLAVE_DEL_BORRADOR);
  });

  it("con ?campana y con sesión, sin borrador: abre la herramienta con el panel, como Sortear del menú", async () => {
    h.sesion = { address: "GORGANIZA" };
    history.replaceState(null, "", "/?campana&red=oficial");
    await arrancar();
    await vi.waitFor(() => expect(h.montar).toHaveBeenCalledTimes(1));
    expect(location.hash).toBe("#sortear");
  });

  it("con una demostración en la dirección, el borrador no se pone encima", async () => {
    localStorage.setItem("tinkazo.campana.borrador", BORRADOR);
    history.replaceState(null, "", "/?demo=race");
    await arrancar();
    await dejarCorrer();
    expect(h.montar).not.toHaveBeenCalled();
    expect(location.hash).toBe("");
    h.red = "testnet";
    await arrancar();
    await dejarCorrer();
    expect(h.avisar).not.toHaveBeenCalled();
  });

  it("la entrada de quien ganó no se mezcla: con el premio en la dirección no monta la campaña", async () => {
    localStorage.setItem("tinkazo.campana.borrador", BORRADOR);
    history.replaceState(null, "", "/?red=oficial&premio=1");
    await arrancar();
    await dejarCorrer();
    expect(h.montar).not.toHaveBeenCalled();
  });
});
