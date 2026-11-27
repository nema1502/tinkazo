/**
 * Cuentas de Stellar con forma válida (con su final de control) para las pruebas: la lista de una campaña las comprueba con
 * la misma regla que la sala. `cuentaDePrueba(n)` es siempre la misma para el mismo `n`.
 */
import { StrKey } from "@stellar/stellar-sdk/base";
import vectoresDePersona from "../../docs/vectors-persona.json";

export function cuentaDePrueba(n: number): string {
  return StrKey.encodeEd25519PublicKey(Buffer.alloc(32, n));
}

/**
 * Líneas de persona con forma válida para las pruebas, las de `docs/vectors-persona.json`: las de los casos y las de la
 * campaña de ejemplo, sin repetir. `lineaDePrueba(n)` es siempre la misma para el mismo `n`, de 1 a 7.
 */
const LINEAS_DE_PRUEBA: readonly string[] = [
  ...new Set([...vectoresDePersona.casos.map((c) => c.linea), ...vectoresDePersona.campana.lineas]),
];

export function lineaDePrueba(n: number): string {
  const linea = LINEAS_DE_PRUEBA[n - 1];
  if (!Number.isInteger(n) || linea === undefined) throw new RangeError(`No hay una línea de prueba número ${n}.`);
  return linea;
}
