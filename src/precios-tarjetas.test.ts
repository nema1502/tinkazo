// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cuentaDePrueba } from "./campana/cuentas-de-prueba";
import { comisionTexto, conLaComision, pintarLaComision } from "./comision-texto";
import { costoDelRetiroTexto, pintarElCostoDelRetiro } from "./costo-del-retiro";
import { T, setLang } from "./i18n";

const html = readFileSync(resolve("precios.html"), "utf8");
const css = readFileSync(resolve("src/styles.css"), "utf8");
const configured = {
  VITE_COMISION_PB: "250", VITE_COMISION_MINIMO: "2",
  VITE_COMISION_CUENTA: cuentaDePrueba(2),
  VITE_RETIRO_COSTO: "0.50", VITE_RETIRO_CUENTA: cuentaDePrueba(1),
};
const text = (selector: string): string => document.querySelector(selector)?.textContent?.replace(/\s+/g, " ").trim() ?? "";
const rule = (selector: string): string => css.split(`${selector} {`)[1]?.split("}")[0] ?? "";

beforeEach(() => {
  document.body.innerHTML = /<body>([\s\S]*)<\/body>/.exec(html)?.[1]?.replace(/<script[\s\S]*?<\/script>/g, "") ?? "";
});
afterEach(() => { document.body.innerHTML = ""; });

