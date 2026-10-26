import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { T, type Lang } from "../i18n";
import { TEXTOS_DEL_SELLO, type TextoDelSello, claveDelSello, pieDeLaEspera, ponerTextoDelSello, sinSelloAhora } from "./sin-sello-textos";

/**
 * Un sorteo que se siguió sin sello nunca suena a sellado ni invita a comprobar (protocolo §8:
 * lo que no está anclado jamás se presenta como verificable). Sin Chrome ni red: los textos
 * de los lugares donde la batería de cierre (26 de octubre de 2026) los vio mal, con sello y sin él.
 */

const LANGS: Lang[] = ["es", "en"];
const fuente = (ruta: string): string => readFileSync(new URL(ruta, import.meta.url), "utf8");

/** "Sin sello: no se puede comprobar" no invita a nada: es lo que se quiere decir. Lo demás con "comprobar" sí. */
const NEGADO = /no se (?:puede|va a poder) comprobar|(?:can't|cannot|won't be able to) be (?:checked|verified)/gi;
const SUENA_A_SELLADO = /sellad[oa]s?|sealed/i;
const INVITA = /comprob|verific|\bverif|\bcheck/i;

const cadena = (lang: Lang, clave: string): string => {
  const v = T[lang][clave];
  if (typeof v !== "string") throw new Error(`${lang}.${clave} no es una cadena`);
  return v;
};

/** Las seis versiones de la página y la sala, una por clave de `TEXTOS_DEL_SELLO`. */
const CLAVES = Object.keys(TEXTOS_DEL_SELLO) as TextoDelSello[];

describe("sinSelloAhora", () => {
  it("solo es sin sello si se siguió sin sello y el sello no entró", () => {
    expect(sinSelloAhora(null)).toBe(false);
    expect(sinSelloAhora(undefined)).toBe(false);
    expect(sinSelloAhora({})).toBe(false);
    expect(sinSelloAhora({ sinSello: true })).toBe(true);
    expect(sinSelloAhora({ sinSello: false })).toBe(false);
    // Si el sello entró tarde, ya es comprobable aunque la marca siga.
    expect(sinSelloAhora({ sinSello: true, raffleId: 7n })).toBe(false);
    expect(sinSelloAhora({ raffleId: 7n })).toBe(false);
  });
});

