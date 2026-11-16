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

/**
 * El nombre que queda en un Amigo secreto: el que escribió la persona si ya empieza con «Amigo secreto» o «Secret
 * Santa», la frase sola si no escribió nada, y si escribió otra cosa («Navidad») la frase por delante («Amigo secreto:
 * Navidad»), para que el sorteo se siga reconociendo como Amigo secreto (`isSecretSanta`). No pasa de `max`
 * caracteres, igual que el nombre de un orden de turnos (`turnPrize` en `modos/turnos.ts`).
 */
export function secretPrize(text: string, base: string, max = 60): string {
  const clean = text.normalize("NFKC").trim().replace(/\s+/g, " ");
  if (!clean) return base;
  if (isSecretSantaPrize(clean)) return Array.from(clean).slice(0, max).join("");
  return Array.from(`${base}: ${clean}`).slice(0, max).join("");
}

/**
 * ¿Hay secreto con `n` personas? Con 2 o 3 no: aunque el reparto no se muestre, cada uno puede deducirlo entero — con
 * dos, el otro le regala a uno; con tres, alcanza con saber a quién le regala uno. Con cuatro o más, y sin la lista ni
 * el orden a la vista, no se deduce.
 */
export const noHaySecreto = (n: number): boolean => n >= 2 && n <= 3;

/**
 * Un Amigo secreto hecho sin sello no tiene comprobante, por el mismo motivo que un orden de turnos
 * (`ordenSinComprobante`): la verificación de un sorteo sin sello no lleva la cantidad de ganadores, y el enlace
 * mostraría la lista entera como si fuera un sorteo común. En ese caso no se ofrece ningún enlace de verificación.
 */
export const amigoSinComprobante = (people: number, winners: number, prize: string, sinSello: boolean): boolean =>
  sinSello && isSecretSanta(people, winners, prize);
