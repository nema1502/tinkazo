import { describe, expect, it } from "vitest";
import { TEXTOS_ALTA_PASO } from "./alta-textos-paso";
import { T } from "./i18n";

/** El título del paso de la cuenta que la sección 8 no trae, con las reglas de escritura de `alta-textos.test.ts`. */

const CLAVES = Object.keys(TEXTOS_ALTA_PASO.es);
const IDIOMAS = ["es", "en"] as const;

describe("el título del paso cuando solo falta el acceso", () => {
  it("están en español y en inglés, con texto, y llegan al diccionario del sitio", () => {
    expect(Object.keys(TEXTOS_ALTA_PASO.en).sort()).toEqual([...CLAVES].sort());
    expect(CLAVES.sort()).toEqual([
      "altaBienvenida",
      "altaBienvenidaLlena",
      "altaBienvenidaMasTarde",
      "altaRegaloEspera",
      "altaRegaloEspera1",
      "altaSinActivarAhora",
      "altaTituloSorteos",
      "cupoOfRecibir",
      "cupoOfRegaloError",
      "cupoOfRegaloListo",
      "modeOfficialBodyRegalo",
    ]);
    for (const k of CLAVES) for (const l of IDIOMAS) {
      expect(TEXTOS_ALTA_PASO[l][k]?.trim(), `${l} ${k}`).toBeTruthy();
      expect(T[l][k], `${l} ${k}`).toBe(TEXTOS_ALTA_PASO[l][k]);
    }
  });

  it("ninguno lleva punto medio, raya larga o media, flecha ni signo de exclamación", () => {
    const prohibido = /[·•—–―→←↑↓⇒⟶➜!¡]/;
    for (const k of CLAVES) for (const l of IDIOMAS) expect(TEXTOS_ALTA_PASO[l][k], `${l} ${k}`).not.toMatch(prohibido);
  });

  it("nunca rifa, lotería, raffle, ticket, boleto ni apuesta", () => {
    const palabras = /rifa|loter[ií]a|raffle|ticket|boleto|apuest|\bbet(s|ting)?\b|gambl/i;
    for (const k of CLAVES) for (const l of IDIOMAS) expect(TEXTOS_ALTA_PASO[l][k], `${l} ${k}`).not.toMatch(palabras);
  });

  it("nada de tecnicismos a la vista", () => {
    const tecnico = /\b(USDC|Stellar|exchange|memo|XLM|hash|firma|signature|contrato|contract|red principal|mainnet|testnet|drand|billetera|wallet|Pollar|token)\b/i;
    for (const k of CLAVES) for (const l of IDIOMAS) expect(TEXTOS_ALTA_PASO[l][k], `${l} ${k}`).not.toMatch(tecnico);
  });

  it("el modo Oficial se llama Oficial en español y Live en inglés", () => {
    for (const k of CLAVES) {
      expect(TEXTOS_ALTA_PASO.es[k], k).not.toMatch(/\bLive\b|\bTest\b/);
      expect(TEXTOS_ALTA_PASO.en[k], k).not.toMatch(/\bOficial\b|\bPrueba\b/);
    }
    expect(TEXTOS_ALTA_PASO.es.altaTituloSorteos).toContain("oficiales");
    expect(TEXTOS_ALTA_PASO.en.altaTituloSorteos).toContain("Live");
  });

  it("los del regalo llevan el número del servidor en {n} en los dos idiomas, salvo los que no dicen cuántos", () => {
    for (const k of ["altaBienvenida", "cupoOfRegaloListo", "modeOfficialBodyRegalo"])
      for (const l of IDIOMAS) expect(TEXTOS_ALTA_PASO[l][k], `${l} ${k}`).toContain("{n}");
    for (const l of IDIOMAS) expect(TEXTOS_ALTA_PASO[l].altaRegaloEspera, l).toContain("{min}");
    const sinNumero = [
      "altaBienvenidaLlena",
      "altaBienvenidaMasTarde",
      "altaSinActivarAhora",
      "altaRegaloEspera1",
      "cupoOfRecibir",
      "cupoOfRegaloError",
    ];
    for (const k of sinNumero)
      for (const l of IDIOMAS) expect(TEXTOS_ALTA_PASO[l][k], `${l} ${k}`).not.toContain("{");
  });

  it("los del regalo hablan como quien organiza: sin punto y coma ni comillas angulares", () => {
    for (const k of CLAVES) for (const l of IDIOMAS) expect(TEXTOS_ALTA_PASO[l][k], `${l} ${k}`).not.toMatch(/[;«»]/);
    expect(TEXTOS_ALTA_PASO.es.altaBienvenida).toMatch(/^Organizá /);
    expect(TEXTOS_ALTA_PASO.en.altaBienvenida).toMatch(/^Run /);
  });

  it("ninguno lleva el prefijo de las claves del paso que se cuentan aparte", () => {
    for (const k of CLAVES) expect(k, k).not.toMatch(/^cl[A-Z]/);
  });
});
