/**
 * Cuánto dura el Guajojó, sin el plan: lo que el selector de duración necesita
 * saber antes de que se juegue (`src/duraciones.ts`, que carga la portada). Solo
 * cuentas con las medidas del show; nada de Pixi, del kit ni del DOM, para que la
 * portada no baje el juego entero.
 *
 * El show es una llamada, la lista de nombres (de a ocho, hasta 64 personas),
 * tantos ciclos de canto, silencio y crac como pide la cantidad de gente, y el
 * amanecer. Cuanta más gente hay, más silencios y más lista tiene para mostrar:
 * de 25 a 60 segundos, con «Normal» que nunca pasa de 60.
 */

/** La llamada: cae el sol, las luciérnagas, el silbo. */
export const T_LLAMADA = 2.5;
/** Cada tanda de nombres de la lista. */
export const T_POR_TANDA = 1.5;
/** Cuántos nombres entran en una tanda. */
export const POR_TANDA = 8;
/** Hasta cuántas personas hay lista: con más, el primer silencio sienta a casi la mitad. */
export const LISTA_MAX = 64;
export const T_CANTO = 2.6;
export const T_CRAC = 0.8;
/** El último silencio: quedan dos, la mirada va a cada una y cae la rival. */
export const T_ULTIMO = 3.6;
export const T_AMANECER = 1.8;
/** Los segundos que no se estiran: el sostén del cartel de quien gana (`FIJOS` de la carrera). */
export const FIJOS = 6;
/** La tarjeta de «cómo se juega» que va antes del show y sale del mismo total. */
export const TARJETA = 3.5;
/** Lo más que promete «Normal». */
export const TOPE_NORMAL = 60;

/** Cuántos silencios hay con `n` personas: 2 con dos, 3 hasta 7, 4 hasta 18, 5 hasta 42, 6 hasta 102 y 7 con más. */
export const silenciosPara = (n: number): number => (n <= 2 ? 2 : n <= 7 ? 3 : n <= 18 ? 4 : n <= 42 ? 5 : n <= 102 ? 6 : 7);

/** Lo que dura un silencio común: 2,4 s y 0,2 más por cada ciclo. */
export const silencioDe = (c: number): number => 2.4 + 0.2 * c;

/** Cuánto dura la lista con `n` personas. */
export const duracionLista = (n: number): number => (n <= LISTA_MAX ? Math.ceil(n / POR_TANDA) * T_POR_TANDA : 0);

/**
 * Lo que dura el show con `n` personas, sin estirar y hasta el golpe, con el susto o la remontada. El duelo suma un
 * silencio (unos 7 s) y la tapada acorta un canto (0,9 s): el estiramiento los absorbe, y «Normal» promete siempre lo mismo.
 */
export function duracionBase(n: number): number {
  const NC = silenciosPara(n);
  let t = T_LLAMADA + duracionLista(n);
  for (let c = 0; c < NC - 1; c++) t += T_CANTO + silencioDe(c) + T_CRAC;
  return t + T_CANTO + T_ULTIMO + T_CRAC + T_AMANECER;
}

/** Lo que promete «Normal» con `n` personas, en segundos de show con la tarjeta adentro; o `null` si no hay a quién contar. */
export function normalGuajojo(n: number): number | null {
  if (!(n >= 2)) return null;
  return Math.min(TOPE_NORMAL, Math.round(duracionBase(n) + FIJOS + TARJETA));
}
