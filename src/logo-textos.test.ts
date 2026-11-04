import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { T } from "./i18n";

/**
 * Los textos del logo de la comunidad: en los dos idiomas, sin el separador
 * punto medio, sin las palabras que no van, y que lo que dicen sea lo que se
 * puede afirmar.
 */

const CLAVES = [
  "logoHecho", "logoAlt", "logoPoner", "logoCambiar", "logoQuitar", "logoFondo", "logoVista", "logoNoAbre", "logoPesa",
  "logoGrande", "logoListo", "logoQuitado", "logoSinGuardar", "logoComprobar", "tmLogoT", "tmLogoB", "prLogoNota",
] as const;

describe("textos del logo", () => {
  it("cada clave es una cadena en español y en inglés", () => {
    for (const k of CLAVES) {
      expect(typeof T.es[k], `es ${k}`).toBe("string");
      expect(typeof T.en[k], `en ${k}`).toBe("string");
      expect(String(T.es[k]).length).toBeGreaterThan(3);
    }
  });

  it("ninguno usa el punto medio, ni rifa, apuesta o raffle", () => {
    for (const k of CLAVES) {
      for (const l of ["es", "en"] as const) {
        const v = String(T[l][k]);
        expect(v, `${l} ${k}`).not.toContain("·");
        expect(v, `${l} ${k}`).not.toMatch(/\brifa|apuesta|raffle/i);
      }
    }
  });

  it("el español usa voseo, no tuteo", () => {
    for (const k of ["logoVista", "logoNoAbre", "logoPesa", "logoGrande", "logoSinGuardar", "logoComprobar", "tmLogoB"] as const) {
      expect(String(T.es[k]), k).not.toMatch(/\b(?:puedes|tienes|sube|usa|prueba|escríbenos|escribenos)\b/i);
    }
  });

  it("«Hecho con Tinkazo» sale igual en lo gratis y en precios", () => {
    expect(T.es.logoHecho).toBe("Hecho con Tinkazo");
    expect(T.en.logoHecho).toBe("Made with Tinkazo");
    expect(String(T.es.prLogoNota)).toContain("Hecho con Tinkazo");
    expect(String(T.en.prLogoNota)).toContain("Made with Tinkazo");
    expect(String(T.es.prLogoNota)).toMatch(/gratis/);
    expect(String(T.en.prLogoNota)).toMatch(/free/);
  });

  it("la franja de comprobar dice lo que se sabe: quién lo agregó, que Tinkazo no lo revisó y que no se comprueba", () => {
    for (const l of ["es", "en"] as const) {
      const v = String(T[l].logoComprobar);
      expect(v).toMatch(l === "es" ? /quien armó este enlace\. Tinkazo no lo revisó/ : /whoever made this link/);
      expect(v).toMatch(l === "es" ? /Tinkazo no lo revisó/ : /Tinkazo did not review it/);
      expect(v).toMatch(l === "es" ? /no es parte de lo que se comprueba/ : /not part of what gets checked/);
      expect(v).toContain("hola@tinkazo.app");
    }
  });

  it("la vista previa dice que queda en este navegador y que el logo de un sponsor no va", () => {
    expect(String(T.es.logoVista)).toMatch(/en este navegador/);
    expect(String(T.es.logoVista)).toMatch(/sponsor no va/);
    expect(String(T.en.logoVista)).toMatch(/stays in this browser/);
    expect(String(T.en.logoVista)).toMatch(/sponsor's logo does not go/);
  });

  it("los términos dicen que el logo no es parte del sorteo, que Tinkazo no lo revisa y cómo se borra", () => {
    expect(String(T.es.tmLogoB)).toMatch(/No es parte del sorteo/);
    expect(String(T.es.tmLogoB)).toMatch(/Tinkazo no lo revisa/);
    expect(String(T.es.tmLogoB)).toMatch(/borramos ese enlace corto/);
    expect(String(T.en.tmLogoB)).toMatch(/not part of the draw/);
    expect(String(T.en.tmLogoB)).toMatch(/doesn't review it/);
    expect(String(T.en.tmQ4B)).toContain("your logo, if you uploaded one");
    expect(String(T.es.tmQ4B)).toContain("tu logo, si subiste uno");
    expect(String(T.es.tmCortoB)).toContain("y tu logo, si subiste uno");
    expect(String(T.en.tmCortoB)).toContain("and your logo, if you uploaded one");
  });

  it("terminos.html y precios.html traen el mismo texto en español que el diccionario", () => {
    const terminos = readFileSync("terminos.html", "utf8");
    const precios = readFileSync("precios.html", "utf8");
    expect(terminos).toContain(`data-i="tmLogoB">${T.es.tmLogoB as string}</p>`);
    expect(terminos).toContain(`data-i="tmLogoT">${T.es.tmLogoT as string}</h3>`);
    expect(terminos).toContain(T.es.tmMore4 as string);
    expect(terminos).toContain(T.es.tmMore1 as string);
    expect(terminos).toContain("tu logo, si subiste uno; y la llave");
    expect(precios).toContain(`data-i="prLogoNota">${T.es.prLogoNota as string}</p>`);
  });

  it("el sitemap tiene la fecha nueva de los términos y de precios", () => {
    const mapa = readFileSync("public/sitemap.xml", "utf8");
    expect(mapa).toMatch(/terminos\.html<\/loc><lastmod>2026-11-04/);
    expect(mapa).toMatch(/precios\.html<\/loc><lastmod>2026-11-0[24]/);
  });

  it("verificar.html y evento.html tienen la franja y el logo no entra al comprobante", () => {
    for (const p of ["verificar.html", "evento.html"]) expect(readFileSync(p, "utf8")).toMatch(/<aside class="logo-franja" id="logo-franja"[^>]* hidden>/);
    // El protocolo y el comprobante no se tocaron: no saben del logo.
    for (const f of ["src/protocol/proof.ts", "src/protocol/evento.ts", "src/protocol/select.ts", "src/protocol/canonical.ts"]) {
      expect(readFileSync(f, "utf8"), f).not.toMatch(/logo/i);
    }
  });
});
