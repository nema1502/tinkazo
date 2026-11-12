// @vitest-environment jsdom
import { existsSync, readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { opcionesHtml, tieneCaptura, type OpcionDeJuego } from "./espera";
import { SELECTOR } from "./recomendar";

/**
 * El panel "Elegí el juego" de la espera en grande (`opcionesHtml`, `espera.ts`).
 *
 * Cada opción donde hay captura la muestra: la misma pareja de archivos y la
 * misma selección por tema que el selector de la página (`botones-kit.ts`,
 * clases `sel-osc`/`sel-cla`, archivos `public/juegos/selector/<id>.webp` y
 * `-light.webp`). Si un juego tiene captura se sabe por el catálogo y no por el
 * markup del selector, que cambia de forma. La grilla es compacta: dos
 * columnas en un teléfono, más en pantallas anchas. Lo que no se negocia:
 * `data-game`, `aria-pressed`, el foco por teclado (son botones), la estrella
 * con su texto sr-only y el rango. Y un juego sin captura queda como el botón
 * de texto de siempre, sin caja vacía.
 */

/** Los juegos del selector: cada uno trae sus dos capturas en `public/juegos/selector/`. */
const CON_CAPTURA = [...SELECTOR];

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

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("qué juegos tienen captura, por el catálogo", () => {
  it("los diez juegos del selector la tienen, y la pareja de archivos existe de verdad", () => {
    expect(CON_CAPTURA).toHaveLength(10);
    for (const game of CON_CAPTURA) {
      expect(tieneCaptura(game), game).toBe(true);
      expect(existsSync(`public/juegos/selector/${game}.webp`), `${game}.webp`).toBe(true);
      expect(existsSync(`public/juegos/selector/${game}-light.webp`), `${game}-light.webp`).toBe(true);
    }
  });

  it("los que salieron del selector (De pie, El Trueque) y los desconocidos no la tienen", () => {
    for (const game of ["quien", "trueque", "tombola", "fantasma", ""]) expect(tieneCaptura(game), game).toBe(false);
  });

  it("no mira la página: sale igual sin selector, con los botones de siempre o con las tarjetas nuevas", () => {
    const escenas: Record<string, string> = {
      "sin selector": "",
      "los botones de siempre, con las imágenes adentro": CON_CAPTURA.map(
        (g) => `<button id="g-${g}"><img class="sel-img sel-osc" src="/juegos/selector/${g}.webp" alt="" /><span>${g}</span></button>`,
      ).join(""),
      "las tarjetas nuevas, con la imagen afuera del botón": CON_CAPTURA.map(
        (g) =>
          `<div class="carta" data-juego="${g}"><div class="carta-img"><img class="sel-img sel-osc" src="/juegos/selector/${g}.webp" alt="" /></div>` +
          `<button id="g-${g}" class="carta-elegir"><span>Elegir</span></button></div>`,
      ).join(""),
      "un selector que no trae ninguna imagen": CON_CAPTURA.map((g) => `<button id="g-${g}"><span>${g}</span></button>`).join(""),
    };
    for (const [escena, html] of Object.entries(escenas)) {
      document.body.innerHTML = html;
      const div = opcionesDe(CON_CAPTURA.map((game) => fila({ game })));
      const botones = [...div.querySelectorAll("button")];
      expect(botones, escena).toHaveLength(10);
      for (const b of botones) {
        expect(b.className, `${escena}: ${b.dataset.game}`).toContain("con-captura");
        expect(b.querySelectorAll("img"), `${escena}: ${b.dataset.game}`).toHaveLength(2);
      }
    }
  });
});

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
    expect(sapo.querySelector("small")?.textContent).toBe("6 a 50 personas");
    expect(trompo.querySelector("small")).toBeNull();
  });

  it("el rango dice a quién se refiere: lleva su unidad en cada lengua y no se lee como un marcador", async () => {
    const { setLang } = await import("../i18n");
    try {
      setLang("es");
      expect(opcionesDe([fila()]).querySelector("small")?.textContent).toBe("2 a 200 personas");
      setLang("en");
      expect(opcionesDe([fila()]).querySelector("small")?.textContent).toBe("2 to 200 people");
    } finally {
      setLang("es");
    }
  });

  it("el juego que no encaja con esta cantidad de gente se marca para verse apagado, y los demás no", () => {
    const div = opcionesDe([
      fila({ game: "race", encaja: true }),
      fila({ game: "trompo", nombre: "Trompo", rango: "2–14", recomendado: false, encaja: false }),
      fila({ game: "wheel", nombre: "Ruleta", recomendado: false }),
    ]);
    const [carrera, trompo, ruleta] = [...div.querySelectorAll("button")] as [HTMLButtonElement, HTMLButtonElement, HTMLButtonElement];
    expect(trompo.className).toContain("no-encaja");
    expect(carrera.className).not.toContain("no-encaja");
    // Sin el dato (el juego sin rango claro) se ve como las demás.
    expect(ruleta.className).not.toContain("no-encaja");
    // Sigue siendo un botón que se puede tocar y elegir a mano: apagado no es desactivado.
    expect(trompo.disabled).toBe(false);
    expect(trompo.dataset.game).toBe("trompo");
    expect(trompo.querySelector("small")?.textContent).toBe("2 a 14 personas");
  });

  it("un juego sin captura queda como el botón de texto de siempre, sin caja vacía", () => {
    for (const game of ["quien", "fantasma", "nolugar"]) {
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

/**
 * El CSS, leído sin comentarios y con cualquier corrida de espacios o saltos de línea como un solo espacio: la prueba no
 * depende de la sangría ni del tipo de salto de línea del archivo (en Windows, `core.autocrlf` los vuelve CRLF).
 */
const css = readFileSync("src/styles.css", "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, " ")
  .replace(/\s+/g, " ");

const escapar = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Las declaraciones de cada regla cuyo selector es exactamente `selector`, juntas. */
function declaraciones(selector: string): string {
  const re = new RegExp(`(?:^|[{};]) ?${escapar(selector)} ?\\{([^{}]*)\\}`, "g");
  return [...css.matchAll(re)].map((m) => m[1] ?? "").join(" ");
}

describe("la grilla compacta del panel", () => {
  it("en un teléfono son dos columnas, y más en pantallas anchas", () => {
    expect(declaraciones(".espera-juegos-lista")).toContain("repeat(2, 1fr)");
    expect(css).toMatch(/@media \(min-width: 640px\) \{ \.espera-juegos-lista \{[^}]*repeat\(3, 1fr\)/);
    expect(css).toMatch(/@media \(min-width: 720px\) \{ \.espera-juegos-lista \{[^}]*repeat\(4, 1fr\)/);
  });

  it("el nombre y el rango de cada captura se leen a 16 px, la letra de la sala", () => {
    expect(css).toMatch(/--letra-sec: 16px/);
    for (const selector of [".espera-juego-op.con-captura .espera-juego-nombre", ".espera-juego-op.con-captura small"]) {
      const reglas = declaraciones(selector);
      expect(reglas, selector).toContain("font-size: var(--letra-sec)");
      // Ni un tamaño en píxeles por debajo de 16 en la misma regla.
      for (const [, px] of reglas.matchAll(/font-size: (\d+(?:\.\d+)?)px/g)) expect(Number(px), selector).toBeGreaterThanOrEqual(16);
    }
  });

  it("la captura cambia de tema como en el selector: sel-osc y sel-cla", () => {
    expect(css).toContain(':root[data-theme="dark"] .espera-juego-op .sel-osc { display: block; }');
    expect(css).toContain(':root[data-theme="dark"] .espera-juego-op .sel-cla { display: none; }');
    expect(css).toContain('@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) .espera-juego-op .sel-osc { display: block; }');
  });

  it("en el tema claro la captura oscura se esconde con la fuerza de la regla de la imagen", () => {
    // La imagen se muestra con `.espera-juego-op.con-captura .sel-img`: la que la esconde tiene que llevar las mismas dos
    // clases del botón o gana la imagen y se ven las dos capturas, una sobre la otra.
    expect(declaraciones(".espera-juego-op.con-captura .sel-img")).toContain("display: block");
    expect(declaraciones(".espera-juego-op.con-captura .sel-osc")).toContain("display: none");
    expect(css.indexOf(".espera-juego-op.con-captura .sel-osc {")).toBeGreaterThan(css.indexOf(".espera-juego-op.con-captura .sel-img {"));
  });

  it("en una pantalla apaisada son cinco columnas: dos filas parejas que entran sin recorrerse", () => {
    const apaisada = "@media (min-width: 900px) and (orientation: landscape) {";
    expect(css).toContain(apaisada);
    const regla = css.slice(css.indexOf(apaisada), css.indexOf(apaisada) + 400);
    expect(regla).toMatch(/\.espera-juegos-lista \{[^}]*grid-template-columns: repeat\(5, 1fr\)[^}]*width: min\(100%, 1000px\)/);
    // La barra de Sorprendeme y Listo es tan ancha como la lista.
    expect(regla).toMatch(/\.espera-juegos-acc \{[^}]*width: min\(100%, 1000px\)/);
    // Gana por orden: va después de las de tres y cuatro columnas y después de la regla base de la barra.
    expect(css.indexOf(apaisada)).toBeGreaterThan(css.indexOf("repeat(4, 1fr)"));
    expect(css.indexOf(apaisada)).toBeGreaterThan(css.indexOf(".espera-juegos-acc {"));
  });

  it("en el proyector el panel crece: más ancho, nombre y rango a 24 px y botones más grandes", () => {
    const proyector = "@media (min-width: 1600px) and (min-height: 900px) {";
    expect(css).toContain(proyector);
    const regla = css.slice(css.indexOf(proyector), css.indexOf(proyector) + 700);
    expect(regla).toMatch(/\.espera-juegos-lista, \.espera-juegos-acc \{ width: min\(100%, 1400px\); \}/);
    expect(regla).toMatch(/\.espera-juego-op\.con-captura \.espera-juego-nombre, \.espera-juego-op\.con-captura small \{ font-size: 24px; \}/);
    expect(regla).toMatch(/\.espera-juegos \.ghost \{ font-size: 22px; min-height: 56px; \}/);
    // Y gana por orden sobre las cinco columnas de la pantalla apaisada.
    expect(css.indexOf(proyector)).toBeGreaterThan(css.indexOf("@media (min-width: 900px) and (orientation: landscape) {"));
  });

  it("un escalón intermedio para los proyectores comunes: 1180 px de ancho, 20 px de letra y botones de 18 px", () => {
    // 1280 x 720 y 1366 x 768 entran; 1362 x 632 no (le faltan 68 px de alto) y queda como está.
    const escalon = "@media (min-width: 1180px) and (min-height: 700px) and (orientation: landscape) {";
    expect(css).toContain(escalon);
    const inicio = css.indexOf(escalon);
    const regla = css.slice(inicio, css.indexOf("@media", inicio + escalon.length));
    expect(regla).toMatch(/\.espera-juegos-lista, \.espera-juegos-acc \{ width: min\(100%, 1180px\); \}/);
    expect(regla).toMatch(/\.espera-juego-op\.con-captura \.espera-juego-nombre, \.espera-juego-op\.con-captura small \{ font-size: 20px; \}/);
    expect(regla).toMatch(/\.espera-juegos-sub \{ font-size: 18px; \}/);
    expect(regla).toMatch(/\.espera-juegos \.ghost \{ font-size: 18px; min-height: 52px; \}/);
    // Gana por orden sobre las cinco columnas, la regla base de los botones y la de la leyenda, y la del proyector (24 px)
    // lo pisa a su vez: el de 1600 x 900 no cambia.
    expect(inicio).toBeGreaterThan(css.indexOf("@media (min-width: 900px) and (orientation: landscape) {"));
    expect(inicio).toBeGreaterThan(css.indexOf(".espera-juegos .ghost { min-height: 48px; font-size: 16px; }"));
    expect(inicio).toBeGreaterThan(css.indexOf(".espera-juegos-sub { margin-top: -4px;"));
    expect(inicio).toBeLessThan(css.indexOf("@media (min-width: 1600px) and (min-height: 900px) {"));
  });

  it("el fondo del panel es de papel lleno: la espera de atrás no se transparenta ni la barra de abajo la corta", () => {
    const panel = declaraciones(".espera-juegos");
    expect(panel).toContain("background: var(--paper)");
    expect(panel).not.toContain("color-mix");
    expect(declaraciones(".espera-juegos-acc")).toContain("background: var(--paper)");
  });

  it("lo que se lleva a la vista no queda debajo de la barra: el panel deja el alto de la barra como margen de abajo", () => {
    expect(declaraciones(".espera-juegos")).toContain("scroll-padding-bottom: var(--barra, 96px)");
  });

  it("la tarjeta encendida se marca entera con un contorno, y la que cayó se distingue del paso de la luz", () => {
    expect(declaraciones('.espera-juego-op[aria-pressed="true"]')).toMatch(/outline: 4px solid var\(--purple\)/);
    const quedo = declaraciones(".espera-juego-op.azar-quedo");
    expect(quedo).toContain("outline: 4px solid var(--ink)");
    expect(quedo).toContain("box-shadow: 6px 6px 0 var(--ink)");
    expect(quedo).toContain("transform: scale(1.04)");
    // Gana por orden sobre el contorno de la tarjeta encendida, que tiene su misma fuerza.
    expect(css.indexOf(".espera-juego-op.azar-quedo {")).toBeGreaterThan(css.indexOf('.espera-juego-op[aria-pressed="true"] {'));
    // Con movimiento reducido, la misma marca sin la escala.
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{ \.espera-juego-op\.azar-quedo \{ transform: none;/);
  });

  it("mientras gira se apagan las tarjetas que no pueden salir y el botón en marcha, y la tarjeta que no encaja se ve apagada", () => {
    expect(declaraciones(".espera-juegos.girando .espera-juego-op:not([data-en-juego])")).toContain("opacity: 0.4");
    expect(declaraciones('.espera-juegos [data-azar][aria-disabled="true"]')).toMatch(/opacity: 0\.6; cursor: default/);
    expect(declaraciones(".espera-juego-op.no-encaja .sel-img")).toContain("opacity: 0.3");
    expect(declaraciones('.espera-juego-op.no-encaja:not([aria-pressed="true"]) small')).toContain("color: var(--muted)");
  });

  it("la captura del juego que no encaja se apaga más en el tema claro: 0,3 por defecto y 0,45 solo en el oscuro, en las dos reglas del tema", () => {
    // Por defecto (tema claro) 0,3, y sin ninguna otra declaración de opacidad en esa regla.
    expect(declaraciones(".espera-juego-op.no-encaja .sel-img").trim()).toBe("opacity: 0.3;");
    // El oscuro por elección explícita, y el oscuro del sistema con la guarda que respeta una elección clara.
    expect(declaraciones(':root[data-theme="dark"] .espera-juego-op.no-encaja .sel-img').trim()).toBe("opacity: 0.45;");
    expect(css).toContain('@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) .espera-juego-op.no-encaja .sel-img { opacity: 0.45; } }');
    // Las del tema van después de la general, o la general las pisaría.
    const general = css.indexOf(".espera-juego-op.no-encaja .sel-img {");
    expect(css.indexOf(':root[data-theme="dark"] .espera-juego-op.no-encaja .sel-img {')).toBeGreaterThan(general);
    expect(css.indexOf('@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) .espera-juego-op.no-encaja .sel-img')).toBeGreaterThan(general);
  });

  it("la barra de Sorprendeme y Listo queda por encima de la tarjeta donde cayó la luz", () => {
    const zBarra = /z-index: (\d+)/.exec(declaraciones(".espera-juegos-acc"));
    const zQuedo = /z-index: (\d+)/.exec(declaraciones(".espera-juego-op.azar-quedo"));
    expect(zBarra, "la barra lleva z-index").not.toBeNull();
    expect(zQuedo, "la tarjeta donde cayó lleva z-index").not.toBeNull();
    expect(Number(zBarra?.[1])).toBeGreaterThan(Number(zQuedo?.[1]));
  });

  it("la línea que explica la estrella se lee a 16 px", () => {
    expect(declaraciones(".espera-juegos-sub")).toContain("font-size: var(--letra-sec)");
  });

  it("Sorprendeme y Listo quedan pegados abajo, a la vista aunque la lista se recorra", () => {
    const barra = declaraciones(".espera-juegos-acc");
    expect(barra).toContain("position: sticky");
    expect(barra).toContain("bottom: 0");
    // Las sombras de las tarjetas que pasan por debajo no se asoman por los costados: una sombra de papel las tapa, y la
    // barra no es más ancha que la lista, así que a 390 px no desborda la pantalla.
    expect(barra).toContain("box-shadow: -6px 0 0 var(--paper), 6px 0 0 var(--paper)");
    expect(barra).toContain("width: min(100%, 760px)");
    // A ras del borde de abajo: sin relleno del panel por debajo de la barra, o la lista se asoma por esa franja.
    expect(declaraciones(".espera-juegos")).toMatch(/padding: 16px 16px 0[; ]/);
  });
});

describe("el nombre del juego en la barra de arriba de la espera", () => {
  it("se esconde solo en una pantalla baja y angosta: con ancho (1024 x 560) se queda", () => {
    expect(css).toContain("@media (max-height: 560px) and (max-width: 999px) { .espera-juego.en-barra .espera-juego-n { display: none; } }");
    // La regla de la pantalla baja, la de solo el alto, ya no lo esconde.
    const baja = css.indexOf("@media (max-height: 560px) { .espera { padding-top: 64px;");
    expect(baja).toBeGreaterThan(-1);
    const regla = css.slice(baja, css.indexOf("@media", baja + 10));
    expect(regla).not.toContain("display: none");
    expect(regla).toContain(".espera-juego-n { font-size: clamp(16px, 3.6vh, 22px); }");
  });
});
