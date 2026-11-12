// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RANGOS } from "./recomendar";
import { elegirAlAzar, type JuegoAzar } from "./azar";

/**
 * El botón Sorprendeme del panel Elegí el juego (`espera.ts`): al tocarlo,
 * elige un juego que encaje con la cantidad de personas y con los premios,
 * recorre las tarjetas con la animación de `azar.ts` y después hace lo mismo
 * que tocar la tarjeta del juego elegido: se lo pasa a `elegirJuego` y cierra
 * el panel. Con movimiento reducido, no hay ruleta: queda el elegido directo.
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

/** El catálogo numérico que la espera le arma a `azar.ts`, el mismo que arma el botón (con un solo premio no se quita ninguno). */
function catalogo(): JuegoAzar[] {
  return juegos().map((j) => ({ game: j.game, rango: RANGOS[j.game as keyof typeof RANGOS] ?? {} }));
}

/** Prende la ronda (`app.frozen`) y abre la espera con un `Sorteo` de prueba. `premios`: cuántos se sortean. */
async function abrirEspera(premios = 1): Promise<{ elegirJuego: ReturnType<typeof vi.fn>; panel: HTMLElement }> {
  const { mostrarEspera } = await import("./espera");
  const { app } = await import("../state");
  app.drawn = null;
  app.frozen = { names: NOMBRES, listHash: "ab", ts: 1, at: "", prize: "Un premio", round: 1 };
  app.game = "race";
  const elegirJuego = vi.fn((g: string) => {
    // Como `elegirJuego` de freeze.ts: queda elegido, y `juegos()` lo refleja.
    h.elegido = g;
  });
  mostrarEspera(() => 30, { sortear: () => undefined, aMano: () => false, graba: false, juegos: juegos as never, elegirJuego, premios: () => premios });
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
  // jsdom no tiene matchMedia: la espera la consulta (ajustar) y el botón, para el movimiento reducido.
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

const botonAzar = (): HTMLButtonElement => document.querySelector(".espera-juegos [data-azar]") as HTMLButtonElement;

/** Recorre los timers hasta que la ruleta termina (el recorrido dura menos de 3,5 s). */
function correrLaAnimacion(): void {
  for (let i = 0; i < 50 && vi.getTimerCount() > 0; i++) vi.advanceTimersByTime(100);
}

/**
 * Toca el botón con la semilla dada y deja correr la ruleta de a 50 ms. Devuelve el juego que quedó y todas las tarjetas
 * que se vieron encendidas por el camino. Si el panel está cerrado, lo abre primero.
 */
function sortearUna(elegirJuego: ReturnType<typeof vi.fn>, panel: HTMLElement, semilla: number): { quedo: string; vistas: Set<string> } {
  h.semilla = semilla;
  if (panel.hidden) (document.querySelector(".espera [data-juego]") as HTMLButtonElement).click();
  const vistas = new Set<string>();
  botonAzar().click();
  for (let i = 0; i < 100 && !panel.hidden; i++) {
    for (const g of resaltadas(panel)) vistas.add(g);
    vi.advanceTimersByTime(50);
  }
  const ultima = elegirJuego.mock.calls[elegirJuego.mock.calls.length - 1];
  return { quedo: String(ultima?.[0] ?? ""), vistas };
}

/** Semillas de toda clase: chicas, grandes y el máximo de 32 bits. Con la semilla 0 la ruleta arranca justo en la carrera. */
const SEMILLAS = [0, 1, 2, 3, 5, 8, 13, 21, 34, 55, 144, 12345, 2147483647, 4294967295];

describe("el botón Sorprendeme", () => {
  it("está en el panel Elegí el juego, en español, sin dado ni ícono y sin la palabra azar", async () => {
    const { setLang } = await import("../i18n");
    setLang("es");
    await abrirEspera();
    const boton = botonAzar();
    expect(boton).not.toBeNull();
    expect(boton.textContent?.trim()).toBe("Sorprendeme");
    // Ni el dado ni ningún dibujo adentro: solo el nombre.
    expect(boton.children).toHaveLength(0);
    expect(boton.textContent).not.toMatch(/🎲|azar|dado/i);
    expect(boton.className).toContain("ghost");
    // Y en todo el panel que ve la sala, la palabra azar no aparece.
    expect(document.querySelector(".espera-juegos")?.textContent).not.toMatch(/azar/i);
  });

  it("en inglés dice Surprise me, sin dado ni ícono", async () => {
    const { setLang } = await import("../i18n");
    setLang("en");
    await abrirEspera();
    const boton = botonAzar();
    expect(boton.textContent?.trim()).toBe("Surprise me");
    expect(boton.children).toHaveLength(0);
    expect(boton.textContent).not.toMatch(/🎲|dice|random/i);
  });

  it("al tocarlo lanza la animación y después elige, como si se tocara la tarjeta", async () => {
    const { elegirJuego, panel } = await abrirEspera();
    expect(panel.hidden).toBe(false);
    botonAzar().click();

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
    botonAzar().click();
    const esperado = elegirAlAzar(catalogo(), NOMBRES.length, h.semilla).elegido?.game;
    expect(elegirJuego).toHaveBeenCalledWith(esperado);
    expect(panel.hidden).toBe(true);
  });
});

describe("mientras gira", () => {
  it("las semillas de la prueba arrancan la ruleta en tarjetas distintas de la elegida de partida", () => {
    // Si todas arrancaran en la carrera, la prueba de abajo no vería nunca dos tarjetas encendidas.
    const arranques = new Set(SEMILLAS.map((s) => catalogo()[elegirAlAzar(catalogo(), NOMBRES.length, s).recorrido[0]?.indice ?? 0]?.game));
    expect(arranques.size).toBeGreaterThanOrEqual(3);
    expect([...arranques].filter((g) => g !== "race").length).toBeGreaterThanOrEqual(2);
  });

  it.each(SEMILLAS)("con la semilla %i queda una sola tarjeta encendida en cada paso y termina en el elegido", async (semilla) => {
    h.semilla = semilla;
    const { elegirJuego, panel } = await abrirEspera();
    // De partida está elegida la carrera: es la tarjeta violeta.
    expect(resaltadas(panel)).toEqual(["race"]);
    const esperado = elegirAlAzar(catalogo(), NOMBRES.length, semilla);
    botonAzar().click();
    esperado.recorrido.forEach((paso, i) => {
      // La que estaba elegida de partida se apagó: solo brilla la que recorre la ruleta.
      expect(resaltadas(panel), `paso ${i}`).toEqual([catalogo()[paso.indice]?.game]);
      vi.advanceTimersByTime(paso.pausa);
    });
    expect(elegirJuego).toHaveBeenCalledTimes(1);
    expect(elegirJuego).toHaveBeenCalledWith(esperado.elegido?.game);
    expect(panel.hidden).toBe(true);
  });

  it("cerrar el panel a mitad de la ruleta la detiene y no elige nada", async () => {
    h.semilla = 5;
    const { elegirJuego, panel } = await abrirEspera();
    botonAzar().click();
    vi.advanceTimersByTime(600);
    (document.querySelector(".espera-juegos [data-juegos-listo]") as HTMLButtonElement).click();
    expect(panel.hidden).toBe(true);
    correrLaAnimacion();
    expect(elegirJuego).not.toHaveBeenCalled();
  });

  it("un toque en una tarjeta mientras gira no corta la ruleta ni elige ese juego", async () => {
    h.semilla = 5;
    const { elegirJuego, panel } = await abrirEspera();
    botonAzar().click();
    vi.advanceTimersByTime(300);
    (panel.querySelector("[data-game='trompo']") as HTMLButtonElement).click();
    expect(panel.hidden).toBe(false);
    expect(elegirJuego).not.toHaveBeenCalled();
    correrLaAnimacion();
    expect(elegirJuego).toHaveBeenCalledTimes(1);
  });
});

describe("los premios que se sortean", () => {
  it("con 9 premios la carrera, que cuenta hasta 8, no sale ni se enciende nunca, y el sapo, que cuenta 12, sí", async () => {
    const { elegirJuego, panel } = await abrirEspera(9);
    const salieron = new Set<string>();
    const vistasTodas = new Set<string>();
    for (let semilla = 0; semilla < 60; semilla++) {
      const { quedo, vistas } = sortearUna(elegirJuego, panel, semilla);
      salieron.add(quedo);
      for (const g of vistas) vistasTodas.add(g);
    }
    expect(salieron).not.toContain("race");
    expect(vistasTodas).not.toContain("race");
    expect(salieron).toContain("sapo");
    // Y no queda nada fuera por demás: los que no tienen tope siguen saliendo.
    expect(salieron).toContain("wheel");
    expect(salieron).toContain("pinata");
  });

  it("con 13 premios no salen ni la carrera ni el sapo, y nunca la Chovena ni el Teleférico (7 personas)", async () => {
    const { elegirJuego, panel } = await abrirEspera(13);
    const salieron = new Set<string>();
    for (let semilla = 0; semilla < 60; semilla++) salieron.add(sortearUna(elegirJuego, panel, semilla).quedo);
    expect([...salieron].sort()).toEqual(["pinata", "trompo", "wheel"]);
  });

  it("con un solo premio salen todos los que encajan con la gente, la carrera y el sapo también", async () => {
    const { elegirJuego, panel } = await abrirEspera(1);
    const salieron = new Set<string>();
    for (let semilla = 0; semilla < 80; semilla++) salieron.add(sortearUna(elegirJuego, panel, semilla).quedo);
    expect([...salieron].sort()).toEqual(["pinata", "race", "sapo", "trompo", "wheel"]);
  });

  it("si no entra ningún juego, el toque no hace nada y el panel sigue abierto", async () => {
    // Un panel con la carrera, la Chovena y el Teleférico, 7 personas y 9 premios: la carrera no cuenta tantos premios y las otras dos piden más gente. No hay a dónde ir.
    const { mostrarEspera } = await import("./espera");
    const { app } = await import("../state");
    app.drawn = null;
    app.frozen = { names: NOMBRES, listHash: "ab", ts: 1, at: "", prize: "Un premio", round: 1 };
    const elegirJuego = vi.fn();
    const sinSalida = [
      { game: "race", nombre: "Carrera de llamas", rango: "2–200", recomendado: true, elegido: true },
      ...juegos().filter((j) => j.game === "chovena" || j.game === "teleferico"),
    ];
    mostrarEspera(() => 30, { sortear: () => undefined, aMano: () => false, graba: false, juegos: (() => sinSalida) as never, elegirJuego, premios: () => 9 });
    (document.querySelector(".espera [data-juego]") as HTMLButtonElement).click();
    const panel = document.querySelector(".espera-juegos") as HTMLElement;
    botonAzar().click();
    correrLaAnimacion();
    expect(elegirJuego).not.toHaveBeenCalled();
    expect(panel.hidden).toBe(false);
  });
});
