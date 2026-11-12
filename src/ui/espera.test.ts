// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../i18n";
import { RANGOS } from "./recomendar";
import { elegirAlAzar, type JuegoAzar } from "./azar";

/**
 * El botón «Al azar» del panel Elegí el juego (`espera.ts`): al tocarlo,
 * elige un juego que encaje con la cantidad de personas, recorre las tarjetas
 * con la animación de `azar.ts` y después hace lo mismo que tocar la tarjeta
 * del juego elegido: se lo pasa a `elegirJuego` y cierra el panel. Con
 * movimiento reducido, no hay ruleta: queda el elegido directo.
 */

const h = vi.hoisted(() => ({ reduce: false, semilla: 0, elegido: "race" }));

vi.mock("../sound", () => ({ beep: () => undefined, note: (n: number) => n }));
vi.mock("./vista-grande", () => ({ rechazarGrande: () => undefined }));
vi.mock("./pantalla-completa", () => ({ soltarPantallaCompleta: () => undefined }));

const NOMBRES = ["Ana", "Beto", "Cami", "Dani", "Eva", "Fito", "Gaby"];

/** Los juegos del panel, en el orden en que los recomienda esta gente (7 personas: la Chovena y el Teleférico no encajan). */
function juegos(): { game: string; nombre: string; rango: string; recomendado: boolean; elegido: boolean }[] {
  const base = [
    { game: "race", nombre: "Carrera de llamas", rango: "2–200", recomendado: true },
    { game: "sapo", nombre: "Sapo", rango: "2–40", recomendado: true },
    { game: "trompo", nombre: "Trompo", rango: "2–14", recomendado: true },
    { game: "chovena", nombre: "Chovena", rango: "8–80", recomendado: false },
    { game: "teleferico", nombre: "Teleférico", rango: "16–200", recomendado: false },
    { game: "wheel", nombre: "Ruleta", rango: "2–200", recomendado: false },
    { game: "pinata", nombre: "Piñata", rango: "2–200", recomendado: false },
  ];
  return base.map((j) => ({ ...j, elegido: j.game === h.elegido }));
}

function armarPagina(): void {
  // El selector de la página: la fuente de verdad de "este juego tiene captura" (`opcionesHtml`).
  document.body.innerHTML = ["race", "sapo", "chovena", "wheel"]
    .map(
      (g) =>
        `<button id="g-${g}"><img class="sel-img sel-osc" src="/juegos/selector/${g}.webp" alt="" /><img class="sel-img sel-cla" src="/juegos/selector/${g}-light.webp" alt="" /><span>${g}</span></button>`,
    )
    .join("");
}

/** El catálogo numérico que la espera le arma a `azar.ts`, el mismo que arma el botón. */
function catalogo(): JuegoAzar[] {
  return juegos().map((j) => ({ game: j.game, rango: RANGOS[j.game as keyof typeof RANGOS] ?? {} }));
}

/** Prende la ronda (`app.frozen`) y abre la espera con un `Sorteo` de prueba. */
async function abrirEspera(): Promise<{ elegirJuego: ReturnType<typeof vi.fn>; panel: HTMLElement }> {
  const { mostrarEspera } = await import("./espera");
  const { app } = await import("../state");
  app.drawn = null;
  app.frozen = { names: NOMBRES, listHash: "ab", ts: 1, at: "", prize: "Un premio", round: 1 };
  app.game = "race";
  const elegirJuego = vi.fn((g: string) => {
    // Como `elegirJuego` de freeze.ts: queda elegido, y `juegos()` lo refleja.
    h.elegido = g;
  });
  mostrarEspera(() => 30, { sortear: () => undefined, aMano: () => false, graba: false, juegos: juegos as never, elegirJuego });
  // La espera trae su botón de "Cambiar de juego": el toque abre el panel.
  (document.querySelector(".espera [data-juego]") as HTMLButtonElement).click();
  const panel = document.querySelector(".espera-juegos") as HTMLElement;
  return { elegirJuego, panel };
}

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  armarPagina();
  h.reduce = false;
  h.semilla = 0;
  h.elegido = "race";
  // jsdom no tiene matchMedia: la espera la consulta (ajustar) y el azar, para el movimiento reducido.
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: q.includes("prefers-reduced-motion") && h.reduce,
    media: q,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
  // La semilla del toque, fija para la prueba: cada clic toma el valor de `h.semilla`.
  vi.stubGlobal("crypto", { getRandomValues: (a: Uint32Array) => { a[0] = h.semilla; return a; } });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

const resaltadas = (panel: HTMLElement): string[] =>
  [...panel.querySelectorAll("[data-game][aria-pressed='true']")].map((b) => (b as HTMLElement).dataset.game ?? "");

/** Recorre los timers hasta que el sorteo al azar termina (el recorrido dura menos de 3,5 s). */
function correrLaAnimacion(): void {
  for (let i = 0; i < 50 && vi.getTimerCount() > 0; i++) vi.advanceTimersByTime(100);
}

describe("el botón Al azar", () => {
  it("está en el panel Elegí el juego, con el dado y en el idioma", async () => {
    await abrirEspera();
    const boton = document.querySelector<HTMLButtonElement>(".espera-juegos [data-azar]");
    expect(boton).not.toBeNull();
    expect(boton?.textContent).toContain("🎲");
    expect(boton?.textContent).toContain(t("espAzar"));
    expect(boton?.className).toContain("ghost");
  });

  it("al tocarlo lanza la animación y después elige, como si se tocara la tarjeta", async () => {
    const { elegirJuego, panel } = await abrirEspera();
    expect(panel.hidden).toBe(false);
    (document.querySelector(".espera-juegos [data-azar]") as HTMLButtonElement).click();

    // Mientras corre, no eligió todavía, pero ya hay una tarjeta resaltada.
    expect(elegirJuego).not.toHaveBeenCalled();
    expect(resaltadas(panel)).toHaveLength(1);

    correrLaAnimacion();

    // El mismo camino que tocar la tarjeta: se elige y el panel se cierra.
    const esperado = elegirAlAzar(catalogo(), NOMBRES.length, h.semilla).elegido?.game;
    expect(elegirJuego).toHaveBeenCalledTimes(1);
    expect(elegirJuego).toHaveBeenCalledWith(esperado);
    // Con 7 personas, la Chovena (8–80) y el Teleférico (16–200) no pueden salir.
    expect(["chovena", "teleferico"]).not.toContain(elegirJuego.mock.calls[0]?.[0]);
    expect(panel.hidden).toBe(true);
    // Y el nombre del juego queda pintado en la espera.
    const nombre = document.querySelector(".espera-juego-n b");
    expect(nombre?.textContent).toBe(juegos().find((j) => j.game === elegirJuego.mock.calls[0]?.[0])?.nombre);
  });

  it("con movimiento reducido no hay ruleta: elige directo", async () => {
    h.reduce = true;
    const { elegirJuego, panel } = await abrirEspera();
    (document.querySelector(".espera-juegos [data-azar]") as HTMLButtonElement).click();
    const esperado = elegirAlAzar(catalogo(), NOMBRES.length, h.semilla).elegido?.game;
    expect(elegirJuego).toHaveBeenCalledWith(esperado);
    expect(panel.hidden).toBe(true);
  });
});
