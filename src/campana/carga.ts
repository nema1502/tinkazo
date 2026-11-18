/** Carga una campaña y traduce las respuestas del servicio a estados de la pantalla. */

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

/** Pide una campaña con un límite de ocho segundos y valida su cuerpo. */
export async function cargarCampana(
  fetchServicio: typeof fetch,
  direccion: string,
  evento: string,
  reloj: RelojDeCarga = { setTimeout, clearTimeout },
): Promise<ResultadoDeCarga> {
  const controlador = new AbortController();
  const tiempo = reloj.setTimeout(() => controlador.abort(), 8000);
  try {
    const respuesta = await fetchServicio(
      `${direccion}/v1/campanas/${encodeURIComponent(evento)}`,
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
    const lectura = leerCampana(cuerpo);
    if (!lectura.ok || lectura.campana.evento !== evento) return { ok: false, estado: "mal" };
    return lectura;
  } catch {
    return { ok: false, estado: "sin-red" };
  } finally {
    reloj.clearTimeout(tiempo);
  }
}
