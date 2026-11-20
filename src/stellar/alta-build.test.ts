import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  FRASES_CUPON_DE_ENTRADA,
  FRASES_DEL_REGALO,
  PAGINAS_SIN_CUPON_DE_ENTRADA,
  problemasDeLasPaginasEnOficial,
  problemasDelRegaloSinDar,
} from "../alta-textos-con-cobro";
import { problemasDeAlta } from "./alta-build";

/**
 * El freno del build para el modo con el que abre el sitio (`VITE_STELLAR_NETWORK`): un valor que no se entiende no
 * sale, y la publicación de producción que abre en Oficial pide el paso de la cuenta, la llave de Pollar de la red
 * principal y páginas que no pidan el cupón de tu evento para entrar. Sin la variable, todo sale como hoy.
 */

const PORTERO = "https://pm.tinkazo.app";
/** La publicación de producción que abre en Oficial, con todo lo que pide. */
const OFICIAL = {
  VERCEL_ENV: "production",
  VITE_STELLAR_NETWORK: "mainnet",
  VITE_ALTA: "1",
  VITE_PATROCINIO_URL_MAINNET: PORTERO,
  VITE_POLLAR_PUBLISHABLE_KEY_MAINNET: "pub_de_prueba",
};

const raiz = new URL("../../", import.meta.url);
/** Las páginas de la raíz tal como están escritas hoy. */
const HOY: Readonly<Record<string, string>> = Object.fromEntries(
  readdirSync(raiz)
    .filter((f) => f.endsWith(".html"))
    .map((f) => [f, readFileSync(new URL(f, raiz), "utf8")]),
);
/** Las mismas páginas ya sin las frases del cupón de entrada, con el texto de los primeros sorteos gratis. */
const sinFrases = (html: string): string =>
  FRASES_CUPON_DE_ENTRADA.reduce((h, frase) => h.replace(new RegExp(frase.source, "gi"), "los primeros"), html);
const SIN_CUPON: Readonly<Record<string, string>> = Object.fromEntries(Object.entries(HOY).map(([pagina, html]) => [pagina, sinFrases(html)]));

describe("problemasDeAlta, el modo con el que abre el sitio", () => {
  it("sin la variable sale, como hoy", () => {
    expect(problemasDeAlta({})).toEqual([]);
    expect(problemasDeAlta({ VITE_STELLAR_NETWORK: "" })).toEqual([]);
    expect(problemasDeAlta({ VITE_STELLAR_NETWORK: "   " })).toEqual([]);
  });

  it("con las palabras de ?red= sale, en mayúsculas o minúsculas", () => {
    for (const red of ["mainnet", "oficial", "live", "Mainnet", "OFICIAL", "testnet", "prueba", "test", " mainnet "]) {
      expect(problemasDeAlta({ VITE_STELLAR_NETWORK: red }), red).toEqual([]);
    }
  });

  it("con un valor que no se entiende no sale, y lo dice sin escribir el valor", () => {
    const dichos = ["red-principal", "main", "public", "1", "true"].map((red) => {
      const p = problemasDeAlta({ VITE_STELLAR_NETWORK: red });
      expect(p, red).toHaveLength(1);
      expect(p[0]).toContain("VITE_STELLAR_NETWORK");
      return p[0];
    });
    // El mismo aviso para cualquier valor: no lo repite.
    expect(new Set(dichos).size).toBe(1);
  });

  it("la publicación de producción que abre en Oficial, con todo lo que pide, sale", () => {
    expect(problemasDeAlta(OFICIAL)).toEqual([]);
    expect(problemasDeAlta({ ...OFICIAL, VITE_STELLAR_NETWORK: "oficial" })).toEqual([]);
  });

  it("la publicación de producción que abre en Oficial no sale sin VITE_ALTA=1", () => {
    const p = problemasDeAlta({ ...OFICIAL, VITE_ALTA: "" });
    expect(p.some((x) => x.includes("abre en Oficial") && x.includes("VITE_ALTA=1"))).toBe(true);
  });

  it("la publicación de producción que abre en Oficial no sale con el plan B1 en vez del paso de la cuenta", () => {
    const p = problemasDeAlta({ ...OFICIAL, VITE_ALTA: "", VITE_ALTA_LIBRE: "1" });
    expect(p).toHaveLength(1);
    expect(p[0]).toContain("abre en Oficial");
  });

  it("la publicación de producción que abre en Oficial no sale con un portero que no es el de la red principal", () => {
    const p = problemasDeAlta({ ...OFICIAL, VITE_PATROCINIO_URL_MAINNET: "https://p.tinkazo.app" });
    expect(p).toHaveLength(1);
    expect(p[0]).toContain("VITE_PATROCINIO_URL_MAINNET");
  });

  it("la publicación de producción que abre en Oficial no sale sin la llave de Pollar de la red principal", () => {
    for (const llave of [undefined, "", "  "]) {
      const p = problemasDeAlta({ ...OFICIAL, VITE_POLLAR_PUBLISHABLE_KEY_MAINNET: llave });
      expect(p, JSON.stringify(llave)).toHaveLength(1);
      expect(p[0]).toContain("VITE_POLLAR_PUBLISHABLE_KEY_MAINNET");
    }
  });

  it("la llave de Pollar y el paso de la cuenta solo se piden en producción y abriendo en Oficial", () => {
    expect(problemasDeAlta({ VITE_STELLAR_NETWORK: "mainnet" })).toEqual([]);
    expect(problemasDeAlta({ VERCEL_ENV: "preview", VITE_STELLAR_NETWORK: "mainnet" })).toEqual([]);
    const prueba = { VERCEL_ENV: "production", VITE_STELLAR_NETWORK: "testnet", VITE_ALTA: "1", VITE_PATROCINIO_URL_MAINNET: PORTERO };
    expect(problemasDeAlta(prueba)).toEqual([]);
  });

  it("no escribe el valor de ninguna variable", () => {
    const env = { ...OFICIAL, VITE_ALTA: "", VITE_POLLAR_PUBLISHABLE_KEY_MAINNET: "", VITE_PATROCINIO_URL_MAINNET: "https://secreto.example" };
    expect(problemasDeAlta(env).join(" ")).not.toMatch(/secreto|pub_|https?:/);
  });
});

