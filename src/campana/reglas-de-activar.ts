import { CENTAVO, DOLAR } from "./comision";

/**
 * Las reglas de una campaña que se activa sola al pagar, además de las del lector de siempre. Las usan la sala, que no firma lo
 * que no las cumple (`POST /v1/activar`), y el panel de quien organiza, que las mira antes de cobrar: así nadie paga una
 * comisión por una campaña que después no se puede activar. Puro: sin red, sin DOM y sin reloj propio.
 */

/** Lo más lejos que puede cerrar la inscripción de una campaña que se activa sola. */
export const DIAS_PARA_CERRAR = 7;
const DIA_MS = 86_400_000;
/** Cada premio, de 1 a 10.000 dólares digitales en centavos justos, y de 1 a 10 premios. */
export const PREMIO_MINIMO = DOLAR;
export const PREMIO_MAXIMO = 10_000n * DOLAR;
export const PREMIOS_MAXIMOS = 10;

/**
 * Letras y cifras que se leen como otra letra latina: las cirílicas y griegas que se escriben igual, y las cifras con que se
 * disfraza una palabra. Se aplican después de bajar a minúscula.
 */
const PARECIDAS: Readonly<Record<string, string>> = {
  "а": "a", // а cirílica
  "е": "e", // е cirílica
  "о": "o", // о cirílica
  "і": "i", // і cirílica
  "к": "k", // к cirílica
  "т": "t", // т cirílica
  "н": "n", // н cirílica (la mayúscula se lee H, la minúscula pequeña se confunde con n)
  "з": "z", // з cirílica
  "α": "a", // alfa
  "ο": "o", // ómicron
  "ι": "i", // iota
  "κ": "k", // kappa
  "τ": "t", // tau
  "ζ": "z", // zeta
  "η": "n", // eta
  "ı": "i", // i sin punto
  l: "i",
  "0": "o",
  "1": "i",
  "2": "z",
  "4": "a",
  "7": "t",
};

/**
 * El texto como se lee: en su forma compatible (las letras anchas, las de las fórmulas y las ligaduras pasan a las de siempre),
 * sin acentos ni mayúsculas, con las letras parecidas cambiadas por la latina y sin nada que no sea letra o cifra.
 */
function comoSeLee(texto: string): string {
  const base = texto.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
  let leido = "";
  for (const letra of base) leido += PARECIDAS[letra] ?? letra;
  return leido.replace(/[^\p{L}\p{N}]/gu, "");
}

/** Si el nombre de la empresa dice Tinkazo: nadie se hace pasar por el servicio, ni con acentos, signos o letras parecidas. */
export const nombreImita = (nombre: string): boolean => comoSeLee(nombre).includes("tinkazo");

/** El campo que no cumple las reglas, con el nombre que usa el archivo de la campaña. */
export type CampoDeActivar = "premios" | "cierra_ms" | "sorteo_ms" | "empresa.nombre";

/** Lo que miran las reglas de una campaña ya leída. */
export interface LoQueSeActiva {
  premios: readonly bigint[];
  cierraMs: number;
  sorteoMs: number;
  nombre: unknown;
}

/**
 * El primer campo que no cumple, o null si la campaña se puede activar: de 1 a 10 premios del mismo monto, cada uno de 1 a
 * 10.000 dólares digitales en centavos justos; cierre dentro de los próximos 7 días; sorteo hasta un día después del cierre, y
 * un nombre de empresa que no imita a Tinkazo.
 */
export function reglaQueFalla(c: LoQueSeActiva, ahora: number): CampoDeActivar | null {
  const primero = c.premios[0];
  if (primero === undefined || c.premios.length > PREMIOS_MAXIMOS) return "premios";
  if (c.premios.some((p) => p !== primero || p < PREMIO_MINIMO || p > PREMIO_MAXIMO || p % CENTAVO !== 0n)) return "premios";
  if (c.cierraMs > ahora + DIAS_PARA_CERRAR * DIA_MS) return "cierra_ms";
  if (c.sorteoMs < c.cierraMs || c.sorteoMs > c.cierraMs + DIA_MS) return "sorteo_ms";
  if (typeof c.nombre !== "string" || nombreImita(c.nombre)) return "empresa.nombre";
  return null;
}
