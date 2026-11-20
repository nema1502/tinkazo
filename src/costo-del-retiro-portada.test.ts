import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cuentaDePrueba } from "./campana/cuentas-de-prueba";
import { faqConElRetiro, problemasDeLaPortadaConRetiro, textoDeLaPortadaConRetiro } from "./costo-del-retiro-portada";

/**
 * Lo que dice la portada del costo del retiro, y lo que exige la publicación de producción: el costo prendido no sale
 * mientras el HTML de la portada diga que Tinkazo no cobra nada. Sin red.
 */

/** Una cuenta de verdad de testnet (pública): la que recibe el costo en estas pruebas. */
const CUENTA = "GDALL7OBL7A44KEXQJPQPKUFMS4A56UXWLTHNB3VIARSEJ65ILAZCFIT";
const PORTERO = "https://pm.tinkazo.app";
const CON_COSTO = { VITE_RETIRO_COSTO: "0.50", VITE_RETIRO_CUENTA: CUENTA };
const PRODUCCION = { ...CON_COSTO, VERCEL_ENV: "production" };
// La compra de sorteos abierta para todos: es cuando la portada dice otra cosa de cuánto cuesta.
const CON_COMPRA = { VITE_ALTA: "1", VITE_ALTA_PAGO: "1", VITE_VENTA_ABIERTA: "1", VITE_PATROCINIO_URL_MAINNET: PORTERO };

const HOY = readFileSync(new URL("../index.html", import.meta.url), "utf8");
/** La portada como quedaría en el commit que prende el costo: la respuesta cambiada por la del costo. */
const prendida = (stroops: bigint): string => HOY.replace(/(data-i="faq3a">)[^<]*(<)/, `$1${textoDeLaPortadaConRetiro(stroops).es}$2`);

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("lo que dice la portada", () => {
  it("con 50 centavos, en español", () => {
    expect(textoDeLaPortadaConRetiro(5_000_000n).es).toBe(
      "Organizá tus primeros 3 sorteos oficiales gratis. Para más, usá un cupón. Participar, comprobar y recibir un premio son gratis siempre. Retirar dinero de tu cuenta cuesta 50 centavos.",
    );
  });

  it("con 50 centavos, en inglés", () => {
    expect(textoDeLaPortadaConRetiro(5_000_000n).en).toBe(
      "Run your first 3 Live draws for free. For more, use a coupon. Taking part, checking and receiving a prize are always free. Withdrawing money from your account costs 50 cents.",
    );
  });

  it("empieza con la misma frase de Precios sobre los sorteos oficiales gratis, con o sin la comisión", () => {
    const precios = readFileSync(new URL("../precios.html", import.meta.url), "utf8");
    const regaloEs = "Organizá tus primeros 3 sorteos oficiales gratis. Para más, usá un cupón.";
    expect(precios).toContain(regaloEs);
    for (const comision of [null, { pb: 200n, minimo: 15_000_000n }]) {
      const t = textoDeLaPortadaConRetiro(5_000_000n, comision);
      expect(t.es.startsWith(regaloEs)).toBe(true);
      expect(t.en.startsWith("Run your first 3 Live draws for free. For more, use a coupon.")).toBe(true);
    }
  });

  it("el monto sale de la configuración: con otro monto, otro texto", () => {
    expect(textoDeLaPortadaConRetiro(12_500_000n).es).toContain("cuesta 1,25 dólares digitales.");
    expect(textoDeLaPortadaConRetiro(12_500_000n).en).toContain("costs 1.25 digital dollars.");
  });

  it("nunca deja el marcador a la vista", () => {
    for (const stroops of [100_000n, 5_000_000n, 12_500_000n]) {
      const t = textoDeLaPortadaConRetiro(stroops);
      expect(t.es).not.toContain("{c}");
      expect(t.en).not.toContain("{c}");
    }
  });

  it("sin comillas angulares, punto y coma, punto medio, raya larga ni signos de exclamación", () => {
    for (const stroops of [5_000_000n, 12_500_000n]) {
      const t = textoDeLaPortadaConRetiro(stroops);
      expect(t.es).not.toMatch(/[«»;·—!¡]/);
      expect(t.en).not.toMatch(/[«»;·—!¡]/);
    }
  });

  it("sin palabras técnicas ni de apuesta", () => {
    const tecnicas = "firma|hash|red|comisi[oó]n|contrato|XDR|co-?firma|USDC|Stellar|billetera|wallet|network|fee|signature";
    const deApuesta = "rifa|loter[ií]a|boleto|ticket|apuesta|raffle|lottery|bet";
    const prohibidas = new RegExp(`\\b(${tecnicas}|${deApuesta})\\b`, "i");
    const t = textoDeLaPortadaConRetiro(5_000_000n);
    expect(t.es).not.toMatch(prohibidas);
    expect(t.en).not.toMatch(prohibidas);
  });

  it("dice que recibir un premio y participar son gratis siempre", () => {
    const t = textoDeLaPortadaConRetiro(5_000_000n);
    expect(t.es).toContain("Participar, comprobar y recibir un premio son gratis siempre");
    expect(t.en).toContain("Taking part, checking and receiving a prize are always free");
  });
});

