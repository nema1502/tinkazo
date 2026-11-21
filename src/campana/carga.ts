/** Carga una campaña desde su sala y traduce las respuestas del servicio a estados de la pantalla. */

import { leerCampana, type Campana } from "./modelo";
import type { EstadoDeCarga } from "./previa";

/** Resultado de una carga, sin tocar el DOM. */
export type ResultadoDeCarga =
  | { ok: true; campana: Campana }
  | { ok: false; estado: Exclude<EstadoDeCarga, "cerrada"> };

/** Reloj mínimo que necesita el cargador para poder cancelar la espera. */
export interface RelojDeCarga {
  setTimeout: (handler: () => void, timeout: number) => ReturnType<typeof setTimeout>;
  clearTimeout: (id: ReturnType<typeof setTimeout>) => void;
}

/**
 * El reloj del navegador, envuelto. En un navegador, `setTimeout` y `clearTimeout` llamados como método de otro objeto
 * tiran `Illegal invocation`: guardarlos sueltos en un objeto rompía la página del celular apenas cargaba. Node no lo exige,
 * así que solo se ve en un navegador de verdad.
 */
export const RELOJ_DEL_NAVEGADOR: RelojDeCarga = {
  setTimeout: (handler, timeout) => setTimeout(handler, timeout),
  clearTimeout: (id) => clearTimeout(id),
};

/**
 * Pide la campaña a su sala con un límite de ocho segundos y valida su cuerpo. La sala la guarda como la firmó quien la
 * creó: el cuerpo es `{ texto, firma }` y el texto es el JSON de la campaña. El celular no verifica la firma, porque la
 * sala ya lo hizo antes de guardarla. Si la campaña es de otro evento que el del enlace, es `mal`.
 */
export async function cargarCampana(
  fetchServicio: typeof fetch,
  servicio: string,
  sala: string,
  evento: string,
  reloj: RelojDeCarga = RELOJ_DEL_NAVEGADOR,
): Promise<ResultadoDeCarga> {
  const controlador = new AbortController();
  const tiempo = reloj.setTimeout(() => controlador.abort(), 8000);
  try {
    const respuesta = await fetchServicio(
      `${servicio}/v1/sala/${encodeURIComponent(sala)}/campana`,
      { signal: controlador.signal, cache: "no-store" },
    );
    if (respuesta.status === 404) return { ok: false, estado: "no-esta" };
    if (!respuesta.ok) return { ok: false, estado: "sin-red" };
    let cuerpo: unknown;
    try {
      cuerpo = await respuesta.json();
    } catch (error) {
      return { ok: false, estado: error instanceof SyntaxError ? "mal" : "sin-red" };
    }
    const texto = (cuerpo as { texto?: unknown } | null)?.texto;
    if (typeof cuerpo !== "object" || cuerpo === null || typeof texto !== "string") return { ok: false, estado: "mal" };
    let campana: unknown;
    try {
      campana = JSON.parse(texto);
    } catch {
      return { ok: false, estado: "mal" };
    }
    const lectura = leerCampana(campana);
    if (!lectura.ok || lectura.campana.evento !== evento) return { ok: false, estado: "mal" };
    return lectura;
  } catch {
    return { ok: false, estado: "sin-red" };
  } finally {
    reloj.clearTimeout(tiempo);
  }
}
