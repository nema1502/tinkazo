/**
 * La vibración del celular: un golpe corto cuando sale el ganador.
 *
 * Solo donde el sistema la ofrece (Chrome de Android; el iPhone no tiene
 * `navigator.vibrate`), y apagable: la preferencia queda en este equipo. Con
 * movimiento reducido no vibra. Nunca es parte del sorteo: si algo falla, no
 * pasa nada.
 */

const CLAVE = "tinkazo.vibrar";

/** Patrones en milisegundos: vibra, pausa, vibra. */
const PATRONES = { cartel: [70, 50, 70, 50, 220], golpe: [40] } as const;

/** El sistema ofrece la vibración. */
export const vibracionDisponible = (): boolean => typeof navigator !== "undefined" && typeof navigator.vibrate === "function";

/** Está prendida (por defecto sí). */
export function vibracionOn(): boolean {
  try {
    return localStorage.getItem(CLAVE) !== "0";
  } catch {
    return true;
  }
}

export function setVibracion(on: boolean): void {
  try {
    localStorage.setItem(CLAVE, on ? "1" : "0");
  } catch {
    /* sin almacenamiento: vale para esta página nada más */
  }
}

/** Vibra con el patrón pedido, si se puede y no está apagada. */
export function vibrar(que: keyof typeof PATRONES): void {
  if (!vibracionDisponible() || !vibracionOn()) return;
  if (typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  try {
    navigator.vibrate([...PATRONES[que]]);
  } catch {
    /* algunos navegadores la niegan sin un toque reciente */
  }
}
