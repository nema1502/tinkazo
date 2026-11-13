import { sembrar } from "../pixi/kit/azar";
import { filaDeRango } from "./carrera-caminata";
import { formaDe, type Forma, type Pantalla } from "./carrera-forma";
import { muestrasDelPlan, pesoDelPar, umbralSubfila, type DatosSubfila } from "./carrera-subfilas";

/**
 * Las filas del grupo según el carril, puras: cada finalista larga ya en una fila cuyo orden es el de su carril, para que al abrirse la
 * recta ninguna pase por adentro de otra. La recta, los carriles y quién gana no se tocan: lo que se reparte es el grupo, desde la salida.
 *
 * El reparto de las finalistas es un muestreo sistemático: con un número sorteado `u`, el carril `k` va a la fila que contiene el punto
 * `u + k G / L` al apilar las filas de arriba abajo, cada una con su cupo de siempre. Es monótono (el carril de más arriba nunca queda más
 * abajo) y cada fila recibe finalistas en proporción exacta a su cupo, así que la fila de la ganadora, cuyo carril es parejo, sale pareja
 * por fila. Como mucho dos finalistas por fila: van a subfilas opuestas (`carrera-subfilas.ts`), la de carril menor arriba.
 *
 * Las demás llenan al azar los lugares que quedan (cada fila con su cupo de siempre), sin preferir la fila del dibujo de siempre: así
 * ninguna fila, vista en el corral, distingue a las finalistas. Y cada fila tiene que poder pintarse en dos subfilas: dos de la misma
 * fila que en el plan se juntan (corriendo a menos de un largo y su aire, o quietas una al lado de la otra) van a subfilas opuestas, y eso
 * tiene que alcanzar para todas, con las dos finalistas de una fila ya puestas una arriba y otra abajo. Si no hay reparto que cumpla,
 * devuelve null y quien llama prueba con una fila más.
 */

/** Cuántas finalistas puede tener una fila: una por subfila. */
export const FINALISTAS_POR_FILA = 2;
/** El tope de nodos de la búsqueda que acomoda a las demás: con 30 personas termina enseguida; es solo un seguro. */
export const NODOS_MAX = 20_000;
/** Cuántas veces se vuelve a buscar con llaves nuevas si la búsqueda se queda sin nodos. */
export const INTENTOS = 8;

export interface EntradaFilas {
  /** Cuántas salen (G). */
  lugares: number;
  /** Las filas de la forma. */
  filas: number;
  /** Los carriles de la recta (L). */
  carriles: number;
  /** Por lugar: el carril de la finalista que sale ahí, o -1 si quien sale ahí no es finalista. */
  carrilEn: readonly number[];
  /**
   * Si quienes salen en los lugares `a` y `b` se juntan en el plan: en la misma fila tienen que ir a subfilas opuestas. Sin ella, nadie se
   * junta y cualquier fila se puede pintar.
   */
  seJuntan?: (a: number, b: number) => boolean;
  /** El azar sembrado: se gasta siempre igual para la misma entrada. */
  rng: () => number;
  /** Sin el tope de finalistas por fila (el último intento de `formaDelGrupo`, cuando no entran más filas). */
  sinTopeDeFinalistas?: boolean;
}

/**
 * Si los lugares de una fila se pueden pintar en dos subfilas sin que dos que se juntan queden en la misma, con las dos finalistas de la
 * fila (si hay dos) ya puestas: la de carril menor arriba y la otra abajo. Con una sola finalista, su lado queda libre.
 */
export function sePuedePintar(lugares: readonly number[], carrilEn: readonly number[], seJuntan: (a: number, b: number) => boolean): boolean {
  const color = new Map<number, number>();
  const fins = lugares.filter((r) => (carrilEn[r] ?? -1) >= 0).sort((a, b) => (carrilEn[a] as number) - (carrilEn[b] as number));
  if (fins.length >= 2) fins.forEach((r, j) => color.set(r, j < fins.length / 2 ? -1 : 1));
  const cola: number[] = [...color.keys()];
  const propagar = (): boolean => {
    while (cola.length) {
      const r = cola.shift() as number;
      const c = color.get(r) as number;
      for (const q of lugares) {
        if (q === r || !seJuntan(r, q)) continue;
        const cq = color.get(q);
        if (cq === undefined) {
          color.set(q, -c);
          cola.push(q);
        } else if (cq === c) return false;
      }
    }
    return true;
  };
  if (!propagar()) return false;
  for (const r of lugares) {
    if (color.has(r)) continue;
    color.set(r, -1);
    cola.push(r);
    if (!propagar()) return false;
  }
  return true;
}

