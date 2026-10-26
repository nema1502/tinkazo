import { targetRound } from "../protocol/quicknet";

/**
 * El sello de muestra del chequeo de la red: una transacción armada con el SDK, sin
 * firmar, que solo se simula (la red devuelve el costo sin mandar nada).
 *
 * Vive aparte de `red.ts` porque necesita el SDK de Stellar, que se baja recién cuando
 * hace falta (con una sesión abierta ya está bajado: `precalentarSello`).
 *
 * Medido el 25 de octubre de 2026: el RPC simula un `seal` también con una cuenta que
 * no existe (la de un Pollar recién creado), en 0,2 a 0,9 s.
 */

export interface MuestraArmada {
  /** La transacción en base64, lista para `simulateTransaction`. */
  xdr: string;
}

/**
 * Arma un `seal` de una lista de dos personas con una ronda 5 minutos adelante: lejos
 * del límite de 30 segundos del contrato aunque el reloj de la máquina esté corrido
 * unos minutos, y lejos de los 30 días. El organizador es `origen`.
 */
export async function armarSelloDeMuestra(o: { origen: string; contractId: string; passphrase: string; ahoraS?: number }): Promise<MuestraArmada> {
  const { Account, Address, Operation, TransactionBuilder, nativeToScVal, xdr } = await import("@stellar/stellar-sdk");
  const ronda = targetRound(o.ahoraS ?? Math.floor(Date.now() / 1000), 300);
  const operacion = Operation.invokeContractFunction({
    contract: o.contractId,
    function: "seal",
    args: [
      new Address(o.origen).toScVal(),
      xdr.ScVal.scvBytes(new Uint8Array(32).fill(7)),
      nativeToScVal(2, { type: "u32" }),
      nativeToScVal(1, { type: "u32" }),
      nativeToScVal(BigInt(ronda), { type: "u64" }),
      nativeToScVal("", { type: "string" }),
    ],
  });
  const tx = new TransactionBuilder(new Account(o.origen, "0"), { fee: "100", networkPassphrase: o.passphrase }).addOperation(operacion).setTimeout(60).build();
  return { xdr: tx.toXDR() };
}

/** Una cuenta cualquiera para la muestra cuando no hay sesión: la simulación anda igual. */
export async function cuentaDeMuestra(): Promise<string> {
  const { Keypair } = await import("@stellar/stellar-sdk");
  return Keypair.random().publicKey();
}
