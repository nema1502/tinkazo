import type { ContratoDePremios } from "./oficiales";
import {
  type ErrorDeLaPromocion,
  type LecturaDeLaPromocion,
  type OpcionesDeLaPromocion,
  type PremioDeLaPromocion,
  type Promocion,
  leerPromocion,
} from "./premios";

/**
 * La decisión de entrega de los premios que esperan (`entregas-decision.ts`, issue #176).
 *
 * El servicio de entregas programa llamadas a `claim` de los premios que esperan en los contratos
 * de una campaña. La parte que mira cada premio con `get_prize` ya está en la red: la promoción y
 * cada `Prize(id, posición)` los lee `leerPromocion` (`stellar/premios.ts`, con sus fixtures de
 * verdad). Acá va lo que decide, premio por premio, si esa vuelta entrega o no:
 *
 * - llama cuando el premio espera (`Owed` o `Held`, los dos estados que la persona ve como Por
 *   recibir en `src/campana/premios-de-la-cuenta.ts`), todavía no venció el plazo para cobrar que le
 *   llega como dato (`cobrarHastaMs`) y la cuenta de quien ganó ya tiene la línea de esa moneda;
 * - no lo llama, con su motivo, en los demás casos: ya recibido, devuelto, vencido, sin línea,
 *   línea incierta, o una promoción que nunca podría pagar el premio (sin sello, cancelada,
 *   reembolsada).
 *
 * La decisión es pura y nunca mira la red ni el reloj de la máquina: la lectura la trae quien
 * llama, la hora y el plazo para cobrar entran aparte, y la presencia de la línea la cuenta una
 * función que le pasan (qué cuenta la consulta y con qué RPC es el trabajo del servicio, que es
 * quien satisface si el premio se puede pagar). Nunca lanza: lo que la red no contestó se dice tal
 * cual, sin inventar una decisión sobre un premio que no se leyó.
 */

/** ¿La cuenta tiene la línea de esa moneda? `true` con línea, `false` sin ella, `null` si no se pudo saber. */
export type LineaDeUnaCuenta = boolean | null;

/** Si la cuenta ya tiene la línea del activo de la promoción, como lo consultó quien llama. */
export type MirarLaLinea = (cuenta: string) => LineaDeUnaCuenta;

/** Por qué la vuelta no entrega un premio. Es lo que el registro anota junto al puesto (issue #176, S5). */
export type MotivoDeNoEntrega = "ya-recibido" | "volvio" | "vencido" | "sin-linea" | "no-se-sabe" | "sin-sello";

/** Una fila por premio de la promoción, en orden de puesto: qué haría la entrega esta vuelta con él. */
export type EntregaDelPremio =
  | { puesto: number; cuenta: string; monto: string; accion: "llamar" }
  | { puesto: number; cuenta: string; monto: string; accion: "no"; motivo: MotivoDeNoEntrega };

/** Lo que se mira antes de decidir cada premio. */
export interface LaEntrega {
  /**
   * Hasta cuándo se puede cobrar el premio (ms). Es un dato de entrada y la decisión no trae ningún plazo propio: lo
   * pone quien llama y tiene que ser el que deja el contrato de premios, no un plazo más corto de la campaña, o se
   * dejaría sin pagar a quien todavía puede cobrar.
   */
  cobrarHastaMs: number;
  /** El momento de la vuelta (ms). Un premio con la fecha límite exacta ya está vencido. */
  ahoraMs: number;
  /** Si la cuenta de quien ganó ya tiene la línea de la moneda del premio. Lo que no se sabe es `null`. */
  laLineaDe: MirarLaLinea;
}

/** La decisión entera de una promocion, o el por qué no se pudo leer. */
export type EntregasDeLaPromocion =
  | { ok: true; entregas: EntregaDelPremio[] }
  | { ok: false; error: ErrorDeLaPromocion };

