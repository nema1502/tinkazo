// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { mostrarEnlacesDeCampana } from "./campana/bandera";
import { T } from "./i18n";

/**
 * La portada de tres puertas (25 de noviembre de 2026): sortear con tu lista, tengo un stand y soy una empresa. Cada una
 * es una tarjeta con su imagen, un título, una línea y su acción. La acción principal de la portada sigue siendo el botón
 * de entrar de arriba, y la puerta de las empresas respeta el mecanismo de siempre: nace escondida y solo se muestra con
 * las campañas abiertas, sin dejar hueco cuando está cerrada.
 */
const html = readFileSync("index.html", "utf8");
const css = readFileSync("src/styles.css", "utf8");

const cuerpo = (): string => html.slice(html.indexOf("<body>") + 6, html.indexOf("</body>"));
const puertas = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>(".hero .puertas > .puerta")];

beforeEach(() => {
  document.body.innerHTML = cuerpo();
});

describe("las tres puertas de la portada", () => {
  it("hay tres, dentro del hero, cada una con imagen, título, línea y una sola acción", () => {
    const lista = puertas();
    expect(lista).toHaveLength(3);
    for (const p of lista) {
      expect(p.querySelector(".puerta-media"), p.className).not.toBeNull();
      expect(p.querySelectorAll("h2.puerta-t"), p.className).toHaveLength(1);
      expect(p.querySelectorAll("p.puerta-b"), p.className).toHaveLength(1);
      expect(p.querySelectorAll(".puerta-a"), p.className).toHaveLength(1);
      // Ninguna es una acción principal: la de la portada es el botón de entrar.
      expect(p.querySelector(".primary"), p.className).toBeNull();
    }
  });

  it("las imágenes traen su ancho y su alto y se cargan diferidas, salvo la del hero", () => {
    for (const img of document.querySelectorAll<HTMLImageElement>(".puertas img")) {
      expect(img.getAttribute("width"), img.src).toMatch(/^\d+$/);
      expect(img.getAttribute("height"), img.src).toMatch(/^\d+$/);
      expect(img.getAttribute("loading"), img.src).toBe("lazy");
      expect(img.getAttribute("decoding"), img.src).toBe("async");
      expect(img.getAttribute("alt"), img.src).toBe("");
    }
    // Una captura por tema, como las de la grilla de juegos.
    expect(document.querySelectorAll(".puertas .pj-osc").length).toBe(document.querySelectorAll(".puertas .pj-cla").length);
    const primera = document.querySelector<HTMLImageElement>(".hero-shot img");
    expect(primera?.hasAttribute("loading")).toBe(false);
  });

  it("el botón de entrar sigue siendo la acción principal del hero y el único de color", () => {
    const hero = document.querySelector(".hero")!;
    expect(hero.querySelectorAll(".primary")).toHaveLength(1);
    const entrar = hero.querySelector<HTMLElement>(".hero-ctas [data-cta-entrar]");
    expect(entrar?.classList.contains("primary")).toBe(true);
    // Y lo que viene justo después es el renglón de Otras formas de entrar, como antes.
    expect(hero.querySelector(".hero-ctas")?.nextElementSibling?.matches("p.hero-otras")).toBe(true);
  });

  it("el stand y el ensayo conservan sus marcas dentro del hero, donde los buscan los guiones", () => {
    expect(document.querySelectorAll(".hero [data-entrar-stand]")).toHaveLength(1);
    expect(document.querySelectorAll(".hero [data-entrar-ensayo]")).toHaveLength(1);
    expect(document.querySelector(".puerta-stand [data-entrar-stand]")).not.toBeNull();
    expect(document.querySelector(".puerta-lista [data-entrar-ensayo]")).not.toBeNull();
  });
});

