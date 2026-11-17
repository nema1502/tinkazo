import { PUNTOS_LLAMA, TAM3D, ZC, type Efecto3D, type PiedraCerro } from "./carrera-3d-mapa";
import { hashLugar } from "./carrera-rocas";
import { LLAMA_HOCICO } from "./carrera-forma";
import { ENSANCHE, CARGA_ESCUPIDA, VUELO_ESCUPIDA } from "./carrera-obstaculos";
import type { Plan as PlanFinal } from "./plan";

/**
 * Lo que se ve de los obstáculos de la recta (`carrera-obstaculos.ts`) en un cuadro, sin Pixi ni three: las piedras y la ráfaga tal como las
 * dibujan el 2D (`pintarObstaculos` en `carrera.ts`) y el 3D (`carrera-3d-obstaculos.ts`), y a quién le está pasando algo (para el encuadre del 2D).
 *
 * Es una función de la hora del show: la misma ronda da el mismo cuadro llamado directo, avanzando cuadro a cuadro o saltando hacia adelante y
 * hacia atrás. No guarda nada de un cuadro al otro: los objetos que devuelve se reservan al armar la vista y se reescriben en cada llamada, así que
 * el camino de cada cuadro no crea objetos nuevos. Quien los recibe los usa en ese cuadro y no los guarda.
 */

/** Lo que la vista lee del show (`Datos` en `carrera-show.ts`). */
export interface DatosVista {
  final: PlanFinal;
  lanes: readonly number[];
  tAbre: number;
  tCrown: number;
  q(t: number): number;
  tDeQ(q: number): number;
}

/** Dónde están los carriles en el mundo 2D, en píxeles (`carrilesDe` y `Xs` en `carrera.ts`). Se lee en cada cuadro: puede cambiar con la pantalla. */
export interface GeometriaVista {
  /** Dónde empieza la recta. */
  readonly xs: number;
  /** Lo que mide la recta (`RECTA` por el ancho de la pantalla). */
  readonly largo: number;
  /** El ancho de la pantalla. */
  readonly ancho: number;
  /** El tamaño de la llama en los carriles. */
  readonly esc: number;
  /** La unidad de la pantalla (`u`): el tamaño de las piedras sale de ella, como el del 3D. */
  readonly u: number;
  /** Lo que mide de fondo cada carril, en píxeles: las piedras chicas no se salen del carril de la víctima. */
  readonly altoFila: number;
  /** El piso de cada carril. */
  yPie(carril: number): number;
  /**
   * Dónde pisa en `t` la finalista del carril `carril` (`piso` en `carrera-trayectorias.ts`): mientras pasa de su fila del grupo a su carril, que
   * puede durar hasta pasada la mitad de la recta, no está en `yPie`.
   */
  piso(carril: number, t: number): number;
  /** De qué tamaño se dibuja en `t` la finalista del carril `carril` (`escEn` en `carrera-trayectorias.ts`): mientras pasa a su carril, no es `esc`. */
  escEn(carril: number, t: number): number;
}

export interface VistaObstaculos {
  /** Las piedras, la ráfaga y la escupida que están pasando en `t`. El arreglo y sus objetos son siempre los mismos: valen hasta la próxima llamada. */
  efectos(t: number): Efecto3D[];
  /** Las personas a las que les está pasando algo en `t` (la piedra, la que salta mal, el grupo de la ráfaga, las dos de la escupida). El mismo arreglo en cada llamada. */
  enApuros(t: number): readonly number[];
  /** Si la ficha de `persona` lleva en `t` la marca de un obstáculo: desde `MARCA_ANTES` antes del hecho hasta `MARCA_DESPUES` después. */
  marcada(persona: number, t: number): boolean;
}

/** Desde cuántos segundos antes del hecho la ficha de la víctima lleva la marca y no se apaga. */
export const MARCA_ANTES = 0.3;
/** Hasta cuántos segundos después del hecho. */
export const MARCA_DESPUES = 1.8;

