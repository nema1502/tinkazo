import { canonicalList } from "../protocol/canonical";
import { cuentaCorta } from "./modelo";

/**
 * Los nombres de los equipos, solo para mostrar.
 *
 * La lista que se sella tiene cuentas (`GABC…`): una por línea. El nombre del equipo queda como etiqueta local, en
 * este navegador, para que el show y el resultado digan «Los Cóndores» y no 56 letras. Nunca va a la cadena ni a un
 * servidor, ni entra en el comprobante: el sello, la huella y el comprobante son de las cuentas.
 *
 * Una línea sin etiqueta se muestra tal cual, como siempre: con la bandera apagada esto no cambia nada.
 */

/** La clave de este navegador donde quedan las etiquetas (`[[cuenta, nombre], …]`): la escribe el registro de equipos y la leen el show, el resultado y el panel de ganadores. */
export const CLAVE_ETIQUETAS = "tinkazo.equipos.etiquetas";

let etiquetas = new Map<string, string>();

/** Pone las etiquetas de ahora (las de un sorteo anterior se van) y las recuerda en esta pestaña. */
export function ponerEtiquetas(nuevas: ReadonlyMap<string, string>): void {
  etiquetas = new Map(nuevas);
  try {
    if (etiquetas.size) sessionStorage.setItem(CLAVE_ETIQUETAS, JSON.stringify([...etiquetas]));
    else sessionStorage.removeItem(CLAVE_ETIQUETAS);
  } catch {
    /* sin almacenamiento, duran lo que la página */
  }
}

/** Lo que quedó en esta pestaña, o nada: sin almacenamiento o con algo roto, no hay etiquetas. */
function leerDeLaPestana(): Map<string, string> {
  const m = new Map<string, string>();
  try {
    const x = JSON.parse(sessionStorage.getItem(CLAVE_ETIQUETAS) ?? "null") as unknown;
    if (!Array.isArray(x)) return m;
    for (const par of x) if (Array.isArray(par) && typeof par[0] === "string" && typeof par[1] === "string") m.set(par[0], par[1]);
  } catch {
    /* nada que reponer */
  }
  return m;
}

/** Repone las de esta pestaña, si la página se recargó. */
export function reponerEtiquetas(): void {
  const m = leerDeLaPestana();
  if (m.size) etiquetas = m;
}

/**
 * El nombre del equipo de una cuenta, si este navegador lo conoce: de la memoria o de lo que quedó en la pestaña (la
 * misma clave que escribe el registro de equipos). Es lo que el panel de ganadores pone al lado del estado del pago.
 */
export function nombreDelEquipo(cuenta: string): string | undefined {
  const v = (etiquetas.size ? etiquetas : leerDeLaPestana()).get(cuenta);
  return typeof v === "string" && v.trim() ? v.trim().slice(0, 60) : undefined;
}

export const hayEtiquetas = (): boolean => etiquetas.size > 0;

/**
 * Si una lista es de equipos: no está vacía y cada línea es la cuenta de un equipo que este navegador conoce. Una sola
 * línea que no lo sea (una persona, o un equipo de otro día) la vuelve una lista de personas. Es lo que decide la palabra
 * de los textos que cuentan la lista: tener etiquetas en memoria no alcanza, porque después de sortear con equipos
 * pueden quedar ahí mientras se pega otra lista.
 */
export const esListaDeEquipos = (lineas: readonly string[]): boolean => lineas.length > 0 && lineas.every((l) => etiquetas.has(l));

/** La lista que está en el cuadro de la herramienta. Vacía en una página que no lo tiene. */
function lineasDelCuadro(): string[] {
  if (typeof document === "undefined") return [];
  const ta = document.getElementById("ta");
  return ta instanceof HTMLTextAreaElement ? canonicalList(ta.value) : [];
}

/**
 * Si la lista del cuadro es de equipos. Se lee al momento, sin recordar nada: es la palabra de los textos que no traen
 * su lista a mano (la barra de lo que sigue, el aviso de que ya entraste, el motivo para entrar, la cuenta de junto al
 * cuadro y el resumen de Sellar la lista). Sin etiquetas, que es lo de quien sortea con una lista común, no se recorre
 * el cuadro: se responde antes de leerlo.
 */
export const cuadroEsDeEquipos = (): boolean => etiquetas.size > 0 && esListaDeEquipos(lineasDelCuadro());

/** Los nombres de los equipos de ahora, como se ven en el show: los que nunca se acortan (`games/nombres-enteros.ts`). */
export const nombresDeLosEquipos = (): string[] => [...etiquetas.values()];

/** El nombre del equipo de esa línea, o la línea tal cual si no es de ningún equipo. */
export const etiquetaDe = (linea: string): string => etiquetas.get(linea) ?? linea;

/** El nombre del equipo y su cuenta acortada: «Los Cóndores (GABC…WXYZ)». Sin etiqueta, la línea tal cual. */
export function etiquetaConCuenta(linea: string): string {
  const e = etiquetas.get(linea);
  return e === undefined ? linea : `${e} (${cuentaCorta(linea)})`;
}

/** Las líneas de una lista como se muestran en el show: el nombre de cada equipo. */
export const paraMostrar = (lineas: readonly string[]): string[] => (etiquetas.size ? lineas.map(etiquetaDe) : [...lineas]);
