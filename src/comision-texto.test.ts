// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cuentaDePrueba } from "./campana/cuentas-de-prueba";
import { comisionTexto, conLaComision, pintarLaComision } from "./comision-texto";
import { T, onLangChange, setLang } from "./i18n";

/**
 * Lo que cobra Tinkazo a una campaña de empresa, dicho en las páginas públicas: los números salen de la configuración del
 * build, y sin ella las páginas traen su bloque en un molde cerrado y no dicen nada. Las páginas se cargan tal como están
 * escritas, sin red.
 */

const CONFIGURADA = {
  VITE_COMISION_PB: "200",
  VITE_COMISION_MINIMO: "1.50",
  VITE_COMISION_CUENTA: cuentaDePrueba(2),
  VITE_RETIRO_COSTO: "0.50",
  VITE_RETIRO_CUENTA: cuentaDePrueba(1),
};

const leer = (f: string): string => readFileSync(resolve(process.cwd(), f), "utf8");
const cuerpo = (f: string): string => /<body>([\s\S]*)<\/body>/.exec(leer(f))?.[1]?.replace(/<script[\s\S]*?<\/script>/g, "") ?? "";
const dicho = (el: Element | null): string => (el?.textContent ?? "").replace(/\s+/g, " ").trim();

let prendida = false;
beforeAll(() => {
  onLangChange((l) => pintarLaComision(document, prendida ? comisionTexto(l, CONFIGURADA) : null));
});
beforeEach(() => {
  prendida = false;
  // Sin la comisión configurada, aunque la máquina que corre las pruebas tenga las variables en su `.env.local`.
  vi.stubEnv("VITE_COMISION_PB", "");
  vi.stubEnv("VITE_COMISION_MINIMO", "");
  vi.stubEnv("VITE_COMISION_CUENTA", "");
  setLang("es");
});
afterEach(() => {
  vi.unstubAllEnvs();
  document.body.innerHTML = "";
});

describe("los números", () => {
  it("sin configuración no se dice nada, en los dos idiomas", () => {
    expect(comisionTexto("es", {})).toBeNull();
    expect(comisionTexto("en", {})).toBeNull();
  });

  it("con la configuración, en español: 2 %, 1,50 y 122,40", () => {
    expect(comisionTexto("es", CONFIGURADA)).toEqual({ p: "2 %", m: "1,50", e: "122,40" });
  });

  it("con la configuración, en inglés: 2%, 1.50 y 122.40", () => {
    expect(comisionTexto("en", CONFIGURADA)).toEqual({ p: "2%", m: "1.50", e: "122.40" });
  });

  it("con otro porcentaje y otro mínimo, otros números", () => {
    const c = comisionTexto("es", { ...CONFIGURADA, VITE_COMISION_PB: "250", VITE_COMISION_MINIMO: "2" });
    expect(c).toEqual({ p: "2,5 %", m: "2,00", e: "123,00" });
  });

  it("con una variable de menos no se dice nada", () => {
    expect(comisionTexto("es", { ...CONFIGURADA, VITE_COMISION_CUENTA: "" })).toBeNull();
  });

  it("sin pasarle el entorno, lee el del sitio, que está vacío", () => {
    expect(comisionTexto("es")).toBeNull();
  });

  it("cambia cada marcador del texto por su número", () => {
    expect(conLaComision("{p} de todo, mínimo {m}, ejemplo {e}, otra vez {p}", { p: "2 %", m: "1,50", e: "122,40" })).toBe(
      "2 % de todo, mínimo 1,50, ejemplo 122,40, otra vez 2 %",
    );
  });
});

