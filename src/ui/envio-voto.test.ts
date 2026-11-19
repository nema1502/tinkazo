import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { errorKey } from "../stellar/errores";

/**
 * El voto por contenido en `submitElsewhere` (issue 180), por el camino del portero: con la billetera que vota a mano, sin
 * la armada no se pide la firma, lo firmado tiene que tener el hash de la armada, y lo que no se sabe cómo terminó sale
 * como un sello incierto con el hash de la armada, para averiguarlo en la red antes de armar otro. Sin el voto a mano,
 * todo como siempre. Con un portero, una billetera y una red de mentira.
 */

const URL = "http://127.0.0.1:8794";
const HASH = "cd".repeat(32);
const OTRO_HASH = "ef".repeat(32);
const CUENTA = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";

const h = vi.hoisted(() => ({ hashFirmada: "", votaPorContenido: true as boolean | undefined }));

const getTransaction = vi.fn();
const sendTransaction = vi.fn();
const signAndSubmit = vi.fn(async () => HASH);
const signUnsponsored = vi.fn(async (_xdr: string) => "XDR_FIRMADO");

vi.mock("../stellar/wallet", () => ({
  activeWallet: () => ({
    submitsItself: true,
    address: CUENTA,
    signAndSubmit,
    signUnsponsored,
    ...(h.votaPorContenido === undefined ? {} : { votaPorContenido: () => h.votaPorContenido === true }),
  }),
}));
vi.mock("../stellar/contract", () => ({ server: { getTransaction, sendTransaction } }));
vi.mock("@stellar/stellar-sdk", () => ({
  TransactionBuilder: {
    fromXDR: () => ({
      hash: () => Buffer.from(h.hashFirmada, "hex"),
      toXDR: () => "XDR_FIRMADO",
      timeBounds: { maxTime: String(Math.floor(Date.now() / 1000) + 300) },
    }),
  },
  scValToNative: (v: unknown) => v,
}));

const conArmada = { toXDR: () => "XDR_SIN_FIRMAR", simulationData: {}, built: { hash: () => Buffer.from(HASH, "hex") }, sign: async () => undefined };
const sinArmada = { toXDR: () => "XDR_SIN_FIRMAR", simulationData: {}, sign: async () => undefined };
const intento = { organizer: CUENTA, listHash: "aa".repeat(32), round: 1, count: 3, numWinners: 1, meta: "x", desde: 1 };

const responder = (estado: number, cuerpo: unknown): Response =>
  new Response(JSON.stringify(cuerpo), { status: estado, headers: { "Content-Type": "application/json" } });
const cupo = {
  prendido: true,
  rige: "portero",
  sellos: { usados: 1, max: 20, quedan: 19 },
  sorteos: { usados: 1, max: 40, quedan: 39 },
  liberaEn: Date.UTC(2026, 11, 1),
};

/** Un portero de mentira: `/cupo` dice que rige el portero y el pago lo toma. */
function portero(): ReturnType<typeof vi.fn> {
  const f = vi.fn(async (u: string) => (String(u).includes("/cupo") ? responder(200, cupo) : responder(200, { hash: HASH, status: "PENDING" })));
  vi.stubGlobal("fetch", f);
  return f;
}
const pagos = (f: ReturnType<typeof vi.fn>): unknown[][] => f.mock.calls.filter((c) => !String(c[0]).includes("/cupo"));

async function falla(p: Promise<unknown>): Promise<Error> {
  const r = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(r, "tendría que haber fallado").toBeInstanceOf(Error);
  return r as Error;
}

