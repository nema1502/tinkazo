/**
 * El modo Amigo secreto: reconocimiento y reparto, sin pantalla.
 *
 * Usa el mismo sorteo que un orden de turnos: ganan todas las personas y el resultado es una permutación completa de la
 * lista. El sello y el comprobante no cambian. Este módulo solo reconoce ese sorteo por su cantidad y su nombre, y convierte
 * el orden en una ronda de regalos. Todavía no se conecta a la dirección ni a ninguna interfaz.
 */

import { turnOrder } from "./turnos";

/** Una persona y el nombre de quien recibe su regalo. */
export interface GiftAssignment {
  from: string;
  to: string;
}

/**
 * El nombre empieza con Amigo secreto o Secret Santa, sin distinguir mayúsculas. Después de la última palabra no puede
 * seguir otra letra: Amigo secreto2026 sí, pero Secret Santas no. Es la misma regla de palabra completa de los turnos.
 */
const SECRET_SANTA_PRIZE = /^\s*(?:amigo\s+secreto|secret\s+santa)(?!\p{L})/iu;

/** ¿El nombre del sorteo empieza como un Amigo secreto? */
export const isSecretSantaPrize = (prize: string): boolean => SECRET_SANTA_PRIZE.test(prize.normalize("NFKC"));

/**
 * ¿Un sorteo es un Amigo secreto? Tienen que salir todas las personas y el nombre tiene que empezar con Amigo secreto o
 * Secret Santa. Con menos de dos personas no hay sorteo, como en un orden de turnos.
 */
export const isSecretSanta = (people: number, winners: number, prize: string): boolean =>
  people >= 2 && winners === people && isSecretSantaPrize(prize);

/**
 * La ronda de regalos en el orden sellado: quien ocupa el lugar j le regala a quien ocupa el lugar j + 1, y la última
 * persona le regala a la primera. No reordena los índices ni altera las entradas recibidas.
 */
export function reparto(names: readonly string[], winners: readonly number[]): GiftAssignment[] {
  const ordered = turnOrder(names, winners);
  return ordered.map((from, j) => ({ from, to: ordered[(j + 1) % ordered.length] ?? "" }));
}

/** El nombre de quien recibe el regalo de `persona`, o null si esa persona no está en el orden. */
export function paraQuien(names: readonly string[], winners: readonly number[], persona: string): string | null {
  return reparto(names, winners).find((assignment) => assignment.from === persona)?.to ?? null;
}
