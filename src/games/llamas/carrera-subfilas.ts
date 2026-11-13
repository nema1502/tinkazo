import { TAM3D, ZC } from "./carrera-3d-mapa";
import { RECTA } from "./carrera-base";
import { CUERPO } from "./carrera-marcha";
import { ENSANCHE } from "./carrera-obstaculos";
import type { Datos } from "./carrera-show";
import { LLEGADA_TARDE } from "./carrera-tandas";
import { hashDe, hashTexto, sembrar } from "../pixi/kit/azar";

/**
 * Las subfilas del grupo, puras: cada llama de una fila corre un poco arriba (-1) o un poco abajo (+1) de la línea de su fila, y no
 * cambia de lado en toda la carrera. Este módulo solo elige el lado; quien dibuja suma `signo × δ` a la y de la fila.
 *
 * El lado sale del plan: dos de una misma fila que en el plan se juntan (corriendo a menos de un largo y su aire, o echadas una al
 * lado de la otra) van a lados opuestos. Por fila se prueban todas las asignaciones y gana la que deja menos tiempo juntas a las del
 * mismo lado; si empatan, la que más alterna por puesto de salida, y si siguen empatadas, una moneda sembrada de la fila elige entre ellas.
 *
 * La moneda importa: con menos de dos finalistas en la fila, una asignación y la opuesta cuestan lo mismo, y quedarse con «la primera»
 * ponía siempre abajo a la última por puesto de salida, así que el lado copiaba el orden de salida dentro de la fila y, con él, a la
 * finalista. Con la moneda, en esas filas cada una va arriba o abajo mitad y mitad. Nadie queda en la línea por no juntarse con nadie: si
 * unas quedaran en la línea y otras no, estar fuera de ella podría marcar a las finalistas (y con ellas a la ganadora). La única que va en
 * la línea es la que está sola en su fila (`signo` 0): no tiene con quién juntarse, y estar sola en la fila depende solo del cupo de las
 * filas, que no mira a nadie (en el celular parado, con hasta 24 personas, todas las filas son de una).
 *
 * Las costuras: la echada se abre hacia su lado, y en las pantallas donde la fila es angosta (el celular parado) dos echadas de filas
 * vecinas que quedan quietas a la misma altura de la pista (o una pasa por al lado de la otra mientras se abre), la de arriba abierta
 * hacia abajo y la de abajo hacia arriba, terminarían una encima de la otra. Con `costuras`, entre las asignaciones de cada fila que
 * empatan en peso se elige la combinación de todas las filas que deja menos costuras así (`acomodarCosturas`).
 *
 * El módulo no lee quién gana. Lee el plan del grupo, quiénes son finalistas y su carril (`d.lanes`): las finalistas de una fila van en
 * el orden de su carril, la de carril menor del lado de arriba, para que al pasar a los carriles ninguna cruce a otra. Pero el plan del
 * grupo no es ciego a la recta: el orden en que las finalistas entran a la recta, que sale de la historia de la final, decide sus puestos
 * de salida (`carrera-orden.ts`), y eso lo vigila el delator «entrada». En el último segundo antes de abrirse la recta, además, su
 * puntaje se empalma con la recta: por eso las muestras paran antes, cuando las finalistas empiezan a pasar a los carriles. La guarda de
 * que el lado no delata a la ganadora es la medida contra toda la gente de la ronda, no lo que este módulo lee.
 *
 * Sin `Math.random` ni reloj: la misma ronda da siempre los mismos signos.
 */

/**
 * Cuánto se corre cada subfila de la línea de la fila, en medios anchos del cuerpo del 3D: δ = SUBFILA × 13 × esc × TAM3D / ZC, en el
 * fondo del mundo 2D. En 0 apaga las subfilas: todos los signos dan 0 y la carrera queda como sin ellas.
 */
