import { describe, expect, it } from "vitest";
import { T } from "../i18n";
import { splitWords, wordAt } from "./rotar";

const badgeOf = (lang: "es" | "en") => T[lang].badge as string;
const wordsOf = (html: string) => splitWords(/data-words="([^"]+)"/.exec(html)?.[1]);

describe("palabras rotativas del sticker de la portada", () => {
  it("cada idioma trae la misma cantidad de palabras", () => {
    expect(wordsOf(badgeOf("es")).length).toBeGreaterThan(1);
    expect(wordsOf(badgeOf("en"))).toHaveLength(wordsOf(badgeOf("es")).length);
  });

  it("la primera palabra es la que se ve sin JavaScript", () => {
    for (const lang of ["es", "en"] as const) {
      expect(badgeOf(lang)).toContain(`>${wordsOf(badgeOf(lang))[0]}</span>`);
    }
  });

  it("ninguna palabra suena a rifa, apuesta, lotería ni boleto", () => {
    const banned = /rifa|apuesta|loter|casino|boleto|raffle|lottery|\bbet\b|ticket|gambl/i;
    for (const lang of ["es", "en"] as const) {
      for (const word of wordsOf(badgeOf(lang))) expect(word).not.toMatch(banned);
    }
  });

  it("después de la última vuelve a la primera", () => {
    const words = ["meetup", "clase", "evento"];
    expect(wordAt(words, 1)).toBe("clase");
    expect(wordAt(words, 3)).toBe("meetup");
  });
});
