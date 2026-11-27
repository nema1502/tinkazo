/**
 * La bandera de los modos nuevos del sorteo: `VITE_MODOS`. **Prendida por defecto desde el cambio 7e414660**:
 * el selector de modos es parte del producto, y una variable solo para apagarlo (`VITE_MODOS=0` al construir) queda
 * para un repliegue de emergencia, como `VITE_FOTO_JUEGO` (src/ui/foto-juego-bandera.ts).
 *
 * Hoy hay dos modos previstos en la dirección: `turnos` (el orden de turnos, que sortea a todas las personas de la
 * lista en orden) y `varias` (el reparto de participaciones, `src/participaciones.ts`).
 *
 * Los modos están a la vista en tres casos: por defecto (el sitio se construye con ellos), si la dirección trae
 * `?modo=turnos` (o `?modo=varias`), o si en esta pestaña ya se eligió un modo y quedó recordado (`recordarModo`).
 * El parámetro sirve para publicar el modo en un grupo y para probarlo sin cambiar lo que ve todo el mundo.
 *
 * No importa `state.ts` a propósito: ese módulo lee la dirección al cargar y esta bandera tiene que poder probarse sola.
 */

/** Los modos que conoce el código, incluso los que todavía no tienen pantalla. */
export type ModeName = "turnos" | "varias" | "amigo";

/**
 * Los modos que la dirección puede pedir. Amigo secreto queda afuera a propósito hasta que tenga pantalla: sumarlo acá
 * haría que `?modo=amigo` abriera la herramienta y mostrara los modos que sí existen, sin ofrecer todavía el modo pedido.
 */
const MODES: readonly ModeName[] = ["turnos", "varias"];

/** La parte de la dirección que trae los parámetros (`?modo=turnos`), o vacía si no hay dirección (pruebas). */
const currentSearch = (): string => (typeof location === "undefined" ? "" : location.search);

/** La bandera de construcción: prendida por defecto; solo `0` (o `false`) la apaga, para un repliegue de emergencia. */
export function modesFlagOn(value: unknown = import.meta.env.VITE_MODOS): boolean {
  return value !== "0" && value !== "false" && value !== 0 && value !== false;
}

/** El modo que pide la dirección (`?modo=turnos`), o `null` si no pide ninguno o pide uno que no existe. */
export function requestedMode(search: string = currentSearch()): ModeName | null {
  const value = (new URLSearchParams(search).get("modo") ?? "").trim().toLowerCase();
  return MODES.find((mode) => mode === value) ?? null;
}

/**
 * ¿La dirección pide un modo, y por eso la herramienta abre directo y no la portada? Es el enlace que se publica en un
 * grupo: `?modo=turnos` o `?modo=varias`. Cualquiera de los dos.
 */
export const abreLaHerramienta = (search: string = currentSearch()): boolean => requestedMode(search) !== null;

/** Donde queda el modo elegido en esta pestaña: vive en `sessionStorage`, como el borrador. */
const CLAVE_MODO = "tinkazo.modo";

/** Recuerda el modo elegido para esta pestaña: sigue vigente al recargar y al volver de entrar con la cuenta. */
export function recordarModo(modo: ModeName): void {
  try {
    if (typeof sessionStorage !== "undefined") sessionStorage.setItem(CLAVE_MODO, modo);
  } catch {
    /* sin almacenamiento, el modo vale solo mientras la dirección lo trae */
  }
}

/** El modo recordado en esta pestaña, o `null` si nadie eligió uno. */
export function modoRecordado(): ModeName | null {
  try {
    if (typeof sessionStorage === "undefined") return null;
    const value = sessionStorage.getItem(CLAVE_MODO);
    return MODES.find((mode) => mode === value) ?? null;
  } catch {
    return null;
  }
}

/** El modo vigente en esta pestaña: el que pide la dirección o, si ya no lo trae, el recordado. */
export function modoVigente(search: string = currentSearch()): ModeName | null {
  return requestedMode(search) ?? modoRecordado();
}

/**
 * ¿Los modos nuevos están a la vista? Con la bandera de construcción, con `?modo=` en la dirección o con un modo
 * ya elegido en esta pestaña. Al ver el parámetro se lo recuerda: entrar con la cuenta es irse a otra dirección
 * y volver sin él, y el modo del sorteo que se está armando no se puede perder en ese viaje.
 */
export function modesVisible(value: unknown = import.meta.env.VITE_MODOS, search: string = currentSearch()): boolean {
  const pedido = requestedMode(search);
  if (pedido) recordarModo(pedido);
  return modesFlagOn(value) || pedido !== null || modoRecordado() !== null;
}

/**
 * El enlace de verificación con el modo en que se hizo el sorteo, para que quien lo abre vea la misma forma de
 * contarlo. Solo cambia la dirección de `verificar.html`: el comprobante que va en el fragmento no cambia, y sin
 * modo el enlace queda exactamente como estaba.
 */
export function withMode(link: string, mode: ModeName | null): string {
  if (!mode) return link;
  try {
    const url = new URL(link);
    if (!url.pathname.endsWith("/verificar.html")) return link;
    url.searchParams.set("modo", mode);
    return url.toString();
  } catch {
    return link;
  }
}
