// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RANGOS } from "./recomendar";
import { QUEDA_MS, elegirAlAzar, enRueda, type JuegoAzar } from "./azar";

/**
 * El botón Sorprendeme del panel Elegí el juego (`espera.ts`): al tocarlo,
 * elige un juego que encaje con la cantidad de personas y con los premios,
 * recorre las tarjetas con la animación de `azar.ts` y después hace lo mismo
 * que tocar la tarjeta del juego elegido: se lo pasa a `elegirJuego` y cierra
 * el panel, una vez que la tarjeta se quedó marcada un rato (`QUEDA_MS`).
 * Con movimiento reducido, o con una lista que se recorre por dentro, no hay
 * ruleta: queda el elegido directo, con la misma marca y la misma espera.
 */

const h = vi.hoisted(() => ({ reduce: false, semilla: 0, elegido: "race", armarQr: vi.fn((..._a: unknown[]): any => Promise.resolve(undefined)) }));

vi.mock("../sound", () => ({ beep: () => undefined, note: (n: number) => n }));
vi.mock("./vista-grande", () => ({ rechazarGrande: () => undefined }));
vi.mock("./pantalla-completa", () => ({ soltarPantallaCompleta: () => undefined }));
vi.mock("./espectador", () => ({ armarQrDeEspectador: (...a: unknown[]) => h.armarQr(...a) }));

const NOMBRES = ["Ana", "Beto", "Cami", "Dani", "Eva", "Fito", "Gaby"];

interface Opcion {
  game: string;
  nombre: string;
  rango: string;
  recomendado: boolean;
  elegido: boolean;
  encaja?: boolean;
}

/** Los juegos del panel, en el orden en que los recomienda esta gente (7 personas: la Chovena y el Teleférico no encajan). */
const BASE = [
  { game: "race", nombre: "Carrera de llamas", rango: "2–200", recomendado: true },
  { game: "sapo", nombre: "Sapo", rango: "2–40", recomendado: true },
  { game: "trompo", nombre: "Trompo", rango: "2–14", recomendado: true },
  { game: "chovena", nombre: "Chovena", rango: "8–80", recomendado: false },
  { game: "teleferico", nombre: "Teleférico", rango: "16–200", recomendado: false },
  { game: "wheel", nombre: "Ruleta", rango: "2–200", recomendado: false },
  { game: "pinata", nombre: "Piñata", rango: "2–200", recomendado: false },
];

const juegos = (base: typeof BASE = BASE): Opcion[] => base.map((j) => ({ ...j, elegido: j.game === h.elegido }));

function armarPagina(): void {
  // El selector de la página queda detrás de la espera. El panel no lo mira: sabe si un juego tiene captura por el catálogo.
  document.body.innerHTML = ["race", "sapo", "chovena", "wheel"]
    .map(
      (g) =>
        `<button id="g-${g}"><img class="sel-img sel-osc" src="/juegos/selector/${g}.webp" alt="" /><img class="sel-img sel-cla" src="/juegos/selector/${g}-light.webp" alt="" /><span>${g}</span></button>`,
    )
    .join("");
}

/** El catálogo numérico que la espera le arma a `azar.ts`, el mismo que arma el botón (con un solo premio no se quita ninguno). */
function catalogo(base: typeof BASE = BASE): JuegoAzar[] {
  return juegos(base).map((j) => ({ game: j.game, rango: RANGOS[j.game as keyof typeof RANGOS] ?? {} }));
}

interface Abierta {
  elegirJuego: ReturnType<typeof vi.fn>;
  sortear: ReturnType<typeof vi.fn>;
  panel: HTMLElement;
}

/**
 * Prende la ronda (`app.frozen`) y abre la espera con un `Sorteo` de prueba y el panel de juegos abierto. `premios`: cuántos
 * se sortean. `extra.nombres`: la gente de la lista. `extra.juegos`: los juegos que ofrece el panel.
 */
async function abrirEspera(premios = 1, extra: { nombres?: string[]; juegos?: typeof BASE } = {}): Promise<Abierta> {
  const { mostrarEspera } = await import("./espera");
  const { app } = await import("../state");
  app.drawn = null;
  app.frozen = { names: extra.nombres ?? NOMBRES, listHash: "ab", ts: 1, at: "", prize: "Un premio", round: 1 };
  app.game = "race";
  const elegirJuego = vi.fn((g: string) => {
    // Como `elegirJuego` de freeze.ts: queda elegido, y `juegos()` lo refleja.
    h.elegido = g;
  });
  const sortear = vi.fn();
  mostrarEspera(() => 30, { sortear, aMano: () => false, graba: false, juegos: (() => juegos(extra.juegos)) as never, elegirJuego, premios: () => premios });
  // La espera trae su botón de "Cambiar de juego": el toque abre el panel.
  (document.querySelector(".espera [data-juego]") as HTMLButtonElement).click();
  const panel = document.querySelector(".espera-juegos") as HTMLElement;
  return { elegirJuego, sortear, panel };
}

