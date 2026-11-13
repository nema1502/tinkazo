import { readdirSync, readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ESTATICOS_CON_COBRO, FECHA_DEL_COBRO, FRASES_SIN_COBRO, TEXTOS_COBRO, cobroEnElBuild, fechaDeLosTerminos, textosConCobro } from "./alta-textos-con-cobro";
import { banderasDeAlta } from "./stellar/alta-config";

/**
 * Los textos de las páginas públicas con la compra de sorteos prendida: las reglas de escritura, que ningún texto trae
 * un precio, que dejan de decir que es gratis para todos y que el diccionario los toma solo con la compra en el build.
 */

const IDIOMAS = ["es", "en"] as const;
const raiz = new URL("../", import.meta.url);
const paginas = readdirSync(raiz).filter((f) => f.endsWith(".html"));
const leer = (f: string): string => readFileSync(new URL(f, raiz), "utf8");

const CON_FECHA = textosConCobro("2026-11-18");
const todos = (): string[] => [
  ...IDIOMAS.flatMap((l) => [...Object.values(CON_FECHA[l]), ...Object.values(TEXTOS_COBRO[l])]),
  ...Object.values(ESTATICOS_CON_COBRO).flat(),
];
/** El texto que lee la persona, sin las etiquetas de un enlace. */
const visible = (t: string): string => t.replace(/<[^>]+>/g, "");

const PORTERO = "https://pm.tinkazo.app";
// Con la venta abierta para todos: sin ella, la compra está en piloto y el diccionario cambia solo con su marca.
const CON_COMPRA = { VITE_ALTA: "1", VITE_ALTA_PAGO: "1", VITE_VENTA_ABIERTA: "1", VITE_PATROCINIO_URL_MAINNET: PORTERO };

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  vi.doUnmock("./stellar/config");
});

describe("las reglas de escritura", () => {
  it("las mismas claves en español y en inglés", () => {
    expect(Object.keys(CON_FECHA.en).sort()).toEqual(Object.keys(CON_FECHA.es).sort());
    expect(Object.keys(TEXTOS_COBRO.en).sort()).toEqual(Object.keys(TEXTOS_COBRO.es).sort());
  });

  it("sin comillas angulares, punto y coma, punto medio, rayas largas, flechas ni exclamaciones", () => {
    for (const t of todos()) expect(visible(t), t.slice(0, 60)).not.toMatch(/[«»;·—–←-⇿!¡]/);
  });

  it("sin palabras de apuesta ni tecnicismos", () => {
    for (const t of todos()) {
      expect(t, t.slice(0, 60)).not.toMatch(/\b(rifas?|loter[ií]as?|raffles?|tickets?|boletos?|apuestas?)\b/i);
      expect(visible(t), t.slice(0, 60)).not.toMatch(/\b(token|hash|transacci[oó]n|transaction|firma|signature|blockchain|XLM|drand)\b/i);
    }
  });

  it("ningún texto trae un precio: los montos salen del servidor", () => {
    for (const t of todos()) expect(t, t.slice(0, 60)).not.toMatch(/\d\s*(d[oó]lares?|dollars?|USDC|USD|Bs)\b|US\$\s*\d|\$\s*\d|Bs\.?\s*\d/i);
    // La fila de la lista lleva los números como datos, entre llaves.
    for (const l of IDIOMAS) expect(TEXTOS_COBRO[l].prPaqPrecio, l).toMatch(/^\{sorteos\} \S+ \{precio\}$/);
    for (const l of IDIOMAS) expect(TEXTOS_COBRO[l].prPaqDias, l).toContain("{dias}");
  });

  it("la línea de ayuda de la lista tiene 14 palabras o menos y el título 6 o menos", () => {
    for (const l of IDIOMAS) {
      expect(TEXTOS_COBRO[l].prPaqAyuda?.split(/\s+/).length, l).toBeLessThanOrEqual(14);
      expect(TEXTOS_COBRO[l].prPaqT?.split(/\s+/).length, l).toBeLessThanOrEqual(6);
      expect(TEXTOS_COBRO[l].tmCompraT?.split(/\s+/).length, l).toBeLessThanOrEqual(6);
    }
  });
});

