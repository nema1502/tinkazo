/**
 * Qué juegos mira cada auditor cuando se le pide "todos".
 *
 * Una sola lista, para que el selector y los auditores no se desacomoden: el
 * 21 de octubre de 2026 el selector quedó en diez y cinco auditores seguían
 * midiendo trece, con tres que nadie puede elegir.
 */

/** Los diez del selector, en el orden de `docs/juegos.md`: son los que se pueden elegir. */
export const SELECTOR = ["race", "sapo", "trompo", "chovena", "pinata", "wheel", "quien", "trueque", "teleferico", "oruro"];

/**
 * Los que salieron del selector y siguen abriendo con `?demo=`. No entran en un
 * `todos`: se piden por nombre (`audit-rigor.mjs tombola`) o con
 * `pnpm audit:todo --todos-los-juegos`.
 */
export const FUERA_DEL_SELECTOR = ["tombola", "pasanaku", "stellar", "luz", "ledger", "rockets", "totora"];

/** Los juegos de un pedido: "todos" son los del selector; una lista con comas, esos. */
export function juegosDe(cual) {
  if (!cual || cual === "todos") return [...SELECTOR];
  return String(cual).split(",").map((j) => j.trim()).filter(Boolean);
}
