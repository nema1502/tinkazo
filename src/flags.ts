/**
 * Banderas del sitio, en un solo lugar.
 *
 * Cada bandera está apagada por defecto: sin la variable de construcción ni
 * el parámetro que la prende, la herramienta es la de siempre. El patrón es el
 * de `src/modos/bandera.ts`: una variable `VITE_*` para publicarla a propósito
 * y un parámetro de la dirección para probarla sin cambiar lo que ve todo el
 * mundo. No importa `state.ts` a propósito: ese módulo lee la dirección al
 * cargar y una bandera tiene que poder probarse sola.
 */

/** La parte de la dirección que trae los parámetros, o vacía si no hay dirección (pruebas). */
const currentSearch = (): string => (typeof location === "undefined" ? "" : location.search);

/**
 * La bandera de la medición del video del sorteo (`src/video/`): volver a dibujar
 * el show de un juego cuadro a cuadro y codificarlo con MediaRecorder. Apagada
 * por defecto. Se prende con `VITE_VIDEO_DESCARGA=1 pnpm build` o, solo para
 * medir, con `?video=medir` en la dirección.
 */
export function videoDescarga(value: unknown = import.meta.env.VITE_VIDEO_DESCARGA, search: string = currentSearch()): boolean {
  if (value === "1") return true;
  return new URLSearchParams(search).get("video") === "medir";
}
