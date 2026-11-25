import { esLineaDePersona } from "../../workers/sala/src/linea-persona";
import { texto as t } from "../idioma";
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
 *
 * La excepción es la línea de una persona (campañas de personas, `p1:` y 26 caracteres): no dice quién es y no se muestra
 * nunca. Si este navegador conoce su nombre va el nombre, y si no, su lugar en la lista («Lugar 3»), o «Sin nombre»
 * si no está en la lista del cuadro.
 */

/** La clave de este navegador donde quedan las etiquetas (`[[cuenta, nombre], …]`): la escribe el registro de equipos y la leen el show, el resultado y el panel de ganadores. */
export const CLAVE_ETIQUETAS = "tinkazo.equipos.etiquetas";

/** La clave de la pestaña donde queda de qué son las etiquetas, solo cuando son de personas (las de una campaña). */
export const CLAVE_PALABRA_ETIQUETAS = "tinkazo.equipos.palabra";

/** De qué son las etiquetas: de equipos (el registro de equipos) o de personas (los nombres de una campaña de empresa). */
export type PalabraDeEtiquetas = "equipos" | "personas";

let etiquetas = new Map<string, string>();
let palabra: PalabraDeEtiquetas = "equipos";

/**
 * Pone las etiquetas de ahora (las de un sorteo anterior se van) y las recuerda en esta pestaña. Con `personas`, que es lo
 * de una campaña de empresa, la lista no es de equipos: los textos que cuentan la lista dicen personas aunque cada línea tenga
 * su etiqueta. Sin segundo parámetro son de equipos, como siempre.
 */
export function ponerEtiquetas(nuevas: ReadonlyMap<string, string>, de: PalabraDeEtiquetas = "equipos"): void {
  etiquetas = new Map(nuevas);
  palabra = etiquetas.size ? de : "equipos";
  try {
    if (etiquetas.size) sessionStorage.setItem(CLAVE_ETIQUETAS, JSON.stringify([...etiquetas]));
    else sessionStorage.removeItem(CLAVE_ETIQUETAS);
    if (palabra === "personas") sessionStorage.setItem(CLAVE_PALABRA_ETIQUETAS, palabra);
    else sessionStorage.removeItem(CLAVE_PALABRA_ETIQUETAS);
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
  if (!m.size) return;
  etiquetas = m;
  try {
    palabra = sessionStorage.getItem(CLAVE_PALABRA_ETIQUETAS) === "personas" ? "personas" : "equipos";
  } catch {
    palabra = "equipos";
  }
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

/** Si las etiquetas de ahora son nombres de personas (los de una campaña de empresa) y no de equipos. */
export const etiquetasSonDePersonas = (): boolean => etiquetas.size > 0 && palabra === "personas";

/**
 * Si una lista es de equipos: no está vacía y cada línea es la cuenta de un equipo que este navegador conoce. Una sola
 * línea que no lo sea (una persona, o un equipo de otro día) la vuelve una lista de personas. Es lo que decide la palabra
 * de los textos que cuentan la lista: tener etiquetas en memoria no alcanza, porque después de sortear con equipos
 * pueden quedar ahí mientras se pega otra lista. Las etiquetas de una campaña (`personas`) nunca la vuelven de equipos.
 */
export const esListaDeEquipos = (lineas: readonly string[]): boolean =>
  palabra === "equipos" && lineas.length > 0 && lineas.every((l) => etiquetas.has(l));

/** El cuadro como estaba la última vez que se miró, con el lugar de cada línea: se recorre una vez por cambio y no una por línea. */
let valorDelCuadro: string | null = null;
let lugaresDelCuadro = new Map<string, number>();

/** El lugar de una línea en la lista del cuadro, desde 0, o -1 si el cuadro no la tiene (o la página no tiene cuadro). */
function lugarEnElCuadro(linea: string): number {
  if (typeof document === "undefined") return -1;
  const ta = document.getElementById("ta");
  if (!(ta instanceof HTMLTextAreaElement)) return -1;
  if (ta.value !== valorDelCuadro) {
    valorDelCuadro = ta.value;
    lugaresDelCuadro = new Map(canonicalList(ta.value).map((l, i): [string, number] => [l, i]));
  }
  return lugaresDelCuadro.get(linea) ?? -1;
}

const conN = (clave: string, n: number): string => t(clave).replace("{n}", String(n));

/** Cómo se nombra a una persona sin nombre: su lugar en la lista, que empieza en 1 («Lugar 3»). */
const lugarCorto = (n: number): string => conN("vLugar", n);

/** Lo que se ve de una línea de persona sin nombre: su lugar en el cuadro, o «Sin nombre» si el cuadro no la tiene. */
function sinNombre(linea: string): string {
  const i = lugarEnElCuadro(linea);
  return i >= 0 ? lugarCorto(i + 1) : t("vPersonaAnotada");
}

/** El lugar en la lista sellada, desde 1, dicho para quien lee un enlace o un comprobante: «Lugar 3 de la lista». */
export const lugarEnLaLista = (indice: number): string => conN("vLugarDeLaLista", indice + 1);

/**
 * Cómo se nombra a quien está en ese lugar de la lista (desde 0) cuando se la lee en un celular: el nombre, si la lista
 * lo trae, y si no, el lugar. Nunca la línea. Sirve para una línea de persona: la de una cuenta o un nombre libre sigue
 * por `etiquetaConCuenta`.
 */
export const nombreOLugar = (linea: string, indice: number): string => etiquetas.get(linea) ?? lugarEnLaLista(indice);

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

/**
 * El nombre del equipo de esa línea, o la línea tal cual si no es de ningún equipo. Una línea de persona sin nombre dice su
 * lugar en el cuadro, y nunca la línea.
 */
export function etiquetaDe(linea: string): string {
  const e = etiquetas.get(linea);
  if (e !== undefined) return e;
  return esLineaDePersona(linea) ? sinNombre(linea) : linea;
}

/**
 * El nombre del equipo y su cuenta acortada: «Los Cóndores (GABC…WXYZ)». Sin etiqueta, la línea tal cual. Una línea de
 * persona no lleva cuenta al lado: dice su nombre, o su lugar, y nada de la línea.
 */
export function etiquetaConCuenta(linea: string): string {
  if (esLineaDePersona(linea)) return etiquetaDe(linea);
  const e = etiquetas.get(linea);
  return e === undefined ? linea : `${e} (${cuentaCorta(linea)})`;
}

/**
 * Las líneas de una lista como se muestran en el show: el nombre de cada equipo y, de cada persona, su nombre o su lugar en
 * esta misma lista (el índice más 1, que es el lugar en la lista sellada).
 */
export function paraMostrar(lineas: readonly string[]): string[] {
  if (!etiquetas.size && !lineas.some((l) => esLineaDePersona(l))) return [...lineas];
  return lineas.map((l, i) => etiquetas.get(l) ?? (esLineaDePersona(l) ? lugarCorto(i + 1) : l));
}
