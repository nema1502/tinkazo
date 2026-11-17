import { Keypair, Networks, type Transaction, TransactionBuilder } from "@stellar/stellar-sdk";
import { describe, expect, it, vi } from "vitest";
import { type BilleteraPropia, activarLineaPropia, armarLinea } from "./linea-propia";
import { USDC_MAINNET, USDC_TESTNET } from "./pagos";

/**
 * Activar los dólares digitales con una billetera propia (`linea-propia.ts`): la página arma una sola operación que
 * abre la línea del USDC de Circle, la billetera la firma y la página la manda. Todo contra un Horizon y una billetera
 * de mentira: nada sale de la prueba.
 */

const YO = Keypair.random().publicKey();

const cuenta = (conLinea: boolean, red: "mainnet" | "testnet" = "mainnet"): Record<string, unknown> => ({
  id: YO,
  sequence: "100",
  subentry_count: 0,
  num_sponsoring: 0,
  num_sponsored: 0,
  balances: [
    ...(conLinea ? [{ asset_type: "credit_alphanum4", asset_code: "USDC", asset_issuer: (red === "mainnet" ? USDC_MAINNET : USDC_TESTNET).issuer, balance: "0.0000000", limit: "922337203685.4775807" }] : []),
    { asset_type: "native", balance: "5.0000000", selling_liabilities: "0.0000000" },
  ],
});

interface Envio {
  status: number;
  cuerpo?: Record<string, unknown>;
}

/** Un Horizon de mentira: la cuenta (sin la línea hasta que entra un envío aceptado) y lo que contesta cada envío. */
function horizon(o: { envios?: Envio[]; caido?: boolean; noExiste?: boolean; conLinea?: boolean; lineaNoAparece?: boolean; entraIgual?: boolean } = {}) {
  let tieneLinea = o.conLinea ?? false;
  const envios = [...(o.envios ?? [{ status: 200, cuerpo: { hash: "f".repeat(64) } }])];
  const mandados: string[] = [];
  const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    if (o.caido) return new Response("{}", { status: 503 });
    if (u.endsWith("/transactions") && init?.method === "POST") {
      mandados.push(new URLSearchParams(String(init.body)).get("tx") ?? "");
      const r = envios.shift() ?? { status: 500 };
      if ((r.status === 200 || o.entraIgual) && !o.lineaNoAparece) tieneLinea = true;
      return new Response(JSON.stringify(r.cuerpo ?? {}), { status: r.status });
    }
    if (o.noExiste) return new Response("{}", { status: 404 });
    return new Response(JSON.stringify(cuenta(tieneLinea)), { status: 200 });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, mandados };
}

function billetera(o: { red?: string | null; rechaza?: boolean; sola?: boolean } = {}): BilleteraPropia & { firmados: string[] } {
  const firmados: string[] = [];
  return {
    firmados,
    ...(o.sola ? { submitsItself: true } : {}),
    networkPassphrase: async () => (o.red === undefined ? Networks.PUBLIC : o.red),
    signTransaction: async (xdr: string) => {
      if (o.rechaza) throw new Error("User declined access");
      firmados.push(xdr);
      return { signedTxXdr: `FIRMADA:${firmados.length}` };
    },
  };
}

const rapido = { dormir: async () => undefined, cadaMs: 1, esperaMs: 3 };

describe("armarLinea", () => {
  it("es una sola operación que abre la línea del USDC de Circle, sin límite, con la cuenta como origen", async () => {
    const tx = TransactionBuilder.fromXDR(await armarLinea("mainnet", YO, "100"), Networks.PUBLIC) as Transaction;
    expect(tx.source).toBe(YO);
    expect(tx.sequence).toBe("101");
    expect(tx.fee).toBe("1000");
    expect(Number(tx.timeBounds?.maxTime)).toBeGreaterThan(0);
    expect(tx.operations).toHaveLength(1);
    const op = tx.operations[0] as unknown as { type: string; line: { code: string; issuer: string }; limit: string; source?: string };
    expect(op.type).toBe("changeTrust");
    expect({ code: op.line.code, issuer: op.line.issuer }).toEqual(USDC_MAINNET);
    expect(op.limit).toBe("922337203685.4775807");
    expect(op.source).toBeUndefined();
  });

  it("en la red de prueba, con el USDC de prueba de Circle y su frase", async () => {
    const tx = TransactionBuilder.fromXDR(await armarLinea("testnet", YO, "7"), Networks.TESTNET) as Transaction;
    const op = tx.operations[0] as unknown as { line: { code: string; issuer: string } };
    expect({ code: op.line.code, issuer: op.line.issuer }).toEqual(USDC_TESTNET);
  });
});