describe("cuándo va encima del diccionario", () => {
  it("con el costo y la cuenta configurados, va", () => {
    expect(faqConElRetiro(CON_COSTO)).toEqual(textoDeLaPortadaConRetiro(5_000_000n));
  });

  it("sin la cuenta no se cobra nada y la portada queda como estaba", () => {
    expect(faqConElRetiro({ VITE_RETIRO_COSTO: "0.50" })).toBeNull();
    expect(faqConElRetiro({ VITE_RETIRO_COSTO: "0.50", VITE_RETIRO_CUENTA: "" })).toBeNull();
  });

  it("con el costo en cero o sin configurar, queda como estaba", () => {
    expect(faqConElRetiro({ VITE_RETIRO_COSTO: "0", VITE_RETIRO_CUENTA: CUENTA })).toBeNull();
    expect(faqConElRetiro({})).toBeNull();
  });

  it("con la compra de sorteos a la vista, la portada se queda con su texto", () => {
    expect(faqConElRetiro({ ...CON_COSTO, ...CON_COMPRA })).toBeNull();
  });
});

describe("el diccionario del sitio", () => {
  async function faq(env: Record<string, string>): Promise<{ es: unknown; en: unknown }> {
    vi.resetModules();
    vi.unstubAllEnvs();
    for (const k of ["VITE_RETIRO_COSTO", "VITE_RETIRO_CUENTA", "VITE_ALTA", "VITE_ALTA_PAGO", "VITE_VENTA_ABIERTA", "VITE_PATROCINIO_URL_MAINNET"]) {
      vi.stubEnv(k, env[k] ?? "");
    }
    const { T } = await import("./i18n");
    return { es: T.es.faq3a, en: T.en.faq3a };
  }

  it("sin costo configurado, la portada dice lo de siempre", async () => {
    const hoy = await faq({});
    expect(hoy.es).not.toContain("Retirar dinero");
    expect(hoy.en).not.toContain("Withdrawing money");
  });

  it("con el costo y la cuenta, la portada dice cuánto cuesta retirar, en los dos idiomas", async () => {
    const con = await faq(CON_COSTO);
    expect(con).toEqual(textoDeLaPortadaConRetiro(5_000_000n));
  });

  it("con el costo y sin la cuenta, queda lo de siempre", async () => {
    expect(await faq({ VITE_RETIRO_COSTO: "0.50" })).toEqual(await faq({}));
  });

  it("con la compra abierta a todos, queda el texto de la compra", async () => {
    const sola = await faq(CON_COMPRA);
    expect(await faq({ ...CON_COSTO, ...CON_COMPRA })).toEqual(sola);
  });

  it("con la compra en piloto, sin la marca del piloto en esta pestaña, la portada dice el costo", async () => {
    const piloto = await faq({ ...CON_COSTO, ...CON_COMPRA, VITE_VENTA_ABIERTA: "" });
    expect(piloto).toEqual(textoDeLaPortadaConRetiro(5_000_000n));
  });
});