/** `scrollIntoView` no existe en jsdom: se anota con qué se lo llama. */
const llevadas = vi.fn();
let rectOriginal: typeof Element.prototype.getBoundingClientRect;

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  armarPagina();
  h.reduce = false;
  h.semilla = 0;
  h.elegido = "race";
  llevadas.mockClear();
  (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView = llevadas;
  rectOriginal = Element.prototype.getBoundingClientRect;
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
  Element.prototype.getBoundingClientRect = rectOriginal;
  delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  document.body.innerHTML = "";
});

const resaltadas = (panel: HTMLElement): string[] =>
  [...panel.querySelectorAll("[data-game][aria-pressed='true']")].map((b) => (b as HTMLElement).dataset.game ?? "");

const botonAzar = (): HTMLButtonElement => document.querySelector(".espera-juegos [data-azar]") as HTMLButtonElement;

/** Recorre los timers hasta que la ruleta termina y el panel se cierra (la ruleta y la marca de llegada, unos cuatro segundos). */
function correrLaAnimacion(): void {
  for (let i = 0; i < 80 && vi.getTimerCount() > 1; i++) vi.advanceTimersByTime(100);
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
  for (let i = 0; i < 160 && !panel.hidden; i++) {
    for (const g of resaltadas(panel)) vistas.add(g);
    vi.advanceTimersByTime(50);
  }
  const ultima = elegirJuego.mock.calls[elegirJuego.mock.calls.length - 1];
  return { quedo: String(ultima?.[0] ?? ""), vistas };
}

/**
 * Cuántos temporizadores quedan una vez asentada la espera. Al abrirse deja unos cortos que vencen enseguida: quedan el reloj
 * de la cuenta y poco más, y es contra eso que se compara lo que deja o no deja la ruleta.
 */
function temporizadoresAsentados(): number {
  vi.advanceTimersByTime(1000);
  return vi.getTimerCount();
}

