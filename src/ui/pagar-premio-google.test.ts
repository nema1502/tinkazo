// @vitest-environment jsdom
import { Keypair } from "@stellar/stellar-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { T, setLang } from "../i18n";
import { txUrl } from "../stellar/config";
import type { LecturaDePago } from "../stellar/pagos";
import type { DatosDelPago, Preparacion } from "../stellar/pagos-envio";
import { TEXTOS_PAGOS } from "./pagos-textos";
import {
  type Billetera,
  type ContextoDePago,
  type Dependencias,
  type PagoSolo,
  type PedidoDeLaCuenta,
  type PedidoDePago,
  type Resultado,
  type ResultadoDelPremio,
  acotarMonto,
  arranqueDelContador,
  cargarEnSaldo,
  deAUnDolarSolo,
  formatoDeMonto,
  limitesDelContador,
  mensajeDe,
  montoEnTexto,
  montoFijoDelPremio,
  pagarPremioEn,
  pagarUnPremio,
} from "./pagar-premio";

const { abrirSaldo } = vi.hoisted(() => ({ abrirSaldo: vi.fn() }));
vi.mock("./saldo", () => ({ abrirSaldo }));

/**
 * Pagar premio con una cuenta que paga sola: el monto fijo o el contador, el saldo y qué pasa si no alcanza. Todo con la
 * cuenta, la red y la billetera de mentira: nada sale de la prueba y nada se firma.
 */

const cuentaNueva = (): string => Keypair.random().publicKey();
const [ORG, GANA, OTRA, PAGA] = [cuentaNueva(), cuentaNueva(), cuentaNueva(), cuentaNueva()];
const ACTIVO = { code: "USDC", issuer: Keypair.random().publicKey() };
const HASH = "ab".repeat(32);
const XDR = "AAAAAgAAAAArmado";
const DESDE = 1_800_000_000;
const NOTA = "tk:premio:777:2";
const dolares = (n: number): bigint => BigInt(Math.round(n * 10_000_000));

const PEDIDO: PedidoDePago = { red: "mainnet", raffleId: "777", puesto: 2, destino: GANA, activo: ACTIVO, monto: "50", desde: DESDE };
const PAGADO: LecturaDePago = { tipo: "pagado", hash: HASH, monto: "50.0000000", cuando: DESDE + 60, de: ORG };

interface Armado {
  deps: Dependencias;
  buscar: ReturnType<typeof vi.fn>;
  preparar: ReturnType<typeof vi.fn>;
  mandar: ReturnType<typeof vi.fn>;
  firmar: ReturnType<typeof vi.fn>;
  pagar: ReturnType<typeof vi.fn>;
  saldo: ReturnType<typeof vi.fn>;
  cargar: ReturnType<typeof vi.fn>;
  pasos: string[];
}

interface Opciones {
  /** Lo que tiene la cuenta: `null` si no se puede leer. Por defecto, 100 dólares. */
  saldo?: bigint | null | (() => Promise<bigint | null>);
  /** Lo que contesta la cuenta al pagar. Por defecto, que salió. */
  pago?: ResultadoDelPremio | (() => Promise<ResultadoDelPremio>);
  prep?: Preparacion;
  previo?: LecturaDePago | (() => Promise<LecturaDePago>);
  /** Sin la cuenta que paga sola: la billetera de siempre. */
  sinSola?: boolean;
  firmaAdentro?: boolean;
}

/** Dependencias de mentira: lo que contesta la red y la cuenta que paga sola, y quién fue llamado. */
function armar(o: Opciones = {}): Armado {
  const buscar = vi.fn(async (): Promise<LecturaDePago> => (typeof o.previo === "function" ? o.previo() : (o.previo ?? { tipo: "no-hay" })));
  const preparar = vi.fn(async (d: DatosDelPago): Promise<Preparacion> => o.prep ?? { ok: true, xdr: XDR, nota: NOTA, monto: d.monto });
  const mandar = vi.fn(async () => ({ ok: true as const, hash: HASH }));
  const firmar = vi.fn(async () => "firmado");
  const pagar = vi.fn(async (_xdr: string, _pedido: PedidoDeLaCuenta): Promise<ResultadoDelPremio> => {
    if (typeof o.pago === "function") return o.pago();
    return o.pago ?? { estado: "salio", hash: HASH };
  });
  const saldo = vi.fn(async (): Promise<bigint | null> => {
    if (typeof o.saldo === "function") return o.saldo();
    return o.saldo === undefined ? dolares(100) : o.saldo;
  });
  const cargar = vi.fn();
  const sola: PagoSolo = { saldo, pagar };
  const billetera: Billetera = {
    direccion: ORG,
    firmaAdentro: o.firmaAdentro ?? true,
    ...(o.sinSola ? {} : { mandaSola: sola }),
    red: async () => null,
    firmar,
  };
  const pasos: string[] = [];
  const deps: Dependencias = { buscar, preparar, mandar, billetera, cargar, alAvanzar: (p) => pasos.push(p) };
  return { deps, buscar, preparar, mandar, firmar, pagar, saldo, cargar, pasos };
}

beforeEach(() => {
  document.body.replaceChildren();
  setLang("es");
  abrirSaldo.mockReset();
  Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn(async () => undefined) }, configurable: true });
});
afterEach(() => vi.useRealTimers());

/* ------------------------------------------------------------ lo puro: el contador */

