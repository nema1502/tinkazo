/**
 * Lo que contestaría la red (`getTransaction`) por una transacción que entró a un ledger, armado a mano para las pruebas
 * de unidad: el sobre con el fee-bump del portero, el resultado (bien, atrapada, sin recursos) y los eventos de
 * diagnóstico. No entra en el Worker.
 */
import { Keypair, Networks, TransactionBuilder, type Transaction, xdr } from "@stellar/stellar-sdk/base";
import { horaDeLaRonda } from "./sello-tarde";
import type { Consulta } from "./red";

/** El sobre como lo manda el portero: la transacción firmada envuelta en un fee-bump de otra cuenta. */
export function envolverComoElPortero(xdrInterna: string, passphrase: string = Networks.TESTNET): string {
  const interna = TransactionBuilder.fromXDR(xdrInterna, passphrase) as Transaction;
  const bump = TransactionBuilder.buildFeeBumpTransaction(Keypair.random(), "10000", interna, passphrase);
  bump.sign(Keypair.random());
  return bump.toXDR();
}

export type Desenlace = "atrapada" | "sin-recursos" | "bien" | "secuencia";

const operacion = (d: Exclude<Desenlace, "secuencia">): xdr.OperationResult =>
  xdr.OperationResult.opInner(
    xdr.OperationResultTr.invokeHostFunction(
      d === "atrapada"
        ? xdr.InvokeHostFunctionResult.invokeHostFunctionTrapped()
        : d === "sin-recursos"
          ? xdr.InvokeHostFunctionResult.invokeHostFunctionResourceLimitExceeded()
          : xdr.InvokeHostFunctionResult.invokeHostFunctionSuccess(new Uint8Array(32)),
    ),
  );

/** El resultado de la red, con fee-bump (como el del portero) o sin él. */
export function resultado(d: Desenlace, o: { feeBump?: boolean; cobrado?: bigint } = {}): string {
  const cobrado = o.cobrado ?? 5_000n;
  const interno =
    d === "secuencia"
      ? xdr.InnerTransactionResultResult.txBadSeq()
      : d === "bien"
        ? xdr.InnerTransactionResultResult.txSuccess([operacion(d)])
        : xdr.InnerTransactionResultResult.txFailed([operacion(d)]);
  if (o.feeBump !== false) {
    const par = new xdr.InnerTransactionResultPair({
      transactionHash: new Uint8Array(32),
      result: new xdr.InnerTransactionResult({ feeCharged: cobrado, result: interno, ext: xdr.InnerTransactionResultExt.v0() }),
    });
    const fuera = d === "bien" ? xdr.TransactionResultResult.txFeeBumpInnerSuccess(par) : xdr.TransactionResultResult.txFeeBumpInnerFailed(par);
    return new xdr.TransactionResult({ feeCharged: cobrado, result: fuera, ext: xdr.TransactionResultExt.v0() }).toXDR("base64");
  }
  const sola =
    d === "secuencia" ? xdr.TransactionResultResult.txBadSeq() : d === "bien" ? xdr.TransactionResultResult.txSuccess([operacion(d)]) : xdr.TransactionResultResult.txFailed([operacion(d)]);
  return new xdr.TransactionResult({ feeCharged: cobrado, result: sola, ext: xdr.TransactionResultExt.v0() }).toXDR("base64");
}

/** Un evento de diagnóstico con el error `Error(Contract, #codigo)` en sus tópicos, como el que deja un contrato que devuelve un error. */
export function diagnosticoDeError(codigo: number): string {
  return new xdr.DiagnosticEvent({
    inSuccessfulContractCall: false,
    event: new xdr.ContractEvent({
      ext: xdr.ExtensionPoint.v0(),
      contractId: null,
      type: xdr.ContractEventType.diagnostic,
      body: xdr.ContractEventBody.v0(new xdr.ContractEventV0({ topics: [xdr.ScVal.scvSymbol("error"), xdr.ScVal.scvError(xdr.ScError.sceContract(codigo))], data: xdr.ScVal.scvString("escalating error") })),
    }),
  } as never).toXDR("base64");
}

/**
 * La consulta de un sello de `ronda` que entró a un ledger que cerró `faltaban` segundos antes de que naciera la ronda,
 * con el sobre del portero y el desenlace que se diga (por defecto, atrapada: el contrato devolvió un error).
 */
export function selloQueEntro(o: { xdr: string; ronda: number; faltaban: number; desenlace?: Desenlace; cobrado?: number; diagnosticos?: string[]; passphrase?: string }): Consulta {
  const d = o.desenlace ?? "atrapada";
  const cobrado = o.cobrado ?? 5_000;
  return {
    status: d === "bien" ? "SUCCESS" : "FAILED",
    feeCharged: cobrado,
    cierreS: horaDeLaRonda(o.ronda) - o.faltaban,
    sobre: envolverComoElPortero(o.xdr, o.passphrase),
    resultado: resultado(d, { cobrado: BigInt(cobrado) }),
    ...(o.diagnosticos ? { diagnosticos: o.diagnosticos } : {}),
  };
}
