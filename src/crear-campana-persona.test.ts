// @vitest-environment jsdom
/**
 * crear-campana.html y las campañas de personas: el armador pone `"identidad": "persona"` solo con el interruptor del sitio y
 * `?identidad=persona` en la dirección. Con cualquier otra cosa arma la campaña de siempre, sin el campo.
 */

import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DepsDelCreador } from "./campana/crear/panel";

const h = vi.hoisted(() => ({ deps: null as unknown }));

vi.mock("./pagina", () => ({}));
vi.mock("./version-nueva", () => ({}));
vi.mock("./campana/campana.css", () => ({}));
vi.mock("./campana/crear.css", () => ({}));
vi.mock("./campana/bandera", () => ({ campanasActivo: () => true }));
vi.mock("./campana/crear/panel", async (importarOriginal) => ({
  ...(await importarOriginal<typeof import("./campana/crear/panel")>()),
  montarCreador: (_raiz: HTMLElement, deps: unknown) => {
    h.deps = deps;
    return { pintar: () => undefined };
  },
}));

const html = readFileSync("crear-campana.html", "utf8");
const cuerpo = /<body[^>]*>([\s\S]*)<script/u.exec(html)?.[1] ?? "";

async function depsAl(direccion: string): Promise<DepsDelCreador> {
  window.history.replaceState(null, "", `/crear-campana.html${direccion}`);
  await import("./crear-campana");
  return h.deps as DepsDelCreador;
}

beforeEach(() => {
  vi.resetModules();
  document.body.innerHTML = cuerpo;
  h.deps = null;
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllEnvs();
  document.body.innerHTML = "";
  window.history.replaceState(null, "", "/");
});

describe("crear-campana.html: la identidad de las personas", () => {
  it("con el interruptor y el parámetro arma la campaña de personas", async () => {
    vi.stubEnv("VITE_ANOTARSE_SIN_BILLETERA", "1");
    expect((await depsAl("?identidad=persona")).identidad).toBe("persona");
  });

  it("con el interruptor y sin el parámetro arma la de siempre", async () => {
    vi.stubEnv("VITE_ANOTARSE_SIN_BILLETERA", "1");
    const deps = await depsAl("");
    expect(deps.identidad).toBeUndefined();
    expect("identidad" in deps).toBe(false);
  });

  it("con el parámetro y sin el interruptor arma la de siempre", async () => {
    vi.stubEnv("VITE_ANOTARSE_SIN_BILLETERA", "");
    const deps = await depsAl("?identidad=persona");
    expect("identidad" in deps).toBe(false);
  });

  it("con el interruptor en otro valor que 1 también", async () => {
    vi.stubEnv("VITE_ANOTARSE_SIN_BILLETERA", "true");
    expect("identidad" in (await depsAl("?identidad=persona"))).toBe(false);
  });

  it("un valor del parámetro que no es persona no cambia nada", async () => {
    vi.stubEnv("VITE_ANOTARSE_SIN_BILLETERA", "1");
    for (const valor of ["cuenta", "Persona", "", "persona%20"]) {
      vi.resetModules();
      expect("identidad" in (await depsAl(`?identidad=${valor}`)), valor).toBe(false);
    }
  });
});
