import { describe, expect, it } from "vitest";
import { TEXTOS_ALTA_CUENTA } from "./alta-textos-cuenta";
import { T } from "./i18n";
import { CLAVES_DE_MOTIVO } from "./stellar/alta-api";

/** Los textos del acceso que el diseño no trae, con las reglas de escritura de `alta-textos.test.ts`. */

const CLAVES = Object.keys(TEXTOS_ALTA_CUENTA.es);
const IDIOMAS = ["es", "en"] as const;

describe("los textos del acceso que la sección 8 no trae", () => {
  it("están en español y en inglés, con texto, y llegan al diccionario del sitio", () => {
    expect(Object.keys(TEXTOS_ALTA_CUENTA.en).sort()).toEqual([...CLAVES].sort());
    for (const k of CLAVES) for (const l of IDIOMAS) {
      expect(TEXTOS_ALTA_CUENTA[l][k]?.trim(), `${l} ${k}`).toBeTruthy();
      expect(T[l][k], `${l} ${k}`).toBe(TEXTOS_ALTA_CUENTA[l][k]);
    }
  });

  it("el 409 cuenta-de-otro del servidor tiene su texto, y no el error del servicio", () => {
    expect(CLAVES_DE_MOTIVO["cuenta-de-otro"]).toBe("altaErrCuentaDeOtro");
    expect(CLAVES).toContain("altaErrCuentaDeOtro");
  });

  it("dicen qué hacer: escribir a hola@tinkazo.app, y que en Prueba se sigue gratis", () => {
    expect(TEXTOS_ALTA_CUENTA.es.altaErrCuentaDeOtro).toContain("hola@tinkazo.app");
    expect(TEXTOS_ALTA_CUENTA.en.altaErrCuentaDeOtro).toContain("hola@tinkazo.app");
    expect(TEXTOS_ALTA_CUENTA.es.altaErrCuentaDeOtro).toContain("En Prueba seguís gratis.");
    expect(TEXTOS_ALTA_CUENTA.en.altaErrCuentaDeOtro).toContain("Test mode is still free.");
  });

  it("ninguno lleva punto medio, raya larga o media, flecha ni signo de exclamación", () => {
    const prohibido = /[·•—–―→←↑↓⇒⟶➜!¡]/;
    for (const k of CLAVES) for (const l of IDIOMAS) expect(TEXTOS_ALTA_CUENTA[l][k], `${l} ${k}`).not.toMatch(prohibido);
  });

  it("nunca rifa, lotería, raffle, ticket, boleto ni apuesta", () => {
    const palabras = /rifa|loter[ií]a|raffle|ticket|boleto|apuest|\bbet(s|ting)?\b|gambl/i;
    for (const k of CLAVES) for (const l of IDIOMAS) expect(TEXTOS_ALTA_CUENTA[l][k], `${l} ${k}`).not.toMatch(palabras);
  });

  it("nada de tecnicismos a la vista", () => {
    const tecnico = /\b(USDC|Stellar|exchange|memo|XLM|hash|firma|signature|contrato|contract|red principal|mainnet|testnet|drand|billetera|wallet|Pollar)\b/i;
    for (const k of CLAVES) for (const l of IDIOMAS) expect(TEXTOS_ALTA_CUENTA[l][k], `${l} ${k}`).not.toMatch(tecnico);
  });

  it("el modo Oficial se llama Oficial en español y Live en inglés, y el de prueba Prueba y Test", () => {
    for (const k of CLAVES) {
      expect(TEXTOS_ALTA_CUENTA.es[k], k).not.toMatch(/\bLive\b|\bTest\b|\bmain ?net\b/);
      expect(TEXTOS_ALTA_CUENTA.en[k], k).not.toMatch(/\bOficial\b|\bPrueba\b/);
    }
  });
});