describe("las tarjetas de precios", () => {
  it("conserva el idioma inicial y no recupera las claves de la tabla de planes retirada", () => {
    expect(html).toMatch(/<html lang="es"/);
    expect(html).not.toMatch(/data-i="prP\d|data-i="prCol|<table/);
  });

  it("sin comisión quedan dos tarjetas y el molde cerrado dentro de la fila, sin hueco ni números de campaña", () => {
    const before = document.body.innerHTML;
    pintarLaComision(document, comisionTexto("es", {}));
    expect(document.body.innerHTML).toBe(before);
    expect(document.querySelectorAll(".precios-tarjetas > .precios-tarjeta")).toHaveLength(2);
    expect(document.querySelector(".precios-tarjetas > template[data-con-comision]")).not.toBeNull();
    expect(document.querySelector("[data-comision]")).toBeNull();
    expect(document.body.textContent).not.toMatch(/\{[pme]\}|\d[,.]\d|%/);
  });

  it.each(["es", "en"] as const)("muestra tres títulos y el porcentaje de la configuración en %s, también al volver de otro idioma", (lang) => {
    for (const idioma of [lang, lang === "es" ? "en" : "es", lang] as const) {
      setLang(idioma);
      const commission = comisionTexto(idioma, configured)!;
      pintarLaComision(document, commission);
      expect(document.querySelectorAll(".precios-tarjetas > .precios-tarjeta")).toHaveLength(3);
      expect([...document.querySelectorAll(".precios-tarjeta > h2")].map((el) => el.textContent)).toEqual([
        T[idioma].prCardOrganize, T[idioma].prCardParticipate, T[idioma].prCardCompany,
      ]);
      expect(text('[data-i="prCardPercentage"]')).toBe(idioma === "es" ? "2,5 %" : "2.5%");
      expect(text('[data-i="prComisionT"]')).toBe(T[idioma].prComisionT);
      expect(text('[data-i="prComision"]')).toBe(conLaComision(String(T[idioma].prComision), commission));
      expect(document.querySelector('[data-comision] a[data-i="prComisionLink"]')?.getAttribute("href")).toBe("/crear-campana.html");
      expect(document.querySelector("template[data-con-comision]")).toBeNull();
      expect(document.body.textContent).not.toMatch(/\{[pme]\}/);
      expect(text(".lead")).toBe(T[idioma].prNoteComision);
    }
  });

  it.each(["es", "en"] as const)("organizar y participar conservan sus textos y Gratis en %s", (lang) => {
    setLang(lang);
    const cards = document.querySelectorAll(".precios-tarjeta");
    expect(cards).toHaveLength(2);
    expect(cards[0]?.querySelector('[data-i="prCardFree"]')?.textContent).toBe(T[lang].prCardFree);
    expect(cards[0]?.querySelector('[data-i="prNote"]')?.textContent).toBe(T[lang].prNote);
    expect(cards[0]?.querySelector('a[data-i="backHome"]')?.getAttribute("href")).toBe("/");
    expect(cards[1]?.querySelector('[data-i="prCardFree"]')?.textContent).toBe(T[lang].prCardFree);
    expect(cards[1]?.querySelector('[data-i="prNever3"]')?.textContent).toBe(T[lang].prNever3);
    expect(text(".lead")).toBe(T[lang].prNote);
  });

  it.each([false, true])("el retiro sigue independiente de la tarjeta de campaña (comisión: %s)", (commission) => {
    setLang("es");
    pintarLaComision(document, comisionTexto("es", commission ? configured : {}));
    const before = document.body.innerHTML;
    pintarElCostoDelRetiro(document, costoDelRetiroTexto("es", {}));
    expect(document.body.innerHTML).toBe(before);
    expect(document.querySelector("[data-retiro]")).toBeNull();
    expect(document.querySelector("template[data-con-retiro]")).not.toBeNull();
    pintarElCostoDelRetiro(document, costoDelRetiroTexto("es", configured));
    expect(document.querySelector("template[data-con-retiro]")).toBeNull();
    expect(text('[data-i="prRetiro"]')).toBe(String(T.es.prRetiro).replace("{c}", "0,50"));
    expect(document.querySelectorAll(".precios-tarjetas > .precios-tarjeta")).toHaveLength(commission ? 3 : 2);
    expect(document.querySelector(".precios-tarjetas [data-retiro]")).toBeNull();
  });

  it("la lista y las notas siguen debajo de las tarjetas con sus claves y textos", () => {
    setLang("es");
    const cards = document.querySelector(".precios-tarjetas");
    expect(cards).not.toBeNull();
    for (const key of ["prNeverTitle", "prNever1", "prNever2", "prNever3", "prNever4", "prSponsorNota", "nextBody", "prLogoNota"]) {
      const el = document.querySelector(`.precios-notas [data-i="${key}"]`);
      expect(el?.textContent, key).toBe(T.es[key]);
      expect(cards!.compareDocumentPosition(el!) & Node.DOCUMENT_POSITION_FOLLOWING, key).toBeTruthy();
    }
  });

  it("las etiquetas nuevas son bilingües y el número grande es solo un marcador", () => {
    for (const [lang, labels] of [
      ["es", ["Organizar", "Participar y comprobar", "Campaña de empresa"]],
      ["en", ["Organize", "Take part and check", "Company campaign"]],
    ] as const) {
      expect([T[lang].prCardOrganize, T[lang].prCardParticipate, T[lang].prCardCompany]).toEqual(labels);
      expect(T[lang].prCardPercentage).toBe("{p}");
    }
  });

  it("la fila estira las tarjetas por igual y pasa a una columna en celular, sin altura fija", () => {
    expect(rule(".precios-tarjetas")).toContain("display: grid");
    expect(rule(".precios-tarjetas")).toContain("grid-auto-columns: minmax(0, 1fr)");
    expect(rule(".precios-tarjetas")).toContain("grid-auto-flow: column");
    expect(rule(".precios-tarjetas")).toContain("align-items: stretch");
    expect(rule(".precios-tarjeta")).toContain("border: var(--bw) solid var(--ink)");
    expect(rule(".precios-tarjeta")).toContain("box-shadow: var(--sh)");
    expect(rule(".precios-tarjeta")).toContain("min-width: 0");
    expect(rule(".precios-tarjeta")).not.toMatch(/(?:^|;)\s*(?:min-|max-)?height:/);
    expect(css).toMatch(/@media \(max-width: 760px\)\s*\{\s*\.precios-tarjetas \{[^}]*grid-auto-flow: row;[^}]*grid-template-columns: minmax\(0, 1fr\)/);
  });

  it("no quedan letras menores de 16 px ni estilos en línea en el contenido de precios", () => {
    expect(document.querySelector("main [style]")).toBeNull();
    expect(html).toContain('class="precios-pagina"');
    const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(([, selector]) => selector?.includes(".precios-"));
    expect(rules.length).toBeGreaterThan(5);
    for (const [, selector, declarations] of rules) {
      for (const [, size] of (declarations ?? "").matchAll(/font-size:\s*(\d+)px/g)) {
        expect(Number(size), selector).toBeGreaterThanOrEqual(16);
      }
    }
    expect(rule(".precios-notas")).toContain("font-size: 16px");
    for (const selector of [".precios-pagina .kicker", ".precios-pagina details.tecnico summary", ".precios-pagina .langs button", ".precios-pagina footer .bar", ".precios-pagina .pies a"]) {
      expect(css, selector).toContain(selector);
    }
  });
});
