/**
 * ¿La espera pasa sola a la vista grande? (decisión del 26 de octubre de 2026, barrido de letra y emoción)
 *
 * En una laptop o un proyector (1280 px de ancho o más, sin pantalla táctil) la sala mira la pantalla
 * de quien organiza: al sellar, la espera en grande se abre sola, con "Volver" a mano, y cuando nace el
 * número el sorteo arranca desde ahí y el resultado también sale en grande (`draw.ts`). En un celular o
 * una tablet no: la página es la vista.
 *
 * Los enlaces de prueba y de ensayo (`?demo=`, `?instant=`, `?lead=`, `?pace=`, `?pose=`) la llevan a mano,
 * como los auditores; `?grande=0` o `sessionStorage["tinkazo.grande"] = "0"` la apagan y `?grande=1` la
 * fuerza (para probarla en cualquier ancho).
 */
export const ANCHO_VISTA_GRANDE = 1280;

export const PARAMS_DE_PRUEBA = ["demo", "instant", "lead", "pace", "pose"] as const;

export interface Entorno {
  /** El ancho de la ventana, en píxeles de CSS. */
  ancho: number;
  /** `true` si el puntero principal es un dedo (`(pointer: coarse)`). */
  tactil: boolean;
  /** `location.search`. */
  busqueda: string;
  /** Lo guardado en `sessionStorage["tinkazo.grande"]`, si se pudo leer. */
  guardado?: string | null;
}

export function esperaSola(e: Entorno): boolean {
  const q = new URLSearchParams(e.busqueda);
  const pedido = q.get("grande");
  if (pedido === "0" || e.guardado === "0") return false;
  if (pedido === "1") return true;
  if (PARAMS_DE_PRUEBA.some((p) => q.has(p))) return false;
  return e.ancho >= ANCHO_VISTA_GRANDE && !e.tactil;
}

/** Lo guardado para esta pestaña, sin que un navegador con el almacenamiento bloqueado rompa nada. */
export function leerGuardado(): string | null {
  try {
    return sessionStorage.getItem("tinkazo.grande");
  } catch {
    return null;
  }
}
