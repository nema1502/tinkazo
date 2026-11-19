import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CasoRed, Diagnostico, Nivel } from "../stellar/chequeo-red";
import { cobroPorUso, redPrincipalConPollar } from "../stellar/cobro-oficial";
import { ErrorPortero } from "../stellar/patrocinador";
import { type ContextoDelPanel, panelDe, respuestaDelBoton } from "./red-acciones";

/**
 * Sin «pagar con mi cuenta» en la red principal con una cuenta de Google o de correo (Pollar), con o sin `VITE_ALTA`:
 * ninguna fila de la caja de la red ofrece sellar pagando con la cuenta, el sorteo no ofrece «Sortear pagando con mi
 * cuenta» y `submitElsewhere` con `pagarConMiCuenta` se corta sin pedir la firma. La frase del acceso al modo Oficial,
 * en cambio, es solo con el cobro por uso (`VITE_ALTA=1`). Con Freighter y en Prueba, todo sigue como hoy.
 */

const h = vi.hoisted(() => ({
  red: "mainnet" as "mainnet" | "testnet",
  billetera: null as unknown,
  sesion: { address: "GAAA" } as { address: string } | null,
  grifo: false,
  saldo: 50,
}));

const HASH = "cd".repeat(32);
const getTransaction = vi.fn();
const sendTransaction = vi.fn();
const signAndSubmit = vi.fn(async () => HASH);
const signUnsponsored = vi.fn(async (_xdr: string) => "XDR_FIRMADO");

vi.mock("../stellar/config", async (orig) => {
  const real = await orig<typeof import("../stellar/config")>();
  return {
    ...real,
    get network() {
      return { ...real.network, name: h.red };
    },
  };
});
vi.mock("../stellar/wallet", () => ({ activeWallet: () => h.billetera }));
vi.mock("../stellar/wallet-lite", async (orig) => ({ ...(await orig<typeof import("../stellar/wallet-lite")>()), activeWallet: () => h.billetera, xlmBalance: async () => h.saldo }));
vi.mock("../stellar/contract", () => ({ server: { getTransaction, sendTransaction } }));
vi.mock("../stellar/grifo", () => ({ grifoDisponible: () => h.grifo }));
vi.mock("./wallet-ui", () => ({ currentSession: () => h.sesion }));
vi.mock("@stellar/stellar-sdk", () => ({
  TransactionBuilder: {
    fromXDR: () => ({ hash: () => Buffer.from(HASH, "hex"), toXDR: () => "XDR_FIRMADO", timeBounds: { maxTime: String(Math.floor(Date.now() / 1000) + 300) } }),
  },
  scValToNative: (v: unknown) => v,
}));

const pollar = () => ({ submitsItself: true, address: "GAAA", signAndSubmit, signUnsponsored });
const freighter = () => ({ kind: "external", address: "GAAA" });

