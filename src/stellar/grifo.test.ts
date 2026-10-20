import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hayAyudaDeFondos, hayGrifo, leerGrifo } from "./grifo";

describe("leerGrifo: qué dice la dirección", () => {
  it("?grifo=0 en testnet apaga el grifo y lo recuerda", () => {
    expect(leerGrifo("?grifo=0", false, "testnet")).toEqual({ apagado: true, accion: "guardar" });
  });

  it("?grifo=0 entre otros parámetros", () => {
    expect(leerGrifo("?theme=dark&grifo=0&lang=en", false, "testnet")).toEqual({ apagado: true, accion: "guardar" });
  });

  it("sin el parámetro y sin nada recordado, el grifo está prendido y no se toca nada", () => {
    expect(leerGrifo("", false, "testnet")).toEqual({ apagado: false, accion: "nada" });
    expect(leerGrifo("?theme=dark", false, "testnet")).toEqual({ apagado: false, accion: "nada" });
  });

  it("sin el parámetro pero con el recuerdo de esta pestaña, sigue apagado (navegar por el sitio, volver de Google)", () => {
    expect(leerGrifo("", true, "testnet")).toEqual({ apagado: true, accion: "nada" });
    expect(leerGrifo("?lang=en#sortear", true, "testnet")).toEqual({ apagado: true, accion: "nada" });
  });

  it("?grifo=1 lo vuelve a prender y olvida el recuerdo", () => {
    expect(leerGrifo("?grifo=1", true, "testnet")).toEqual({ apagado: false, accion: "olvidar" });
    expect(leerGrifo("?grifo=1", false, "testnet")).toEqual({ apagado: false, accion: "olvidar" });
  });

  it("cualquier otro valor también lo prende: solo el 0 exacto lo apaga", () => {
    for (const v of ["", "no", "off", "false", "00", " 0", "0 "]) {
      expect(leerGrifo(`?grifo=${encodeURIComponent(v)}`, true, "testnet")).toEqual({ apagado: false, accion: "olvidar" });
    }
  });

  it("en mainnet el parámetro se ignora y no se guarda nada", () => {
    expect(leerGrifo("?grifo=0", false, "mainnet")).toEqual({ apagado: false, accion: "nada" });
    // Ni siquiera con un recuerdo viejo: en mainnet nunca hay grifo que apagar.
    expect(leerGrifo("", true, "mainnet")).toEqual({ apagado: false, accion: "nada" });
    expect(leerGrifo("?grifo=1", true, "mainnet")).toEqual({ apagado: false, accion: "nada" });
  });
});

describe("hayGrifo: cuándo se puede usar", () => {
  const FB = "https://friendbot.stellar.org";

  it("testnet con grifo configurado y sin apagar", () => {
    expect(hayGrifo("testnet", FB, false)).toBe(true);
  });

  it("apagado con ?grifo=0: no hay", () => {
    expect(hayGrifo("testnet", FB, true)).toBe(false);
  });

  it("mainnet nunca, aunque alguien le pusiera una dirección", () => {
    expect(hayGrifo("mainnet", null, false)).toBe(false);
    expect(hayGrifo("mainnet", FB, false)).toBe(false);
  });

  it("sin dirección del grifo en la red, no hay", () => {
    expect(hayGrifo("testnet", null, false)).toBe(false);
  });
});

describe("hayAyudaDeFondos: la caja de fondos de último recurso para una cuenta de Pollar", () => {
  it("solo en testnet con el grifo prendido", () => {
    expect(hayAyudaDeFondos("testnet", false)).toBe(true);
    expect(hayAyudaDeFondos("testnet", true)).toBe(false);
    expect(hayAyudaDeFondos("mainnet", false)).toBe(false);
    expect(hayAyudaDeFondos("mainnet", true)).toBe(false);
  });
});

