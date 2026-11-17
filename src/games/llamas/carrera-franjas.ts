import { ARCS, type Arc } from "../drama";

/**
 * Las franjas de puestos de la recta de la carrera de siempre, como fracciones del pelotón: con ocho, la primera cuarta parte son los puestos 1 y 2,
 * y la última, 7 y 8.
 *
 * Salen de esta tabla los puestos que `planRace` (`plan.ts`) sortea para la ganadora y los que `metaDeUnCarril` (`carrera-marcha.ts`) sortea para
 * cada una de las demás en la marcha pareja. Es la misma tabla para las dos a propósito: así la ley de lo que busca cada carril, dado su puesto de
 * entrada, es la de la ganadora, y verla moverse no dice quién es. Si se cambia una franja, cambia para todas. La prueba espejo
 * (`carrera-senuelos.test.ts`) compara las dos leyes sorteando, por si alguien sortea por fuera de la tabla.
 */
export type Franja = readonly [number, number];

/** Adelante en el susto y el duelo, atrás en la remontada y la tapada: al entrar a la recta (el 7 %) y al 25 %. */
export const FRANJA_ADELANTE: Franja = [0, 0.5];
export const FRANJA_ATRAS: Franja = [0.5, 1];

/** Si el arco va adelante al entrar a la recta y al 25 %. */
export const vaAdelante = (arco: Arc): boolean => arco === "duelo" || arco === "susto";

/** La franja de entrada a la recta (y del 25 %) de cada arco. */
export const franjaDeEntrada = (arco: Arc): Franja => (vaAdelante(arco) ? FRANJA_ADELANTE : FRANJA_ATRAS);

/**
 * La hora del tropiezo del susto, en fracción de la recta: la mitad de las veces antes de la mitad (desde 0,38, en un ancho de 0,12) y la otra mitad
 * después (desde 0,5, en un ancho de 0,16). Así a la mitad la del susto va atrás o adelante la mitad de las veces.
 */
export const TROPIEZO_ANTES = { desde: 0.38, ancho: 0.12 } as const;
export const TROPIEZO_DESPUES = { desde: 0.5, ancho: 0.16 } as const;

/**
 * La franja del 50 %: cuatro franjas que juntas dan un octavo por puesto (con ocho). El duelo del 1.º al 4.º, la tapada del 3.º al 6.º, la remontada
 * del 5.º al 8.º y el susto 7.ª u 8.ª si ya tropezó o 1.ª o 2.ª si todavía no.
 */
export function franjaDel50(arco: Arc, yaTropezo: boolean): Franja {
  if (arco === "duelo") return [0, 0.5];
  if (arco === "tapada") return [0.25, 0.75];
  if (arco === "remontada") return [0.5, 1];
  return yaTropezo ? [0.75, 1] : [0, 0.25];
}

/** La franja del 75 %: el duelo en la primera cuarta parte, el susto en la segunda y las otras dos en la mitad de atrás. */
export function franjaDel75(arco: Arc): Franja {
  if (arco === "duelo") return [0, 0.25];
  if (arco === "susto") return [0.25, 0.5];
  return [0.5, 1];
}

/** Los puestos (1 es la primera) que abarca la franja `[a, b]` con `L` carriles: siempre al menos uno. */
export function limitesDeFranja(L: number, f: Franja): [number, number] {
  const lo = Math.min(L, Math.floor(f[0] * L) + 1);
  return [lo, Math.max(lo, Math.min(L, Math.ceil(f[1] * L)))];
}

/** Un puesto de la franja, parejo entre los que abarca, con un número del azar. */
export function puestoDeFranja(L: number, f: Franja, rnd: () => number): number {
  const [lo, hi] = limitesDeFranja(L, f);
  return lo + Math.floor(rnd() * (hi - lo + 1));
}

/** Los arcos que se sortean con `L` carriles: con dos no hay tapada, como en `writeStory`. */
export const arcosPosibles = (L: number): Arc[] => ARCS.filter((a) => a !== "tapada" || L >= 3);

/**
 * El arco de una llama que entra a la recta `r`-ésima (1 es la primera) con `L` carriles, con un número del azar: parejo entre los arcos cuya
 * franja de entrada tiene ese puesto, cada uno con el peso uno sobre lo ancha que es su franja. Es lo que le toca a la ganadora de entrar ahí:
 * el plan sortea su arco parejo y su puesto en la franja de su arco, así que dado el puesto el arco sale con esos pesos. Lo usan `metaDeUnCarril`
 * para cada una de las demás y, con dos carriles, `planRace` para la ganadora (`entradaPareja`).
 */
export function arcoDeEntrada(L: number, r: number, rnd: () => number): Arc {
  const peso = (f: Franja): number => {
    const [lo, hi] = limitesDeFranja(L, f);
    return r >= lo && r <= hi ? 1 / (hi - lo + 1) : 0;
  };
  const posibles = arcosPosibles(L);
  const pesos = posibles.map((a) => peso(franjaDeEntrada(a)));
  const total = pesos.reduce((x, y) => x + y, 0);
  let u = rnd() * (total || 1), arco: Arc = posibles[0] as Arc;
  for (let i = 0; i < posibles.length; i++) {
    arco = posibles[i] as Arc;
    u -= total ? (pesos[i] as number) : 1 / posibles.length;
    if (u < 0) break;
  }
  return arco;
}

/** En cuántas franjas de entrada (la de adelante y la de atrás) está el puesto `r` con `L` carriles: con `L` impar, el del medio está en las dos. */
export function franjasConElPuesto(L: number, r: number): number {
  return [FRANJA_ADELANTE, FRANJA_ATRAS].filter((f) => {
    const [lo, hi] = limitesDeFranja(L, f);
    return r >= lo && r <= hi;
  }).length;
}

/**
 * La probabilidad de cada puesto de entrada (1 es la primera, en el lugar `r - 1`) de la ganadora con arco `arco` en la marcha pareja: dentro de
 * la franja de su arco, cada puesto con el peso uno sobre en cuántas franjas está. Con `L` impar el puesto del medio está en las dos franjas y,
 * parejo en cada una, salía el doble que los otros: con tres personas la del medio al entrar ganaba la mitad de las veces. Así, sumando los
 * arcos, cada puesto sale una vez de cada `L`. Con `L` par las franjas no se tocan y es la franja pareja de siempre.
 */
export function pesosDeEntrada(L: number, arco: Arc): number[] {
  const [lo, hi] = limitesDeFranja(L, franjaDeEntrada(arco));
  const out = new Array<number>(L).fill(0);
  let total = 0;
  for (let r = lo; r <= hi; r++) total += out[r - 1] = 1 / franjasConElPuesto(L, r);
  return out.map((p) => p / total);
}

/**
 * El puesto de entrada de la ganadora en la marcha pareja, con un número del azar, con los pesos de `pesosDeEntrada`. Con `L` par da lo mismo
 * que `puestoDeFranja` con la franja de entrada del arco, número por número.
 */
export function puestoDeEntrada(L: number, arco: Arc, rnd: () => number): number {
  const [lo, hi] = limitesDeFranja(L, franjaDeEntrada(arco));
  const pesos: number[] = [];
  for (let r = lo; r <= hi; r++) pesos.push(1 / franjasConElPuesto(L, r));
  const total = pesos.reduce((x, y) => x + y, 0);
  const u = rnd() * total;
  let acum = 0;
  for (let i = 0; i < pesos.length; i++) {
    acum += pesos[i] as number;
    if (u < acum) return lo + i;
  }
  return hi;
}
