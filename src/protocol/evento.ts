import { conHashesValidos, decodeFragment, encodeFragment, proofUrl, type Proof } from "./proof";

/**
 * El enlace de evento: varios sorteos del mismo evento, en uno o varios enlaces.
 *
 * Es el mismo formato que el comprobante (`proof.ts`): después del `#` va `z` o
 * `r` y el JSON en base64url. Tampoco pasa por ningún servidor, y los nombres
 * quedan en el navegador de quien lo abre. Cada sorteo es su comprobante, más
 * quiénes ganaron por nombre: sin eso la página no puede rehacer la selección.
 *
 * El tamaño crece con las personas de cada sorteo, no con la cantidad de
 * sorteos. Por eso no se corta por cantidad: el evento se reparte en enlaces que
 * no pasan `EVENTO_PRESUPUESTO_CARACTERES`, en orden de fecha. Ningún sorteo queda
 * afuera; uno solo que pesa más que el presupuesto va en un enlace propio.
 */

/** Versión del paquete. Sube si cambia la forma, no si cambia el contenido. */
export const EVENTO_VERSION = 1;

/**
 * Tamaño que se busca para cada enlace, en caracteres. Con 200 personas por
 * sorteo caben unos cuatro en uno. Más largo, algunos chats cortan el texto al
 * pegarlo; por eso el evento se parte antes de llegar ahí.
 */
export const EVENTO_PRESUPUESTO_CARACTERES = 8_000;

/** Un sorteo del evento: su comprobante y los ganadores por nombre, en el orden en que salieron. */
export interface SorteoDelEvento extends Proof {
  ganadores: string[];
}

export interface Evento {
  v: typeof EVENTO_VERSION;
  kind: "evento";
  /** El nombre del evento, con su fecha. Si hay varias partes, dice cuál es. */
  titulo: string;
  sorteos: SorteoDelEvento[];
}

/** Serializa un grupo de sorteos al texto que va después del `#`. */
export async function encodeEvento(titulo: string, sorteos: SorteoDelEvento[]): Promise<string> {
  // Los hashes de transacción de cada comprobante (`stx`, `dtx`) viajan con él, si están bien formados.
  const evento: Evento = { v: EVENTO_VERSION, kind: "evento", titulo, sorteos: sorteos.map(conHashesValidos) };
  return encodeFragment(evento);
}

/**
 * Parte los sorteos, en el orden que llegan (por fecha), en grupos cuyo enlace
 * no pasa el presupuesto. Un sorteo que no entra solo queda en un grupo propio.
 * El presupuesto no cuenta el sufijo de parte del título: es un margen.
 */
export async function partirEvento(
  titulo: string,
  sorteos: SorteoDelEvento[],
  presupuesto = EVENTO_PRESUPUESTO_CARACTERES,
): Promise<SorteoDelEvento[][]> {
  const partes: SorteoDelEvento[][] = [];
  let actual: SorteoDelEvento[] = [];
  for (const s of sorteos) {
    const prueba = [...actual, s];
    if (actual.length && (await encodeEvento(titulo, prueba)).length > presupuesto) {
      partes.push(actual);
      actual = [s];
    } else {
      actual = prueba;
    }
  }
  if (actual.length) partes.push(actual);
  return partes;
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
  // Lo que no es un hash de transacción no pasa: el enlace trae lo que quiso quien lo armó.
  return { ...(raw as Evento), sorteos: (raw as Evento).sorteos.map(conHashesValidos) };
}

/** Enlace completo a la página de evento, para un grupo de sorteos. */
export async function eventoUrl(titulo: string, sorteos: SorteoDelEvento[], base = location.origin): Promise<string> {
  return `${base}/evento.html#${await encodeEvento(titulo, sorteos)}`;
}

/**
 * Los enlaces del evento, uno por parte. Con más de una, el título de cada uno
 * dice cuál es (`parteDe` pone el texto, en el idioma de quien comparte).
 */
export async function eventosUrls(
  titulo: string,
  sorteos: SorteoDelEvento[],
  parteDe: (i: number, n: number) => string = (i, n) => ` · parte ${i} de ${n}`,
  base = location.origin,
): Promise<string[]> {
  const partes = await partirEvento(titulo, sorteos);
  return Promise.all(
    partes.map((parte, i) => eventoUrl(partes.length > 1 ? `${titulo}${parteDe(i + 1, partes.length)}` : titulo, parte, base)),
  );
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
