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
 * El texto del marcador. En los juegos de quedar de pie lleva el total («EN EL MONTE  5 DE 18»):
 * un chico que ve «5» no sabe si es la mitad, y la prueba del niño decide «cuánto falta» solo
 * donde el contador lo dice. `total` vacío es el contador de siempre («QUEDAN  10»).
 */
export function textoMarcador(rotulo: string, n: number, total?: { de: string; cuantos: number }): string {
  return `${rotulo}  ${n}${total ? ` ${total.de} ${total.cuantos}` : ""}`;
}

/**
 * Cuánto ocupa de ancho la caja del marcador con ese texto, en píxeles de pantalla: la letra es
 * monoespaciada (0,62 de su tamaño por carácter, de sobra) y la caja suma su aire. Para que los
 * nombres no se pongan encima del contador cuando el texto crece con el total.
 */
export function anchoMarcador(texto: string, k: number): number {
  const m = medidasMarcador(k);
  return texto.length * 0.62 * m.fuente + m.aire;
}

/** El diámetro más chico de una marca, en píxeles de pantalla: por debajo no se cuentan a ojo. */
const MARCA_MIN = 12;

/** Hasta cuántas personas se dibujan como marcas; con más, el número solo ya dice todo. */
export const MARCAS_MAX = 40;

export interface DisposicionMarcas {
  /** Cuántas marcas por fila. */
  cols: number;
  /** Una o dos filas. */
  filas: number;
  /** El diámetro de cada marca, en píxeles de pantalla. */
  d: number;
  /** La separación entre centros. */
  paso: number;
  /** Lo que mide la placa que las lleva. */
  ancho: number;
  alto: number;
  /** El aire entre el borde de la placa y las marcas. */
  pad: number;
}

/**
 * La fila de marcas que va debajo del contador: una por persona, las que siguen encendidas y las
 * que salieron apagadas, para que un chico cuente sin leer cuántas quedan de cuántas eran. Las marcas
 * miden la letra del contador por 0,8 y nunca menos de 12 px; una fila si entran así, y si no, la
 * disposición de una o de dos filas que las deje más grandes. `null` si no hay nada que contar (menos
 * de dos) o si ni en dos filas se distinguen (más de `MARCAS_MAX`, o un ancho que no deja 12 px): el
 * número solo lo dice. `w` es el ancho de la pantalla; la placa nunca pasa del
 * margen del contador, ni de `anchoMax` si el juego lo pide (donde hay algo al lado del contador). Puro, sin Pixi.
 */
export function disposicionDeMarcas(total: number, k: number, w: number, anchoMax = Infinity): DisposicionMarcas | null {
  if (!Number.isFinite(total) || !Number.isFinite(w) || total < 2 || total > MARCAS_MAX) return null;
  const dMax = Math.max(MARCA_MIN, medidasMarcador(k).fuente * 0.8);
  let mejor: DisposicionMarcas | null = null;
  for (const filas of [1, 2]) {
    const cols = Math.ceil(total / filas);
    // Con las marcas a su tamaño, `libre` es lo que dejan los márgenes; si no entran así, se achican hasta MARCA_MIN.
    const pad0 = dMax * 0.45;
    const libre = Math.max(0, Math.min(w - 2 * MARCADOR.x * Math.max(0.01, k), anchoMax) - 2 * pad0);
    const d = Math.min(dMax, libre / cols / 1.4);
    if (d < MARCA_MIN - 1e-9) continue;
    if (mejor && d <= mejor.d + 1e-9) continue;
    const paso = d * 1.4;
    const pad = d * 0.45;
    mejor = { cols, filas, d, paso, ancho: cols * paso + 2 * pad, alto: filas * paso + 2 * pad, pad };
  }
  return mejor;
}

/** Lo que ocupa la fila de marcas con su aire (de la caja del contador para abajo); ceros si no se dibuja. */
export function reservaDeMarcas(total: number, k: number, w: number, anchoMax = Infinity): { ancho: number; alto: number } {
  const d = disposicionDeMarcas(total, k, w, anchoMax);
  const u = Math.max(0.01, k);
  return d ? { ancho: d.ancho + 5 * u, alto: 8 * u + d.alto + 5 * u } : { ancho: 0, alto: 0 };
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