describe("el pase de tarjetas del panel Elegí el juego", () => {
  /** La tarjeta marcada como viva del pase. */
  const viva = (panel: HTMLElement): number =>
    [...panel.querySelectorAll<HTMLElement>("[data-game]")].findIndex((t) => t.classList.contains("pase-viva"));

  it("tras ~6 s sin tocar el panel, las tarjetas entran en pase y se recorren en bucle", async () => {
    const { panel } = await abrirEspera();
    vi.advanceTimersByTime(5900);
    expect(panel.classList.contains("pase")).toBe(false);
    vi.advanceTimersByTime(100);
    expect(panel.classList.contains("pase")).toBe(true);
    // Una sola tarjeta adelante, y la anterior yéndose hacia atrás.
    const primera = viva(panel);
    expect(primera).toBeGreaterThanOrEqual(0);
    expect(panel.querySelectorAll(".pase-viva")).toHaveLength(1);
    expect(panel.querySelectorAll(".pase-atras")).toHaveLength(1);
    // ~1,5 s por paso, en bucle: la siguiente adelante y la que estaba, hacia atrás.
    vi.advanceTimersByTime(1500);
    const tarjetas = [...panel.querySelectorAll<HTMLElement>("[data-game]")];
    expect(viva(panel)).toBe((primera + 1) % tarjetas.length);
    expect(tarjetas[primera]?.classList.contains("pase-atras")).toBe(true);
  });

  it("una interacción corta el pase y el panel vuelve al estado normal", async () => {
    const { panel } = await abrirEspera();
    vi.advanceTimersByTime(6000);
    expect(panel.classList.contains("pase")).toBe(true);
    panel.dispatchEvent(new Event("pointermove"));
    expect(panel.classList.contains("pase")).toBe(false);
    expect(panel.querySelectorAll(".pase-viva, .pase-atras")).toHaveLength(0);
    // La elección real no la toca el pase: una sola tarjeta con aria-pressed, la elegida.
    const marcadas = panel.querySelectorAll<HTMLElement>("[data-game][aria-pressed='true']");
    expect(marcadas).toHaveLength(1);
    expect(marcadas[0]?.dataset.game).toBe("race");
    // Y sin más interacción, el pase vuelve a armarse a los ~6 s.
    vi.advanceTimersByTime(6000);
    expect(panel.classList.contains("pase")).toBe(true);
  });

  it("con la ruleta de Sorprendeme corriendo, el pase no arranca: la de ella manda", async () => {
    const { panel } = await abrirEspera();
    (panel.querySelector("[data-azar]") as HTMLButtonElement).click();
    // La inactividad de ~6 s alcanza de sobra mientras la ruleta recorre (~2,5 s).
    vi.advanceTimersByTime(3000);
    expect(panel.classList.contains("pase")).toBe(false);
    correrLaAnimacion();
    // La ruleta terminó y eligió: el panel se cerró, nunca hubo pase.
    expect(panel.hidden).toBe(true);
    expect(panel.classList.contains("pase")).toBe(false);
  });

  it("al cerrar el panel y al cerrar la espera, el pase queda parado sin marcas puestas", async () => {
    const { panel } = await abrirEspera();
    vi.advanceTimersByTime(6000);
    expect(panel.classList.contains("pase")).toBe(true);
    // Cerrar el panel apaga el pase: sin marcas ni bucles colgados.
    (document.querySelector("[data-juegos-listo]") as HTMLButtonElement).click();
    expect(panel.classList.contains("pase")).toBe(false);
    expect(panel.querySelectorAll(".pase-viva, .pase-atras")).toHaveLength(0);
    // Y al volver a abrirlo, el pase se rearma: a los ~6 s vuelve a entrar.
    (document.querySelector(".espera [data-juego]") as HTMLButtonElement).click();
    expect(panel.hidden).toBe(false);
    vi.advanceTimersByTime(6000);
    expect(panel.classList.contains("pase")).toBe(true);
  });

  it("con movimiento reducido no hay pase", async () => {
    h.reduce = true;
    const { panel } = await abrirEspera();
    vi.advanceTimersByTime(12000);
    expect(panel.classList.contains("pase")).toBe(false);
  });
});

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
    // Va junto a Listo, en la barra pegada abajo: los dos quedan a la vista aunque la lista de juegos se recorra.
    const barra = document.querySelector(".espera-juegos .espera-juegos-acc");
    expect(barra?.querySelector("[data-azar]")).toBe(boton);
    expect(barra?.querySelector("[data-juegos-listo]")).not.toBeNull();
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

    // El mismo camino que tocar la tarjeta: se elige y el panel se cierra. El de partida (la carrera) no sale.
    const esperado = elegirAlAzar(catalogo(), NOMBRES.length, h.semilla, "race").elegido?.game;
    expect(elegirJuego).toHaveBeenCalledTimes(1);
    expect(elegirJuego).toHaveBeenCalledWith(esperado);
    // Con 7 personas, la Chovena (8–80) y el Teleférico (16–200) no pueden salir.
    expect(["chovena", "teleferico"]).not.toContain(elegirJuego.mock.calls[0]?.[0]);
    expect(panel.hidden).toBe(true);
    // Y el nombre del juego queda pintado en la espera.
    const nombre = document.querySelector(".espera-juego-n b");
    expect(nombre?.textContent).toBe(juegos().find((j) => j.game === elegirJuego.mock.calls[0]?.[0])?.nombre);
  });

  it("con movimiento reducido no hay ruleta: elige directo, y la tarjeta se queda marcada lo mismo antes de cerrar", async () => {
    h.reduce = true;
    const { elegirJuego, panel } = await abrirEspera();
    botonAzar().click();
    const esperado = elegirAlAzar(catalogo(), NOMBRES.length, h.semilla, "race").elegido?.game;
    expect(elegirJuego).toHaveBeenCalledWith(esperado);
    // Sin recorrido: una sola tarjeta marcada, la elegida, con la marca de llegada y sin la de giro.
    expect(resaltadas(panel)).toEqual([esperado]);
    expect(panel.querySelector(".azar-quedo")?.getAttribute("data-game")).toBe(esperado);
    expect(panel.classList.contains("girando")).toBe(false);
    // La espera es la misma: el panel no se cierra de golpe.
    expect(panel.hidden).toBe(false);
    vi.advanceTimersByTime(QUEDA_MS - 1);
    expect(panel.hidden).toBe(false);
    vi.advanceTimersByTime(1);
    expect(panel.hidden).toBe(true);
    // Y la lista no se movió: con movimiento reducido el desplazamiento es sin animación.
    expect(llevadas).not.toHaveBeenCalled();
  });
});

