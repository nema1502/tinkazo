import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CLAVE_GRANDE, PARAMS_DE_PRUEBA, decidirPantalla, grandeAlSellar, grandeRechazada, type EstadoDeLaPantalla } from "./vista-grande";

/**
 * Al sellar, todo en grande (26 de octubre de 2026): cuándo se pide la pantalla
 * completa y se abre sola la vista grande, y qué hace el navegador con el pedido.
 */

const normal = { busqueda: "" };

describe("al sellar se pone todo en grande", () => {
  it("con un enlace de siempre, sí, en cualquier tamaño: ya no depende del ancho ni de si hay dedo", () => {
    expect(grandeAlSellar(normal)).toBe(true);
    expect(grandeAlSellar({ busqueda: "?lang=en&theme=dark" })).toBe(true);
    expect(grandeAlSellar({ busqueda: "", guardado: null })).toBe(true);
  });

  it("los enlaces de prueba y de ensayo la llevan a mano", () => {
    for (const p of PARAMS_DE_PRUEBA) expect(grandeAlSellar({ busqueda: `?${p}=1` })).toBe(false);
    for (const p of ["demo=race", "instant=1", "lead=3", "pace=rapido", "pose=wheel"]) expect(grandeAlSellar({ busqueda: `?${p}` })).toBe(false);
  });

  it("?grande=0 y lo guardado la apagan; ?grande=1 la fuerza con cualquier enlace", () => {
    expect(grandeAlSellar({ busqueda: "?grande=0" })).toBe(false);
    expect(grandeAlSellar({ busqueda: "", guardado: "0" })).toBe(false);
    expect(grandeAlSellar({ busqueda: "?lead=3&grande=1" })).toBe(true);
    expect(grandeAlSellar({ busqueda: "?demo=race&grande=1" })).toBe(true);
  });

  it("lo que la persona soltó pesa más que ?grande=1: no se vuelve a forzar en esa sesión", () => {
    expect(grandeAlSellar({ busqueda: "?grande=1", guardado: "0" })).toBe(false);
  });

  it("un valor guardado que no es el 0 no apaga nada", () => {
    expect(grandeAlSellar({ busqueda: "", guardado: "1" })).toBe(true);
    expect(grandeAlSellar({ busqueda: "", guardado: "" })).toBe(true);
  });
});

describe("la pantalla en grande rechazada", () => {
  it("solo por ?grande=0 o por lo que la persona soltó", () => {
    expect(grandeRechazada(normal)).toBe(false);
    expect(grandeRechazada({ busqueda: "?lead=3" })).toBe(false);
    expect(grandeRechazada({ busqueda: "?grande=0" })).toBe(true);
    expect(grandeRechazada({ busqueda: "", guardado: "0" })).toBe(true);
  });
});

describe("qué se hace con la pantalla completa", () => {
  const base: EstadoDeLaPantalla = { hayApi: true, yaEnPantalla: false, gesto: true, rechazada: false };

  it("con la API, un gesto y sin rechazo, se pide", () => {
    expect(decidirPantalla(base)).toBe("pedida");
  });

  it("si ya está en pantalla completa, no se pide otra vez", () => {
    expect(decidirPantalla({ ...base, yaEnPantalla: true })).toBe("ya-esta");
    expect(decidirPantalla({ ...base, yaEnPantalla: true, rechazada: true })).toBe("ya-esta");
  });

  it("si la persona la soltó, no se vuelve a forzar", () => {
    expect(decidirPantalla({ ...base, rechazada: true })).toBe("rechazada");
  });

  it("sin la API (el iPhone), no hay nada que pedir: la vista grande es la de la página", () => {
    expect(decidirPantalla({ ...base, hayApi: false })).toBe("sin-api");
  });

  it("sin un gesto a mano, el navegador la negaría: no se pide", () => {
    expect(decidirPantalla({ ...base, gesto: false })).toBe("sin-gesto");
  });

  it("el rechazo gana sobre la falta de la API y del gesto", () => {
    expect(decidirPantalla({ ...base, hayApi: false, gesto: false, rechazada: true })).toBe("rechazada");
  });
});

/** Una pestaña con su `sessionStorage`; `roto` lo hace tirar, como una ventana privada con todo bloqueado. */
function pestana(roto = false): Map<string, string> {
  const datos = new Map<string, string>();
  vi.stubGlobal("location", { search: "" });
  vi.stubGlobal("sessionStorage", {
    getItem: (k: string) => {
      if (roto) throw new Error("SecurityError");
      return datos.get(k) ?? null;
    },
    setItem: (k: string, v: string) => {
      if (roto) throw new Error("SecurityError");
      datos.set(k, v);
    },
    removeItem: (k: string) => {
      if (roto) throw new Error("SecurityError");
      datos.delete(k);
    },
  });
  return datos;
}

async function modulo() {
  vi.resetModules();
  return import("./vista-grande");
}

describe("lo que la persona soltó se recuerda en la pestaña", () => {
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => vi.unstubAllGlobals());

  it("empieza sin nada y, al soltar, el 0 queda en esta sesión", async () => {
    const datos = pestana();
    const m = await modulo();
    expect(m.leerGuardado()).toBeNull();
    expect(m.entornoDeAhora().guardado).toBeNull();
    m.rechazarGrande();
    expect(datos.get(CLAVE_GRANDE)).toBe("0");
    expect(m.leerGuardado()).toBe("0");
    expect(m.grandeAlSellar(m.entornoDeAhora())).toBe(false);
  });

  it("pedirla a mano la vuelve a permitir", async () => {
    const datos = pestana();
    const m = await modulo();
    m.rechazarGrande();
    m.permitirGrande();
    expect(datos.has(CLAVE_GRANDE)).toBe(false);
    expect(m.leerGuardado()).toBeNull();
    expect(m.grandeAlSellar(m.entornoDeAhora())).toBe(true);
  });

  it("otra pestaña no hereda el no: es de la sesión", async () => {
    pestana().set(CLAVE_GRANDE, "0");
    const otra = pestana();
    const m = await modulo();
    expect(otra.size).toBe(0);
    expect(m.grandeAlSellar(m.entornoDeAhora())).toBe(true);
  });

  it("con el almacenamiento bloqueado, el no vale igual hasta que se recargue", async () => {
    pestana(true);
    const m = await modulo();
    expect(m.leerGuardado()).toBeNull();
    m.rechazarGrande();
    expect(m.leerGuardado()).toBe("0");
    expect(m.grandeAlSellar(m.entornoDeAhora())).toBe(false);
    m.permitirGrande();
    expect(m.leerGuardado()).toBeNull();
  });
});