describe("los moldes de una página", () => {
  const molde = (): string =>
    `<template data-con-comision><section data-comision><h2 data-i="x">Cuánto</h2><p data-i="y">Paga {p}, mínimo {m}, carga {e}.</p></section></template>` +
    `<p data-i="z">Afuera {p} queda como está.</p>`;

  it("con la comisión abre el molde y cambia los marcadores en cada texto del bloque", () => {
    document.body.innerHTML = molde();
    pintarLaComision(document, { p: "2 %", m: "1,50", e: "122,40" });
    expect(document.querySelector("template")).toBeNull();
    expect(document.querySelector('[data-i="y"]')?.textContent).toBe("Paga 2 %, mínimo 1,50, carga 122,40.");
  });

  it("no toca los textos de afuera del bloque", () => {
    document.body.innerHTML = molde();
    pintarLaComision(document, { p: "2 %", m: "1,50", e: "122,40" });
    expect(document.querySelector('[data-i="z"]')?.textContent).toBe("Afuera {p} queda como está.");
  });

  it("sin la comisión deja el molde cerrado y la página como estaba", () => {
    document.body.innerHTML = molde();
    const antes = document.body.innerHTML;
    pintarLaComision(document, null);
    expect(document.body.innerHTML).toBe(antes);
    expect(document.querySelector("[data-comision]")).toBeNull();
  });

  it("sin pasarle los números usa los de la configuración, que está vacía, y no abre nada", () => {
    document.body.innerHTML = molde();
    pintarLaComision(document);
    expect(document.querySelector("template[data-con-comision]")).not.toBeNull();
  });

  it("llamarla dos veces deja lo mismo", () => {
    document.body.innerHTML = molde();
    pintarLaComision(document, { p: "2 %", m: "1,50", e: "122,40" });
    const una = document.body.innerHTML;
    pintarLaComision(document, { p: "2 %", m: "1,50", e: "122,40" });
    expect(document.body.innerHTML).toBe(una);
  });

  it("un elemento con otra clave para cuando hay comisión pasa a usarla", () => {
    document.body.innerHTML = `<p data-i="prNote" data-i-con-comision="prNoteComision">hoy</p>`;
    pintarLaComision(document, { p: "2 %", m: "1,50", e: "122,40" });
    const p = document.querySelector("p");
    expect(p?.dataset.i).toBe("prNoteComision");
    expect(p?.textContent).toBe(T.es.prNoteComision);
  });

  it("sin la comisión ese elemento queda como estaba", () => {
    document.body.innerHTML = `<p data-i="prNote" data-i-con-comision="prNoteComision">hoy</p>`;
    pintarLaComision(document, null);
    expect(document.querySelector("p")?.dataset.i).toBe("prNote");
    expect(document.querySelector("p")?.textContent).toBe("hoy");
  });
});

