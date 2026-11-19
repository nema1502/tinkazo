// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { T, setLang } from "../i18n";
import type { Game } from "../state";
import { REGLA_ORDEN, showGameCard } from "./gamecard";

/** La tarjeta de un orden no presenta el turno 1 como un premio ni como alguien que ganó. */

const JUEGOS: readonly Game[] = ["wheel", "race", "chovena", "guajojo"];
const prohibido = (lang: "es" | "en"): RegExp =>
  lang === "es" ? /\b(?:ganar|gana|ganador|ganadora|ganadores|ganadoras|premio|premios)\b/i : /\b(?:win|wins|winner|winners|prize|prizes)\b/i;

function abrir(game: Game, orden: boolean) {
  const card = showGameCard(game, 5, 5, 0, undefined, orden ? "Turnos" : "Termo", undefined, orden);
  const caja = document.querySelector<HTMLElement>(".game-card");
  return { card, caja };
}

afterEach(() => {
  setLang("es");
  document.querySelectorAll(".game-card").forEach((el) => el.remove());
  document.body.style.overflow = "";
});

describe("la tarjeta del juego con un orden de turnos", () => {
  it("las cuatro reglas y las líneas comunes existen en los dos idiomas", () => {
    const claves = [...Object.values(REGLA_ORDEN), "gcHonestOrden", "gcOrdenGeneral", "cortinaSeOrden"];
    for (const lang of ["es", "en"] as const) {
      for (const clave of claves) expect(typeof T[lang][clave], `${lang}.${clave}`).toBe("string");
    }
  });

  for (const lang of ["es", "en"] as const) {
    for (const game of JUEGOS) {
      it(`${lang}, ${game}: habla del turno 1, no de ganar ni de premios`, () => {
        setLang(lang);
        const { card, caja } = abrir(game, true);
        try {
          expect(caja?.querySelector(".gc-regla")?.textContent).toBe(T[lang][REGLA_ORDEN[game] as string]);
          expect(caja?.querySelector(".gc-premio")?.textContent).toBe(T[lang].cortinaSeOrden);
          expect(caja?.querySelector(".gc-honesta")?.textContent).toBe(T[lang].gcHonestOrden);
          expect(caja?.querySelectorAll(".gc-extra")).toHaveLength(0);
          expect(caja?.textContent).toContain(lang === "es" ? "turno 1" : "turn 1");
          expect(caja?.textContent).not.toMatch(prohibido(lang));
        } finally {
          card.hide();
        }
      });
    }
  }

  for (const lang of ["es", "en"] as const) {
    it(`${lang}: un juego sin regla de orden anuncia el orden completo, sin ganar ni premios`, () => {
      setLang(lang);
      const { card, caja } = abrir("trompo", true);
      try {
        expect(caja?.querySelector(".gc-regla")?.textContent).toBe(T[lang].gcOrdenGeneral);
        expect(caja?.querySelectorAll(".gc-extra")).toHaveLength(0);
        expect(caja?.textContent).not.toMatch(prohibido(lang));
      } finally {
        card.hide();
      }
    });
  }

  it("sin el dato de orden, la tarjeta de premios conserva sus textos", () => {
    const { card, caja } = abrir("wheel", false);
    try {
      expect(caja?.querySelector(".gc-regla")?.textContent).toBe(T.es.gcWheel);
      expect(caja?.querySelector(".gc-extra")?.textContent).toBe(T.es.gcPrizesNote(5));
      expect(caja?.querySelector(".gc-premio")?.textContent).toBe("Se sortea Termo");
      expect(caja?.querySelector(".gc-honesta")?.textContent).toBe(T.es.gcHonest);
    } finally {
      card.hide();
    }
  });
});