describe("los cuatro lugares: la espera en grande, el título, el QR del resultado y la pantalla grande", () => {
  for (const lang of LANGS) {
    it(`${lang}: la espera en grande sin sello no dice sellada ni invita a comprobar; con sello, igual que siempre`, () => {
      const sin = pieDeLaEspera(lang, 18, true);
      const con = pieDeLaEspera(lang, 18, false);
      expect(sin).toContain("18");
      expect(sin).not.toMatch(SUENA_A_SELLADO);
      expect(sin.replace(NEGADO, "")).not.toMatch(INVITA);
      expect(sin).toMatch(lang === "es" ? /sin sello/i : /no seal/i);
      expect(sin).toMatch(lang === "es" ? /no se puede comprobar/ : /can't be checked/);
      expect(con).toBe(T[lang].espPie(18));
      expect(con).toMatch(SUENA_A_SELLADO);
      expect(sin).not.toBe(con);
    });

    it(`${lang}: el título de la sección sin sello es "lista cerrada, sin sello"; con sello, "lista sellada"`, () => {
      const sin = cadena(lang, claveDelSello("titulo", true));
      const con = cadena(lang, claveDelSello("titulo", false));
      expect(sin).not.toMatch(SUENA_A_SELLADO);
      expect(sin).toMatch(lang === "es" ? /^Lista cerrada, sin sello$/ : /^List closed, no seal$/);
      expect(con).toBe(cadena(lang, "p2"));
      expect(con).toMatch(SUENA_A_SELLADO);
    });

    it(`${lang}: la línea bajo la cuenta sin sello no promete que nadie pueda cambiar ni elegir nada`, () => {
      const sin = cadena(lang, claveDelSello("lineaDeLaEspera", true));
      const con = cadena(lang, claveDelSello("lineaDeLaEspera", false));
      expect(sin).not.toMatch(SUENA_A_SELLADO);
      expect(sin.replace(NEGADO, "")).not.toMatch(INVITA);
      expect(sin).toMatch(lang === "es" ? /sin sello/i : /no seal/i);
      expect(con).toBe(cadena(lang, "waitLine"));
    });

    it(`${lang}: el QR del resultado sin sello no invita a comprobar; con sello, sí`, () => {
      const sin = cadena(lang, claveDelSello("qrDelResultado", true));
      const con = cadena(lang, claveDelSello("qrDelResultado", false));
      expect(sin).not.toMatch(SUENA_A_SELLADO);
      expect(sin.replace(NEGADO, "")).not.toMatch(INVITA);
      expect(sin).toMatch(lang === "es" ? /sin sello/i : /no seal/i);
      expect(con).toBe(cadena(lang, "qrCaption"));
      expect(con).toMatch(INVITA);
    });

    it(`${lang}: el QR del resultado en grande sin sello no invita a comprobar; con sello, sí`, () => {
      const sin = cadena(lang, claveDelSello("qrEnGrande", true));
      const con = cadena(lang, claveDelSello("qrEnGrande", false));
      expect(sin).not.toMatch(SUENA_A_SELLADO);
      expect(sin.replace(NEGADO, "")).not.toMatch(INVITA);
      expect(con).toMatch(INVITA);
    });

    it(`${lang}: la lista en la sala (título, pie y la nota del celular) sin sello no dice sellada`, () => {
      for (const cual of ["tituloDeLaSala", "pieDeLaSala"] as const) {
        const sin = cadena(lang, claveDelSello(cual, true));
        const con = cadena(lang, claveDelSello(cual, false));
        expect(sin, `${lang}.${cual}`).not.toMatch(SUENA_A_SELLADO);
        expect(sin.replace(NEGADO, ""), `${lang}.${cual}`).not.toMatch(INVITA);
        expect(sin, `${lang}.${cual}`).toMatch(lang === "es" ? /sin sello/i : /no seal/i);
        expect(con, `${lang}.${cual}`).toMatch(SUENA_A_SELLADO);
      }
      const nota = cadena(lang, "listaNotaCerrada");
      expect(nota).not.toMatch(SUENA_A_SELLADO);
      expect(nota.replace(NEGADO, "")).not.toMatch(INVITA);
      expect(nota).toMatch(lang === "es" ? /sin sello/i : /no seal/i);
      expect(cadena(lang, "listaNotaSellada")).toMatch(SUENA_A_SELLADO);
    });
  }

  it("cada clave existe como cadena en español y en inglés, con y sin sello", () => {
    const faltan = LANGS.flatMap((l) => CLAVES.flatMap((c) => TEXTOS_DEL_SELLO[c].filter((k) => typeof T[l][k] !== "string").map((k) => `${l}.${k}`)));
    expect(faltan).toEqual([]);
    expect(LANGS.map((l) => typeof T[l].espPieSinSello)).toEqual(["function", "function"]);
    expect(LANGS.map((l) => typeof T[l].listaNotaCerrada)).toEqual(["string", "string"]);
  });

  it("la versión sin sello es otra cadena que la de siempre en las dos lenguas", () => {
    for (const l of LANGS) for (const c of CLAVES) expect(cadena(l, TEXTOS_DEL_SELLO[c][1]), `${l}.${c}`).not.toBe(cadena(l, TEXTOS_DEL_SELLO[c][0]));
  });
});

describe("ponerTextoDelSello", () => {
  const falso = (): HTMLElement => ({ dataset: {} as DOMStringMap, textContent: "" }) as unknown as HTMLElement;

  it("deja la clave en data-i para que el cambio de idioma lo repinte con la misma versión", () => {
    const el = falso();
    ponerTextoDelSello(el, "titulo", true);
    expect(el.dataset.i).toBe("p2SinSello");
    expect(typeof el.textContent).toBe("string");
    expect(el.textContent).not.toMatch(SUENA_A_SELLADO);
    ponerTextoDelSello(el, "titulo", false);
    expect(el.dataset.i).toBe("p2");
    expect(el.textContent).toMatch(SUENA_A_SELLADO);
  });

  it("no rompe si el elemento no está", () => {
    expect(() => ponerTextoDelSello(null, "qrDelResultado", true)).not.toThrow();
  });
});

describe("el cableado: cada lugar usa la versión que corresponde", () => {
  it("la espera en grande arma el pie con pieDeLaEspera y lo vuelve a armar si el sello entra tarde", () => {
    const f = fuente("./espera.ts");
    expect(f).toContain("pieDeLaEspera(getLang(), f.names.length, sinSelloAhora(f))");
    expect(f).toContain('"tinkazo:sello"');
    expect(f).not.toContain("espPie(");
  });

  it("la sección sellada pone el título y la línea de la cuenta según el sello, cada segundo y al entrar el sello", () => {
    const f = fuente("./freeze.ts");
    expect(f).toContain('ponerTextoDelSello(document.querySelector<HTMLElement>("#sec-frozen .head h2 [data-i]"), "titulo", sin)');
    expect(f).toContain('claveDelSello("lineaDeLaEspera", sinSelloAhora(app.frozen))');
    expect(f).not.toContain('t("waitLine")');
    // En showFrozen y cuando el sello entra tarde.
    expect(f.match(/\btextosDelSello\(\);/g)?.length).toBe(2);
    expect(f).toContain('new CustomEvent("tinkazo:sello")');
  });

  it("el QR del resultado en la página cambia de leyenda al armar el comprobante", () => {
    const f = fuente("./draw.ts");
    expect(f).toContain('ponerTextoDelSello(document.querySelector<HTMLElement>("#qr-box .kicker"), "qrDelResultado", sinSello)');
  });

  it("la pantalla grande usa la leyenda del QR sin sello y deja el pie a la vista con la clase sin-sello", () => {
    const f = fuente("./pantalla.ts");
    expect(f).toContain('claveDelSello("qrEnGrande", sinSello)');
    expect(f).toContain('<p class="sala-pie${sinSello ? " sin-sello" : ""}">');
    expect(f).toContain('t(sinSello ? "redSinSelloEtiqueta"');
    const css = fuente("../styles.css");
    // Sin esta regla el pie se esconde siempre (letra grande, e845f0c) y la sala nunca lee "Sin sello".
    expect(css).toContain(".pantalla .sala-pie:not(.sin-sello) { display: none; }");
    expect(css).not.toMatch(/\.pantalla \.sala-pie \{ display: none; \}/);
  });

  it("la lista de la sala y la del celular dicen lo mismo: cerrada, sin sello", () => {
    const sala = fuente("./sala.ts");
    expect(sala).toContain('claveDelSello("tituloDeLaSala", sin)');
    expect(sala).toContain('claveDelSello("pieDeLaSala", sin)');
    expect(sala).toContain('searchParams.set("sellada", sin ? "sin" : "1")');
    const lista = fuente("../lista.ts");
    expect(lista).toContain('v !== "1" && v !== "sin"');
    expect(lista).toContain('sin ? "listaNotaCerrada" : "listaNotaSellada"');
  });
});
