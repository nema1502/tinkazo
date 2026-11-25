// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * La línea del premio en la vista previa del panel de quien organiza: dice si el premio está en su cuenta o cuánto falta, solo
 * en la red principal y con la cuenta entrada, sin sumar ninguna acción y sin afirmar nada con una lectura fallida. El mundo
 * es el de siempre y la lectura del saldo, de mentira.
 */

const h = vi.hoisted(() => ({ red: null as "testnet" | "mainnet" | null }));
// El modo de la pestaña, que cada prueba pone a mano.
vi.mock("../stellar/config", async (orig) => {
  const real = await orig<typeof import("../stellar/config")>();
  return { ...real, network: new Proxy(real.network, { get: (t, k) => (k === "name" && h.red ? h.red : Reflect.get(t, k)) }) };
});
vi.mock("./qr", () => ({ pintarQr: async () => true, precargarQr: async () => undefined }));

import { cuentaDePrueba } from "../campana/cuentas-de-prueba";
import { TEXTOS_SALA_CAMPANA } from "../campana/textos-sala";
import type { SaldoDeDolares } from "../stellar/saldo-dolares";
import {
  $,
  type Mundo,
  type Panel,
  archivoDe,
  cerrarTodos,
  elegirArchivo,
  mundo,
  nuevoPanel,
  principales,
  suelta,
  vistaDe,
} from "./campana-sala-mundo";

const CUENTA = cuentaDePrueba(5);
/** El texto de la clave en ese idioma con sus huecos llenos. */
const dice = (idioma: "es" | "en", clave: string, huecos: Record<string, string>): string =>
  Object.entries(huecos).reduce((t, [hueco, valor]) => t.replace(`{${hueco}}`, valor), TEXTOS_SALA_CAMPANA[idioma][clave] ?? "");
/** Los premios del archivo de ejemplo suman 40 dólares. */
const PREMIO = "40,00";

const ponerRed = (m: Mundo, red: "testnet" | "mainnet"): void => {
  h.red = red;
  m.red = red;
};
const linea = (p: Panel): string => p.raiz.querySelector("#cpo-deposito")?.textContent ?? "";

/** El mundo en la red principal con la cuenta entrada y una lectura del saldo que contesta lo que se diga. */
function armar(lectura: SaldoDeDolares | "falla", o: { red?: "mainnet" | "testnet"; cuenta?: string | null } = {}) {
  const m = mundo();
  ponerRed(m, o.red ?? "mainnet");
  m.cuenta = o.cuenta === undefined ? CUENTA : o.cuenta;
  const leer = vi.fn(async (_cuenta: string): Promise<SaldoDeDolares> => {
    if (lectura === "falla") throw new Error("sin conexión");
    return lectura;
  });
  m.deps.deposito = { leer };
  return { m, leer };
}

async function previa(m: Mundo): Promise<Panel> {
  const p = nuevoPanel(m);
  await suelta(4);
  await elegirArchivo(m, p, archivoDe({ red: m.red }));
  await suelta(6);
  expect(vistaDe(p)).toBe("previa");
  return p;
}

beforeEach(() => {
  Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
});

afterEach(() => {
  h.red = null;
  cerrarTodos();
  document.body.innerHTML = "";
});