describe("lo que cambia con la compra", () => {
  it("ya no dice que es gratis para todos, que los precios se publican pronto ni que no se venden paquetes", () => {
    for (const t of todos()) for (const f of FRASES_SIN_COBRO) expect(t, `${f.source}: ${t.slice(0, 60)}`).not.toMatch(f);
    // Y lo que hoy dicen las páginas sí cae en esas frases: si el texto de hoy cambia, la lista se revisa.
    expect(FRASES_SIN_COBRO.some((f) => f.test(leer("index.html")))).toBe(true);
    expect(FRASES_SIN_COBRO.some((f) => f.test(leer("precios.html")))).toBe(true);
    expect(FRASES_SIN_COBRO.some((f) => f.test(leer("ruleta-de-nombres.html")))).toBe(true);
  });

  it("la nota del logo sobre los planes que todavía no existen no cae en esas frases", () => {
    for (const f of FRASES_SIN_COBRO) {
      expect("Todavía no existen, y te avisamos antes de cobrarlos.", f.source).not.toMatch(f);
      expect("None of that exists yet, and we'll tell you before charging for it.", f.source).not.toMatch(f);
    }
  });

  it("cada clave que cambia existe hoy en el diccionario y en alguna página, donde reemplaza su texto", async () => {
    const { T } = await import("./i18n");
    for (const k of Object.keys(CON_FECHA.es)) {
      for (const l of IDIOMAS) expect(typeof T[l][k], `${l} ${k}`).toBe("string");
      expect(paginas.some((p) => leer(p).includes(`data-i="${k}"`) || leer(p).includes(`data-i-html="${k}"`) || leer(p).includes(`data-desc-clave="${k}"`)), k).toBe(true);
    }
  });

  it("participar y comprobar siguen gratis, siempre, en las que hablan de precios", () => {
    for (const k of ["prNote", "descPrecios", "faq3a", "rulF3B"]) {
      expect(CON_FECHA.es[k], k).toMatch(/gratis,? siempre/);
      expect(CON_FECHA.en[k], k).toMatch(/always free/);
    }
    for (const l of IDIOMAS) expect(TEXTOS_COBRO[l].tmCompraB, l).toMatch(l === "es" ? /gratis, siempre/ : /always free/);
  });

  it("con un paquete también cubre la comisión Tinkazo, y con la billetera propia la paga quien entra", () => {
    for (const k of ["faq3a", "nextBody", "cfCostoB", "tmPatrocinio"]) {
      expect(CON_FECHA.es[k], k).toContain("el cupón de tu evento o un paquete de sorteos oficiales");
      expect(CON_FECHA.es[k], k).toContain("propia billetera");
      expect(CON_FECHA.en[k], k).toContain("a coupon from your event or a pack of Live draws");
      expect(CON_FECHA.en[k], k).toContain("own wallet");
    }
  });

  it("los términos dicen qué se compra, que no es saldo, cómo se pide una devolución y a dónde se escribe", () => {
    const es = TEXTOS_COBRO.es;
    const en = TEXTOS_COBRO.en;
    expect(es.tmCompraB).toContain("cuántos trae y por cuántos días valen");
    expect(es.tmCompraB).toContain("No son saldo");
    expect(en.tmCompraB).toContain("They aren't a balance");
    expect(es.tmCompraDevolver).toContain("te lo devolvemos");
    expect(en.tmCompraDevolver).toContain("we send it back");
    for (const l of IDIOMAS) expect(TEXTOS_COBRO[l].tmCompraEscribir, l).toContain('<a href="mailto:hola@tinkazo.app">hola@tinkazo.app</a>');
    // Lo que se guarda de una compra, en los términos.
    expect(es.tmCompraDatos).toContain("la cuenta desde la que se mandó");
    expect(en.tmCompraDatos).toContain("the account it came from");
    // La compra con QR: en bolivianos, con lo que se suma y cuándo queda hecha, a quién van los datos de la verificación,
    // y el número de compra para escribir, sin prometer un plazo.
    expect(es.tmCompraPago).toContain("con el QR de tu banco, en bolivianos");
    expect(en.tmCompraPago).toContain("with your bank's QR, in bolivianos");
    expect(es.tmCompraPago).toContain("95 % del precio del paquete");
    expect(en.tmCompraPago).toContain("95% of the pack price");
    for (const l of IDIOMAS) expect(TEXTOS_COBRO[l].tmCompraDatos, l).toMatch(/Pollar[\s\S]*Didit[\s\S]*Stereum/);
    expect(es.tmCompraEscribir).toContain("con la nota o el número de tu compra");
    expect(en.tmCompraEscribir).toContain("with the memo or the number of your purchase");
    for (const l of IDIOMAS) expect(TEXTOS_COBRO[l].tmCompraEscribir, l).not.toMatch(/en el día|same day/);
  });
});

