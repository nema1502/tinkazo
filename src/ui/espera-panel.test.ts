// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { opcionesHtml, type OpcionDeJuego } from "./espera";

/**
 * El panel "Elegí el juego" de la espera en grande (`opcionesHtml`, `espera.ts`).
 *
 * Cada opción donde hay captura la muestra: la misma pareja de archivos y la
 * misma selección por tema que el selector de la página (`botones-kit.ts`,
 * clases `sel-osc`/`sel-cla`, archivos `public/juegos/selector/<id>.webp` y
 * `-light.webp`). La grilla es compacta: dos columnas en un teléfono, más en
 * pantallas anchas. Lo que no se negocia: `data-game`, `aria-pressed`, el foco
 * por teclado (son botones), la estrella con su texto sr-only y el rango. Y un
 * juego sin captura queda como el botón de texto de siempre, sin caja vacía.
 */

/** Los juegos con captura: los mismos diez archivos de `public/juegos/selector/`. */
const CON_CAPTURA = ["chovena", "guajojo", "oruro", "pinata", "race", "sapo", "teleferico", "toborochi", "trompo", "wheel"];

/**
 * La página mínima que `opcionesHtml` lee: el selector, cuya fuente de verdad
 * para "este juego tiene captura" es su botón `#g-<id>` con las dos imágenes.
 */
function armarSelector(conCaptura: string[]): void {
  document.body.innerHTML = conCaptura
    .map(
      (g) =>
        `<button id="g-${g}">` +
        `<img class="sel-img sel-osc" src="/juegos/selector/${g}.webp" width="320" height="180" alt="" />` +
        `<img class="sel-img sel-cla" src="/juegos/selector/${g}-light.webp" width="320" height="180" alt="" />` +
        `<span>${g}</span></button>`,
    )
    .join("") +
    // Un juego del selector sin captura (como De pie o El Trueque hoy).
    `<button id="g-fantasma"><span>phantom</span></button>`;
}

const fila = (over: Partial<OpcionDeJuego> = {}): OpcionDeJuego => ({
  game: "race",
  nombre: "Carrera de llamas",
  rango: "2–200",
  recomendado: true,
  elegido: false,
  ...over,
});

/** El markup de las opciones, bajado a un nodo para mirarlo como lo mira el navegador. */
function opcionesDe(juegos: OpcionDeJuego[]): HTMLDivElement {
  const div = document.createElement("div");
  div.innerHTML = opcionesHtml(juegos);
  return div;
}

beforeEach(() => armarSelector(CON_CAPTURA));

describe("las opciones del panel Elegí el juego", () => {
  it("cada opción con captura lleva la pareja del selector, una por tema", () => {
    const b = opcionesDe([fila()]).querySelector("button") as HTMLButtonElement;
    expect(b.className).toContain("espera-juego-op");
    expect(b.className).toContain("con-captura");
    const imgs = [...b.querySelectorAll("img")];
    expect(imgs.map((i) => i.className)).toEqual(["sel-img sel-osc", "sel-img sel-cla"]);
    expect(imgs.map((i) => i.getAttribute("src"))).toEqual([
      "/juegos/selector/race.webp",
      "/juegos/selector/race-light.webp",
    ]);
    // Mismas medidas que las del selector: la captura manda, el texto es de apoyo.
    expect(imgs.every((i) => i.getAttribute("width") === "320" && i.getAttribute("height") === "180")).toBe(true);
    // Decorativa: el nombre ya lo dice el botón.
    expect(imgs.every((i) => i.getAttribute("alt") === "")).toBe(true);
  });

  it("el contrato no se negocia: data-game, aria-pressed, la estrella con su sr-only y el rango", () => {
    const div = opcionesDe([
      fila(),
      fila({ game: "sapo", nombre: "Sapo", rango: "6–50", recomendado: false }),
      fila({ game: "trompo", nombre: "Trompo", rango: "", recomendado: true, elegido: true }),
    ]);
    const [carrera, sapo, trompo] = [...div.querySelectorAll("button")] as [HTMLButtonElement, HTMLButtonElement, HTMLButtonElement];
    expect(carrera.dataset.game).toBe("race");
    expect(carrera.getAttribute("aria-pressed")).toBe("false");
    expect(trompo.dataset.game).toBe("trompo");
    expect(trompo.getAttribute("aria-pressed")).toBe("true");
    const estrella = carrera.querySelector("i") as HTMLElement;
    expect(estrella.textContent).toBe("★");
    expect(estrella.getAttribute("aria-hidden")).toBe("true");
    expect(carrera.querySelector(".sr-only")?.textContent).toContain("Recomendado");
    expect(sapo.querySelector("i")).toBeNull();
    expect(sapo.querySelector(".sr-only")).toBeNull();
    expect(sapo.querySelector("small")?.textContent).toBe("6–50");
    expect(trompo.querySelector("small")).toBeNull();
  });

  it("un juego sin captura queda como el botón de texto de siempre, sin caja vacía", () => {
    for (const game of ["fantasma", "nolugar"]) {
      const b = opcionesDe([fila({ game, nombre: "De pie" })]).querySelector("button") as HTMLButtonElement;
      expect(b.querySelector("img")).toBeNull();
      expect(b.className).toContain("espera-juego-op");
      expect(b.className).not.toContain("con-captura");
      expect(b.querySelector(".espera-juego-nombre")?.textContent).toContain("De pie");
      expect(b.dataset.game).toBe(game);
      expect(b.getAttribute("aria-pressed")).toBe("false");
    }
  });
});

describe("la grilla compacta del panel", () => {
  const css = readFileSync("src/styles.css", "utf8");

  it("en un teléfono son dos columnas, y más en pantallas anchas", () => {
    const regla = css.slice(css.indexOf(".espera-juegos-lista {"), css.indexOf("}", css.indexOf(".espera-juegos-lista {")));
    expect(regla).toContain("repeat(2, 1fr)");
    expect(css).toMatch(/@media \(min-width: 640px\) \{[^@]*\.espera-juegos-lista \{[^}]*repeat\(3, 1fr\)/);
    expect(css).toMatch(/@media \(min-width: 720px\) \{[^@]*\.espera-juegos-lista \{[^}]*repeat\(4, 1fr\)/);
  });

  it("la captura cambia de tema como en el selector: sel-osc y sel-cla", () => {
    expect(css).toContain(':root[data-theme="dark"] .espera-juego-op .sel-osc { display: block; }');
    expect(css).toContain('@media (prefers-color-scheme: dark) {\n    :root:not([data-theme="light"]) .espera-juego-op .sel-osc { display: block; }');
  });
});
