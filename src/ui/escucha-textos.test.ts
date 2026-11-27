// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ETIQUETAS_ESCUCHA, IDIOMAS_ESCUCHA, NOMBRES_ESCUCHA, nombreDeEtiqueta, TEXTOS_ESCUCHA, idiomaDeLaEscucha, nombreDeJuego, texto, type ClaveEscucha, type IdiomaEscucha } from "./escucha-textos";
import { IDENTIDADES } from "../music";

/**
 * Los textos de la página de escucha, en su propio diccionario (no en el global `src/i18n.ts`, que es lo más
 * pesado que baja la herramienta) y con paridad es/en: si falta una clave en inglés, quien elige la
 * música desde otro idioma ve un hueco donde debería leer qué está escuchando.
 */

const LANGS: IdiomaEscucha[] = ["es", "en"];

describe("el diccionario de la página de escucha", () => {
  it("es y en tienen exactamente las mismas claves", () => {
    const clavesEs = Object.keys(TEXTOS_ESCUCHA.es).sort();
    const clavesEn = Object.keys(TEXTOS_ESCUCHA.en).sort();
    expect(clavesEn).toEqual(clavesEs);
    expect(clavesEs.length).toBeGreaterThan(10);
    for (const lang of LANGS) for (const clave of clavesEs as ClaveEscucha[]) {
      const v = TEXTOS_ESCUCHA[lang][clave];
      expect(typeof v, `${lang}.${clave}`).toBe("string");
      expect((v as string).length).toBeGreaterThan(0);
    }
  });

  it("texto() devuelve lo que dice el diccionario, y los dos idiomas existen", () => {
    expect(IDIOMAS_ESCUCHA).toEqual(["es", "en"]);
    expect(texto("es", "capaTension")).toBe("Tensión");
    expect(texto("en", "capaTension")).toBe("Tension");
  });

  it("sin ?lang= se usa el idioma que la persona ya eligió en el sitio", () => {
    try {
      localStorage.setItem("tinkazo.lang", "en");
      expect(idiomaDeLaEscucha("")).toBe("en");
      expect(idiomaDeLaEscucha("?lang=es")).toBe("es");
    } finally {
      localStorage.removeItem("tinkazo.lang");
    }
    expect(idiomaDeLaEscucha("")).toBe("es");
  });

  it("el idioma sale de la dirección: ?lang=en, el resto español", () => {
    expect(idiomaDeLaEscucha("?lang=en")).toBe("en");
    expect(idiomaDeLaEscucha("?lang=es")).toBe("es");
    expect(idiomaDeLaEscucha("")).toBe("es");
    expect(idiomaDeLaEscucha("?escucha=1")).toBe("es");
  });

  it("cada juego con identidad tiene su nombre en los dos idiomas", () => {
    for (const id of Object.keys(IDENTIDADES)) {
      expect(NOMBRES_ESCUCHA[id], id).toBeTruthy();
      for (const lang of LANGS) {
        const nombre = NOMBRES_ESCUCHA[id]![lang];
        expect(nombre.length, `${id} ${lang}`).toBeGreaterThan(0);
        expect(nombreDeJuego(id, lang)).toBe(nombre);
      }
    }
    // Un id que no existe cae con el id, que nunca queda sin nombre.
    expect(nombreDeJuego("no-existe", "en")).toBe("no-existe");
  });
});

describe("lo que lee la persona en la página de escucha", () => {
  it("cada ritmo y cada instrumento de las identidades tiene su par en los dos idiomas", () => {
    for (const id of Object.values(IDENTIDADES)) {
      for (const etiqueta of [...id.ritmos, ...id.instrumentos]) {
        expect(ETIQUETAS_ESCUCHA[etiqueta], etiqueta).toBeTruthy();
        for (const lang of LANGS) expect(nombreDeEtiqueta(etiqueta, lang).length, `${etiqueta} ${lang}`).toBeGreaterThan(0);
      }
    }
    expect(nombreDeEtiqueta("zampoña", "en")).toBe("panpipes");
    expect(nombreDeEtiqueta("no-existe", "en")).toBe("no-existe");
  });

  it("ninguna cadena obliga a leer una dirección ni usa jerga de técnico, ni comillas angulares ni punto y coma", () => {
    for (const lang of LANGS) {
      for (const [clave, v] of Object.entries(TEXTOS_ESCUCHA[lang])) {
        expect(v, `${lang}.${clave}`).not.toMatch(/\?\w+=/);
        expect(v, `${lang}.${clave}`).not.toMatch(/semilla|sintetizad|seed|synthesi/i);
        expect(v, `${lang}.${clave}`).not.toMatch(/[«»;]/);
      }
    }
  });
});

describe("la página usa el diccionario propio, sin data-i del global", () => {
  const html = readFileSync("escucha.html", "utf8");

  it("el HTML no trae claves del diccionario global (los textos los arma escucha.ts)", () => {
    expect(html).not.toMatch(/data-(?:i|i-html|i-title)\s*=/);
  });

  it("los botones que la página arma cubren las claves de las capas", async () => {
    const src = readFileSync("src/ui/escucha.ts", "utf8");
    for (const clave of ["capaEspera", "capaTension", "capaGanador", "capaFestejo", "btnTodo", "votar", "quitar", "apagada"] as ClaveEscucha[])
      expect(src).toContain(`"${clave}"`);
  });
});
