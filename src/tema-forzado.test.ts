// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { fijarElTema } from "./tema-forzado";

/**
 * La portada tiene la misma captura con dos versiones que las páginas de lectura: el `<source>` claro y el `img`
 * oscuro. Con `?theme=` la herramienta tiene que dejarla con la versión del tema, no con la del sistema.
 */

const HERO = `<a class="hero-shot"><picture>
  <source srcset="/juegos/race-light.webp" media="(prefers-color-scheme: light)" />
  <img src="/juegos/race.webp" width="900" height="506" alt="" />
</picture></a>`;

beforeEach(() => {
  document.body.innerHTML = HERO;
  delete document.documentElement.dataset.theme;
});

describe("el tema forzado en la captura de la portada", () => {
  it("claro: la imagen pasa a la versión clara y el source ya no decide", () => {
    fijarElTema("light");
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(document.querySelector("picture source")).toBeNull();
    expect(document.querySelector("img")?.getAttribute("src")).toBe("/juegos/race-light.webp");
  });

  it("oscuro: queda la imagen de base y sin source", () => {
    fijarElTema("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.querySelector("picture source")).toBeNull();
    expect(document.querySelector("img")?.getAttribute("src")).toBe("/juegos/race.webp");
  });

  it("sin tema forzado, o con uno que no existe, no toca nada", () => {
    fijarElTema(null);
    fijarElTema("sepia");
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(document.querySelector("picture source")).not.toBeNull();
  });

  it("la herramienta lo usa con la captura de la portada, y las páginas de lectura el mismo", () => {
    const main = readFileSync("src/main.ts", "utf8");
    expect(main).toMatch(/import \{ fijarElTema \} from "\.\/tema-forzado"/);
    expect(main).toMatch(/fijarElTema\(themeParam\)/);
    const pagina = readFileSync("src/pagina.ts", "utf8");
    expect(pagina).toMatch(/from "\.\/tema-forzado"/);
  });
});
