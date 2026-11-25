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

describe("cada puerta dice lo que hace su botón, en los dos idiomas", () => {
  it("el título dice para quién es y el botón cumple lo que el título promete", () => {
    expect(T.es.ptListaT).toBe("Mirá cómo es");
    expect(T.es.ptStandT).toBe("Para tu stand o tu feria");
    expect(T.es.ptEmpresaT).toBe("Para tu empresa");
    expect(T.en.ptListaT).toBe("See how it works");
    expect(T.en.ptStandT).toBe("For your booth or fair");
    expect(T.en.ptEmpresaT).toBe("For your company");
    // El ejemplo no usa tu lista: la línea no promete pegar nombres.
    expect(T.es.ptListaB).not.toMatch(/pegá|tu lista/i);
    expect(T.en.ptListaB).not.toMatch(/paste|your list/i);
    // En el stand la gente se anota y mira la ronda: no juega.
    expect(T.es.ptStandB).toMatch(/mira la ronda/);
    expect(T.en.ptStandB).toMatch(/watch the round/);
  });

  it("la tarjeta de ejemplo no cuenta personas: dice que participar es gratis", () => {
    expect(T.es.peGente).toBe("Participar es gratis");
    expect(T.en.peGente).toBe("Joining is free");
    expect(T.en.pePremioM).not.toMatch(/digital dollars/i);
  });
});

describe("los pasos 01 a 03 de la portada", () => {
  it("el paso 2 y el paso 3 dicen por qué es justo, sin hablar de un número que no se explica", () => {
    expect(T.es.s2b).toBe("Queda cerrada antes del sorteo: nadie la puede cambiar.");
    expect(T.es.s3b).toBe("Gana quien sale de un número que nadie elige.");
    expect(T.en.s2b).toMatch(/before the draw/);
    expect(T.en.s3b).toMatch(/nobody picks/);
  });

  it("cada uno trae un dibujo o una captura, un título y una línea", () => {
    const pasos = [...document.querySelectorAll<HTMLElement>(".steps > article")];
    expect(pasos).toHaveLength(3);
    for (const p of pasos) {
      const media = p.querySelector(".paso-media");
      expect(media, p.textContent ?? "").not.toBeNull();
      // Lo decorativo no se lee: el título y la línea ya dicen el paso.
      expect(media?.getAttribute("aria-hidden")).toBe("true");
      expect(media?.querySelector("svg, img"), p.textContent ?? "").not.toBeNull();
      expect(p.querySelectorAll("h3")).toHaveLength(1);
    }
  });

  it("los tres son dibujos del mismo estilo, sin capturas, y el sello usa la llama del símbolo de la página", () => {
    for (const p of document.querySelectorAll<HTMLElement>(".steps > article")) {
      expect(p.querySelector(".paso-media svg"), p.textContent ?? "").not.toBeNull();
      expect(p.querySelector("img"), p.textContent ?? "").toBeNull();
      expect(p.querySelector(".paso-media svg")?.getAttribute("viewBox")).toBe("0 0 64 64");
    }
    expect(document.querySelector(".paso-sello use")?.getAttribute("href")).toBe("#llama");
    expect(document.getElementById("llama")).not.toBeNull();
  });

  it("van sin caja ni sombra, con el dibujo de 64 px al lado del texto", () => {
    const regla = css.match(/\.steps article \{([^}]*)\}/)?.[1] ?? "";
    expect(regla).toMatch(/grid-template-columns: 64px/);
    expect(regla).not.toMatch(/box-shadow|border:|background/);
    expect(css).toMatch(/\.steps \.paso-media \{ width: 64px; height: 64px;/);
  });

  it("no usa los stickers de la colección", () => {
    expect(html.slice(html.indexOf('class="steps'), html.indexOf('id="juegos"'))).not.toContain("marca/coleccion");
  });

  it("la línea de cada paso es corta y el detalle del primero va plegado, con su texto en los dos idiomas", () => {
    for (const k of ["s1c", "s2b", "s3b"] as const) {
      expect((T.es[k] as string).length, k).toBeLessThanOrEqual(60);
      expect((T.en[k] as string).length, k).toBeLessThanOrEqual(60);
    }
    const detalle = document.querySelector<HTMLDetailsElement>(".steps details.paso-mas");
    expect(detalle).not.toBeNull();
    expect(detalle?.open).toBe(false);
    expect(detalle?.querySelector('[data-i="s1b"]')).not.toBeNull();
    for (const k of ["s1c", "pasoMas"]) {
      expect(typeof T.es[k]).toBe("string");
      expect(typeof T.en[k]).toBe("string");
    }
  });
});