describe("mientras gira", () => {
  it("las semillas de la prueba arrancan la ruleta en tarjetas distintas de la elegida de partida", () => {
    // Si todas arrancaran en la carrera, la prueba de abajo no vería nunca dos tarjetas encendidas.
    const arranques = new Set(SEMILLAS.map((s) => catalogo()[elegirAlAzar(catalogo(), NOMBRES.length, s, "race").recorrido[0]?.indice ?? 0]?.game));
    expect(arranques.size).toBeGreaterThanOrEqual(3);
    expect([...arranques].filter((g) => g !== "race").length).toBeGreaterThanOrEqual(2);
  });

  it.each(SEMILLAS)("con la semilla %i queda una sola tarjeta encendida en cada paso y termina en el elegido", async (semilla) => {
    h.semilla = semilla;
    const { elegirJuego, panel } = await abrirEspera();
    // De partida está elegida la carrera: es la tarjeta violeta.
    expect(resaltadas(panel)).toEqual(["race"]);
    const esperado = elegirAlAzar(catalogo(), NOMBRES.length, semilla, "race");
    botonAzar().click();
    const ultimo = esperado.recorrido.length - 1;
    esperado.recorrido.forEach((paso, i) => {
      // La que estaba elegida de partida se apagó: solo brilla la que recorre la ruleta.
      expect(resaltadas(panel), `paso ${i}`).toEqual([catalogo()[paso.indice]?.game]);
      if (i < ultimo) {
        expect(elegirJuego, `paso ${i}`).not.toHaveBeenCalled();
        vi.advanceTimersByTime(paso.pausa);
      }
    });
    // La luz cayó: se elige ya y la tarjeta queda marcada. El panel sigue ahí hasta que la sala la vea.
    expect(elegirJuego).toHaveBeenCalledTimes(1);
    expect(elegirJuego).toHaveBeenCalledWith(esperado.elegido?.game);
    expect(panel.querySelector(".azar-quedo")?.getAttribute("data-game")).toBe(esperado.elegido?.game);
    expect(resaltadas(panel)).toEqual([esperado.elegido?.game]);
    expect(panel.hidden).toBe(false);
    vi.advanceTimersByTime(QUEDA_MS - 1);
    expect(panel.hidden).toBe(false);
    vi.advanceTimersByTime(1);
    expect(panel.hidden).toBe(true);
    expect(elegirJuego).toHaveBeenCalledTimes(1);
  });

  it("el elegido de partida se apaga al arrancar y queda una sola encendida, también en el primer cuadro", async () => {
    h.semilla = 5;
    const { panel } = await abrirEspera();
    expect(panel.querySelector("[data-game='race']")?.getAttribute("aria-pressed")).toBe("true");
    botonAzar().click();
    expect(resaltadas(panel)).toHaveLength(1);
    // La carrera no es el arranque de esta semilla: tiene que haberse apagado.
    expect(resaltadas(panel)).not.toContain("race");
  });

  it("el panel avisa que gira: las tarjetas que no pueden salir se distinguen y el botón queda en marcha", async () => {
    h.semilla = 5;
    const { panel } = await abrirEspera();
    expect(panel.classList.contains("girando")).toBe(false);
    expect(botonAzar().hasAttribute("aria-disabled")).toBe(false);
    botonAzar().click();
    vi.advanceTimersByTime(300);
    expect(panel.classList.contains("girando")).toBe(true);
    expect(botonAzar().getAttribute("aria-disabled")).toBe("true");
    // Con 7 personas la Chovena y el Teleférico no pueden salir: son las únicas sin la marca de "en juego".
    const sinMarca = [...panel.querySelectorAll<HTMLElement>("[data-game]")].filter((c) => c.dataset.enJuego === undefined).map((c) => c.dataset.game);
    expect(sinMarca.sort()).toEqual(["chovena", "teleferico"]);
    correrLaAnimacion();
    // Al cerrar no queda nada de la marca de giro.
    expect(panel.classList.contains("girando")).toBe(false);
    expect(botonAzar().hasAttribute("aria-disabled")).toBe(false);
    expect(panel.querySelectorAll("[data-en-juego], .azar-quedo")).toHaveLength(0);
  });

  it("con la lista entera a la vista no se la mueve a cada paso: la ruleta no llama a scrollIntoView", async () => {
    h.semilla = 5;
    const { panel } = await abrirEspera();
    // jsdom no tiene diseño y los dos altos valen 0: la prueba pasaría sola. Se fijan iguales, a propósito, para que el panel
    // no se recorra (con la lista que se recorre, la ruleta sí mueve la lista: ver más abajo).
    Object.defineProperty(panel, "scrollHeight", { value: 600, configurable: true });
    Object.defineProperty(panel, "clientHeight", { value: 600, configurable: true });
    botonAzar().click();
    correrLaAnimacion();
    expect(panel.hidden).toBe(true);
    expect(llevadas).not.toHaveBeenCalled();
  });

  it("la luz da la vuelta: con las tarjetas en una grilla, el recorrido sigue el orden del ángulo y no el de la lista", async () => {
    // Siete tarjetas en cuatro columnas: jsdom no tiene diseño, así que cada tarjeta dice dónde está según su lugar.
    Element.prototype.getBoundingClientRect = function (this: Element): DOMRect {
      const caja = (left: number, top: number, width: number, height: number): DOMRect =>
        ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }) as DOMRect;
      if (this.classList.contains("espera-juegos-lista")) return caja(0, 0, 800, 320);
      const lista = this.parentElement;
      if (this.classList.contains("espera-juego-op") && lista?.classList.contains("espera-juegos-lista")) {
        const i = [...lista.children].indexOf(this);
        return caja((i % 4) * 200, Math.floor(i / 4) * 160, 190, 150);
      }
      return rectOriginal.call(this);
    };
    h.semilla = 12345;
    const { panel } = await abrirEspera();
    const centroDe = (i: number): { x: number; y: number } => ({ x: (i % 4) * 200 + 95, y: Math.floor(i / 4) * 160 + 75 });
    const enOrden = enRueda(catalogo(), (j) => centroDe(catalogo().findIndex((c) => c.game === j.game)), { x: 400, y: 160 });
    // Con 7 personas la luz pasa por las que encajan, en este orden de vuelta.
    expect(enOrden.map((j) => j.game)).not.toEqual(catalogo().map((j) => j.game));
    const esperado = elegirAlAzar(enOrden, NOMBRES.length, h.semilla, "race");
    const vistas: string[] = [];
    botonAzar().click();
    for (const paso of esperado.recorrido) {
      vistas.push(resaltadas(panel)[0] ?? "");
      vi.advanceTimersByTime(paso.pausa);
    }
    expect(vistas).toEqual(esperado.recorrido.map((p) => enOrden[p.indice]?.game));
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

  it("un segundo toque en Sorprendeme mientras gira no arranca otra ruleta", async () => {
    h.semilla = 5;
    const { elegirJuego, panel } = await abrirEspera();
    botonAzar().click();
    vi.advanceTimersByTime(300);
    const timers = vi.getTimerCount();
    h.semilla = 99;
    botonAzar().click();
    expect(vi.getTimerCount()).toBe(timers);
    correrLaAnimacion();
    expect(elegirJuego).toHaveBeenCalledTimes(1);
    expect(elegirJuego).toHaveBeenCalledWith(elegirAlAzar(catalogo(), NOMBRES.length, 5, "race").elegido?.game);
    expect(panel.hidden).toBe(true);
  });
});

