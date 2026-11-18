import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * La puerta del premio (`wallet-pollar.ts`) lanza antes de firmar. Lo que hace `submitElsewhere` con ese error: sale tal
 * cual, nunca como un sello incierto (que dispararía la averiguación de un sello que nunca se mandó), y no se le manda
 * nada al portero. Con la billetera y el portero de mentira, y la forma del error igual a la de `PremioGuardado`: se
 * reconoce por el nombre, no por la clase.
 */

const URL = "https://pm.ejemplo";
const HASH = "cd".repeat(32);
const CUENTA = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";

const premio = (que: "puede-guardar" | "no-se-sabe"): Error => Object.assign(new Error(que === "puede-guardar" ? "premio-guardado" : "premio-sin-saber"), { name: "PremioGuardado", que });

const getTransaction = vi.fn();
const sendTransaction = vi.fn();
vi.mock("../stellar/config", async (orig) => {
  const real = await orig<typeof import("../stellar/config")>();
  return {
    ...real,
    get network() {
      return { ...real.network, name: "mainnet" as const };
    },
  };
});
const signAndSubmit = vi.fn(async (_xdr: string, _antes?: () => void) => HASH);
const signUnsponsored = vi.fn(async (_xdr: string) => "XDR_FIRMADO");

vi.mock("../stellar/wallet", () => ({ activeWallet: () => ({ submitsItself: true, address: CUENTA, signAndSubmit, signUnsponsored }) }));
vi.mock("../stellar/contract", () => ({ server: { getTransaction, sendTransaction } }));
vi.mock("@stellar/stellar-sdk", () => ({
  TransactionBuilder: {
    fromXDR: () => ({ hash: () => Buffer.from(HASH, "hex"), toXDR: () => "XDR_FIRMADO", timeBounds: { maxTime: String(Math.floor(Date.now() / 1000) + 300) } }),
  },
  scValToNative: (v: unknown) => v,
}));

const tx = { toXDR: () => "XDR_SIN_FIRMAR", simulationData: {}, built: { hash: () => Buffer.from(HASH, "hex") }, sign: async () => undefined };
const intento = { organizer: CUENTA, listHash: "aa".repeat(32), round: 1, count: 80, numWinners: 1, meta: "x", desde: 1 };

const responder = (estado: number, cuerpo: unknown): Response => new Response(JSON.stringify(cuerpo), { status: estado, headers: { "Content-Type": "application/json" } });
/** Lo que dice `/cupo` en la red principal: con acceso y sorteos oficiales, y quién paga la comisión. */
const cupo = (rige: "portero" | "pollar") => ({
  prendido: true,
  rige,
  red: "mainnet",
  sellos: { usados: 0, max: 100, quedan: 50 },
  sorteos: { usados: 0, max: 100, quedan: 100 },
  liberaEn: Date.UTC(2026, 11, 1),
  oficial: { acceso: true, sorteos: { quedan: 5, proximoVence: null } },
});

/** Un portero de mentira: `/cupo` dice quién rige, y cualquier otro pedido es un pago al portero. */
function portero(rige: "portero" | "pollar") {
  const f = vi.fn(async (u: string) => (String(u).includes("/cupo") ? responder(200, cupo(rige)) : responder(200, { hash: HASH, status: "PENDING" })));
  vi.stubGlobal("fetch", f);
  return f;
}
const pagos = (f: ReturnType<typeof portero>) => f.mock.calls.filter((c) => !String(c[0]).includes("/cupo"));

