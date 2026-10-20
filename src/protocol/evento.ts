import { decodeFragment, encodeFragment, proofUrl, type Proof } from "./proof";

/**
 * El enlace de evento: varios sorteos del mismo evento, en un solo enlace.
 *
 * Es el mismo formato que el comprobante (`proof.ts`): después del `#` va `z` o
 * `r` y el JSON en base64url. Tampoco pasa por ningún servidor, y los nombres
 * quedan en el navegador de quien lo abre. Cada sorteo es su comprobante, más
 * quiénes ganaron por nombre: sin eso la página no puede rehacer la selección.
 */

/** Versión del paquete. Sube si cambia la forma, no si cambia el contenido. */
export const EVENTO_VERSION = 1;

/** Cuántos sorteos entran en un enlace. Más que esto, el texto se corta al pegarlo en un chat. */
export const EVENTO_TOPE = 30;
/** Desde este largo (unos 20 mil caracteres, unos 10 sorteos de 200) algunos chats cortan el enlace: se avisa antes de mandarlo. */
export const EVENTO_AVISO_CARACTERES = 20_000;

/** Un sorteo del evento: su comprobante y los ganadores por nombre, en el orden en que salieron. */
export interface SorteoDelEvento extends Proof {
  ganadores: string[];
}

export interface Evento {
  v: typeof EVENTO_VERSION;
  kind: "evento";
  /** El nombre del evento, con su fecha. */
  titulo: string;
  sorteos: SorteoDelEvento[];
  /** Cuántos sorteos del evento quedaron fuera por el tope. Solo aparece si hubo alguno. */
  mas?: number;
}

/**
 * Serializa el evento al texto que va después del `#`. Entran los primeros
 * sorteos (por fecha) hasta el tope; los demás se cuentan en `mas`.
 */
export async function encodeEvento(titulo: string, sorteos: SorteoDelEvento[]): Promise<string> {
  const entran = sorteos.slice(0, EVENTO_TOPE);
  const mas = sorteos.length - entran.length;
  const evento: Evento = {
    v: EVENTO_VERSION,
    kind: "evento",
    titulo,
    sorteos: entran,
    ...(mas > 0 ? { mas } : {}),
  };
  return encodeFragment(evento);
}

/**
 * Lee un enlace de evento. Lanza `evento-version` si es de otra versión y
 * `evento-malformed` si no tiene la forma de un evento.
 */
export async function decodeEvento(fragment: string): Promise<Evento> {
  const raw = (await decodeFragment(fragment)) as Partial<Evento> | null;
  if (!raw || typeof raw !== "object" || raw.kind !== "evento") throw new Error("evento-malformed");
  if (raw.v !== EVENTO_VERSION) throw new Error("evento-version");
  if (typeof raw.titulo !== "string" || !Array.isArray(raw.sorteos)) throw new Error("evento-malformed");
  if (raw.mas !== undefined && (!Number.isInteger(raw.mas) || raw.mas < 0)) throw new Error("evento-malformed");
  for (const s of raw.sorteos as Partial<SorteoDelEvento>[]) {
    const bien =
      !!s &&
      Array.isArray(s.names) &&
      s.names.every((n) => typeof n === "string") &&
      typeof s.round === "number" &&
      Array.isArray(s.ganadores) &&
      s.ganadores.every((n) => typeof n === "string");
    if (!bien) throw new Error("evento-malformed");
  }
  return raw as Evento;
}

/** Enlace completo a la página de evento. */
export async function eventoUrl(titulo: string, sorteos: SorteoDelEvento[], base = location.origin): Promise<string> {
  return `${base}/evento.html#${await encodeEvento(titulo, sorteos)}`;
}

/** El comprobante de un sorteo, sin los ganadores: es lo que lee `verificar.html`. */
export function comprobanteDe(s: SorteoDelEvento): Proof {
  const { ganadores: _ganadores, ...comprobante } = s;
  return comprobante;
}

/** El enlace a `verificar.html` con el comprobante de un sorteo del evento, para la comprobación en la cadena. */
export function verificarUrlDe(s: SorteoDelEvento, base = location.origin): Promise<string> {
  return proofUrl(comprobanteDe(s), base);
}
