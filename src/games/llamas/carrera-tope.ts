import { CUERPO } from "./carrera-marcha";
import { qDeSegundos, segundosDeQ } from "./carrera-ritmo";
import type { Plan as PlanFinal } from "./plan";

/**
 * El tope de aceleración de la recta, puesto donde se combinan las capas.
 *
 * La recta se arma por capas que no se miran entre sí: la curva de base (`carrera-marcha.ts`, con sus compuertas y los momentos de la historia) y encima
 * los obstáculos (`carrera-obstaculos.ts`). Cada una se cuida de su parte del tope de 1,2 cuerpos por segundo cada segundo, pero la suma puede pasarlo: la base
 * busca entre 160 arreglos uno que quede en 0,55 a 0,7 y en las rondas difíciles se queda con el menos malo (hasta 1,4), y el empalme de dos tramos de una curva
 * de Hermite, que es continuo en la velocidad pero no en la aceleración, suma un salto de unas décimas. Lo que se ve es una llama que arranca o frena de golpe.
 *
 * Acá se mira la suma. Se tabula el lugar de cada carril a unos 60 cuadros por segundo desde que se abre la recta hasta la meta y, si alguna aceleración pasa
 * del tope, se corrige esa parte de la curva: se mueve cada punto lo justo para dejar su aceleración en el tope, el exceso pasa a los vecinos y se repite hasta
 * que ninguno pase. La llegada (el lugar en la meta) no se mueve, y donde nada pasa del tope el plan queda exactamente igual. Es puro y de la ronda:
 * saltar o redibujar da lo mismo.
 */

/**
 * El tope que se pone: debajo del 1,2 de la dirección, para que lo que mide el auditor, que toma los cuadros del reloj en otra fase que la tabla, no lo pase
 * (`TOPES.tolerancia` deja el 6 % de margen numérico; este 8 % es para la fase).
 */
export const ACEL_RECTA = 1.1;

/** Cuántas pasadas como mucho: el exceso es de unas décimas en unos pocos cuadros y se reparte en pocas decenas. */
const PASADAS = 4000;

/**
 * Corrige `x` (lugares tabulados cada `dt` segundos) para que ninguna aceleración pase de `tope` (cuerpos por segundo cada segundo): los extremos no se mueven.
 * Devuelve cuántas pasadas hicieron falta (0 si ya estaba dentro). Modifica `x`.
 */
export function limitarAceleracion(x: Float64Array, dt: number, tope: number): number {
  const n = x.length;
  const h2 = dt * dt;
  const limite = tope * h2;
  const fuera = (): boolean => {
    for (let i = 1; i < n - 1; i++) if (Math.abs((x[i + 1] as number) - 2 * (x[i] as number) + (x[i - 1] as number)) > limite * (1 + 1e-9)) return true;
    return false;
  };
  if (!fuera()) return 0;
  let pasadas = 0;
  while (pasadas < PASADAS && fuera()) {
    pasadas++;
    // Dos barridos, de ida y de vuelta: así el exceso no se corre hacia un solo lado.
    for (let i = 1; i < n - 1; i++) corregir(x, i, limite);
    for (let i = n - 2; i >= 1; i--) corregir(x, i, limite);
  }
  return pasadas;
}

/** Deja la segunda diferencia del punto `i` dentro de `limite`: lo que sobra se mueve al propio punto, hacia el promedio de sus vecinos. */
function corregir(x: Float64Array, i: number, limite: number): void {
  const dif = (x[i + 1] as number) - 2 * (x[i] as number) + (x[i - 1] as number);
  if (dif > limite) x[i] = (x[i] as number) + (dif - limite) / 2;
  else if (dif < -limite) x[i] = (x[i] as number) + (dif + limite) / 2;
}

/** La corrección de un carril: cuánto se mueve cada punto de la tabla (en cuerpos), entre los puntos `desde` y `hasta`. */
interface Correccion {
  desde: number;
  hasta: number;
  delta: Float64Array;
}

/**
 * Le pone a una recta el tope de aceleración (`ACEL_RECTA`) sobre la suma de sus capas. Devuelve un plan con la misma forma; si ninguna aceleración pasa del
 * tope, devuelve el mismo `pos`.
 */
export function conTopeDeAceleracion(base: PlanFinal, tope = ACEL_RECTA): PlanFinal {
  const L = base.lanes.length;
  if (L < 1) return base;
  const foto = base.foto;
  const T = segundosDeQ(1, foto);
  const M = Math.max(4, Math.ceil(T * 60));
  const dt = T / M;
  // Los puntos de la tabla, en la pista y en cuerpos desde la línea: lo mismo que mide el auditor (el lugar respecto del frente del grupo).
  const qs = Array.from({ length: M + 1 }, (_, j) => qDeSegundos(j * dt, foto));
  const correcciones: (Correccion | null)[] = [];
  let alguna = false;
  for (let k = 0; k < L; k++) {
    const original = new Float64Array(M + 1);
    for (let j = 0; j <= M; j++) original[j] = (base.pos(k, qs[j] as number) - (qs[j] as number)) / CUERPO;
    const x = Float64Array.from(original);
    if (limitarAceleracion(x, dt, tope) === 0) {
      correcciones.push(null);
      continue;
    }
    let desde = -1, hasta = -1;
    const delta = new Float64Array(M + 1);
    for (let j = 0; j <= M; j++) {
      delta[j] = (x[j] as number) - (original[j] as number);
      // Las diferencias de una milmillonésima de cuerpo son ruido de la cuenta.
      if (Math.abs(delta[j] as number) > 1e-9) {
        if (desde < 0) desde = j;
        hasta = j;
      }
    }
    if (desde < 0) {
      correcciones.push(null);
      continue;
    }
    correcciones.push({ desde: Math.max(0, desde - 2), hasta: Math.min(M, hasta + 2), delta });
    alguna = true;
  }
  if (!alguna) return base;

  /** El valor de `delta` a `tau` segundos: Catmull-Rom sobre la tabla (continuo en la primera derivada). */
  const enTabla = (c: Correccion, tau: number): number => {
    const x = tau / dt;
    if (x <= c.desde || x >= c.hasta) return 0;
    const i = Math.min(M - 1, Math.floor(x));
    const f = x - i;
    const d = c.delta;
    const p1 = d[i] as number, p2 = d[i + 1] as number;
    const p0 = i > 0 ? (d[i - 1] as number) : p1, p3 = i + 2 <= M ? (d[i + 2] as number) : p2;
    return p1 + 0.5 * f * (p2 - p0 + f * (2 * p0 - 5 * p1 + 4 * p2 - p3 + f * (3 * (p1 - p2) + p3 - p0)));
  };
  const pos = (k: number, q: number): number => {
    const b = base.pos(k, q);
    const c = correcciones[k];
    if (!c) return b;
    return b + CUERPO * enTabla(c, segundosDeQ(q, foto));
  };
  return { ...base, pos };
}
