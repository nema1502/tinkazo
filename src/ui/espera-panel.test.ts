// @vitest-environment jsdom
import { existsSync, readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

/**
 * La vista previa en movimiento (issue #116): en el panel de elección, la captura estática puede dejar su lugar unos
 * segundos a la miniatura del propio juego (el canvas del juego, chico, sin audio y sin interacción), montada recién
 * cuando la tarjeta entra en la vista y pausada al salir, con la captura volviendo a su lugar al terminar. Nada se
 * baja ni se monta fuera de vista, con movimiento reducido no hay nada en movimiento, y un juego sin vista registrada
 * queda con su captura de siempre (la elección y el orden no cambian).
 *
 * Las funciones se cargan aparte (`await import`) para que una función que falta no tire abajo las pruebas de arriba:
 * el fallo de RED tiene que ser el de la función que falta y no un módulo roto entero.
 */
describe("la vista previa en movimiento del panel de elección", () => {
  const espera = (): Promise<typeof import("./espera")> => import("./espera");

  /** Lo que un juego registrado dejó hecho: cuántas veces se lo llamó y con qué marco. */
  interface Llamadas {
    montar: number;
    pausar: number;
    reanudar: number;
    parar: number;
    marcos: HTMLCanvasElement[];
    control: { pausar(): void; reanudar(): void; parar(): void };
  }
  /** Un juego con vista previa que anota todo lo que el panel le pide. */
  const vista = (game: string, segundos = 4): { v: import("./espera").VistaPreviaJuego; llamadas: Llamadas } => {
    const llamadas: Llamadas = {
      montar: 0,
      pausar: 0,
      reanudar: 0,
      parar: 0,
      marcos: [],
      control: { pausar: () => llamadas.pausar++, reanudar: () => llamadas.reanudar++, parar: () => llamadas.parar++ },
    };
    return {
      v: { game, segundos, montar: (marco: HTMLCanvasElement) => (llamadas.montar++, llamadas.marcos.push(marco), llamadas.control) },
      llamadas,
    };
  };

  /** Un IntersectionObserver falso: anota lo observado y deja disparar la vista a mano. */
  const ioFalso = (() => {
    class IOFalso {
      static ultimo: IOFalso | null = null;
      static cortado = false;
      private enObs: Set<Element> = new Set();
      constructor(private cb: IntersectionObserverCallback, _opts?: IntersectionObserverInit) {
        IOFalso.ultimo = this;
        IOFalso.cortado = false;
      }
      observe(el: Element): void {
        this.enObs.add(el);
      }
      unobserve(el: Element): void {
        this.enObs.delete(el);
      }
      disconnect(): void {
        this.enObs.clear();
        IOFalso.cortado = true;
      }
      /** La vista del navegador, a mano: `en` dice si está a la vista y `parte` la fracción visible. */
      aviso(tarjetas: Element[], en: boolean, parte: number): void {
        const vistas = tarjetas.filter((t) => this.enObs.has(t));
        this.cb(vistas.map((t) => ({ target: t, isIntersecting: en, intersectionRatio: parte } as IntersectionObserverEntry)), this as unknown as IntersectionObserver);
      }
    }
    return IOFalso;
  })();

  /** El panel como lo arma la espera: la lista de tarjetas dentro del panel. */
  const panelDe = (juegos: OpcionDeJuego[]): HTMLElement => {
    const panel = document.createElement("div");
    panel.innerHTML = `<div class="espera-juegos-lista">${opcionesHtml(juegos)}</div>`;
    document.body.append(panel);
    return panel;
  };
  const tarjetaDe = (panel: HTMLElement, game: string): HTMLElement =>
    panel.querySelector(`[data-game="${game}"]`) as HTMLElement;

  /** En el entorno de pruebas no hay IntersectionObserver ni matchMedia: los dos entran con su doble, a mano. */
  let reducido = false;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("IntersectionObserver", ioFalso);
    vi.stubGlobal("matchMedia", (pregunta: string) => ({ matches: pregunta.includes("prefers-reduced-motion") && reducido }));
    ioFalso.ultimo = null;
    ioFalso.cortado = false;
  });
  afterEach(async () => {
    // El registro de vistas es del módulo: sin limpieza, una prueba contamina a la siguiente.
    const m = await espera();
    m.pararVistasPrevias();
    for (const game of ["race", "sapo", "fantasma"]) m.quitarVistaPrevia(game);
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("sin vista registrada no cambia nada: la tarjeta queda con su pareja de capturas y sin canvas", async () => {
    const m = await espera();
    const panel = panelDe([fila()]);
    m.armarVistasPrevias(panel);
    expect(ioFalso.ultimo, "sin vistas registradas ni siquiera hay que mirar la vista").toBeNull();
    const tarjeta = tarjetaDe(panel, "race");
    expect(tarjeta.querySelectorAll("img")).toHaveLength(2);
    expect(tarjeta.querySelector("canvas")).toBeNull();
  });

  it("la vista registrada a mano se encuentra por el juego y se la puede quitar", async () => {
    const m = await espera();
    const { v, llamadas } = vista("race");
    expect(m.previaDe("race")).toBeNull();
    m.registrarVistaPrevia(v);
    expect(m.previaDe("race")?.montar).toBe(v.montar);
    // Un segundo registro del mismo juego reemplaza (no se acumulan dos).
    const otra = vista("race");
    m.registrarVistaPrevia(otra.v);
    expect(m.previaDe("race")?.montar).toBe(otra.v.montar);
    m.pararVistasPrevias();
    expect(llamadas.montar, "registrar no monta nada por sí solo").toBe(0);
    m.quitarVistaPrevia("race");
    expect(m.previaDe("race")).toBeNull();
  });

  it("nada pesado fuera de vista: con la tarjeta fuera de la vista la vista previa no se monta", async () => {
    const m = await espera();
    const { v, llamadas } = vista("race");
    m.registrarVistaPrevia(v);
    const panel = panelDe([fila(), fila({ game: "sapo", nombre: "Sapo", rango: "6–50", recomendado: false })]);
    m.armarVistasPrevias(panel);
    expect(ioFalso.ultimo).not.toBeNull();
    vi.advanceTimersByTime(60_000);
    expect(llamadas.montar, "montar solo cuando entra en vista").toBe(0);
    expect(tarjetaDe(panel, "race").querySelector("canvas")).toBeNull();
  });

  it("solo el juego en vista monta su miniatura: canvas chico, capturas escondidas, sin interacción ni audio", async () => {
    const m = await espera();
    const race = vista("race");
    const sapo = vista("sapo");
    m.registrarVistaPrevia(race.v);
    m.registrarVistaPrevia(sapo.v);
    const panel = panelDe([fila(), fila({ game: "sapo", nombre: "Sapo", rango: "6–50", recomendado: false })]);
    m.armarVistasPrevias(panel);
    ioFalso.ultimo!.aviso([tarjetaDe(panel, "race")], true, 1);
    expect(race.llamadas.montar, "la tarjeta en vista monta").toBe(1);
    expect(sapo.llamadas.montar, "la que no está en vista, no").toBe(0);
    const canvas = tarjetaDe(panel, "race").querySelector("canvas") as HTMLCanvasElement;
    expect(canvas.className).toContain("sel-img");
    // La misma caja que la captura: el CSS que la mide va por la clase, y la acción de elegir no cambia de lugar.
    expect(canvas.getAttribute("width")).toBe("320");
    expect(canvas.getAttribute("height")).toBe("180");
    // Como la captura: decorativa (el nombre ya lo dice el botón) y no toca nada.
    expect(canvas.getAttribute("aria-hidden")).toBe("true");
    for (const img of tarjetaDe(panel, "race").querySelectorAll("img")) {
      expect(img.style.display, "la captura se esconde mientras la miniatura corre").toBe("none");
    }
    // La elección no cambia: la tarjeta sigue siendo la misma, marcada como estaba.
    expect(tarjetaDe(panel, "race").dataset.game).toBe("race");
    expect(tarjetaDe(panel, "race").getAttribute("aria-pressed")).toBe("false");
    expect(ioFalso.cortado, "sigue mirando la vista: al salir tiene que pausar").toBe(false);
  });

  it("al salir de la vista se pausa y al volver se reanuda, sin montar de nuevo", async () => {
    const m = await espera();
    const race = vista("race");
    m.registrarVistaPrevia(race.v);
    const panel = panelDe([fila()]);
    m.armarVistasPrevias(panel);
    const tarjeta = tarjetaDe(panel, "race");
    ioFalso.ultimo!.aviso([tarjeta], true, 1);
    ioFalso.ultimo!.aviso([tarjeta], false, 0);
    expect(race.llamadas.pausar).toBe(1);
    ioFalso.ultimo!.aviso([tarjeta], true, 1);
    expect(race.llamadas.reanudar).toBe(1);
    expect(race.llamadas.montar, "una sola montura por apertura del panel").toBe(1);
  });

  it("la vista es corta: al cumplirse sus segundos vuelve la captura y se suelta la miniatura", async () => {
    const m = await espera();
    const race = vista("race", 4);
    m.registrarVistaPrevia(race.v);
    const panel = panelDe([fila()]);
    m.armarVistasPrevias(panel);
    const tarjeta = tarjetaDe(panel, "race");
    ioFalso.ultimo!.aviso([tarjeta], true, 1);
    expect(race.llamadas.parar).toBe(0);
    vi.advanceTimersByTime(4_000);
    expect(race.llamadas.parar).toBe(1);
    expect(tarjeta.querySelector("canvas"), "el canvas vuelve a soltarse").toBeNull();
    for (const img of tarjeta.querySelectorAll("img")) {
      expect(img.style.display, "la captura vuelve a su lugar, como estaba: sin estilo puesto a mano").toBe("");
    }
  });

  it("cerrar el panel corta todo: se para la vista, se suelta el canvas y el observador queda desconectado", async () => {
    const m = await espera();
    const race = vista("race", 30);
    m.registrarVistaPrevia(race.v);
    const panel = panelDe([fila()]);
    m.armarVistasPrevias(panel);
    const tarjeta = tarjetaDe(panel, "race");
    ioFalso.ultimo!.aviso([tarjeta], true, 1);
    m.pararVistasPrevias();
    expect(race.llamadas.parar).toBe(1);
    expect(ioFalso.cortado).toBe(true);
    expect(tarjeta.querySelector("canvas")).toBeNull();
    for (const img of tarjeta.querySelectorAll("img")) expect(img.style.display).toBe("");
    // Reabrir el panel (otro armado) no deja nada colgado de lo anterior.
    ioFalso.ultimo!.aviso([tarjeta], true, 1);
    expect(race.llamadas.montar, "desconectado no monto más").toBe(1);
  });

  it("con movimiento reducido no hay nada en movimiento: la captura se queda", async () => {
    reducido = true;
    const m = await espera();
    const race = vista("race");
    m.registrarVistaPrevia(race.v);
    const panel = panelDe([fila()]);
    m.armarVistasPrevias(panel);
    // Sin observador ni montura: el armado se cae antes de mirar la vista, y la captura queda.
    expect(ioFalso.ultimo).toBeNull();
    expect(race.llamadas.montar).toBe(0);
    expect(tarjetaDe(panel, "race").querySelector("canvas")).toBeNull();
  });

  it("sin IntersectionObserver (un navegador sin la API) no se arma nada: queda la captura", async () => {
    // Sin la API de vista (el entorno de pruebas, un navegador viejo): acá vale el comportamiento con la API ausente.
    vi.unstubAllGlobals();
    expect(globalThis.IntersectionObserver).toBeUndefined();
    const m = await espera();
    const race = vista("race");
    m.registrarVistaPrevia(race.v);
    const panel = panelDe([fila()]);
    m.armarVistasPrevias(panel);
    expect(tarjetaDe(panel, "race").querySelector("canvas")).toBeNull();
    vi.advanceTimersByTime(60_000);
    expect(race.llamadas.montar).toBe(0);
  });

  it("la miniatura entra con la misma regla que la captura: el CSS que la mide conoce la clase (la acción no se tapa)", () => {
    // El canvas vive con la clase `sel-img` dentro de su tarjeta: la regla que mide la captura (ancho completo, 16/9,
    // fondo del campo) es la que lo mide. La tarjeta no crece, la barra de abajo no se corre y la acción principal
    // queda donde estaba, en el celular también.
    const regla = declaraciones(".espera-juego-op.con-captura .sel-img");
    expect(regla).toContain("width: 100%");
    expect(regla).toContain("aspect-ratio: 16 / 9");
    // Y la marca propia de la miniatura no arma su propia regla de medida: no hay nada que se salga del marco.
    expect(css).not.toMatch(/\.previa-viva\s*\{[^}]*width:/);
  });
});