describe("el monto con botones", () => {
  it("el monto fijo sale del texto del premio, y sin un monto claro no hay", () => {
    expect(montoFijoDelPremio("Beca de 50 USDC")).toBe(dolares(50));
    expect(montoFijoDelPremio("12,5 dólares")).toBe(dolares(12.5));
    expect(montoFijoDelPremio("Una polera")).toBeNull();
    expect(montoFijoDelPremio("")).toBeNull();
  });

  it("un cero no es un monto claro: se elige con el contador", () => {
    expect(montoFijoDelPremio("0 USDC")).toBeNull();
    expect(montoFijoDelPremio("0,0 dólares")).toBeNull();
  });

  it("un número con un grupo de tres cifras puede ser un millar: no se lee como decimal, se elige con el contador", () => {
    for (const premio of ["Beca de 1.000 USDC", "$1,000", "2.500 dólares", "1.234,5 USDC", "1.000.000 USD"]) {
      expect(montoFijoDelPremio(premio), premio).toBeNull();
    }
    // Con una o dos cifras decimales sigue siendo un decimal.
    expect(montoFijoDelPremio("Beca de 1,5 USDC")).toBe(dolares(1.5));
    expect(montoFijoDelPremio("Beca de 12.25 USDC")).toBe(dolares(12.25));
  });

  it("el contador no baja de un dólar ni pasa del saldo", () => {
    expect(deAUnDolarSolo(dolares(1), -1, dolares(10))).toBe(dolares(1));
    expect(deAUnDolarSolo(dolares(1), 1, dolares(10))).toBe(dolares(2));
    expect(deAUnDolarSolo(dolares(9.5), 1, dolares(10))).toBe(dolares(10));
    expect(deAUnDolarSolo(dolares(10), 1, dolares(10))).toBe(dolares(10));
  });

  it("con menos de un dólar en la cuenta, el contador marca lo que hay", () => {
    expect(limitesDelContador(dolares(0.4))).toEqual({ piso: dolares(0.4), techo: dolares(0.4) });
    expect(deAUnDolarSolo(dolares(1), -1, dolares(0.4))).toBe(dolares(0.4));
    expect(acotarMonto(dolares(5), dolares(0.4))).toBe(dolares(0.4));
  });

  it("con la cuenta vacía, el contador queda en un dólar para poder decir cuánto falta", () => {
    expect(limitesDelContador(0n)).toEqual({ piso: dolares(1), techo: dolares(1) });
    expect(deAUnDolarSolo(dolares(1), 1, 0n)).toBe(dolares(1));
  });

  it("sin saber el saldo, el contador sube sin pasar de un tope", () => {
    expect(deAUnDolarSolo(dolares(1), 1, null)).toBe(dolares(2));
    expect(limitesDelContador(null).techo).toBe(dolares(1_000_000));
    expect(acotarMonto(dolares(2_000_000), null)).toBe(dolares(1_000_000));
  });

  it("al pasar a otro monto, el contador arranca en los dólares enteros del monto fijo, o en uno", () => {
    expect(arranqueDelContador(dolares(50), dolares(100))).toBe(dolares(50));
    expect(arranqueDelContador(dolares(12.5), dolares(100))).toBe(dolares(12));
    expect(arranqueDelContador(dolares(50), dolares(20))).toBe(dolares(20));
    expect(arranqueDelContador(dolares(0.5), dolares(100))).toBe(dolares(1));
    expect(arranqueDelContador(null, dolares(100))).toBe(dolares(1));
  });

  it("el monto sale con siete decimales y se lee con el idioma de ahora", () => {
    expect(montoEnTexto(dolares(50))).toBe("50.0000000");
    expect(montoEnTexto(dolares(0.4))).toBe("0.4000000");
    expect(formatoDeMonto(dolares(12.5))).toBe("12,5");
    setLang("en");
    expect(formatoDeMonto(dolares(12.5))).toBe("12.5");
  });
});

/* ------------------------------------------------- los pasos con la cuenta que paga sola */

describe("los pasos de un pago con la cuenta que paga sola", () => {
  it("mira la red, arma el pago, se lo pasa a la cuenta y devuelve el hash, sin firmar ni mandar nada afuera", async () => {
    const a = armar();
    expect(await pagarUnPremio(a.deps, PEDIDO)).toEqual({ tipo: "listo", hash: HASH, origen: ORG });
    expect(a.pasos).toEqual(["mirando", "pagando"]);
    expect(a.preparar).toHaveBeenCalledWith({
      red: "mainnet",
      origen: ORG,
      destino: GANA,
      activo: ACTIVO,
      monto: "50.0000000",
      raffleId: "777",
      puesto: 2,
    });
    expect(a.pagar).toHaveBeenCalledWith(XDR, { cuenta: ORG, destino: GANA, monto: "50.0000000", nota: NOTA });
    expect(a.firmar).not.toHaveBeenCalled();
    expect(a.mandar).not.toHaveBeenCalled();
  });

  it("primero se mira si el premio ya está pagado y después se arma y se paga", async () => {
    const a = armar();
    await pagarUnPremio(a.deps, PEDIDO);
    expect(a.buscar.mock.invocationCallOrder[0]).toBeLessThan(a.preparar.mock.invocationCallOrder[0] as number);
    expect(a.preparar.mock.invocationCallOrder[0]).toBeLessThan(a.pagar.mock.invocationCallOrder[0] as number);
  });

  it("si ya está pagado en la red, no arma nada ni le pasa nada a la cuenta", async () => {
    const a = armar({ previo: PAGADO });
    expect(await pagarUnPremio(a.deps, PEDIDO)).toEqual({ tipo: "ya-pagado", hash: HASH, origen: ORG });
    expect(a.preparar).not.toHaveBeenCalled();
    expect(a.pagar).not.toHaveBeenCalled();
  });

  it("si la red no deja saberlo, no paga a ciegas", async () => {
    const a = armar({ previo: { tipo: "sin-consulta" } });
    expect(await pagarUnPremio(a.deps, PEDIDO)).toEqual({ tipo: "sin-consulta" });
    const b = armar({ previo: () => Promise.reject(new Error("se cortó")) });
    expect(await pagarUnPremio(b.deps, PEDIDO)).toEqual({ tipo: "sin-consulta" });
    expect(a.pagar).not.toHaveBeenCalled();
    expect(b.pagar).not.toHaveBeenCalled();
  });

  it("si la cuenta de quien ganó no puede recibir, o no alcanza el saldo, no le pasa nada a la cuenta", async () => {
    for (const motivo of ["destino-sin-linea", "destino-sin-cuenta", "destino-lleno", "origen-sin-saldo", "origen-sin-linea", "sin-red"] as const) {
      const a = armar({ prep: { ok: false, motivo, ...(motivo === "origen-sin-saldo" ? { saldo: "10.0000000" } : {}) } });
      expect(await pagarUnPremio(a.deps, PEDIDO), motivo).toMatchObject({ tipo: "no-se-puede", motivo });
      expect(a.pagar, motivo).not.toHaveBeenCalled();
    }
  });

  it("lo que no salió se traduce: lo aprobado no era lo armado, ahora no se puede, o se cortó la persona", async () => {
    const no = (motivo: "regla" | "no-coincide" | "cancelado" | "ahora-no" | "red"): ResultadoDelPremio => ({ estado: "no-salio", motivo });
    expect(await pagarUnPremio(armar({ pago: no("no-coincide") }).deps, PEDIDO)).toEqual({ tipo: "no-coincide" });
    expect(await pagarUnPremio(armar({ pago: no("ahora-no") }).deps, PEDIDO)).toEqual({ tipo: "ahora-no" });
    expect(await pagarUnPremio(armar({ pago: no("cancelado") }).deps, PEDIDO)).toEqual({ tipo: "no-firmado" });
    expect(await pagarUnPremio(armar({ pago: no("regla") }).deps, PEDIDO)).toEqual({ tipo: "no-firmado" });
  });

  it("si no se sabe si salió (incierto, un corte, o la cuenta que lanza), queda en duda con lo que hay que mirar en la red", async () => {
    const busca = { destino: GANA, nota: NOTA, desde: DESDE };
    expect(await pagarUnPremio(armar({ pago: { estado: "incierto" } }).deps, PEDIDO)).toMatchObject({ tipo: "sin-respuesta", busqueda: busca });
    const corte = armar({ pago: { estado: "no-salio", motivo: "red" } });
    expect(await pagarUnPremio(corte.deps, PEDIDO)).toMatchObject({ tipo: "sin-respuesta", busqueda: busca });
    const lanza = armar({ pago: () => Promise.reject(new Error("se cayó")) });
    expect(await pagarUnPremio(lanza.deps, PEDIDO)).toMatchObject({ tipo: "sin-respuesta", busqueda: busca });
  });

  it("un monto que no vale no llega a la red", async () => {
    for (const monto of ["", "0", "abc", "1.23456789"]) {
      const a = armar();
      expect(await pagarUnPremio(a.deps, { ...PEDIDO, monto }), monto).toEqual({ tipo: "monto-malo" });
      expect(a.buscar).not.toHaveBeenCalled();
    }
  });

  it("con otra billetera arma el pago para aprobarlo afuera, de la cuenta que se eligió, y no paga con la cuenta que paga sola", async () => {
    const a = armar();
    const r = await pagarUnPremio(a.deps, { ...PEDIDO, afuera: true, cuentaQuePaga: PAGA });
    expect(r).toEqual({ tipo: "afuera", xdr: XDR, nota: NOTA, origen: PAGA });
    expect(a.preparar.mock.calls[0]?.[0].origen).toBe(PAGA);
    expect(a.pagar).not.toHaveBeenCalled();
    expect(a.firmar).not.toHaveBeenCalled();
  });

  it("con otra billetera y sin cuenta, no arma nada: el pago no puede salir de la cuenta activa", async () => {
    const a = armar();
    expect(await pagarUnPremio(a.deps, { ...PEDIDO, afuera: true })).toEqual({ tipo: "cuenta-mala" });
    expect(await pagarUnPremio(a.deps, { ...PEDIDO, afuera: true, cuentaQuePaga: "Ana" })).toEqual({ tipo: "cuenta-mala" });
    expect(a.preparar).not.toHaveBeenCalled();
    expect(a.pagar).not.toHaveBeenCalled();
  });

  it("sin la cuenta que paga sola, firma adentro o devuelve el pago para firmarlo afuera, como siempre", async () => {
    const a = armar({ sinSola: true });
    expect((await pagarUnPremio(a.deps, PEDIDO)).tipo).toBe("listo");
    expect(a.firmar).toHaveBeenCalledTimes(1);
    expect(a.pagar).not.toHaveBeenCalled();
    const b = armar({ sinSola: true, firmaAdentro: false });
    expect(await pagarUnPremio(b.deps, { ...PEDIDO, cuentaQuePaga: PAGA })).toMatchObject({ tipo: "afuera", origen: PAGA });
  });
});

