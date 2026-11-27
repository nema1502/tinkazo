/**
 * La pregunta que el panel de quien organiza le hace a la sala antes de cobrar una campaña de personas: si las tiene prendidas
 * y con el mismo identificador de cliente de Google (público) que el sitio. Con la sala apagada la campaña no se podría activar,
 * y con otro identificador nadie podría anotarse, así que sin un sí completo no se cobra.
 *
 * Es un pedido sin sesión ni token, que no gasta nada en la sala. Se baja recién cuando hay un borrador de personas a la vista.
 */
import { clienteDeGoogleDelSitio } from "../campana/persona-bandera";
import { servicioDeSala } from "./cliente";

/** Cuánto se espera la respuesta de la sala antes de darla por perdida. */
export const PLAZO_DE_PERSONAS_MS = 10_000;

/** Lo que se le puede cambiar desde afuera: en las pruebas, el pedido, la señal que corta la espera y el identificador del sitio. */
export interface DependenciasDePersonas {
  fetch?: typeof fetch;
  senal?: () => AbortSignal;
  /** El identificador de cliente de Google con que se construyó el sitio, o `null` si no abre campañas de personas. */
  cliente?: () => string | null;
}

const esObjeto = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);

/**
 * Si la sala tiene las campañas de personas listas para este sitio: contesta 200, dice que están prendidas y su identificador de
 * Google es el del sitio. Con cualquier otra cosa (apagadas, otro identificador, una sala de antes sin la ruta, sin respuesta a
 * tiempo, o un sitio que no abre campañas de personas), no. Nunca lanza.
 */
export async function personasListas(dep: DependenciasDePersonas = {}, servicio = servicioDeSala()): Promise<boolean> {
  try {
    const delSitio = (dep.cliente ?? clienteDeGoogleDelSitio)();
    // Un sitio sin identificador no abre ninguna campaña de personas: no hay con qué comparar ni nada que preguntar.
    if (delSitio === null || delSitio === "") return false;
    const senal = (dep.senal ?? ((): AbortSignal => AbortSignal.timeout(PLAZO_DE_PERSONAS_MS)))();
    const r = await (dep.fetch ?? fetch)(`${servicio}/v1/personas/estado`, { signal: senal });
    if (r.status !== 200) return false;
    const x: unknown = await r.json();
    return esObjeto(x) && x.prendido === true && x.cliente === delSitio;
  } catch {
    return false;
  }
}
