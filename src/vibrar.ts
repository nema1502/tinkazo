/**
 * La vibración del celular: un golpe corto cuando sale el ganador y otro, más
 * corto, cuando una llama se echa en el pelotón de la carrera.
 *
 * Solo donde el sistema la ofrece (Chrome de Android; el iPhone no tiene
 * `navigator.vibrate`) y solo si la persona ya tocó la página: sin ese toque
 * Chrome la bloquea y deja un aviso en la consola. Apagable: la preferencia
 * queda en este equipo, y `?vibrar=0` la apaga para esa visita. Con movimiento
 * reducido no vibra. Es presentación: nunca es parte del sorteo, y si algo
 * falla, no pasa nada.
 */

const CLAVE = "tinkazo.vibrar";

/** Patrones en milisegundos: vibra, pausa, vibra. */
export const PATRONES = { cartel: [70, 50, 70, 50, 220], golpe: [40], caida: [30] } as const;
export type Patron = keyof typeof PATRONES;

/** El sistema ofrece la vibración. */
export const vibracionDisponible = (): boolean => typeof navigator !== "undefined" && typeof navigator.vibrate === "function";

/** Está prendida (por defecto sí): ni `?vibrar=0` ni la preferencia guardada la apagaron. */
export function vibracionOn(): boolean {
  try {
    if (new URLSearchParams(location.search).get("vibrar") === "0") return false;
  } catch {
    /* sin location: sigue */
  }
  try {
    return localStorage.getItem(CLAVE) !== "0";
  } catch {
    return true;
  }
}

/** Prende o apaga la vibración en este aparato. */
export function setVibracion(on: boolean): void {
  try {
    localStorage.setItem(CLAVE, on ? "1" : "0");
  } catch {
    /* sin almacenamiento: vale para esta página nada más */
  }
}

/** Vibra con el patrón pedido, si se puede y no está apagada. Devuelve si lo pidió. */
export function vibrar(que: Patron): boolean {
  if (!vibracionDisponible() || !vibracionOn()) return false;
  if (typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches) return false;
  const act = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation;
  if (act && !act.hasBeenActive) return false;
  try {
    return navigator.vibrate([...PATRONES[que]]);
  } catch {
    /* algunos navegadores la niegan sin un toque reciente */
    return false;
  }
}