describe("la línea del premio en la vista previa", () => {
  it("con el saldo que cubre el premio dice que está en la cuenta", async () => {
    const { m, leer } = armar({ tipo: "saldo", saldo: "125.0000000" });
    const p = await previa(m);
    expect(linea(p)).toBe(dice("es", "cpoDepAlcanza", { premios: PREMIO }));
    expect(leer).toHaveBeenCalledTimes(1);
    expect(leer).toHaveBeenCalledWith(CUENTA);
  });

  it("con menos saldo dice cuánto falta", async () => {
    const { m } = armar({ tipo: "saldo", saldo: "25.0000000" });
    const p = await previa(m);
    expect(linea(p)).toBe(dice("es", "cpoDepFalta", { falta: "15,00" }));
  });

  it("con una cuenta sin dólares digitales dice que falta todo el premio", async () => {
    const { m } = armar({ tipo: "sin-linea" });
    const p = await previa(m);
    expect(linea(p)).toBe(dice("es", "cpoDepFalta", { falta: PREMIO }));
  });

  it("en inglés dice lo mismo con sus palabras", async () => {
    const { m } = armar({ tipo: "saldo", saldo: "25.0000000" });
    m.idioma = "en";
    const p = await previa(m);
    expect(linea(p)).toBe(dice("en", "cpoDepFalta", { falta: "15.00" }));
  });

  it("con la lectura fallida no afirma nada: ni que está ni que falta", async () => {
    for (const lectura of ["falla", { tipo: "sin-red" }] as const) {
      const { m, leer } = armar(lectura);
      const p = await previa(m);
      expect(leer).toHaveBeenCalled();
      expect(linea(p)).toBe("");
      cerrarTodos();
      document.body.innerHTML = "";
    }
  });

  it("no suma ninguna acción: el botón principal sigue siendo uno solo", async () => {
    const sin = mundo();
    ponerRed(sin, "mainnet");
    sin.cuenta = CUENTA;
    const antes = principales(await previa(sin)).map((b) => b.textContent);
    cerrarTodos();
    document.body.innerHTML = "";
    const { m } = armar({ tipo: "saldo", saldo: "25.0000000" });
    const p = await previa(m);
    expect(principales(p).map((b) => b.textContent)).toEqual(antes);
    expect(antes).toHaveLength(1);
    expect(p.raiz.querySelector("#cpo-deposito")?.querySelector("button, a")).toBeNull();
  });

  it("sin la dependencia el panel es el de siempre: no hay línea ni se lee nada", async () => {
    const m = mundo();
    ponerRed(m, "mainnet");
    m.cuenta = CUENTA;
    const p = await previa(m);
    expect(p.raiz.querySelector("#cpo-deposito")).toBeNull();
  });

  it("en la red de prueba no lee nada", async () => {
    const { m, leer } = armar({ tipo: "saldo", saldo: "125.0000000" }, { red: "testnet" });
    const p = await previa(m);
    expect(leer).not.toHaveBeenCalled();
    expect(linea(p)).toBe("");
  });

  it("sin una cuenta entrada no lee nada", async () => {
    const { m, leer } = armar({ tipo: "saldo", saldo: "125.0000000" }, { cuenta: null });
    const p = await previa(m);
    expect(leer).not.toHaveBeenCalled();
    expect(linea(p)).toBe("");
  });

  it("pintar de nuevo no vuelve a leer la red", async () => {
    const { m, leer } = armar({ tipo: "saldo", saldo: "125.0000000" });
    const p = await previa(m);
    p.pintar();
    p.pintar();
    await suelta(4);
    expect(leer).toHaveBeenCalledTimes(1);
  });

  it("al volver a la pestaña mira de nuevo, no más de una vez cada 5 segundos", async () => {
    let saldo = "25.0000000";
    const { m, leer } = armar({ tipo: "saldo", saldo });
    leer.mockImplementation(async () => ({ tipo: "saldo", saldo }));
    const p = await previa(m);
    expect(linea(p)).toBe(dice("es", "cpoDepFalta", { falta: "15,00" }));

    document.dispatchEvent(new Event("visibilitychange"));
    await suelta(4);
    expect(leer).toHaveBeenCalledTimes(1);

    saldo = "125.0000000";
    await m.correr(6_000);
    document.dispatchEvent(new Event("visibilitychange"));
    await suelta(6);
    expect(leer).toHaveBeenCalledTimes(2);
    expect($(p, "#cpo-deposito").textContent).toBe(dice("es", "cpoDepAlcanza", { premios: PREMIO }));
  });
});

describe("los textos de la línea del premio", () => {
  it("están en los dos idiomas con los mismos huecos", () => {
    for (const idioma of ["es", "en"] as const) {
      expect(TEXTOS_SALA_CAMPANA[idioma].cpoDepAlcanza).toContain("{premios}");
      expect(TEXTOS_SALA_CAMPANA[idioma].cpoDepFalta).toContain("{falta}");
    }
  });
});