describe("la fecha de los términos", () => {
  it("sin fecha, los términos siguen con la de hoy", () => {
    expect(FECHA_DEL_COBRO).toBeNull();
    expect(textosConCobro(null).es.tmMore4).toBeUndefined();
    expect(textosConCobro().en.tmMore4).toBeUndefined();
  });

  it("con la fecha del día en que se prende, dicen desde cuándo valen y lo de antes queda como antes", () => {
    expect(CON_FECHA.es.tmMore4).toMatch(/^Vigentes desde el 18 de noviembre de 2026, cuando sumamos la compra de sorteos oficiales\. El 11 de noviembre de 2026/);
    expect(CON_FECHA.en.tmMore4).toMatch(/^In effect since November 18, 2026, when we added buying Live draws\. On November 11, 2026/);
    for (const l of IDIOMAS) expect(CON_FECHA[l].tmMore4, l).not.toContain("{fecha}");
  });

  it("solo una fecha que existe, como AAAA-MM-DD", () => {
    expect(fechaDeLosTerminos("2026-12-01")).toEqual({ es: "1 de diciembre de 2026", en: "December 1, 2026" });
    for (const mal of ["2026-02-30", "18-11-2026", "2026-11-18T00:00", "", null]) expect(fechaDeLosTerminos(mal), String(mal)).toBeNull();
  });
});

describe("la compra en el build", () => {
  it("es lo mismo que la bandera de la compra de la red principal, para cualquier combinación", () => {
    const valores = [undefined, "", "0", "1", " 1", "true"];
    const porteros = [undefined, "", "  ", "https://pm.tinkazo.app", "https://pm.tinkazo.app/"];
    let casos = 0;
    for (const VITE_ALTA of valores)
      for (const VITE_ALTA_PAGO of valores)
        for (const VITE_PATROCINIO_URL_MAINNET of porteros) {
          const env = { VITE_ALTA, VITE_ALTA_PAGO, VITE_PATROCINIO_URL_MAINNET };
          expect(cobroEnElBuild(env), JSON.stringify(env)).toBe(banderasDeAlta(env, "mainnet").pago);
          casos++;
        }
    expect(casos).toBe(180);
    expect(cobroEnElBuild(CON_COMPRA)).toBe(true);
  });
});

describe("cuál llega al diccionario", () => {
  async function diccionario(env: Record<string, string>, red: "mainnet" | "testnet" = "mainnet") {
    vi.resetModules();
    vi.unstubAllEnvs();
    for (const k of ["VITE_ALTA", "VITE_ALTA_PAGO", "VITE_VENTA_ABIERTA", "VITE_PATROCINIO_URL_MAINNET"]) vi.stubEnv(k, env[k] ?? "");
    vi.doMock("./stellar/config", async (orig) => {
      const real = await orig<typeof import("./stellar/config")>();
      return { ...real, network: { ...real.network, name: red } };
    });
    return (await import("./i18n")).T;
  }

  it("las claves nuevas están siempre, con la compra o sin ella", async () => {
    for (const env of [{}, CON_COMPRA] as Record<string, string>[]) {
      const T = await diccionario(env);
      for (const l of IDIOMAS) for (const [k, v] of Object.entries(TEXTOS_COBRO[l])) expect(T[l][k], `${l} ${k}`).toBe(v);
    }
  });

  it("sin la compra en el build (el de hoy, solo con cupones, o la compra sin el acceso), las páginas dicen lo de hoy", async () => {
    const entornos: Record<string, string>[] = [{}, { VITE_ALTA: "1", VITE_PATROCINIO_URL_MAINNET: PORTERO }, { VITE_ALTA_PAGO: "1", VITE_PATROCINIO_URL_MAINNET: PORTERO }];
    for (const env of entornos) {
      const T = await diccionario(env);
      for (const l of IDIOMAS) for (const [k, v] of Object.entries(CON_FECHA[l])) expect(T[l][k], `${JSON.stringify(env)} ${l} ${k}`).not.toBe(v);
    }
  });

  it("con la compra en el build, las páginas dicen que se compran, también con la pestaña en Prueba", async () => {
    for (const red of ["mainnet", "testnet"] as const) {
      const T = await diccionario(CON_COMPRA, red);
      const conCobro = textosConCobro();
      for (const l of IDIOMAS) for (const [k, v] of Object.entries(conCobro[l])) expect(T[l][k], `${red} ${l} ${k}`).toBe(v);
    }
  });
});
