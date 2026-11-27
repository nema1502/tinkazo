import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { esLineaDePersona as esLineaDeLaSala, PREFIJO_DE_PERSONA as prefijoDeLaSala } from "../../workers/sala/src/linea-persona";
import { esLineaDePersona, PREFIJO_DE_PERSONA } from "./forma-persona";

/**
 * La comprobación de forma del sitio vive en un archivo sin importaciones para que el paquete principal no arrastre la
 * librería de firmas de la sala. Esta prueba exige que dé lo mismo que la de la sala sobre los vectores públicos y sobre
 * lo que no es una línea, y que el archivo no importe nada.
 */

interface Vectores {
  casos: { linea: string }[];
  campana: { lineas: string[]; ordenadas: string[] };
  formas: { validas: string[]; invalidas: string[] };
}

const vectores = JSON.parse(readFileSync(new URL("../../docs/vectors-persona.json", import.meta.url), "utf8")) as Vectores;

const NO_SON_TEXTO: unknown[] = [undefined, null, 0, 29, true, {}, [], ["p1:gd3ipw5vlh6roxgq3vs6tb3m5y"], new String("p1:gd3ipw5vlh6roxgq3vs6tb3m5y")];

const NO_SON_LINEA: string[] = [
  "",
  "p1:",
  "p1",
  "google:100000000000000000001",
  "GBZXN7PBXXNQXHVMZ5YOYUUQDWDXTHJ7LZPCOT5OPLVLNZKGZJLUMJCE",
  "ana@example.org",
  "p1:gd3ipw5vlh6roxgq3vs6tb3m5y ",
  "\np1:gd3ipw5vlh6roxgq3vs6tb3m5y",
  "p1:gd3ipw5vlh6roxgq3vs6tb3m5y\n",
  "p1:gd3ipw5vlh6roxgq3vs6tb3m5y0",
  "p1:gd3ipw5vlh6roxgq3vs6tb3m5",
  "p1:gd3ipw5vlh6roxgq3vs6tb3m5z",
  "p1:gd3ipw5vlh6roxgq3vs6tb3m50",
  "p1:gd3ipw5vlh6roxgq3vs6tb3m5y:p1:gd3ipw5vlh6roxgq3vs6tb3m5y",
  "q1:gd3ipw5vlh6roxgq3vs6tb3m5y",
  "p1;gd3ipw5vlh6roxgq3vs6tb3m5y",
];

describe("la forma de la línea de persona, sin la librería de firmas", () => {
  it("el prefijo es el de la sala", () => {
    expect(PREFIJO_DE_PERSONA).toBe(prefijoDeLaSala);
  });

  it("reconoce las formas válidas y rechaza las inválidas de los vectores, igual que la sala", () => {
    expect(vectores.formas.validas.length).toBeGreaterThan(0);
    expect(vectores.formas.invalidas.length).toBeGreaterThan(0);
    for (const t of vectores.formas.validas) {
      expect(esLineaDePersona(t), t).toBe(true);
      expect(esLineaDePersona(t)).toBe(esLineaDeLaSala(t));
    }
    for (const t of vectores.formas.invalidas) {
      expect(esLineaDePersona(t), JSON.stringify(t)).toBe(false);
      expect(esLineaDePersona(t)).toBe(esLineaDeLaSala(t));
    }
  });

  it("reconoce todas las líneas de los casos y de la campaña de los vectores", () => {
    const lineas = [...vectores.casos.map((c) => c.linea), ...vectores.campana.lineas, ...vectores.campana.ordenadas];
    expect(lineas.length).toBeGreaterThanOrEqual(6);
    for (const l of lineas) {
      expect(esLineaDePersona(l), l).toBe(true);
      expect(esLineaDeLaSala(l)).toBe(true);
    }
  });

  it("rechaza lo que no es una línea, igual que la sala", () => {
    for (const t of NO_SON_LINEA) {
      expect(esLineaDePersona(t), JSON.stringify(t)).toBe(false);
      expect(esLineaDePersona(t)).toBe(esLineaDeLaSala(t));
    }
  });

  it("rechaza lo que no es texto, igual que la sala", () => {
    for (const t of NO_SON_TEXTO) {
      expect(esLineaDePersona(t)).toBe(false);
      expect(esLineaDePersona(t)).toBe(esLineaDeLaSala(t));
    }
  });

  it("da lo mismo que la sala con todas las letras de cierre posibles", () => {
    const alfabeto = "abcdefghijklmnopqrstuvwxyz234567";
    for (const c of alfabeto) {
      const linea = `${PREFIJO_DE_PERSONA}${"a".repeat(25)}${c}`;
      expect(esLineaDePersona(linea), linea).toBe(esLineaDeLaSala(linea));
    }
  });

  it("el archivo no importa nada, así que no arrastra ninguna librería", () => {
    const fuente = readFileSync(new URL("./forma-persona.ts", import.meta.url), "utf8");
    expect(fuente).not.toMatch(/^\s*import\s/m);
    expect(fuente).not.toMatch(/\brequire\s*\(/);
    expect(fuente).not.toMatch(/\bimport\s*\(/);
    expect(fuente).not.toMatch(/^\s*export\s+[^\n]*\sfrom\s/m);
  });
});
