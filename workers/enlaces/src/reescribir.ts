/**
 * Reescribir un enlace: solo el del QR de espectadores, que nació para cambiar.
 *
 * Con el QR de la espera en grande a la vista, quien organiza puede cambiar el juego. Los celulares que ya escanearon
 * vuelven a leer su enlace antes del show, y la sala reescribe ese mismo enlace con el juego nuevo, cifrado con la misma
 * clave: el QR no cambia y el servicio sigue sin ver nada. Un comprobante, en cambio, no puede cambiar nunca: con una
 * reescritura libre, quien armó uno podría cambiarlo por el de otro sorteo después de compartirlo. Por eso:
 *
 * - solo se reescribe un enlace creado con `?cambia=1` (los demás contestan 409);
 * - con el permiso de ese enlace (el mismo que sirve para borrarlo);
 * - hasta unas horas después de creado: alcanza para la espera de un sorteo, y después el enlace queda quieto;
 * - con un tope de cambios por enlace;
 * - si se pide una versión (`If-Match`), solo si es la que está: un reintento lento o una pestaña vieja no pisan una
 *   versión más nueva (412).
 */

/** Hasta cuántas horas después de creado se puede reescribir un enlace. */
export const REESCRIBIR_HORAS = 6;
/** Cuántas veces, como mucho, se reescribe un enlace. */
export const REESCRITURAS_MAX = 50;

export interface FilaQueCambia {
  /** La huella del permiso. */
  borrar: string;
  /** 1 si nació para cambiar. */
  cambia: number;
  version: number;
  cambios: number;
  /** Cuándo se creó (ms). */
  creado: number;
}

export type Decision = { ok: true; version: number } | { ok: false; estado: 403 | 404 | 409 | 412 | 429; error: string };

/** La versión como etiqueta HTTP (`ETag`, `If-Match`). */
export const etiqueta = (v: number): string => `"${v}"`;

/** Si `huella` (la del permiso que trae el pedido) puede reescribir la fila, con la versión pedida, a la hora `ahora`. */
export function decidirReescritura(fila: FilaQueCambia | null, huella: string, siEs: string | null, ahora: number): Decision {
  if (!fila) return { ok: false, estado: 404, error: "no-existe" };
  if (fila.borrar !== huella) return { ok: false, estado: 403, error: "token" };
  if (fila.cambia !== 1) return { ok: false, estado: 409, error: "no-cambia" };
  if (ahora - fila.creado > REESCRIBIR_HORAS * 3_600_000) return { ok: false, estado: 409, error: "vencido" };
  if (fila.cambios >= REESCRITURAS_MAX) return { ok: false, estado: 429, error: "tope" };
  if (siEs !== null && siEs !== etiqueta(fila.version)) return { ok: false, estado: 412, error: "version" };
  return { ok: true, version: fila.version + 1 };
}
