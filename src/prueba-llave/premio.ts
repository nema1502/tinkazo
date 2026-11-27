import type { Lang } from "../idioma";

/**
 * Las cifras de recibir y mandar monedas de prueba. Un premio de prueba son 10 monedas, con los 7 decimales de la red. Nada
 * de esto vale plata: son monedas de la red de prueba.
 */

/** Lo que se le paga a la billetera nueva, en la unidad mínima (7 decimales). */
export const MONTO_DEL_PREMIO = 100_000_000n;
export const DECIMALES = 7;

/** El número de nota del destino que arma la página. Viaja dentro de la dirección M, como un número de 64 bits. */
export const NOTA_DE_PRUEBA = 1_234_567_890n;

/** Lo que recibe de saldo la cuenta de destino que arma la página, para cubrir la reserva de una cuenta con un dato (1,5). */
export const SALDO_INICIAL_DEL_DESTINO = "2";
export const SALDO_INICIAL_DEL_DESTINO_STROOPS = 20_000_000n;

/** Lo que se tolera de comisión por recursos declarada en cada transferencia. Solo frena una comisión absurda. */
export const TOPE_DE_RECURSOS_STROOPS = 100_000_000;

/** Un monto en monedas, sin decimales si no hacen falta y con coma en español o punto en inglés. */
export function montoVisible(stroops: bigint, lang: Lang): string {
  const base = 10n ** BigInt(DECIMALES);
  const entero = stroops / base;
  const resto = stroops % base;
  if (resto === 0n) return entero.toString();
  const decimales = resto.toString().padStart(DECIMALES, "0").replace(/0+$/, "");
  return `${entero.toString()}${lang === "es" ? "," : "."}${decimales}`;
}

/** Una dirección partida en grupos de cuatro caracteres separados por un espacio, para leerla entera. */
export function enGrupos(direccion: string): string {
  return (direccion.match(/.{1,4}/g) ?? []).join(" ");
}
