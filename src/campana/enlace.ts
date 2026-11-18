/**
 * Lectura del enlace que abre la pantalla previa desde un QR.
 * Solo valida sus partes locales: la clave nunca sale de la dirección hacia la sala, y el pase vive en la dirección
 * y en una variable de la página, nunca en el almacenamiento.
 */

/** Datos locales que vienen en el enlace de una campaña. */
export interface EnlaceDeCampana {
  evento: string;
  q: string | null;
  clave: string | null;
  /** La sala de la campaña (8 letras y números), o null si el enlace no la trae. */
  sala: string | null;
  /** El pase del QR del stand, que vence a los pocos minutos, o null si el enlace no lo trae. */
  pase: string | null;
}

const EVENTO = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/u;
const Q = /^\d{1,12}\.[A-Za-z0-9_-]{16}$/u;
const CLAVE = /^[A-Za-z0-9_-]{22}$/u;
const SALA = /^[0-9A-Za-z]{8}$/u;
const PASE = /^[A-Za-z0-9_-]{12}$/u;

/** Lee el evento, el código, la sala, el pase y la clave de la dirección. Una parte que viene sin su forma anula el enlace. */
export function leerEnlaceDeCampana(search: string, hash: string): EnlaceDeCampana | null {
  const parametros = new URLSearchParams(search);
  const evento = parametros.get("c") ?? "";
  const q = parametros.get("q");
  const sala = parametros.get("s");
  const pase = parametros.get("p");
  const clave = hash.replace(/^#/, "");
  if (!EVENTO.test(evento)) return null;
  if (q !== null && !Q.test(q)) return null;
  if (sala !== null && !SALA.test(sala)) return null;
  if (pase !== null && !PASE.test(pase)) return null;
  if (clave && !CLAVE.test(clave)) return null;
  return { evento, q, clave: clave || null, sala, pase };
}
