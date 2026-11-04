import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `submitElsewhere` con el portero del patrocinio: Pollar firma sin patrocinio, la transacción firmada va al
 * portero y el hash que se consulta es el de la transacción interna. Con un portero de mentira (`fetch`) y una
 * red de mentira, sin tocar nada de verdad.
 */

const URL = "http://127.0.0.1:8794";
const HASH = "cd".repeat(32);
const CUENTA = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";

const getTransaction = vi.fn();
const sendTransaction = vi.fn();
const signAndSubmit = vi.fn(async () => HASH);
const signUnsponsored = vi.fn(async (_xdr: string) => "XDR_FIRMADO");

vi.mock("../stellar/wallet", () => ({
  activeWallet: () => ({ submitsItself: true, address: CUENTA, signAndSubmit, signUnsponsored }),
}));
vi.mock("../stellar/contract", () => ({ server: { getTransaction, sendTransaction } }));
vi.mock("@stellar/stellar-sdk", () => ({
  TransactionBuilder: {
    fromXDR: () => ({ hash: () => Buffer.from(HASH, "hex"), toXDR: () => "XDR_FIRMADO", timeBounds: { maxTime: String(Math.floor(Date.now() / 1000) + 300) } }),
  },
  scValToNative: (v: unknown) => v,
}));

const tx = { toXDR: () => "XDR_SIN_FIRMAR", simulationData: {}, built: { hash: () => Buffer.from(HASH, "hex") }, sign: async () => undefined };
const intento = { organizer: CUENTA, listHash: "aa".repeat(32), round: 1, count: 3, numWinners: 1, meta: "x", desde: 1 };

const responder = (estado: number, cuerpo: unknown): Response => new Response(JSON.stringify(cuerpo), { status: estado, headers: { "Content-Type": "application/json" } });
const cupo = (extra: Record<string, unknown> = {}) => ({ prendido: true, rige: "portero", sellos: { usados: 1, max: 20, quedan: 19 }, sorteos: { usados: 1, max: 40, quedan: 39 }, liberaEn: Date.UTC(2026, 11, 1), ...extra });

/** Un portero de mentira: `/cupo` dice lo que se le pide y el pago contesta lo que se le pide. */
function portero(cupoCuerpo: unknown, pago: () => Response | Promise<Response>) {
  const f = vi.fn(async (u: string) => (String(u).includes("/cupo") ? responder(200, cupoCuerpo) : pago()));
  vi.stubGlobal("fetch", f);
  return f;
}

