import { describe, expect, it } from "vitest";
import { TEXTOS_STAND_CAMPANA } from "./stand-campana-textos";

/**
 * Los textos del stand de una campaña: la misma lista de claves en los dos idiomas, con los mismos
 * marcadores `{..}` y sin espacios de más. Lo que la persona lee se prueba donde se usa.
 */
describe("los textos del stand de campaña", () => {
  it("trae la misma lista de claves en los dos idiomas", () => {
    const es = Object.keys(TEXTOS_STAND_CAMPANA.es).sort();
    const en = Object.keys(TEXTOS_STAND_CAMPANA.en).sort();
    expect(es.length).toBeGreaterThan(15);
    expect(es).toEqual(en);
    for (const clave of es) expect(clave.startsWith("sdc")).toBe(true);
  });

  it("los marcadores {..} coinciden en los dos idiomas", () => {
    for (const [clave, es] of Object.entries(TEXTOS_STAND_CAMPANA.es)) {
      const marcadores = [...(es.match(/\{[a-z]+\}/g) ?? [])].sort().join(",");
      const en = TEXTOS_STAND_CAMPANA.en[clave] ?? "";
      expect([...(en.match(/\{[a-z]+\}/g) ?? [])].sort().join(",")).toBe(marcadores);
    }
  });

  it("los textos están limpios, sin espacios de más y sin caja llena", () => {
    for (const claves of [TEXTOS_STAND_CAMPANA.es, TEXTOS_STAND_CAMPANA.en]) {
      for (const texto of Object.values(claves)) {
        expect(texto.trim()).toBe(texto);
        expect(texto).not.toContain("  ");
        expect(texto).not.toBe(texto.toUpperCase());
      }
    }
  });
});