/** Cuántas piedras caen del cerro: la grande y cuatro chicas. */
export const PIEDRAS_CERRO = 5;
/** El radio de la piedra grande y el de las chicas, en unidades del 3D (30 `u` cada una): es el tamaño de siempre. */
export const PIEDRA_GRANDE = 0.95;
export const PIEDRA_CHICA: readonly [number, number] = [0.4, 0.75];
/** Cuánto aire queda entre el hocico de la víctima (su huella del 3D, la más grande) y la piedra grande, en `u`. */
export const PIEDRA_HOLGURA = 8;
/** Cuánto más adelante que la grande caen las chicas, en `u`: nunca detrás, donde viene la víctima. */
export const PIEDRA_ADELANTE: readonly [number, number] = [9, 60];
/** Cuánto rueda hacia adelante, en `u`, delante de la víctima: ella frena y la piedra se le va. */
export const PIEDRA_RUEDA = 78;
/** De dónde viene al caer, en `u`: de arriba y de atrás, del lado del cerro. */
export const PIEDRA_CAE_ALTO = 450;
export const PIEDRA_CAE_ATRAS = 200;
/** Cuánto se sale de su carril, como mucho, una piedra chica: con la ráfaga, la vecina se acerca hasta 0,3 de carril. */
export const PIEDRA_COSTADO = 0.3;
/** Lo que mide la huella del 3D de una llama hacia atrás, hacia adelante, de costado y de alto, en unidades del dibujo (`PUNTOS_LLAMA`). */
const COLA_3D = -Math.min(...PUNTOS_LLAMA.map((p) => p[0]));
const HOCICO_3D = Math.max(...PUNTOS_LLAMA.map((p) => p[0]));
const COSTADO_3D = Math.max(...PUNTOS_LLAMA.map((p) => Math.abs(p[2])));
const ALTO_3D = Math.max(...PUNTOS_LLAMA.map((p) => p[1]));
const suave3 = (v: number): number => {
  const x = Math.max(0, Math.min(1, v));
  return x * x * (3 - 2 * x);
};

/**
 * Dónde caen las piedras de un obstáculo, elegido una vez para toda su ventana: cuánto se corre la grande de costado (`dy0`, en píxeles) y
 * cuánto más adelante cae (`extra`), y para cada chica de qué lado de la línea va (1 o -1) o si no cae (0).
 */
interface Arreglo {
  dy0: number;
  extra: number;
  lados: number[];
}
const DERECHO: Arreglo = { dy0: 0, extra: 0, lados: [1, 1, 1, 1, 1] };

/**
 * Pone las piedras del cerro de un cuadro en `f.piedras` (las mismas cinco piezas en cada llamada). `f.x` y `f.y` son dónde está la víctima
 * en este cuadro y `esc` su tamaño: la piedra grande cae delante de su hocico, con aire, y desde que pica rueda hacia adelante a la par de
 * ella y un poco más, así que ella frena y no la alcanza. Las chicas caen todavía más adelante y se quedan en su carril, sin meterse en el
 * de la vecina. `a` dice cómo se acomodan para no caerle a otra finalista (`arregloDe`). Todo sale de la hora, del lugar de la víctima y de
 * un hash del obstáculo: nada de azar.
 *
 * Antes caía fija en el piso, a medio cuerpo del hocico, y rodaba hacia adelante más despacio que la llama: la víctima la atravesaba en casi
 * todas las carreras, y las chicas, repartidas a los dos lados y hacia atrás, caían sobre las vecinas.
 */
function ponerPiedras(f: Efecto3D, u: number, altoFila: number, esc: number, a: Arreglo = DERECHO): void {
  const piedras = f.piedras as PiedraCerro[];
  const grande = PIEDRA_GRANDE * 30 * u;
  const base = f.x + HOCICO_3D * esc * TAM3D + grande + PIEDRA_HOLGURA * u + a.extra;
  const costado = (COSTADO_3D * esc * TAM3D) / ZC;
  for (let j = 0; j < PIEDRAS_CERRO; j++) {
    const p = piedras[j] as PiedraCerro;
    const retraso = j === 0 ? 0 : hashLugar(f.id * 3 + j, 1) * 0.06;
    const w = (f.s - retraso) / 0.3;
    // La que no se ve queda en cero: el cuadro no arrastra nada del anterior.
    Object.assign(p, VACIA);
    if (w < 0 || !a.lados[j]) continue;
    const r = j === 0 ? grande : (PIEDRA_CHICA[0] + (PIEDRA_CHICA[1] - PIEDRA_CHICA[0]) * hashLugar(f.id + j, 2)) * 30 * u;
    const dx = j === 0 ? 0 : (PIEDRA_ADELANTE[0] + (PIEDRA_ADELANTE[1] - PIEDRA_ADELANTE[0]) * hashLugar(f.id * 7 + j, 3)) * u;
    // De costado, dentro del carril: ni con la vecina corrida por la ráfaga la piedra le llega a la huella.
    const lado = Math.max(0, Math.min(PIEDRA_COSTADO * altoFila, (1 - PIEDRA_COSTADO) * altoFila - costado - r / ZC - 2 * u));
    const dy = j === 0 ? a.dy0 : a.dy0 + (a.lados[j] ?? 1) * (hashLugar(f.id * 5 + j, 9) - 0.5) * 2 * lado;
    p.r = r;
    p.r2 = (j === 0 ? 17 : 9 + 6 * hashLugar(f.id + j, 2)) * u;
    p.yPiso = f.y + dy;
    if (w < 1) {
      // Viene de atrás y de arriba, y al final cae casi a plomo: cuando pasa por encima del carril de atrás, va alto.
      const c = 1 - w * w;
      p.x = base + dx;
      p.y = p.yPiso - c * c * PIEDRA_CAE_ATRAS * u;
      p.alto = r + c * PIEDRA_CAE_ALTO * u;
      p.k = 1;
      p.cae = w;
      p.rueda = 0;
      p.rebote = 0;
    } else {
      const v = (f.s - retraso - 0.3) / 0.45;
      if (v > 1) {
        Object.assign(p, VACIA);
        continue;
      }
      p.rebote = Math.abs(Math.sin(v * Math.PI * 2.6)) * Math.exp(-v * 3.2) * 48 * u;
      p.x = base + dx + v * PIEDRA_RUEDA * u;
      p.y = p.yPiso;
      p.alto = r * 0.8 + p.rebote;
      p.k = 1 - suave3((v - 0.8) / 0.2);
      p.cae = 1;
      p.rueda = v;
    }
    p.visible = p.k > 1e-3;
  }
}
const VACIA: Readonly<PiedraCerro> = { visible: false, x: 0, y: 0, yPiso: 0, alto: 0, r: 0, r2: 0, k: 0, cae: 0, rueda: 0, rebote: 0 };
const nuevaPiedra = (): PiedraCerro => ({ ...VACIA });

