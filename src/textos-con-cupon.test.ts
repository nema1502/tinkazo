import { describe, expect, it } from "vitest";
import { T } from "./i18n";
import { HAY_MODO_OFICIAL, TEXTOS_MODO_OFICIAL } from "./i18n-modo-oficial";
import { problemasDeAlta } from "./stellar/alta-build";

/**
 * Con el modo Oficial abierto con cupones de evento, las páginas de lectura dicen quién paga la comisión de la red en
 * Oficial (con el cupón, Tinkazo; con la billetera propia, quien entra) y los términos dicen qué guarda el servicio al
 * canjear. Esos textos viven en el diccionario del modo Oficial (`i18n-modo-oficial.ts`) y el HTML de las cuatro páginas
 * trae los mismos (`seo.test.ts` y `revision-textos.test.ts` los comparan).
 */

const IDIOMAS = ["es", "en"] as const;
const CLAVES = ["nextBody", "faq3a", "cfCostoB", "tmPatrocinio", "tmMore1", "prNote"];
const DE_QUIEN_PAGA = ["nextBody", "faq3a", "cfCostoB", "tmPatrocinio"];
const texto = (l: (typeof IDIOMAS)[number], k: string): string => String(T[l][k]);

describe("los textos con cupón de las páginas de lectura", () => {
  it("son estas claves, en el diccionario del modo Oficial y en los dos idiomas", () => {
    expect(HAY_MODO_OFICIAL).toBe(true);
    for (const l of IDIOMAS) {
      for (const k of CLAVES) {
        expect(Object.keys(TEXTOS_MODO_OFICIAL[l]), `${l} ${k}`).toContain(k);
        expect(T[l][k], `${l} ${k}`).toBe(TEXTOS_MODO_OFICIAL[l][k]);
      }
    }
  });

  it("quién paga: con el cupón de tu evento lo cubre Tinkazo, y con la billetera propia lo paga quien entra", () => {
    for (const k of DE_QUIEN_PAGA) {
      expect(texto("es", k), k).toMatch(/cupón de tu evento/);
      expect(texto("en", k), k).toMatch(/coupon from your event/);
      expect(texto("es", k), k).toMatch(/propia billetera/);
      expect(texto("en", k), k).toMatch(/own wallet/);
    }
    expect(texto("es", "nextBody")).toContain(
      "El costo de sellar lo paga Tinkazo en el modo Prueba, y también en el modo Oficial si usás el cupón de tu evento. En el modo Oficial, quien entra con su propia billetera paga la comisión de la red, que es de centavos.",
    );
    expect(texto("en", "nextBody")).toContain(
      "Tinkazo pays the cost of sealing in Test mode, and in Live mode too if you use a coupon from your event. In Live mode, if you sign in with your own wallet, you pay the network's charge, which is a few cents.",
    );
    expect(texto("es", "faq3a")).toMatch(
      /En el modo Oficial, con el cupón de tu evento, Tinkazo cubre la comisión de la red\. En ese modo, quien entra con su propia billetera la paga de su cuenta\.$/,
    );
    expect(texto("en", "faq3a")).toMatch(
      /In Live mode, with a coupon from your event, Tinkazo covers the network's charge\. In that mode, if you sign in with your own wallet, you pay it from your account\.$/,
    );
    expect(texto("es", "cfCostoB")).toContain("En el modo Oficial lo paga Tinkazo si usás el cupón de tu evento, y quien entra con su propia billetera lo paga de su cuenta.");
    expect(texto("en", "cfCostoB")).toContain("In Live mode Tinkazo pays it if you use a coupon from your event, and if you sign in with your own wallet, you pay it from your account.");
    expect(texto("es", "tmPatrocinio")).toMatch(
      /En el modo Oficial, con el cupón de tu evento, Tinkazo cubre esa comisión mientras te queden sorteos oficiales\. En ese modo, quien entra con su propia billetera la paga de su cuenta\.$/,
    );
    expect(texto("en", "tmPatrocinio")).toMatch(
      /In Live mode, with a coupon from your event, Tinkazo covers that charge while you have Live draws left\. In that mode, if you sign in with your own wallet, you pay it from your account\.$/,
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

  it("lo de Prueba sigue igual: ahí no hay cupón y Tinkazo cubre la comisión", () => {
    expect(texto("es", "tmPatrocinio")).toContain("En el modo Prueba, Tinkazo cubre la comisión que cobra la red por sellar y sortear.");
    expect(texto("en", "tmPatrocinio")).toContain("In Test mode, Tinkazo covers the charge the network makes for sealing and drawing.");
    expect(texto("es", "cfCostoB")).toContain("En el modo Prueba lo paga Tinkazo.");
    expect(texto("en", "cfCostoB")).toContain("In Test mode Tinkazo pays it.");
    expect(texto("es", "faq3a")).toMatch(/^Hoy Tinkazo no cobra nada\. Muy pronto publicamos los precios para quien organiza, y te avisamos antes de cobrar\. Participar y comprobar son gratis siempre\./);
    expect(texto("en", "faq3a")).toMatch(/^Tinkazo charges nothing for now\. We'll publish pricing for organizers very soon, and we'll tell you before we charge\. Taking part and checking are always free\./);
  });

  it("los términos dicen qué guarda el servicio al canjear un cupón y qué no, después de lo que ya decían", () => {
    expect(texto("es", "tmMore1")).toMatch(/^No hay publicidad ni rastreadores que te sigan de un sitio a otro/);
    expect(texto("es", "tmMore1")).toContain("Al compartir o mostrar en grande, se guarda en Cloudflare una copia cifrada del comprobante, que incluye la lista.");
    expect(texto("es", "tmMore1")).toContain("No guarda la lista, nombres ni direcciones IP.");
    // Un fondo, sin decir de quién, se puede leer como un fondo de terceros que paga las comisiones.
    expect(texto("es", "tmMore1")).toContain("Para cuidar el saldo con que Tinkazo la paga, ese servicio anota los sellos de cada cuenta");
    expect(texto("en", "tmMore1")).toContain("To protect the balance Tinkazo pays it from, that service records each account's seals");
    for (const l of IDIOMAS) expect(texto(l, "tmMore1"), l).not.toMatch(/\bfondo\b|\bfund\b/);
    expect(texto("es", "tmMore1")).toMatch(
      /Si canjeás un cupón de evento, ese servicio confirma tu sesión con Pollar y guarda el identificador que Pollar le da a tu cuenta, tu dirección pública, el evento y una huella del cupón, la hora del canje y cuántos sorteos oficiales te quedan\. No guarda tu correo, tu nombre, la llave de tu sesión ni el código del cupón\. Los topes por dirección IP se cuentan en memoria, y la dirección nunca se escribe en disco ni en registros\.$/,
    );
    expect(texto("en", "tmMore1")).toMatch(/^No ads, no trackers that follow you from site to site/);
    expect(texto("en", "tmMore1")).toMatch(
      /If you redeem an event coupon, that service checks your session with Pollar and stores the identifier Pollar gives your account, your public address, the event and a fingerprint of the coupon, the time you redeemed it and how many Live draws you have left\. It doesn't store your email, your name, your session key or the coupon code\. The limits per IP address are counted in memory, and the address is never written to disk or to logs\.$/,
    );
  });

  it("precios: con un cupón de tu evento, el modo Oficial es gratis, y participar y comprobar es gratis siempre", () => {
    expect(texto("es", "prNote")).toBe("El modo Prueba es gratis. El modo Oficial también, con el cupón de tu evento. Participar en un sorteo y comprobarlo es gratis, siempre.");
    expect(texto("en", "prNote")).toBe("Test mode is free. So is Live mode, with a coupon from your event. Joining a draw and checking it is always free.");
  });

  it("con las reglas de escritura: sin tecnicismos, sin palabras de apuesta y con los nombres de los modos de cada idioma", () => {
    for (const k of CLAVES) {
      for (const l of IDIOMAS) {
        const t = texto(l, k);
        expect(t, `${l} ${k}`).not.toMatch(/[!¡\u00b7\u2022\u2013-\u2015\u2190-\u21ff\u27f6\u279c]/);
        expect(t, `${l} ${k}`).not.toMatch(/rifa|loter[ií]a|raffle|ticket|boleto|apuest|\bbet(s|ting)?\b|gambl|usdc/i);
      }
      expect(texto("es", k), k).not.toMatch(/\b(token|hash|firma|contrato|red principal|mainnet|testnet|XLM|drand)\b/i);
      expect(texto("es", k), k).not.toMatch(/\bLive\b|\bTest\b/);
      expect(texto("en", k), k).not.toMatch(/\bOficial\b|\bPrueba\b/);
    }
  });

  it("no prometen lo que todavía no existe: ni paquetes ni precios del modo Oficial", () => {
    for (const k of CLAVES) {
      expect(texto("es", k), k).not.toMatch(/paquete|Bs\s?\d|US\$/i);
      expect(texto("en", k), k).not.toMatch(/package|bundle|US\$/i);
    }
  });

  it("como las páginas dicen que con un cupón el modo Oficial es gratis, una publicación de producción sin el acceso por cupón no sale", () => {
    // Si algún día estos textos vuelven al de antes, esta prueba falla y obliga a sacar también el freno de `alta-build.ts`.
    expect(texto("es", "prNote")).toMatch(/cupón/);
    expect(problemasDeAlta({ VERCEL_ENV: "production" }).join(" ")).toContain("VITE_ALTA=1");
  });
});
