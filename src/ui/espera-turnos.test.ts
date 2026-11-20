// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../state";
import { setLang } from "../i18n";
import { setResultadoDeTurnos } from "../modos/turnos";
import { mostrarEspera } from "./espera";

vi.mock("../sound", () => ({ beep: () => undefined, note: (n: number) => n }));
vi.mock("./vista-grande", () => ({ rechazarGrande: () => undefined }));
vi.mock("./pantalla-completa", () => ({ soltarPantallaCompleta: () => undefined }));

const NOMBRES = ["Ana", "Beto", "Cami", "Dani", "Eva"];
const prohibido = (lang: "es" | "en"): RegExp =>
  lang === "es" ? /\b(?:ganar|gana|ganador|ganadora|ganadores|ganadoras|premio|premios)\b/i : /\b(?:win|wins|winner|winners|prize|prizes)\b/i;

function abrir(orden: boolean): HTMLElement {
  app.drawn = null;
  app.frozen = { names: NOMBRES, listHash: "ab", ts: 1, at: "", prize: orden ? "Turnos" : "Termo", round: 1 };
  const abierta = mostrarEspera(() => 30, {
    sortear: vi.fn(),
    aMano: () => false,
    graba: false,
    juegos: () => [],
    elegirJuego: vi.fn(),
    premios: () => (orden ? NOMBRES.length : 1),
  });
  expect(abierta).toBe(true);
  return document.querySelector<HTMLElement>(".espera") as HTMLElement;
}

beforeAll(() => {
  window.matchMedia = ((q: string) => ({
    matches: false,
    media: q,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
});

beforeEach(() => {
  document.body.innerHTML = "";
  sessionStorage.clear();
  // La espera no depende de la marca que se prende recién antes del show.
  setResultadoDeTurnos(false);
});

afterEach(() => {
  document.querySelector<HTMLButtonElement>(".espera [data-volver]")?.click();
  setLang("es");
  app.frozen = null;
  app.drawn = null;
  document.body.innerHTML = "";
});

describe("la espera en grande con un orden de turnos", () => {
  it("no habla de ganar ni de premios, y no resalta Turnos como si fuera uno", () => {
    const espera = abrir(true);
    expect(espera.querySelector(".sticker")?.textContent).toBe("Todavía nadie sabe el orden");
    expect(espera.getAttribute("aria-label")).toBe("Todavía nadie sabe el orden");
    expect(espera.querySelector(".espera-premio")?.textContent).toBe("Se sortea el orden de los turnos");
    expect(espera.querySelector(".espera-premio b")).toBeNull();
    expect(espera.textContent).not.toMatch(prohibido("es"));
  });

  it("repinta el cartel, el aria-label y la línea al cambiar de idioma", () => {
    const espera = abrir(true);
    setLang("en");
    expect(espera.querySelector(".sticker")?.textContent).toBe("Nobody knows the order yet");
    expect(espera.getAttribute("aria-label")).toBe("Nobody knows the order yet");
    expect(espera.querySelector(".espera-premio")?.textContent).toBe("Drawing the turn order");
    expect(espera.textContent).not.toMatch(prohibido("en"));
    expect(espera.querySelector('[data-volver]')?.getAttribute("aria-label")).toBe("Back to the page");
    expect(espera.querySelector(".espera-volver-corto")?.textContent).toBe("Back");
  });

  it("un sorteo de premios conserva el cartel y el nombre destacado", () => {
    const espera = abrir(false);
    expect(espera.querySelector(".sticker")?.textContent).toBe("Todavía nadie sabe quién gana");
    expect(espera.getAttribute("aria-label")).toBe("Todavía nadie sabe quién gana");
    expect(espera.querySelector(".espera-premio")?.textContent).toBe("Se sortea Termo");
    expect(espera.querySelector(".espera-premio b")?.textContent).toBe("Termo");
  });
});

describe("el botón de volver en una pantalla angosta", () => {
  it("queda en un renglón, mide al menos 44 px y ofrece un texto corto hasta 480 px", () => {
    const espera = abrir(true);
    const boton = espera.querySelector<HTMLElement>("[data-volver]");
    expect(boton?.querySelector(".espera-volver-largo")?.textContent).toBe("Volver a la página");
    expect(boton?.querySelector(".espera-volver-corto")?.textContent).toBe("Volver");
    const css = readFileSync(join(process.cwd(), "src/styles.css"), "utf8");
    expect(css).toMatch(/\.espera-top \[data-volver\] \{[^}]*min-height: 44px;[^}]*white-space: nowrap;/);
    expect(css).toMatch(/@media \(max-width: 480px\) \{[^}]*\.espera-volver-largo \{ display: none; \}[^}]*\.espera-volver-corto \{ display: inline; \}/);
  });
});
