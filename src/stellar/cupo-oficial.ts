import { type EstadoDelPatrocinio, fechaOCercana } from "./patrocinador";

/**
 * Lo que se le dice a la persona de sus sorteos oficiales (diseño del cobro por uso, sección 6.4): cuántos le quedan, el
 * próximo vencimiento con cuántos vencen, cuánto gasta cada premio y qué le queda junto a «Siguiente premio». Son
 * funciones puras sobre lo que dijo el portero (`estado.oficial`, de `/cupo`) y los textos de `alta-textos.ts`: no tocan
 * la página (`ui/cupo-patrocinio.ts` las pinta).
 *
 * Solo hay algo que decir si la cuenta tiene acceso y el portero dijo cuántos sorteos le quedan. Sin eso, `null`.
 */

type Decir = (clave: string) => string;

/** Hasta cuántos sorteos se avisa «Sumá más antes de tu próximo evento», y solo si hay con qué sumar (el pago prendido). */
export const POCOS_SORTEOS = 2;

/** Hasta cuántos ganadores un sello gasta un sorteo oficial; con más, dos (lo mismo que el portero y `acceso-oficial.ts`). */
export const GANADORES_DE_UN_SORTEO = 50;

/** El día en que vence algo, dicho en hora de Bolivia: «14 de enero» o «January 14». */
export function fechaDeVencimiento(ms: number, idioma: string): string {
  try {
    return new Intl.DateTimeFormat(idioma === "en" ? "en-US" : "es", { day: "numeric", month: "long", timeZone: "America/La_Paz" }).format(new Date(ms));
  } catch {
    return "";
  }
}

interface Sorteos {
  quedan: number;
  proximoVence: { fecha: number; cuantos: number } | null;
}

/** Los sorteos oficiales de la cuenta, si se sabe cuántos son. */
function sorteosDe(estado: EstadoDelPatrocinio | null): Sorteos | null {
  if (!estado || estado.rige === "cerrado") return null;
  const oficial = estado.oficial;
  if (!oficial || !oficial.acceso || !oficial.sorteos) return null;
  return oficial.sorteos;
}

const poner = (texto: string, datos: Record<string, string | number>): string => Object.entries(datos).reduce((s, [k, v]) => s.replaceAll(`{${k}}`, String(v)), texto);

/** «Te quedan 13 sorteos oficiales.» (o «Te queda 1 sorteo oficial.»), con la clave que corresponde a n. */
function cuantosQuedan(n: number, decir: Decir, pocos: boolean): string {
  if (n === 1) return decir("cupoOfQueda1");
  return poner(decir(pocos ? "cupoOfPocos" : "cupoOfQuedan"), { n });
}

/**
 * La línea del cupo, junto a «Sellar la lista»: «Te quedan 13 sorteos oficiales. 3 vencen el 14 de enero.» Con cero, que
 * se acabaron y qué hacer; con sorteos de sobra pero el tope de sellos del mes alcanzado, cuándo se libera.
 */
export function lineaDelCupoOficial(estado: EstadoDelPatrocinio | null, idioma: string, decir: Decir, o: { pago?: boolean } = {}): string | null {
  const s = sorteosDe(estado);
  if (!s) return null;
  if (s.quedan <= 0) return decir("errAnchor.porteroSinSorteos");
  if (estado?.rige === "portero" && estado.cupo.sellos.quedan <= 0) {
    // Sin el tope no hay número que decir: ante la duda, ninguna línea (la caja de la red ya explica el caso).
    if (estado.cupo.sellos.max <= 0) return null;
    return poner(decir("cupoOfTopeMes"), { max: estado.cupo.sellos.max, fecha: fechaOCercana(estado.cupo.liberaEn, idioma, decir("errAnchor.cupoPronto")) });
  }
  const quedan = cuantosQuedan(s.quedan, decir, o.pago === true && s.quedan <= POCOS_SORTEOS);
  const v = s.proximoVence;
  if (!v || !(v.cuantos > 0)) return quedan;
  const fecha = fechaDeVencimiento(v.fecha, idioma);
  if (!fecha) return quedan;
  // En singular cuando es uno solo: «Vence el…» con un solo sorteo, y «1 vence el…» si vence uno de varios.
  const todos = v.cuantos >= s.quedan;
  const clave = todos ? (s.quedan === 1 ? "cupoOfVenceSolo" : "cupoOfVencenTodos") : v.cuantos === 1 ? "cupoOfVence1" : "cupoOfVencen";
  const vence = poner(decir(clave), { n: v.cuantos, fecha });
  return `${quedan} ${vence}`;
}

/**
 * La nota chica antes de sellar: cada premio de a uno usa un sorteo y, si son iguales, «Cuántos ganan» los junta en uno;
 * con más de 50 ganadores el sorteo usa dos. Nada si no quedan sorteos (ya lo dice la línea).
 */
export function notaDeUsoOficial(estado: EstadoDelPatrocinio | null, ganadores: number, decir: Decir): string | null {
  const s = sorteosDe(estado);
  if (!s || s.quedan <= 0) return null;
  return ganadores > GANADORES_DE_UN_SORTEO ? decir("cupoOfDoble") : decir("cupoOfUnoPorPremio");
}

/** Junto a «Siguiente premio (quedan N)»: cuántos sorteos oficiales le quedan para ese premio. */
export function lineaDeSiguientePremio(estado: EstadoDelPatrocinio | null, decir: Decir): string | null {
  const s = sorteosDe(estado);
  if (!s) return null;
  return s.quedan <= 0 ? decir("errAnchor.porteroSinSorteos") : cuantosQuedan(s.quedan, decir, false);
}