beforeEach(async () => {
  vi.stubEnv("VITE_PATROCINIO_URL", URL);
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

describe("submitElsewhere con el portero", () => {
  it("Pollar firma sin patrocinio, el portero manda y se consulta el hash de la transacción interna", async () => {
    const f = portero(cupo(), () => responder(200, { hash: HASH, status: "PENDING", quedan: 18, quedanSorteos: 38 }));
    const { submitElsewhere } = await import("./envio-sdk");
    const r = await submitElsewhere(tx as never, () => undefined, 5000, intento);
    expect(r).toEqual({ hash: HASH, value: 7n });
    expect(signUnsponsored).toHaveBeenCalledWith("XDR_SIN_FIRMAR");
    expect(signAndSubmit).not.toHaveBeenCalled();
    expect(sendTransaction).not.toHaveBeenCalled();
    expect(getTransaction).toHaveBeenCalledWith(HASH);
    const pago = f.mock.calls.find((c) => !String(c[0]).includes("/cupo"));
    expect(String(pago?.[0])).toBe(`${URL}/v1/patrocinio`);
  });

  it("sin la variable de entorno todo es como hoy: Pollar firma y manda, sin ninguna consulta al portero", async () => {
    vi.stubEnv("VITE_PATROCINIO_URL", "");
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    const { submitElsewhere } = await import("./envio-sdk");
    const r = await submitElsewhere(tx as never, () => undefined, 5000, intento);
    expect(r?.hash).toBe(HASH);
    expect(signAndSubmit).toHaveBeenCalledWith("XDR_SIN_FIRMAR");
    expect(signUnsponsored).not.toHaveBeenCalled();
    expect(f).not.toHaveBeenCalled();
  });

  it("en tinkazo.app, sin la variable, se usa el portero por defecto", async () => {
    vi.stubEnv("VITE_PATROCINIO_URL", "");
    vi.stubGlobal("location", { hostname: "tinkazo.app" });
    const f = portero(cupo(), () => responder(200, { hash: HASH, status: "PENDING", quedan: 18, quedanSorteos: 38 }));
    const { submitElsewhere } = await import("./envio-sdk");
    const r = await submitElsewhere(tx as never, () => undefined, 5000, intento);
    expect(r?.hash).toBe(HASH);
    expect(signUnsponsored).toHaveBeenCalled();
    expect(signAndSubmit).not.toHaveBeenCalled();
    expect(f.mock.calls.some((c) => String(c[0]) === "https://p.tinkazo.app/v1/patrocinio")).toBe(true);
  });

  it("en tinkazo.app, sin la variable y con el portero caído, Pollar firma y manda como siempre, sin error", async () => {
    vi.stubEnv("VITE_PATROCINIO_URL", "");
    vi.stubGlobal("location", { hostname: "tinkazo.app" });
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))));
    const { submitElsewhere } = await import("./envio-sdk");
    const r = await submitElsewhere(tx as never, () => undefined, 5000, intento);
    expect(r?.hash).toBe(HASH);
    expect(signAndSubmit).toHaveBeenCalledWith("XDR_SIN_FIRMAR");
    expect(signUnsponsored).not.toHaveBeenCalled();
  });

  it("si el portero dice que rige Pollar, el camino de Pollar", async () => {
    portero({ rige: "pollar", prendido: false, motivo: "pollar" }, () => responder(500, {}));
    const { submitElsewhere } = await import("./envio-sdk");
    await submitElsewhere(tx as never, () => undefined, 5000, intento);
    expect(signAndSubmit).toHaveBeenCalled();
    expect(signUnsponsored).not.toHaveBeenCalled();
  });

  it("DUPLICATE se trata como hoy: la red la tiene, se pregunta por el hash", async () => {
    portero(cupo(), () => responder(200, { hash: HASH, status: "DUPLICATE", estado: "SUCCESS" }));
    const { submitElsewhere } = await import("./envio-sdk");
    expect((await submitElsewhere(tx as never, () => undefined, 5000, intento))?.hash).toBe(HASH);
  });

  it("el cupo de la cuenta agotado corta ahí: el error es el del portero, no un sello incierto", async () => {
    portero(cupo(), () => responder(429, { motivo: "cupo-cuenta", que: "sellos", liberaEn: Date.UTC(2026, 11, 1), max: 20 }));
    const { submitElsewhere } = await import("./envio-sdk");
    await expect(submitElsewhere(tx as never, () => undefined, 5000, intento)).rejects.toMatchObject({ name: "ErrorPortero", motivo: "cupo-cuenta", que: "sellos" });
    expect(getTransaction).not.toHaveBeenCalled();
  });

  it("sin fondo, apagado o cuenta ajena: el error del portero, sin sello incierto", async () => {
    for (const [estado, cuerpo] of [[503, { motivo: "fondo" }], [503, { motivo: "apagado", rige: "ninguno" }], [403, { motivo: "cuenta-ajena" }], [400, { motivo: "no-permitida", razon: "firma" }]] as const) {
      (await import("../stellar/patrocinador")).olvidarElEstado();
      portero(cupo(), () => responder(estado, cuerpo));
      const { submitElsewhere } = await import("./envio-sdk");
      await expect(submitElsewhere(tx as never, () => undefined, 5000, intento)).rejects.toMatchObject({ name: "ErrorPortero", motivo: cuerpo.motivo });
    }
  });

  it("el sorteo (sin intento) también corta con el error del portero", async () => {
    portero(cupo(), () => responder(429, { motivo: "cupo-cuenta", que: "sorteos", liberaEn: Date.UTC(2026, 11, 1), max: 40 }));
    const { submitElsewhere } = await import("./envio-sdk");
    await expect(submitElsewhere(tx as never, () => undefined, 5000)).rejects.toMatchObject({ motivo: "cupo-cuenta", que: "sorteos" });
  });

  it("Worker caído: cerrado ante la duda, antes de pedir ninguna firma", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))));
    const { submitElsewhere } = await import("./envio-sdk");
    await expect(submitElsewhere(tx as never, () => undefined, 5000, intento)).rejects.toMatchObject({ name: "ErrorPortero", motivo: "cerrado" });
    expect(signUnsponsored).not.toHaveBeenCalled();
    expect(signAndSubmit).not.toHaveBeenCalled();
  });

  it("portero apagado según /cupo: cerrado, y nadie firma", async () => {
    portero(cupo({ prendido: false, motivo: "apagado" }), () => responder(200, {}));
    const { submitElsewhere } = await import("./envio-sdk");
    await expect(submitElsewhere(tx as never, () => undefined, 5000, intento)).rejects.toMatchObject({ motivo: "cerrado" });
    expect(signUnsponsored).not.toHaveBeenCalled();
  });

  it("si el pago da 503 y ahora rige Pollar, se repite desde la firma con Pollar y no se dice que no se puede pagar", async () => {
    let cupos = 0;
    const f = vi.fn(async (u: string) => {
      if (!String(u).includes("/cupo")) return responder(503, { motivo: "apagado", rige: "pollar" });
      // La primera consulta dijo portero; la que se hace tras el 503 dice Pollar.
      return responder(200, ++cupos === 1 ? cupo() : { rige: "pollar", prendido: false, motivo: "pollar" });
    });
    vi.stubGlobal("fetch", f);
    const { submitElsewhere } = await import("./envio-sdk");
    const r = await submitElsewhere(tx as never, () => undefined, 5000, intento);
    expect(r?.hash).toBe(HASH);
    expect(signUnsponsored).toHaveBeenCalledTimes(1);
    expect(signAndSubmit).toHaveBeenCalledWith("XDR_SIN_FIRMAR");
    expect(cupos).toBe(2);
  });

  it("si tras el 503 la nueva consulta sigue sin Pollar, se muestra el no del portero (y solo después de volver a preguntar)", async () => {
    let cupos = 0;
    vi.stubGlobal("fetch", vi.fn(async (u: string) => (String(u).includes("/cupo") ? (cupos++, responder(200, cupo())) : responder(503, { motivo: "apagado", rige: "pollar" }))));
    const { submitElsewhere } = await import("./envio-sdk");
    await expect(submitElsewhere(tx as never, () => undefined, 5000, intento)).rejects.toMatchObject({ name: "ErrorPortero", motivo: "apagado" });
    expect(cupos).toBe(2);
    expect(signAndSubmit).not.toHaveBeenCalled();
  });

  it("un corte del pago y después un cupo agotado: la persona ve el cupo agotado, no un sello incierto", async () => {
    let pagos = 0;
    vi.stubGlobal("fetch", vi.fn(async (u: string) => {
      if (String(u).includes("/cupo")) return responder(200, cupo());
      if (++pagos === 1) throw new TypeError("Failed to fetch");
      return responder(429, { motivo: "cupo-cuenta", que: "sellos", liberaEn: Date.UTC(2026, 11, 1), max: 20 });
    }));
    getTransaction.mockResolvedValue({ status: "NOT_FOUND", latestLedgerCloseTime: 1 });
    const { submitElsewhere } = await import("./envio-sdk");
    await expect(submitElsewhere(tx as never, () => undefined, 5000, intento)).rejects.toMatchObject({ name: "ErrorPortero", motivo: "cupo-cuenta" });
    expect(pagos).toBe(2);
  });

  it("si el portero tarda más de 5 s, la persona lee que se está cubriendo la comisión; al contestar vuelve a 'mandando'", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      let suelta: (r: Response) => void = () => undefined;
      vi.stubGlobal("fetch", vi.fn((u: string) => (String(u).includes("/cupo") ? Promise.resolve(responder(200, cupo())) : new Promise<Response>((r) => (suelta = r)))));
      const pasos: string[] = [];
      const { submitElsewhere } = await import("./envio-sdk");
      const corre = submitElsewhere(tx as never, (p) => void pasos.push(p), 5000, intento);
      await vi.advanceTimersByTimeAsync(4_900);
      expect(pasos).not.toContain("covering");
      await vi.advanceTimersByTimeAsync(200);
      expect(pasos).toContain("covering");
      suelta(responder(200, { hash: HASH, status: "PENDING" }));
      await corre;
      expect(pasos.slice(pasos.indexOf("covering"), pasos.indexOf("covering") + 2)).toEqual(["covering", "sending"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("si el portero contesta enseguida no hay aviso de espera", async () => {
    portero(cupo(), () => responder(200, { hash: HASH, status: "PENDING" }));
    const pasos: string[] = [];
    const { submitElsewhere } = await import("./envio-sdk");
    await submitElsewhere(tx as never, (p) => void pasos.push(p), 5000, intento);
    expect(pasos).not.toContain("covering");
  });

  it("pagar con mi cuenta no pasa por el portero", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    sendTransaction.mockResolvedValue({ status: "PENDING" });
    const { submitElsewhere } = await import("./envio-sdk");
    await submitElsewhere(tx as never, () => undefined, 5000, intento, { pagarConMiCuenta: true });
    expect(sendTransaction).toHaveBeenCalled();
    expect(f).not.toHaveBeenCalled();
  });
});
