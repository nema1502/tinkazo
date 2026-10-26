/**
 * El marcador: un solo contador, en la misma esquina de todos los juegos.
 *
 * Es la regla 3 de la regla del niño (26 de octubre de 2026): cada juego
 * tenía el suyo, en otra esquina, con otras palabras y a veces con dos números
 * ("18/18", pestañas con número, "4 bailarines"). Un niño que no lee igual
 * tiene que saber cuántos quedan: el número se puede **contar en la escena**,
 * está **arriba a la izquierda** en los diez, **solo baja** y **llega a 1 con el
 * golpe**. Ningún otro número va en el relator ni en un cartel: los números van
 * acá.
 *
 * El plan declara `marcador(t)` y `crearJuego` lo dibuja (`marcador-vista.ts`),
 * así ningún juego puede tener otro. Puro, sin DOM.
 */
export const ESQUINA = "arriba-izquierda" as const;

/** Las medidas del diseño de 720 de alto: lo que mide el contador de siempre (`CONTADOR` en `stage.ts`). */
export const MARCADOR = { fuente: 22, alto: 52, aire: 44, x: 22, y: 10 } as const;

/**
 * Las medidas del marcador para la unidad `k` del juego: la letra nunca baja de
 * 15 px aunque la pantalla sea chica, y la caja crece con ella.
 */
export function medidasMarcador(k: number): { fuente: number; alto: number; aire: number } {
  const fuente = Math.max(15, MARCADOR.fuente * k);
  const e = fuente / MARCADOR.fuente;
  return { fuente, alto: MARCADOR.alto * e, aire: MARCADOR.aire * e };
}

/**
 * Un marcador que baja de a uno: arranca en `total`, resta una por cada salida
 * (los segundos de juego en que sale alguien) y queda en 1 con el golpe.
 */
export function marcadorPorSalidas(total: number, salidas: readonly number[], golpe: number): (t: number) => number {
  const orden = [...salidas].sort((a, b) => a - b);
  return (t) => (t >= golpe ? 1 : Math.max(1, total - orden.filter((s) => s <= t).length));
}

export interface OpcionesMarcador {
  /** Segundos de juego hasta coronar. */
  duracion: number;
  /** Cuántos empiezan. */
  total: number;
  /** Cuánto puede bajar de una vez: 1, para que cada salida se pueda contar. Un juego que saca por tandas lo sube y lo dice. */
  pasoMax?: number;
  /** Cada cuántos segundos se mira. */
  paso?: number;
}

/** Lo que está mal en un marcador, para las pruebas de cada juego. Vacío si cumple. */
export function problemasDeMarcador(m: (t: number) => number, o: OpcionesMarcador): string[] {
  const p: string[] = [];
  const paso = o.paso ?? 0.05;
  const pasoMax = o.pasoMax ?? 1;
  let previo = m(0);
  if (previo !== o.total) p.push(`empieza en ${previo} y tendría que empezar en ${o.total}`);
  let entero = true;
  let sube = false;
  let salto = false;
  for (let t = paso; t <= o.duracion + 2 + 1e-9; t += paso) {
    const v = m(t);
    if (!Number.isInteger(v) || v < 1) entero = false;
    if (v > previo) sube = true;
    if (previo - v > pasoMax) salto = true;
    previo = v;
  }
  if (!entero) p.push("el número tiene que ser un entero de 1 para arriba");
  if (sube) p.push("el número sube: un marcador solo baja");
  if (salto) p.push(`el número baja más de ${pasoMax} de una vez: cada salida se tiene que poder contar`);
  if (m(o.duracion) !== 1) p.push(`con el golpe tiene que quedar en 1 y queda en ${m(o.duracion)}`);
  if (m(o.duracion + 2) !== 1) p.push("después del golpe tiene que seguir en 1");
  return p;
}