describe("la publicación de producción", () => {
  it("la portada de hoy dice lo que cobra Tinkazo y lo que cuesta retirar", () => {
    expect(HOY).toContain("data-i=\"faq3a\">Organizá tus primeros 3 sorteos oficiales gratis. Para más, usá un cupón. Si tu empresa sortea premios en dólares digitales, paga 2 % de los premios. Participar, comprobar y recibir un premio son gratis siempre. Retirar cuesta 50 centavos.<");
  });

  it("con el costo prendido y la portada de hoy, no sale", () => {
    const p = problemasDeLaPortadaConRetiro(PRODUCCION, { "index.html": HOY });
    expect(p).toHaveLength(1);
    expect(p[0]).toContain("index.html todavía dice lo de antes");
    expect(p[0]).toContain("faq3a");
  });

  it("con el costo prendido y la portada con su texto, sale", () => {
    expect(problemasDeLaPortadaConRetiro(PRODUCCION, { "index.html": prendida(5_000_000n) })).toEqual([]);
  });

  it("con otro monto en la portada que el configurado, no sale", () => {
    expect(problemasDeLaPortadaConRetiro(PRODUCCION, { "index.html": prendida(10_000_000n) })).toHaveLength(1);
    expect(problemasDeLaPortadaConRetiro({ ...PRODUCCION, VITE_RETIRO_COSTO: "1.25" }, { "index.html": prendida(5_000_000n) })).toHaveLength(1);
    expect(problemasDeLaPortadaConRetiro({ ...PRODUCCION, VITE_RETIRO_COSTO: "1.25" }, { "index.html": prendida(12_500_000n) })).toEqual([]);
  });

  it("con una portada sin la respuesta, no sale", () => {
    expect(problemasDeLaPortadaConRetiro(PRODUCCION, { "index.html": "<html></html>" })).toHaveLength(1);
    expect(problemasDeLaPortadaConRetiro(PRODUCCION, {})).toHaveLength(1);
  });

  it("fuera de la publicación de producción nunca frena: las vistas previas sirven para probar el costo", () => {
    for (const VERCEL_ENV of ["preview", "development", "", undefined]) {
      expect(problemasDeLaPortadaConRetiro({ ...PRODUCCION, VERCEL_ENV }, { "index.html": HOY }), String(VERCEL_ENV)).toEqual([]);
    }
  });

  it("sin costo que cobrar nunca frena: la portada de hoy sigue siendo cierta", () => {
    for (const env of [
      { VERCEL_ENV: "production" },
      { VERCEL_ENV: "production", VITE_RETIRO_COSTO: "0.50" },
      { VERCEL_ENV: "production", VITE_RETIRO_COSTO: "0", VITE_RETIRO_CUENTA: CUENTA },
      { VERCEL_ENV: "production", VITE_RETIRO_COSTO: "", VITE_RETIRO_CUENTA: CUENTA },
    ]) expect(problemasDeLaPortadaConRetiro(env, { "index.html": HOY }), JSON.stringify(env)).toEqual([]);
  });

  it("con la compra abierta a todos y el costo prendido, no sale: las dos juntas no tienen su frase", () => {
    const p = problemasDeLaPortadaConRetiro({ ...PRODUCCION, ...CON_COMPRA }, { "index.html": prendida(5_000_000n) });
    expect(p).toHaveLength(1);
    expect(p[0]).toContain("compra de sorteos");
  });

  it("con la compra en piloto y el costo prendido, sale con la portada del costo", () => {
    const env = { ...PRODUCCION, ...CON_COMPRA, VITE_VENTA_ABIERTA: "" };
    expect(problemasDeLaPortadaConRetiro(env, { "index.html": prendida(5_000_000n) })).toEqual([]);
  });

  it("no escribe valores de variables: ni la cuenta ni la dirección del portero", () => {
    const todo = [
      ...problemasDeLaPortadaConRetiro(PRODUCCION, { "index.html": HOY }),
      ...problemasDeLaPortadaConRetiro({ ...PRODUCCION, ...CON_COMPRA }, { "index.html": HOY }),
    ].join(" ");
    expect(todo).not.toContain(CUENTA);
    expect(todo).not.toContain(PORTERO);
    expect(todo).not.toContain("0.50");
  });

  it("los mensajes no llevan punto y coma, comillas angulares ni signos de exclamación", () => {
    const todo = [
      ...problemasDeLaPortadaConRetiro(PRODUCCION, { "index.html": HOY }),
      ...problemasDeLaPortadaConRetiro({ ...PRODUCCION, ...CON_COMPRA }, { "index.html": HOY }),
    ];
    for (const mensaje of todo) expect(mensaje).not.toMatch(/[«»;·—!¡]/);
  });
});