beforeEach(async () => {
  vi.stubEnv("VITE_PATROCINIO_URL_TESTNET", URL);
  h.hashFirmada = HASH;
  h.votaPorContenido = true;
  getTransaction.mockReset();
  sendTransaction.mockReset();
  signAndSubmit.mockClear();
  signUnsponsored.mockReset();
  signUnsponsored.mockResolvedValue("XDR_FIRMADO");
  getTransaction.mockResolvedValue({ status: "SUCCESS", latestLedgerCloseTime: 1, returnValue: 7n });
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  (await import("../stellar/patrocinador")).olvidarElEstado();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("submitElsewhere por el portero, con el voto por contenido", () => {
  it("con lo firmado igual a la armada, el portero manda como siempre", async () => {
    const f = portero();
    const { submitElsewhere } = await import("./envio-sdk");
    await expect(submitElsewhere(conArmada as never, () => undefined, 5000, intento)).resolves.toEqual({ hash: HASH, value: 7n });
    expect(signUnsponsored).toHaveBeenCalledWith("XDR_SIN_FIRMAR");
    expect(pagos(f)).toHaveLength(1);
  });

  it("sin la armada no se pide la firma: cofirmaDistinta, antes de pedir nada", async () => {
    const f = portero();
    const { submitElsewhere } = await import("./envio-sdk");
    const e = await falla(submitElsewhere(sinArmada as never, () => undefined, 5000, intento));
    expect(errorKey(e)).toBe("cofirmaDistinta");
    expect(signUnsponsored).not.toHaveBeenCalled();
    expect(pagos(f)).toEqual([]);
  });

  it("lo firmado con otro hash es un sello incierto con el hash de la armada, y no llega al portero", async () => {
    const f = portero();
    h.hashFirmada = OTRO_HASH;
    const { submitElsewhere } = await import("./envio-sdk");
    const e = await falla(submitElsewhere(conArmada as never, () => undefined, 5000, intento));
    expect(e.name).toBe("SelloIncierto");
    expect((e as Error & { intento: { hash?: string } }).intento.hash).toBe(HASH);
    expect(errorKey(e)).toBe("unconfirmed");
    expect(pagos(f)).toEqual([]);
  });

  it("en el sorteo, lo firmado con otro hash sale como pendiente, que no es un no", async () => {
    portero();
    h.hashFirmada = OTRO_HASH;
    const { submitElsewhere } = await import("./envio-sdk");
    const e = await falla(submitElsewhere(conArmada as never, () => undefined, 5000));
    expect(e.message).toBe("pollar-pending");
    expect(errorKey(e)).toBe("unconfirmed");
  });

  it("un pollar-pending de la firma con intento es un sello incierto con el hash de la armada", async () => {
    portero();
    signUnsponsored.mockRejectedValue(new Error("pollar-pending"));
    const { submitElsewhere } = await import("./envio-sdk");
    const e = await falla(submitElsewhere(conArmada as never, () => undefined, 5000, intento));
    expect(e.name).toBe("SelloIncierto");
    expect((e as Error & { intento: { hash?: string } }).intento.hash).toBe(HASH);
  });

  it("una negativa de la regla en la firma sale tal cual: es un no de verdad", async () => {
    portero();
    signUnsponsored.mockRejectedValue(new Error("tinkazo-cofirma-distinta"));
    const { submitElsewhere } = await import("./envio-sdk");
    const e = await falla(submitElsewhere(conArmada as never, () => undefined, 5000, intento));
    expect(e.name).not.toBe("SelloIncierto");
    expect(errorKey(e)).toBe("cofirmaDistinta");
  });
});

describe("submitElsewhere por el portero, sin el voto por contenido, como siempre", () => {
  it("un pollar-pending de la firma sale tal cual, sin sello incierto", async () => {
    h.votaPorContenido = false;
    portero();
    signUnsponsored.mockRejectedValue(new Error("pollar-pending"));
    const { submitElsewhere } = await import("./envio-sdk");
    const e = await falla(submitElsewhere(conArmada as never, () => undefined, 5000, intento));
    expect(e.name).not.toBe("SelloIncierto");
    expect(e.message).toBe("pollar-pending");
  });

  it("sin la armada se pide la firma igual", async () => {
    h.votaPorContenido = undefined;
    portero();
    const { submitElsewhere } = await import("./envio-sdk");
    await submitElsewhere(sinArmada as never, () => undefined, 5000, intento);
    expect(signUnsponsored).toHaveBeenCalledTimes(1);
  });

  it("lo firmado no se compara con la armada", async () => {
    h.votaPorContenido = false;
    h.hashFirmada = OTRO_HASH;
    portero();
    const { submitElsewhere } = await import("./envio-sdk");
    await expect(submitElsewhere(conArmada as never, () => undefined, 5000, intento)).resolves.toMatchObject({ hash: HASH });
  });
});