export const SUBFILA = 1.2;
/** El aire que se suma al largo de la llama para decir que dos de una fila se juntan, como fracción del largo. */
export const AIRE_SUBFILA = 0.1;
/** Las muestras del plan por segundo. */
export const MUESTRAS_POR_SEGUNDO = 20;
/** Cuánto pesa que dos de una fila queden echadas a menos del umbral: como estar juntas 2,5 s corriendo. */
export const PESO_ECHADAS = 50;
/** Hasta cuántas por fila se prueban todas las asignaciones; con más, alternan por puesto. */
export const FUERZA_BRUTA_MAX = 16;
/** El frenado de la echada de siempre, en segundos: la velocidad con que cae baja pareja a cero y queda quieta. */
export const FRENADO = 1.2;
/** El paso con que se mide la velocidad de cada una al echarse, en segundos. */
export const PASO_V0 = 1 / 120;
/**
 * Desde cuántas en una fila la echada se abre al costado. Con dos o menos van en subfilas opuestas (una sola, o dos que alternan), así que
 * nadie corre en la subfila de la que se echa: se queda en la suya y no se abre, y no hay costuras con la fila vecina.
 */
export const ABRE_DESDE = 3;
/** El largo de la llama del 3D en el dibujo (la cola a 36 y la nariz a 38), en píxeles cuando su tamaño vale 1, antes de `TAM3D`. */
const LARGO_DIBUJO = 74;
/** El medio ancho del cuerpo de la llama del 3D en el dibujo, en píxeles cuando su tamaño vale 1, antes de `TAM3D`. */
const MEDIO_DIBUJO = 13;
/** Cuántos segundos antes de abrirse la recta se empalma el puntaje de las finalistas con la recta (`EMPALME` de `carrera-orden.ts`). */
const EMPALME_S = 1;
/**
 * Cuántos segundos antes de echarse empieza a abrirse. El plan arrancaba en 0,5 s, pero el auditor midió que quien viene pegada atrás
 * llega antes de que la apertura alcance para pasar al lado; con 1,0 s, al echarse ya se corrió lo suficiente.
 */
export const ECHADA_ANTES = 1.0;
/** Cuánto dura la apertura al costado, en segundos: con el tope de aceleración de la marcha. */
export const ECHADA_ABRE = 1.7;

export type Signo = -1 | 0 | 1;

/** Lo que el módulo lee de la ronda: el plan del grupo, quiénes son finalistas y su carril, y la semilla de las filas para la moneda. */
export type DatosSubfila = Pick<Datos, "gente" | "lanes" | "orden" | "tiempos" | "tSalida" | "tAbre" | "tCarriles" | "tandas" | "dist" | "semillaFilas">;

export interface MuestrasPlan {
  /** La primera muestra, en segundos de show: la salida, o la salida más `LLEGADA_TARDE` si hay tandas. */
  readonly t0: number;
  /** Entre una muestra y la siguiente, en segundos. */
  readonly paso: number;
  /**
   * Por persona del grupo, su puntaje (`d.orden.puntaje`, en cuerpos) en cada muestra mientras corre: hasta que se echa o hasta que las
   * finalistas empiezan a pasar a los carriles (`d.tCarriles`), y nunca en el último segundo antes de abrirse la recta, que se empalma
   * con ella. En ese tramo solo corren finalistas: las demás ya se echaron (`REMATE` de `carrera-tiempos.ts`).
   */
  readonly corre: ReadonlyMap<number, Float64Array>;
  /** Por cada una que se echa, dónde queda quieta con el frenado de siempre, en cuerpos desde un origen común a toda la ronda. */
  readonly reposo: ReadonlyMap<number, number>;
  /**
   * Por cada una que se echa, dónde va mientras se abre al costado (de `ECHADA_ANTES` s antes de echarse hasta terminar de abrirse), en
   * cuerpos desde el origen común: `i0` es la muestra de la primera. En ese rato pasa de su subfila al costado y puede tocar a cualquiera
   * de su lado: a la que corre en su subfila o a la que ya está echada ahí.
   */
  readonly transito: ReadonlyMap<number, { i0: number; x: Float64Array }>;
  /** Dónde va `persona` en la muestra `i`, en cuerpos desde el origen común: corriendo, deslizándose o quieta; NaN si no se sabe. */
  xEn(persona: number, i: number): number;
}