describe("con lo que cobra Tinkazo a una campaña de empresa", () => {
  const CON_COMISION = { ...CON_COSTO, VITE_COMISION_PB: "200", VITE_COMISION_MINIMO: "1.50", VITE_COMISION_CUENTA: cuentaDePrueba(2) };
  const COMISION = { pb: 200n, minimo: 15_000_000n };
  const frase = textoDeLaPortadaConRetiro(5_000_000n, COMISION);
  const conFrase = (): string => HOY.replace(/(data-i="faq3a">)[^<]*(<)/, `$1${frase.es}$2`);

  it("la respuesta dice los sorteos oficiales gratis, lo que paga una empresa y lo que cuesta retirar, en español", () => {
    expect(frase.es).toBe(
      "Organizá tus primeros 3 sorteos oficiales gratis. Para más, usá un cupón. " +
        "Si tu empresa sortea premios en dólares digitales, paga 2 % de los premios. " +
        "Participar, comprobar y recibir un premio son gratis siempre. Retirar cuesta 50 centavos.",
    );
  });

  it("y en inglés", () => {
    expect(frase.en).toBe(
      "Run your first 3 Live draws for free. For more, use a coupon. " +
        "If your company gives away prizes in digital dollars, it pays 2% of the prizes. " +
        "Taking part, checking and receiving a prize are always free. Withdrawing costs 50 cents.",
    );
  });

  it("no empieza diciendo que hoy es gratis para después decir que se paga", () => {
    expect(frase.es).not.toMatch(/^Hoy/);
    expect(frase.en).not.toMatch(/today/i);
  });

  it("nunca deja un marcador a la vista, ni signos que no van", () => {
    for (const t of [frase.es, frase.en]) {
      expect(t).not.toMatch(/{[pmc]}/);
      expect(t).not.toMatch(/[«»;·—!¡"]/);
    }
  });

  it("sin la comisión, la respuesta es la de siempre", () => {
    expect(textoDeLaPortadaConRetiro(5_000_000n, null)).toEqual(textoDeLaPortadaConRetiro(5_000_000n));
  });

  it("la portada sale con la respuesta combinada cuando la comisión está configurada", async () => {
    vi.resetModules();
    for (const [k, v] of Object.entries(CON_COMISION)) vi.stubEnv(k, v);
    const { faqConElRetiro: faq } = await import("./costo-del-retiro-portada");
    expect(faq()).toEqual(frase);
  });

  it("con la comisión prendida y la portada que solo dice el costo del retiro, la publicación de producción no sale", () => {
    const p = problemasDeLaPortadaConRetiro({ ...CON_COMISION, VERCEL_ENV: "production" }, { "index.html": prendida(5_000_000n) });
    expect(p).toHaveLength(1);
    expect(p[0]).toContain("faq3a");
  });

  it("con la comisión prendida y la portada con la respuesta combinada, sale", () => {
    expect(problemasDeLaPortadaConRetiro({ ...CON_COMISION, VERCEL_ENV: "production" }, { "index.html": conFrase() })).toEqual([]);
  });

  it("sin la comisión, la portada con la respuesta combinada tampoco sale: dice más de lo que se cobra", () => {
    expect(problemasDeLaPortadaConRetiro(PRODUCCION, { "index.html": conFrase() })).toHaveLength(1);
  });
});