describe("activarLineaPropia", () => {
  it("aprobada: la billetera firma lo armado, se manda eso y la línea aparece", async () => {
    const h = horizon();
    const w = billetera();
    await expect(activarLineaPropia("mainnet", YO, w, { fetch: h.fetch, ...rapido })).resolves.toBe("activada");
    expect(w.firmados).toHaveLength(1);
    expect(h.mandados).toEqual(["FIRMADA:1"]);
  });

  it("si la persona no la aprueba, no se manda nada", async () => {
    const h = horizon();
    await expect(activarLineaPropia("mainnet", YO, billetera({ rechaza: true }), { fetch: h.fetch, ...rapido })).resolves.toBe("no-aprobada");
    expect(h.mandados).toEqual([]);
  });

  it("sin XLM libre para la reserva, la red la rechaza y se dice", async () => {
    const h = horizon({ envios: [{ status: 400, cuerpo: { extras: { result_codes: { transaction: "tx_failed", operations: ["op_low_reserve"] } } } }] });
    await expect(activarLineaPropia("mainnet", YO, billetera(), { fetch: h.fetch, ...rapido })).resolves.toBe("sin-xlm");
  });

  it("si la billetera está en otra red, no se le pide nada", async () => {
    const h = horizon();
    const w = billetera({ red: Networks.TESTNET });
    await expect(activarLineaPropia("mainnet", YO, w, { fetch: h.fetch, ...rapido })).resolves.toBe("otra-red");
    expect(w.firmados).toEqual([]);
    expect(h.fetch).not.toHaveBeenCalled();
  });

  it("si la billetera no dice su red, se sigue", async () => {
    const h = horizon();
    await expect(activarLineaPropia("mainnet", YO, billetera({ red: null }), { fetch: h.fetch, ...rapido })).resolves.toBe("activada");
  });

  it("sin respuesta de Horizon: mira la línea; si aparece, activada, y si no, enviada (no se manda otra vez)", async () => {
    const aparece = horizon({ envios: [{ status: 504 }], entraIgual: true });
    await expect(activarLineaPropia("mainnet", YO, billetera(), { fetch: aparece.fetch, ...rapido })).resolves.toBe("activada");
    expect(aparece.mandados).toHaveLength(1);
    const h = horizon({ envios: [{ status: 504 }] });
    await expect(activarLineaPropia("mainnet", YO, billetera(), { fetch: h.fetch, ...rapido })).resolves.toBe("enviada");
    expect(h.mandados).toHaveLength(1);
  });

  it("con la secuencia vieja se arma de nuevo una sola vez", async () => {
    const malo = { status: 400, cuerpo: { extras: { result_codes: { transaction: "tx_bad_seq" } } } };
    const una = horizon({ envios: [malo, { status: 200, cuerpo: { hash: "e".repeat(64) } }] });
    await expect(activarLineaPropia("mainnet", YO, billetera(), { fetch: una.fetch, ...rapido })).resolves.toBe("activada");
    expect(una.mandados).toHaveLength(2);
    const dos = horizon({ envios: [malo, malo, malo] });
    await expect(activarLineaPropia("mainnet", YO, billetera(), { fetch: dos.fetch, ...rapido })).resolves.toBe("no-salio");
    expect(dos.mandados).toHaveLength(2);
  });

  it("si la cuenta ya tiene la línea, no pide nada", async () => {
    const h = horizon({ conLinea: true });
    const w = billetera();
    await expect(activarLineaPropia("mainnet", YO, w, { fetch: h.fetch, ...rapido })).resolves.toBe("activada");
    expect(w.firmados).toEqual([]);
  });

  it("sin poder leer la cuenta no se firma nada; si no existe, le falta XLM", async () => {
    const w = billetera();
    await expect(activarLineaPropia("mainnet", YO, w, { fetch: horizon({ caido: true }).fetch, ...rapido })).resolves.toBe("sin-red");
    await expect(activarLineaPropia("mainnet", YO, w, { fetch: horizon({ noExiste: true }).fetch, ...rapido })).resolves.toBe("sin-xlm");
    expect(w.firmados).toEqual([]);
  });

  it("con una billetera que firma y manda sola (Google o correo), no corre", async () => {
    const h = horizon();
    const w = billetera({ sola: true });
    await expect(activarLineaPropia("mainnet", YO, w, { fetch: h.fetch, ...rapido })).resolves.toBe("no-corre");
    expect(h.fetch).not.toHaveBeenCalled();
    expect(w.firmados).toEqual([]);
  });
});