export function crearVistaObstaculos(d: DatosVista, geo: GeometriaVista): VistaObstaculos {
  const obs = d.final.obstaculos ?? [];
  // Un efecto reservado por obstáculo: `id` es su lugar en la lista (lo que parece azar en el dibujo sale de un hash de `id`).
  const reservados: Efecto3D[] = obs.map((o, id) => ({
    tipo: "piedras", s: 0, x: 0, y: 0, y1: 0, ancho: 0, lado: 0, id, boca: { x: 0, y: 0, esc: 0 }, cara: { x: 0, y: 0, esc: 0 },
    ...(o.tipo === "piedras" ? { piedras: Array.from({ length: PIEDRAS_CERRO }, nuevaPiedra) } : {}),
  }));
  const salida: Efecto3D[] = [];
  const apuros: number[] = [];
  // A quién le pasa cada obstáculo y cuándo es el hecho: la piedra, las que tumban la valla y cada una del grupo del viento.
  const marcadas: { persona: number; t0: number }[] = [];
  for (const o of obs) {
    if (o.tipo === "salto") for (const m of o.malas) marcadas.push({ persona: d.lanes[m] as number, t0: d.tDeQ(o.llegan[m] as number) });
    else if (o.tipo === "viento") for (const k of o.carriles) marcadas.push({ persona: d.lanes[k] as number, t0: d.tDeQ(o.q) });
    else marcadas.push({ persona: d.lanes[o.carriles[0] as number] as number, t0: d.tDeQ(o.q) });
  }
  /** Dónde está en el mundo el carril `kk` cuando la recta va en `q` (la misma cuenta que `posicion` en `carrera.ts`). */
  const xCarril = (kk: number, q: number): number => geo.xs + (q + (d.final.pos(kk, q) - q) * ENSANCHE) * geo.largo;
  /** Dónde pisa la llama del carril `kk` a la hora `t`: las piedras y la escupida se ponen en su lugar de ese momento, no en el de su carril. */
  const yCarril = (kk: number, t: number): number => geo.piso(kk, t);
  /** El tamaño de la llama del carril `kk` a la hora `t`: el hocico y la boca se miden con él, no con el del carril. */
  const escCarril = (kk: number, t: number): number => geo.escEn(kk, t);

  /**
   * Si la piedra `p` toca en `t` a alguna finalista, la víctima incluida: la piedra como la esfera del 3D y cada llama con la caja de su
   * huella del 3D y su alto, con un margen. Es la más grande de las dos: lo que no toca en el 3D tampoco toca en el 2D.
   */
  const tocaAlguna = (p: PiedraCerro, t: number, qq: number): boolean => {
    const r = p.r * p.k, rb = r / ZC, margen = 2 * geo.u;
    if (!(r > 0)) return false;
    for (let k = 0; k < d.lanes.length; k++) {
      const e = escCarril(k, t) * TAM3D;
      if (p.alto - r >= ALTO_3D * e) continue;
      const x = xCarril(k, qq), y = yCarril(k, t);
      const px = Math.max(x - COLA_3D * e - margen, Math.min(p.x, x + HOCICO_3D * e + margen));
      const py = Math.max(y - (COSTADO_3D * e) / ZC - margen, Math.min(p.y, y + (COSTADO_3D * e) / ZC + margen));
      if (((px - p.x) / r) ** 2 + ((py - p.y) / rb) ** 2 < 1) return true;
    }
    return false;
  };
  /** Un efecto de prueba para elegir dónde caen las piedras, aparte de los que se devuelven. */
  const ensayo: Efecto3D = { tipo: "piedras", s: 0, x: 0, y: 0, y1: 0, ancho: 0, lado: 0, id: 0, piedras: Array.from({ length: PIEDRAS_CERRO }, nuevaPiedra) };
  /** Las posturas que se prueban para la grande, de la que menos se nota a la que más: de costado (en carriles) y más adelante (en `u`). */
  const POSTURAS: readonly [number, number][] = [[0, 0], [0, 15], [-0.2, 0], [0.2, 0], [0, 30], [-0.2, 15], [0.2, 15], [-0.35, 0], [0.35, 0], [0, 50], [-0.35, 30], [0.35, 30]];
  const arreglos = new Map<number, { clave: string; a: Arreglo }>();
  /**
   * Dónde caen las piedras del obstáculo `id` para que ninguna le caiga a otra finalista. Con las finalistas todavía pasando de sus filas del
   * grupo a sus carriles, a veces otra va justo adelante de la víctima, en su misma línea: la piedra grande se corre un poco de costado o cae
   * un poco más adelante, y cada chica va del lado de la línea que queda libre, o no cae. Se elige una vez por obstáculo y por pantalla,
   * mirando su ventana entera, y sale igual se lo pida en el orden que se lo pida.
   */
  function arregloDe(id: number, o: (typeof obs)[number]): Arreglo {
    const clave = `${geo.xs}|${geo.largo}|${geo.u}|${geo.altoFila}`;
    const ya = arreglos.get(id);
    if (ya && ya.clave === clave) return ya.a;
    const kk = o.carriles[0] as number;
    const qa = o.q - 0.05, qf = o.q + 0.1;
    const t0 = d.tDeQ(qa), t1 = d.tDeQ(qf);
    const choques = (a: Arreglo, j: number): number => {
      let n = 0;
      // A 120 por segundo: entre dos cuadros de 60 nada se acerca más que el margen.
      for (let t = t0; t <= t1; t += 1 / 120) {
        const qq = d.q(t);
        ensayo.id = id;
        ensayo.s = (qq - qa) / (qf - qa);
        ensayo.x = xCarril(kk, qq);
        ensayo.y = yCarril(kk, t);
        ponerPiedras(ensayo, geo.u, geo.altoFila, escCarril(kk, t), a);
        const p = (ensayo.piedras as PiedraCerro[])[j] as PiedraCerro;
        if (p.visible && tocaAlguna(p, t, qq)) n++;
      }
      return n;
    };
    let a: Arreglo = { dy0: 0, extra: 0, lados: [1, 0, 0, 0, 0] }, menos = Infinity;
    for (const [dy, extra] of POSTURAS) {
      const prueba: Arreglo = { dy0: dy * geo.altoFila, extra: extra * geo.u, lados: [1, 0, 0, 0, 0] };
      const n = choques(prueba, 0);
      if (n < menos) [a, menos] = [prueba, n];
      if (n === 0) break;
    }
    for (let j = 1; j < PIEDRAS_CERRO; j++) {
      a.lados[j] = 1;
      if (choques(a, j) === 0) continue;
      a.lados[j] = -1;
      if (choques(a, j) === 0) continue;
      a.lados[j] = 0;
    }
    arreglos.set(id, { clave, a });
    return a;
  }
  const sumar = (persona: number): void => {
    if (!apuros.includes(persona)) apuros.push(persona);
  };

  return {
    efectos(t) {
      salida.length = 0;
      if (!obs.length || t < d.tAbre || t > d.tCrown) return salida;
      const qq = d.q(t);
      for (let id = 0; id < obs.length; id++) {
        const o = obs[id] as (typeof obs)[number];
        const f = reservados[id] as Efecto3D;
        if (o.tipo === "piedras") {
          const qa = o.q - 0.05, qf = o.q + 0.1;
          if (qq < qa || qq > qf) continue;
          const kk = o.carriles[0] as number;
          f.tipo = "piedras";
          f.s = (qq - qa) / (qf - qa);
          // Caen delante de donde está ella en este cuadro y en la línea por donde va (`ponerPiedras`): si todavía pasa de su fila del grupo
          // a su carril, o la corre la ráfaga, las piedras van con ella y no quedan en el camino de otra.
          f.x = xCarril(kk, qq);
          f.y = yCarril(kk, t);
          f.y1 = 0;
          f.ancho = 0;
          f.lado = 0;
          ponerPiedras(f, geo.u, geo.altoFila, escCarril(kk, t), arregloDe(id, o));
          salida.push(f);
        } else if (o.tipo === "viento") {
          const qa = o.q - 0.02, qf = o.q + o.dur * 1.7;
          if (qq < qa || qq > qf) continue;
          let suma = 0, kMin = Infinity, kMax = -Infinity;
          for (let j = 0; j < o.carriles.length; j++) {
            const kk = o.carriles[j] as number;
            suma += xCarril(kk, qq);
            if (kk < kMin) kMin = kk;
            if (kk > kMax) kMax = kk;
          }
          f.tipo = "viento";
          f.s = (qq - qa) / (qf - qa);
          f.x = suma / o.carriles.length;
          f.y = yCarril(kMin, t);
          f.y1 = yCarril(kMax, t);
          f.ancho = 0.55 * geo.ancho;
          f.lado = o.lado;
          salida.push(f);
        } else if (o.tipo === "escupida") {
          // La gota sale a la hora del obstáculo, vuela 0,35 s y el salpicón dura hasta 1,2 s desde que salió: todo en segundos del show.
          const t0 = d.tDeQ(o.q);
          if (t < t0 || t > t0 + 1.2) continue;
          const vuela = t - t0 <= VUELO_ESCUPIDA;
          f.tipo = "escupida";
          f.s = vuela ? (t - t0) / VUELO_ESCUPIDA : 1 + (t - t0 - VUELO_ESCUPIDA) / (1.2 - VUELO_ESCUPIDA);
          const escupe = o.escupe;
          const victima = o.carriles[0] as number;
          const qLlega = d.q(t0 + VUELO_ESCUPIDA);
          if (f.boca) {
            f.boca.esc = escCarril(escupe, t0);
            f.boca.x = xCarril(escupe, o.q) + LLAMA_HOCICO * f.boca.esc;
            f.boca.y = yCarril(escupe, t0);
          }
          if (f.cara) {
            f.cara.esc = escCarril(victima, t0 + VUELO_ESCUPIDA);
            f.cara.x = xCarril(victima, qLlega) + LLAMA_HOCICO * f.cara.esc;
            f.cara.y = yCarril(victima, t0 + VUELO_ESCUPIDA);
          }
          f.x = f.boca?.x ?? 0;
          f.y = f.boca?.y ?? 0;
          f.y1 = f.cara?.y ?? 0;
          f.ancho = 0;
          f.lado = o.lado;
          salida.push(f);
        }
      }
      return salida;
    },
    enApuros(t) {
      apuros.length = 0;
      if (!obs.length) return apuros;
      const qq = d.q(Math.max(t, d.tAbre));
      for (let i = 0; i < obs.length; i++) {
        const o = obs[i] as (typeof obs)[number];
        if (o.tipo === "piedras") {
          if (qq > o.q - 0.03 && qq < o.q + 0.09) sumar(d.lanes[o.carriles[0] as number] as number);
        } else if (o.tipo === "salto") {
          for (let j = 0; j < o.malas.length; j++) {
            const m = o.malas[j] as number;
            if (qq > (o.llegan[m] as number) - 0.02 && qq < (o.llegan[m] as number) + 0.08) sumar(d.lanes[m] as number);
          }
        } else if (o.tipo === "escupida") {
          // Las dos entran al plano: quien escupe desde que carga y quien recibe hasta que pasa el salpicón.
          const t0 = d.tDeQ(o.q);
          if (t >= t0 - CARGA_ESCUPIDA && t <= t0 + 1.2) {
            sumar(d.lanes[o.carriles[0] as number] as number);
            if (o.escupe >= 0) sumar(d.lanes[o.escupe] as number);
          }
        } else if (qq > o.q - 0.01 && qq < o.q + o.dur * 1.4) for (let j = 0; j < o.carriles.length; j++) sumar(d.lanes[o.carriles[j] as number] as number);
      }
      return apuros;
    },
    marcada(persona, t) {
      for (let i = 0; i < marcadas.length; i++) {
        const m = marcadas[i] as { persona: number; t0: number };
        if (m.persona === persona && t >= m.t0 - MARCA_ANTES && t < m.t0 + MARCA_DESPUES) return true;
      }
      return false;
    },
  };
}