/** El medio ancho del cuerpo de la llama del 3D de tamaño `esc`, en el fondo del mundo 2D (píxeles). */
export function medioAncho3D(esc: number): number {
  return (MEDIO_DIBUJO * esc * TAM3D) / ZC;
}

/** Cuánto se corre cada subfila de la línea de su fila, en píxeles del fondo del mundo 2D, para una llama de tamaño `esc`. */
export function deltaSubfila(esc: number, subfila: number = SUBFILA): number {
  return subfila * medioAncho3D(esc);
}

/** Anchos de pantalla a cuerpos: el cuerpo mide CUERPO × ENSANCHE × RECTA anchos. */
const ANCHOS_A_CUERPOS = 1 / (CUERPO * ENSANCHE * RECTA);

/** Dónde va `persona` en el grupo a la hora `t`, en cuerpos desde el origen común de la ronda: el frente más su puntaje (`lugarEnGrupo`). */
function xEnCuerpos(d: DatosSubfila, persona: number, t: number): number {
  const tt = Math.max(d.tSalida, Math.min(t, d.tAbre));
  return d.dist(Math.min(tt, d.tAbre)) * ANCHOS_A_CUERPOS + d.orden.puntaje(persona, tt);
}

/**
 * A qué velocidad va `persona` cuando se echa, en cuerpos por segundo: la suya, la del frente más la de su puntaje, y no solo la del
 * frente. Con la del frente, al echarse la velocidad saltaba hasta medio cuerpo por segundo.
 */
export function velocidadAlEcharse(d: DatosSubfila, persona: number, cae: number): number {
  return (xEnCuerpos(d, persona, cae) - xEnCuerpos(d, persona, cae - PASO_V0)) / PASO_V0;
}

const guardadas = new WeakMap<object, MuestrasPlan>();

/**
 * El plan del grupo muestreado a `MUESTRAS_POR_SEGUNDO`, en cuerpos: no depende de la pantalla, porque la x de dos de la misma fila
 * en el mismo instante difiere solo en su puntaje (`lugarEnGrupo`: x = xFrente + puntaje × cuerpo). Se guarda por ronda.
 */
