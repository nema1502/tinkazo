// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * La franja de quien sigue sin cuenta (plan B del ingreso) no es una región viva: la página la vuelve a pintar con cada
 * cambio de la cuenta o del idioma, y un lector de pantalla la leería de nuevo cada vez. Se anuncia una sola vez, al
 * elegir, por la región viva de la cuenta.
 */

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
  vi.stubEnv("VITE_INGRESO_PLAN_B", "1");
  sessionStorage.clear();
  document.body.innerHTML = '<header></header><span id="cuenta-aviso" role="status" aria-live="polite"></span>';
});

afterEach(() => vi.unstubAllEnvs());

async function cargar(): Promise<{ franja: typeof import("./sin-cuenta-franja"); eleccion: typeof import("./sin-cuenta") }> {
  const franja = await import("./sin-cuenta-franja");
  const eleccion = await import("./sin-cuenta");
  return { franja, eleccion };
}

/** Cuántas veces cambió lo que anuncia la región viva. */
function contarCambios(): { cuantos: () => number; parar: () => void } {
  let n = 0;
  const mo = new MutationObserver((cambios) => void (n += cambios.length));
  mo.observe(document.getElementById("cuenta-aviso") as HTMLElement, { childList: true, characterData: true, subtree: true, attributes: true });
  return {
    cuantos: () => {
      n += mo.takeRecords().length;
      return n;
    },
    parar: () => mo.disconnect(),
  };
}

describe("la franja no es una región viva", () => {
  it("no lleva role ni aria-live, ni ella ni lo que tiene adentro", async () => {
    const { franja, eleccion } = await cargar();
    eleccion.elegirSinCuenta();
    franja.pintarFranja(() => undefined);
    const f = document.getElementById(franja.ID_FRANJA) as HTMLElement;
    expect(f).not.toBeNull();
    expect(f.getAttribute("role")).toBeNull();
    expect(f.getAttribute("aria-live")).toBeNull();
    expect(f.querySelector("[role], [aria-live]")).toBeNull();
  });

  it("volver a pintarla con lo mismo no toca nada: ni los nodos ni la región viva", async () => {
    const { franja, eleccion } = await cargar();
    eleccion.elegirSinCuenta();
    franja.pintarFranja(() => undefined);
    const f = document.getElementById(franja.ID_FRANJA) as HTMLElement;
    const hijos = [...f.children];
    const cambios = contarCambios();
    for (let i = 0; i < 5; i++) franja.pintarFranja(() => undefined);
    // Los mismos nodos, no otros iguales: toEqual compara contenido, y acá importa que no se haya vuelto a armar.
    expect(f.children.length).toBe(hijos.length);
    expect(hijos.every((hijo, i) => hijo === f.children[i])).toBe(true);
    expect(cambios.cuantos()).toBe(0);
    cambios.parar();
  });

  it("al cambiar de idioma se vuelve a armar, sin anunciar nada", async () => {
    const { franja, eleccion } = await cargar();
    const { setLang, T } = await import("../i18n");
    setLang("es");
    eleccion.elegirSinCuenta();
    franja.pintarFranja(() => undefined);
    const cambios = contarCambios();
    setLang("en");
    franja.pintarFranja(() => undefined);
    expect(document.getElementById(franja.ID_FRANJA)?.textContent).toContain(String(T.en.sinCuentaLinea));
    setLang("es");
    franja.pintarFranja(() => undefined);
    expect(document.getElementById(franja.ID_FRANJA)?.textContent).toContain(String(T.es.sinCuentaLinea));
    expect(cambios.cuantos()).toBe(0);
    cambios.parar();
  });
});

describe("se anuncia una sola vez, al elegir", () => {
  it("anunciarFranja escribe la línea en la región viva de la cuenta, y los repintados no la repiten", async () => {
    const { franja, eleccion } = await cargar();
    const { setLang, T } = await import("../i18n");
    setLang("es");
    const cambios = contarCambios();
    eleccion.elegirSinCuenta();
    franja.anunciarFranja();
    expect(document.getElementById("cuenta-aviso")?.textContent).toBe(String(T.es.sinCuentaLinea));
    expect(cambios.cuantos()).toBe(1);
    for (let i = 0; i < 5; i++) franja.pintarFranja(() => undefined);
    expect(cambios.cuantos()).toBe(1);
    cambios.parar();
  });

  it("sin la región viva en la página, no falla", async () => {
    const { franja } = await cargar();
    document.getElementById("cuenta-aviso")?.remove();
    expect(() => franja.anunciarFranja()).not.toThrow();
  });
});
