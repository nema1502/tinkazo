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

/** La clave del historial donde la página guarda el enlace entero cuando limpia la dirección (ver `aislar.ts`). */
export const MARCA_DEL_ENLACE = "tinkazoEnlace";

/** Lo que la página sacó de la dirección y dejó en el historial de esta pestaña, o null si no hay nada con esa forma. */
export function enlaceGuardadoEnElHistorial(estado: unknown): { search: string; hash: string } | null {
  if (typeof estado !== "object" || estado === null) return null;
  const x = (estado as Record<string, unknown>)[MARCA_DEL_ENLACE];
  if (typeof x !== "object" || x === null) return null;
  const { search, hash } = x as Record<string, unknown>;
  return typeof search === "string" && typeof hash === "string" ? { search, hash } : null;
}

/**
 * El enlace de la campaña que abrió la página: el de la dirección y, si la página la limpió antes de bajar el guion de Google en
 * una campaña de personas, el que guardó el historial de esta pestaña. Recargar sigue abriendo la misma campaña.
 */
export function leerEnlaceDeLaPagina(
  ubicacion: Pick<Location, "search" | "hash"> = location,
  estado: unknown = history.state,
): EnlaceDeCampana | null {
  const aca = leerEnlaceDeCampana(ubicacion.search, ubicacion.hash);
  if (aca) return aca;
  const guardado = enlaceGuardadoEnElHistorial(estado);
  return guardado ? leerEnlaceDeCampana(guardado.search, guardado.hash) : null;
}