export function muestrasDelPlan(d: DatosSubfila): MuestrasPlan {
  const ya = guardadas.get(d);
  if (ya) return ya;
  const paso = 1 / MUESTRAS_POR_SEGUNDO;
  const t0 = d.tSalida + (d.tandas.length ? LLEGADA_TARDE : 0);
  const corre = new Map<number, Float64Array>();
  const reposo = new Map<number, number>();
  const caida = new Map<number, { cae: number; x: number; v0: number }>();
  for (const p of d.gente) {
    const cae = d.tiempos.cae.get(p) ?? Infinity;
    const hasta = Math.min(cae, d.tCarriles, d.tAbre - EMPALME_S);
    const n = hasta >= t0 ? Math.floor((hasta - t0) / paso + 1e-9) + 1 : 0;
    const a = new Float64Array(n);
    for (let i = 0; i < n; i++) a[i] = d.orden.puntaje(p, t0 + i * paso);
    corre.set(p, a);
    // Quieta: donde se echa más lo que se desliza al frenar con su propia velocidad (`carrera-trayectorias.ts`: v0 × T / 2).
    if (Number.isFinite(cae)) {
      const c = { cae, x: xEnCuerpos(d, p, cae), v0: velocidadAlEcharse(d, p, cae) };
      caida.set(p, c);
      reposo.set(p, c.x + (c.v0 * FRENADO) / 2);
    }
  }
  // El frente en cada muestra, en cuerpos: con el puntaje da dónde va cada una que corre.
  const nTotal = Math.max(0, Math.floor((d.tAbre - t0) / paso + 1e-9) + 1);
  const frente = new Float64Array(nTotal);
  for (let i = 0; i < nTotal; i++) frente[i] = d.dist(Math.min(t0 + i * paso, d.tAbre)) * ANCHOS_A_CUERPOS;
  const xEn = (persona: number, i: number): number => {
    const c = caida.get(persona);
    const t = t0 + i * paso;
    if (c && t >= c.cae) {
      const sd = Math.min(t - c.cae, FRENADO);
      return c.x + c.v0 * (sd - (sd * sd) / (2 * FRENADO));
    }
    const a = corre.get(persona);
    if (!a || i < 0 || i >= a.length || i >= nTotal) return NaN;
    return (frente[i] as number) + (a[i] as number);
  };
  const transito = new Map<number, { i0: number; x: Float64Array }>();
  for (const [p, c] of caida) {
    const i0 = Math.max(0, Math.ceil((c.cae - ECHADA_ANTES - t0) / paso - 1e-9));
    const i1 = Math.floor((c.cae - ECHADA_ANTES + ECHADA_ABRE - t0) / paso + 1e-9);
    if (i1 < i0) continue;
    const x = new Float64Array(i1 - i0 + 1);
    for (let i = i0; i <= i1; i++) x[i - i0] = xEn(p, i);
    transito.set(p, { i0, x });
  }
  const m: MuestrasPlan = { t0, paso, corre, reposo, transito, xEn };
  guardadas.set(d, m);
  return m;
}

/** A qué distancia, en cuerpos, se juntan dos de una fila: el largo de la llama del 3D de tamaño `esc` más su aire, en una pantalla con cuerpos de `cuerpoPx`. */
export function umbralSubfila(esc: number, cuerpoPx: number): number {
  return (LARGO_DIBUJO * esc * TAM3D * (1 + AIRE_SUBFILA)) / cuerpoPx;
}

/** Las muestras en que `p`, mientras se abre al costado para echarse, pasa a menos de `umbral` cuerpos de donde está `q`. */
function enTransito(m: MuestrasPlan, p: number, q: number, umbral: number): number {
  const tr = m.transito.get(p);
  if (!tr) return 0;
  let n = 0;
  for (let j = 0; j < tr.x.length; j++) if (Math.abs((tr.x[j] as number) - m.xEn(q, tr.i0 + j)) < umbral) n++;
  return n;
}

/**
 * Cuánto se juntan `a` y `b` en el plan: las muestras en que corren las dos a menos de `umbral` cuerpos, las muestras en que una, mientras se
 * abre para echarse, pasa a menos de `umbral` de la otra (corriendo, deslizándose o ya echada), y `PESO_ECHADAS` si las dos se echan y
 * quedan quietas a menos de `umbral`.
 */
export function pesoDelPar(m: MuestrasPlan, a: number, b: number, umbral: number): number {
  const A = m.corre.get(a);
  const B = m.corre.get(b);
  let peso = 0;
  if (A && B) {
    const n = Math.min(A.length, B.length);
    for (let i = 0; i < n; i++) if (Math.abs((A[i] as number) - (B[i] as number)) < umbral) peso++;
  }
  peso += enTransito(m, a, b, umbral) + enTransito(m, b, a, umbral);
  const ra = m.reposo.get(a);
  const rb = m.reposo.get(b);
  if (ra !== undefined && rb !== undefined && Math.abs(ra - rb) < umbral) peso += PESO_ECHADAS;
  return peso;
}

/** Si dos echadas quedan quietas a menos de `umbral` cuerpos, o una pasa a menos de eso de la otra mientras se abre al costado. */
export function echadasCerca(m: MuestrasPlan, a: number, b: number, umbral: number): boolean {
  const ra = m.reposo.get(a);
  const rb = m.reposo.get(b);
  if (ra === undefined || rb === undefined) return false;
  return Math.abs(ra - rb) < umbral || enTransito(m, a, b, umbral) > 0 || enTransito(m, b, a, umbral) > 0;
}

