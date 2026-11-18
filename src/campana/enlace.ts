/**
 * Lectura del enlace que abre la pantalla previa desde un QR.
 * Solo valida sus partes locales y deja el código y la clave para la siguiente pieza.
 */

/** Datos locales que vienen en el enlace de una campaña. */
export interface EnlaceDeCampana {
  evento: string;
  q: string | null;
  clave: string | null;
}

const EVENTO = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/u;
const Q = /^\d{1,12}\.[A-Za-z0-9_-]{16}$/u;
const CLAVE = /^[A-Za-z0-9_-]{22}$/u;

/** Lee el evento, el código opcional y la clave opcional de la dirección. */
export function leerEnlaceDeCampana(search: string, hash: string): EnlaceDeCampana | null {
  const parametros = new URLSearchParams(search);
  const evento = parametros.get("c") ?? "";
  const q = parametros.get("q");
  const clave = hash.replace(/^#/, "");
  if (!EVENTO.test(evento)) return null;
  if (q !== null && !Q.test(q)) return null;
  if (clave && !CLAVE.test(clave)) return null;
  return { evento, q, clave: clave || null };
}