describe("problemasDeLasPaginasEnOficial, las páginas sin el cupón de entrada", () => {
  it("sin la variable en Oficial, o fuera de producción, nunca frena: hoy esas páginas dicen la verdad", () => {
    for (const env of [{}, { VERCEL_ENV: "production" }, { ...OFICIAL, VITE_STELLAR_NETWORK: "testnet" }, { ...OFICIAL, VERCEL_ENV: "preview" }]) {
      expect(problemasDeLasPaginasEnOficial(env, HOY), JSON.stringify(env)).toEqual([]);
    }
  });

  it("con las páginas de hoy, que dicen que los primeros sorteos oficiales son gratis, la publicación de producción que abre en Oficial sale", () => {
    expect(problemasDeLasPaginasEnOficial(OFICIAL, HOY)).toEqual([]);
  });

  it("con las páginas de antes, que pedían el cupón de tu evento, no sale, y nombra cada página", () => {
    const paginas = ["precios.html", "terminos.html", "como-funciona.html"];
    const antes: Record<string, string> = { ...HOY };
    for (const pagina of paginas) antes[pagina] = `${HOY[pagina] ?? ""}<p>El modo Oficial también, con el cupón de tu evento.</p>`;
    const p = problemasDeLasPaginasEnOficial(OFICIAL, antes);
    for (const pagina of paginas) expect(p.some((x) => x.startsWith(pagina)), pagina).toBe(true);
  });

  it("con las páginas que ya no piden el cupón para entrar, sale", () => {
    expect(problemasDeLasPaginasEnOficial(OFICIAL, SIN_CUPON)).toEqual([]);
  });

  it("una sola frase alcanza para frenarla, en español o en inglés", () => {
    for (const frase of ["El modo Oficial también, con el cupón de tu evento.", "Live mode too, with a coupon from your event."]) {
      const p = problemasDeLasPaginasEnOficial(OFICIAL, { ...SIN_CUPON, "index.html": `<p>${frase}</p>` });
      expect(p, frase).toHaveLength(1);
      expect(p[0]).toMatch(/^index\.html/);
    }
  });

  it("mira solo las cuatro páginas que ve primero quien llega", () => {
    expect(PAGINAS_SIN_CUPON_DE_ENTRADA).toEqual(["precios.html", "terminos.html", "index.html", "como-funciona.html"]);
    expect(problemasDeLasPaginasEnOficial(OFICIAL, { ...SIN_CUPON, "evento.html": "<p>con el cupón de tu evento</p>" })).toEqual([]);
  });

  it("el cupón que sigue valiendo no frena: lo que se guarda al canjear uno y el registro de equipos con cupón", () => {
    const html = "<p>Si canjeás un cupón de evento, ese servicio confirma tu sesión.</p><p>el registro de equipos de un evento con cupón</p>";
    expect(problemasDeLasPaginasEnOficial(OFICIAL, { ...SIN_CUPON, "terminos.html": html })).toEqual([]);
  });

  it("vite.config.ts frena el build con esta regla y le pasa el entorno de la publicación", () => {
    const config = readFileSync(new URL("../../vite.config.ts", import.meta.url), "utf8");
    expect(config).toMatch(/problemasDeLasPaginasEnOficial\(loadEnv\(mode, __dirname, \["VITE_", "VERCEL_ENV"\]\), paginas\)/);
  });
});

