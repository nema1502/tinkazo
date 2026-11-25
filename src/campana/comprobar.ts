/**
 * La comprobación propia del sello por el celular de una campaña: después del sello, el celular lee en la red la
 * transacción del sello y comprueba él mismo que su cuenta está en la lista, sin creerle al servidor.
 *
 * Qué lee y con qué se compra:
 *  - el comprobante (`/verificar.html#…`) que da la sala trae la lista canónica y el hash de la transacción del sello;
 *  - la transacción del sello se lee del historial público de la red con ese hash (`stellar/historial.ts`) y de ahí salen
 *    el contrato, la huella de la lista sellada, la cantidad, las ganadoras y la ronda;
 *  - la huella se vuelve a calcular acá, con la lista del comprobante: si la red y el comprobante no cuentan lo mismo,
 *    el celular no afirma nada (`null`), ni bien ni mal;
 *  - la cuenta va en la lista del comprobante: ahí sale el `esta` o el `no-esta` que la pantalla cuenta.
 *
 * No se comprueba la firma de la ronda ni la matemática del sorteo: eso lo hace la página de verificación entera, a la
 * que van los enlaces «Ver cómo se eligió». Acá solo se atestigua que la lista sellada tiene la cuenta, leído en la red.
 */

import { canonicalList, listHash } from "../protocol/canonical";
import { decodeProof } from "../protocol/proof";
import { bytesToHex, roundTime } from "../protocol/quicknet";
import { cuentaValida } from "../sala/campana";
import type { LecturaDelHistorial } from "../stellar/historial";
import type { NetworkName } from "../stellar/config";

/** Lo que la comprobación es capaz de decir. `null`: la red no contó, y la pantalla no dice nada. */
export type ComprobacionDelSello = "esta" | "no-esta" | null;

/** Lo que apoya la comprobación. `leer` es el historial de la red; en las pruebas, el simulador. */
export interface PiezasDeLaComprobacion {
  leer: (red: string, hash: string) => Promise<LecturaDelHistorial>;
  ahora?: () => number;
}

/** Un lector del historial real, armado a la primera y reusado después. Nunca lanza: los fallos vuelven como lectura. */
export async function lectorDelHistorial(): Promise<(red: string, hash: string) => Promise<LecturaDelHistorial>> {
  const { crearLectorDeHistorial } = await import("../stellar/historial");
  const lector = crearLectorDeHistorial();
  return (red, hash) => lector(red as NetworkName, hash);
}

/** Reduce un texto a su hash de transacción, en minúsculas, o `null` si no tiene forma de uno. */
function hashDeTx(valor: unknown): string | null {
  return typeof valor === "string" && /^[0-9a-fA-F]{64}$/u.test(valor) ? valor.toLowerCase() : null;
}

/**
 * Comprueba la cuenta contra el sello que la red guarda. Nunca lanza: lo que no se puedo leer es `null`, y la pantalla
 * se queda callada en vez de inventar un veredicto.
 */
export async function comprobarMiCuenta(
  o: { comprobante: string; cuenta: string; red: string; contrato: string | null },
  piezas: PiezasDeLaComprobacion,
): Promise<ComprobacionDelSello> {
  const corte = o.comprobante.indexOf("#");
  if (corte < 0) return null;
  let prueba: Awaited<ReturnType<typeof decodeProof>>;
  try {
    prueba = await decodeProof(o.comprobante.slice(corte));
  } catch {
    return null;
  }
  if (prueba.net !== o.red) return null;
  const stx = hashDeTx(prueba.stx);
  if (!stx) return null;
  const nombres = prueba.names;
  if (!Array.isArray(nombres)) return null;
  for (const nombre of nombres) {
    if (typeof nombre !== "string" || !cuentaValida(nombre)) return null;
  }
  // La lista que el comprobante trae tiene que estar ya canónica (como la sella la sala): si canonicalizarla la cambia,
  // el comprobante y lo que la red atestigua no son la misma lista, y no se afirma nada.
  const canonica = canonicalList(nombres.join("\n"));
  if (canonica.length !== nombres.length || canonica.some((nombre, i) => nombre !== nombres[i])) return null;
  let lectura: LecturaDelHistorial;
  try {
    lectura = await piezas.leer(o.red, stx);
  } catch {
    return null;
  }
  if (!lectura.ok) return null;
  const sello = lectura.sello;
  if (bytesToHex(listHash(canonica)) !== sello.listHash.toLowerCase()) return null;
  if (sello.count !== canonica.length) return null;
  if (o.contrato !== null && sello.contractId.toLowerCase() !== o.contrato.toLowerCase()) return null;
  // La ronda todavía no salió: no puede atestiguar una lista para un sorteo que no existe.
  if (!Number.isSafeInteger(sello.round) || sello.round < 1 || roundTime(sello.round) * 1000 > (piezas.ahora ?? Date.now)()) {
    return null;
  }
  return canonica.some((nombre) => nombre === o.cuenta) ? "esta" : "no-esta";
}
