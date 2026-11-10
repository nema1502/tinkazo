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

/** Los nombres de los equipos de ahora, como se ven en el show: los que nunca se acortan (`games/nombres-enteros.ts`). */
export const nombresDeLosEquipos = (): string[] => [...etiquetas.values()];

/** El nombre del equipo de esa línea, o la línea tal cual si no es de ningún equipo. */
export const etiquetaDe = (linea: string): string => etiquetas.get(linea) ?? linea;

/** El nombre del equipo y su cuenta acortada: «Los Cóndores (GABC…WXYZ)». Sin etiqueta, la línea tal cual. */
export function etiquetaConCuenta(linea: string): string {
  const e = etiquetas.get(linea);
  return e === undefined ? linea : `${e} (${cuentaCorta(linea)})`;
}

/**
 * Los nombres para mostrar de una lista completa de líneas, deshaciendo los choques: cuando dos equipos comparten
 * nombre («Equipo 7»), los dos carteles llevan la cuenta corta — «Equipo 7 (GABC…WXYZ)», como la tarjeta del
 * resultado — y así la sala sabe cuál es cuál; los nombres que no se repiten quedan igual. Sin etiquetas, las líneas
 * tal cual: son cuentas, ya se distinguen solas.
 */
export const paraMostrar = (lineas: readonly string[]): string[] => {
  if (!etiquetas.size) return [...lineas];
  const nombres = lineas.map(etiquetaDe);
  const veces = new Map<string, number>();
  for (const n of nombres) veces.set(n, (veces.get(n) ?? 0) + 1);
  return nombres.map((n, i) => ((veces.get(n) ?? 0) > 1 ? `${n} (${cuentaCorta(lineas[i] ?? "")})` : n));
};
