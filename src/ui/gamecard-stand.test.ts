// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { T, setLang } from "../i18n";
import type { Game } from "../state";
import { showGameCard } from "./gamecard";

/**
 * La tarjeta de cómo se juega en una ronda del stand. La lee toda la sala, en letra grande: en el stand nadie gana ni se
 * lleva un premio, y no hay número público. La regla dice quién sale, con una persona y con varias, y la línea que lee
 * el lector de pantalla (`gc-honesta`) dice que es una ronda de ejemplo.
 */

/** Los diez del selector y la tómbola, a la que pasa la ruleta con más de doscientas personas. */
const JUEGOS: readonly Game[] = ["race", "chovena", "trompo", "pinata", "oruro", "wheel", "teleferico", "sapo", "guajojo", "toborochi", "tombola"];

/** Lo que el stand no dice: ganar, premio, sello ni número público. */
const PROHIBIDO = /\bgan\p{L}*|premio|sell|n[uú]mero p[uú]blico|\bwin(s|ner|ners|ning)?\b|prize|seal|public number/iu;

interface Leido {
  regla: string;
  extras: string[];
  honesta: string;
  premio: string | null;
  kicker: string;
}

function leer(juego: Game, quienes: number, stand: boolean, personas = 8): Leido {
  const tarjeta = showGameCard(juego, personas, quienes, 0, undefined, "", undefined, false, undefined, stand);
  try {
    const texto = (css: string): string => document.querySelector(css)?.textContent ?? "";
    return {
      regla: texto(".gc-regla"),
      extras: [...document.querySelectorAll(".gc-extra")].map((e) => e.textContent ?? ""),
      honesta: texto(".gc-honesta"),
      premio: document.querySelector(".gc-premio")?.textContent ?? null,
      kicker: texto(".gc-kicker"),
    };
  } finally {
    tarjeta.hide();
    document.querySelectorAll(".game-card").forEach((e) => e.remove());
  }
}

afterEach(() => {
  setLang("es");
  document.body.style.overflow = "";
});

describe("la tarjeta de cómo se juega en el stand", () => {
  for (const lang of ["es", "en"] as const) {
    for (const quienes of [1, 2, 3, 8]) {
      it(`${lang}, ${quienes} que ${quienes === 1 ? "sale" : "salen"}: ningún juego habla de ganar, de premios ni de sellar`, () => {
        setLang(lang);
        const mal: string[] = [];
        for (const juego of JUEGOS) {
          const v = leer(juego, quienes, true);
          for (const [que, texto] of [["regla", v.regla], ["honesta", v.honesta], ...v.extras.map((e): [string, string] => ["extra", e])] as Array<[string, string]>) {
            if (!texto.trim() || /^(gc|jg)\S*$/.test(texto) || PROHIBIDO.test(texto) || /[;·—«»]/.test(texto)) mal.push(`${juego} ${que}: ${texto}`);
          }
          if (v.premio !== null) mal.push(`${juego} muestra un premio: ${v.premio}`);
        }
        expect(mal).toEqual([]);
      });
    }
  }

  it("dice quién sale, con una persona: la regla de cada juego con la palabra sale", () => {
    setLang("es");
    expect(leer("race", 1, true).regla).toBe("Sale la primera llama que cruza la meta.");
    expect(leer("wheel", 1, true).regla).toBe("Sale el gajo que queda bajo la flecha.");
    expect(leer("trompo", 1, true).regla).toBe("Los trompos chocan y se sacan. Sale el último que baila.");
    setLang("en");
    expect(leer("race", 1, true).regla).toBe("The first llama across the finish line is picked.");
    expect(leer("sapo", 1, true).regla).toBe("The hole where the last ring drops is picked.");
  });

  it("con varias personas, los juegos que cuentan a cada una lo dicen, y los que cuentan a la primera suman la nota", () => {
    setLang("es");
    // Cuentan a cada una: su regla de varias, sin nota.
    for (const juego of ["sapo", "teleferico", "chovena", "guajojo", "toborochi"] as const) {
      const v = leer(juego, 3, true);
      expect(v.extras, juego).toEqual([]);
      expect(v.regla, juego).not.toBe(leer(juego, 1, true).regla);
    }
    // Cuentan a la primera: la regla de siempre del juego y una nota con cuántas salen.
    for (const juego of ["race", "trompo", "pinata", "oruro", "wheel"] as const) {
      const v = leer(juego, 3, true);
      expect(v.regla, juego).toBe(leer(juego, 1, true).regla);
      expect(v.extras, juego).toEqual(["Salen 3 personas: el juego cuenta a la primera y el cartel del final las muestra a todas."]);
    }
    setLang("en");
    expect(leer("race", 3, true).extras).toEqual(["3 people are picked: the game tells the first one and the final card shows them all."]);
  });

  it("la línea que lee el lector de pantalla dice que es una ronda de ejemplo, no un número público", () => {
    setLang("es");
    expect(leer("race", 1, true).honesta).toBe(T.es.standBanda);
    setLang("en");
    expect(leer("race", 1, true).honesta).toBe(T.en.standBanda);
  });

  it("al cambiar de juego con la tarjeta abierta, la regla sigue siendo la del stand", () => {
    setLang("es");
    const tarjeta = showGameCard("race", 8, 1, 0, undefined, "", undefined, false, undefined, true);
    try {
      tarjeta.update("wheel");
      expect(document.querySelector(".gc-regla")?.textContent).toBe("Sale el gajo que queda bajo la flecha.");
      expect(document.querySelector(".gc-honesta")?.textContent).toBe(T.es.standBanda);
    } finally {
      tarjeta.hide();
      document.querySelectorAll(".game-card").forEach((e) => e.remove());
    }
  });

  it("fuera del stand la tarjeta es la de siempre: gana, premios y número público", () => {
    setLang("es");
    const v = leer("race", 1, false);
    expect(v.regla).toBe(T.es.gcRace);
    expect(v.regla).toMatch(/gana/i);
    expect(v.honesta).toBe(T.es.gcHonest);
    expect(leer("wheel", 3, false).extras[0]).toBe(T.es.gcPrizesNote(3));
  });

  it("cada regla del stand existe en español y en inglés, sin punto y coma, punto medio ni comillas angulares", () => {
    const fuente = readFileSync(join(process.cwd(), "src/ui/gamecard.ts"), "utf8");
    const claves = new Set([...fuente.matchAll(/["'](gcStand[A-Za-z]*)["']/g)].map((m) => m[1] as string));
    expect(claves.size).toBeGreaterThanOrEqual(15);
    for (const k of claves) {
      for (const l of ["es", "en"] as const) {
        const v = (T[l] as Record<string, unknown>)[k];
        expect(v, `${l}.${k}`).toBeDefined();
        const texto = typeof v === "function" ? (v as (n: number) => string)(3) : (v as string);
        expect(typeof texto, `${l}.${k}`).toBe("string");
        expect(texto, `${l}.${k}`).not.toMatch(PROHIBIDO);
        expect(texto, `${l}.${k}`).not.toMatch(/[;·—«»]/);
      }
    }
  });

  it("el sorteo le avisa a la tarjeta cuando la ronda es del stand", () => {
    const draw = readFileSync(join(process.cwd(), "src/ui/draw.ts"), "utf8");
    expect(draw).toMatch(/return showGameCard\([^\n]*textoDeEspera, enStand\(\)\);/);
    expect(readFileSync(join(process.cwd(), "src/ui/gamecard.ts"), "utf8")).not.toMatch(/ensayo-modo/);
  });
});
