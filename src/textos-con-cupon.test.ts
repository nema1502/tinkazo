import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { T } from "./i18n";
import { HAY_MODO_OFICIAL, TEXTOS_MODO_OFICIAL } from "./i18n-modo-oficial";
import { FRASES_CUPON_DE_ENTRADA, problemasDeLasPaginasEnOficial } from "./alta-textos-con-cobro";
import { problemasDeAlta } from "./stellar/alta-build";

/**
 * Con el regalo de bienvenida, quien organiza tiene sus primeros 3 sorteos oficiales gratis y para más usa un cupón:
 * nadie necesita un cupón para entrar al modo Oficial. Las páginas de lectura lo dicen, dicen quién paga la comisión de
 * la red en Oficial (mientras te queden sorteos oficiales, Tinkazo; con la billetera propia, quien entra) y los términos
 * dicen qué guarda el servicio al dar el regalo y al canjear un cupón. Esos textos viven en el diccionario del modo
 * Oficial (`i18n-modo-oficial.ts`) y el HTML de las páginas trae los mismos (`seo.test.ts` y `revision-textos.test.ts`
 * los comparan).
 */

const IDIOMAS = ["es", "en"] as const;
const CLAVES = ["nextBody", "faq3a", "cfCostoB", "tmPatrocinio", "tmMore1", "prNote", "rulF3B"];
const DE_QUIEN_PAGA = ["nextBody", "faq3a", "cfCostoB", "tmPatrocinio"];
/** Las claves que dicen el regalo, con la frase entera, letra por letra. */
const DEL_REGALO = ["prNote", "faq3a", "nextBody", "cfCostoB", "tmPatrocinio", "rulF3B"];
const REGALO = {
  es: "Organizá tus primeros 3 sorteos oficiales gratis. Para más, usá un cupón. Participar y comprobar es gratis, siempre.",
  en: "Run your first 3 Live draws for free. For more, use a coupon. Taking part and checking are always free.",
} as const;
const texto = (l: (typeof IDIOMAS)[number], k: string): string => String(T[l][k]);

/** La publicación de producción que abre en Oficial, con todo lo que pide. */
const OFICIAL = {
  VERCEL_ENV: "production",
  VITE_STELLAR_NETWORK: "mainnet",
  VITE_ALTA: "1",
  VITE_PATROCINIO_URL_MAINNET: "https://pm.tinkazo.app",
  VITE_POLLAR_PUBLISHABLE_KEY_MAINNET: "pub_de_prueba",
};
const raiz = new URL("../", import.meta.url);
const PAGINAS: Readonly<Record<string, string>> = Object.fromEntries(
  readdirSync(raiz)
    .filter((f) => f.endsWith(".html"))
    .map((f) => [f, readFileSync(new URL(f, raiz), "utf8")]),
);

