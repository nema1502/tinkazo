import { afterEach, describe, expect, it, vi } from "vitest";
import { TEXTOS_CON_CUPON } from "./alta-textos-con-cupon";
import { TEXTOS_MODO_OFICIAL } from "./i18n-modo-oficial";

/**
 * Con el acceso por cupón en el build, las páginas de lectura dicen que en Oficial la comisión la cubre Tinkazo con un
 * cupón de evento, y los términos dicen qué guarda el servicio al canjear. Con la bandera apagada, lo de siempre.
 */

const IDIOMAS = ["es", "en"] as const;
const CLAVES = ["nextBody", "faq3a", "cfCostoB", "tmPatrocinio", "tmMore1"];
const DE_QUIEN_PAGA = ["nextBody", "faq3a", "cfCostoB", "tmPatrocinio"];

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function diccionario(alta: string) {
  vi.stubEnv("VITE_ALTA", alta);
  vi.resetModules();
  return (await import("./i18n")).T;
}

describe("los textos con cupón de las páginas de lectura", () => {
  it("son estas claves, en español y en inglés", () => {
    expect(Object.keys(TEXTOS_CON_CUPON.es).sort()).toEqual([...CLAVES].sort());
    expect(Object.keys(TEXTOS_CON_CUPON.en).sort()).toEqual([...CLAVES].sort());
  });

  it("quién paga: dicen que con el cupón la cubre Tinkazo, y siguen diciendo lo de la billetera propia", () => {
    for (const k of DE_QUIEN_PAGA) {
      expect(TEXTOS_CON_CUPON.es[k], k).toMatch(/cupón de tu evento/);
      expect(TEXTOS_CON_CUPON.en[k], k).toMatch(/coupon from your event/);
      expect(TEXTOS_CON_CUPON.es[k], k).toMatch(/propia billetera/);
      expect(TEXTOS_CON_CUPON.en[k], k).toMatch(/own wallet/);
    }
  });

  it("los términos dicen qué guarda el servicio al canjear y qué no, al final del texto de hoy", async () => {
    const T = await diccionario("");
    for (const l of IDIOMAS) expect(TEXTOS_CON_CUPON[l].tmMore1?.startsWith(T[l].tmMore1 as string), l).toBe(true);
    expect(TEXTOS_CON_CUPON.es.tmMore1).toMatch(/identificador de tu cuenta de Pollar junto a tu dirección pública, al evento del cupón/);
    expect(TEXTOS_CON_CUPON.es.tmMore1).toMatch(/No guarda tu correo, tu nombre, los datos de tu sesión ni el código del cupón/);
    expect(TEXTOS_CON_CUPON.en.tmMore1).toMatch(/your Pollar account's identifier along with your public address, the coupon's event/);
    expect(TEXTOS_CON_CUPON.en.tmMore1).toMatch(/doesn't store your email, your name, your session details or the coupon code/);
  });

  it("fuera de lo que agregan, son el texto del modo Oficial de hoy", () => {
    // La frase de quién paga es lo único nuevo: lo demás no se tocó.
    for (const l of IDIOMAS) {
      for (const k of ["nextBody", "cfCostoB"]) {
        const hoy = TEXTOS_MODO_OFICIAL[l][k] as string;
        const nuevo = TEXTOS_CON_CUPON[l][k] as string;
        expect(nuevo.slice(0, 60), `${l} ${k}`).toBe(hoy.slice(0, 60));
        expect(nuevo.slice(-60), `${l} ${k}`).toBe(hoy.slice(-60));
      }
      for (const k of ["faq3a", "tmPatrocinio"]) {
        const hoy = TEXTOS_MODO_OFICIAL[l][k] as string;
        const sinLaUltima = hoy.slice(0, hoy.lastIndexOf(l === "es" ? "En el modo Oficial" : "In Live mode"));
        expect((TEXTOS_CON_CUPON[l][k] as string).startsWith(sinLaUltima), `${l} ${k}`).toBe(true);
      }
    }
  });

  it("con las reglas de escritura, y lo nuevo en español sin tecnicismos", async () => {
    const T = await diccionario("");
    for (const k of CLAVES) {
      for (const l of IDIOMAS) {
        const texto = TEXTOS_CON_CUPON[l][k] as string;
        expect(texto, `${l} ${k}`).not.toMatch(/[·•—–―→←↑↓⇒⟶➜!¡]/);
        expect(texto, `${l} ${k}`).not.toMatch(/rifa|loter[ií]a|raffle|ticket|boleto|apuest|\bbet(s|ting)?\b|gambl/i);
      }
      // Lo que el texto de hoy no decía, en español: ni token, ni firma, ni contrato, ni red principal.
      const hoy = (T.es[k] as string).split(/(?<=\.)\s+/);
      const nuevo = (TEXTOS_CON_CUPON.es[k] as string).split(/(?<=\.)\s+/).filter((f) => !hoy.includes(f));
      for (const f of nuevo) expect(f, k).not.toMatch(/\b(token|hash|firma|contrato|red principal|mainnet|testnet|USDC|XLM|drand)\b/i);
      expect(TEXTOS_CON_CUPON.es[k], k).not.toMatch(/\bLive\b|\bTest\b/);
      expect(TEXTOS_CON_CUPON.en[k], k).not.toMatch(/\bOficial\b|\bPrueba\b/);
    }
  });

  it("con la bandera apagada, que es la de hoy, las páginas dicen lo de siempre", async () => {
    const T = await diccionario("");
    for (const l of IDIOMAS) {
      for (const k of DE_QUIEN_PAGA) expect(T[l][k], `${l} ${k}`).toBe(TEXTOS_MODO_OFICIAL[l][k]);
      expect(T[l].tmMore1, l).not.toMatch(/cupón|coupon/);
    }
  });

  it("con VITE_ALTA=1 en el build, dicen lo del cupón", async () => {
    const T = await diccionario("1");
    for (const k of CLAVES) for (const l of IDIOMAS) expect(T[l][k], `${l} ${k}`).toBe(TEXTOS_CON_CUPON[l][k]);
  });
});
