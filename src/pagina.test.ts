// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

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
