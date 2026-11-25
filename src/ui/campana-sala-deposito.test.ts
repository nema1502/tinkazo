// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * La línea del premio en la vista previa del panel de quien organiza: dice si el premio está en su cuenta o cuánto falta, solo
 * en la red principal y con la cuenta entrada, sin sumar ninguna acción y sin afirmar nada con una lectura fallida. El mundo
 * es el de siempre y la lectura del saldo, de mentira.
 */

const h = vi.hoisted(() => ({ red: null as "testnet" | "mainnet" | null, rompeElTotal: false }));
// El modo de la pestaña, que cada prueba pone a mano.
vi.mock("../stellar/config", async (orig) => {
  const real = await orig<typeof import("../stellar/config")>();
  return { ...real, network: new Proxy(real.network, { get: (t, k) => (k === "name" && h.red ? h.red : Reflect.get(t, k)) }) };
});
// El cálculo del total de premios, que una prueba hace lanzar como lanzaría con un premio negativo.
vi.mock("../campana/comision", async (orig) => {
  const real = await orig<typeof import("../campana/comision")>();
  return {
    ...real,
    totalDePremios: (premios: readonly bigint[]) => {
      if (h.rompeElTotal) throw new Error("comision: premio negativo");
      return real.totalDePremios(premios);
    },
  };
});
vi.mock("./qr", () => ({ pintarQr: async () => true, precargarQr: async () => undefined }));