/** La fila de cada lugar, o null si no hay reparto que cumpla con estas filas. */
export function repartirFilas(e: EntradaFilas): number[] | null {
  const G = e.lugares;
  const F = e.filas;
  const L = e.carriles;
  if (G <= 0 || F <= 0 || L <= 0) return null;
  const seJuntan = e.seJuntan ?? (() => false);
  // Los cupos de siempre: cuántos lugares da `filaDeRango` a cada fila.
  const cupo: number[] = new Array<number>(F).fill(0);
  for (let r = 0; r < G; r++) cupo[filaDeRango(r, F)] = (cupo[filaDeRango(r, F)] as number) + 1;
  // Dónde empieza cada fila al apilarlas de arriba abajo.
  const desde: number[] = new Array<number>(F).fill(0);
  for (let f = 1; f < F; f++) desde[f] = (desde[f - 1] as number) + (cupo[f - 1] as number);

  const filaDeLugar: number[] = new Array<number>(G).fill(-1);
  const libres: number[] = [...cupo];
  const miembros: number[][] = Array.from({ length: F }, () => []);
  // La fila de cada finalista, por su carril: el punto `u + k G / L` cae en una sola fila, y los puntos crecen con el carril.
  const u = e.rng() * (G / L);
  const finalistas: number[] = [];
  for (let r = 0; r < G; r++) if ((e.carrilEn[r] ?? -1) >= 0) finalistas.push(r);
  for (const r of finalistas) {
    const punto = u + ((e.carrilEn[r] as number) * G) / L;
    let f = F - 1;
    for (let i = 0; i < F; i++) {
      if (punto < (desde[i] as number) + (cupo[i] as number)) {
        f = i;
        break;
      }
    }
    filaDeLugar[r] = f;
    (miembros[f] as number[]).push(r);
    libres[f] = (libres[f] as number) - 1;
    if ((libres[f] as number) < 0) return null;
  }
  // Como mucho dos finalistas por fila, una en cada subfila; y las de cada fila se tienen que poder pintar.
  for (let f = 0; f < F; f++) {
    if (!e.sinTopeDeFinalistas && (miembros[f] as number[]).length > FINALISTAS_POR_FILA) return null;
    if (!sePuedePintar(miembros[f] as number[], e.carrilEn, seJuntan)) return null;
  }

  // Las demás: búsqueda con vuelta atrás, de adelante hacia atrás, sin fila de siempre. En el corral el orden se lee, y si las demás
  // prefirieran su fila de siempre (`filaDeRango`), la que queda fuera de ese dibujo sería una finalista o una desplazada por una. Cada
  // lugar lleva una llave sorteada por fila, gastada una sola vez antes de buscar (la misma entrada gasta siempre lo mismo). Al buscar,
  // las filas con lugar se prueban de mayor a menor llave elevada a uno sobre sus lugares libres: la primera sale con probabilidad
  // proporcional a lo que le queda libre, que es repartir al azar los lugares que sobran, igual para cualquier lugar.
  // Sin el dibujo de siempre, dos puestos vecinos (que en el plan se juntan más) caen más seguido en la misma fila, y una búsqueda con el
  // tope de nodos a veces no llega a un reparto que existe: si se acaba el tope, se vuelve a buscar con llaves nuevas, hasta `INTENTOS`
  // veces. Cada intento gasta lo mismo, así que la misma entrada sigue dando la misma salida.
  const restantes: number[] = [];
  for (let r = 0; r < G; r++) if ((e.carrilEn[r] ?? -1) < 0) restantes.push(r);
  const llaves = new Map<number, number[]>();
  const sortear = (): void => {
    for (const r of restantes) {
      const k: number[] = [];
      for (let f = 0; f < F; f++) k.push(e.rng());
      llaves.set(r, k);
    }
  };
  const ordenDe = (r: number): number[] => {
    const k = llaves.get(r) as number[];
    const peso = (f: number): number => Math.pow(k[f] as number, 1 / (libres[f] as number));
    const fs: number[] = [];
    for (let f = 0; f < F; f++) if ((libres[f] as number) > 0) fs.push(f);
    return fs.sort((a, b) => peso(b) - peso(a) || a - b);
  };
  let nodos = 0;
  const buscar = (i: number): boolean => {
    if (++nodos > NODOS_MAX) return false;
    if (i >= restantes.length) return true;
    const r = restantes[i] as number;
    for (const f of ordenDe(r)) {
      if ((libres[f] as number) <= 0) continue;
      const fila = miembros[f] as number[];
      fila.push(r);
      if (sePuedePintar(fila, e.carrilEn, seJuntan)) {
        filaDeLugar[r] = f;
        libres[f] = (libres[f] as number) - 1;
        if (buscar(i + 1)) return true;
        filaDeLugar[r] = -1;
        libres[f] = (libres[f] as number) + 1;
      }
      fila.pop();
      if (nodos > NODOS_MAX) return false;
    }
    return false;
  };
  // Una búsqueda que se queda sin nodos deshace todo lo que puso: el próximo intento arranca con las finalistas solas.
  for (let intento = 0; intento < INTENTOS; intento++) {
    sortear();
    nodos = 0;
    if (buscar(0)) return filaDeLugar;
    if (nodos <= NODOS_MAX) return null;
  }
  return null;
}

