/**
 * Arma transacciones de `seal` y `draw` como las arma el navegador, con variantes
 * a propósito mal hechas. Lo usan las pruebas de unidad (`*.test.ts`) y `probar.mjs`
 * (Node lo carga con la extensión de tipos quitada por el propio Node). No entra en el Worker.
 */
import { Address, Asset, Keypair, Networks, Operation, SorobanDataBuilder, TransactionBuilder, Account, nativeToScVal, xdr } from "@stellar/stellar-sdk/base";

export interface Variante {
  /** Quién firma y origina. */
  firmante: Keypair;
  contrato: string;
  metodo?: string;
  /** El organizador del `seal`; por defecto, el firmante. */
  organizador?: string;
  resourceFee?: number;
  /** La comisión de inclusión por operación (el total declarado le suma los recursos); por defecto 100. */
  fee?: number;
  /** Segundos desde ahora hasta `maxTime`; 0 = sin límite. */
  ventanaS?: number;
  passphrase?: string;
  secuencia?: string;
  /** No firmar, o firmar con otra llave. */
  firmaDe?: Keypair | "ninguna";
  /** Una operación de otro tipo en lugar de la invocación. */
  operacion?: "pago" | "bump";
  dosOperaciones?: boolean;
  origenDeOperacion?: string;
  /** Entradas archivadas para restaurar. */
  archivadas?: number[];
  sinDatos?: boolean;
  raffleId?: bigint;
  hashLista?: Uint8Array;
  /** Un memo de texto (la lista blanca no admite ninguno). */
  memo?: string;
  /** Argumentos a mano, en lugar de los del método. */
  args?: xdr.ScVal[];
}

function argumentos(v: Variante): xdr.ScVal[] {
  if (v.args) return v.args;
  const metodo = v.metodo ?? "seal";
  if (metodo === "seal") {
    return [
      new Address(v.organizador ?? v.firmante.publicKey()).toScVal(),
      nativeToScVal(v.hashLista ?? new Uint8Array(32).fill(7), { type: "bytes" }),
      nativeToScVal(5, { type: "u32" }),
      nativeToScVal(1, { type: "u32" }),
      nativeToScVal(99n, { type: "u64" }),
      nativeToScVal("prueba", { type: "string" }),
    ];
  }
  if (metodo === "draw") return [nativeToScVal(v.raffleId ?? 1n, { type: "u64" }), nativeToScVal(new Uint8Array(96).fill(3), { type: "bytes" })];
  return [nativeToScVal(v.raffleId ?? 1n, { type: "u64" })];
}

export function armar(v: Variante): { xdr: string; hash: string } {
  const recursos = v.resourceFee ?? 50_000;
  const b = new TransactionBuilder(new Account(v.firmante.publicKey(), v.secuencia ?? "100"), {
    fee: String(v.fee ?? 100),
    networkPassphrase: v.passphrase ?? Networks.TESTNET,
  });
  const invocar = () =>
    Operation.invokeContractFunction({ contract: v.contrato, function: v.metodo ?? "seal", args: argumentos(v), ...(v.origenDeOperacion ? { source: v.origenDeOperacion } : {}) });
  if (v.operacion === "pago") b.addOperation(Operation.payment({ destination: Keypair.random().publicKey(), asset: Asset.native(), amount: "1" }));
  else if (v.operacion === "bump") b.addOperation(Operation.bumpSequence({ bumpTo: "500" }));
  else {
    b.addOperation(invocar());
    if (v.dosOperaciones) b.addOperation(invocar());
  }
  if (!v.sinDatos && !v.operacion) {
    const base = new SorobanDataBuilder().setResourceFee(recursos).build();
    b.setSorobanData(
      v.archivadas
        ? new xdr.SorobanTransactionData({
            ext: xdr.SorobanTransactionDataExt.resourceExt(new xdr.SorobanResourcesExtV0({ archivedSorobanEntries: v.archivadas })),
            resources: base.resources,
            resourceFee: base.resourceFee,
          })
        : base,
    );
  }
  if (v.ventanaS === 0) b.setTimebounds(0, 0);
  else b.setTimeout(v.ventanaS ?? 240);
  let tx = b.build();
  if (v.memo !== undefined) {
    // El SDK no deja armar una transacción de Soroban con memo: se le pone a mano al XDR y se vuelve a leer.
    const env = xdr.TransactionEnvelope.fromXDR(tx.toXDR(), "base64");
    (env.value as xdr.TransactionV1Envelope).tx.memo = xdr.Memo.memoText(v.memo);
    tx = TransactionBuilder.fromXDR(env.toXDR("base64"), v.passphrase ?? Networks.TESTNET) as typeof tx;
  }
  if (v.firmaDe !== "ninguna") tx.sign(v.firmaDe ?? v.firmante);
  return { xdr: tx.toXDR(), hash: Buffer.from(tx.hash()).toString("hex") };
}