/** Cuántos bits prendidos tiene `v`. */
function bits(v: number): number {
  let c = 0;
  for (let x = v; x; x &= x - 1) c++;
  return c;
}

/**
 * Las finalistas de una fila, en el orden de su carril, tienen que quedar en ese orden de arriba abajo: la primera arriba, la última
 * abajo y en el medio nunca una de arriba después de una de abajo. Con una sola finalista no hay nada que cumplir. En la máscara, un
 * bit prendido es arriba (-1).
 */
function cumpleCarriles(mascara: number, finalistas: readonly number[]): boolean {
  if (finalistas.length < 2) return true;
  if (!((mascara >> (finalistas[0] as number)) & 1) || (mascara >> (finalistas[finalistas.length - 1] as number)) & 1) return false;
  let abajo = false;
  for (const i of finalistas) {
    const arriba = (mascara >> i) & 1;
    if (arriba && abajo) return false;
    if (!arriba) abajo = true;
  }
  return true;
}

/** Las asignaciones de una fila que empatan en el menor peso, cada una con cuánto alterna por puesto, y la que eligió la moneda. */
interface Candidatas {
  /** Las máscaras (un bit prendido es arriba), en el orden en que se encontraron. */
  mascaras: number[];
  /** Cuánto alterna por puesto cada una. */
  alterna: number[];
  /** La elegida sin mirar las costuras: la que más alterna, y entre ellas la de la moneda. */
  elegida: number;
  /** El azar de la fila, para volver a elegir entre empatadas. */
  azar: () => number;
  /** Con más de `FUERZA_BRUTA_MAX` miembros no hay máscaras: los signos de la alternancia, tal cual. */
  fija?: Signo[];
}

/** De una máscara a los signos de la fila: un bit prendido es arriba (-1). */
const signosDeMascara = (mascara: number, k: number): Signo[] => Array.from({ length: k }, (_, i) => ((mascara >> i) & 1 ? -1 : 1));

/**
 * Las asignaciones de una fila de `k` miembros ordenados por puesto, con sus pesos y sus finalistas (índices en la fila, en orden de
 * carril). Prueba las 2^k máscaras: se queda con las de menor peso entre las del mismo lado y, de esas, la elegida es la que más alterna
 * por puesto; entre las que siguen empatadas elige `azar`, la moneda de la fila. Con menos de dos finalistas, las empatadas vienen de a
 * pares opuestos, así que cada una queda arriba o abajo mitad y mitad. Con más de `FUERZA_BRUTA_MAX`, una sola: la alternancia.
 */
function candidatasDeUnaFila(k: number, peso: readonly Float64Array[], finalistas: readonly number[], azar: () => number): Candidatas {
  // Sola en su fila: va en la línea.
  if (k === 1) return { mascaras: [0], alterna: [0], elegida: 0, azar, fija: [0] };
  if (k > FUERZA_BRUTA_MAX) {
    // Alternan por puesto, empezando del lado que diga la moneda, y las finalistas se acomodan al orden de su carril.
    const primera: Signo = azar() < 0.5 ? -1 : 1;
    const s: Signo[] = Array.from({ length: k }, (_, i) => (i % 2 === 0 ? primera : (-primera as Signo)));
    if (finalistas.length >= 2) {
      let abajo = false;
      finalistas.forEach((i, j) => {
        if (j === 0) s[i] = -1;
        else if (j === finalistas.length - 1 || abajo) s[i] = 1;
        if (s[i] === 1) abajo = true;
      });
    }
    return { mascaras: [0], alterna: [0], elegida: 0, azar, fija: s };
  }
  let mejorPeso = Infinity;
  const mascaras: number[] = [];
  const alternan: number[] = [];
  // Los pares con peso, armados una sola vez: los que nunca se juntan no cambian el costo de ninguna máscara.
  const pares: number[] = [];
  for (let a = 0; a < k; a++) {
    const fila = peso[a] as Float64Array;
    for (let b = a + 1; b < k; b++) if ((fila[b] as number) > 0) pares.push(a, b, fila[b] as number);
  }
  const vecinos = (1 << (k - 1)) - 1;
  for (let mascara = 0; mascara < 1 << k; mascara++) {
    if (!cumpleCarriles(mascara, finalistas)) continue;
    let total = 0;
    for (let j = 0; j < pares.length; j += 3) if (!(((mascara >> (pares[j] as number)) ^ (mascara >> (pares[j + 1] as number))) & 1)) total += pares[j + 2] as number;
    if (total > mejorPeso) continue;
    if (total < mejorPeso) {
      mejorPeso = total;
      mascaras.length = 0;
      alternan.length = 0;
    }
    mascaras.push(mascara);
    alternan.push(bits((mascara ^ (mascara >> 1)) & vecinos));
  }
  return { mascaras, alterna: alternan, elegida: elegirPorAlternancia(mascaras, alternan, azar), azar };
}