/** Un `sessionStorage` de mentira: una pestaña. */
function pestana(inicial: Record<string, string> = {}) {
  const datos = new Map(Object.entries(inicial));
  return {
    datos,
    getItem: (k: string) => datos.get(k) ?? null,
    setItem: (k: string, v: string) => void datos.set(k, v),
    removeItem: (k: string) => void datos.delete(k),
  };
}

/** Carga el módulo como si fuera una página recién abierta, con esa dirección y esa pestaña. */
async function cargar(search: string, almacen: unknown, red: "testnet" | "mainnet" = "testnet") {
  vi.resetModules();
  vi.stubGlobal("location", { search });
  vi.stubGlobal("sessionStorage", almacen);
  vi.doMock("./config", async (orig) => {
    const real = await orig<typeof import("./config")>();
    return { ...real, network: { ...real.network, name: red, friendbotUrl: red === "testnet" ? real.network.friendbotUrl : null } };
  });
  return import("./grifo");
}

describe("el módulo: se lee una sola vez y se recuerda en la pestaña", () => {
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.doUnmock("./config");
  });

  it("?grifo=0 apaga el grifo y queda anotado en la pestaña", async () => {
    const p = pestana();
    const g = await cargar("?grifo=0", p);
    expect(g.grifoApagado).toBe(true);
    expect(g.grifoDisponible()).toBe(false);
    expect(p.datos.get(g.GRIFO_KEY)).toBe("0");
  });

  it("sin el parámetro, el grifo está prendido y no se anota nada", async () => {
    const p = pestana();
    const g = await cargar("", p);
    expect(g.grifoApagado).toBe(false);
    expect(g.grifoDisponible()).toBe(true);
    expect(p.datos.size).toBe(0);
  });

  it("navegar a otra página y volver sin el parámetro (o volver de Google) no lo prende", async () => {
    const p = pestana();
    await cargar("?grifo=0", p);
    // La página siguiente se carga en la misma pestaña, sin el parámetro.
    const vuelta = await cargar("", p);
    expect(vuelta.grifoApagado).toBe(true);
    expect(vuelta.grifoDisponible()).toBe(false);
  });

  it("?grifo=1 lo vuelve a prender y lo olvida para las páginas que siguen", async () => {
    const p = pestana({ "tinkazo.grifo": "0" });
    const g = await cargar("?grifo=1", p);
    expect(g.grifoApagado).toBe(false);
    expect(p.datos.has(g.GRIFO_KEY)).toBe(false);
    const siguiente = await cargar("", p);
    expect(siguiente.grifoApagado).toBe(false);
  });

  it("una pestaña nueva arranca con el grifo prendido", async () => {
    await cargar("?grifo=0", pestana());
    const nueva = await cargar("", pestana());
    expect(nueva.grifoApagado).toBe(false);
  });

  it("si el navegador no deja usar el almacenamiento, vale lo que dice la dirección y nada se rompe", async () => {
    const roto = {
      getItem: () => {
        throw new Error("bloqueado");
      },
      setItem: () => {
        throw new Error("bloqueado");
      },
      removeItem: () => {
        throw new Error("bloqueado");
      },
    };
    expect((await cargar("?grifo=0", roto)).grifoApagado).toBe(true);
    expect((await cargar("", roto)).grifoApagado).toBe(false);
    expect((await cargar("?grifo=1", roto)).grifoApagado).toBe(false);
  });

  it("sin dirección ni almacenamiento (fuera de un navegador), el grifo está prendido", async () => {
    vi.resetModules();
    vi.stubGlobal("location", undefined);
    vi.stubGlobal("sessionStorage", undefined);
    const g = await import("./grifo");
    expect(g.grifoApagado).toBe(false);
  });

  it("en mainnet ?grifo=0 se ignora y no se anota: ahí nunca hay grifo", async () => {
    const p = pestana();
    const g = await cargar("?grifo=0", p, "mainnet");
    expect(g.grifoApagado).toBe(false);
    expect(g.grifoDisponible()).toBe(false);
    expect(p.datos.size).toBe(0);
  });
});
