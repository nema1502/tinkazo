import { readFileSync } from "node:fs";

/**
 * Qué juegos mira cada auditor cuando se le pide "todos".
 *
 * Una sola lista, para que el selector y los auditores no se desacomoden: el
 * 21 de octubre de 2026 el selector quedó en diez y cinco auditores seguían
 * midiendo trece, con tres que nadie puede elegir.
 */

/**
 * Los ocho del selector, en el orden de `docs/juegos.md`: son los que se pueden elegir.
 * De pie y El Trueque salieron el 26 de octubre de 2026 (siguen abriendo con `?demo=`).
 */
export const SELECTOR = ["race", "sapo", "trompo", "chovena", "pinata", "wheel", "teleferico", "oruro"];

/**
 * Los que salieron del selector y siguen abriendo con `?demo=`. No entran en un
 * `todos`: se piden por nombre (`audit-rigor.mjs tombola`) o con
 * `pnpm audit:todo --todos-los-juegos`.
 */
export const FUERA_DEL_SELECTOR = ["tombola", "pasanaku", "stellar", "luz", "ledger", "rockets", "totora", "quien", "trueque"];

/**
 * Un botón del selector está «apagado» cuando está pero no se ve: el propio botón (no el paso que lo contiene) con el
 * atributo `hidden`, `display: none` o `visibility: hidden`. Es una función para correr en la página (se pega en el
 * texto que se evalúa) y la usan igual `audit-game` (comprobación 7: dice «apagado») y `audit-ui` (qué botones cuentan
 * para las miniaturas): así los dos auditores no se desacuerdan sobre qué es un juego apagado.
 */
export const BOTON_APAGADO_JS = "((b) => b.hidden || getComputedStyle(b).display === 'none' || getComputedStyle(b).visibility === 'hidden')";

/**
 * El detalle de la comprobación 7 de `audit-game` ("el juego tiene su botón en
 * el selector"). El resultado de la comprobación depende solo de que el botón
 * exista; esto solo cambia lo que cuenta. Un botón que está pero oculto (el
 * atributo `hidden`, `display: none` o `visibility: hidden` en el propio botón)
 * es un juego apagado: se puede abrir con `?demo=` y nadie lo puede elegir, y
 * el detalle lo dice. Un botón que falta es otra cosa y sigue diciendo cuál.
 */
export function detalleDelBoton(opcion, juego) {
  if (!opcion) return `falta #g-${juego}`;
  const nombre = `"${String(opcion.text ?? "").trim()}"`;
  return opcion.apagado ? `${nombre} · apagado: el botón está oculto en el selector` : nombre;
}

/**
 * Los juegos del kit (`src/games/pixi/kit/catalogo.ts`), en el orden del catálogo.
 * Los lee del archivo, así que un juego que nace con `nuevo-juego.mjs` entra a
 * los auditores sin tocar esta lista. Todos tienen el golpe del director de
 * cámara (`kit/director.ts`): el pico de su zoom se mide dentro del golpe.
 */
export function juegosDelKit(raiz = new URL("../..", import.meta.url)) {
  const ruta = new URL("src/games/pixi/kit/catalogo.ts", raiz);
  const texto = readFileSync(ruta, "utf8");
  return [...texto.matchAll(/^\s*id:\s*"([a-z]{3,12})",/gm)].map((m) => m[1]);
}

/**
 * Los diez que hoy se pueden abrir y se auditan por completo: los ocho del selector y los dos que salieron el 26 de
 * octubre de 2026 (De pie y El Trueque, que siguen con su juego, su letra y su golpe de cámara). Un `todos` mira los ocho;
 * `diez` mira estos.
 */
export const LOS_DIEZ = [...SELECTOR, "quien", "trueque"];

/**
 * Los juegos de un pedido: "todos" son los del selector; "diez", los del selector más los dos que salieron (De pie y El
 * Trueque), para que ningún juego que todavía abre se quede sin auditar; una lista con comas, esos.
 */
export function juegosDe(cual) {
  if (!cual || cual === "todos") return [...SELECTOR];
  if (cual === "diez") return [...LOS_DIEZ];
  return String(cual).split(",").map((j) => j.trim()).filter(Boolean);
}