/** De las máscaras dadas, la que más alterna; entre las que empatan, la que diga la moneda. */
function elegirPorAlternancia(mascaras: readonly number[], alterna: readonly number[], azar: () => number): number {
  let mejor = -1;
  for (const a of alterna) if (a > mejor) mejor = a;
  const empatadas = mascaras.filter((_, i) => alterna[i] === mejor);
  return empatadas[Math.min(empatadas.length - 1, Math.floor(azar() * empatadas.length))] as number;
}

/** Una costura: dos echadas de filas vecinas que quedan quietas a menos del umbral; `arriba` es la de la fila de arriba. */
interface Costura {
  arriba: number;
  abajo: number;
}

export interface OpcionesSubfila {
  /**
   * Si hay que acomodar las costuras: dos echadas de filas vecinas que quedan quietas cerca no pueden abrirse una hacia la otra (la de
   * arriba hacia abajo y la de abajo hacia arriba). Hace falta donde la fila es angosta para que las dos aperturas entren (`carrera-trayectorias.ts`).
   */
  costuras?: boolean;
}

/**
 * El signo de subfila de cada persona del grupo: -1 arriba de la línea de su fila, +1 abajo; 0 (en la línea) la que está sola en su fila,
 * y todas con las subfilas apagadas. `filaDe` da la fila de cada persona en la pantalla; `umbral`, en cuerpos, a qué distancia se juntan (`umbralSubfila`).
 * Con `subfila` en 0 (las subfilas apagadas) todas quedan en 0.
 */
export function signosDeSubfila(d: DatosSubfila, filaDe: (persona: number) => number, umbral: number, subfila: number = SUBFILA, op: OpcionesSubfila = {}): Map<number, Signo> {
  const signos = new Map<number, Signo>();
  if (subfila === 0) {
    for (const p of d.gente) signos.set(p, 0);
    return signos;
  }
  const m = muestrasDelPlan(d);
  const carril = new Map<number, number>();
  d.lanes.forEach((p, k) => carril.set(p, k));
  const porFila = new Map<number, number[]>();
  for (const p of d.gente) {
    const f = filaDe(p);
    const miembros = porFila.get(f);
    if (miembros) miembros.push(p);
    else porFila.set(f, [p]);
  }
  const filas = [...porFila.keys()].sort((a, b) => a - b);
  const candidatas = new Map<number, Candidatas>();
  const elegida = new Map<number, number>();
  for (const f of filas) {
    const miembros = porFila.get(f) as number[];
    miembros.sort((a, b) => d.orden.rango(a) - d.orden.rango(b) || a - b);
    const k = miembros.length;
    const peso = Array.from({ length: k }, () => new Float64Array(k));
    if (k <= FUERZA_BRUTA_MAX) {
      for (let a = 0; a < k; a++) {
        for (let b = a + 1; b < k; b++) {
          const w = pesoDelPar(m, miembros[a] as number, miembros[b] as number, umbral);
          (peso[a] as Float64Array)[b] = w;
          (peso[b] as Float64Array)[a] = w;
        }
      }
    }
    const finalistas = miembros
      .map((p, i) => ({ i, c: carril.get(p) }))
      .filter((x): x is { i: number; c: number } => x.c !== undefined)
      .sort((x, y) => x.c - y.c)
      .map((x) => x.i);
    // La moneda de la fila: sale de la semilla de las filas con una etiqueta propia, así no repite los números del reparto de filas.
    const azar = sembrar(Math.floor(hashDe(d.semillaFilas, hashTexto(`carrera:subfilas:${f}`)) * 4294967296));
    const c = candidatasDeUnaFila(k, peso, finalistas, azar);
    candidatas.set(f, c);
    elegida.set(f, c.elegida);
  }
  if (op.costuras) acomodarCosturas(m, umbral, filas, porFila, candidatas, elegida);
  for (const f of filas) {
    const miembros = porFila.get(f) as number[];
    const fija = (candidatas.get(f) as Candidatas).fija;
    (fija ?? signosDeMascara(elegida.get(f) as number, miembros.length)).forEach((s, i) => signos.set(miembros[i] as number, s));
  }
  return signos;
}

