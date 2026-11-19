// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { conElCostoDelRetiro, costoDelRetiroTexto, montoDelRetiro, pintarElCostoDelRetiro } from "./costo-del-retiro";
import { T, onLangChange, setLang } from "./i18n";

/**
 * El costo de retirar dicho donde corresponde: los términos, la página de precios y el plegado de la ventana del saldo
 * (este último, en `ui/saldo.test.ts` y `ui/saldo-premios.test.ts`). Los textos llevan el marcador `{c}` y
 * `costo-del-retiro.ts` pone el monto, que sale de la configuración del build (`stellar/retiro-config.ts`). Sin costo
 * configurado las páginas traen su bloque en un molde cerrado y no dicen nada. Las páginas se cargan tal como están
 * escritas, sin red.
 */

/** Una cuenta de verdad de testnet (pública): la que recibe el costo en estas pruebas. */
const CUENTA = "GDALL7OBL7A44KEXQJPQPKUFMS4A56UXWLTHNB3VIARSEJ65ILAZCFIT";
/** Lo que se cobra en estas pruebas: 50 centavos, en stroops. */
const CINCUENTA_CENTAVOS = 5_000_000n;

// En jsdom, `import.meta.url` no es la ruta del archivo: las páginas se leen desde la raíz del repositorio.
const leer = (f: string): string => readFileSync(resolve(process.cwd(), f), "utf8");
const cuerpo = (f: string): string => /<body>([\s\S]*)<\/body>/.exec(leer(f))?.[1]?.replace(/<script[\s\S]*?<\/script>/g, "") ?? "";
const dicho = (el: Element | null): string => (el?.textContent ?? "").replace(/\s+/g, " ").trim();

const CLAVES = ["prRetiroT", "prRetiro", "tmRetiroT", "tmRetiroB", "saldoRetiroPorQue"];

/**
 * Lo que hace `pagina.ts`: después de cada cambio de idioma, abre los moldes y pone el monto que dice la configuración
 * del costo. Acá se prende y se apaga a mano para ver las dos páginas.
 */
let costoPrendido = false;
beforeAll(() => {
  onLangChange((l) => pintarElCostoDelRetiro(document, costoPrendido ? montoDelRetiro(l, CINCUENTA_CENTAVOS) : null));
});
beforeEach(() => {
  costoPrendido = false;
  // Sin costo configurado, aunque la máquina que corre las pruebas tenga las variables en su `.env.local`.
  vi.stubEnv("VITE_RETIRO_COSTO", "");
  vi.stubEnv("VITE_RETIRO_CUENTA", "");
  setLang("es");
});
afterEach(() => {
  vi.unstubAllEnvs();
  document.body.innerHTML = "";
});