describe("los textos del regalo de las páginas de lectura", () => {
  it("son estas claves, en el diccionario del modo Oficial y en los dos idiomas", () => {
    expect(HAY_MODO_OFICIAL).toBe(true);
    for (const l of IDIOMAS) {
      for (const k of CLAVES) {
        expect(Object.keys(TEXTOS_MODO_OFICIAL[l]), `${l} ${k}`).toContain(k);
        expect(T[l][k], `${l} ${k}`).toBe(TEXTOS_MODO_OFICIAL[l][k]);
      }
    }
  });

  it("dicen el regalo de quien organiza con la misma frase, y participar y comprobar siguen gratis siempre", () => {
    for (const k of DEL_REGALO) {
      for (const l of IDIOMAS) expect(texto(l, k), `${l} ${k}`).toContain(REGALO[l]);
    }
  });

  it("precios abre con el regalo y nada más", () => {
    expect(texto("es", "prNote")).toBe(REGALO.es);
    expect(texto("en", "prNote")).toBe(REGALO.en);
  });

  it("con la comisión de las campañas, la nota de arriba de precios también abre con el regalo", () => {
    expect(texto("es", "prNoteComision")).toBe(
      "Organizá tus primeros 3 sorteos oficiales gratis. Para más, usá un cupón. Las campañas de empresa con premios pagan un porcentaje. " +
        "Participar y comprobar es gratis, siempre.",
    );
    expect(texto("en", "prNoteComision")).toBe(
      "Run your first 3 Live draws for free. For more, use a coupon. Company campaigns with prizes pay a percentage. " +
        "Taking part and checking are always free.",
    );
  });

  it("ninguno dice que el modo Oficial pide el cupón de tu evento para entrar", () => {
    const deEntrada = [...FRASES_CUPON_DE_ENTRADA, /your event coupon/i];
    for (const k of [...CLAVES, "prNoteComision"]) {
      for (const l of IDIOMAS) {
        for (const frase of deEntrada) expect(texto(l, k), `${l} ${k}`).not.toMatch(frase);
      }
    }
  });

  it("las páginas como están escritas dejan salir la publicación de producción que abre en Oficial", () => {
    expect(problemasDeLasPaginasEnOficial(OFICIAL, PAGINAS)).toEqual([]);
  });

  it("quién paga: en Oficial lo cubre Tinkazo mientras te queden sorteos oficiales, y con la billetera propia lo paga quien entra", () => {
    for (const k of DE_QUIEN_PAGA) {
      expect(texto("es", k), k).toMatch(/mientras te queden sorteos oficiales/);
      expect(texto("en", k), k).toMatch(/while you have Live draws left/);
      expect(texto("es", k), k).toMatch(/propia billetera/);
      expect(texto("en", k), k).toMatch(/own wallet/);
    }
    expect(texto("es", "nextBody")).toContain(
      "El costo de sellar lo paga Tinkazo en el modo Prueba, y también en el modo Oficial mientras te queden sorteos oficiales. " +
        `${REGALO.es} En el modo Oficial, quien entra con su propia billetera paga la comisión de la red, que es de centavos.`,
    );
    expect(texto("en", "nextBody")).toContain(
      "Tinkazo pays the cost of sealing in Test mode, and in Live mode too while you have Live draws left. " +
        `${REGALO.en} In Live mode, if you sign in with your own wallet, you pay the network's charge, which is a few cents.`,
    );
    expect(
      texto("es", "faq3a").endsWith(
        "En el modo Oficial, Tinkazo cubre la comisión de la red mientras te queden sorteos oficiales. " +
          "En ese modo, quien entra con su propia billetera la paga de su cuenta.",
      ),
    ).toBe(true);
    expect(
      texto("en", "faq3a").endsWith(
        "In Live mode, Tinkazo covers the network's charge while you have Live draws left. " +
          "In that mode, if you sign in with your own wallet, you pay it from your account.",
      ),
    ).toBe(true);
    expect(texto("es", "cfCostoB")).toContain(
      "En el modo Oficial lo paga Tinkazo mientras te queden sorteos oficiales, y quien entra con su propia billetera lo paga de su cuenta.",
    );
    expect(texto("en", "cfCostoB")).toContain(
      "In Live mode Tinkazo pays it while you have Live draws left, and if you sign in with your own wallet, you pay it from your account.",
    );
    expect(texto("es", "tmPatrocinio")).toContain(
      "En el modo Oficial, Tinkazo cubre esa comisión mientras te queden sorteos oficiales. " +
        "En ese modo, quien entra con su propia billetera la paga de su cuenta.",
    );
    expect(texto("en", "tmPatrocinio")).toContain(
      "In Live mode, Tinkazo covers that charge while you have Live draws left. " +
        "In that mode, if you sign in with your own wallet, you pay it from your account.",
    );
  });

  it("lo de la billetera propia queda dicho dentro del modo Oficial, y el cupón no se pega al nombre de Tinkazo", () => {
    // Una oración suelta sobre la billetera propia, sin el modo, valdría también para el modo Prueba, donde la comisión
    // la cubre Tinkazo. Y sin la coma, el cupón de tu evento Tinkazo se lee como el nombre del evento.
    const idiomas = [
      ["es", /propia billetera/, /modo Oficial|ese modo/],
      ["en", /own wallet/, /Live mode|that mode/],
    ] as const;
    for (const k of DE_QUIEN_PAGA) {
      for (const [l, billetera, modo] of idiomas) {
        const oraciones = texto(l, k).split(/(?<=\.)\s+/).filter((o) => billetera.test(o));
        expect(oraciones.length, `${l} ${k}`).toBeGreaterThan(0);
        for (const o of oraciones) expect(o, `${l} ${k}`).toMatch(modo);
      }
      expect(texto("es", k), k).not.toMatch(/cupón de tu evento Tinkazo/);
      expect(texto("en", k), k).not.toMatch(/coupon from your event Tinkazo/);
    }
  });

  it("los términos dicen que el regalo es una vez por persona y que vale 60 días", () => {
    const es = "Los 3 sorteos oficiales gratis se dan una sola vez por persona y valen 60 días desde que los recibís.";
    const en = "The 3 free Live draws are given only once per person and last 60 days from when you get them.";
    expect(texto("es", "tmPatrocinio").endsWith(es)).toBe(true);
    expect(texto("en", "tmPatrocinio").endsWith(en)).toBe(true);
  });

  it("lo de Prueba sigue igual: ahí no hay cupón y Tinkazo cubre la comisión", () => {
    expect(texto("es", "tmPatrocinio")).toContain("En el modo Prueba, Tinkazo cubre la comisión que cobra la red por sellar y sortear.");
    expect(texto("en", "tmPatrocinio")).toContain("In Test mode, Tinkazo covers the charge the network makes for sealing and drawing.");
    expect(texto("es", "cfCostoB")).toContain("En el modo Prueba lo paga Tinkazo.");
    expect(texto("en", "cfCostoB")).toContain("In Test mode Tinkazo pays it.");
    expect(
      texto("es", "faq3a").startsWith(
        `Hoy Tinkazo no cobra nada. Muy pronto publicamos los precios para quien organiza, y te avisamos antes de cobrar. ${REGALO.es}`,
      ),
    ).toBe(true);
    expect(
      texto("en", "faq3a").startsWith(
        `Tinkazo charges nothing for now. We'll publish pricing for organizers very soon, and we'll tell you before we charge. ${REGALO.en}`,
      ),
    ).toBe(true);
  });

  it("los términos dicen qué guarda el servicio al dar el regalo, y después qué guarda al canjear un cupón y qué no", () => {
    expect(texto("es", "tmMore1")).toMatch(/^No hay publicidad ni rastreadores que te sigan de un sitio a otro/);
    expect(texto("es", "tmMore1")).toContain("Al compartir o mostrar en grande, se guarda en Cloudflare una copia cifrada del comprobante, que incluye la lista.");
    expect(texto("es", "tmMore1")).toContain("No guarda la lista, nombres ni direcciones IP.");
    // Un fondo, sin decir de quién, se puede leer como un fondo de terceros que paga las comisiones.
    expect(texto("es", "tmMore1")).toContain("Para cuidar el saldo con que Tinkazo la paga, ese servicio anota los sellos de cada cuenta");
    expect(texto("en", "tmMore1")).toContain("To protect the balance Tinkazo pays it from, that service records each account's seals");
    for (const l of IDIOMAS) expect(texto(l, "tmMore1"), l).not.toMatch(/\bfondo\b|\bfund\b/);
    expect(texto("es", "tmMore1")).toContain(
      "Para darte tus 3 sorteos oficiales gratis una sola vez, ese servicio confirma tu sesión con Pollar y guarda el identificador que Pollar " +
        "le da a tu cuenta, tu dirección pública, cuándo los recibiste y cuántos te quedan. No guarda tu correo ni tu nombre. " +
        "Si canjeás un cupón de evento,",
    );
    expect(texto("es", "tmMore1")).toMatch(
      /Si canjeás un cupón de evento, ese servicio confirma tu sesión con Pollar y guarda el identificador que Pollar le da a tu cuenta, tu dirección pública, el evento y una huella del cupón, la hora del canje y cuántos sorteos oficiales te quedan\. No guarda tu correo, tu nombre, la llave de tu sesión ni el código del cupón\. Los topes por dirección IP se cuentan en memoria, y la dirección nunca se escribe en disco ni en registros\.$/,
    );
    expect(texto("en", "tmMore1")).toMatch(/^No ads, no trackers that follow you from site to site/);
    expect(texto("en", "tmMore1")).toContain(
      "To give you your 3 free Live draws only once, that service checks your session with Pollar and stores the identifier Pollar gives " +
        "your account, your public address, when you got them and how many you have left. It doesn't store your email or your name. " +
        "If you redeem an event coupon,",
    );
    expect(texto("en", "tmMore1")).toMatch(
      /If you redeem an event coupon, that service checks your session with Pollar and stores the identifier Pollar gives your account, your public address, the event and a fingerprint of the coupon, the time you redeemed it and how many Live draws you have left\. It doesn't store your email, your name, your session key or the coupon code\. The limits per IP address are counted in memory, and the address is never written to disk or to logs\.$/,
    );
  });

  it("con las reglas de escritura: sin tecnicismos, sin palabras de apuesta y con los nombres de los modos de cada idioma", () => {
    for (const k of [...CLAVES, "prNoteComision"]) {
      for (const l of IDIOMAS) {
        const t = texto(l, k);
        expect(t, `${l} ${k}`).not.toMatch(/[!¡;«»·•–-―←-⇿⟶➜]/);
        expect(t, `${l} ${k}`).not.toMatch(/rifa|loter[ií]a|raffle|ticket|boleto|apuest|\bbet(s|ting)?\b|gambl|usdc/i);
      }
      expect(texto("es", k), k).not.toMatch(/\b(token|hash|firma|contrato|red principal|mainnet|testnet|XLM|drand)\b/i);
      expect(texto("es", k), k).not.toMatch(/\bLive\b|\bTest\b/);
      expect(texto("en", k), k).not.toMatch(/\bOficial\b|\bPrueba\b/);
    }
  });

  it("no prometen lo que todavía no existe: ni paquetes ni precios del modo Oficial, ni una sola forma de entrar", () => {
    for (const k of [...CLAVES, "prNoteComision"]) {
      expect(texto("es", k), k).not.toMatch(/paquete|Bs\s?\d|US\$|d[oó]lar/i);
      expect(texto("en", k), k).not.toMatch(/package|bundle|US\$|dollar/i);
    }
    // El regalo es para quien entra con su cuenta, sea cual sea la forma: ninguna de estas frases nombra Google.
    for (const k of DEL_REGALO) for (const l of IDIOMAS) expect(texto(l, k), `${l} ${k}`).not.toMatch(/Google/);
  });

  it("como las páginas prometen el regalo y nombran el cupón, una publicación de producción sin el paso de la cuenta no sale", () => {
    // Si algún día estos textos vuelven al de antes, esta prueba falla y obliga a sacar también el freno de `alta-build.ts`.
    expect(texto("es", "prNote")).toMatch(/cupón/);
    expect(problemasDeAlta({ VERCEL_ENV: "production" }).join(" ")).toContain("VITE_ALTA=1");
  });
});