/** Lo que el reparto lee de la ronda: el plan del grupo (para saber quiénes se juntan), los carriles y la semilla de las filas. */
export type DatosFilas = DatosSubfila;

/**
 * La forma del grupo y la fila de cada lugar para una pantalla: prueba con las filas de hoy y después con una más, hasta llegar a una
 * fila por carril o hasta las que entran en la pantalla, y se queda con el primer reparto en que toda fila se puede pintar en dos
 * subfilas. Si ninguno cumple, el último sin mirar quiénes se juntan (el orden de lado sigue siendo el de los carriles y nadie cruza; dos
 * de la misma subfila pueden juntarse, y eso lo cuenta el auditor de sólidos), y si ni así, las filas de hoy sin tope de finalistas. Es
 * pura y se recalcula entera en cada llamada: no guarda nada de una pantalla a la otra.
 */
export function formaDelGrupo(o: { P: Pantalla; d: DatosFilas; nombrePx: number; nombreW: number; cuerpoPx: number }): { forma: Forma; filaDeLugar: readonly number[] } {
  const d = o.d;
  const G = d.gente.length;
  const L = d.lanes.length;
  const base = formaDe(o.P, Math.max(1, G), o.nombrePx, o.nombreW);
  const deHoy = (filas: number): number[] => Array.from({ length: G }, (_, r) => filaDeRango(r, filas));
  if (G <= 0 || L <= 0) return { forma: base, filaDeLugar: deHoy(base.filas) };
  // Quién sale en cada lugar y, si es finalista, en qué carril corre.
  const carrilDePersona = new Map<number, number>();
  d.lanes.forEach((p, k) => carrilDePersona.set(p, k));
  const personaEn: number[] = new Array<number>(G).fill(-1);
  const carrilEn: number[] = new Array<number>(G).fill(-1);
  for (const p of d.gente) {
    const r = d.orden.rango(p);
    if (r >= 0 && r < G) {
      personaEn[r] = p;
      carrilEn[r] = carrilDePersona.get(p) ?? -1;
    }
  }
  const m = muestrasDelPlan(d);
  const semilla = (pedidas: number): (() => number) => sembrar(d.semillaFilas ^ Math.imul(pedidas + 1, 0x9e3779b1));
  const tope = Math.max(base.filas, Math.min(L, base.filasMax));
  let ultima: { forma: Forma; pedidas: number } | null = null;
  for (let pedidas = base.filas; pedidas <= tope; pedidas++) {
    const forma = formaDe(o.P, Math.max(1, G), o.nombrePx, o.nombreW, { filasMin: pedidas });
    ultima = { forma, pedidas };
    const umbral = umbralSubfila(forma.esc, o.cuerpoPx);
    const juntas = new Map<number, boolean>();
    const seJuntan = (a: number, b: number): boolean => {
      const clave = a < b ? a * G + b : b * G + a;
      let v = juntas.get(clave);
      if (v === undefined) {
        v = pesoDelPar(m, personaEn[a] as number, personaEn[b] as number, umbral) > 0;
        juntas.set(clave, v);
      }
      return v;
    };
    const filaDeLugar = repartirFilas({ lugares: G, filas: forma.filas, carriles: L, carrilEn, seJuntan, rng: semilla(pedidas) });
    if (filaDeLugar) return { forma, filaDeLugar };
  }
  // El último intento, sin mirar quiénes se juntan: las finalistas siguen en el orden de su carril, como mucho dos por fila.
  const final = ultima as { forma: Forma; pedidas: number };
  const sinJuntas = repartirFilas({ lugares: G, filas: final.forma.filas, carriles: L, carrilEn, rng: semilla(final.pedidas) });
  if (sinJuntas) return { forma: final.forma, filaDeLugar: sinJuntas };
  // Si la pantalla no deja ni dos finalistas por fila, las filas de hoy sin tope: el orden de lado de las finalistas sigue sin cruzarse.
  const sinTope = repartirFilas({ lugares: G, filas: base.filas, carriles: L, carrilEn, rng: semilla(base.filas), sinTopeDeFinalistas: true });
  return { forma: base, filaDeLugar: sinTope ?? deHoy(base.filas) };
}
