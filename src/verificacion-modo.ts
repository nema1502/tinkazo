import type { Ancla } from "./protocol/verificacion";

/**
 * El modo que dice la verificación. Con el modo Oficial a la vista, el rótulo de arriba y la línea de la cadena nombran
 * el modo (Prueba u Oficial) y no la red. Pero "Oficial" avala: solo lo dice un comprobante cuyo contrato está en la
 * lista oficial, y el modo sale de ese contrato, no del `net` que trae el enlace (que cualquiera arma a mano). Un enlace
 * ajeno o deforme queda con lo que trae, y el veredicto de abajo dice que no es el registro de Tinkazo. Sin modo
 * Oficial no hay nada que distinguir: el rótulo es el de siempre.
 */

type Texto = (clave: string) => string;

/** El nombre visible del modo de una red de la lista oficial. */
const nombreDeLaRed = (red: "testnet" | "mainnet", t: Texto): string => t(red === "mainnet" ? "netMain" : "netTest");

/**
 * El rótulo de arriba de las comprobaciones: el modo y `resto` (el número o el código del sello). `marca` es si lleva
 * la ficha naranja de Prueba.
 */
export function rotuloDelModo(ancla: Ancla, net: unknown, resto: string, hayModoOficial: boolean, t: Texto): { texto: string; marca: boolean } {
  if (!hayModoOficial || ancla.tipo !== "oficial") return { texto: `${String(net ?? "")}, ${resto}`, marca: false };
  return { texto: `${nombreDeLaRed(ancla.contrato.red, t)}, ${resto}`, marca: ancla.contrato.red === "testnet" };
}

/**
 * La línea de la comprobación de la cadena en el caso verde. Solo se llega acá con el ancla oficial, así que el `net`
 * ya es el de un contrato de la lista.
 */
export function detalleDeLaRed(proof: { id?: unknown; net?: unknown }, hayModoOficial: boolean, t: Texto): string {
  const modo = !hayModoOficial ? String(proof.net) : proof.net === "mainnet" ? t("netMain") : proof.net === "testnet" ? t("netTest") : String(proof.net);
  return `#${String(proof.id)}, ${modo}`;
}
