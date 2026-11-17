/**
 * La bandera de la foto con el dibujo del juego: `VITE_FOTO_JUEGO`. Prendida por defecto desde el 15 de noviembre
 * de 2026.
 *
 * Prendida, justo después del sorteo compartir suma la foto sobre el dibujo del juego que se jugó (`foto-fondos.ts`),
 * elegida, al lado de la de siempre. Se prendió cuando la foto de cada juego se miró a tamaño real y en miniatura de
 * chat, con un ganador de nombre corto, uno de 28 letras, cinco ganadores y un premio escrito, y con el QR leído de la
 * foto entera y de la que deja WhatsApp (800 px, JPEG al 60 %). `VITE_FOTO_JUEGO=0` (o `false`) al construir la
 * apaga: compartir vuelve a ofrecer la foto de siempre, sola, aunque se sepa qué juego se jugó.
 *
 * Solo la ofrecen los juegos de `JUEGOS_CON_FOTO`, los que pasaron esa mirada. Uno que no la pase sale de la lista y
 * comparte la foto de siempre: un juego flojo no frena a los demás.
 */
export function fotoDelJuegoActiva(valor: unknown = import.meta.env.VITE_FOTO_JUEGO): boolean {
  return !(valor === "0" || valor === "false");
}

/** Los juegos cuya foto se miró y está lista: los diez del selector. */
export const JUEGOS_CON_FOTO: ReadonlySet<string> = new Set(["race", "chovena", "trompo", "pinata", "oruro", "wheel", "teleferico", "sapo", "guajojo", "toborochi"]);

/** Si compartir ofrece la foto con el dibujo de `juego`: la bandera prendida y el juego en la lista. */
export function fotoDelJuegoPara(juego: string | undefined, valor: unknown = import.meta.env.VITE_FOTO_JUEGO): boolean {
  return !!juego && JUEGOS_CON_FOTO.has(juego) && fotoDelJuegoActiva(valor);
}
