import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * El candado de antes de la firma (`submitElsewhere`), con el cobro por uso del modo Oficial: aunque se llegue por otro
 * camino que el de la pantalla, una cuenta de Google o de correo no firma el sello sin acceso y sorteos que alcancen, ni
 * el sorteo sin acceso. Con un portero de mentira (`fetch`) y una red de mentira.
 */

const URL = "https://pm.ejemplo";
const HASH = "cd".repeat(32);
const CUENTA = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";

const h = vi.hoisted(() => ({ red: "mainnet" as "mainnet" | "testnet" }));
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
vi.mock("../stellar/wallet", () => ({ activeWallet: () => ({ submitsItself: true, address: CUENTA, signAndSubmit, signUnsponsored }) }));
vi.mock("../stellar/contract", () => ({ server: { getTransaction, sendTransaction } }));
vi.mock("@stellar/stellar-sdk", () => ({
  TransactionBuilder: {
    fromXDR: () => ({ hash: () => Buffer.from(HASH, "hex"), toXDR: () => "XDR_FIRMADO", timeBounds: { maxTime: String(Math.floor(Date.now() / 1000) + 300) } }),
  },
  scValToNative: (v: unknown) => v,
}));

const tx = { toXDR: () => "XDR_SIN_FIRMAR", simulationData: {}, built: { hash: () => Buffer.from(HASH, "hex") }, sign: async () => undefined };
const intento = (numWinners = 1) => ({ organizer: CUENTA, listHash: "aa".repeat(32), round: 1, count: 80, numWinners, meta: "x", desde: 1 });

const responder = (estado: number, cuerpo: unknown): Response => new Response(JSON.stringify(cuerpo), { status: estado, headers: { "Content-Type": "application/json" } });
const cupo = (oficial: unknown, red = "mainnet") => ({ prendido: true, rige: "portero", red, sellos: { usados: 0, max: 100, quedan: 50 }, sorteos: { usados: 0, max: 100, quedan: 100 }, liberaEn: Date.UTC(2026, 11, 1), ...(oficial === undefined ? {} : { oficial }) });
const conSorteos = (quedan: number) => ({ acceso: true, sorteos: { quedan, proximoVence: null } });

/** Un portero de mentira: `/cupo` dice lo que se le pide y el pago contesta bien. */
function portero(cuerpo: unknown | "caido") {
  const f = vi.fn(async (u: string) => {
    if (String(u).includes("/cupo")) {
      if (cuerpo === "caido") throw new TypeError("Failed to fetch");
      return responder(200, cuerpo);
    }
    return responder(200, { hash: HASH, status: "PENDING" });
  });
  vi.stubGlobal("fetch", f);
  return f;
}

