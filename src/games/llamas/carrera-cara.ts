/**
 * La cara del cursor de la cinta de arriba (quién va adelante), como función de la hora del show. Pura: no importa PixiJS.
 *
 * Cuando la marca pasaba a otra, la cara se apagaba en 0,2 s, cambiaba y se prendía en 0,2 s: justo en la hora de la marca el
 * cursor quedaba en el aro amarillo liso y el público lo veía como un parpadeo. Ahora las dos caras se cruzan durante
 * `CARA_FUNDIDO`: la nueva entra por encima de la vieja, que sigue entera debajo hasta que la nueva la cubre del todo. La vieja se
 * va mientras la nueva llega y el ícono nunca queda vacío.
 *
 * No se guarda nada entre cuadros: cuándo empieza el cruce sale de la hora de la marca más cercana hacia atrás (`Datos.marcas`,
 * `carrera-show.ts`), y de quién es cada cara, de quien lleva la marca antes y después de esa hora. Saltar la animación, ir hacia
 * atrás o llegar cuadro por cuadro dan la misma cara en la misma hora.
 */

import type { Datos } from "./carrera-show";

/** Cuánto dura el cruce de las caras, en segundos. */
export const CARA_FUNDIDO = 0.3;

/** De quién es la cara en `t`: de `Datos.duena` (en la carrera de siempre, quien lleva la marca) y, si no hay nadie, de la primera de la lista. */
export const quienDeCara = (d: Datos) => (t: number): number => (d.duena(t) >= 0 ? d.duena(t) : (d.lanes[0] as number));

/**
 * Cuándo puede cambiar la cara: cuando pasa la marca (la carrera de siempre; en la nueva no hay marcas y la cara cambia sin cruce). Con
 * tandas, la de siempre no muestra la cara antes de la salida: la marca de la salida no es un cambio que se vea, la cara aparece ahí.
 */
export function cambiosDeCara(d: Datos): number[] {
  return d.marcas.map((m) => m.t).filter((x) => !d.tandas.length || x > d.tSalida).sort((a, b) => a - b);
}

const EPS = 1e-6;

const suave = (v: number): number => {
  const x = Math.max(0, Math.min(1, v));
  return x * x * (3 - 2 * x);
};

/** La cara del cursor en una hora: `sale` va debajo, entera; `entra` va encima con la opacidad `mezcla` (1: ya no hay cruce y `sale` no se dibuja). */
export interface CaraEn {
  sale: number;
  entra: number;
  mezcla: number;
}

/**
 * La cara en la hora `t`. `quien(t)` es de quién es la cara en cada hora (puro) y `cambios`, las horas en que puede cambiar,
 * ordenadas: el cruce arranca en la última que no pasó de `t` y dura `dur`.
 */
export function caraEn(t: number, quien: (t: number) => number, cambios: readonly number[], dur = CARA_FUNDIDO): CaraEn {
  const ahora = quien(t);
  let ultimo = -Infinity;
  for (const c of cambios) {
    if (c > t) break;
    ultimo = c;
  }
  const mezcla = suave((t - ultimo) / dur);
  if (mezcla < 1) {
    const antes = quien(ultimo - EPS);
    if (antes !== ahora) return { sale: antes, entra: ahora, mezcla };
  }
  return { sale: ahora, entra: ahora, mezcla: 1 };
}

/**
 * Cuánto señala la cinta en `t` (de 0 a 1): `d.cursor(t)`, que en los últimos segundos la apaga. En la carrera de siempre con tandas
 * no hay cara antes de la salida y entra en `CARA_FUNDIDO` desde la hora de la salida, no de golpe. Pura: solo depende de `t`.
 */
export function cuantoCara(d: Datos, t: number): number {
  if (d.nueva || !d.tandas.length) return d.cursor(t);
  return d.cursor(t) * suave((t - d.tSalida) / CARA_FUNDIDO);
}

/**
 * La opacidad de las dos caras, con `cuanto` lo que señala la cinta en total (de 0 a 1). La de arriba entra con `cuanto * mezcla` y la de
 * abajo con lo que hace falta para que las dos juntas, una sobre la otra, sumen justo `cuanto`: así, si la cinta se apaga en medio de
 * un cruce, la opacidad total sigue a la de la cinta y no salta cuando el cruce termina.
 */
export function alfasCara(c: CaraEn, cuanto: number): { sale: number; entra: number } {
  if (c.mezcla >= 1) return { sale: 0, entra: cuanto };
  const entra = cuanto * c.mezcla;
  const resto = 1 - entra;
  return { sale: resto > EPS ? 1 - (1 - cuanto) / resto : 1, entra };
}

/** Lo que la cara necesita de un sprite: sin PixiJS, para probarlo en Node. */
export interface SpriteCara<T> {
  texture: T;
  alpha: number;
  visible: boolean;
  width: number;
  height: number;
}

/**
 * Pone la cara de este cuadro en los dos sprites (`sale` debajo, `entra` encima). La textura y su tamaño se tocan solo cuando
 * cambia de quién es la cara (`figura` devuelve siempre la misma textura para la misma persona); lo demás son dos opacidades.
 */
export function ponerCaras<T>(sale: SpriteCara<T>, entra: SpriteCara<T>, c: CaraEn, cuanto: number, figura: (i: number) => T, lado: number): void {
  const poner = (s: SpriteCara<T>, i: number): void => {
    const tx = figura(i);
    if (s.texture === tx) return;
    s.texture = tx;
    s.width = s.height = lado;
  };
  const a = alfasCara(c, cuanto);
  if (a.entra > 0) poner(entra, c.entra);
  entra.alpha = a.entra;
  entra.visible = a.entra > 0.01;
  if (a.sale > 0) poner(sale, c.sale);
  sale.alpha = a.sale;
  sale.visible = a.sale > 0.01;
}
