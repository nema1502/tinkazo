/**
 * Lo que `RpcRed` entiende de las respuestas del RPC, con un `fetch` de mentira: nunca toca la red.
 * Para el sorteo del servidor hacen falta la simulación completa (los recursos para armar la transacción
 * y el valor que devuelve) y la secuencia de la cuenta.
 */
import { Keypair, nativeToScVal, xdr } from "@stellar/stellar-sdk/base";
import { describe, expect, it } from "vitest";
import { RpcRed } from "./red";

/** Un RPC de mentira: contesta `resultado` a cualquier método y anota qué se le pidió. */
function rpc(resultado: unknown) {
  const pedidos: string[] = [];
  const pedir = (async (_url: string, init?: RequestInit) => {
    pedidos.push(String(JSON.parse(String(init?.body)).method));
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: resultado }), { status: 200 });
  }) as unknown as typeof fetch;
  return { red: new RpcRed(["https://rpc.prueba"], pedir), pedidos };
}

/**
 * Varios RPC de mentira, uno por nodo, en el orden de la lista: cada nodo contesta `resultado`, un error del propio
 * RPC (`error`), `estado` como código HTTP, o corta el pedido (`corte`). Anota cada método que se le pidió a alguno.
 */
function rpcVarios(nodos: Array<{ resultado?: unknown; error?: unknown; estado?: number; corte?: boolean }>) {
  const pedidos: string[] = [];
  let i = 0;
  const pedir = (async (_url: string, init?: RequestInit) => {
    const n = nodos[i++] ?? { error: { message: "sin guion" } };
    pedidos.push(String(JSON.parse(String(init?.body)).method));
    if (n.corte) throw new Error("corte de prueba");
    if (n.estado) return new Response("no", { status: n.estado });
    if (n.error !== undefined) return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, error: n.error }), { status: 200 });
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: n.resultado ?? null }), { status: 200 });
  }) as unknown as typeof fetch;
  return { red: new RpcRed(nodos.map((_, n) => `https://rpc${n}.prueba`), pedir), pedidos };
}

describe("la simulación completa", () => {
  it("devuelve los recursos para armar la transacción y el valor que devuelve el contrato", async () => {
    const retorno = nativeToScVal(7n, { type: "u64" }).toXDR("base64");
    const { red, pedidos } = rpc({ minResourceFee: "54251", transactionData: "AAAA", results: [{ xdr: retorno, auth: [] }] });
    expect(await red.simular("xdr")).toEqual({ ok: true, minResourceFee: 54_251, datos: "AAAA", retorno });
    expect(pedidos).toEqual(["simulateTransaction"]);
  });

  it("sin recursos ni resultado (un RPC viejo) sigue siendo una simulación que pasa, como hoy", async () => {
    const { red } = rpc({ minResourceFee: "100" });
    expect(await red.simular("xdr")).toEqual({ ok: true, minResourceFee: 100 });
  });

  it("un error del contrato trae su número: AlreadyDrawn es el 2", async () => {
    const { red } = rpc({ error: "HostError: Error(Contract, #2)\n\nEvent log (newest first): ..." });
    expect(await red.simular("xdr")).toMatchObject({ ok: false, motivo: "fallaria", codigoContrato: 2 });
  });

  it("un error que no es del contrato no inventa número", async () => {
    const { red } = rpc({ error: "HostError: Error(Budget, ExceededLimit)" });
    const s = await red.simular("xdr");
    expect(s).toMatchObject({ ok: false, motivo: "fallaria" });
    expect(s).not.toHaveProperty("codigoContrato");
  });
});

describe("el error JSON-RPC de un nodo", () => {
  it("ante un error del nodo pregunta al siguiente y da su resultado", async () => {
    const { red, pedidos } = rpcVarios([{ error: { code: -32000, message: "algo" } }, { resultado: { minResourceFee: "100" } }]);
    expect(await red.simular("xdr")).toEqual({ ok: true, minResourceFee: 100 });
    expect(pedidos).toEqual(["simulateTransaction", "simulateTransaction"]);
  });

  it("si todos contestan error JSON-RPC, el aviso sigue siendo rpc-error, no una falla de red", async () => {
    const { red, pedidos } = rpcVarios([{ error: { message: "uno" } }, { error: { message: "dos" } }]);
    await expect(red.simular("xdr")).rejects.toMatchObject({ name: "ErrorDeRed", message: "rpc-error" });
    expect(pedidos.length).toBe(2);
  });

  it("mezcla con cortes: un corte, después un error JSON-RPC y el último bien", async () => {
    const { red, pedidos } = rpcVarios([{ corte: true }, { error: { message: "x" } }, { resultado: { minResourceFee: "7" } }]);
    expect(await red.simular("xdr")).toEqual({ ok: true, minResourceFee: 7 });
    expect(pedidos.length).toBe(3);
  });

  it("un envío con error JSON-RPC no se le pregunta al segundo nodo", async () => {
    const { red, pedidos } = rpcVarios([{ error: { message: "no" } }, { resultado: { status: "PENDING" } }]);
    await expect(red.enviar("xdr")).rejects.toMatchObject({ name: "ErrorDeRed", message: "rpc-error" });
    expect(pedidos.length).toBe(1);
  });
});

describe("la secuencia de la cuenta", () => {
  it("leerCuenta la devuelve como texto, sin perder precisión", async () => {
    const k = Keypair.random();
    const entrada = xdr.LedgerEntryData.account(
      new xdr.AccountEntry({
        accountId: xdr.PublicKey.publicKeyTypeEd25519(k.rawPublicKey()),
        balance: 20_000_000n,
        seqNum: 9_007_199_254_740_993n,
        numSubEntries: 0,
        inflationDest: null,
        flags: 0,
        homeDomain: "",
        thresholds: new Uint8Array([1, 0, 1, 0]),
        signers: [],
        ext: xdr.AccountEntryExt.v0(),
      } as never),
    );
    const { red } = rpc({ entries: [{ xdr: entrada.toXDR("base64") }] });
    expect(await red.leerCuenta(k.publicKey())).toMatchObject({ balance: 20_000_000n, secuencia: "9007199254740993" });
  });
});
