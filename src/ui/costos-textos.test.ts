import { describe, expect, it } from "vitest";
import { T } from "../i18n";
import { TEXTOS_COSTOS } from "./costos-textos";

/**
 * Los textos de la venta que el modo Oficial frena para no costar de más: los dos idiomas con las mismas claves, en el
 * diccionario, sin palabras de la cadena ni signos que no van, y sin prometer plazos.
 */
const JERGA = /\b(XLM|USDC|stroops?|testnet|mainnet|drand|hash(es)?|ledger|Stellar|blockchain|megas?|MB)\b|comisi[oó]n|network fee|\bred\b|network/i;
const PROHIBIDO = /rifa|loter[ií]a|raffle|ticket|boleto|apuesta|\bbet\b|lottery/i;
/** El punto medio, las rayas largas, las flechas y los signos de exclamación, escritos por su código. */
const SIGNOS = /[·—–←-⇿!¡]/;

describe("los textos de la venta frenada", () => {
  it("los dos idiomas tienen las mismas claves, y están en el diccionario", () => {
    expect(Object.keys(TEXTOS_COSTOS.en).sort()).toEqual(Object.keys(TEXTOS_COSTOS.es).sort());
    for (const idioma of ["es", "en"] as const) {
      for (const [k, v] of Object.entries(TEXTOS_COSTOS[idioma])) expect(T[idioma][k], `${idioma}.${k}`).toBe(v);
    }
  });

  it.each(["es", "en"] as const)("%s: sin palabras de la cadena, sin palabras de apuesta y sin signos que no van", (idioma) => {
    for (const [k, v] of Object.entries(TEXTOS_COSTOS[idioma])) {
      expect(v, `${idioma}.${k}`).not.toMatch(JERGA);
      expect(v, `${idioma}.${k}`).not.toMatch(PROHIBIDO);
      expect(v, `${idioma}.${k}`).not.toMatch(SIGNOS);
      expect(v.trim(), `${idioma}.${k}`).not.toBe("");
    }
  });

  it("solo la venta frenada: lo del sello y el sorteo de Oficial queda como en producción", () => {
    expect(Object.keys(TEXTOS_COSTOS.es).sort()).toEqual(["pagoPausado", "precioPausado"]);
  });
});
