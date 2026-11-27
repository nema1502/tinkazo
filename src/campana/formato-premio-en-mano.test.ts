import { describe, expect, it } from "vitest";
import { premiosTexto, textoDelPremio } from "./formato";
import { TEXTOS_CAMPANA } from "./textos";

const EN_MANO = { es: "Auriculares", en: "Headphones" };

describe("textoDelPremio", () => {
  it("sin premio en mano dice lo mismo que premiosTexto, con y sin centavos", () => {
    for (const premios of [[400_000_000n], [400_000_000n, 400_000_000n], [400_000_000n, 125_000_000n]]) {
      for (const idioma of ["es", "en"] as const) {
        expect(textoDelPremio({ premios }, idioma)).toBe(premiosTexto(premios, idioma));
        expect(textoDelPremio({ premios }, idioma, true)).toBe(premiosTexto(premios, idioma, true));
      }
    }
  });

  it("con premio en mano y una sola persona dice solo el premio, en cada idioma", () => {
    expect(textoDelPremio({ premios: [0n], premioEnMano: EN_MANO }, "es")).toBe("Auriculares");
    expect(textoDelPremio({ premios: [0n], premioEnMano: EN_MANO }, "en")).toBe("Headphones");
  });

  it("con premio en mano y varias personas dice el premio y para cuántas, en cada idioma", () => {
    const tres = { premios: [0n, 0n, 0n], premioEnMano: EN_MANO };
    expect(textoDelPremio(tres, "es")).toBe("Auriculares, para 3 personas");
    expect(textoDelPremio(tres, "en")).toBe("Headphones, for 3 people");
  });

  it("con premio en mano no nombra dólares ni dice cero", () => {
    for (const idioma of ["es", "en"] as const) {
      for (const n of [1, 2, 10]) {
        const texto = textoDelPremio({ premios: Array(n).fill(0n) as bigint[], premioEnMano: EN_MANO }, idioma);
        expect(texto).not.toMatch(/d[oó]lar|dollar|\b0\b/iu);
      }
    }
  });

  it("el premio se escribe tal cual, aunque lleve llaves o signos de pesos", () => {
    const raro = { es: "JBL {n} $& iPhone", en: "JBL {premio} $1 iPhone" };
    expect(textoDelPremio({ premios: [0n], premioEnMano: raro }, "es")).toBe("JBL {n} $& iPhone");
    expect(textoDelPremio({ premios: [0n, 0n], premioEnMano: raro }, "en")).toBe("JBL {premio} $1 iPhone, for 2 people");
  });

  it("los textos nuevos existen en los dos idiomas, sin comillas angulares ni punto y coma", () => {
    for (const idioma of ["es", "en"] as const) {
      for (const clave of ["cpPremioMano1", "cpPremioManoVarios"]) {
        const texto = TEXTOS_CAMPANA[idioma][clave] ?? "";
        expect(texto, `${idioma} ${clave}`).not.toBe("");
        expect(texto).not.toMatch(/[«»;]/u);
      }
    }
  });
});
