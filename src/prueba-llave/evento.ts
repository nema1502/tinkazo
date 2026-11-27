import { humanizeEvents, xdr } from "@stellar/stellar-sdk";
import type { RespuestaCruda } from "./cobro";

/**
 * Lo que dejó una transferencia de monedas en lo que contesta la red: el monto y el número de nota. Cuando el destino es una
 * dirección M, el contrato de las monedas pone el número en el dato del evento, junto al monto. Nada se adivina: lo que no
 * se puede leer queda en `null`.
 */

export interface TransferenciaVista {
  monto: bigint;
  /** El número de nota, o `null` si el evento no trae ninguno. */
  nota: bigint | null;
}

function aEntero(x: unknown): bigint | null {
  if (typeof x === "bigint") return x;
  if (typeof x === "number" && Number.isInteger(x)) return BigInt(x);
  if (typeof x === "string" && /^\d+$/.test(x)) return BigInt(x);
  return null;
}

/** La primera transferencia del contrato de las monedas que traen los eventos de la transacción, o `null`. Nunca lanza. */
export function transferenciaDelEvento(cruda: RespuestaCruda, activo: string): TransferenciaVista | null {
  try {
    const grupos = cruda.events?.contractEventsXdr;
    if (!Array.isArray(grupos)) return null;
    for (const grupo of grupos) {
      if (!Array.isArray(grupo)) continue;
      for (const b64 of grupo) {
        try {
          const visto = humanizeEvents([xdr.ContractEvent.fromXDR(b64, "base64")])[0];
          if (!visto || visto.contractId !== activo || visto.topics[0] !== "transfer") continue;
          const datos: unknown = visto.data;
          const suelto = aEntero(datos);
          if (suelto !== null) return { monto: suelto, nota: null };
          if (typeof datos === "object" && datos !== null) {
            const d = datos as Record<string, unknown>;
            const monto = aEntero(d["amount"]);
            if (monto !== null) return { monto, nota: aEntero(d["to_muxed_id"]) };
          }
        } catch {
          /* un evento que no se entiende no cuenta */
        }
      }
    }
    return null;
  } catch {
    return null;
  }
}

/** Cómo quedó la nota: la que se pidió contra la que dejó la red. */
export type NotaDelEnvio = "confirmada" | "sin-dato" | "distinta" | "no-pedida";

export function notaDelEnvio(pedida: bigint | null, vista: TransferenciaVista | null): NotaDelEnvio {
  if (pedida === null) return "no-pedida";
  if (vista === null) return "sin-dato";
  return vista.nota === pedida ? "confirmada" : "distinta";
}
