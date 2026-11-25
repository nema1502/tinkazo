import { type ContratoDePremios } from "../stellar/oficiales";
import {
  type ErrorDeLaPromocion,
  type LecturaDeLaPromocion,
  type OpcionesDeLaPromocion,
  type PremioDeLaPromocion,
  type Promocion,
  leerPromocion,
} from "../stellar/premios";

/**
 * Los premios de una cuenta de una campaña, leídos de la red sin servidor (issue #175).
 *
 * La pieza cliente de `get_prize`: una promoción de la campaña ya la lee `leerPromocion`
 * (`stellar/premios.ts`), que mira el `Promo(id)` y cada `Prize(id, posición)` del contrato de
 * premios. Esta pieza responde por una sola cuenta, con el estado que la persona entiende:
 *
 * - `Paid`: Recibido.
 * - `Owed` y `Held`: Por recibir, hasta cuando se puede cobrar (lo pone quien llama, con el límite que deja el contrato),
 *   y Venció si ese plazo ya pasó con la hora que también pone quien llama (la misma cuenta que hace la decisión de
 *   entregas en `stellar/entregas-decision.ts`: justo el día del plazo ya venció).
 * - `Returned`: Volvió a la empresa.
 * - Sin confirmar: una promoción que todavía no selló, un estado del premio que no se entiende, o un plazo o una hora que
 *   no son un número. No se promete nada que la entrega no haría.
 *
 * Una promoción cancelada o reembolsada no va a pagar los premios que no pagó: esos también volvieron.
 *
 * Nunca lanza. Lo que no se pudo leer de la red se dice tal cual, también `sin-estado`: sin leer el contrato no
 * se sabe si esta cuenta ganó ni qué le toca, así que no se inventa ningún premio.
 */

/** El estado de un premio, como lo ve quien ganó. */
export type EstadoVistoDelPremio = "recibido" | "por-recibir" | "volvio" | "vencido" | "sin-confirmar";

/** Un premio de la cuenta, ya en la forma de la pantalla. */
export interface PremioDeLaCuenta {
  /** El puesto del premio en la promoción, desde 0. */
  puesto: number | null;
  /** El monto, en unidades mínimas del activo, como texto. `null` si no se supo. */
  monto: string | null;
  estado: EstadoVistoDelPremio;
  /** Hasta cuándo se lo puede cobrar (ms), el dato que pone quien llama. Solo en Por recibir, y siempre un número finito. */
  hastaMs: number | null;
}

/** Lo que se pudo decir de los premios de una cuenta. */
export type VistaDeLosPremios =
  | { ok: true; premios: PremioDeLaCuenta[] }
  | { ok: false; error: ErrorDeLaPromocion };

/** El estado que se cuenta de un premio: el suyo, y lo que la promoción entera pueda decir. */
function estadoVistoDe(premio: PremioDeLaPromocion, promocion: Promocion, cobrarHastaMs: number, ahoraMs: number): EstadoVistoDelPremio {
  if (premio.state === "Paid") return "recibido";
  if (promocion.status === "Cancelled" || promocion.status === "Refunded" || premio.state === "Returned") return "volvio";
  // Sin sello no hay ganadores de verdad, y un estado que no es de Tinkazo no se sabe leer: no se promete nada.
  if (promocion.status !== "Sealed" && promocion.status !== "Settled") return "sin-confirmar";
  if (premio.state !== "Owed" && premio.state !== "Held") return "sin-confirmar";
  if (!Number.isFinite(cobrarHastaMs) || !Number.isFinite(ahoraMs)) return "sin-confirmar";
  return ahoraMs >= cobrarHastaMs ? "vencido" : "por-recibir";
}

/**
 * Los premios de la cuenta, en estados claros, a partir de una lectura del contrato. Pura: la lectura
 * la trae quien llama, así que la prueba la parte del fixture de la red y de las variantes del estado.
 */
export function premiosDeLaCuenta(lectura: LecturaDeLaPromocion, cuenta: string, cobrarHastaMs: number, ahoraMs: number): VistaDeLosPremios {
  if (!lectura.ok) return { ok: false, error: lectura.error };
  const premios: PremioDeLaCuenta[] = [];
  for (const premio of lectura.promocion.premios) {
    if (premio.winner !== cuenta) continue;
    const estado = estadoVistoDe(premio, lectura.promocion, cobrarHastaMs, ahoraMs);
    premios.push({ puesto: premio.position, monto: premio.amount, estado, hastaMs: estado === "por-recibir" ? cobrarHastaMs : null });
  }
  return { ok: true, premios };
}

/** Lo que el lector de la red necesita: el contrato de premios designado, el número de la promoción y la cuenta. */
export interface OpcionesDeLosPremiosDeLaCuenta extends OpcionesDeLaPromocion {
  /** El contrato de premios de la campaña, tal como lo designa la tabla de la red. */
  contrato: ContratoDePremios;
  /** El número de la promoción de la campaña, como texto (es un u64). */
  promo: string;
  /** La cuenta de quien ganó. */
  cuenta: string;
  /** Hasta cuándo se puede cobrar el premio (ms), con el límite que deja el contrato de premios. */
  cobrarHastaMs: number;
  /** El momento de la lectura, en milisegundos como `Date.now()`. La pieza no mira el reloj de la máquina. */
  ahoraMs: number;
}

/** La misma lista, leída de la red en el momento. Nunca lanza: lo que falló viene con su motivo. */
export async function premiosDeLaCuentaDeLaRed(o: OpcionesDeLosPremiosDeLaCuenta): Promise<VistaDeLosPremios> {
  const lectura = await leerPromocion(o.contrato, o.promo, {
    ...(o.fetch ? { fetch: o.fetch } : {}),
    ...(o.tiempoMs !== undefined ? { tiempoMs: o.tiempoMs } : {}),
    ...(o.intentos !== undefined ? { intentos: o.intentos } : {}),
    ...(o.esperaMs !== undefined ? { esperaMs: o.esperaMs } : {}),
  });
  return premiosDeLaCuenta(lectura, o.cuenta, o.cobrarHastaMs, o.ahoraMs);
}
