import { describe, expect, it } from "vitest";
import { TEXTOS_ALTA_PASO } from "./alta-textos-paso";
import { T } from "./i18n";

/** Los dos textos del paso de la cuenta que la sección 8 no trae, con las reglas de escritura de `alta-textos.test.ts`. */

const CLAVES = Object.keys(TEXTOS_ALTA_PASO.es);
const IDIOMAS = ["es", "en"] as const;

describe("los textos del paso cuando solo falta el acceso", () => {
  it("están en español y en inglés, con texto, y llegan al diccionario del sitio", () => {
    expect(Object.keys(TEXTOS_ALTA_PASO.en).sort()).toEqual([...CLAVES].sort());
    expect(CLAVES.sort()).toEqual(["altaBajadaUnPaso", "altaTituloSorteos"]);
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
});