describe("el monto del retiro", () => {
  it("en español se escribe con coma decimal", () => {
    expect(montoDelRetiro("es", CINCUENTA_CENTAVOS)).toBe("0,50");
  });

  it("en inglés se escribe con punto decimal", () => {
    expect(montoDelRetiro("en", CINCUENTA_CENTAVOS)).toBe("0.50");
  });

  it("sin la configuración del costo no se dice nada, en los dos idiomas", () => {
    expect(costoDelRetiroTexto("es")).toBeNull();
    expect(costoDelRetiroTexto("en")).toBeNull();
  });

  it("sin decir el idioma, usa el de la página, y sin costo sigue sin decir nada", () => {
    expect(costoDelRetiroTexto()).toBeNull();
    setLang("en");
    expect(costoDelRetiroTexto()).toBeNull();
  });

  it("con el costo y la cuenta configurados, lo dice en el idioma pedido", () => {
    const env = { VITE_RETIRO_COSTO: "0.50", VITE_RETIRO_CUENTA: CUENTA };
    expect(costoDelRetiroTexto("es", env)).toBe("0,50");
    expect(costoDelRetiroTexto("en", env)).toBe("0.50");
  });

  it("con el costo y la cuenta configurados, sin decir el idioma usa el de la página", () => {
    const env = { VITE_RETIRO_COSTO: "1.25", VITE_RETIRO_CUENTA: CUENTA };
    expect(costoDelRetiroTexto(undefined, env)).toBe("1,25");
    setLang("en");
    expect(costoDelRetiroTexto(undefined, env)).toBe("1.25");
  });

  it("sin la cuenta no se cobra nada y no se dice nada", () => {
    expect(costoDelRetiroTexto("es", { VITE_RETIRO_COSTO: "0.50" })).toBeNull();
    expect(costoDelRetiroTexto("es", { VITE_RETIRO_COSTO: "0.50", VITE_RETIRO_CUENTA: "" })).toBeNull();
  });

  it("con el costo en cero, mal escrito o con una cuenta inválida no se dice nada", () => {
    expect(costoDelRetiroTexto("es", { VITE_RETIRO_COSTO: "0", VITE_RETIRO_CUENTA: CUENTA })).toBeNull();
    expect(costoDelRetiroTexto("es", { VITE_RETIRO_COSTO: "0,50", VITE_RETIRO_CUENTA: CUENTA })).toBeNull();
    expect(costoDelRetiroTexto("es", { VITE_RETIRO_COSTO: "0.50", VITE_RETIRO_CUENTA: "GHOLA" })).toBeNull();
  });

  it("sin pasarle el entorno, lee el del sitio", () => {
    vi.stubEnv("VITE_RETIRO_COSTO", "0.75");
    vi.stubEnv("VITE_RETIRO_CUENTA", CUENTA);
    expect(costoDelRetiroTexto("es")).toBe("0,75");
    expect(costoDelRetiroTexto("en")).toBe("0.75");
  });

  it("cambia cada marcador del texto por el monto", () => {
    expect(conElCostoDelRetiro("Cuesta {c} dólares, o sea {c}.", "0,50")).toBe("Cuesta 0,50 dólares, o sea 0,50.");
  });

  it("un texto sin marcador queda igual", () => {
    expect(conElCostoDelRetiro("Recibir premios es gratis.", "0,50")).toBe("Recibir premios es gratis.");
  });
});

describe("los moldes de una página", () => {
  const molde = (): string =>
    `<template data-con-retiro><section data-retiro><h2 data-i="x">Cuánto cuesta</h2><p data-i="y">Cuesta {c} por retiro.</p></section></template>` +
    `<p data-i="z">Afuera {c} queda como está.</p>`;

  it("con costo abre el molde y cambia el marcador en cada texto del bloque", () => {
    document.body.innerHTML = molde();
    pintarElCostoDelRetiro(document, "0,50");
    expect(document.querySelector("template")).toBeNull();
    expect(document.querySelector('[data-i="y"]')?.textContent).toBe("Cuesta 0,50 por retiro.");
  });

  it("no toca los textos de afuera del bloque", () => {
    document.body.innerHTML = molde();
    pintarElCostoDelRetiro(document, "0,50");
    expect(document.querySelector('[data-i="z"]')?.textContent).toBe("Afuera {c} queda como está.");
  });

  it("sin costo deja el molde cerrado y la página como estaba", () => {
    document.body.innerHTML = molde();
    const antes = document.body.innerHTML;
    pintarElCostoDelRetiro(document, null);
    expect(document.body.innerHTML).toBe(antes);
    expect(document.querySelector("[data-retiro]")).toBeNull();
  });

  it("sin pasarle el monto usa el de la configuración, que está vacía, y no abre nada", () => {
    document.body.innerHTML = molde();
    pintarElCostoDelRetiro(document);
    expect(document.querySelector("template[data-con-retiro]")).not.toBeNull();
    expect(document.querySelector("[data-retiro]")).toBeNull();
  });

  it("sin pasarle el monto, con el costo configurado abre el molde y pone el monto de la configuración", () => {
    vi.stubEnv("VITE_RETIRO_COSTO", "0.50");
    vi.stubEnv("VITE_RETIRO_CUENTA", CUENTA);
    document.body.innerHTML = molde();
    pintarElCostoDelRetiro(document);
    expect(document.querySelector("template[data-con-retiro]")).toBeNull();
    expect(document.querySelector('[data-i="y"]')?.textContent).toBe("Cuesta 0,50 por retiro.");
  });

  it("llamarla dos veces deja lo mismo", () => {
    document.body.innerHTML = molde();
    pintarElCostoDelRetiro(document, "0,50");
    const una = document.body.innerHTML;
    pintarElCostoDelRetiro(document, "0,50");
    expect(document.body.innerHTML).toBe(una);
  });

  it("un texto que el diccionario de la página no tiene queda con el que trae el bloque, sin el marcador", () => {
    document.body.innerHTML = molde();
    pintarElCostoDelRetiro(document, "0.50");
    expect(document.querySelector('[data-i="y"]')?.textContent).toBe("Cuesta 0.50 por retiro.");
  });

  it("un texto del diccionario sale en el idioma de la página y con el monto", () => {
    document.body.innerHTML = `<template data-con-retiro><section data-retiro><p data-i="prRetiro">{c}</p></section></template>`;
    setLang("en");
    pintarElCostoDelRetiro(document, "0.50");
    expect(document.querySelector('[data-i="prRetiro"]')?.textContent).toBe((T.en.prRetiro as string).replace("{c}", "0.50"));
  });

  it("una página sin moldes no cambia", () => {
    document.body.innerHTML = `<p data-i="z">Hola {c}</p>`;
    pintarElCostoDelRetiro(document, "0,50");
    expect(document.body.innerHTML).toBe(`<p data-i="z">Hola {c}</p>`);
  });
});