describe.each([
  { pagina: "terminos.html", titulo: "tmComisionT", texto: "tmComisionB", enlaces: [] as string[] },
  // En precios, el bloque lleva además el enlace a armar la campaña de la empresa.
  { pagina: "precios.html", titulo: "prComisionT", texto: "prComision", enlaces: ["prComisionLink"] },
])("$pagina", ({ pagina, titulo, texto, enlaces }) => {
  const montar = (): void => {
    document.body.innerHTML = cuerpo(pagina);
  };

  it("trae un solo molde de la comisión, con un bloque de título y texto", () => {
    montar();
    const moldes = document.querySelectorAll<HTMLTemplateElement>("template[data-con-comision]");
    expect(moldes).toHaveLength(1);
    const claves = [...(moldes[0]?.content.querySelectorAll<HTMLElement>("[data-i]") ?? [])].map((el) => el.dataset.i);
    expect(claves).toEqual(pagina === "precios.html"
      ? ["prCardCompany", "prCardPercentage", titulo, texto, ...enlaces]
      : [titulo, texto, ...enlaces]);
  });

  it("el molde trae el texto en español del diccionario, con marcadores y sin el porcentaje ni el mínimo escritos", () => {
    montar();
    const molde = document.querySelector<HTMLTemplateElement>("template[data-con-comision]");
    expect(dicho(molde?.content.querySelector(`[data-i="${texto}"]`) ?? null)).toBe(T.es[texto]);
    expect(T.es[texto]).toContain("{p}");
    expect(T.es[texto]).toContain("{m}");
    expect(String(T.es[texto])).not.toMatch(/%|\d[,.]\d/);
  });

  it("sin la comisión configurada la página no dice nada de ella", () => {
    montar();
    setLang("es");
    expect(document.querySelector("[data-comision]")).toBeNull();
    expect(document.body.textContent).not.toMatch(/\{p\}|\{m\}|\{e\}/);
  });

  it("con la comisión, en español, dice 2 %, 1,50 y no deja marcadores", () => {
    montar();
    prendida = true;
    setLang("en");
    setLang("es");
    const bloque = document.querySelector("[data-comision]");
    expect(bloque).not.toBeNull();
    expect(dicho(bloque)).toContain("2 %");
    expect(dicho(bloque)).toContain("1,50");
    expect(dicho(bloque)).not.toMatch(/\{[pme]\}/);
  });

  it("con la comisión, en inglés, dice 2%, 1.50 y no deja marcadores", () => {
    montar();
    prendida = true;
    setLang("en");
    const bloque = document.querySelector("[data-comision]");
    expect(dicho(bloque)).toContain("2%");
    expect(dicho(bloque)).toContain("1.50");
    expect(dicho(bloque)).not.toMatch(/\{[pme]\}/);
  });

  it("vuelve a pintar tras cambiar de idioma", () => {
    montar();
    prendida = true;
    setLang("es");
    expect(dicho(document.querySelector(`[data-i="${texto}"]`))).toContain("2 %");
    setLang("en");
    expect(dicho(document.querySelector(`[data-i="${texto}"]`))).toContain("2%");
    setLang("es");
    expect(dicho(document.querySelector(`[data-i="${texto}"]`))).toContain("2 %");
  });
});

describe("la página de precios y la respuesta de hoy", () => {
  it("la nota de arriba pasa al texto con la comisión y dice que las campañas pagan un porcentaje", () => {
    document.body.innerHTML = cuerpo("precios.html");
    prendida = true;
    setLang("en");
    setLang("es");
    const nota = document.querySelector<HTMLElement>(".lead");
    expect(nota?.dataset.i).toBe("prNoteComision");
    expect(dicho(nota)).toBe(T.es.prNoteComision);
  });

  it("sin la comisión la nota de arriba queda como está", () => {
    document.body.innerHTML = cuerpo("precios.html");
    setLang("es");
    expect(document.querySelector<HTMLElement>(".lead")?.dataset.i).toBe("prNote");
  });
});

describe("los textos nuevos", () => {
  const CLAVES = ["prComisionT", "prComision", "prNoteComision", "tmComisionT", "tmComisionB"];

  it("están en los dos idiomas", () => {
    for (const k of CLAVES) {
      expect(typeof T.es[k], `es.${k}`).toBe("string");
      expect(typeof T.en[k], `en.${k}`).toBe("string");
    }
  });

  it("llevan los mismos marcadores en los dos idiomas", () => {
    const marcadores = (t: unknown): string[] => [...String(t).matchAll(/\{[a-z]\}/g)].map((m) => m[0]).sort();
    for (const k of CLAVES) expect(marcadores(T.en[k]), k).toEqual(marcadores(T.es[k]));
  });

  it("sin punto y coma, comillas, raya larga, punto medio ni exclamaciones, y sin palabras de azar", () => {
    for (const idioma of ["es", "en"] as const) {
      for (const k of CLAVES) {
        const t = String(T[idioma][k]);
        expect(t, `${idioma}.${k}`).not.toMatch(/[;«»"“”—–·¡!]/u);
        expect(t, `${idioma}.${k}`).not.toMatch(/\b(?:rifa|loter[ií]a|boleto|ticket|apuesta|raffle|lottery|bet|fee)\b/iu);
      }
    }
  });

  it("el inglés no usa la palabra fee, que es la de la comisión de la red", () => {
    for (const k of CLAVES) expect(String(T.en[k])).not.toMatch(/\bfees?\b/i);
  });
});