describe("la puerta de las empresas respeta las campañas abiertas", () => {
  const empresa = (): HTMLElement => document.querySelector<HTMLElement>(".puerta-empresa")!;
  const visibles = (): HTMLElement[] => puertas().filter((p) => !p.hidden);

  it("con las campañas cerradas queda escondida y se ven dos puertas", () => {
    mostrarEnlacesDeCampana(document, false);
    expect(empresa().hidden).toBe(true);
    expect(empresa().hasAttribute("data-campana-enlace")).toBe(true);
    expect(visibles()).toHaveLength(2);
    expect(visibles().map((p) => p.className)).toEqual(["puerta puerta-lista", "puerta puerta-stand"]);
  });

  it("con las campañas abiertas se ven las tres y la tercera lleva a armar la campaña", () => {
    mostrarEnlacesDeCampana(document, true);
    expect(empresa().hidden).toBe(false);
    expect(visibles()).toHaveLength(3);
    expect(empresa().querySelector<HTMLAnchorElement>("a.puerta-a")?.getAttribute("href")).toBe("/crear-campana.html");
  });

  it("sin hueco: el CSS esconde la tarjeta de verdad y reparte el ancho entre las que quedan", () => {
    expect(css).toMatch(/\.puerta\[hidden\] \{ display: none; \}/);
    expect(css).toMatch(/\.puertas \{[^}]*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
    expect(css).toMatch(/\.puertas:has\(> \.puerta\[hidden\]\) \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\); \}/);
  });
});

describe("la tarjeta de campaña de ejemplo", () => {
  it("se hace con HTML y CSS, sin imagen, y dice que es un ejemplo con una marca inventada", () => {
    const tarjeta = document.querySelector(".puerta-empresa .cp-ejemplo")!;
    expect(tarjeta).not.toBeNull();
    expect(tarjeta.querySelector("img")).toBeNull();
    expect(tarjeta.querySelector(".cp-franja")).not.toBeNull();
    expect(tarjeta.querySelector(".cp-logo")).not.toBeNull();
    expect(tarjeta.querySelector(".cp-premio strong")).not.toBeNull();
    expect(tarjeta.querySelector(".cp-gente")).not.toBeNull();
    expect(tarjeta.querySelector<HTMLElement>(".cp-rotulo")?.dataset.i).toBe("peRotulo");
    expect(T.es.peRotulo).toBe("Ejemplo");
    expect(T.en.peRotulo).toBe("Example");
    expect(T.es.peMarca).toBe("Tu marca");
  });

  it("el estado lleva ícono y texto, nunca solo color", () => {
    const estado = document.querySelector(".cp-estado")!;
    expect(estado.querySelector("svg")).not.toBeNull();
    expect(estado.querySelector("span")?.textContent?.trim()).toBe(T.es.peEstado);
  });
});

describe("los textos de las puertas, en los dos idiomas", () => {
  const CLAVES = [
    "ptListaT", "ptListaB", "ptStandT", "ptStandB", "ptEmpresaT", "ptEmpresaB", "ptEmpresaA",
    "peRotulo", "peMarca", "peLugar", "pePremioN", "pePremioM", "peEstado", "peGente",
  ];

  it("cada una existe en español y en inglés", () => {
    for (const k of CLAVES) {
      expect(typeof T.es[k], `es.${k}`).toBe("string");
      expect(typeof T.en[k], `en.${k}`).toBe("string");
      expect(T.en[k], k).not.toBe(T.es[k]);
    }
  });

  it("el HTML dice lo mismo que el diccionario en español", () => {
    for (const k of CLAVES) {
      const enElHtml = html.match(new RegExp(`data-i="${k}">([^<]+)<`))?.[1];
      expect(enElHtml, k).toBe(T.es[k]);
    }
  });

  it("sin comillas angulares ni punto y coma, y sin las palabras que no van", () => {
    for (const l of ["es", "en"] as const) {
      for (const k of CLAVES) {
        const v = T[l][k] as string;
        expect(v, `${l}.${k}`).not.toMatch(/[«»;]/);
        expect(v, `${l}.${k}`).not.toMatch(/rifa|loter|raffle|ticket|boleto|apuesta|suerte/i);
      }
    }
  });
});