describe("el elegido se queda marcado donde cayó", () => {
  it("la tarjeta lleva la marca de llegada desde el último paso y la mantiene el tiempo que se pide", async () => {
    h.semilla = 5;
    const { panel } = await abrirEspera();
    const esperado = elegirAlAzar(catalogo(), NOMBRES.length, 5, "race");
    botonAzar().click();
    const hastaLlegar = esperado.recorrido.slice(0, -1).reduce((a, p) => a + p.pausa, 0);
    vi.advanceTimersByTime(hastaLlegar - 1);
    expect(panel.querySelector(".azar-quedo")).toBeNull();
    vi.advanceTimersByTime(1);
    expect(panel.querySelector(".azar-quedo")?.getAttribute("data-game")).toBe(esperado.elegido?.game);
    // La pausa de un paso de la ruleta (medio segundo) no alcanza: la marca dura más que eso.
    vi.advanceTimersByTime(600);
    expect(panel.hidden).toBe(false);
    expect(panel.querySelector(".azar-quedo")).not.toBeNull();
    vi.advanceTimersByTime(QUEDA_MS - 600);
    expect(panel.hidden).toBe(true);
  });

  it("un toque en otra tarjeta o en Sorprendeme mientras se queda marcada no cambia nada", async () => {
    h.semilla = 5;
    const { elegirJuego, panel } = await abrirEspera();
    const esperado = elegirAlAzar(catalogo(), NOMBRES.length, 5, "race");
    botonAzar().click();
    vi.advanceTimersByTime(esperado.recorrido.slice(0, -1).reduce((a, p) => a + p.pausa, 0) + 200);
    expect(elegirJuego).toHaveBeenCalledTimes(1);
    (panel.querySelector("[data-game='trompo']") as HTMLButtonElement).click();
    botonAzar().click();
    expect(elegirJuego).toHaveBeenCalledTimes(1);
    expect(panel.querySelector(".azar-quedo")?.getAttribute("data-game")).toBe(esperado.elegido?.game);
  });

  /** Un panel que mide más de lo que se ve: `visible` es el alto de la pantalla, y cada tarjeta mide 150 px (dos filas y media son 375). */
  function recorrerse(panel: HTMLElement, visible: number): void {
    Object.defineProperty(panel, "scrollHeight", { value: 900, configurable: true });
    Object.defineProperty(panel, "clientHeight", { value: visible, configurable: true });
    for (const tarjeta of panel.querySelectorAll(".espera-juego-op")) Object.defineProperty(tarjeta, "offsetHeight", { value: 150, configurable: true });
  }

  it.each([375, 700])("con %i px a la vista (dos filas y media o más) la ruleta corre aunque la lista se recorra, y la lista sigue a la luz sin quedar debajo de la barra", async (visible) => {
    h.semilla = 5;
    const { elegirJuego, panel } = await abrirEspera();
    // Un celular parado: se ven más de dos filas y media de tarjetas.
    recorrerse(panel, visible);
    botonAzar().click();
    expect(panel.classList.contains("girando")).toBe(true);
    const esperado = elegirAlAzar(catalogo(), NOMBRES.length, 5, "race");
    // Cada paso lleva la tarjeta encendida a la vista, lo justo (las del medio no se mueven si ya se ven).
    expect(llevadas).toHaveBeenLastCalledWith({ block: "nearest" });
    const pasos = esperado.recorrido.length;
    correrLaAnimacion();
    expect(llevadas.mock.calls.filter(([o]) => o.block === "nearest")).toHaveLength(pasos);
    // Y al caer, la tarjeta final se lleva al medio una sola vez.
    expect(llevadas.mock.calls.filter(([o]) => o.block === "center")).toEqual([[{ block: "center", behavior: "smooth" }]]);
    expect(elegirJuego).toHaveBeenCalledWith(esperado.elegido?.game);
    expect(panel.hidden).toBe(true);
  });

  it.each([250, 340, 374])("con %i px a la vista (menos de dos filas y media) no hay ruleta: queda marcado el elegido y se lo lleva a la vista, sin temblor", async (visible) => {
    h.semilla = 5;
    const { elegirJuego, panel } = await abrirEspera();
    // Un celular acostado o un zoom de 200 %: el panel mide más de lo que se ve, y entra una fila o poco más. A 340 px caben
    // dos filas justas de 150 pero no el título que va arriba: es el caso del celular acostado a 844 x 390.
    recorrerse(panel, visible);
    botonAzar().click();
    const esperado = elegirAlAzar(catalogo(), NOMBRES.length, 5, "race").elegido?.game;
    // Ya eligió y no pasó por ninguna otra tarjeta: una sola marcada, la de llegada, sin la marca de giro.
    expect(elegirJuego).toHaveBeenCalledWith(esperado);
    expect(resaltadas(panel)).toEqual([esperado]);
    expect(panel.querySelector(".azar-quedo")?.getAttribute("data-game")).toBe(esperado);
    expect(panel.classList.contains("girando")).toBe(false);
    // Se lleva a la vista una sola vez: la tarjeta final, al medio, con animación.
    expect(llevadas).toHaveBeenCalledTimes(1);
    expect(llevadas).toHaveBeenCalledWith({ block: "center", behavior: "smooth" });
    expect(panel.hidden).toBe(false);
    vi.advanceTimersByTime(QUEDA_MS);
    expect(panel.hidden).toBe(true);
    expect(llevadas).toHaveBeenCalledTimes(1);
  });
});

