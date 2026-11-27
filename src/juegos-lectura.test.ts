// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { T } from "./i18n";

const html = readFileSync("juegos.html", "utf8");
const css = readFileSync("src/styles.css", "utf8");
const page = new DOMParser().parseFromString(html, "text/html");
const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
const declarations = (selector: string): string => rules.find((r) => r[1]?.trim() === selector)?.[2] ?? "";
const cards = [...page.querySelectorAll(".juego")];
const games = [
  ["Race", "race", "magenta"], ["Sapo", "sapo", "teal"], ["Tro", "trompo", "orange"],
  ["Cho", "chovena", "teal"], ["Pin", "pinata", "magenta"], ["Wheel", "wheel", "yellow"],
  ["Tel", "teleferico", "teal"], ["Oru", "oruro", "purple"], ["Guajojo", "guajojo", "orange"],
  ["Toborochi", "toborochi", "magenta"],
];

describe("la página de juegos", () => {
  it("presenta los diez nombres como títulos, sin la insignia de los pasos", () => {
    expect(cards).toHaveLength(10);
    for (const [i, card] of cards.entries()) {
      const name = card.querySelector(`[data-i="jg${games[i]?.[0]}N"]`);
      expect(name?.tagName).toBe("H2");
      expect(name?.closest(".juego-txt")).not.toBeNull();
      expect(name?.hasAttribute("style")).toBe(false);
      expect(name?.classList.contains("num")).toBe(false);
    }
    const title = declarations(".juego-txt h2");
    expect(title).toMatch(/font-family:\s*inherit/);
    expect(title).toMatch(/font-size:\s*var\(--letra-prin\)/);
    expect(title).toMatch(/font-weight:\s*900/);
    expect(title).toMatch(/color:\s*var\(--ink\)/);
    expect(title).not.toMatch(/background/);
  });

  it("lleva el color de cada juego en el borde de la tarjeta, no detrás del nombre", () => {
    for (const [i, card] of cards.entries()) {
      expect(card.getAttribute("style")).toBe(`--juego-color: var(--${games[i]?.[2]})`);
      expect(card.querySelector(".juego-txt [style]")).toBeNull();
    }
    expect(declarations(".juego")).toMatch(/border-top:\s*6px solid var\(--juego-color\)/);
  });

  it("la regla de todos usa la letra secundaria sin estilos en línea", () => {
    const paragraph = page.querySelector('[data-i="jgRuleB"]');
    expect(paragraph?.hasAttribute("style")).toBe(false);
    expect(paragraph?.classList.contains("juegos-regla")).toBe(true);
    expect(declarations(".juegos-regla")).toMatch(/font-size:\s*var\(--letra-sec\)/);
    expect(css).toMatch(/--letra-sec:\s*16px/);
  });

  it.each(["es", "en"] as const)("la bajada en %s cuenta el resultado ya decidido en hasta dos frases simples", (lang) => {
    const lead = T[lang].jgLead as string;
    expect(lead.split(/[.!?]+/).filter((s) => s.trim()).length).toBeLessThanOrEqual(2);
    expect(lead).not.toMatch(/faro|beacon|protocol|comprobacion|comprobación|checks|veinte|twenty|\d|drand|semilla|seed/i);
    expect(lead).toBe(lang === "es"
      ? "Cuando arranca el juego, el ganador ya está decidido. El juego solo lo cuenta."
      : "When the game starts, the winner is already decided. The game only tells the story.");
    if (lang === "es") expect(page.querySelector('[data-i="jgLead"]')?.textContent).toBe(lead);
  });

  it("cada clave de la página tiene texto en ambos idiomas", () => {
    const keys = [...html.matchAll(/data-(?:i|titulo-clave|desc-clave)="([^"]+)"/g)].map((m) => m[1]!);
    expect(keys).toContain("jgLead");
    for (const key of keys) for (const lang of ["es", "en"] as const) {
      expect(typeof T[lang][key], `${lang}.${key}`).toBe("string");
      expect((T[lang][key] as string).trim(), `${lang}.${key}`).not.toBe("");
    }
  });

  it("sube los textos secundarios a 16 px solo en Juegos y no deja estilos en línea menores", () => {
    for (const match of html.matchAll(/font-size:\s*(\d+)px/g)) expect(Number(match[1])).toBeGreaterThanOrEqual(16);
    const scope = 'html[data-titulo-clave="titJuegos"]';
    const floor = rules.find((r) => r[1]?.includes(`${scope} :is(`));
    expect(floor?.[2]).toMatch(/font-size:\s*var\(--letra-sec\)/);
    for (const selector of [".kicker", ".sticker", ".langs button", "footer .bar", ".pies a", ".cc-nombre", ".cc-via"]) {
      expect(floor?.[1]).toContain(selector);
    }
  });

  it("conserva las imágenes, el orden, el relato de la carrera y las insignias de la portada", () => {
    expect(cards.map((card) => card.querySelector(".juego-txt > [data-i]")?.getAttribute("data-i")))
      .toEqual(games.map(([key]) => `jg${key}N`));
    for (const [i, card] of cards.entries()) {
      expect(card.querySelector("img")?.getAttribute("src")).toBe(`/juegos/${games[i]?.[1]}.webp`);
      expect(card.querySelector("source")?.getAttribute("srcset")).toBe(`/juegos/${games[i]?.[1]}-light.webp`);
    }
    expect(T.es.jgRaceB).toBe("Lo nuestro. Salen todas juntas, se van echando de a una y quedan ocho. Con más de 30, corren por tandas. El sorteo ya estaba hecho.");
    expect(T.en.jgRaceB).toBe("Our flagship game. They all start together, lie down one by one, and eight are left. With more than 30, they race in heats. The draw was already made.");
    expect(page.querySelector('[data-i="jgRaceB"]')?.textContent).toBe(T.es.jgRaceB);
    expect(declarations(".num").trim()).toBe('display: inline-block; color: var(--on-accent); border: 2px solid var(--ink); font-family: ui-monospace, Consolas, monospace; font-weight: 800; font-size: 16px; padding: 2px 10px; transform: rotate(-2deg);');
    expect(declarations(".steps article:nth-child(1) .num").trim()).toBe("background: var(--magenta);");
    expect(declarations(".steps article:nth-child(2) .num").trim()).toBe("background: var(--orange);");
    expect(declarations(".steps article:nth-child(3) .num").trim()).toBe("background: var(--purple); color: var(--on-purple);");
  });
});