describe("la portada en el celular y en la laptop", () => {
  const bloque = (inicio: RegExp): string => {
    const i = css.search(inicio);
    expect(i, String(inicio)).toBeGreaterThan(-1);
    let nivel = 0;
    for (let j = css.indexOf("{", i); j < css.length; j++) {
      if (css[j] === "{") nivel++;
      if (css[j] === "}" && --nivel === 0) return css.slice(i, j + 1);
    }
    return "";
  };

  it("hasta 859 px, y en laptops bajas, cada puerta es un renglón con miniatura de 64 px y título, sin la línea", () => {
    const b = bloque(/@media \(max-width: 859px\), \(min-width: 860px\) and \(max-height: 820px\) \{\s*\.puerta \{ display: grid;/);
    expect(b).toMatch(/\.puerta \{ display: grid; grid-template-columns: 64px/);
    expect(b).toMatch(/\.puerta-b \{ display: none; \}/);
    expect(b).toMatch(/\.puerta-empresa \.cp-ejemplo \{ display: none; \}/);
    expect(b).toMatch(/\.puerta-ico \{ display: grid;/);
  });

  it("la puerta de las empresas trae su ícono decorativo, que solo el renglón muestra", () => {
    const ico = document.querySelector(".puerta-empresa .puerta-ico");
    expect(ico?.getAttribute("aria-hidden")).toBe("true");
    expect(ico?.querySelector("svg")).not.toBeNull();
    expect(css).toMatch(/\.puerta-ico \{ display: none; \}/);
  });

  it("en el celular las puertas suben justo debajo del botón y lo demás baja", () => {
    const b = bloque(/@media \(max-width: 700px\) \{\s*\.hero-portada \.hero-copy \{ display: contents; \}/);
    expect(b).toMatch(/\.hero-portada \.hero-copy \{ display: contents; \}/);
    const orden = (sel: string): number => Number(b.match(new RegExp(`\\.hero-portada \\.${sel} \\{[^}]*order: (\\d+)`))?.[1]);
    expect(orden("puertas")).toBeLessThan(orden("hero-otras"));
    expect(orden("hero-otras")).toBeLessThan(orden("hero-note"));
    expect(orden("hero-note")).toBeLessThan(orden("built-on"));
  });

  it("la tarjeta entera responde: el área del botón se estira a toda la puerta", () => {
    expect(css).toMatch(/\.puerta \{[^}]*position: relative/);
    expect(css).toMatch(/\.puerta \.puerta-a::after \{ content: ""; position: absolute; inset: 0; \}/);
  });

  it("en escritorio el botón de la puerta no se mueve al pasar el mouse: la tarjeta entera es su área", () => {
    // Un botón con transform se vuelve el bloque contenedor de su ::after y el área clicable se achica al botón: parpadeo.
    // La regla va al nivel de arriba (dos espacios de sangría, fuera de cualquier @media) y gana en especificidad a button.ghost:hover.
    const m = css.match(/^ {2}\.puerta \.puerta-a:hover:not\(:disabled\), \.puerta a\.puerta-a:hover \{([^}]*)\}/m);
    expect(m, "falta la regla que quita el transform del botón de la puerta").not.toBeNull();
    expect(m![1]).toMatch(/transform: none/);
  });

  it("lado a lado la imagen es baja y los botones entran en la primera pantalla", () => {
    expect(css).toMatch(/\.puerta-media \{[^}]*aspect-ratio: 21 \/ 9/);
  });

  it("la puerta de la lista no usa la ruleta y todas las imágenes vienen en par claro y oscuro", () => {
    const lista = document.querySelector(".puerta-lista")!;
    expect(lista.innerHTML).not.toContain("wheel");
    for (const img of lista.querySelectorAll<HTMLImageElement>("img")) expect(img.getAttribute("src")).toMatch(/portada\/pinata(-light)?\.webp/);
  });

  it("el texto de la tarjeta de ejemplo no baja de 16 px", () => {
    for (const sel of [".cp-nombres span", ".cp-rotulo", ".cp-premio span", ".cp-estado", ".cp-gente"]) {
      const regla = css.match(new RegExp(`${sel.replace(/\./g, "\\.")} \\{[^}]*font-size: (\\d+)px`))?.[1];
      expect(Number(regla), sel).toBeGreaterThanOrEqual(16);
    }
    expect(css).toMatch(/@media \(max-width: 359px\) \{ \.cp-nombres span \{ display: none; \} \}/);
  });

  it("la imagen del hero sigue el tema elegido con el mismo par claro y oscuro de las puertas", () => {
    const hero = document.querySelector(".hero-shot")!;
    const alts = [...hero.querySelectorAll<HTMLImageElement>("img.hero-alt")];
    expect(alts.map((i) => i.getAttribute("src"))).toEqual(["/juegos/race.webp", "/juegos/race-light.webp"]);
    for (const i of alts) {
      expect(i.getAttribute("loading")).toBe("lazy");
      expect(i.getAttribute("width")).toBe("900");
      expect(i.getAttribute("height")).toBe("506");
    }
    // La primera imagen no se difiere y sigue siendo la que se pide en la primera pantalla.
    expect(hero.querySelector("picture img")?.hasAttribute("loading")).toBe(false);
    expect(css).toMatch(/:root\[data-theme="dark"\] \.hero-shot picture \{ display: none; \}/);
    expect(css).toMatch(/:root\[data-theme="light"\] \.hero-shot picture \{ display: none; \}/);
  });

  it("el enlace de la campaña en Sortear se lee morado como los demás enlaces del panel", () => {
    expect(css).toMatch(/\.premio-campana a \{[^}]*color: var\(--purple-ink\)/);
  });
});