describe("al volver a abrir el panel, el juego elegido se ve", () => {
  /** El panel mide más de lo que se ve cuando `alto` pasa de `visible`. En jsdom no hay diseño: los dos valen 0 si no se fijan. */
  function fijarAlto(panel: HTMLElement, alto: number, visible: number): void {
    Object.defineProperty(panel, "scrollHeight", { value: alto, configurable: true });
    Object.defineProperty(panel, "clientHeight", { value: visible, configurable: true });
  }
  /** Cierra el panel con Listo y lo vuelve a abrir con Cambiar de juego, sin contar lo que se movió antes. */
  function volverAAbrir(panel: HTMLElement): void {
    (panel.querySelector("[data-juegos-listo]") as HTMLButtonElement).click();
    expect(panel.hidden).toBe(true);
    llevadas.mockClear();
    (document.querySelector(".espera [data-juego]") as HTMLButtonElement).click();
    expect(panel.hidden).toBe(false);
  }

  it("con la lista recorriéndose por dentro lleva la tarjeta elegida a la vista, lo justo, una sola vez", async () => {
    h.elegido = "wheel";
    const { panel } = await abrirEspera();
    fijarAlto(panel, 900, 400);
    volverAAbrir(panel);
    expect(llevadas).toHaveBeenCalledTimes(1);
    expect(llevadas).toHaveBeenCalledWith({ block: "nearest" });
    const llevada = llevadas.mock.contexts[0] as HTMLElement;
    expect(llevada.dataset.game).toBe("wheel");
    expect(llevada.getAttribute("aria-pressed")).toBe("true");
  });

  it("lleva la que quedó elegida después de cambiarla, no la de partida", async () => {
    const { panel } = await abrirEspera();
    fijarAlto(panel, 900, 400);
    (panel.querySelector("[data-game='pinata']") as HTMLButtonElement).click();
    expect(h.elegido).toBe("pinata");
    volverAAbrir(panel);
    expect((llevadas.mock.contexts[0] as HTMLElement).dataset.game).toBe("pinata");
  });

  it("con la lista entera a la vista (el alto de adentro igual al de afuera, fijado a propósito) no la mueve", async () => {
    h.elegido = "wheel";
    const { panel } = await abrirEspera();
    fijarAlto(panel, 600, 600);
    volverAAbrir(panel);
    expect(llevadas).not.toHaveBeenCalled();
  });

  it("sin ningún juego marcado no mueve nada ni falla", async () => {
    h.elegido = "ninguno";
    const { panel } = await abrirEspera();
    fijarAlto(panel, 900, 400);
    volverAAbrir(panel);
    expect(llevadas).not.toHaveBeenCalled();
  });
});

