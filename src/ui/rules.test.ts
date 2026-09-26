import { describe, expect, it } from "vitest";
import { T, type RulesParams } from "../i18n";

const base: RulesParams = {
  prize: "Licencia JetBrains",
  count: 18,
  winners: 1,
  listHash: "ab".repeat(32),
  sealedAt: "25 de septiembre de 2026, 21:04:10 GMT-4",
  round: 32254977,
  roundAt: "25 de septiembre de 2026, 21:05:00 GMT-4",
  network: "testnet",
  verifyUrl: "https://tinkazo.vercel.app/seguridad.html",
};

describe("las bases del sorteo", () => {
  for (const lang of ["es", "en"] as const) {
    it(`${lang}: dicen lo que hay que saber antes de sortear`, () => {
      const txt = T[lang].rules({ ...base, raffleId: "12" });
      expect(txt).toContain(base.listHash);
      expect(txt).toContain(String(base.round));
      expect(txt).toContain(base.prize);
      expect(txt).toContain("#12");
      expect(txt).toContain("testnet");
      expect(txt).toContain(base.verifyUrl);
      expect(txt).toMatch(lang === "es" ? /gratis/ : /free/);
      expect(txt).not.toMatch(/undefined|NaN/);
    });

    it(`${lang}: sin sello en la cadena, lo dicen`, () => {
      const txt = T[lang].rules(base);
      expect(txt).not.toContain("#");
      expect(txt).toMatch(lang === "es" ? /navegador de quien organiza/ : /organizer's browser/);
    });

    it(`${lang}: con varios ganadores, en plural`, () => {
      const txt = T[lang].rules({ ...base, winners: 3, prize: "" });
      expect(txt).toMatch(lang === "es" ? /Salen 3 ganadores/ : /3 winners are drawn/);
      expect(txt.split("\n")[0]).toBe(lang === "es" ? "Bases del sorteo" : "Raffle rules");
    });
  }
});