/** Cuánto cuesta, al acomodar las costuras, dejar una abierta, cambiar la asignación de una fila y no alternar: en ese orden. */
const COSTO_COSTURA = 1e6;
const COSTO_CAMBIO = 1e3;
const COSTO_ALTERNA = 1e-3;
const COSTO_MONEDA = 1e-7;
/** Cuántas asignaciones de una fila se miran al acomodar las costuras: las filas que se abren tienen muchas menos. */
const CANDIDATAS_COSTURA = 1024;

/**
 * Las costuras entre filas vecinas, y la elección que no las cruza. Como las costuras solo unen filas vecinas, las filas forman una cadena
 * y la mejor elección sale exacta, de arriba abajo, guardando para cada asignación de cada fila lo mejor que se puede hacer hasta ahí: entre
 * las asignaciones de menor peso de cada fila, la que deja menos costuras abiertas (una echada de arriba abierta hacia abajo contra una de
 * abajo abierta hacia arriba); si empatan, la que cambia menos filas de lo que habían elegido sin mirar costuras; y cuál de las filas cambia,
 * cuando da lo mismo, lo dice una moneda de cada fila. Antes se elegía fila por fila empezando siempre por la de arriba: la que cambiaba era
 * la de arriba de cada costura, y la compañera de fila de su echada (a veces la finalista) quedaba abajo más seguido que la gente. Dentro de
 * una fila que cambia, la que más alterna y después la moneda. Solo cuentan las filas de `ABRE_DESDE` o más: en las otras la echada no se abre.
 */