/* ------------------------------------------------------------------ lo que se le dice */

describe("lo que se le dice a la persona", () => {
  const busqueda = { red: "mainnet", destino: GANA, activo: ACTIVO, nota: NOTA, pagadoras: [ORG], desde: DESDE } as const;
  const nuevos: Resultado[] = [
    { tipo: "no-coincide" },
    { tipo: "ahora-no" },
    { tipo: "no-firmado" },
    { tipo: "sin-respuesta", busqueda },
    { tipo: "no-se-puede", motivo: "origen-sin-saldo", saldo: "12.5000000" },
  ];

  it("cada resultado tiene su texto en español y en inglés, con la cuenta que paga sola y sin ella, sin variables sin reemplazar", () => {
    for (const r of nuevos) {
      for (const google of [true, false]) {
        const m = mensajeDe(r, { quien: "Equipo Cohete", red: "mainnet", monto: "50", google });
        for (const l of ["es", "en"] as const) {
          let s = T[l][m.clave] as string;
          expect(typeof s, `${l} ${m.clave}`).toBe("string");
          for (const [k, v] of Object.entries(m.vars)) s = s.split(`{${k}}`).join(v);
          expect(s, `${l} ${m.clave}`).not.toMatch(/\{\w+\}/);
        }
      }
    }
  });

  it("con la cuenta que paga sola usa sus propios textos, y sin ella los de siempre", () => {
    const c = { quien: "x", red: "mainnet", monto: "50" } as const;
    expect(mensajeDe({ tipo: "no-firmado" }, { ...c, google: true }).clave).toBe("pgGoogleNoSalio");
    expect(mensajeDe({ tipo: "no-firmado" }, c).clave).toBe("pgNoFirmaste");
    expect(mensajeDe({ tipo: "sin-respuesta", busqueda }, { ...c, google: true }).clave).toBe("pgGoogleDuda");
    expect(mensajeDe({ tipo: "sin-respuesta", busqueda }, c).clave).toBe("pgDuda");
    expect(mensajeDe({ tipo: "no-coincide" }, c).clave).toBe("pgGoogleNoCoincide");
    expect(mensajeDe({ tipo: "ahora-no" }, c).clave).toBe("pgGoogleAhoraNo");
  });

  it("si no alcanza el saldo, dice lo que tiene, el monto y cuánto falta, y ofrece cargar", () => {
    const sin = { tipo: "no-se-puede", motivo: "origen-sin-saldo", saldo: "12.5000000" } as const;
    const m = mensajeDe(sin, { quien: "x", red: "mainnet", monto: "50", google: true });
    expect(m.clave).toBe("pgGoogleNoAlcanza");
    expect(m.vars).toMatchObject({ saldo: "12,5", monto: "50", falta: "37,5" });
    expect(m.cargar).toBe(true);
    // Sin la cuenta que paga sola, el texto de siempre y sin cargar.
    const otra = mensajeDe(sin, { quien: "x", red: "mainnet", monto: "50" });
    expect(otra.clave).toBe("pgSinSaldo");
    expect(otra.cargar).toBe(false);
  });

  it("cargar se ofrece cuando falta algo de la cuenta que paga, no cuando falta de quien ganó", () => {
    const c = { quien: "x", red: "mainnet", monto: "50", google: true } as const;
    for (const motivo of ["origen-sin-saldo", "origen-sin-linea", "origen-sin-cuenta"] as const) {
      expect(mensajeDe({ tipo: "no-se-puede", motivo }, c).cargar, motivo).toBe(true);
    }
    for (const motivo of ["destino-sin-linea", "destino-sin-cuenta", "destino-lleno", "sin-red"] as const) {
      expect(mensajeDe({ tipo: "no-se-puede", motivo }, c).cargar, motivo).toBe(false);
    }
  });

  it("los textos nuevos están en los dos idiomas, con las mismas variables, y no usan lo que el sitio no escribe", () => {
    const claves = Object.keys(TEXTOS_PAGOS.es).filter((k) => k.startsWith("pgGoogle"));
    expect(claves.length).toBeGreaterThanOrEqual(15);
    const vars = (s: string): string[] => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1] as string).sort();
    for (const k of claves) {
      const es = TEXTOS_PAGOS.es[k] as string;
      const en = TEXTOS_PAGOS.en[k] as string;
      expect(en, k).toBeTruthy();
      expect(vars(en), k).toEqual(vars(es));
      for (const [l, s] of [["es", es], ["en", en]] as const) {
        expect(s, `${l} ${k}`).not.toMatch(/[;«»<>—·!¡]/);
        expect(s, `${l} ${k}`).not.toMatch(/rifa|loter[ií]a|boleto|ticket|apuesta|raffle|lottery|bet\b/i);
      }
      expect(es, k).not.toMatch(/\b(firma|firmar|firmalo|hash|red|comisi[oó]n|contrato|xdr|co-?firma)\b/i);
      expect(en, k).not.toMatch(/\b(sign|signs|signed|signature|hash|network|fee|contract|xdr|co-?sign)\b/i);
    }
  });
});

