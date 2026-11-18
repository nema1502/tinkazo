// @vitest-environment jsdom
/** Pruebas de la entrada de participar.html con servicio, idioma y reloj controlados. */

import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { campanaDeEjemplo } from "./ejemplo";
import type { ResultadoDeCarga } from "./carga";

const h = vi.hoisted(() => ({
  lang: "es" as "es" | "en",
  activa: true,
  portero: "https://servicio" as string | null,
  cambiarIdioma: null as null | (() => void),
  oyentes: 0,
  cargar: vi.fn(),
}));

vi.mock("../pagina", () => ({}));
vi.mock("../version-nueva", () => ({}));
vi.mock("./campana.css", () => ({}));
vi.mock("../stellar/patrocinio-config", () => ({
  configDelPortero: () => ({ url: h.portero }),
}));
vi.mock("../navegador", () => ({ enNavegadorDeApp: () => false }));
vi.mock("./bandera", () => ({ campanasActivo: () => h.activa }));
vi.mock("./carga", () => ({ cargarCampana: h.cargar }));
vi.mock("../idioma", async () => {
  const { TEXTOS_CAMPANA } = await import("./textos");
  return {
    getLang: () => h.lang,
    initialLang: () => h.lang,
    onLangChange: (fn: () => void) => {
      h.cambiarIdioma = fn;
      h.oyentes += 1;
    },
    setLang: (lang: "es" | "en") => {
      h.lang = lang;
    },
    texto: (clave: string) => TEXTOS_CAMPANA[h.lang][clave] ?? clave,
  };
});

const html = readFileSync("participar.html", "utf8");
const main = /<main[\s\S]*<\/main>/.exec(html)?.[0] ?? "";
const AHORA = Date.UTC(2026, 10, 15, 18, 0);
const sesionOriginal = Object.getOwnPropertyDescriptor(window, "sessionStorage");

async function abrir(search = "?c=evento-ejemplo"): Promise<void> {
  window.history.replaceState(null, "", `/participar.html${search}`);
  await import("../participar");
  await Promise.resolve();
  await Promise.resolve();
}

function cambiarAIngles(): void {
  h.lang = "en";
  h.cambiarIdioma?.();
}

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(AHORA);
  document.body.innerHTML = main;
  h.lang = "es";
  h.activa = true;
  h.portero = "https://servicio";
  h.cambiarIdioma = null;
  h.oyentes = 0;
  h.cargar.mockReset();
  h.cargar.mockResolvedValue({ ok: true, campana: campanaDeEjemplo(AHORA) });
});

afterEach(() => {
  if (sesionOriginal) Object.defineProperty(window, "sessionStorage", sesionOriginal);
  vi.restoreAllMocks();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
  window.history.replaceState(null, "", "/");
});

