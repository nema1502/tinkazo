import { Account, Address, Keypair, Networks, Operation, TransactionBuilder, nativeToScVal, scValToNative, xdr } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import { RED_DE_PRUEBA } from "./red";
import { codigoDeContrato, codigoDelRechazo, RpcDePrueba } from "./rpc";

/** Un RPC de mentira: contesta lo que se le diga por método y anota lo que le pidieron. */
function rpcFalso(porMetodo: Record<string, unknown>, estado = 200): { fetchFn: typeof fetch; pedidos: Array<{ metodo: string; params: unknown }> } {
  const pedidos: Array<{ metodo: string; params: unknown }> = [];
  const fetchFn = (async (_url: string | URL | Request, init?: RequestInit) => {
    const cuerpo = JSON.parse(String(init?.body)) as { method: string; params: unknown };
    pedidos.push({ metodo: cuerpo.method, params: cuerpo.params });
    const r = porMetodo[cuerpo.method];
    const sale = r !== null && typeof r === "object" && "error" in (r as object) ? r : { result: r };
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, ...(sale as object) }), { status: estado });
  }) as typeof fetch;
  return { fetchFn, pedidos };
}

describe("los pedidos sueltos al RPC", () => {
  it("el ledger actual sale de getLatestLedger", async () => {
    const { fetchFn } = rpcFalso({ getLatestLedger: { sequence: 123, protocolVersion: 30 } });
    expect(await new RpcDePrueba({ fetchFn }).ledgerActual()).toBe(123);
  });

  it("una cuenta que no existe da null", async () => {
    const { fetchFn, pedidos } = rpcFalso({ getLedgerEntries: { entries: null } });
    expect(await new RpcDePrueba({ fetchFn }).secuencia(Keypair.random().publicKey())).toBeNull();
    expect(pedidos[0]?.metodo).toBe("getLedgerEntries");
  });

  it("un error del RPC o un HTTP malo lanza", async () => {
    const conError = rpcFalso({ getLatestLedger: { error: { code: -32600, message: "mal pedido" } } });
    await expect(new RpcDePrueba({ fetchFn: conError.fetchFn }).ledgerActual()).rejects.toThrow("mal pedido");
    const malo = rpcFalso({}, 503);
    await expect(new RpcDePrueba({ fetchFn: malo.fetchFn }).ledgerActual()).rejects.toThrow("503");
  });

  it("mandar devuelve el estado, y lo que no se conoce es un error", async () => {
    for (const status of ["PENDING", "DUPLICATE", "TRY_AGAIN_LATER"]) {
      const { fetchFn } = rpcFalso({ sendTransaction: { status, hash: "ab" } });
      expect((await new RpcDePrueba({ fetchFn }).enviar("AAAA")).status).toBe(status);
    }
    const { fetchFn } = rpcFalso({ sendTransaction: { status: "ERROR", errorResultXdr: "no es xdr" } });
    expect(await new RpcDePrueba({ fetchFn }).enviar("AAAA")).toEqual({ status: "ERROR" });
  });

  it("preguntar por una transacción trae su hash y la hora de la red", async () => {
    const { fetchFn } = rpcFalso({ getTransaction: { status: "SUCCESS", ledger: 9, latestLedgerCloseTime: "1800000100", resultXdr: "x" } });
    const c = await new RpcDePrueba({ fetchFn }).consultarCruda("hh");
    expect(c.hash).toBe("hh");
    expect(c.status).toBe("SUCCESS");
    const r = await new RpcDePrueba({ fetchFn }).consultar("hh", () => 42);
    expect(r).toEqual({ status: "SUCCESS", cierre: 1_800_000_100, valor: 42 });
  });

  it("una transacción que todavía no está es NOT_FOUND y con la hora de la red", async () => {
    const { fetchFn } = rpcFalso({ getTransaction: { status: "NOT_FOUND", latestLedgerCloseTime: "1800000100" } });
    expect(await new RpcDePrueba({ fetchFn }).consultar("hh")).toEqual({ status: "NOT_FOUND", cierre: 1_800_000_100 });
  });
});

describe("la simulación", () => {
  const origen = Keypair.random().publicKey();
  const tx = new TransactionBuilder(new Account(origen, "1"), { fee: "100", networkPassphrase: Networks.TESTNET })
    .addOperation(Operation.invokeContractFunction({ contract: "CDNWNY26VWXM7ISXJD2OFWDUAPIOAJTR5TMAXFFHWWUHZWGCEWDKYV3A", function: "draw", args: [] }))
    .setTimeout(30)
    .build()
    .toXDR();

  it("una simulación que pasa trae las entradas y el ledger", async () => {
    const sim = { latestLedger: 55, result: { auth: [{ toXDR: () => "ENTRADA" }], retval: { toXDR: () => "RETORNO" } }, minResourceFee: "1", transactionData: {} };
    const r = await new RpcDePrueba({ servidor: { simulateTransaction: async () => sim } }).simular(tx);
    expect(r.ok).toBe(true);
    expect(r.authB64).toEqual(["ENTRADA"]);
    expect(r.retornoB64).toBe("RETORNO");
    expect(r.latestLedger).toBe(55);
  });

  it("una simulación con error trae el texto del error", async () => {
    const sim = { latestLedger: 56, error: "HostError: Error(Contract, #5)", events: [] };
    const r = await new RpcDePrueba({ servidor: { simulateTransaction: async () => sim } }).simular(tx);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("#5");
    expect(codigoDeContrato(r.error)).toBe(5);
  });

  it("una simulación que pide restaurar no sigue", async () => {
    const sim = { latestLedger: 57, result: { auth: [], retval: undefined }, minResourceFee: "1", transactionData: {}, restorePreamble: { minResourceFee: "1", transactionData: {} } };
    const r = await new RpcDePrueba({ servidor: { simulateTransaction: async () => sim } }).simular(tx);
    expect(r.ok).toBe(false);
    expect(r.restaurar).toBe(true);
  });
});

