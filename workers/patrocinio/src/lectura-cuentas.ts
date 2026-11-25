/**
 * Las cuentas nuevas y las activaciones de la última hora, contadas desde la consulta de uso del proveedor de cuentas
 * por ventana de tiempo (`GET /v3/billing/usage?from=…&to=…`, que lee `pollar.ts`): es lo que el vigilante necesita para
 * avisar cuando una ronda de cuentas pasa su umbral (issue 177). Crear la cuenta y activarla no pasa por el portero: lo
 * hace el proveedor de cuentas al entrar, y un guion podría hacerlo desde afuera con el QR a la vista.
 *
 * La consulta de uso da la cantidad exacta por tipo de cobro (`events: [{ event, count, credits }]`) aunque en la ventana
 * haya miles de firmas. No sirve la lista de movimientos de los créditos para contar: es una sola página de hasta 200
 * movimientos que comparten las firmas, las activaciones y las cuentas nuevas, y las firmas la llenan.
 *
 * Los nombres de los cobros llevan sufijos (`wallet.created:STELLAR:COSIGNED` al crear la cuenta nueva y
 * `cosign.signature:STELLAR` en las firmas, medidos contra el proveedor), así que un cobro se reconoce por el COMIENZO de
 * su nombre, seguido del fin del texto o de dos puntos, y nunca por igualdad: con una igualdad el conteo daría siempre
 * cero, que es peor que no tener conteo porque nunca avisa. `account.active` al activar la cuenta se tomó de la
 * vigilancia de firmas y sigue por confirmar con el proveedor.
 *
 * Módulo puro: ninguna prueba toca hora ni red.
 */

/** Los minutos que cubre el conteo, corridos hacia atrás desde ahora. El vigilante lee este mismo número en el bloque. */
export const VENTANA_CUENTAS_MINUTOS = 60;

/** El cobro por crear la cuenta nueva (la billetera del proveedor): el nombre solo, o seguido de dos puntos y el sufijo. */
const EVENTO_CUENTA_NUEVA = /^wallet\.created(?::|$)/;
/** El cobro por activar la cuenta (ponerla en la red). */
const EVENTO_ACTIVACION = /^account\.active(?::|$)/;

/** Las cuentas nuevas y las activaciones de la ventana. */
export interface CuentasDeLaVentana {
  nuevas: number;
  activaciones: number;
}

/**
 * Las cuentas nuevas y las activaciones que dice la lista `events` de la consulta de uso, sumando todos los cobros cuyo
 * nombre empieza con el de crear una cuenta o el de activarla. Una ventana sin cuentas da cero: es un dato. Si la lista
 * falta, o un elemento no tiene nombre, o un `count` no es un entero seguro mayor o igual a cero, o la suma no cabe en un
 * entero seguro, no hay conteo: devuelve null y nunca un cero inventado.
 */
export function contarCuentasEnUso(eventos: unknown): CuentasDeLaVentana | null {
  if (!Array.isArray(eventos)) return null;
  let nuevas = 0;
  let activaciones = 0;
  for (const e of eventos) {
    if (!e || typeof e !== "object" || Array.isArray(e)) return null;
    const { event, count } = e as Record<string, unknown>;
    if (typeof event !== "string" || typeof count !== "number" || !Number.isSafeInteger(count) || count < 0) return null;
    if (EVENTO_CUENTA_NUEVA.test(event)) nuevas += count;
    else if (EVENTO_ACTIVACION.test(event)) activaciones += count;
    if (!Number.isSafeInteger(nuevas) || !Number.isSafeInteger(activaciones)) return null;
  }
  return { nuevas, activaciones };
}