beforeEach(async () => {
  vi.stubEnv("VITE_ALTA", "1");
  vi.stubEnv("VITE_PATROCINIO_URL_MAINNET", URL);
  vi.stubEnv("VITE_PATROCINIO_URL_TESTNET", URL);
  getTransaction.mockReset();
  sendTransaction.mockReset();
  signAndSubmit.mockReset();
  signUnsponsored.mockReset();
  signAndSubmit.mockResolvedValue(HASH);
  signUnsponsored.mockResolvedValue("XDR_FIRMADO");
  (await import("../stellar/patrocinador")).olvidarElEstado();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("con el patrocinio del proveedor", () => {
  for (const que of ["puede-guardar", "no-se-sabe"] as const) {
    it(`un sello frenado por la puerta (${que}) sale tal cual y no como un sello incierto`, async () => {
      portero("pollar");
      const e = premio(que);
      signAndSubmit.mockRejectedValue(e);
      const { submitElsewhere } = await import("./envio-sdk");
      const salio = await submitElsewhere(tx as never, () => undefined, 5000, intento).catch((x: unknown) => x);
      expect(salio).toBe(e);
      expect((salio as Error).name).not.toBe("SelloIncierto");
      expect(signAndSubmit).toHaveBeenCalledTimes(1);
      // Nada de averiguar un sello que nunca se mandó.
      expect(getTransaction).not.toHaveBeenCalled();
      expect(sendTransaction).not.toHaveBeenCalled();
    });
  }

  it("le pasa a la billetera el control del margen para que corra tras la puerta, antes de firmar", async () => {
    portero("pollar");
    const margen = vi.fn();
    const { submitElsewhere } = await import("./envio-sdk");
    await submitElsewhere(tx as never, () => undefined, 5000, intento, { antesDeFirmar: margen }).catch(() => undefined);
    expect(signAndSubmit).toHaveBeenCalledTimes(1);
    expect(signAndSubmit.mock.calls[0]?.[1]).toBe(margen);
  });

  it("un sello al que la puerta le dejó sin margen sale tal cual como RondaMuyCerca y no como incierto", async () => {
    portero("pollar");
    const e = Object.assign(new Error("la ronda quedó cerca antes de mandar el sello (faltan 20 s): Error(Contract, #5)"), { name: "RondaMuyCerca" });
    signAndSubmit.mockRejectedValue(e);
    const { submitElsewhere } = await import("./envio-sdk");
    const salio = await submitElsewhere(tx as never, () => undefined, 5000, intento, { antesDeFirmar: () => undefined }).catch((x: unknown) => x);
    expect(salio).toBe(e);
    expect(getTransaction).not.toHaveBeenCalled();
  });

  it("un sorteo (sin intento) sale tal cual", async () => {
    portero("pollar");
    const e = premio("puede-guardar");
    signAndSubmit.mockRejectedValue(e);
    const { submitElsewhere } = await import("./envio-sdk");
    expect(await submitElsewhere(tx as never, () => undefined, 5000, undefined).catch((x: unknown) => x)).toBe(e);
    expect(getTransaction).not.toHaveBeenCalled();
  });
});

describe("con el portero", () => {
  it("si la billetera no firma, sale el mismo error y no se le manda nada al portero", async () => {
    const f = portero("portero");
    const e = premio("puede-guardar");
    signUnsponsored.mockRejectedValue(e);
    const { submitElsewhere } = await import("./envio-sdk");
    const salio = await submitElsewhere(tx as never, () => undefined, 5000, intento).catch((x: unknown) => x);
    expect(salio).toBe(e);
    expect(signUnsponsored).toHaveBeenCalledTimes(1);
    expect(pagos(f)).toHaveLength(0);
    expect(sendTransaction).not.toHaveBeenCalled();
    expect(getTransaction).not.toHaveBeenCalled();
  });

  it("un sorteo (sin intento) también sale tal cual", async () => {
    const f = portero("portero");
    const e = premio("no-se-sabe");
    signUnsponsored.mockRejectedValue(e);
    const { submitElsewhere } = await import("./envio-sdk");
    expect(await submitElsewhere(tx as never, () => undefined, 5000, undefined).catch((x: unknown) => x)).toBe(e);
    expect(pagos(f)).toHaveLength(0);
  });
});