describe("si nace el número con la ruleta andando", () => {
  it("a mitad de la ruleta: no elige nada, no queda ningún temporizador suyo y el show sigue con el juego de partida", async () => {
    h.semilla = 5;
    const { nacioElNumero } = await import("./espera");
    const { elegirJuego, sortear, panel } = await abrirEspera();
    const base = temporizadoresAsentados();
    // El pase armado por la apertura del panel es un temporizador suyo (estilos-atencion);
    // el toque en Sorprendeme lo para (la ruleta manda) y arma el suyo: el total no cambia.
    botonAzar().click();
    vi.advanceTimersByTime(700);
    expect(vi.getTimerCount()).toBe(base);
    expect(panel.classList.contains("girando")).toBe(true);

    nacioElNumero();

    // El sorteo arrancó solo y la lista se cerró sin que la ruleta termine de elegir.
    expect(sortear).toHaveBeenCalledTimes(1);
    expect(panel.hidden).toBe(true);
    expect(panel.classList.contains("girando")).toBe(false);
    // Sin temporizadores de la ruleta ni del pase: ni a que se venzan vuelve a elegir.
    expect(vi.getTimerCount()).toBe(base - 1);
    vi.advanceTimersByTime(10_000);
    expect(elegirJuego).not.toHaveBeenCalled();
    // El juego sigue siendo el de partida, y el nombre de la espera también.
    expect(h.elegido).toBe("race");
    expect(document.querySelector(".espera-juego-n b")?.textContent).toBe("Carrera de llamas");
  });

  it("con la tarjeta ya marcada: el juego que la sala veía es el que se cuenta, y el panel se cierra", async () => {
    h.semilla = 5;
    const { nacioElNumero } = await import("./espera");
    const { elegirJuego, sortear, panel } = await abrirEspera();
    const base = temporizadoresAsentados();
    const esperado = elegirAlAzar(catalogo(), NOMBRES.length, 5, "race");
    // El toque en Sorprendeme para el pase del panel (la ruleta manda) y arma el suyo: el total no cambia.
    botonAzar().click();
    vi.advanceTimersByTime(esperado.recorrido.slice(0, -1).reduce((a, p) => a + p.pausa, 0) + 300);
    expect(panel.querySelector(".azar-quedo")).not.toBeNull();

    nacioElNumero();

    expect(sortear).toHaveBeenCalledTimes(1);
    expect(panel.hidden).toBe(true);
    // Sin temporizadores de la ruleta ni del pase.
    expect(vi.getTimerCount()).toBe(base - 1);
    expect(elegirJuego).toHaveBeenCalledTimes(1);
    expect(h.elegido).toBe(esperado.elegido?.game);
    vi.advanceTimersByTime(10_000);
    expect(elegirJuego).toHaveBeenCalledTimes(1);
  });
});

