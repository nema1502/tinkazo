// @vitest-environment jsdom
/** La entrada de crear-campana.html: la bandera de las campañas, la demostración y el primer paso. */

import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TEXTOS_CAMPANA } from "./campana/textos";
import { TEXTOS_CREAR_CAMPANA } from "./campana/textos-crear";

const h = vi.hoisted(() => ({ activa: true, lang: "es" as "es" | "en", cambiarIdioma: null as null | (() => void) }));

vi.mock("./pagina", () => ({}));
vi.mock("./version-nueva", () => ({}));
vi.mock("./campana/campana.css", () => ({}));
vi.mock("./campana/crear.css", () => ({}));
vi.mock("./campana/bandera", () => ({ campanasActivo: () => h.activa }));
vi.mock("./idioma", () => {
  const palabra = (l: "es" | "en", k: string): string => TEXTOS_CREAR_CAMPANA[l][k] ?? TEXTOS_CAMPANA[l][k] ?? (k === "navMas" ? "Más" : k);
  return {
    getLang: () => h.lang,
    initialLang: () => h.lang,
    onLangChange: (fn: () => void) => {
      h.cambiarIdioma = fn;
    },
    setLang: (l: "es" | "en") => {
      h.lang = l;
    },
    texto: (k: string) => palabra(h.lang, k),
    textos: (l: "es" | "en") => new Proxy({}, { get: (_o, k) => palabra(l, String(k)) }),
  };
});

const html = readFileSync("crear-campana.html", "utf8");
const cuerpo = /<body[^>]*>([\s\S]*)<script/u.exec(html)?.[1] ?? "";

async function abrir(direccion = ""): Promise<void> {
  window.history.replaceState(null, "", `/crear-campana.html${direccion}`);
  await import("./crear-campana");
}

beforeEach(() => {
  vi.resetModules();
  document.body.innerHTML = cuerpo;
  h.activa = true;
  h.lang = "es";
  h.cambiarIdioma = null;
  localStorage.clear();
});

afterEach(() => {
  document.body.innerHTML = "";
  window.history.replaceState(null, "", "/");
});

describe("crear-campana.html", () => {
  it("sin la bandera y sin demo dice que las campañas todavía no están abiertas", async () => {
    h.activa = false;
    await abrir();
    expect(document.querySelector("#ccp-aviso")?.textContent).toBe("Las campañas de empresas todavía no están abiertas.");
    expect(document.querySelector("#ccp-titulo")).toBeNull();
    h.lang = "en";
    h.cambiarIdioma?.();
    expect(document.querySelector("#ccp-aviso")?.textContent).toBe("Company campaigns aren't open yet.");
  });

  it("sin la bandera y con demo=1 abre con la marca de muestra y la etiqueta Demo", async () => {
    h.activa = false;
    await abrir("?demo=1");
    expect(document.querySelector<HTMLElement>("#cmp-ejemplo")?.hidden).toBe(false);
    expect(document.querySelector<HTMLInputElement>("#ccp-nombre")?.value).toBe("Alcancía Andina");
    expect(localStorage.length).toBe(0);
  });

  it("con la bandera abre el paso 1", async () => {
    await abrir();
    expect(document.querySelector("#ccp-titulo")?.textContent).toBe("Tu marca");
    expect(document.querySelector<HTMLElement>("#cmp-ejemplo")?.hidden).toBe(true);
    expect(document.querySelector<HTMLIFrameElement>("#ccp-vista")?.getAttribute("src")).toBe("/participar.html?vista=previa&lang=es");
  });

  it("el tema de la dirección se repite en la vista", async () => {
    await abrir("?theme=dark");
    expect(document.querySelector<HTMLIFrameElement>("#ccp-vista")?.getAttribute("src")).toBe("/participar.html?vista=previa&lang=es&theme=dark");
  });

  it("un tema que no es uno de los dos no se pasa a la vista", async () => {
    await abrir("?theme=dark%26demo%3Dcampana");
    expect(document.querySelector<HTMLIFrameElement>("#ccp-vista")?.getAttribute("src")).toBe("/participar.html?vista=previa&lang=es");
    expect(document.querySelector<HTMLIFrameElement>("#ccp-vista")?.getAttribute("src")).not.toContain("demo");
  });

  it("con las campañas cerradas el aviso es el título de nivel 1 de la página", async () => {
    h.activa = false;
    await abrir();
    expect(document.querySelector("main h1")?.textContent).toBe("Las campañas de empresas todavía no están abiertas.");
  });

  it("al cambiar el idioma se dibuja de nuevo", async () => {
    await abrir();
    h.lang = "en";
    h.cambiarIdioma?.();
    expect(document.querySelector("#ccp-titulo")?.textContent).toBe("Your brand");
  });
});

describe("el marcado de crear-campana.html", () => {
  it("no se indexa y lleva la etiqueta Demo con su ayuda en español", () => {
    expect(html).toMatch(/<meta name="robots" content="noindex"/u);
    expect(html).toContain('title="Es una demostración: no se guarda nada."');
    expect(html).toContain('data-i-title="ccEjemploAyuda"');
  });

  it("el logo de la cabecera lleva a la portada", () => {
    expect(html).toContain('<a class="wordmark" href="/"');
  });

  it("la entrada es src/crear-campana.ts y el cuerpo lleva las clases de la página", () => {
    expect(html).toContain('<script type="module" src="/src/crear-campana.ts"></script>');
    expect(html).toMatch(/<body class="pg-campana pg-crear">/u);
  });
});
