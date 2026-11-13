import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { T } from "./i18n";
import { ESTATICOS_CON_COBRO, problemasDeLasPaginasConCobro, textosConCobro } from "./alta-textos-con-cobro";

/**
 * La publicación de producción con la compra prendida no sale mientras el HTML diga lo de antes: que es gratis para
 * todos, que los precios se publican pronto o que no se venden paquetes, o con lo de la compra todavía en un template.
 * Las páginas se leen tal como están escritas, y se arman también como quedarían en el commit que prende la compra.
 */

const raiz = new URL("../", import.meta.url);
const HOY: Readonly<Record<string, string>> = Object.fromEntries(
  readdirSync(raiz)
    .filter((f) => f.endsWith(".html"))
    .map((f) => [f, readFileSync(new URL(f, raiz), "utf8")]),
);
// La venta abierta para todos: es cuando las páginas tienen que decir la compra.
const PRODUCCION = { VERCEL_ENV: "production", VITE_ALTA: "1", VITE_ALTA_PAGO: "1", VITE_VENTA_ABIERTA: "1", VITE_PATROCINIO_URL_MAINNET: "https://pm.tinkazo.app" };
const FECHA = "2026-11-18";

const escapar = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Las páginas como quedarían en el commit que prende la compra: es lo que la regla deja salir. */
function prendidas(): Record<string, string> {
  const nuevos = textosConCobro(FECHA).es;
  const viejos = T.es;
  const salida: Record<string, string> = {};
  for (const [pagina, original] of Object.entries(HOY)) {
    let html = original.replace(/<template data-con-cobro>([\s\S]*?)<\/template>/g, "$1");
    for (const [k, v] of Object.entries(nuevos)) {
      html = html.replace(new RegExp(`(data-i="${k}">)[^<]*(<)`, "g"), (_m, a: string, b: string) => `${a}${v}${b}`);
      html = html.replace(new RegExp(`(data-i-html="${k}">)[\\s\\S]*?(</p>)`, "g"), (_m, a: string, b: string) => `${a}${v}${b}`);
    }
    // Lo que no pasa por el diccionario: la descripción y los datos para buscadores, en cada página donde están.
    for (const k of ["descPrecios", "rulF3B"]) html = html.split(viejos[k] as string).join(nuevos[k] as string);
    html = html.split("Herramienta gratuita para elegir con justicia en eventos y clases. No vende participaciones ni paquetes de sorteos.").join((ESTATICOS_CON_COBRO["index.html"] as string[])[0] as string);
    html = html.split("Taking part and checking a result are free, always. Pricing for organizers is coming very soon, and we will tell you before we charge.").join((ESTATICOS_CON_COBRO["precios.html"] as string[])[1] as string);
    salida[pagina] = html;
  }
  return salida;
}

describe("problemasDeLasPaginasConCobro", () => {
  it("fuera de la publicación de producción, o sin la compra, nunca frena: las vistas previas sirven para la prueba", () => {
    for (const env of [
      { ...PRODUCCION, VERCEL_ENV: "preview" },
      { ...PRODUCCION, VERCEL_ENV: undefined },
      { ...PRODUCCION, VITE_ALTA_PAGO: "" },
      { ...PRODUCCION, VITE_ALTA_PAGO: "0" },
      { ...PRODUCCION, VITE_ALTA: "" },
    ]) expect(problemasDeLasPaginasConCobro(env, HOY, null), JSON.stringify(env)).toEqual([]);
  });

  it("con la venta en piloto (sin VITE_VENTA_ABIERTA), la publicación de producción sale con las páginas de hoy: nadie sin la marca ve la compra", () => {
    for (const abierta of [undefined, "", "0"]) {
      const env = { ...PRODUCCION, VITE_VENTA_ABIERTA: abierta };
      expect(problemasDeLasPaginasConCobro(env, HOY, null), JSON.stringify(env)).toEqual([]);
    }
  });

  it("con las páginas de hoy, la publicación de producción con la compra no sale, y dice qué falta en cada una", () => {
    const p = problemasDeLasPaginasConCobro(PRODUCCION, HOY, FECHA);
    const en = (pagina: string): string[] => p.filter((x) => x.startsWith(pagina));
    expect(en("precios.html").join("\n")).toMatch(/template data-con-cobro/);
    expect(en("terminos.html").join("\n")).toMatch(/template data-con-cobro/);
    expect(en("precios.html").join("\n")).toMatch(/data-i="prNote"/);
    expect(en("index.html").join("\n")).toMatch(/data-i="faq3a"/);
    expect(en("index.html").join("\n")).toMatch(/ni paquetes de sorteos/);
    expect(en("ruleta-de-nombres.html").join("\n")).toMatch(/data-i="rulF3B"/);
    expect(en("terminos.html").join("\n")).toMatch(/data-i="tmMore4"/);
    expect(en("como-funciona.html").join("\n")).toMatch(/data-i-html="cfCostoB"/);
  });

  it("sin FECHA_DEL_COBRO tampoco sale: los términos dicen desde qué día valen", () => {
    expect(problemasDeLasPaginasConCobro(PRODUCCION, prendidas(), null)).toEqual([expect.stringMatching(/^Falta FECHA_DEL_COBRO/)]);
  });

  it("con el HTML como queda en el commit que prende la compra, sale", () => {
    expect(problemasDeLasPaginasConCobro(PRODUCCION, prendidas(), FECHA)).toEqual([]);
  });

  it("un solo texto de antes alcanza para frenarla, y el problema nombra la página", () => {
    const listas = prendidas();
    const conTemplate = { ...listas, "terminos.html": HOY["terminos.html"] as string };
    expect(problemasDeLasPaginasConCobro(PRODUCCION, conTemplate, FECHA).every((x) => x.startsWith("terminos.html"))).toBe(true);
    const faq = { ...listas, "index.html": (listas["index.html"] as string).replace(textosConCobro(FECHA).es.faq3a as string, T.es.faq3a as string) };
    const p = problemasDeLasPaginasConCobro(PRODUCCION, faq, FECHA);
    expect(p.length).toBeGreaterThan(0);
    expect(p.every((x) => x.startsWith("index.html"))).toBe(true);
    const og = { ...listas, "precios.html": (listas["precios.html"] as string).replace((ESTATICOS_CON_COBRO["precios.html"] as string[])[1] as string, "Pricing is coming very soon.") };
    expect(problemasDeLasPaginasConCobro(PRODUCCION, og, FECHA).length).toBeGreaterThan(0);
  });

  it("no escribe el valor de ninguna variable", () => {
    expect(problemasDeLasPaginasConCobro({ ...PRODUCCION, VITE_PATROCINIO_URL_MAINNET: "https://secreto.example" }, HOY, FECHA).join(" ")).not.toMatch(/secreto|https?:\/\/pm/);
  });

  it("vite.config.ts frena el build con esta regla y le pasa el entorno de la publicación", () => {
    const config = readFileSync(new URL("../vite.config.ts", import.meta.url), "utf8");
    expect(config).toMatch(/problemasDeLasPaginasConCobro\(loadEnv\(mode, __dirname, \["VITE_", "VERCEL_ENV"\]\), paginas\)/);
    expect(config).toMatch(/plugins: \[[^\]]*validarPaginasConCobro\(\)/);
  });
});
