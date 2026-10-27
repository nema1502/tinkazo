/**
 * ¿Al sellar se pone todo en grande? (26 de octubre de 2026)
 *
 * Pedido del 26 de octubre: "al apretar «Sellar» la pantalla debería ponerse en grande sola, sin
 * una página intermedia que pida ponerla en pantalla completa". Quien organiza
 * suele estar frente a un proyector o con el celular en la mano para la sala: el
 * clic en "Sellar la lista" es el gesto que el navegador exige para la pantalla
 * completa, así que se pide ahí (`freeze.ts`, sincrónica, antes de cualquier
 * `await`) y, cuando el sello está, se abre la espera en grande (`espera.ts`).
 *
 * - Si el navegador la niega o no la ofrece (el iPhone no la da para elementos),
 *   se entra igual a la vista grande, que es una capa de la propia página.
 * - Si la persona la suelta (Escape, o "Volver a la página"), no se vuelve a
 *   forzar en esta sesión: queda a mano "Mostrar la espera en grande", que la
 *   vuelve a permitir. Vale para la pestaña (`sessionStorage`).
 * - El ensayo hace lo mismo que un sorteo de verdad: así se practica como va a ser.
 *
 * Los enlaces de prueba (`?demo=`, `?instant=`, `?lead=`, `?pace=`, `?pose=`) la
 * llevan a mano, como los auditores; `?grande=0` la apaga y `?grande=1` la fuerza
 * (para probarla con cualquier enlace). Hasta el 26 de octubre de 2026 la espera
 * solo se abría sola con 1280 px o más y sin pantalla táctil, y sin pantalla
 * completa: sin gesto, el navegador la rechaza.
 *
 * Este archivo no toca la página: lo usan `freeze.ts`, `draw.ts` y `espera.ts`, y
 * sus pruebas corren en Node.
 */

export const PARAMS_DE_PRUEBA = ["demo", "instant", "lead", "pace", "pose"] as const;

/** Dónde se recuerda, en esta pestaña, que la persona dijo que no. */
export const CLAVE_GRANDE = "tinkazo.grande";

export interface Entorno {
  /** `location.search`. */
  busqueda: string;
  /** Lo guardado en `sessionStorage[CLAVE_GRANDE]`, si se pudo leer. */
  guardado?: string | null;
}

/**
 * La persona (o el enlace) dijo que no a la pantalla en grande: no se pide la
 * pantalla completa ni se abre sola la vista grande, en ningún momento de esta sesión.
 */
export function grandeRechazada(e: Entorno): boolean {
  return new URLSearchParams(e.busqueda).get("grande") === "0" || e.guardado === "0";
}

/** Al apretar "Sellar la lista": ¿se pide la pantalla completa y se abre sola la vista grande? */
export function grandeAlSellar(e: Entorno): boolean {
  if (grandeRechazada(e)) return false;
  const q = new URLSearchParams(e.busqueda);
  if (q.get("grande") === "1") return true;
  return !PARAMS_DE_PRUEBA.some((p) => q.has(p));
}

/** Lo que el navegador permite hacer con la pantalla completa en este momento. */
export type PedidoDePantalla =
  /** Se pidió: dentro del clic, que es el gesto que el navegador exige. */
  | "pedida"
  /** Ya está en pantalla completa. */
  | "ya-esta"
  /** La persona dijo que no (o el enlace): no se pide. */
  | "rechazada"
  /** No hay gesto a mano: el navegador la negaría. */
  | "sin-gesto"
  /** El navegador no la ofrece (el iPhone, para elementos de la página). */
  | "sin-api";

export interface EstadoDeLaPantalla {
  hayApi: boolean;
  yaEnPantalla: boolean;
  gesto: boolean;
  rechazada: boolean;
}

/** Qué hacer con la pantalla completa. Pura: la que la pide de verdad es `pantalla-completa.ts`. */
export function decidirPantalla(e: EstadoDeLaPantalla): PedidoDePantalla {
  if (e.yaEnPantalla) return "ya-esta";
  if (e.rechazada) return "rechazada";
  if (!e.hayApi) return "sin-api";
  if (!e.gesto) return "sin-gesto";
  return "pedida";
}

/** También en la memoria de la página: con el almacenamiento bloqueado, el "no" vale igual hasta que se recargue. */
let rechazadaEnMemoria = false;

/** Lo guardado para esta pestaña, sin que un navegador con el almacenamiento bloqueado rompa nada. */
export function leerGuardado(): string | null {
  if (rechazadaEnMemoria) return "0";
  try {
    return sessionStorage.getItem(CLAVE_GRANDE);
  } catch {
    return null;
  }
}

/** La persona soltó la vista grande: no se vuelve a forzar en esta sesión. */
export function rechazarGrande(): void {
  rechazadaEnMemoria = true;
  try {
    sessionStorage.setItem(CLAVE_GRANDE, "0");
  } catch {
    /* sin almacenamiento, vale hasta que se recargue la página */
  }
}

/** La persona la pidió a mano ("Mostrar la espera en grande"): vuelve a valer. */
export function permitirGrande(): void {
  rechazadaEnMemoria = false;
  try {
    sessionStorage.removeItem(CLAVE_GRANDE);
  } catch {
    /* nada que olvidar */
  }
}

/** El entorno de ahora: la dirección y lo guardado. */
export function entornoDeAhora(): Entorno {
  return { busqueda: typeof location === "undefined" ? "" : location.search, guardado: leerGuardado() };
}
