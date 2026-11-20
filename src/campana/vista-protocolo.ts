/**
 * Lo que se dicen la página para armar campañas y la vista en vivo (participar.html dentro de un marco). No importa nada del
 * celular: lo usan las dos páginas y la de armar no tiene por qué bajar las pantallas de la gente.
 */

import type { Lang } from "../idioma";

export const VISTA_PREVIA = "tinkazo:vista-de-campana";
export const VISTA_LISTA = "tinkazo:vista-lista";
/** El parámetro con que participar.html abre en modo vista: solo vale dentro de un marco. */
export const PARAMETRO_DE_VISTA = "vista";
export const VALOR_DE_VISTA = "previa";

export type PantallaDeVista = "previa" | "hola" | "adentro" | "ganaste";
export const PANTALLAS: readonly PantallaDeVista[] = ["previa", "hola", "adentro", "ganaste"];

/** La pantalla de la demostración que corresponde a cada pestaña. */
export const ESTADO_DE_PANTALLA: Record<PantallaDeVista, string | null> = {
  previa: null,
  hola: "hola",
  adentro: "adentro",
  ganaste: "ganaste",
};

/** Qué datos de la campaña son de muestra y se ven apagados. */
export interface MuestrasDeVista {
  nombre: boolean;
  premio: boolean;
  lugar: boolean;
  horas: boolean;
}

export interface MensajeDeVista {
  t: typeof VISTA_PREVIA;
  /** El objeto con la forma de la campaña, con los premios como texto. */
  campana: Record<string, unknown>;
  pantalla: PantallaDeVista;
  idioma: Lang;
  muestras: MuestrasDeVista;
  /** Verdadero solo cuando se acaba de tocar la pestaña Ganó: escribir no tira papel picado en cada letra. */
  festejar: boolean;
  /** Si el plegado de reglas de la pantalla previa se muestra abierto. */
  reglasAbiertas: boolean;
}

const esObjeto = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);

function leerMuestras(x: unknown): MuestrasDeVista | null {
  if (!esObjeto(x)) return null;
  const { nombre, premio, lugar, horas } = x;
  if (typeof nombre !== "boolean" || typeof premio !== "boolean" || typeof lugar !== "boolean" || typeof horas !== "boolean") return null;
  return { nombre, premio, lugar, horas };
}

/**
 * Lee un evento de mensaje. Null si no viene del mismo origen, si no lo manda la ventana de arriba o si no tiene la forma.
 * Una página de afuera que enmarque participar.html no puede mandarle nada que se acepte.
 */
export function leerMensajeDeVista(
  e: { origin: string; source: unknown; data: unknown },
  propio: { origen: string; padre: unknown },
): MensajeDeVista | null {
  if (propio.padre === null || propio.padre === undefined || e.source !== propio.padre || e.origin !== propio.origen) return null;
  const d = e.data;
  if (!esObjeto(d) || d.t !== VISTA_PREVIA || !esObjeto(d.campana)) return null;
  const pantalla = PANTALLAS.find((p) => p === d.pantalla);
  const muestras = leerMuestras(d.muestras);
  if (!pantalla || !muestras || (d.idioma !== "es" && d.idioma !== "en")) return null;
  if (typeof d.festejar !== "boolean" || typeof d.reglasAbiertas !== "boolean") return null;
  return { t: VISTA_PREVIA, campana: d.campana, pantalla, idioma: d.idioma, muestras, festejar: d.festejar, reglasAbiertas: d.reglasAbiertas };
}
