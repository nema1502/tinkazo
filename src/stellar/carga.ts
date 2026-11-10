import { buscarCarga, type ContextoHorizon } from "../../workers/cuenta/src/pagos";
import { pedirEvento } from "./cuenta-api";
import { network } from "./config";

/**
 * La primera carga: ¿ya llegaron los primeros dólares digitales a la cuenta?
 *
 * Se mira por Horizon si hay un pago entrante de USDC de 1 o más (`buscarCarga`, el mismo código que usa el Worker).
 * Si llegó y las monedas están prendidas, se le pide al Worker acreditar las 50: él lo vuelve a comprobar por su cuenta,
 * así que lo que diga el navegador no le importa. Si el Worker no contesta, el aviso de que los dólares llegaron se
 * da igual: las monedas se piden la próxima vez.
 */

export type ResultadoDeCarga =
  /** Llegó. `monedas` son las que se acreditaron ahora (0 si ya estaban o no hay monedas), `saldo` el total si se supo. */
  | { estado: "llego"; monedas: number; saldo: number | null }
  | { estado: "no-llego" }
  | { estado: "error" };

export function contextoHorizon(f: typeof fetch = (...a) => fetch(...a)): ContextoHorizon {
  return { red: network.name, fetch: f };
}

export async function revisarCarga(
  cuenta: string,
  o: { horizon: ContextoHorizon; base: string | null; fetch?: typeof fetch },
): Promise<ResultadoDeCarga> {
  const lectura = await buscarCarga(cuenta, o.horizon);
  if (!lectura.ok) return { estado: "error" };
  if (!lectura.valor) return { estado: "no-llego" };
  if (!o.base) return { estado: "llego", monedas: 0, saldo: null };
  const r = await pedirEvento(o.base, cuenta, "primera_carga", undefined, o.fetch ?? ((...a) => fetch(...a)));
  return { estado: "llego", monedas: r?.acreditado ? (r.monedas ?? 0) : 0, saldo: typeof r?.saldo === "number" ? r.saldo : null };
}
