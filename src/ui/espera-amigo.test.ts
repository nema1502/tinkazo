// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../state";
import { T, setLang } from "../i18n";
import { mostrarEspera, type OpcionDeJuego } from "./espera";

/**
 * La espera en grande de un Amigo secreto (`mostrarEspera` en `espera.ts`). El orden que va a salir es el reparto
 * entero, así que no hay QR de ver en vivo (el celular que lo escanea mostraría ese orden) ni juego que elegir: en este
 * modo no se juega nada. Quedan el cartel, la cuenta, los nombres en el orden pegado y Volver.
 */

vi.mock("../sound", () => ({ beep: () => undefined, note: (n: number) => n }));
vi.mock("./vista-grande", () => ({ rechazarGrande: () => undefined }));
vi.mock("./pantalla-completa", () => ({ soltarPantallaCompleta: () => undefined }));
// Sin red: el enlace corto del QR no se pide.
vi.mock("./espectador-enlace", async (orig) => ({
  ...(await orig<typeof import("./espectador-enlace")>()),
  armarQrDeEspectador: async () => undefined,
}));

const NOMBRES = ["Ana", "Beto", "Carla", "Diego", "Eva", "Fabio"];
const JUEGOS: OpcionDeJuego[] = [
  { game: "race", nombre: "Carrera de llamas", rango: "", recomendado: false, elegido: true },
  { game: "wheel", nombre: "Ruleta", rango: "", recomendado: false, elegido: false },
];

/** Abre la espera de un sorteo sellado en Stellar: un Amigo secreto, o un sorteo común con el mismo largo. */
function abrir(amigo: boolean): HTMLElement {
  app.drawn = null;
  app.frozen = {
    names: NOMBRES, listHash: "ab", ts: 1, at: "", prize: amigo ? "Amigo secreto" : "Termo", round: 1,
    raffleId: 5n, numWinners: amigo ? NOMBRES.length : 1,
  };
  const abierta = mostrarEspera(() => 30, {
    sortear: vi.fn(),
    aMano: () => false,
    graba: true,
    juegos: () => JUEGOS,
    elegirJuego: vi.fn(),
    premios: () => (amigo ? NOMBRES.length : 1),
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
});

afterEach(() => {
  document.querySelector<HTMLButtonElement>(".espera [data-volver]")?.click();
  setLang("es");
  app.frozen = null;
  app.drawn = null;
  document.body.innerHTML = "";
});

describe("la espera en grande de un Amigo secreto", () => {
  it("no trae el QR de ver en vivo", () => {
    const espera = abrir(true);
    expect(espera.querySelector(".espera-qr")).toBeNull();
  });

  it("no ofrece juego: ni el de la barra ni el panel para cambiarlo", () => {
    const espera = abrir(true);
    expect(espera.querySelector(".espera-juego")).toBeNull();
    expect(espera.querySelector(".espera-juegos")).toBeNull();
    expect(espera.querySelector("[data-juego]")).toBeNull();
  });

  it("el cartel dice que nadie sabe a quién le toca, también en inglés", () => {
    const espera = abrir(true);
    expect(espera.querySelector(".sticker")?.textContent).toBe("Todavía nadie sabe a quién le toca");
    expect(espera.getAttribute("aria-label")).toBe(T.es.espStickerAmigo);
    setLang("en");
    expect(espera.querySelector(".sticker")?.textContent).toBe("Nobody knows who gets whom yet");
    expect(espera.getAttribute("aria-label")).toBe(T.en.espStickerAmigo);
  });

  it("los nombres pasan en el orden pegado, y Volver sigue", () => {
    const espera = abrir(true);
    expect(espera.querySelector(".espera-nombres")?.textContent).toContain("Ana");
    expect(espera.querySelector("[data-volver]")).not.toBeNull();
  });

  it("un sorteo común sellado sigue con su QR y su juego", () => {
    const espera = abrir(false);
    expect(espera.querySelector(".espera-qr")).not.toBeNull();
    expect(espera.querySelector(".espera-juego")).not.toBeNull();
    expect(espera.querySelector(".sticker")?.textContent).toBe(T.es.espSticker);
  });
});
