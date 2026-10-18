import { bls12_381 } from "@noble/curves/bls12-381.js";
import { DST, QUICKNET, roundMessage } from "./quicknet";

/**
 * drand quicknet en el navegador (docs/protocolo.md §2 y §6).
 *
 * La verificación de la firma BLS y la descompresión del punto G1 que el
 * contrato necesita. Es lo único que usa la curva, y la curva pesa: este
 * archivo se carga con `import()` al sortear o al verificar. Los parámetros de
 * la cadena, el cálculo de rondas y la obtención de una ronda están en
 * `quicknet.ts`, y se reexportan acá para quien quiera todo junto.
 */

export * from "./quicknet";

const G1 = bls12_381.G1.Point;
const G2 = bls12_381.G2.Point;

/** Verifica que la firma (48 bytes hex) pertenece a la ronda dada. Nunca lanza. */
export function verifyRound(round: number, signatureHex: string): boolean {
  try {
    const sig = G1.fromHex(signatureHex);
    const pk = G2.fromHex(QUICKNET.publicKey);
    const h = bls12_381.shortSignatures.hash(roundMessage(round), DST);
    return bls12_381.shortSignatures.verify(sig, h, pk);
  } catch {
    return false;
  }
}

/** Firma en formato G1 sin comprimir (96 bytes, `x || y`), el que acepta el contrato. */
export function decompressG1(signatureHex: string): Uint8Array {
  return G1.fromHex(signatureHex).toBytes(false);
}
