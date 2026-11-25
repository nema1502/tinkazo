import { Keypair, Networks, StrKey, TransactionBuilder, Account, Operation, Asset } from "@stellar/stellar-sdk";
import type { Transaction } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import { crearPagador, ErrorDeGrifo } from "./pagador";

/** Un grifo de mentira que contesta lo que se le diga, en orden, y anota las direcciones que le pidieron. */
function grifo(respuestas: Array<number | "corte">): { fetchFn: typeof fetch; pedidos: string[] } {
  const pedidos: string[] = [];
  let i = 0;
  const fetchFn = (async (url: string | URL | Request) => {
    pedidos.push(String(url));
    const r = respuestas[Math.min(i++, respuestas.length - 1)];
    if (r === "corte") throw new Error("sin red");
    return new Response("{}", { status: r });
  }) as typeof fetch;
  return { fetchFn, pedidos };
}

const sinEspera = async (): Promise<void> => undefined;
const cuentaVista = async (): Promise<string | null> => "100";

describe("la cuenta descartable que paga", () => {
  it("se fondea con el grifo de la red de prueba y firma lo que se le pide", async () => {
    const g = grifo([200]);
    const p = await crearPagador({ fetchFn: g.fetchFn, secuencia: cuentaVista, dormir: sinEspera });
    expect(StrKey.isValidEd25519PublicKey(p.publica)).toBe(true);
    expect(g.pedidos).toHaveLength(1);
    expect(g.pedidos[0]).toBe(`https://friendbot.stellar.org/?addr=${p.publica}`);
    expect(p.intentosDeGrifo).toHaveLength(1);
    expect(p.intentosDeGrifo[0]?.http).toBe(200);

    const tx = new TransactionBuilder(new Account(p.publica, "1"), { fee: "100", networkPassphrase: Networks.TESTNET })
      .addOperation(Operation.payment({ destination: Keypair.random().publicKey(), asset: Asset.native(), amount: "1" }))
      .setTimeout(30)
      .build();
    const firmada = TransactionBuilder.fromXDR(p.firmar(tx.toXDR()), Networks.TESTNET) as Transaction;
    expect(firmada.signatures).toHaveLength(1);
  });

  it("cada pagador es una cuenta distinta", async () => {
    const g = grifo([200]);
    const a = await crearPagador({ fetchFn: g.fetchFn, secuencia: cuentaVista, dormir: sinEspera });
    const b = await crearPagador({ fetchFn: g.fetchFn, secuencia: cuentaVista, dormir: sinEspera });
    expect(a.publica).not.toBe(b.publica);
  });

  it("un 400 del grifo vale como que la cuenta ya existe", async () => {
    const p = await crearPagador({ fetchFn: grifo([400]).fetchFn, secuencia: cuentaVista, dormir: sinEspera });
    expect(p.intentosDeGrifo.map((i) => i.http)).toEqual([400]);
    expect(p.limitado).toBe(false);
  });

  it("reintenta hasta tres veces y anota el código de cada una, también el 429", async () => {
    const p = await crearPagador({ fetchFn: grifo([429, "corte", 200]).fetchFn, secuencia: cuentaVista, dormir: sinEspera });
    expect(p.intentosDeGrifo.map((i) => i.http)).toEqual([429, null, 200]);
    expect(p.limitado).toBe(true);
  });

  it("con el grifo caído o limitado en los tres intentos, falla con lo que contestó cada uno", async () => {
    const error = await crearPagador({ fetchFn: grifo([429, 503, "corte"]).fetchFn, secuencia: cuentaVista, dormir: sinEspera }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ErrorDeGrifo);
    const e = error as ErrorDeGrifo;
    expect(e.message).toBe("sin-fondos");
    expect(e.intentos.map((i) => i.http)).toEqual([429, 503, null]);
    expect(e.limitado).toBe(true);
  });

  it("si la cuenta no aparece en el RPC a tiempo, falla", async () => {
    let t = 0;
    const error = await crearPagador({
      fetchFn: grifo([200]).fetchFn,
      secuencia: async () => null,
      dormir: async (ms) => void (t += ms),
      ahora: () => t,
      esperarCuentaMs: 3_000,
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ErrorDeGrifo);
  });

  it("espera a que la cuenta aparezca y sigue", async () => {
    let vueltas = 0;
    const p = await crearPagador({ fetchFn: grifo([200]).fetchFn, secuencia: async () => (++vueltas < 3 ? null : "100"), dormir: sinEspera });
    expect(vueltas).toBe(3);
    expect(p.publica).toMatch(/^G/);
  });
});
