import { afterEach, describe, expect, it, vi } from "vitest";
import { T } from "./i18n";
import { TEXTOS_MODO_OFICIAL } from "./i18n-modo-oficial";
import { viaDe } from "./ui/cuenta-estado";

/**
 * La billetera del navegador se llama Varial desde el 29 de octubre de 2026. Lo que lee la persona dice Varial, y el nombre
 * viejo aparece solo como ayuda, entre paréntesis y pegado al nombre nuevo, para quien todavía la conoce por Freighter.
 * Los identificadores de código (el paquete, las claves de sesión y de métricas) conservan el nombre viejo a propósito.
 */

const AYUDA = { es: "Varial (antes Freighter)", en: "Varial (formerly Freighter)" } as const;

function textos(): { donde: string; lang: "es" | "en"; texto: string }[] {
  const salida: { donde: string; lang: "es" | "en"; texto: string }[] = [];
  for (const lang of ["es", "en"] as const) {
    const fuentes: [string, Record<string, unknown>][] = [
      ["i18n", T[lang]],
      ["i18n-modo-oficial", TEXTOS_MODO_OFICIAL[lang]],
    ];
    for (const [nombre, dic] of fuentes) {
      for (const [clave, valor] of Object.entries(dic)) {
        const lista = Array.isArray(valor) ? valor : [valor];
        for (const v of lista) if (typeof v === "string") salida.push({ donde: `${nombre}.${lang}.${clave}`, lang, texto: v });
      }
    }
  }
  return salida;
}

describe("el nombre de la billetera en los textos", () => {
  it("el nombre viejo solo aparece como ayuda, pegado al nombre nuevo", () => {
    const sueltos = textos()
      .filter((x) => /freighter/i.test(x.texto.split(AYUDA[x.lang]).join("")))
      .map((x) => x.donde);
    expect(sueltos).toEqual([]);
  });

  it("ninguna ayuda se repite dentro de un mismo texto", () => {
    const repetidos = textos()
      .filter((x) => x.texto.split(AYUDA[x.lang]).length > 2)
      .map((x) => x.donde);
    expect(repetidos).toEqual([]);
  });

  it("la lista de entrar y la página de ayuda dicen Varial (antes Freighter) en los dos idiomas", () => {
    for (const lang of ["es", "en"] as const) {
      expect(String(T[lang].freighterHint)).toContain(AYUDA[lang]);
      expect(String(T[lang].freighterInstall)).toContain(AYUDA[lang]);
      expect(String(T[lang].cfG4b)).toContain(AYUDA[lang]);
      expect(String(T[lang].vFinishNoWallet)).toContain(AYUDA[lang]);
      expect(String(TEXTOS_MODO_OFICIAL[lang].cfG4b)).toContain(AYUDA[lang]);
      expect(String(TEXTOS_MODO_OFICIAL[lang].vFinishNoWallet)).toContain(AYUDA[lang]);
    }
  });

  it("el aviso y la etiqueta de la cuenta dicen Varial, y el enlace de instalación es el nuevo", () => {
    expect(T.es.cuentaViaFreighter).toBe("Varial");
    expect(T.en.cuentaViaFreighter).toBe("Varial");
    expect(T.es.cuentaAvisoFreighter).toBe("Entraste con Varial");
    expect(T.en.cuentaAvisoFreighter).toBe("Signed in with Varial");
    for (const lang of ["es", "en"] as const) {
      expect(String(T[lang].freighterInstall)).toContain("varialwallet.com");
      expect(String(T[lang].freighterInstall)).not.toContain("freighter.app");
    }
  });
});

describe("la etiqueta de la cuenta que ve la persona", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("la billetera del navegador se etiqueta Varial y su vía sigue siendo freighter", async () => {
    vi.resetModules();
    vi.stubGlobal("location", { search: "" });
    vi.stubGlobal("sessionStorage", { getItem: () => null, setItem: () => undefined, removeItem: () => undefined });
    const { freighterWallet } = await import("./stellar/wallet-lite");
    expect(freighterWallet.label).toBe("Varial");
    expect(viaDe(freighterWallet.label)).toBe("freighter");
  });
});
