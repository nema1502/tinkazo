// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { T } from "./i18n";
import config from "../vite.config";

/**
 * La página del enlace de cada persona en un Amigo secreto (confirmar.html y src/confirmar.ts). Antes cargaba solo el
 * módulo del fragmento: sin lo común de las páginas, `?theme=` no hacía nada, el menú Más no abría en el celular, el
 * título y la descripción quedaban en castellano en inglés y, con un enlace roto, el encabezado seguía a la vista encima
 * del aviso.
 */

vi.mock("./pagina", () => ({}));

// Desde la raíz del repositorio: con jsdom, import.meta.url no es una dirección de archivo.
const leer = (p: string): string => readFileSync(join(process.cwd(), p), "utf8");
const html = leer("confirmar.html");
const $ = (id: string): HTMLElement => document.getElementById(id) as HTMLElement;
const fragmento = (v: unknown): string => "#r" + Buffer.from(JSON.stringify(v), "utf8").toString("base64url");
const BUENO = fragmento({ v: 1, kind: "amigo", round: 32254977, from: "Ana Vargas", to: "Jorge Mamani", prize: "Navidad" });

/** Los textos que el build inyecta en la página, con el mismo plugin de Vite que usan dev y build. */
async function textosInyectados(): Promise<Record<string, Record<string, string>> | null> {
  const plugins = config.plugins as Array<{ name: string; transformIndexHtml?: { handler: Function } }>;
  const plugin = plugins.find((p) => p.name === "tinkazo:textos-por-pagina");
  const archivo = join(process.cwd(), "confirmar.html");
  const avisar = (s: string): never => {
    throw new Error(s);
  };
  const r = await plugin?.transformIndexHtml?.handler.call({ warn: avisar }, html, { filename: archivo, path: "/confirmar.html" });
  return r ? (JSON.parse(r[0].children) as Record<string, Record<string, string>>) : null;
}

/** Abre la página con un fragmento: el cuerpo del HTML de verdad, los textos del diccionario y src/confirmar.ts. */
async function abrir(hash: string): Promise<typeof import("./idioma")> {
  vi.resetModules();
  history.replaceState(null, "", `/confirmar.html${hash}`);
  document.body.innerHTML = new DOMParser().parseFromString(html, "text/html").body.innerHTML;
  const idioma = await import("./idioma");
  idioma.usarTextos({ es: T.es, en: T.en });
  idioma.setLang("es");
  await import("./confirmar");
  await vi.waitFor(() => expect($("c-ok").hidden && $("c-error").hidden).toBe(false));
  return idioma;
}

describe("confirmar.html carga lo común de las páginas", () => {
  it("su entrada es un script externo que importa pagina.ts, sin módulo en línea", () => {
    expect(html).toMatch(/<script type="module" src="\/src\/confirmar\.ts"><\/script>/);
    expect(html).not.toMatch(/<script type="module">/);
    expect(leer("src/confirmar.ts")).toMatch(/^import "\.\/pagina";/m);
  });

  it("el build le trae los textos de lo común, como la cuenta de la cabecera, y los de la página", async () => {
    const textos = await textosInyectados();
    for (const l of ["es", "en"] as const) {
      for (const k of ["navCuenta", "confirmarT", "confirmarNota", "confirmarError", "confirmarIr", "amigoPrize", "confirmarTitulo"]) {
        expect(textos?.[l]?.[k], `${l}.${k}`).toBe(T[l][k]);
      }
    }
  });

  it("el título y la descripción se piden por clave, y en el HTML son los del castellano, sin nombres", () => {
    const etiqueta = html.match(/<html\b[^>]*>/)?.[0] ?? "";
    expect(etiqueta).toContain('data-titulo-clave="confirmarTitulo"');
    expect(etiqueta).toContain('data-desc-clave="confirmarDesc"');
    expect(html.match(/<title>([^<]*)<\/title>/)?.[1]).toBe(T.es.confirmarTitulo);
    expect(html.match(/<meta name="description" content="([^"]*)"/)?.[1]).toBe(T.es.confirmarDesc);
  });

  it("ningún elemento con data-i lleva la línea con el nombre: la barrida del idioma escribiría la clave cruda", () => {
    expect(html).not.toMatch(/data-i="confirmarT"/);
  });

  it("el aviso del enlace roto va antes del regalo, con su propio título", () => {
    const doc = new DOMParser().parseFromString(html, "text/html");
    expect(doc.querySelector("h1")?.dataset.i).toBe("confirmarError");
    expect(doc.getElementById("c-ok")?.hidden).toBe(true);
    expect(doc.getElementById("c-error")?.hidden).toBe(true);
  });

  it("el regalo escondido no queda a la vista por el display del hero", () => {
    expect(leer("src/styles.css")).toMatch(/\.hero\.confirmar-ok\[hidden\]\s*\{\s*display:\s*none;?\s*\}/);
  });
});