describe.each([
  { pagina: "terminos.html", titulo: "tmRetiroT", texto: "tmRetiroB" },
  { pagina: "precios.html", titulo: "prRetiroT", texto: "prRetiro" },
])("$pagina", ({ pagina, titulo, texto }) => {
  const montar = (): void => {
    document.body.innerHTML = cuerpo(pagina);
  };

  it("trae un solo molde del costo de retirar, con un bloque de título y texto", () => {
    montar();
    const moldes = document.querySelectorAll<HTMLTemplateElement>("template[data-con-retiro]");
    expect(moldes).toHaveLength(1);
    const bloque = moldes[0]?.content.querySelectorAll("[data-retiro]");
    expect(bloque).toHaveLength(1);
    const claves = [...(moldes[0]?.content.querySelectorAll<HTMLElement>("[data-i]") ?? [])].map((el) => el.dataset.i);
    expect(claves).toEqual([titulo, texto]);
  });

  it("el molde trae el texto en español del diccionario, con el marcador y sin ningún número escrito", () => {
    montar();
    const molde = document.querySelector<HTMLTemplateElement>("template[data-con-retiro]");
    expect(dicho(molde?.content.querySelector(`[data-i="${texto}"]`) ?? null)).toBe(T.es[texto]);
    expect(dicho(molde?.content.querySelector(`[data-i="${titulo}"]`) ?? null)).toBe(T.es[titulo]);
    expect(molde?.innerHTML ?? "").not.toMatch(/0[,.]50/);
  });

  it("apagado, la página no dice nada del costo: el molde está cerrado", () => {
    montar();
    pintarElCostoDelRetiro(document);
    expect(document.querySelector("[data-retiro]")).toBeNull();
    expect(document.body.textContent).not.toContain(T.es[titulo] as string);
    expect(document.body.textContent).not.toContain("{c}");
  });

  it("con costo y en español, el texto sale con el monto y sin marcador", () => {
    montar();
    costoPrendido = true;
    setLang("es");
    expect(dicho(document.querySelector(`[data-i="${texto}"]`))).toContain("cuesta 0,50 dólares digitales por retiro");
    expect(document.body.textContent).not.toContain("{c}");
  });

  it("con costo y al pasar a inglés, el texto sale con el monto con punto y sin marcador", () => {
    montar();
    costoPrendido = true;
    setLang("en");
    expect(dicho(document.querySelector(`[data-i="${texto}"]`))).toContain("costs 0.50 digital dollars per withdrawal");
    expect(document.body.textContent).not.toContain("{c}");
  });

  it("con costo y al volver a español, vuelve el monto con coma", () => {
    montar();
    costoPrendido = true;
    setLang("en");
    setLang("es");
    expect(dicho(document.querySelector(`[data-i="${texto}"]`))).toContain("0,50 dólares digitales");
  });
});

