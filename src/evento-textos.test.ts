import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { T } from "./i18n";

/**
 * La página de evento pide sus textos por clave (`t("evXxx")`). `textos.test.ts`
 * cubre los `data-i` del HTML; esta cubre las claves que pide el código, que el
 * HTML no muestra. Y que cada texto con marcadores ({n}, {m}, {i}, {f}) los
 * tenga iguales en español y en inglés.
 */
describe("textos de la página de evento", () => {
  const codigo = readFileSync("src/evento.ts", "utf8");
  const html = readFileSync("evento.html", "utf8");
  const claves = new Set([
    ...[...codigo.matchAll(/["'`](ev[A-Z][A-Za-z0-9]*)["'`]/g)].map((m) => m[1] as string),
    ...[...html.matchAll(/\bdata-i="(ev[A-Za-z0-9]*)"/g)].map((m) => m[1] as string),
  ]);

  it("el código pide claves, y todas existen en español y en inglés", () => {
    expect(claves.size).toBeGreaterThan(20);
    const faltan = [...claves].filter((k) => typeof T.es[k] !== "string" || typeof T.en[k] !== "string");
    expect(faltan).toEqual([]);
  });

  it("cada texto con marcadores los tiene iguales en los dos idiomas", () => {
    const marcas = (s: string): string[] => [...s.matchAll(/\{[a-z]+\}/g)].map((m) => m[0]).sort();
    const distintas = [...claves].filter((k) => {
      const es = T.es[k];
      const en = T.en[k];
      return typeof es === "string" && typeof en === "string" && JSON.stringify(marcas(es)) !== JSON.stringify(marcas(en));
    });
    expect(distintas).toEqual([]);
  });
});