describe("lo que dice la página", () => {
  it("con un enlace bueno: el nombre del sorteo, quién abre y a quién le regala, y el aviso queda escondido", async () => {
    await abrir(BUENO);
    expect($("c-ok").hidden).toBe(false);
    expect($("c-error").hidden).toBe(true);
    expect($("c-premio").textContent).toBe("Navidad");
    expect($("c-para").textContent).toBe("Ana Vargas, te toca regalarle a");
    expect($("c-hacia").textContent).toBe("Jorge Mamani");
  });

  it("al cambiar de idioma, la línea con el nombre se traduce y el nombre sigue", async () => {
    const idioma = await abrir(BUENO);
    idioma.setLang("en");
    expect($("c-para").textContent).toBe("Ana Vargas, you give a gift to");
    expect($("c-hacia").textContent).toBe("Jorge Mamani");
  });

  it("sin nombre del sorteo, el sticker dice Amigo secreto", async () => {
    await abrir(fragmento({ v: 1, kind: "amigo", round: 1, from: "Ana", to: "Beto" }));
    expect($("c-premio").textContent).toBe(T.es.amigoPrize);
  });

  it("el nombre por defecto sellado en castellano se lee en inglés en la página en inglés", async () => {
    const idioma = await abrir(fragmento({ v: 1, kind: "amigo", round: 1, from: "Ana", to: "Beto", prize: "Amigo secreto" }));
    idioma.setLang("en");
    expect($("c-premio").textContent).toBe("Secret Santa");
  });

  it("el nombre por defecto sellado en inglés se lee en castellano en la página en castellano", async () => {
    await abrir(fragmento({ v: 1, kind: "amigo", round: 1, from: "Ana", to: "Beto", prize: "Secret Santa" }));
    expect($("c-premio").textContent).toBe("Amigo secreto");
  });

  it("un nombre propio no se traduce", async () => {
    const idioma = await abrir(fragmento({ v: 1, kind: "amigo", round: 1, from: "Ana", to: "Beto", prize: "Amigo secreto: Navidad" }));
    idioma.setLang("en");
    expect($("c-premio").textContent).toBe("Amigo secreto: Navidad");
  });

  it("con un enlace roto, el regalo no aparece y el aviso sí", async () => {
    await abrir("#rx");
    expect($("c-error").hidden).toBe(false);
    expect($("c-ok").hidden).toBe(true);
    expect($("c-hacia").textContent).toBe("");
  });

  it("un nombre con $ sale tal cual: no se lee como un patrón del reemplazo", async () => {
    await abrir(fragmento({ v: 1, kind: "amigo", round: 1, from: "Mica $$ $& $'", to: "Beto" }));
    expect($("c-para").textContent).toBe("Mica $$ $& $', te toca regalarle a");
  });

  it("los nombres se escriben como texto, no como HTML", async () => {
    await abrir(fragmento({ v: 1, kind: "amigo", round: 1, from: "<b>Ana</b>", to: "<img src=x>" }));
    expect($("c-hacia").textContent).toBe("<img src=x>");
    expect($("c-hacia").querySelector("img")).toBeNull();
  });
});