describe("los códigos", () => {
  it("el número de un error del contrato", () => {
    expect(codigoDeContrato("HostError: Error(Contract, #7)")).toBe(7);
    expect(codigoDeContrato("otra cosa")).toBeNull();
    expect(codigoDeContrato(undefined)).toBeNull();
  });

  it("un rechazo ilegible no da código", () => {
    expect(codigoDelRechazo(undefined)).toBeUndefined();
    expect(codigoDelRechazo("no es xdr")).toBeUndefined();
  });
});

describe("las monedas de una cuenta de contrato", () => {
  const cuenta = RED_DE_PRUEBA.verificador;

  /** La entrada de saldo tal como la guarda el contrato de las monedas, en base64. */
  function entradaDeSaldo(amount: bigint): string {
    const val = nativeToScVal({ amount, authorized: true, clawback: false }, { type: { amount: ["symbol", "i128"], authorized: ["symbol", null], clawback: ["symbol", null] } });
    const key = nativeToScVal(["Balance", cuenta], { type: ["symbol", "address"] });
    return xdr.LedgerEntryData.contractData(
      new xdr.ContractDataEntry({ ext: xdr.ExtensionPoint.v0(), contract: new Address(RED_DE_PRUEBA.activo).toScAddress(), key, durability: xdr.ContractDataDurability.persistent, val }),
    ).toXDR("base64");
  }

  it("pide la entrada persistente del contrato de las monedas con la clave Balance de esa cuenta", async () => {
    const { fetchFn, pedidos } = rpcFalso({ getLedgerEntries: { entries: null, latestLedger: 500 } });
    await new RpcDePrueba({ fetchFn }).saldoDeContrato(cuenta);
    const claves = (pedidos[0]?.params as { keys: string[] }).keys;
    expect(claves).toHaveLength(1);
    const clave = xdr.LedgerKey.fromXDR(claves[0] as string, "base64") as unknown as { contractData: { contract: xdr.ScAddress; key: xdr.ScVal; durability: unknown } };
    expect(Address.fromScAddress(clave.contractData.contract).toString()).toBe(RED_DE_PRUEBA.activo);
    expect(scValToNative(clave.contractData.key)).toEqual(["Balance", cuenta]);
    expect(clave.contractData.durability).toBe(xdr.ContractDataDurability.persistent);
  });

  it("sin entrada el saldo es cero y no está archivada", async () => {
    const { fetchFn } = rpcFalso({ getLedgerEntries: { entries: null, latestLedger: 500 } });
    expect(await new RpcDePrueba({ fetchFn }).saldoDeContrato(cuenta)).toEqual({ stroops: 0n, vence: null, archivada: false, latestLedger: 500 });
  });

  it("con entrada lee el saldo y hasta cuándo vive", async () => {
    const { fetchFn } = rpcFalso({ getLedgerEntries: { entries: [{ xdr: entradaDeSaldo(100_000_000n), liveUntilLedgerSeq: 700 }], latestLedger: 500 } });
    expect(await new RpcDePrueba({ fetchFn }).saldoDeContrato(cuenta)).toEqual({ stroops: 100_000_000n, vence: 700, archivada: false, latestLedger: 500 });
  });

  it("una entrada que ya venció se lee igual y queda marcada como archivada", async () => {
    const { fetchFn } = rpcFalso({ getLedgerEntries: { entries: [{ xdr: entradaDeSaldo(5n), liveUntilLedgerSeq: 400 }], latestLedger: 500 } });
    const r = await new RpcDePrueba({ fetchFn }).saldoDeContrato(cuenta);
    expect(r).toMatchObject({ stroops: 5n, vence: 400, archivada: true });
  });

  it("un corte o un error del RPC lanza: quien lee decide, nunca se toma por cero", async () => {
    const malo = rpcFalso({}, 503);
    await expect(new RpcDePrueba({ fetchFn: malo.fetchFn }).saldoDeContrato(cuenta)).rejects.toThrow("503");
  });

  it("las monedas de una cuenta G que no existe dan null", async () => {
    const { fetchFn } = rpcFalso({ getLedgerEntries: { entries: null } });
    expect(await new RpcDePrueba({ fetchFn }).saldoDeCuenta(Keypair.random().publicKey())).toBeNull();
  });
});