describe("problemasDelRegaloSinDar, las páginas no prometen el regalo antes de que se dé", () => {
  /** Las páginas de hoy y las fuentes de los dos diccionarios, con los nombres que les pone vite.config.ts. */
  const TEXTOS: Readonly<Record<string, string>> = {
    ...HOY,
    "src/i18n.ts": readFileSync(new URL("../i18n.ts", import.meta.url), "utf8"),
    "src/i18n-modo-oficial.ts": readFileSync(new URL("../i18n-modo-oficial.ts", import.meta.url), "utf8"),
    "src/costo-del-retiro-portada.ts": readFileSync(new URL("../costo-del-retiro-portada.ts", import.meta.url), "utf8"),
  };
  const PRODUCCION = { VERCEL_ENV: "production", VITE_ALTA: "1" };

  it("fuera de producción nunca frena: las vistas previas, la CI y los builds locales sirven para probarlo", () => {
    for (const env of [{}, { VERCEL_ENV: "preview" }, { VERCEL_ENV: "development" }, { ...OFICIAL, VERCEL_ENV: "preview" }]) {
      expect(problemasDelRegaloSinDar(env, TEXTOS), JSON.stringify(env)).toEqual([]);
    }
  });

  it("con las páginas de hoy, la publicación de producción sin VITE_REGALO=1 no sale, y nombra cada página y diccionario", () => {
    const p = problemasDelRegaloSinDar(PRODUCCION, TEXTOS);
    const nombres = [
      "precios.html",
      "terminos.html",
      "como-funciona.html",
      "ruleta-de-nombres.html",
      "index.html",
      "src/i18n.ts",
      "src/i18n-modo-oficial.ts",
      "src/costo-del-retiro-portada.ts",
    ];
    for (const nombre of nombres) expect(p.some((x) => x.startsWith(`${nombre} `)), nombre).toBe(true);
    expect(p.every((x) => x.includes("VITE_REGALO=1"))).toBe(true);
  });

  it("frena aunque el sitio abra en Prueba: el diccionario del modo Oficial se lee igual", () => {
    for (const red of [undefined, "", "testnet", "prueba"]) {
      expect(problemasDelRegaloSinDar({ ...PRODUCCION, VITE_STELLAR_NETWORK: red }, TEXTOS).length, String(red)).toBeGreaterThan(0);
    }
  });

  it("con VITE_REGALO=1 y el paso de la cuenta, la publicación de producción sale, en Prueba o en Oficial", () => {
    expect(problemasDelRegaloSinDar({ ...PRODUCCION, VITE_REGALO: "1" }, TEXTOS)).toEqual([]);
    expect(problemasDelRegaloSinDar({ ...OFICIAL, VITE_REGALO: "1" }, TEXTOS)).toEqual([]);
  });

  it("VITE_REGALO=1 sin VITE_ALTA=1 no sale: los sorteos gratis se reciben en el paso de la cuenta", () => {
    for (const alta of [undefined, "", "0"]) {
      const p = problemasDelRegaloSinDar({ VERCEL_ENV: "production", VITE_REGALO: "1", VITE_ALTA: alta }, TEXTOS);
      expect(p, String(alta)).toHaveLength(1);
      expect(p[0]).toContain("VITE_ALTA=1");
    }
  });

  it("solo VITE_REGALO=1 cuenta: otro valor frena igual", () => {
    for (const valor of ["", "0", "true", "si", " 1"]) {
      expect(problemasDelRegaloSinDar({ ...PRODUCCION, VITE_REGALO: valor }, TEXTOS).length, JSON.stringify(valor)).toBeGreaterThan(0);
    }
  });

  it("sin ninguna frase del regalo, como antes de prometerlo, la publicación de producción sale sin la variable", () => {
    const antes = { "precios.html": "<p>El modo Prueba es gratis. El modo Oficial también, con el cupón de tu evento.</p>", "src/i18n.ts": "" };
    expect(problemasDelRegaloSinDar(PRODUCCION, antes)).toEqual([]);
  });

  it("una sola frase alcanza para frenarla, en español o en inglés, y nombra dónde está", () => {
    const frases = ["Organizá tus primeros 3 sorteos oficiales gratis.", "Run your first 3 Live draws for free.", "your 3 free Live draws"];
    for (const frase of frases) {
      const p = problemasDelRegaloSinDar(PRODUCCION, { "index.html": "<p>Participar es gratis.</p>", "x.html": `<p>${frase}</p>` });
      expect(p, frase).toHaveLength(1);
      expect(p[0]).toMatch(/^x\.html /);
    }
    expect(FRASES_DEL_REGALO).toHaveLength(frases.length);
  });

  it("vite.config.ts frena el build con esta regla, con el entorno de la publicación, las páginas y los dos diccionarios", () => {
    const config = readFileSync(new URL("../../vite.config.ts", import.meta.url), "utf8");
    expect(config).toContain('const DICCIONARIOS_DEL_REGALO = ["src/i18n.ts", "src/i18n-modo-oficial.ts", "src/costo-del-retiro-portada.ts"];');
    const entorno = 'loadEnv(mode, __dirname, ["VITE_", "VERCEL_ENV"])';
    expect(config).toContain(`problemasDelRegaloSinDar(${entorno}, { ...paginas, ...diccionarios })`);
  });

  it(".env.example explica VITE_REGALO, apagada", () => {
    const ejemplo = readFileSync(new URL("../../.env.example", import.meta.url), "utf8");
    expect(ejemplo).toMatch(/^VITE_REGALO=\r?$/m);
  });
});