import { CENTAVO } from "../campana/comision";
import type { LecturaDeComision } from "../campana/comision-red";
import { cuentaDePrueba } from "../campana/cuentas-de-prueba";
import { TEXTOS_SALA_CAMPANA } from "../campana/textos-sala";
import type { ConfigDeComision } from "../stellar/comision-config";
import type { SaldoDeDolares } from "../stellar/saldo-dolares";
import type { DepsDeComision } from "./campana-comision";
import {
  $,
  type Mundo,
  type Panel,
  archivoDe,
  boton,
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
  h.rompeElTotal = false;
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

/** El cobro de Tinkazo, de mentira: con él prendido, el premio que hay que cargar lleva la comisión encima. */
const CONFIG: ConfigDeComision = {
  pb: 200n,
  minimo: 150n * CENTAVO,
  cuenta: cuentaDePrueba(2),
  costo: 50n * CENTAVO,
  cobros: cuentaDePrueba(1),
};
function conCobro(m: Mundo, o: { red: LecturaDeComision; saldo: bigint }): void {
  const deps: DepsDeComision = {
    comision: () => CONFIG,
    billetera: async () => "google",
    mirarRed: async () => o.red,
    saldo: async () => o.saldo,
    portero: async () => "atiende",
    pagar: async () => ({ tipo: "listo", hash: "a".repeat(64) }),
    confirmar: async () => null,
    puedeVolverALista: async () => true,
    cargar: () => undefined,
    candado: (_nombre, f) => f(),
  };
  m.deps.comision = deps;
}

describe("la línea del premio con el cobro de Tinkazo prendido", () => {
  it("sin pagar el servicio no dice nada ni lee el saldo: el cobro pide cargar el premio más la comisión", async () => {
    // Con el saldo justo para el premio de 40 pero sin la comisión, el cobro todavía pide cargar: la línea no puede decir que alcanza.
    const { m, leer } = armar({ tipo: "saldo", saldo: "40.0000000" });
    conCobro(m, { red: { tipo: "no-pagada", suma: 0n }, saldo: 40n * 100n * CENTAVO });
    const p = await previa(m);
    expect(linea(p)).toBe("");
    expect(leer).not.toHaveBeenCalled();
  });

  it("pagado el servicio, el saldo que queda se compara con el premio solo", async () => {
    const { m, leer } = armar({ tipo: "saldo", saldo: "40.0000000" });
    conCobro(m, { red: { tipo: "pagada", suma: 2n * 100n * CENTAVO }, saldo: 40n * 100n * CENTAVO });
    const p = await previa(m);
    await suelta(8);
    expect(leer).toHaveBeenCalled();
    expect(linea(p)).toBe(dice("es", "cpoDepAlcanza", { premios: PREMIO }));
  });
});

describe("las lecturas que se cruzan o fallan", () => {
  it("una lectura que falla después de una buena borra la línea vieja en vez de dejarla pintada", async () => {
    let saldo: SaldoDeDolares | "falla" = { tipo: "saldo", saldo: "125.0000000" };
    const { m, leer } = armar(saldo);
    leer.mockImplementation(async () => {
      if (saldo === "falla") throw new Error("sin conexión");
      return saldo;
    });
    const p = await previa(m);
    expect(linea(p)).toBe(dice("es", "cpoDepAlcanza", { premios: PREMIO }));
    saldo = "falla";
    await m.correr(6_000);
    document.dispatchEvent(new Event("visibilitychange"));
    await suelta(6);
    expect(leer).toHaveBeenCalledTimes(2);
    expect(linea(p)).toBe("");
  });

  it("la lectura de antes que llega después de la de ahora no la pisa", async () => {
    const pendientes: Array<(l: SaldoDeDolares) => void> = [];
    const { m, leer } = armar({ tipo: "saldo", saldo: "0" });
    leer.mockImplementation(() => new Promise<SaldoDeDolares>((resolver) => void pendientes.push(resolver)));
    const p = await previa(m);
    expect(pendientes).toHaveLength(1);
    // Vuelve a la pestaña pasados los 5 segundos: segunda lectura mientras la primera sigue en el aire.
    await m.correr(6_000);
    document.dispatchEvent(new Event("visibilitychange"));
    await suelta(4);
    expect(pendientes).toHaveLength(2);
    pendientes[1]?.({ tipo: "saldo", saldo: "125.0000000" });
    await suelta(6);
    expect(linea(p)).toBe(dice("es", "cpoDepAlcanza", { premios: PREMIO }));
    // La primera, que decía que faltaba todo, llega tarde: no cambia lo que se ve.
    pendientes[0]?.({ tipo: "sin-linea" });
    await suelta(6);
    expect(linea(p)).toBe(dice("es", "cpoDepAlcanza", { premios: PREMIO }));
  });

  it("una lectura que llega cuando el panel ya dejó la campaña no pinta nada", async () => {
    const pendientes: Array<(l: SaldoDeDolares) => void> = [];
    const { m, leer } = armar({ tipo: "saldo", saldo: "0" });
    leer.mockImplementation(() => new Promise<SaldoDeDolares>((resolver) => void pendientes.push(resolver)));
    const p = await previa(m);
    // La cuenta cambia: se pide otra lectura para la cuenta nueva y la de la cuenta anterior llega al final.
    m.cuenta = cuentaDePrueba(6);
    p.pintar();
    await suelta(4);
    expect(leer).toHaveBeenCalledTimes(2);
    expect(leer).toHaveBeenLastCalledWith(cuentaDePrueba(6));
    pendientes[1]?.({ tipo: "saldo", saldo: "25.0000000" });
    await suelta(6);
    expect(linea(p)).toBe(dice("es", "cpoDepFalta", { falta: "15,00" }));
    pendientes[0]?.({ tipo: "saldo", saldo: "999.0000000" });
    await suelta(6);
    expect(linea(p)).toBe(dice("es", "cpoDepFalta", { falta: "15,00" }));
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

describe("ninguna excepción de la línea tumba el panel", () => {
  it("si el cálculo del total lanza, no hay línea y el panel se dibuja igual", async () => {
    const { m, leer } = armar({ tipo: "saldo", saldo: "125.0000000" });
    h.rompeElTotal = true;
    const p = await previa(m);
    expect(vistaDe(p)).toBe("previa");
    expect(linea(p)).toBe("");
    expect(leer).not.toHaveBeenCalled();
    expect($(p, ".cpo-premio").textContent).not.toBe("");
    expect(principales(p)).toHaveLength(1);
    // Repintar con el cálculo roto tampoco lanza ni lee nada.
    expect(() => p.pintar()).not.toThrow();
    expect(leer).not.toHaveBeenCalled();
  });

  it("cuando el cálculo vuelve a andar, la línea vuelve", async () => {
    const { m } = armar({ tipo: "saldo", saldo: "125.0000000" });
    h.rompeElTotal = true;
    const p = await previa(m);
    h.rompeElTotal = false;
    p.pintar();
    await suelta(6);
    expect(linea(p)).toBe(dice("es", "cpoDepAlcanza", { premios: PREMIO }));
  });

  it("si al volver a la pestaña el cálculo lanza, el evento no lanza y la línea se apaga", async () => {
    const { m } = armar({ tipo: "saldo", saldo: "125.0000000" });
    const p = await previa(m);
    expect(linea(p)).toBe(dice("es", "cpoDepAlcanza", { premios: PREMIO }));
    h.rompeElTotal = true;
    await m.correr(6_000);
    expect(() => document.dispatchEvent(new Event("visibilitychange"))).not.toThrow();
    p.pintar();
    expect(linea(p)).toBe("");
  });
});

describe("la línea no queda vieja", () => {
  it("pasado un minuto vuelve a leer, y mientras lee no afirma nada", async () => {
    const pendientes: Array<(l: SaldoDeDolares) => void> = [];
    const { m, leer } = armar({ tipo: "saldo", saldo: "125.0000000" });
    leer.mockImplementationOnce(async () => ({ tipo: "saldo", saldo: "125.0000000" }));
    leer.mockImplementation(() => new Promise<SaldoDeDolares>((resolver) => void pendientes.push(resolver)));
    const p = await previa(m);
    expect(linea(p)).toBe(dice("es", "cpoDepAlcanza", { premios: PREMIO }));
    await m.correr(59_000);
    expect(leer).toHaveBeenCalledTimes(1);
    expect(linea(p)).toBe(dice("es", "cpoDepAlcanza", { premios: PREMIO }));
    await m.correr(2_000);
    expect(leer).toHaveBeenCalledTimes(2);
    expect(linea(p)).toBe("");
    pendientes[0]?.({ tipo: "saldo", saldo: "25.0000000" });
    await suelta(6);
    expect(linea(p)).toBe(dice("es", "cpoDepFalta", { falta: "15,00" }));
  });

  it("si la relectura falla, la línea de antes no sigue afirmando", async () => {
    const { m, leer } = armar({ tipo: "saldo", saldo: "125.0000000" });
    leer.mockImplementationOnce(async () => ({ tipo: "saldo", saldo: "125.0000000" }));
    leer.mockImplementation(async () => {
      throw new Error("sin conexión");
    });
    const p = await previa(m);
    expect(linea(p)).toBe(dice("es", "cpoDepAlcanza", { premios: PREMIO }));
    await m.correr(61_000);
    expect(linea(p)).toBe("");
  });

  it("con el panel a la vista lee como mucho una vez por minuto", async () => {
    const { m, leer } = armar({ tipo: "saldo", saldo: "125.0000000" });
    await previa(m);
    await m.correr(180_000);
    expect(leer.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(leer.mock.calls.length).toBeLessThanOrEqual(4);
  });

  it("con la pestaña escondida no lee, y la línea vieja se apaga", async () => {
    const { m, leer } = armar({ tipo: "saldo", saldo: "125.0000000" });
    const p = await previa(m);
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    await m.correr(300_000);
    p.pintar();
    await suelta(4);
    expect(leer).toHaveBeenCalledTimes(1);
    expect(linea(p)).toBe("");
    // Al volver se lee de nuevo y la línea reaparece.
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    await suelta(6);
    expect(leer).toHaveBeenCalledTimes(2);
    expect(linea(p)).toBe(dice("es", "cpoDepAlcanza", { premios: PREMIO }));
  });

  it("al tocar Abrir la inscripción vuelve a leer, y si queda en la vista previa la línea es la de la lectura nueva", async () => {
    let saldo = "25.0000000";
    const { m, leer } = armar({ tipo: "saldo", saldo });
    leer.mockImplementation(async () => ({ tipo: "saldo", saldo }));
    const p = await previa(m);
    expect(linea(p)).toBe(dice("es", "cpoDepFalta", { falta: "15,00" }));
    saldo = "125.0000000";
    m.respuestasAlCrear.push("red");
    // Sin esperar los 5 segundos de la vuelta a la pestaña: el toque siempre mira.
    boton(p, "Abrir la inscripción").click();
    await suelta(8);
    expect(leer).toHaveBeenCalledTimes(2);
    expect(vistaDe(p)).toBe("previa");
    expect(linea(p)).toBe(dice("es", "cpoDepAlcanza", { premios: PREMIO }));
  });

  it("mientras la lectura de antes de abrir no vuelve, no afirma nada y abrir no espera", async () => {
    const { m, leer } = armar({ tipo: "saldo", saldo: "125.0000000" });
    leer.mockImplementationOnce(async () => ({ tipo: "saldo", saldo: "125.0000000" }));
    leer.mockImplementation(() => new Promise<SaldoDeDolares>(() => undefined));
    const p = await previa(m);
    m.respuestasAlCrear.push("red");
    boton(p, "Abrir la inscripción").click();
    await suelta(8);
    expect(m.creadas).toHaveLength(1);
    expect(vistaDe(p)).toBe("previa");
    expect(linea(p)).toBe("");
  });
});

describe("la primera lectura que falla se reintenta una vez", () => {
  it("a los cinco segundos vuelve a leer y, si anda, aparece la línea", async () => {
    const { m, leer } = armar({ tipo: "saldo", saldo: "125.0000000" });
    leer.mockImplementationOnce(async () => {
      throw new Error("sin conexión");
    });
    const p = await previa(m);
    expect(linea(p)).toBe("");
    await m.correr(4_000);
    expect(leer).toHaveBeenCalledTimes(1);
    await m.correr(2_000);
    expect(leer).toHaveBeenCalledTimes(2);
    expect(linea(p)).toBe(dice("es", "cpoDepAlcanza", { premios: PREMIO }));
  });

  it("si el reintento también falla, no vuelve a probar hasta el minuto", async () => {
    const { m, leer } = armar("falla");
    const p = await previa(m);
    await m.correr(30_000);
    expect(leer).toHaveBeenCalledTimes(2);
    expect(linea(p)).toBe("");
  });

  it("una primera lectura que anda no se reintenta", async () => {
    const { m, leer } = armar({ tipo: "saldo", saldo: "125.0000000" });
    await previa(m);
    await m.correr(30_000);
    expect(leer).toHaveBeenCalledTimes(1);
  });

  it("si se deja el panel antes de los cinco segundos, no lee", async () => {
    const { m, leer } = armar("falla");
    const p = await previa(m);
    p.detener();
    await m.correr(10_000);
    expect(leer).toHaveBeenCalledTimes(1);
  });
});

describe("el lugar de la línea está reservado", () => {
  it("la línea ya está en la página, vacía, mientras la primera lectura no vuelve", async () => {
    const { m, leer } = armar({ tipo: "saldo", saldo: "125.0000000" });
    leer.mockImplementation(() => new Promise<SaldoDeDolares>(() => undefined));
    const p = await previa(m);
    const el = p.raiz.querySelector<HTMLElement>("#cpo-deposito");
    expect(el).not.toBeNull();
    expect(el?.textContent).toBe("");
    expect(el?.hidden).toBe(false);
    // Va antes del botón que se toca, así que al aparecer el texto el botón no se corre.
    const botonPrincipal = principales(p)[0];
    expect(botonPrincipal).toBeDefined();
    expect(el && botonPrincipal && el.compareDocumentPosition(botonPrincipal) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("la hoja le da un alto mínimo aunque esté vacía", () => {
    const css = readFileSync("src/campana/campana-sala.css", "utf8");
    const inicio = css.indexOf(".cpo-deposito:empty:not([hidden]) {");
    expect(inicio).toBeGreaterThan(-1);
    const regla = css.slice(inicio, css.indexOf("}", inicio));
    expect(regla).toContain("display: block");
    expect(regla).toMatch(/min-height:\s*\d/u);
  });
});