function acomodarCosturas(m: MuestrasPlan, umbral: number, filas: readonly number[], porFila: ReadonlyMap<number, number[]>, candidatas: ReadonlyMap<number, Candidatas>, elegida: Map<number, number>): void {
  const indice = new Map<number, number>();
  for (const f of filas) (porFila.get(f) as number[]).forEach((p, i) => indice.set(p, i));
  // Las costuras de cada fila con la de abajo (la fila siguiente), guardadas por la fila de arriba.
  const entre = new Map<number, Costura[]>();
  for (let j = 0; j + 1 < filas.length; j++) {
    const f = filas[j] as number, g = filas[j + 1] as number;
    if (g !== f + 1 || (porFila.get(f) as number[]).length < ABRE_DESDE || (porFila.get(g) as number[]).length < ABRE_DESDE) continue;
    const lista: Costura[] = [];
    for (const a of porFila.get(f) as number[]) {
      if (!m.reposo.has(a)) continue;
      for (const b of porFila.get(g) as number[]) if (echadasCerca(m, a, b, umbral)) lista.push({ arriba: a, abajo: b });
    }
    if (lista.length) entre.set(f, lista);
  }
  if (!entre.size) return;
  // Las opciones de cada fila, con lo que cuesta cada una por sí sola.
  const opciones = filas.map((f) => {
    const c = candidatas.get(f) as Candidatas;
    const actual = elegida.get(f) as number;
    if (c.fija || c.mascaras.length < 2 || (!entre.has(f) && !entre.has(f - 1))) return { mascaras: [actual], costo: [0], fija: c.fija };
    const r = c.azar();
    const idx = c.mascaras.map((_, i) => i);
    for (let i = idx.length - 1; i > 0; i--) {
      const j = Math.floor(c.azar() * (i + 1));
      [idx[i], idx[j]] = [idx[j] as number, idx[i] as number];
    }
    const rango = new Array<number>(idx.length);
    idx.forEach((i, k) => {
      rango[i] = k;
    });
    let maxAlt = 0;
    for (const a of c.alterna) if (a > maxAlt) maxAlt = a;
    // Con muchas, se miran la que ya tenía y las primeras del orden sorteado.
    const usar = idx.length > CANDIDATAS_COSTURA ? [c.mascaras.indexOf(actual), ...idx.filter((i) => c.mascaras[i] !== actual).slice(0, CANDIDATAS_COSTURA - 1)] : c.mascaras.map((_, i) => i);
    return {
      mascaras: usar.map((i) => c.mascaras[i] as number),
      costo: usar.map((i) => (c.mascaras[i] === actual ? 0 : COSTO_CAMBIO + r + (maxAlt - (c.alterna[i] as number)) * COSTO_ALTERNA + (rango[i] as number) * COSTO_MONEDA)),
      fija: undefined,
    };
  });
  const signo = (p: number, mascara: number, fija: Signo[] | undefined): Signo => {
    const i = indice.get(p) as number;
    if (fija) return fija[i] as Signo;
    return (mascara >> i) & 1 ? -1 : 1;
  };
  // De arriba abajo: lo mejor hasta cada asignación de cada fila, y de qué asignación de la fila anterior viene.
  const mejor: Float64Array[] = [];
  const viene: Int32Array[] = [];
  filas.forEach((f, j) => {
    const o = opciones[j] as (typeof opciones)[number];
    const aca = new Float64Array(o.mascaras.length);
    const de = new Int32Array(o.mascaras.length).fill(-1);
    const prev = j > 0 ? (opciones[j - 1] as (typeof opciones)[number]) : null;
    const costuras = j > 0 && filas[j - 1] === f - 1 ? (entre.get(f - 1) ?? []) : [];
    for (let x = 0; x < o.mascaras.length; x++) {
      let base = o.costo[x] as number;
      if (prev) {
        let mejorPrev = Infinity, cual = 0;
        for (let y = 0; y < prev.mascaras.length; y++) {
          let v = (mejor[j - 1] as Float64Array)[y] as number;
          for (const c of costuras) if (signo(c.arriba, prev.mascaras[y] as number, prev.fija) === 1 && signo(c.abajo, o.mascaras[x] as number, o.fija) === -1) v += COSTO_COSTURA;
          if (v < mejorPrev) {
            mejorPrev = v;
            cual = y;
          }
        }
        base += mejorPrev;
        de[x] = cual;
      }
      aca[x] = base;
    }
    mejor.push(aca);
    viene.push(de);
  });
  // De abajo arriba: la asignación de cada fila.
  const ultimo = mejor[mejor.length - 1] as Float64Array;
  let x = 0;
  for (let i = 1; i < ultimo.length; i++) if ((ultimo[i] as number) < (ultimo[x] as number)) x = i;
  for (let j = filas.length - 1; j >= 0; j--) {
    const o = opciones[j] as (typeof opciones)[number];
    elegida.set(filas[j] as number, o.mascaras[x] as number);
    x = (viene[j] as Int32Array)[x] as number;
  }
}