describe("participar.html", () => {
  it("con la bandera apagada muestra el aviso y lo traduce sin cargar", async () => {
    h.activa = false;
    await abrir();
    expect(document.querySelector("#cmp-estado")?.textContent).toBe(
      "Las campañas de empresas todavía no están abiertas.",
    );
    expect(h.cargar).not.toHaveBeenCalled();
    cambiarAIngles();
    expect(document.querySelector("#cmp-estado")?.textContent).toBe("Company campaigns aren't open yet.");
  });

  it("una campaña que no existe muestra su mensaje y lo traduce", async () => {
    h.cargar.mockResolvedValue({ ok: false, estado: "no-esta" });
    await abrir();
    expect(document.querySelector("#cmp-estado")?.textContent).toBe(
      "No encontramos esta campaña. Revisá que el código QR sea el del stand.",
    );
    expect(document.querySelector("#cmp-estado button")).toBeNull();
    cambiarAIngles();
    expect(document.querySelector("#cmp-estado")?.textContent).toBe(
      "We couldn't find this campaign. Check that the QR code is the one at the stand.",
    );
  });

  it("una configuración inválida muestra su mensaje sin reintento y lo traduce", async () => {
    h.cargar.mockResolvedValue({ ok: false, estado: "mal" });
    await abrir();
    expect(document.querySelector("#cmp-estado")?.textContent).toBe(
      "No pudimos mostrar esta campaña. Avisale a quien atiende el stand.",
    );
    expect(document.querySelector("#cmp-estado button")).toBeNull();
    cambiarAIngles();
    expect(document.querySelector("#cmp-estado")?.textContent).toBe(
      "We couldn't show this campaign. Let the people at the stand know.",
    );
  });

  it("mientras carga muestra el indicador y lo traduce", async () => {
    let resolver: ((resultado: ResultadoDeCarga) => void) | undefined;
    h.cargar.mockImplementation(() => new Promise<ResultadoDeCarga>((resolve) => {
      resolver = resolve;
    }));
    await abrir();
    expect(document.querySelector("#cmp-estado")?.textContent).toBe("Cargando la campaña…");
    cambiarAIngles();
    expect(document.querySelector("#cmp-estado")?.textContent).toBe("Loading the campaign…");
    resolver?.({ ok: true, campana: campanaDeEjemplo(AHORA) });
    await Promise.resolve();
    await Promise.resolve();
  });

  it("sin red muestra Probar de nuevo, reintenta y traduce sin sumar oyentes", async () => {
    h.cargar.mockResolvedValue({ ok: false, estado: "sin-red" });
    await abrir();
    expect(document.querySelector("#cmp-estado")?.textContent).toContain(
      "No pudimos cargar la campaña. Revisá tu conexión y probá de nuevo.",
    );
    const boton = document.querySelector<HTMLButtonElement>("#cmp-estado button");
    expect(boton?.textContent).toBe("Probar de nuevo");
    boton?.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(h.cargar).toHaveBeenCalledTimes(2);
    expect(h.oyentes).toBe(1);
    cambiarAIngles();
    expect(document.querySelector("#cmp-estado")?.textContent).toContain(
      "We couldn't load the campaign. Check your connection and try again.",
    );
    expect(document.querySelector("#cmp-estado button")?.textContent).toBe("Try again");
  });

  it("usa el evento del enlace del QR para pedir la campaña", async () => {
    await abrir("?c=evento-ejemplo&q=12.ABCDEFGHIJKLMNOP#abcdefghijklmnopqrstuv");
    expect(h.cargar).toHaveBeenCalledWith(fetch, "https://servicio", "evento-ejemplo");
    expect(document.querySelector("h1")?.textContent).toBe("Sorteo de Empresa de ejemplo en Evento de ejemplo");
  });

  it("un enlace sin evento válido muestra que la campaña no existe", async () => {
    await abrir("?c=NO");
    expect(h.cargar).not.toHaveBeenCalled();
    expect(document.querySelector("#cmp-estado")?.textContent).toBe(
      "No encontramos esta campaña. Revisá que el código QR sea el del stand.",
    );
  });

  it("la vista de ejemplo abre aunque leer sessionStorage lance SecurityError", async () => {
    Object.defineProperty(window, "sessionStorage", {
      configurable: true,
      get: () => {
        throw new DOMException("almacenamiento bloqueado", "SecurityError");
      },
    });
    await abrir("?demo=campana");
    expect(document.querySelector("h1")?.textContent).toBe("Sorteo de Empresa de ejemplo en Evento de ejemplo");
    expect(document.querySelector("#cmp-estado")?.textContent).toBe("");
    document.querySelector<HTMLButtonElement>("#cmp-saber .primary")?.click();
    const casilla = document.querySelector<HTMLInputElement>(".cmp-paso input[type=checkbox]");
    casilla?.click();
    expect(casilla?.checked).toBe(true);
  });

  it("el aviso de la vista de ejemplo cambia de idioma y queda fijo en la raíz", async () => {
    await abrir("?demo=campana");
    document.querySelector<HTMLButtonElement>("#cmp-saber .primary")?.click();
    document.querySelector<HTMLButtonElement>("#cmp-pasos .primary")?.click();
    const mensaje = document.querySelector<HTMLElement>("#cmp-mensaje");
    expect(mensaje?.textContent).toBe("En la vista de ejemplo no se anota a nadie.");
    cambiarAIngles();
    expect(mensaje?.textContent).toBe("Nobody signs up in the sample view.");
    expect(mensaje?.parentElement).toBe(document.querySelector(".cmp"));
  });

  it("un aviso descartado al volver no reaparece al cambiar de idioma", async () => {
    await abrir("?demo=campana");
    document.querySelector<HTMLButtonElement>("#cmp-saber .primary")?.click();
    document.querySelector<HTMLButtonElement>("#cmp-pasos .primary")?.click();
    expect(document.querySelector("#cmp-mensaje")?.textContent).toBe("En la vista de ejemplo no se anota a nadie.");
    document.querySelector<HTMLButtonElement>("#cmp-pasos .cmp-accion > .ghost")?.click();
    expect(document.querySelector("#cmp-mensaje")?.textContent).toBe("");
    cambiarAIngles();
    expect(document.querySelector("#cmp-mensaje")?.textContent).toBe("");
  });

  it("el aviso de próxima apertura de Anotarme también cambia de idioma", async () => {
    const campana = { ...campanaDeEjemplo(AHORA), pasos: [] };
    h.cargar.mockResolvedValue({ ok: true, campana });
    await abrir();
    document.querySelector<HTMLButtonElement>("#cmp-saber .primary")?.click();
    expect(document.querySelector("#cmp-mensaje")?.textContent).toBe("Muy pronto vas a poder anotarte desde acá.");
    cambiarAIngles();
    expect(document.querySelector("#cmp-mensaje")?.textContent).toBe("Soon you'll be able to sign up from here.");
  });
});
