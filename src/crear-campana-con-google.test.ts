// @vitest-environment jsdom
/**
 * crear-campana.html y las campañas con Google: con los dos interruptores del sitio en 1 el armador recibe el pedido de modo
 * (personas con dólares por defecto, premio en mano con `?identidad=persona` y cuentas con `?identidad=cuenta`) y lo que cuesta
 * mandar un premio. Con el interruptor nuevo solo, o sin ninguno, las dependencias son las de siempre, sin esas dos claves.
 */

import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DepsDelCreador } from "./campana/crear/panel";
import { cuentaDePrueba } from "./campana/cuentas-de-prueba";

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

/** Los dos interruptores del sitio en 1. */
function conLosDos(): void {
  vi.stubEnv("VITE_ANOTARSE_SIN_BILLETERA", "1");
  vi.stubEnv("VITE_CAMPANAS_CON_GOOGLE", "1");
}

/** El cobro de producción: 2 % con un mínimo de 1,50, y el retiro en 0,50. */
function conCobro(costoDelRetiro = "0.50"): void {
  vi.stubEnv("VITE_COMISION_PB", "200");
  vi.stubEnv("VITE_COMISION_MINIMO", "1.50");
  vi.stubEnv("VITE_COMISION_CUENTA", cuentaDePrueba(2));
  vi.stubEnv("VITE_RETIRO_COSTO", costoDelRetiro);
  vi.stubEnv("VITE_RETIRO_CUENTA", cuentaDePrueba(1));
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

describe("crear-campana.html con los dos interruptores prendidos", () => {
  it("sin nada en la dirección pide personas con dólares y pasa lo que cuesta un envío", async () => {
    conLosDos();
    conCobro();
    const deps = await depsAl("");
    expect(deps.modo).toEqual({ nueva: "personas-dolares", archivoConDolares: true });
    expect(deps.envio).toBe(0.5);
    expect("identidad" in deps).toBe(false);
    expect(deps.activar).toBeTypeOf("function");
    expect(deps.comision?.({ monto: 40, ganan: 3 })).toEqual({ dolares: 2.4 });
  });

  it("el envío es el costo del retiro del sitio, en dólares", async () => {
    conLosDos();
    conCobro("0.35");
    expect((await depsAl("")).envio).toBe(0.35);
  });

  it("con identidad=persona el modo es premio en mano, y la identidad sigue llegando como siempre", async () => {
    conLosDos();
    conCobro();
    const deps = await depsAl("?identidad=persona");
    expect(deps.modo).toEqual({ nueva: "personas-en-mano", archivoConDolares: true });
    expect(deps.identidad).toBe("persona");
  });

  it("con identidad=cuenta el modo es cuentas", async () => {
    conLosDos();
    conCobro();
    const deps = await depsAl("?identidad=cuenta");
    expect(deps.modo).toEqual({ nueva: "cuentas", archivoConDolares: true });
    expect("identidad" in deps).toBe(false);
  });

  it("un valor que no es persona ni cuenta no cambia nada: personas con dólares", async () => {
    conLosDos();
    for (const valor of ["Persona", "Cuenta", "", "persona%20", "otra"]) {
      vi.resetModules();
      const deps = await depsAl(`?identidad=${valor}`);
      expect(deps.modo, valor).toEqual({ nueva: "personas-dolares", archivoConDolares: true });
      expect("identidad" in deps, valor).toBe(false);
    }
  });

  it("sin el cobro configurado el envío va en null, el modo llega igual y no se ofrece activar", async () => {
    conLosDos();
    const deps = await depsAl("");
    expect(deps.modo).toEqual({ nueva: "personas-dolares", archivoConDolares: true });
    expect("envio" in deps).toBe(true);
    expect(deps.envio).toBeNull();
    expect(deps.activar).toBeUndefined();
  });

  it("la demostración recibe el mismo pedido: el panel la arma siempre de cuentas", async () => {
    conLosDos();
    conCobro();
    const deps = await depsAl("?demo=1");
    expect(deps.demo).toBe(true);
    expect(deps.modo).toEqual({ nueva: "personas-dolares", archivoConDolares: true });
  });
});

describe("crear-campana.html sin los dos interruptores", () => {
  it("con el interruptor nuevo solo, las claves del modo y del envío faltan", async () => {
    vi.stubEnv("VITE_CAMPANAS_CON_GOOGLE", "1");
    conCobro();
    for (const direccion of ["", "?identidad=persona", "?identidad=cuenta"]) {
      vi.resetModules();
      const deps = await depsAl(direccion);
      expect("modo" in deps, direccion).toBe(false);
      expect("envio" in deps, direccion).toBe(false);
      expect("identidad" in deps, direccion).toBe(false);
    }
  });

  it("con anotarse sin billetera solo, también faltan, y la identidad llega como hoy", async () => {
    vi.stubEnv("VITE_ANOTARSE_SIN_BILLETERA", "1");
    conCobro();
    const sinNada = await depsAl("");
    expect("modo" in sinNada).toBe(false);
    expect("envio" in sinNada).toBe(false);
    expect("identidad" in sinNada).toBe(false);
    vi.resetModules();
    const conPersona = await depsAl("?identidad=persona");
    expect("modo" in conPersona).toBe(false);
    expect("envio" in conPersona).toBe(false);
    expect(conPersona.identidad).toBe("persona");
  });

  it("sin ninguno de los dos faltan", async () => {
    conCobro();
    const deps = await depsAl("?identidad=persona");
    expect("modo" in deps).toBe(false);
    expect("envio" in deps).toBe(false);
    expect("identidad" in deps).toBe(false);
  });

  it("con el interruptor nuevo en otro valor que 1 también faltan", async () => {
    vi.stubEnv("VITE_ANOTARSE_SIN_BILLETERA", "1");
    for (const valor of ["true", "0", " 1", ""]) {
      vi.resetModules();
      vi.stubEnv("VITE_CAMPANAS_CON_GOOGLE", valor);
      const deps = await depsAl("");
      expect("modo" in deps, valor).toBe(false);
      expect("envio" in deps, valor).toBe(false);
    }
  });
});
