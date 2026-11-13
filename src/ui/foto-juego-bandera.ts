/**
 * La bandera de la foto con el dibujo del juego: `VITE_FOTO_JUEGO`. Apagada por defecto.
 *
 * Apagada, compartir ofrece la foto de siempre, sola, como hasta hoy, aunque se sepa qué juego se jugó. Prendida
 * (`VITE_FOTO_JUEGO=1 pnpm build`), justo después del sorteo suma la foto sobre el dibujo de ese juego
 * (`foto-fondos.ts`), elegida, al lado de la de siempre. Se prende cuando la foto de cada juego esté lista y mirada a
 * tamaño real y en miniatura.
 */
export function fotoDelJuegoActiva(valor: unknown = import.meta.env.VITE_FOTO_JUEGO): boolean {
  return valor === "1" || valor === "true";
}