/* ------------------------------------------------------------------- la pantalla */

const FILA = { puesto: 2, cuenta: GANA, nombre: "Equipo Cohete", nota: NOTA };

interface Abierto {
  caja: HTMLElement;
  terminados: number[];
  /** Con qué avisó cada vez que terminó: `true` si el pago ya estaba en la red. */
  yaEstaba: (boolean | undefined)[];
  pagadoras: Set<string>;
  form: HTMLFormElement;
}

function abrir(dep: Armado, extra: Partial<ContextoDePago> = {}): Abierto {
  const caja = document.createElement("div");
  document.body.append(caja);
  const pagadoras = new Set<string>([ORG]);
  const terminados: number[] = [];
  const yaEstaba: (boolean | undefined)[] = [];
  const base: ContextoDePago = {
    red: "mainnet",
    raffleId: "777",
    premio: "Beca de 50 USDC",
    activo: ACTIVO,
    pagadoras,
    desde: DESDE,
    dependencias: async () => dep.deps,
  };
  const pagar = pagarPremioEn({ ...base, ...extra });
  pagar(FILA, caja, (ya) => {
    terminados.push(1);
    yaEstaba.push(ya);
  });
  return { caja, terminados, yaEstaba, pagadoras, form: caja.querySelector("form") as HTMLFormElement };
}

const enviar = (form: HTMLFormElement): void => void form.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
const botonCon = (caja: HTMLElement, rotulo: string): HTMLButtonElement | undefined =>
  [...caja.querySelectorAll("button")].find((b) => b.textContent === rotulo);
const q = <T extends HTMLElement>(caja: HTMLElement, sel: string): T => caja.querySelector(sel) as T;
const texto = (caja: HTMLElement, sel: string): string => q(caja, sel).textContent ?? "";
const mensaje = (caja: HTMLElement): string => texto(caja, ".gan-msg");
/** Lo que falta para pagar, que el formulario dice aparte del resultado del pago. */
const falta = (caja: HTMLElement): string => texto(caja, ".gan-falta");
const principal = (caja: HTMLElement): HTMLButtonElement => q<HTMLButtonElement>(caja, "button[type=submit]");
const contador = (caja: HTMLElement): string => texto(caja, ".gan-contador-valor");
const visible = (e: HTMLElement | null | undefined): boolean => !!e && !e.hidden && !e.closest("[hidden]");
/** Deja correr lo que está esperando en el aire, sin reloj. */
const vaciar = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};
/** Espera a que el formulario se arme para la cuenta que paga sola y lea su saldo. */
const lista = async (caja: HTMLElement): Promise<void> => {
  await vi.waitFor(() => expect(texto(caja, ".gan-explica")).toContain("Pagás a"));
  await vi.waitFor(() => expect(texto(caja, ".gan-explica") + falta(caja)).toMatch(/te quedan|Te faltan/));
};

describe("sin la cuenta que paga sola", () => {
  it("la pantalla es la de siempre: el campo del monto, Firmar y pagar, y nada de botones de monto ni de otra billetera", async () => {
    const dep = armar({ sinSola: true });
    const { caja } = abrir(dep);
    await vaciar();
    expect(q<HTMLInputElement>(caja, ".gan-campo input").value).toBe("50");
    expect(principal(caja).textContent).toBe("Firmar y pagar");
    expect(visible(q(caja, ".gan-google"))).toBe(false);
    expect(visible(q(caja, ".gan-otra"))).toBe(false);
    expect(visible(botonCon(caja, "Cargar dólares digitales"))).toBe(false);
    expect(dep.saldo).not.toHaveBeenCalled();
  });

  it("con una cuenta de Google que no paga sola, sigue pidiendo la cuenta que paga y armando el pago para firmarlo afuera", async () => {
    const dep = armar({ sinSola: true, firmaAdentro: false });
    const { caja, form } = abrir(dep);
    await vi.waitFor(() => expect(principal(caja).textContent).toBe("Armar el pago"));
    q<HTMLInputElement>(caja, ".gan-campo:nth-of-type(2) input").value = OTRA;
    enviar(form);
    await vi.waitFor(() => expect(mensaje(caja)).toContain("entró con Google"));
    expect(dep.pagar).not.toHaveBeenCalled();
    expect(dep.preparar.mock.calls[0]?.[0].origen).toBe(OTRA);
  });
});

