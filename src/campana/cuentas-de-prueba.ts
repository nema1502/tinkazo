/**
 * Cuentas de Stellar con forma válida (con su final de control) para las pruebas: la lista de una campaña las comprueba con
 * la misma regla que la sala. `cuentaDePrueba(n)` es siempre la misma para el mismo `n`.
 */
import { StrKey } from "@stellar/stellar-sdk/base";

export function cuentaDePrueba(n: number): string {
  return StrKey.encodeEd25519PublicKey(Buffer.alloc(32, n));
}