beforeEach(() => {
  h.red = "mainnet";
  h.billetera = pollar();
  h.sesion = { address: "GAAA" };
  h.grifo = false;
  h.saldo = 50;
  getTransaction.mockReset();
  sendTransaction.mockReset();
  signAndSubmit.mockClear();
  signUnsponsored.mockClear();
  getTransaction.mockResolvedValue({ status: "SUCCESS", latestLedgerCloseTime: 1, returnValue: 7n });
  sendTransaction.mockResolvedValue({ status: "PENDING" });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("cuándo rige el cobro por uso", () => {
  const env = { VITE_ALTA: "1" };
  it("solo en la red principal, con una cuenta de Pollar y con VITE_ALTA=1", () => {
    expect(cobroPorUso({ red: "mainnet", billetera: pollar(), env })).toBe(true);
    expect(cobroPorUso({ red: "testnet", billetera: pollar(), env })).toBe(false);
    expect(cobroPorUso({ red: "mainnet", billetera: freighter(), env })).toBe(false);
    expect(cobroPorUso({ red: "mainnet", billetera: null, env })).toBe(false);
    expect(cobroPorUso({ red: "mainnet", billetera: pollar(), env: {} })).toBe(false);
    expect(cobroPorUso({ red: "mainnet", billetera: pollar(), env: { VITE_ALTA: "0" } })).toBe(false);
  });

  it("con la bandera a medio poner (sin la dirección del portero) rige igual: cerrado ante la duda", () => {
    expect(cobroPorUso({ red: "mainnet", billetera: pollar(), env: { VITE_ALTA: "1", VITE_PATROCINIO_URL_MAINNET: "" } })).toBe(true);
  });

  it("con el build de hoy (sin VITE_ALTA) no rige", () => {
    expect(cobroPorUso()).toBe(false);
  });
});

describe("cuándo no existe «pagar con mi cuenta»", () => {
  it("en la red principal con una cuenta de Pollar, con la bandera puesta, apagada o a medio poner", () => {
    for (const env of [{}, { VITE_ALTA: "0" }, { VITE_ALTA: "1" }, { VITE_ALTA: "1", VITE_PATROCINIO_URL_MAINNET: "" }]) expect(redPrincipalConPollar({ red: "mainnet", billetera: pollar(), env }), JSON.stringify(env)).toBe(true);
    // Con el build de hoy, sin pasar nada: la red principal de mentira y la cuenta de Pollar.
    expect(redPrincipalConPollar()).toBe(true);
  });

  it("con Freighter, en Prueba o sin cuenta, existe como hoy", () => {
    expect(redPrincipalConPollar({ red: "testnet", billetera: pollar() })).toBe(false);
    expect(redPrincipalConPollar({ red: "mainnet", billetera: freighter() })).toBe(false);
    expect(redPrincipalConPollar({ red: "mainnet", billetera: null })).toBe(false);
  });
});

/* -------------------------------------------------------------- la caja de la red */

const diag = (caso: CasoRed, nivel: Nivel, o: Partial<Diagnostico> = {}): Diagnostico => ({
  nivel,
  caso,
  casos: [{ caso, nivel }],
  red: "mainnet",
  rpc: "https://rpc",
  pagador: "patrocinado",
  costoXlm: 5,
  rojoXlm: 0.33,
  ms: 300,
  ledger: 1,
  protocolo: 29,
  inclusionP90: 100,
  saldoXlm: null,
  restaurar: false,
  sinInternet: false,
  sinChequeo: false,
  motivo: "ok",
  hora: 0,
  ...o,
});

const CASOS: CasoRed[] = ["costo-alto", "rpc-caido", "saturada", "sin-saldo", "protocolo", "sin-patrocinio"];
const PATROCINIOS = [undefined, { motivo: "cerrado" as const }, { motivo: "fondo" as const }, { motivo: "ajena" as const }, { motivo: "cupo-cuenta" as const, que: "sellos" as const }];

/** Todas las filas: cada caso, en los dos niveles, con cada motivo del portero, con y sin saldo, con y sin grifo. */
function filas(red: "mainnet" | "testnet", sinPagoPropio: boolean | undefined) {
  const out: { d: Diagnostico; c: ContextoDelPanel }[] = [];
  for (const caso of CASOS)
    for (const nivel of ["amarillo", "rojo"] as const)
      for (const patrocinio of PATROCINIOS)
        for (const saldoXlm of [null, 0, 1_000])
          for (const grifo of [false, true])
            for (const intentos of [0, 5])
              for (const pagador of ["patrocinado", "propio"] as const)
                out.push({
                  d: diag(caso, nivel, { red, pagador, ...(patrocinio ? { patrocinio } : {}) }),
                  c: { red, intentos, grifo, saldoXlm, costoXlm: 0.2, ...(sinPagoPropio === undefined ? {} : { sinPagoPropio }) },
                });
  return out;
}

describe("la caja de la red, sin pagar con mi cuenta", () => {
  it("en la red principal con Pollar, ninguna fila tiene «Sellar pagando con mi cuenta», ni de principal ni de secundaria", () => {
    const todas = filas("mainnet", true);
    expect(todas.length).toBeGreaterThan(1_000);
    for (const { d, c } of todas) {
      const p = panelDe(d, c);
      expect(p.principal, JSON.stringify({ d: d.caso, n: d.nivel, c })).not.toBe("sellar-con-mi-cuenta");
      expect(p.secundarias).not.toContain("sellar-con-mi-cuenta");
      expect(p.cargaPrevia).toBe(false);
    }
  });

  it("con el cobro por uso, una cuenta que el portero no cubre oye que todavía no tiene acceso al modo Oficial", () => {
    const p = panelDe(diag("sin-patrocinio", "rojo", { patrocinio: { motivo: "ajena" } }), { red: "mainnet", intentos: 0, grifo: false, saldoXlm: 1_000, costoXlm: 0.2, sinPagoPropio: true, cobroPorUso: true });
    expect(p.frase).toBe("errAnchor.porteroSinAlta");
    // Hay otra cosa que hacer antes que seguir sin sello (docs/ux.md): usar un cupón, que abre el paso de la cuenta.
    expect(p.principal).toBe("usar-cupon");
    expect(p.secundarias).toEqual(["seguir-sin-sello"]);
    expect(respuestaDelBoton(diag("sin-patrocinio", "rojo"), p).clave).toBe("errAnchor.porteroSinAlta");
  });

  it("«Usar un cupón» solo aparece con el cobro por uso y una cuenta sin acceso: en Prueba, con Freighter o con la bandera apagada, nunca", () => {
    for (const sinPagoPropio of [true, false, undefined])
      for (const red of ["mainnet", "testnet"] as const) {
        for (const { d, c } of filas(red, sinPagoPropio)) {
          const p = panelDe(d, c);
          expect(p.principal).not.toBe("usar-cupon");
          expect(p.secundarias).not.toContain("usar-cupon");
        }
      }
    for (const patrocinio of [{ motivo: "cerrado" as const }, { motivo: "fondo" as const }, { motivo: "cupo-cuenta" as const, que: "sellos" as const }]) {
      const p = panelDe(diag("sin-patrocinio", "rojo", { patrocinio }), { red: "mainnet", intentos: 0, grifo: false, saldoXlm: null, costoXlm: 0.2, sinPagoPropio: true, cobroPorUso: true });
      expect(p.principal).not.toBe("usar-cupon");
    }
  });

  it("con la bandera apagada, la misma cuenta oye la frase de siempre, sin «podés sellar pagando con tu cuenta»", () => {
    const p = panelDe(diag("sin-patrocinio", "rojo", { patrocinio: { motivo: "ajena" } }), { red: "mainnet", intentos: 0, grifo: false, saldoXlm: 1_000, costoXlm: 0.2, sinPagoPropio: true });
    expect(p.frase).toBe("errAnchor.porteroAjena");
    expect(p.principal).toBe("seguir-sin-sello");
    expect(p.secundarias).not.toContain("sellar-con-mi-cuenta");
  });

  it("con Freighter o en Prueba (sin la marca), las filas son las de hoy y la acción sigue estando", () => {
    for (const red of ["mainnet", "testnet"] as const) {
      const sinBandera = filas(red, undefined).map(({ d, c }) => panelDe(d, c));
      const conFalso = filas(red, false).map(({ d, c }) => panelDe(d, c));
      expect(conFalso).toEqual(sinBandera);
      expect(sinBandera.some((p) => p.principal === "sellar-con-mi-cuenta" || p.secundarias.includes("sellar-con-mi-cuenta"))).toBe(true);
    }
  });
});

/* ------------------------------------------------------------------- el sorteo */

describe("«Sortear pagando con mi cuenta»", () => {
  const sinCupo = () => new ErrorPortero("cupo-cuenta", 429, { que: "sorteos" });

  it("con el cobro por uso no se ofrece, aunque la cuenta tenga saldo", async () => {
    vi.stubEnv("VITE_ALTA", "1");
    const { sePuedeSortearPagando } = await import("./sortear-propio");
    expect(await sePuedeSortearPagando(sinCupo())).toBe(false);
  });

  it("en la red principal con la bandera apagada tampoco se ofrece, aunque la cuenta tenga saldo", async () => {
    const { sePuedeSortearPagando } = await import("./sortear-propio");
    h.saldo = 1_000;
    expect(await sePuedeSortearPagando(sinCupo())).toBe(false);
  });

  it("con Freighter y en Prueba, como hoy, aunque la bandera esté puesta", async () => {
    vi.stubEnv("VITE_ALTA", "1");
    const { sePuedeSortearPagando } = await import("./sortear-propio");
    h.billetera = freighter();
    expect(await sePuedeSortearPagando(sinCupo())).toBe(true);
    h.billetera = pollar();
    h.red = "testnet";
    h.grifo = true;
    expect(await sePuedeSortearPagando(sinCupo())).toBe(true);
  });
});

/* -------------------------------------------------------------- el candado */

const tx = { toXDR: () => "XDR_SIN_FIRMAR", simulationData: {}, built: { hash: () => Buffer.from(HASH, "hex") }, sign: async () => undefined };
const intento = { organizer: "GAAA", listHash: "aa".repeat(32), round: 1, count: 3, numWinners: 1, meta: "x", desde: 1 };

describe("el candado de submitElsewhere", () => {
  it("con el cobro por uso, pagar con mi cuenta lanza «cerrado» sin pedir la firma ni mandar nada", async () => {
    vi.stubEnv("VITE_ALTA", "1");
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    const { submitElsewhere } = await import("./envio-sdk");
    for (const i of [intento, undefined]) {
      const e = await submitElsewhere(tx as never, () => undefined, 5000, i, { pagarConMiCuenta: true }).catch((x: unknown) => x);
      expect(e).toBeInstanceOf(ErrorPortero);
      expect((e as ErrorPortero).motivo).toBe("cerrado");
    }
    expect(signUnsponsored).not.toHaveBeenCalled();
    expect(signAndSubmit).not.toHaveBeenCalled();
    expect(sendTransaction).not.toHaveBeenCalled();
    expect(f).not.toHaveBeenCalled();
  });

  it("con la bandera apagada, en la red principal, pagar con mi cuenta también lanza «cerrado» sin pedir la firma", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    const { submitElsewhere } = await import("./envio-sdk");
    for (const i of [intento, undefined]) {
      const e = await submitElsewhere(tx as never, () => undefined, 5000, i, { pagarConMiCuenta: true }).catch((x: unknown) => x);
      expect(e).toBeInstanceOf(ErrorPortero);
      expect((e as ErrorPortero).motivo).toBe("cerrado");
    }
    expect(signUnsponsored).not.toHaveBeenCalled();
    expect(signAndSubmit).not.toHaveBeenCalled();
    expect(sendTransaction).not.toHaveBeenCalled();
    expect(f).not.toHaveBeenCalled();
  });

  it("en Prueba, con la bandera puesta, pagar con mi cuenta firma y manda como hoy", async () => {
    vi.stubEnv("VITE_ALTA", "1");
    h.red = "testnet";
    const { submitElsewhere } = await import("./envio-sdk");
    const r = await submitElsewhere(tx as never, () => undefined, 5000, intento, { pagarConMiCuenta: true });
    expect(r?.hash).toBe(HASH);
    expect(signUnsponsored).toHaveBeenCalled();
  });

  it("con Freighter no es asunto de esta capa: devuelve null y firma la de siempre", async () => {
    vi.stubEnv("VITE_ALTA", "1");
    h.billetera = freighter();
    const { submitElsewhere } = await import("./envio-sdk");
    expect(await submitElsewhere(tx as never, () => undefined, 5000, intento, { pagarConMiCuenta: true })).toBeNull();
    expect(signUnsponsored).not.toHaveBeenCalled();
  });
});