describe("con un monto claro en el texto del premio", () => {
  it("se ve en grande, sin campo para escribirlo, con lo que queda y una sola principal: Pagar", async () => {
    const { caja } = abrir(armar());
    await lista(caja);
    expect(texto(caja, ".gan-monto-grande")).toBe("50 dólares digitales");
    expect(texto(caja, ".gan-explica")).toBe("Pagás a Equipo Cohete y te quedan 50 dólares digitales.");
    expect(visible(q(caja, ".gan-contador"))).toBe(false);
    // El único campo de texto es el de otra billetera, plegado: el monto no se escribe.
    const campos = [...caja.querySelectorAll("input")];
    expect(campos).toHaveLength(1);
    expect(campos[0]?.closest("details.gan-otra")).not.toBeNull();
    expect(principal(caja).textContent).toBe("Pagar");
    expect(visible(principal(caja))).toBe(true);
    expect(visible(botonCon(caja, "Cargar dólares digitales"))).toBe(false);
    expect(visible(botonCon(caja, "Otro monto"))).toBe(true);
  });

  it("al tocar Pagar, se le pasa a la cuenta el pago por ese monto y, cuando sale, queda el enlace y no vuelve el botón", async () => {
    const dep = armar();
    const { caja, terminados, pagadoras } = abrir(dep);
    await lista(caja);
    principal(caja).click();
    await vi.waitFor(() => expect(mensaje(caja)).toBe("Listo, el pago salió."));
    expect(dep.pagar).toHaveBeenCalledTimes(1);
    expect(dep.pagar).toHaveBeenCalledWith(XDR, { cuenta: ORG, destino: GANA, monto: "50.0000000", nota: NOTA });
    expect(dep.firmar).not.toHaveBeenCalled();
    const enlace = q<HTMLAnchorElement>(caja, "a");
    expect(enlace.hidden).toBe(false);
    expect(enlace.href).toBe(txUrl(HASH, "mainnet"));
    expect(enlace.textContent).toBe("Ver el pago ↗");
    expect(terminados).toHaveLength(1);
    expect(pagadoras.has(ORG)).toBe(true);
    expect(visible(principal(caja))).toBe(false);
    expect(visible(q(caja, ".gan-google"))).toBe(false);
    expect(visible(q(caja, ".gan-otra"))).toBe(false);
    expect(visible(q(caja, ".gan-explica"))).toBe(false);
  });

  it("mientras mira y mientras paga, lo dice con sus propias frases y no deja tocar nada más", async () => {
    let soltarBusqueda: (l: LecturaDePago) => void = () => undefined;
    let soltarPago: (r: ResultadoDelPremio) => void = () => undefined;
    const dep = armar({ pago: () => new Promise<ResultadoDelPremio>((r) => (soltarPago = r)) });
    const { caja, form } = abrir(dep);
    await lista(caja);
    dep.buscar.mockImplementationOnce(() => new Promise<LecturaDePago>((r) => (soltarBusqueda = r)));
    enviar(form);
    await vi.waitFor(() => expect(mensaje(caja)).toBe("Revisando que el premio no esté pagado…"));
    expect(principal(caja).disabled).toBe(true);
    expect(botonCon(caja, "Otro monto")?.disabled).toBe(true);
    soltarBusqueda({ tipo: "no-hay" });
    await vi.waitFor(() => expect(mensaje(caja)).toBe("Pagando…"));
    soltarPago({ estado: "salio", hash: HASH });
    await vi.waitFor(() => expect(mensaje(caja)).toBe("Listo, el pago salió."));
  });

  it("un toque doble o un Enter de más pasan un solo pago", async () => {
    const dep = armar();
    const { caja, form } = abrir(dep);
    await lista(caja);
    enviar(form);
    enviar(form);
    enviar(form);
    await vi.waitFor(() => expect(mensaje(caja)).toBe("Listo, el pago salió."));
    enviar(form);
    await Promise.resolve();
    expect(dep.pagar).toHaveBeenCalledTimes(1);
    expect(dep.preparar).toHaveBeenCalledTimes(1);
  });

  it("paga a quien ganó según la fila, aunque en la pantalla haya otra cuenta escrita", async () => {
    const dep = armar();
    const { caja, form } = abrir(dep);
    await lista(caja);
    q<HTMLInputElement>(caja, "input").value = OTRA;
    enviar(form);
    await vi.waitFor(() => expect(mensaje(caja)).toBe("Listo, el pago salió."));
    expect(dep.preparar.mock.calls[0]?.[0]).toMatchObject({ origen: ORG, destino: GANA });
    expect(dep.pagar.mock.calls[0]?.[1]).toMatchObject({ cuenta: ORG, destino: GANA });
  });

  it("con un monto con decimales, lo muestra como se lee y lo paga exacto", async () => {
    const dep = armar();
    const { caja, form } = abrir(dep, { premio: "Beca de 12,5 USDC" });
    await lista(caja);
    expect(texto(caja, ".gan-monto-grande")).toBe("12,5 dólares digitales");
    enviar(form);
    await vi.waitFor(() => expect(mensaje(caja)).toBe("Listo, el pago salió."));
    expect(dep.pagar.mock.calls[0]?.[1].monto).toBe("12.5000000");
  });
});