describe("el juego que ya estaba elegido", () => {
  it("nunca sale otra vez: cada toque cambia de juego", async () => {
    const { elegirJuego, panel } = await abrirEspera();
    for (let semilla = 0; semilla < 60; semilla++) {
      const antes = h.elegido;
      const { quedo } = sortearUna(elegirJuego, panel, semilla);
      expect(quedo, `semilla ${semilla}`).not.toBe(antes);
      expect(h.elegido).toBe(quedo);
    }
  });

  it("con la semilla 7 y 7 personas, que antes caía en la carrera estando elegida, ahora cae en otro", async () => {
    const { elegirJuego, panel } = await abrirEspera();
    expect(h.elegido).toBe("race");
    expect(sortearUna(elegirJuego, panel, 7).quedo).not.toBe("race");
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
});

describe("cuando no hay a dónde ir, Sorprendeme no se ofrece", () => {
  it("si no entra ningún juego, el botón no se ve y el panel sigue siendo el de siempre", async () => {
    // Un panel con la carrera, la Chovena y el Teleférico, 7 personas y 9 premios: la carrera no cuenta tantos premios y las otras dos piden más gente.
    const sinSalida = BASE.filter((j) => ["race", "chovena", "teleferico"].includes(j.game));
    const { elegirJuego, panel } = await abrirEspera(9, { juegos: sinSalida });
    expect(botonAzar().hidden).toBe(true);
    expect(panel.hidden).toBe(false);
    // Un toque a pesar de todo (por teclado, por un lector de pantalla) no hace nada.
    botonAzar().click();
    correrLaAnimacion();
    expect(elegirJuego).not.toHaveBeenCalled();
    expect(panel.classList.contains("girando")).toBe(false);
    // Listo sigue ahí.
    expect((document.querySelector(".espera-juegos [data-juegos-listo]") as HTMLElement).hidden).toBe(false);
  });

  it("con más de doscientas personas no cabe ningún juego: el botón no se ve", async () => {
    const muchas = Array.from({ length: 250 }, (_, i) => `Persona ${i + 1}`);
    const { elegirJuego, panel } = await abrirEspera(1, { nombres: muchas });
    expect(botonAzar().hidden).toBe(true);
    botonAzar().click();
    correrLaAnimacion();
    expect(elegirJuego).not.toHaveBeenCalled();
    expect(panel.hidden).toBe(false);
  });

  it("con doscientas justas sí hay a dónde ir, y con 201 ya no", async () => {
    const juegosLargos = BASE.filter((j) => ["race", "wheel", "pinata"].includes(j.game));
    const dosCientas = Array.from({ length: 200 }, (_, i) => `Persona ${i + 1}`);
    await abrirEspera(1, { nombres: dosCientas, juegos: juegosLargos });
    expect(botonAzar().hidden).toBe(false);
    document.body.innerHTML = "";
    vi.resetModules();
    armarPagina();
    await abrirEspera(1, { nombres: [...dosCientas, "Una más"], juegos: juegosLargos });
    expect(botonAzar().hidden).toBe(true);
  });

  it("con un solo juego posible no se ve: la luz se quedaría quieta en la misma tarjeta", async () => {
    // Siete personas y un panel con la carrera, la Chovena y el Teleférico: solo la carrera encaja.
    const { elegirJuego, panel } = await abrirEspera(1, { juegos: BASE.filter((j) => ["race", "chovena", "teleferico"].includes(j.game)) });
    expect(botonAzar().hidden).toBe(true);
    botonAzar().click();
    vi.advanceTimersByTime(5000);
    expect(elegirJuego).not.toHaveBeenCalled();
    expect(panel.querySelectorAll("[aria-pressed='true']")).toHaveLength(1);
  });

  it("con dos posibles se ve, y alterna: cada toque pasa al otro", async () => {
    const dos = BASE.filter((j) => ["race", "sapo", "chovena"].includes(j.game));
    const { elegirJuego, panel } = await abrirEspera(1, { juegos: dos });
    expect(botonAzar().hidden).toBe(false);
    expect(sortearUna(elegirJuego, panel, 3).quedo).toBe("sapo");
    expect(sortearUna(elegirJuego, panel, 3).quedo).toBe("race");
  });
});

describe("lo que dice el panel de cada juego", () => {
  it("el rango lleva su unidad, y se lee en la lengua de la pantalla", async () => {
    const { setLang } = await import("../i18n");
    setLang("es");
    await abrirEspera();
    const rangos = [...document.querySelectorAll(".espera-juegos [data-game='race'] small, .espera-juegos [data-game='sapo'] small")].map((s) => s.textContent);
    expect(rangos).toEqual(["2 a 200 personas", "2 a 40 personas"]);
    document.body.innerHTML = "";
    vi.resetModules();
    armarPagina();
    const en = await import("../i18n");
    en.setLang("en");
    await abrirEspera();
    expect([...document.querySelectorAll(".espera-juegos [data-game='sapo'] small")].map((s) => s.textContent)).toEqual(["2 to 40 people"]);
  });

  it("una línea bajo el título explica la estrella con la cantidad de gente", async () => {
    const { setLang } = await import("../i18n");
    setLang("es");
    await abrirEspera();
    const sub = document.querySelector(".espera-juegos .espera-juegos-sub");
    expect(sub?.textContent?.replace(/\s+/g, " ").trim()).toBe("★ Los que mejor andan con 7 personas");
    // La estrella de la línea es decoración: las tarjetas ya dicen Recomendado para el lector de pantalla.
    expect(sub?.querySelector("i")?.getAttribute("aria-hidden")).toBe("true");
    // Va entre el título y la lista.
    const hijos = [...(document.querySelector(".espera-juegos")?.children ?? [])].map((c) => c.className);
    expect(hijos.indexOf("espera-juegos-sub")).toBe(hijos.indexOf("espera-juegos-t") + 1);
    expect(hijos.indexOf("espera-juegos-lista")).toBe(hijos.indexOf("espera-juegos-sub") + 1);
  });

  it("en inglés la línea dice Best with 7 people, y sin ninguna recomendada no hay línea", async () => {
    const { setLang } = await import("../i18n");
    setLang("en");
    await abrirEspera();
    expect(document.querySelector(".espera-juegos-sub")?.textContent?.replace(/\s+/g, " ").trim()).toBe("★ Best with 7 people");
    document.body.innerHTML = "";
    vi.resetModules();
    armarPagina();
    await abrirEspera(1, { juegos: BASE.filter((j) => !j.recomendado) });
    expect(document.querySelector(".espera-juegos-sub")).toBeNull();
  });

  it("la palabra azar no aparece en lo que ve la gente, tampoco en las líneas nuevas", async () => {
    const { setLang } = await import("../i18n");
    setLang("es");
    await abrirEspera();
    expect(document.querySelector(".espera-juegos")?.textContent).not.toMatch(/azar/i);
    expect(document.querySelector(".espera-juegos")?.textContent).not.toMatch(/[«»;]/);
  });
});

describe("el QR del espectador durante la espera", () => {
  beforeEach(() => h.armarQr.mockClear());

  /** Los datos con los que la espera pidió armar el QR del espectador. */
  const pedidos = (): Array<{ capa: HTMLElement; datos: Record<string, unknown> }> =>
    (h.armarQr.mock.calls as unknown as Array<[HTMLElement, Record<string, unknown>]>).map(([capa, datos]) => ({ capa, datos }));

  it("arma el QR del espectador con la ronda, el juego, el pace, los ganadores y los nombres del sello", async () => {
    await abrirEspera(2, { nombres: ["Ana", "Beto", "Cami"] });
    const p = pedidos();
    expect(p).toHaveLength(1);
    expect(p[0]?.capa.classList.contains("espera")).toBe(true);
    expect(p[0]?.datos).toEqual({ r: 1, g: "race", p: "normal", w: 2, z: "Un premio", n: ["Ana", "Beto", "Cami"] });
    // El lugar del QR está en la espera, junto a la cuenta, aunque el dibujo llegue después.
    expect(document.querySelector(".espera .espera-qr img")).toBeTruthy();
  });

  it("en la demo no hay QR: no es un sorteo real", async () => {
    history.replaceState(null, "", "/?demo=1");
    try {
      await abrirEspera();
      expect(pedidos()).toHaveLength(0);
      expect(document.querySelector(".espera .espera-qr")).toBeNull();
    } finally {
      history.replaceState(null, "", "/");
    }
  });
});
