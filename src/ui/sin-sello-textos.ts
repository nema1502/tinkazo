import { T, t, type Lang } from "../i18n";

/**
 * Lo que dice la pantalla de un sorteo que se siguió sin sello.
 *
 * Cuando la red no deja sellar y quien organiza decide seguir, la lista se cierra en la
 * herramienta pero nadie atestigua en la cadena que se cerró antes de que existiera el
 * número. Ese sorteo no se puede comprobar, y la regla del protocolo es que lo que no
 * está anclado nunca se presenta como verificable. Por eso cada texto que dice "sellada"
 * o invita a comprobar tiene su versión sin sello: el título de la sección, la línea bajo
 * la cuenta, la espera en grande, la lista de la sala, y el QR del resultado en la página
 * y en grande. Hasta el 26 de octubre de 2026 solo cambiaban el botón y la nota del
 * resultado, y la sala, que es lo que se proyecta, seguía leyendo "sellada: ya nadie la
 * puede cambiar" (revisión del evaluador, batería de cierre).
 *
 * Si el sello entra más tarde (el reintento de `sin-sello.ts`), el sorteo deja de estar
 * sin sello y los textos vuelven a los de siempre.
 */

/** El sorteo se siguió sin sello y el sello no entró: si entró, tiene `raffleId` y se puede comprobar. */
export const sinSelloAhora = (f: { sinSello?: boolean; raffleId?: bigint } | null | undefined): boolean =>
  !!f && !!f.sinSello && f.raffleId === undefined;

/** Las claves de cada texto: [con sello, sin sello]. */
export const TEXTOS_DEL_SELLO = {
  /** El título de la sección ("Lista sellada"). */
  titulo: ["p2", "p2SinSello"],
  /** La línea bajo la cuenta, en la página. */
  lineaDeLaEspera: ["waitLine", "waitLineSinSello"],
  /** La leyenda del QR del resultado, en la página. */
  qrDelResultado: ["qrCaption", "qrCaptionSinSello"],
  /** La leyenda del QR del resultado en grande. */
  qrEnGrande: ["pantallaQr", "pantallaQrSinSello"],
  /** El título de la lista en la sala. */
  tituloDeLaSala: ["salaTSellada", "salaTCerrada"],
  /** El pie de la lista en la sala. */
  pieDeLaSala: ["salaPieSellada", "salaPieCerrada"],
} as const;

export type TextoDelSello = keyof typeof TEXTOS_DEL_SELLO;

/** La clave del texto, con o sin sello. */
export const claveDelSello = (cual: TextoDelSello, sinSello: boolean): string => TEXTOS_DEL_SELLO[cual][sinSello ? 1 : 0];

/** El pie de la espera en grande: cuántos hay en la lista, y si está sellada o no. */
export const pieDeLaEspera = (lang: Lang, n: number, sinSello: boolean): string =>
  sinSello ? T[lang].espPieSinSello(n) : T[lang].espPie(n);

/**
 * Pone en un texto de la página el que corresponde, y deja la clave nueva en `data-i`
 * para que el cambio de idioma lo repinte con la misma versión.
 */
export function ponerTextoDelSello(el: HTMLElement | null, cual: TextoDelSello, sinSello: boolean): void {
  if (!el) return;
  const clave = claveDelSello(cual, sinSello);
  el.dataset.i = clave;
  el.textContent = t(clave);
}