/** La decisión de un premio: los estados que el contrato guarda y lo que la promoción entera pueda decir. */
function entregaDelPremio(premio: PremioDeLaPromocion, c: LaEntrega): EntregaDelPremio {
  const monto = premio.amount;
  if (premio.state === "Paid") return { puesto: premio.position, cuenta: premio.winner, monto: monto, accion: "no", motivo: "ya-recibido" };
  // Devuelto por el contrato, o una promoción cancelada o reembolsada que ya no va a pagar: el premio volvió a la empresa,
  // igual que lo ve la persona en `src/campana/premios-de-la-cuenta.ts`.
  if (premio.state === "Returned") return { puesto: premio.position, cuenta: premio.winner, monto: monto, accion: "no", motivo: "volvio" };
  const espera = premio.state === "Owed" || premio.state === "Held";
  // Un plazo que no es un número finito no dice hasta cuándo se puede cobrar: no se adivina ni se llama.
  if (espera && !Number.isFinite(c.cobrarHastaMs)) return { puesto: premio.position, cuenta: premio.winner, monto: monto, accion: "no", motivo: "no-se-sabe" };
  if (espera && c.ahoraMs >= c.cobrarHastaMs) return { puesto: premio.position, cuenta: premio.winner, monto: monto, accion: "no", motivo: "vencido" };
  if (espera) {
    // La línea no se puede saber también corta: un claim a una cuenta que no puede recibir el activo
    // gastaría una llamada y una comisión para un pago que la red rechaza. Se reintenta en la próxima vuelta.
    const linea = c.laLineaDe(premio.winner);
    if (linea === false) return { puesto: premio.position, cuenta: premio.winner, monto: monto, accion: "no", motivo: "sin-linea" };
    if (linea === null) return { puesto: premio.position, cuenta: premio.winner, monto: monto, accion: "no", motivo: "no-se-sabe" };
    return { puesto: premio.position, cuenta: premio.winner, monto: monto, accion: "llamar" };
  }
  // Ningún estado único del premio encaja (una respuesta que no es la de Tinkazo): no se llama y se dice sin saber.
  return { puesto: premio.position, cuenta: premio.winner, monto: monto, accion: "no", motivo: "no-se-sabe" };
}

/**
 * Qué haría la entrega con cada premio de una promoción, a partir de una lectura del contrato. Nunca lanza:
 * la lectura fallida sale tal cual (sin premios que decidir, y sin tocar la red: las líneas las consulta el
 * servicio recién cuando hay algo que esperar).
 */
export function entregasDeLaPromocion(lectura: LecturaDeLaPromocion, c: LaEntrega): EntregasDeLaPromocion {
  if (!lectura.ok) return { ok: false, error: lectura.error };
  const promo = lectura.promocion;
  const nuncaPaga = promo.status === "Cancelled" || promo.status === "Refunded";
  // Sin sello no hay ganadores de verdad (o la promoción no circuló como lo hace una de Tinkazo): no se entrega nada.
  const huboSello = promo.status === "Sealed" || promo.status === "Settled";
  return {
    ok: true,
    entregas: promo.premios.map((premio) => {
      if (nuncaPaga) return { puesto: premio.position, cuenta: premio.winner, monto: premio.amount, accion: "no", motivo: "volvio" };
      if (!huboSello) return { puesto: premio.position, cuenta: premio.winner, monto: premio.amount, accion: "no", motivo: "sin-sello" };
      return entregaDelPremio(premio, c);
    }) as EntregaDelPremio[],
  };
}

/* ------------------------------------------------------- esa promocion, de la red */

/** Lo que el lector de la red necesita: el contrato de premios de la campaña, el número de la promoción y la decisión. */
export interface OpcionesDeEntregasDeLaRed extends OpcionesDeLaPromocion, LaEntrega {
  /** El contrato de premios de la campaña, tal como lo designa la tabla de la red. */
  contrato: ContratoDePremios;
  /** El número de la promoción de la campaña, como texto (es un u64). */
  promo: string;
}

/** La misma decisión, pero sobre lo que la red dice ahora (`get_prize`). Nunca lanza: lo que falló viene con su motivo. */
export async function entregasDeLaRed(o: OpcionesDeEntregasDeLaRed): Promise<EntregasDeLaPromocion> {
  const lectura = await leerPromocion(o.contrato, o.promo, {
    ...(o.fetch ? { fetch: o.fetch } : {}),
    ...(o.tiempoMs !== undefined ? { tiempoMs: o.tiempoMs } : {}),
    ...(o.intentos !== undefined ? { intentos: o.intentos } : {}),
    ...(o.esperaMs !== undefined ? { esperaMs: o.esperaMs } : {}),
  });
  return entregasDeLaPromocion(lectura, o);
}
