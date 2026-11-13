// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * El tema forzado en las páginas de lectura: con `?theme=light|dark` cada
 * captura (los `<picture>` con un `<source>` por esquema) tiene que terminar
 * pidiendo la versión del tema pedido, aunque el sistema esté en el otro.
 *
 * El script corre con el HTML ya abierto: si solo cambia el `media` del
 * `<source>`, el navegador puede haber pedido ya la versión del sistema y
 * quedarse con esa (las capturas quedaban sin cargar, se vio con sapo,
 * trompo y chovena en juegos.html).
 */

/** Una captura como las de juegos.html: source claro e img de base (oscuro). */
const captura = (id: string, clara: string, oscura: string): string =>
  `<article><picture id="${id}"><source srcset="${clara}" media="(prefers-color-scheme: light)" /><img src="${oscura}" width="900" height="506" loading="lazy" alt="Prueba" /></picture></article>`;

const CAPTURAS = [
  { id: "sapo", clara: "/juegos/sapo-light.webp", oscura: "/juegos/sapo.webp" },
  { id: "trompo", clara: "/juegos/trompo-light.webp", oscura: "/juegos/trompo.webp" },
  { id: "chovena", clara: "/juegos/chovena-light.webp", oscura: "/juegos/chovena.webp" },
] as const;

const montar = (tema?: string): void => {
  document.body.innerHTML = CAPTURAS.map((c) => captura(c.id, c.clara, c.oscura)).join("\n");
  window.history.replaceState(null, "", tema ? `/?theme=${tema}` : "/");
  document.documentElement.removeAttribute("data-theme");
};

const cargarPagina = async (): Promise<void> => {
  vi.resetModules();
  await import("./pagina");
};

const fijar = async (tema?: string): Promise<void> => {
  montar(tema);
  await cargarPagina();
};

const fuentes = (picture: HTMLPictureElement): Element[] => [...picture.querySelectorAll("source")];

afterEach(() => {
  vi.resetModules();
  document.body.innerHTML = "";
  window.history.replaceState(null, "", "/");
});

describe("el tema forzado en las páginas de lectura", () => {
  it("con ?theme=light cada captura pide la versión clara", async () => {
    await fijar("light");
    expect(document.documentElement.dataset.theme).toBe("light");
    for (const c of CAPTURAS) {
      const picture = document.getElementById(c.id) as HTMLPictureElement;
      // Sin fuente por esquema: la que queda en pie es la del tema.
      expect(fuentes(picture), c.id).toEqual([]);
      expect(picture.querySelector("img")?.getAttribute("src"), c.id).toBe(c.clara);
    }
  });

  it("con ?theme=dark cada captura pide la versión oscura", async () => {
    await fijar("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    for (const c of CAPTURAS) {
      const picture = document.getElementById(c.id) as HTMLPictureElement;
      expect(fuentes(picture), c.id).toEqual([]);
      expect(picture.querySelector("img")?.getAttribute("src"), c.id).toBe(c.oscura);
    }
  });

  it("sin tema forzado no se toca ninguna captura", async () => {
    await fijar();
    expect(document.documentElement.dataset.theme).toBeUndefined();
    for (const c of CAPTURAS) {
      const picture = document.getElementById(c.id) as HTMLPictureElement;
      expect(fuentes(picture), c.id).toHaveLength(1);
      expect(picture.querySelector("img")?.getAttribute("src"), c.id).toBe(c.oscura);
    }
  });

  it("un tema desconocido no se toca ninguna captura", async () => {
    await fijar("sepia");
    expect(document.documentElement.dataset.theme).toBeUndefined();
    for (const c of CAPTURAS) {
      const picture = document.getElementById(c.id) as HTMLPictureElement;
      // Queda el `<source>` original y el `img` de base, como en el HTML.
      expect(fuentes(picture), c.id).toHaveLength(1);
      expect(picture.querySelector("img")?.getAttribute("src"), c.id).toBe(c.oscura);
    }
  });
});

/**
 * El hover vivo de la página de juegos (`pagina.ts` + `estilos-atencion.ts`):
 * la captura de la tarjeta bajo el mouse se mueve suave dentro de su marco
 * (Ken Burns, `styles.css`) mientras el hover dura; en pantalla táctil no hay
 * hover, y no aplica. La clase la pone y la saca el JS (`hover-vivo`); el CSS
 * hace el movimiento.
 */

const h = vi.hoisted(() => ({ reduce: false, hover: true }));

describe("el hover vivo de las tarjetas de juego", () => {
  beforeEach(() => {
    vi.resetModules();
    document.body.innerHTML = "";
    h.reduce = false;
    h.hover = true;
    vi.stubGlobal("matchMedia", (q: string) => ({
      matches: q.includes("prefers-reduced-motion") ? h.reduce : q.includes("(hover: hover)") ? h.hover : false,
      media: q,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  it("la página de juegos conecta el hover vivo a sus tarjetas .juego", async () => {
    // Las tarjetas van antes de importar la página: el cableado se hace al arrancar.
    document.body.innerHTML = ["race", "sapo"]
      .map((g) => `<article class="juego"><picture><img src="/juegos/${g}.webp" alt="${g}" /></picture></article>`)
      .join("");
    await import("./pagina");
    const [race, sapo] = [...document.querySelectorAll(".juego")] as [HTMLElement, HTMLElement];
    race.dispatchEvent(new Event("pointerenter"));
    expect(race.classList.contains("hover-vivo")).toBe(true);
    // Solo la tarjeta hovered: la otra queda quieta.
    expect(sapo.classList.contains("hover-vivo")).toBe(false);
    race.dispatchEvent(new Event("pointerleave"));
    expect(race.classList.contains("hover-vivo")).toBe(false);
  });

  it("en pantalla táctil no hay hover, y no aplica", async () => {
    h.hover = false;
    document.body.innerHTML = `<article class="juego"><img src="/juegos/race.webp" alt="race" /></article>`;
    await import("./pagina");
    const tarjeta = document.querySelector(".juego") as HTMLElement;
    tarjeta.dispatchEvent(new Event("pointerenter"));
    expect(tarjeta.classList.contains("hover-vivo")).toBe(false);
  });

  it("el CSS del movimiento respeta el marco (la captura no se sale de su tarjeta) y movimiento reducido", () => {
    const css = readFileSync("src/styles.css", "utf8");
    // El marco recorta: la captura escalada no pisa las tarjetas vecinas.
    expect(css).toContain(".portada-juegos a.hover-vivo { overflow: clip; }");
    // Con movimiento reducido, la animación se apaga.
    expect(css).toContain("@keyframes ken-burns-atencion");
    expect(css).toContain(".portada-juegos a.hover-vivo .pj-img, .juego.hover-vivo img { animation: none; }");
    // En pantalla táctil no aplica: todo el bloque vive dentro de (hover: hover).
    expect(css).toContain("@media (hover: hover) {");
    expect(css).toContain(".portada-juegos a.hover-vivo .pj-img, .juego.hover-vivo img { animation: ken-burns-atencion");
  });
});