describe("lo que dicen los textos del costo", () => {
  it.each(CLAVES)("%s está en español y en inglés", (clave) => {
    expect(typeof T.es[clave], `es.${clave}`).toBe("string");
    expect(typeof T.en[clave], `en.${clave}`).toBe("string");
  });

  it.each(["prRetiro", "tmRetiroB", "saldoRetiroPorQue"])("%s lleva el marcador del monto y ningún número escrito", (clave) => {
    for (const idioma of ["es", "en"] as const) {
      const texto = T[idioma][clave] as string;
      expect(texto, `${idioma}.${clave}`).toContain("{c}");
      expect(texto.replace("{c}", ""), `${idioma}.${clave}`).not.toMatch(/\d/);
    }
  });

  it.each(["prRetiro", "tmRetiroB"])("%s dice que recibir un premio y ingresar dólares son gratis, y que el costo es por retiro", (clave) => {
    expect(T.es[clave]).toMatch(/Recibir un premio .*es gratis, e ingresar dólares digitales a tu cuenta también/);
    expect(T.es[clave]).toContain("por retiro, sea cual sea el monto");
    expect(T.en[clave]).toMatch(/Receiving a prize .*is free, and so is adding digital dollars to your account/);
    expect(T.en[clave]).toContain("per withdrawal, whatever the amount");
  });

  it("el plegado del saldo dice el costo por retiro y que recibir premios es gratis", () => {
    expect(T.es.saldoRetiroPorQue).toBe("Cada retiro cuesta {c} dólares digitales, sea cual sea el monto. Recibir premios es gratis.");
    expect(T.en.saldoRetiroPorQue).toBe("Each withdrawal costs {c} digital dollars, whatever the amount. Receiving prizes is free.");
  });

  it("los términos dicen que el costo se ve antes de confirmar", () => {
    expect(T.es.tmRetiroB).toContain("lo ves antes de confirmar");
    expect(T.en.tmRetiroB).toContain("you see it before you confirm");
  });

  it.each(CLAVES)("%s sin comillas angulares, punto y coma, punto medio, raya larga ni signos de exclamación", (clave) => {
    for (const idioma of ["es", "en"] as const) expect(String(T[idioma][clave]), `${idioma}.${clave}`).not.toMatch(/[«»;·—!¡]/);
  });

  it.each(CLAVES)("%s sin palabras técnicas ni de apuesta", (clave) => {
    const tecnicas = "firma|hash|red|comisi[oó]n|contrato|XDR|co-?firma|USDC|Stellar|billetera|wallet";
    const deApuesta = "rifa|loter[ií]a|boleto|ticket|apuesta|raffle|lottery|bet";
    const prohibidas = new RegExp(`\\b(${tecnicas}|${deApuesta})\\b`, "i");
    for (const idioma of ["es", "en"] as const) expect(String(T[idioma][clave]), `${idioma}.${clave}`).not.toMatch(prohibidas);
  });
});

describe("pagina.ts", () => {
  it("pone el monto después de cada cambio de idioma, y lo registra antes del primer setLang", () => {
    const fuente = leer("src/pagina.ts");
    const registro = fuente.indexOf("onLangChange(() => pintarElCostoDelRetiro(document))");
    const primero = fuente.indexOf("setLang(initialLang())");
    expect(registro).toBeGreaterThan(-1);
    expect(primero).toBeGreaterThan(registro);
  });
});