beforeEach(async () => {
  h.red = "mainnet";
  vi.stubEnv("VITE_ALTA", "1");
  vi.stubEnv("VITE_PATROCINIO_URL_MAINNET", URL);
  vi.stubEnv("VITE_PATROCINIO_URL_TESTNET", URL);
  getTransaction.mockReset();
  sendTransaction.mockReset();
  signAndSubmit.mockClear();
  signUnsponsored.mockClear();
  getTransaction.mockResolvedValue({ status: "SUCCESS", latestLedgerCloseTime: 1, returnValue: 7n });
  (await import("../stellar/patrocinador")).olvidarElEstado();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const pagos = (f: ReturnType<typeof portero>) => f.mock.calls.filter((c) => !String(c[0]).includes("/cupo"));

describe("el candado de antes de la firma", () => {
  it("el sello sin sorteos oficiales no se firma: lanza el 402 de siempre", async () => {
    const f = portero(cupo(conSorteos(0)));
    const { submitElsewhere } = await import("./envio-sdk");
    const e = await submitElsewhere(tx as never, () => undefined, 5000, intento()).catch((x: unknown) => x);
    expect(e).toMatchObject({ name: "ErrorPortero", motivo: "sin-sorteos" });
    expect(signUnsponsored).not.toHaveBeenCalled();
    expect(signAndSubmit).not.toHaveBeenCalled();
    expect(pagos(f)).toHaveLength(0);
  });

  it("el sello con 60 ganadores y 1 sorteo tampoco; con 1 ganador sí, y va al portero", async () => {
    const f = portero(cupo(conSorteos(1)));
    const { submitElsewhere } = await import("./envio-sdk");
    expect(await submitElsewhere(tx as never, () => undefined, 5000, intento(60)).catch((x: unknown) => x)).toMatchObject({ motivo: "sin-sorteos" });
    expect(signUnsponsored).not.toHaveBeenCalled();
    const r = await submitElsewhere(tx as never, () => undefined, 5000, intento(1));
    expect(r?.hash).toBe(HASH);
    expect(signUnsponsored).toHaveBeenCalledTimes(1);
    expect(pagos(f)).toHaveLength(1);
  });

  it("sin acceso no se firma ni el sello ni el sorteo", async () => {
    portero(cupo({ acceso: false }));
    const { submitElsewhere } = await import("./envio-sdk");
    for (const i of [intento(), undefined]) {
      const e = await submitElsewhere(tx as never, () => undefined, 5000, i).catch((x: unknown) => x);
      expect(e).toMatchObject({ name: "ErrorPortero", motivo: "sin-alta" });
    }
    expect(signUnsponsored).not.toHaveBeenCalled();
    expect(signAndSubmit).not.toHaveBeenCalled();
  });

  it("el sorteo con acceso y sin sorteos oficiales se firma: sortear lo sellado no los gasta", async () => {
    portero(cupo(conSorteos(0)));
    const { submitElsewhere } = await import("./envio-sdk");
    const r = await submitElsewhere(tx as never, () => undefined, 5000, undefined);
    expect(r?.hash).toBe(HASH);
    expect(signUnsponsored).toHaveBeenCalledTimes(1);
  });

  it("sin respuesta de /cupo, o sin lo oficial, no se firma nada", async () => {
    for (const cuerpo of ["caido", cupo(undefined)] as const) {
      (await import("../stellar/patrocinador")).olvidarElEstado();
      portero(cuerpo);
      const { submitElsewhere } = await import("./envio-sdk");
      const e = await submitElsewhere(tx as never, () => undefined, 5000, intento()).catch((x: unknown) => x);
      expect(e, JSON.stringify(cuerpo)).toMatchObject({ name: "ErrorPortero", motivo: "cerrado" });
    }
    expect(signUnsponsored).not.toHaveBeenCalled();
    expect(signAndSubmit).not.toHaveBeenCalled();
  });

  it("en Prueba, con la bandera puesta, el sello firma como hoy aunque /cupo no traiga lo oficial", async () => {
    h.red = "testnet";
    portero(cupo(undefined, "testnet"));
    const { submitElsewhere } = await import("./envio-sdk");
    const r = await submitElsewhere(tx as never, () => undefined, 5000, intento());
    expect(r?.hash).toBe(HASH);
    expect(signUnsponsored).toHaveBeenCalledTimes(1);
  });

  it("con la bandera apagada y /cupo sin lo oficial, tampoco: sin el acceso confirmado no se firma", async () => {
    vi.stubEnv("VITE_ALTA", "");
    portero(cupo(undefined));
    const { submitElsewhere } = await import("./envio-sdk");
    for (const i of [intento(), undefined]) {
      const e = await submitElsewhere(tx as never, () => undefined, 5000, i).catch((x: unknown) => x);
      expect(e).toMatchObject({ name: "ErrorPortero", motivo: "cerrado" });
    }
    expect(signUnsponsored).not.toHaveBeenCalled();
    expect(signAndSubmit).not.toHaveBeenCalled();
  });
});

describe("el candado con el cobro por uso apagado", () => {
  // Sin VITE_ALTA la compuerta de la pantalla no corre: el candado es lo único entre el botón y la firma. El portero de la
  // red principal manda lo oficial igual (con las altas prendidas del lado del servidor), y el sitio lo obedece.
  for (const banderas of [{ VITE_ALTA: "" }, { VITE_ALTA: "", VITE_ALTA_LIBRE: "1" }, { VITE_ALTA: "0", VITE_ALTA_LIBRE: "0" }]) {
    const nombre = JSON.stringify(banderas);
    it(`${nombre}: sin acceso no se firma ni el sello ni el sorteo`, async () => {
      for (const [k, v] of Object.entries(banderas)) vi.stubEnv(k, v);
      const f = portero(cupo({ acceso: false }));
      const { submitElsewhere } = await import("./envio-sdk");
      for (const i of [intento(), undefined]) {
        const e = await submitElsewhere(tx as never, () => undefined, 5000, i).catch((x: unknown) => x);
        expect(e, nombre).toMatchObject({ name: "ErrorPortero", motivo: "sin-alta" });
      }
      expect(signUnsponsored).not.toHaveBeenCalled();
      expect(signAndSubmit).not.toHaveBeenCalled();
      expect(pagos(f)).toHaveLength(0);
    });

    it(`${nombre}: sin sorteos oficiales el sello no se firma`, async () => {
      for (const [k, v] of Object.entries(banderas)) vi.stubEnv(k, v);
      portero(cupo(conSorteos(0)));
      const { submitElsewhere } = await import("./envio-sdk");
      expect(await submitElsewhere(tx as never, () => undefined, 5000, intento()).catch((x: unknown) => x)).toMatchObject({ motivo: "sin-sorteos" });
      expect(signUnsponsored).not.toHaveBeenCalled();
    });

    it(`${nombre}: con acceso y sorteos, se firma como siempre`, async () => {
      for (const [k, v] of Object.entries(banderas)) vi.stubEnv(k, v);
      portero(cupo(conSorteos(3)));
      const { submitElsewhere } = await import("./envio-sdk");
      const r = await submitElsewhere(tx as never, () => undefined, 5000, intento());
      expect(r?.hash).toBe(HASH);
      expect(signUnsponsored).toHaveBeenCalledTimes(1);
    });
  }
});