describe("sin un monto claro en el texto del premio", () => {
  const sinMonto = { premio: "Una polera" };

  it("se elige con un contador que arranca en un dólar, sin campo para escribir", async () => {
    const { caja } = abrir(armar(), sinMonto);
    await lista(caja);
    expect(visible(q(caja, ".gan-contador"))).toBe(true);
    expect(contador(caja)).toBe("1 dólares digitales");
    expect(visible(q(caja, ".gan-monto-grande"))).toBe(false);
    expect(visible(botonCon(caja, "Otro monto"))).toBe(false);
    expect(botonCon(caja, "Un dólar menos")).toBeDefined();
    expect(botonCon(caja, "Un dólar más")).toBeDefined();
    expect(caja.querySelectorAll("input")).toHaveLength(1);
  });

  it("sube y baja de a un dólar, nunca menos de uno, y paga lo que se ve", async () => {
    const dep = armar();
    const { caja, form } = abrir(dep, sinMonto);
    await lista(caja);
    const menos = botonCon(caja, "Un dólar menos") as HTMLButtonElement;
    const mas = botonCon(caja, "Un dólar más") as HTMLButtonElement;
    expect(menos.disabled).toBe(true);
    mas.click();
    mas.click();
    expect(contador(caja)).toBe("3 dólares digitales");
    expect(texto(caja, ".gan-explica")).toBe("Pagás a Equipo Cohete y te quedan 97 dólares digitales.");
    menos.click();
    expect(contador(caja)).toBe("2 dólares digitales");
    menos.click();
    menos.click();
    expect(contador(caja)).toBe("1 dólares digitales");
    mas.click();
    enviar(form);
    await vi.waitFor(() => expect(mensaje(caja)).toBe("Listo, el pago salió."));
    expect(dep.pagar.mock.calls[0]?.[1].monto).toBe("2.0000000");
  });

  it("no pasa del saldo: con 3 dólares, el tercero es el último", async () => {
    const dep = armar({ saldo: dolares(3) });
    const { caja, form } = abrir(dep, sinMonto);
    await lista(caja);
    const mas = botonCon(caja, "Un dólar más") as HTMLButtonElement;
    mas.click();
    mas.click();
    mas.click();
    expect(contador(caja)).toBe("3 dólares digitales");
    expect(mas.disabled).toBe(true);
    expect(texto(caja, ".gan-explica")).toContain("te quedan 0 dólares digitales.");
    enviar(form);
    await vi.waitFor(() => expect(mensaje(caja)).toBe("Listo, el pago salió."));
    expect(dep.pagar.mock.calls[0]?.[1].monto).toBe("3.0000000");
  });

  it("con menos de un dólar en la cuenta, el contador marca lo que hay", async () => {
    const { caja } = abrir(armar({ saldo: dolares(0.4) }), sinMonto);
    await vi.waitFor(() => expect(contador(caja)).toBe("0,4 dólares digitales"));
    expect((botonCon(caja, "Un dólar más") as HTMLButtonElement).disabled).toBe(true);
    expect((botonCon(caja, "Un dólar menos") as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("Otro monto", () => {
  it("pasa del monto fijo al contador, desde los dólares enteros del monto, por si el texto del premio se leyó mal", async () => {
    const dep = armar();
    const { caja, form } = abrir(dep);
    await lista(caja);
    (botonCon(caja, "Otro monto") as HTMLButtonElement).click();
    expect(visible(q(caja, ".gan-contador"))).toBe(true);
    expect(visible(q(caja, ".gan-monto-grande"))).toBe(false);
    expect(visible(botonCon(caja, "Otro monto"))).toBe(false);
    expect(contador(caja)).toBe("50 dólares digitales");
    (botonCon(caja, "Un dólar menos") as HTMLButtonElement).click();
    expect(contador(caja)).toBe("49 dólares digitales");
    enviar(form);
    await vi.waitFor(() => expect(mensaje(caja)).toBe("Listo, el pago salió."));
    expect(dep.pagar.mock.calls[0]?.[1].monto).toBe("49.0000000");
  });

  it("si el monto del premio es más que el saldo, el contador arranca en lo que hay y deja pagar", async () => {
    const { caja } = abrir(armar({ saldo: dolares(20) }));
    await vi.waitFor(() => expect(falta(caja)).toContain("Tenés 20."));
    (botonCon(caja, "Otro monto") as HTMLButtonElement).click();
    expect(contador(caja)).toBe("20 dólares digitales");
    expect(visible(principal(caja))).toBe(true);
    expect(visible(q(caja, ".gan-falta"))).toBe(false);
    expect(visible(botonCon(caja, "Cargar dólares digitales"))).toBe(false);
  });
});

describe("el saldo y lo que falta", () => {
  it("si no alcanza, dice cuánto falta, esconde Pagar y deja una sola principal: cargar dólares digitales", async () => {
    const { caja } = abrir(armar({ saldo: dolares(12.5) }));
    await vi.waitFor(() => expect(falta(caja)).toBe("Te faltan 37,5 dólares digitales. Tenés 12,5."));
    expect(visible(principal(caja))).toBe(false);
    expect(visible(botonCon(caja, "Cargar dólares digitales"))).toBe(true);
    expect(visible(q(caja, ".gan-explica"))).toBe(false);
  });

  it("Cargar abre la ventana de los dólares digitales de esa cuenta, y al cerrarla vuelve a leer el saldo", async () => {
    let tiene = dolares(12.5);
    const dep = armar({ saldo: async () => tiene });
    const { caja } = abrir(dep);
    await vi.waitFor(() => expect(visible(botonCon(caja, "Cargar dólares digitales"))).toBe(true));
    botonCon(caja, "Cargar dólares digitales")?.click();
    expect(dep.cargar).toHaveBeenCalledTimes(1);
    expect(dep.cargar.mock.calls[0]?.[0]).toBe(ORG);
    // Se cargaron dólares y se cerró la ventana.
    tiene = dolares(100);
    (dep.cargar.mock.calls[0]?.[1] as () => void)();
    await vi.waitFor(() => expect(visible(principal(caja))).toBe(true));
    expect(visible(botonCon(caja, "Cargar dólares digitales"))).toBe(false);
    expect(visible(q(caja, ".gan-falta"))).toBe(false);
    expect(texto(caja, ".gan-explica")).toContain("te quedan 50 dólares digitales.");
    expect(dep.saldo).toHaveBeenCalledTimes(2);
  });

  it("la ventana de cargar se abre con la dirección de la cuenta, en la vista de traer saldo", async () => {
    const alCerrar = vi.fn();
    cargarEnSaldo(ORG, alCerrar);
    await vi.waitFor(() => expect(abrirSaldo).toHaveBeenCalledTimes(1));
    expect(abrirSaldo).toHaveBeenCalledWith({ address: ORG }, {}, { vista: "traer", alCerrar });
  });

  it("con la cuenta en cero y sin monto claro, dice que falta un dólar", async () => {
    const { caja } = abrir(armar({ saldo: 0n }), { premio: "Una polera" });
    await vi.waitFor(() => expect(falta(caja)).toBe("Te faltan 1 dólares digitales. Tenés 0."));
    expect(visible(botonCon(caja, "Cargar dólares digitales"))).toBe(true);
    expect(visible(principal(caja))).toBe(false);
  });

  it("con el saldo justo para el monto, deja pagar y dice que quedan cero", async () => {
    const dep = armar({ saldo: dolares(50) });
    const { caja, form } = abrir(dep);
    await vi.waitFor(() => expect(texto(caja, ".gan-explica")).toContain("te quedan 0 dólares digitales."));
    expect(visible(principal(caja))).toBe(true);
    expect(visible(q(caja, ".gan-falta"))).toBe(false);
    expect(visible(botonCon(caja, "Cargar dólares digitales"))).toBe(false);
    enviar(form);
    await vi.waitFor(() => expect(mensaje(caja)).toBe("Listo, el pago salió."));
    expect(dep.pagar.mock.calls[0]?.[1].monto).toBe("50.0000000");
  });

  it("con un stroop menos que el monto, no deja pagar y dice cuánto falta, sin redondear", async () => {
    const dep = armar({ saldo: dolares(50) - 1n });
    const { caja } = abrir(dep);
    const dice = "Te faltan 0,0000001 dólares digitales. Tenés 49,9999999.";
    await vi.waitFor(() => expect(falta(caja)).toBe(dice));
    expect(visible(principal(caja))).toBe(false);
    expect(visible(botonCon(caja, "Cargar dólares digitales"))).toBe(true);
    expect(dep.pagar).not.toHaveBeenCalled();
  });

  it("con un saldo que no es de dólares enteros, el contador llega justo al saldo y paga exactamente eso", async () => {
    const dep = armar({ saldo: dolares(2.5) });
    const { caja, form } = abrir(dep, { premio: "Una polera" });
    await lista(caja);
    const mas = botonCon(caja, "Un dólar más") as HTMLButtonElement;
    mas.click();
    mas.click();
    expect(contador(caja)).toBe("2,5 dólares digitales");
    expect(mas.disabled).toBe(true);
    expect(texto(caja, ".gan-explica")).toContain("te quedan 0 dólares digitales.");
    enviar(form);
    await vi.waitFor(() => expect(mensaje(caja)).toBe("Listo, el pago salió."));
    expect(dep.pagar.mock.calls[0]?.[1].monto).toBe("2.5000000");
  });

  it("si no se puede leer el saldo, no inventa lo que queda: deja pagar y la red revisa", async () => {
    const dep = armar({ saldo: null });
    const { caja, form } = abrir(dep);
    await vi.waitFor(() => expect(texto(caja, ".gan-explica")).toBe("Pagás a Equipo Cohete"));
    await vi.waitFor(() => expect(dep.saldo).toHaveBeenCalled());
    expect(visible(principal(caja))).toBe(true);
    enviar(form);
    await vi.waitFor(() => expect(mensaje(caja)).toBe("Listo, el pago salió."));
  });

  it("si leer el saldo falla, pasa lo mismo que si no se pudo leer", async () => {
    const dep = armar({ saldo: () => Promise.reject(new Error("sin red")) });
    const { caja } = abrir(dep);
    await vi.waitFor(() => expect(dep.saldo).toHaveBeenCalled());
    await vi.waitFor(() => expect(texto(caja, ".gan-explica")).toBe("Pagás a Equipo Cohete"));
    expect(visible(principal(caja))).toBe(true);
  });

  it("si la red dice que no alcanza aunque se había leído saldo, el formulario lo muestra con lo que falta y Cargar", async () => {
    const dep = armar({ prep: { ok: false, motivo: "origen-sin-saldo", saldo: "10.0000000" } });
    const { caja, form } = abrir(dep);
    await lista(caja);
    enviar(form);
    await vi.waitFor(() => expect(falta(caja)).toBe("Te faltan 40 dólares digitales. Tenés 10."));
    expect(visible(botonCon(caja, "Cargar dólares digitales"))).toBe(true);
    expect(visible(principal(caja))).toBe(false);
    expect(dep.pagar).not.toHaveBeenCalled();
  });

  it("si la cuenta ni tiene dólares digitales, lo dice y ofrece cargar", async () => {
    const dep = armar({ prep: { ok: false, motivo: "origen-sin-linea" } });
    const { caja, form } = abrir(dep);
    await lista(caja);
    enviar(form);
    await vi.waitFor(() => expect(mensaje(caja)).toBe("La cuenta que paga todavía no tiene USDC."));
    expect(visible(botonCon(caja, "Cargar dólares digitales"))).toBe(true);
    // Pagar de nuevo no serviría de nada: la principal es cargar.
    expect(visible(principal(caja))).toBe(false);
    expect(dep.pagar).not.toHaveBeenCalled();
  });

  it("si falla algo de quien ganó, no ofrece cargar: no es un problema de saldo", async () => {
    const dep = armar({ prep: { ok: false, motivo: "destino-sin-linea" } });
    const { caja, form } = abrir(dep);
    await lista(caja);
    enviar(form);
    await vi.waitFor(() => expect(botonCon(caja, "Avisarle")?.hidden).toBe(false));
    expect(visible(botonCon(caja, "Cargar dólares digitales"))).toBe(false);
  });
});

describe("un premio se paga una sola vez", () => {
  it("si ya está pagado en la red, lo dice, deja el enlace y no le pasa nada a la cuenta", async () => {
    const dep = armar({ previo: PAGADO });
    const { caja, form, terminados, yaEstaba } = abrir(dep);
    await lista(caja);
    enviar(form);
    await vi.waitFor(() => expect(mensaje(caja)).toBe("Este premio ya estaba pagado. No se pagó de nuevo."));
    expect(dep.pagar).not.toHaveBeenCalled();
    expect(dep.preparar).not.toHaveBeenCalled();
    expect(q<HTMLAnchorElement>(caja, "a").hidden).toBe(false);
    expect(terminados).toHaveLength(1);
    // Avisa que ya estaba en la red: la fila lo muestra al instante y no a los segundos.
    expect(yaEstaba).toEqual([true]);
  });

  it("un pago que acaba de salir avisa sin 'ya estaba': la fila espera unos segundos a que la red lo muestre", async () => {
    const dep = armar();
    const { caja, form, yaEstaba } = abrir(dep);
    await lista(caja);
    enviar(form);
    await vi.waitFor(() => expect(mensaje(caja)).toBe("Listo, el pago salió."));
    expect(yaEstaba).toEqual([false]);
    // Con el pago hecho el formulario lo marca, y el cuadro de acciones no se ve.
    expect(q(caja, "form").classList.contains("gan-hecho")).toBe(true);
    expect(q<HTMLElement>(caja, ".row").hidden).toBe(true);
  });

  it("si no se puede mirar la red, no arma nada y se puede volver a probar", async () => {
    const dep = armar({ previo: { tipo: "sin-consulta" } });
    const { caja, form } = abrir(dep);
    await lista(caja);
    enviar(form);
    await vi.waitFor(() => expect(mensaje(caja)).toContain("No pudimos mirar en la red si este premio ya está pagado"));
    expect(dep.preparar).not.toHaveBeenCalled();
    expect(dep.pagar).not.toHaveBeenCalled();
    expect(principal(caja).disabled).toBe(false);
    dep.buscar.mockImplementation(async (): Promise<LecturaDePago> => ({ tipo: "no-hay" }));
    enviar(form);
    await vi.waitFor(() => expect(mensaje(caja)).toBe("Listo, el pago salió."));
  });

  it("si no se sabe si salió, el botón queda en pausa y solo un 'no está' seguro lo vuelve a habilitar", async () => {
    const dep = armar({ pago: { estado: "incierto" } });
    const respuestas: LecturaDePago[] = [{ tipo: "no-hay" }, { tipo: "sin-consulta" }, { tipo: "no-hay" }];
    dep.buscar.mockImplementation(async (): Promise<LecturaDePago> => respuestas.shift() ?? { tipo: "sin-consulta" });
    const { caja, form, terminados } = abrir(dep, { esperaMs: 0 });
    await lista(caja);
    enviar(form);
    // Primero, la duda sin poder mirar: el botón sigue en pausa y se puede volver a mirar.
    const sinRed = "Todavía no sabemos si salió. No vuelvas a pagar. Tocá Volver a mirar en un rato.";
    await vi.waitFor(() => expect(mensaje(caja)).toBe(sinRed));
    expect(terminados).toHaveLength(1);
    expect(principal(caja).disabled).toBe(true);
    expect(visible(botonCon(caja, "Volver a mirar"))).toBe(true);
    // En la duda, «Pagar desde otra billetera» no hace nada: no se ofrece.
    expect(visible(q(caja, ".gan-otra"))).toBe(false);
    enviar(form);
    await Promise.resolve();
    expect(dep.pagar).toHaveBeenCalledTimes(1);
    // Después la red dice con certeza que no está: vuelve el botón.
    botonCon(caja, "Volver a mirar")?.click();
    await vi.waitFor(() => expect(mensaje(caja)).toBe("Ese pago no salió. Podés volver a intentarlo."));
    expect(principal(caja).disabled).toBe(false);
    expect(visible(principal(caja))).toBe(true);
  });

  it("en la duda lo dice con su frase, y si el pago aparece en la red, queda pagado sin pagar otra vez", async () => {
    const dep = armar({ pago: { estado: "no-salio", motivo: "red" } });
    let mirar: () => void = () => undefined;
    dep.buscar.mockImplementationOnce(async (): Promise<LecturaDePago> => ({ tipo: "no-hay" }));
    dep.buscar.mockImplementationOnce(() => new Promise<LecturaDePago>((r) => (mirar = () => r(PAGADO))));
    const { caja, form } = abrir(dep, { esperaMs: 0 });
    await lista(caja);
    enviar(form);
    await vi.waitFor(() => expect(mensaje(caja)).toBe("Mirando si el pago salió…"));
    expect(principal(caja).disabled).toBe(true);
    mirar();
    await vi.waitFor(() => expect(mensaje(caja)).toBe("Listo, el pago salió."));
    expect(q<HTMLAnchorElement>(caja, "a").href).toBe(txUrl(HASH, "mainnet"));
    expect(dep.pagar).toHaveBeenCalledTimes(1);
  });

  it("al decir que no se sabe si salió, usa su propia frase y no toca el monto mientras tanto", async () => {
    const dep = armar({ pago: { estado: "incierto" } });
    const { caja, form } = abrir(dep, { esperaMs: 60_000 });
    await lista(caja);
    enviar(form);
    await vi.waitFor(() =>
      expect(mensaje(caja)).toBe("No sabemos si el pago salió. No vuelvas a pagar: lo estamos revisando."),
    );
    expect(botonCon(caja, "Otro monto")?.disabled).toBe(true);
  });
});

describe("cuando no se pagó nada", () => {
  const casos: Array<[ResultadoDelPremio, string]> = [
    [
      { estado: "no-salio", motivo: "no-coincide" },
      "No se pagó nada: lo que había que aprobar no era este pago. Tus dólares digitales siguen en tu cuenta.",
    ],
    [{ estado: "no-salio", motivo: "ahora-no" }, "Ahora no se puede pagar desde esta cuenta. Probá más tarde o pagá desde otra billetera."],
    [{ estado: "no-salio", motivo: "cancelado" }, "No se pudo pagar. Tus dólares digitales siguen en tu cuenta."],
    [{ estado: "no-salio", motivo: "regla" }, "No se pudo pagar. Tus dólares digitales siguen en tu cuenta."],
  ];

  it.each(casos)("%j: lo dice, no deja nada a medias y se puede volver a probar", async (pago, esperado) => {
    const dep = armar({ pago });
    const { caja, form, terminados } = abrir(dep);
    await lista(caja);
    enviar(form);
    await vi.waitFor(() => expect(mensaje(caja)).toBe(esperado));
    expect(q(caja, ".gan-msg").classList.contains("bad")).toBe(true);
    expect(terminados).toHaveLength(0);
    expect(principal(caja).disabled).toBe(false);
    expect(visible(principal(caja))).toBe(true);
    expect(visible(q(caja, ".gan-google"))).toBe(true);
  });

  it("cambiar el monto limpia lo que se había dicho", async () => {
    const dep = armar({ pago: { estado: "no-salio", motivo: "cancelado" } });
    const { caja, form } = abrir(dep);
    await lista(caja);
    enviar(form);
    await vi.waitFor(() => expect(mensaje(caja)).toContain("No se pudo pagar"));
    (botonCon(caja, "Otro monto") as HTMLButtonElement).click();
    expect(mensaje(caja)).toBe("");
  });
});

describe("Pagar desde otra billetera", () => {
  it("va plegado, con la cuenta que paga vacía, y no paga con la cuenta que paga sola", async () => {
    const dep = armar();
    const { caja } = abrir(dep);
    await lista(caja);
    const otra = q<HTMLDetailsElement>(caja, "details.gan-otra");
    expect(otra.hidden).toBe(false);
    expect(otra.open).toBe(false);
    expect(otra.querySelector("summary")?.textContent).toBe("Pagar desde otra billetera");
    expect(otra.querySelector<HTMLInputElement>("input")?.value).toBe("");
    expect(otra.querySelector("button")?.textContent).toBe("Armar el pago");
  });

  it("arma el pago de la cuenta elegida, listo para copiar y aprobarlo afuera, y el panel reconoce esa cuenta", async () => {
    const dep = armar();
    const { caja, pagadoras } = abrir(dep);
    await lista(caja);
    q<HTMLInputElement>(caja, "details.gan-otra input").value = PAGA;
    q<HTMLButtonElement>(caja, "details.gan-otra button").click();
    const aviso = "Copiá el pago y aprobalo con la cuenta que va a pagar, en tu otra billetera. Después tocá Actualizar.";
    await vi.waitFor(() => expect(mensaje(caja)).toBe(aviso));
    const afuera = q<HTMLDetailsElement>(caja, "details.gan-afuera");
    expect(afuera.open).toBe(true);
    expect(afuera.querySelector("textarea")?.value).toBe(XDR);
    expect(dep.preparar.mock.calls[0]?.[0]).toMatchObject({ origen: PAGA, destino: GANA, monto: "50.0000000" });
    expect(dep.pagar).not.toHaveBeenCalled();
    expect(pagadoras.has(PAGA)).toBe(true);
  });

  it("sin cuenta escrita, no arma nada y lo dice", async () => {
    const dep = armar();
    const { caja } = abrir(dep);
    await lista(caja);
    q<HTMLButtonElement>(caja, "details.gan-otra button").click();
    await vi.waitFor(() => expect(mensaje(caja)).toBe("La cuenta que paga no es una dirección válida."));
    expect(dep.preparar).not.toHaveBeenCalled();
    expect(dep.pagar).not.toHaveBeenCalled();
  });

  it("Enter en el campo de la cuenta arma el pago de esa cuenta y no paga con la cuenta que paga sola", async () => {
    const dep = armar();
    const { caja } = abrir(dep);
    await lista(caja);
    const campo = q<HTMLInputElement>(caja, "details.gan-otra input");
    campo.value = PAGA;
    const enter = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    campo.dispatchEvent(enter);
    expect(enter.defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(dep.preparar).toHaveBeenCalledTimes(1));
    expect(dep.preparar.mock.calls[0]?.[0].origen).toBe(PAGA);
    expect(dep.pagar).not.toHaveBeenCalled();
  });
});

describe("un toque antes de saber quién paga", () => {
  it("no paga nada: la pantalla cambia a la de la cuenta que paga sola y la persona confirma lo nuevo", async () => {
    const dep = armar();
    let abrirPuerta: () => void = () => undefined;
    const puerta = new Promise<void>((r) => (abrirPuerta = r));
    const { caja, form } = abrir(dep, { dependencias: async () => puerta.then(() => dep.deps) });
    // La pantalla de siempre, con su campo del monto, hasta saber quién paga.
    expect(principal(caja).textContent).toBe("Firmar y pagar");
    enviar(form);
    abrirPuerta();
    await lista(caja);
    expect(principal(caja).textContent).toBe("Pagar");
    expect(dep.buscar).not.toHaveBeenCalled();
    expect(dep.preparar).not.toHaveBeenCalled();
    expect(dep.pagar).not.toHaveBeenCalled();
    expect(principal(caja).disabled).toBe(false);
    expect(mensaje(caja)).toBe("");
  });
});

describe("en inglés", () => {
  it("el formulario, el saldo y lo que falta cambian de idioma sin perder lo elegido", async () => {
    const dep = armar({ saldo: dolares(100) });
    const { caja } = abrir(dep);
    await lista(caja);
    (botonCon(caja, "Otro monto") as HTMLButtonElement).click();
    (botonCon(caja, "Un dólar más") as HTMLButtonElement).click();
    setLang("en");
    expect(contador(caja)).toBe("51 digital dollars");
    expect(texto(caja, ".gan-explica")).toBe("You pay Equipo Cohete and you'll have 49 digital dollars left.");
    expect(principal(caja).textContent).toBe("Pay");
    expect(botonCon(caja, "One dollar more")).toBeDefined();
    expect(caja.querySelector("details.gan-otra summary")?.textContent).toBe("Pay from another wallet");
  });

  it("si no alcanza, lo dice en inglés con los números como se leen allá", async () => {
    setLang("en");
    const { caja } = abrir(armar({ saldo: dolares(12.5) }));
    await vi.waitFor(() => expect(falta(caja)).toBe("You're 37.5 digital dollars short. You have 12.5."));
    expect(visible(botonCon(caja, "Add digital dollars"))).toBe(true);
  });

  it("lo que se dijo y el botón de cargar cambian de idioma", async () => {
    const dep = armar({ prep: { ok: false, motivo: "origen-sin-linea" } });
    const { caja, form } = abrir(dep);
    await lista(caja);
    enviar(form);
    await vi.waitFor(() => expect(mensaje(caja)).toBe("La cuenta que paga todavía no tiene USDC."));
    setLang("en");
    expect(mensaje(caja)).toBe("The paying account doesn't hold USDC yet.");
    expect(visible(botonCon(caja, "Add digital dollars"))).toBe(true);
  });
});
