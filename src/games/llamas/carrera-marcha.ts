/**
 * La marcha de la carrera, pura: los topes con que se mueve una llama y las dos herramientas que los hacen cumplir y los miden.
 *
 * La regla (6 de noviembre de 2026): las llamas no cambian de lugar de golpe; en una carrera real la gente va
 * avanzando, y también al pasar los obstáculos. Hasta entonces el lugar de cada llama era una curva por
 * tramos (la recta) o el casillero de su puesto (el grupo), sin ningún tope de velocidad: se medían saltos de 3,4 cuerpos en un cuadro.
 *
 * El modelo: cada llama tiene su velocidad, que cambia de a poco, y su lugar es lo que esa velocidad recorre. Todo se mide en **cuerpos**
 * (el largo de una llama en el plano: 0,0115 de la recta con la pista ensanchada, `CUERPO`, unos 3,9 % del ancho de la pantalla) y
 * respecto del grupo (a cada llama se le resta lo que se mueve el resto), a 60 cuadros por segundo. Los topes salen de la dirección de la carrera
 * (sección 1, reglas M1 a M4):
 *
 * - **Velocidad**: 1 cuerpo por segundo como mucho respecto del grupo; en un pique o un obstáculo, 1,5 y por 2,5 s como mucho.
 * - **Aceleración**: 1,2 cuerpos por segundo cada segundo, siempre (un pique tarda 1,25 s o más en armarse).
 * - **Por cuadro**: 0,03 cuerpos a 60 cuadros por segundo (1,8 por segundo: es el tope de velocidad con su margen).
 * - **Una causa por cada exceso**: lo que pasa de 1 cuerpo por segundo tiene un motivo a la vista, anotado en el guion (`Causa`): el
 *   pique de quien toma la punta, la piedra, la ráfaga, la valla. Se anuncia antes de que empiece y deja rastro después. Las causas
 *   salen de la ronda y no miran a quien gana.
 *
 * `conMarcha` arma la recta cumpliéndolos y `medirMarcha` los mide sobre lo que se dibuja: la usan la prueba de vitest y el auditor
 * (`scripts/audit-tacto.mjs`). Nada de esto decide quién gana.
 */

import { segundosDeQ } from "./carrera-ritmo";
import type { Plan as PlanFinal } from "./plan";

/** Un cuerpo de llama, en fracción de la recta (`carrera-obstaculos.ts`, `carrera-recta.ts`). */
export const CUERPO = 0.0115;
/** Cuántos cuerpos mide una fila de carril o de grupo, para sumar el movimiento de costado al de adelante (una fila es un poco más que un cuerpo). */
export const FILA_CUERPOS = 1.3;

/** Los topes (en cuerpos, segundos y cuadros a 60 por segundo). */
export const TOPES = {
  velocidad: 1.0,
  /** La velocidad de un pique o de un obstáculo, y cuánto puede durar por encima de `velocidad`. */
  pique: 1.5,
  piqueDura: 2.5,
  aceleracion: 1.2,
  cuadro: 0.03,
  /** Lo que se mide por encima del tope: un 6 % de tolerancia numérica (derivar dos veces una curva muestreada a 60 por segundo da ese margen). */
  tolerancia: 1.06,
} as const;

/** Cuánto antes de empezar se anuncia una causa y cuánto después deja rastro, en segundos (el relator, el polvo, la inclinación). */
export const AVISO = 0.5;
export const RASTRO = 0.6;

/** El paso de las filas del grupo a los carriles de la recta: empieza dos segundos antes de abrirse (sin pasar de la salida) y dura ocho. */
export const CARRIL_ANTES = 2;
export const CARRIL_DURA = 8;

export type TipoCausa = "pique" | "relevo" | "echada" | "carriles" | "piedra" | "valla" | "viento" | "tropiezo" | "plantada" | "escupida" | "trote";

/**
 * Un motivo a la vista para que alguien se mueva más de lo común. `desde` y `hasta` ya incluyen el aviso y el rastro: dentro de ellos el
 * tope es `TOPES.pique`.
 */
export interface Causa {
  tipo: TipoCausa;
  /** Las que lo viven, por índice en la lista de nombres. */
  quienes: number[];
  /** Cuándo se ve venir (se anuncia). */
  aviso: number;
  /** Cuándo empieza el efecto sobre la llama y cuándo termina. */
  desde: number;
  hasta: number;
}

/* -------------------------------------------------------------------------- la medida */

/** Lo que la medida necesita de cada llama: su lugar (cuerpos) y su fila (cuerpos), cuadro a cuadro, y cuándo corre. */
export interface SerieLlama {
  id: number;
  x: ArrayLike<number>;
  /** El costado (la fila) ya convertido a cuerpos; sin él, solo se mide el avance. */
  y?: ArrayLike<number>;
  /** 1 mientras corre (no echada, ya salió). */
  corre: ArrayLike<number>;
}

export interface Exceso {
  t: number;
  id: number;
  tipo: "cuadro" | "velocidad" | "aceleracion";
  valor: number;
  /** Si está dentro de una causa registrada que lo permite. */
  conCausa: boolean;
}

export interface Pase {
  /** Cuándo se cruzan (el instante en que cambia el orden). */
  t: number;
  /** La que pasa y la pasada. */
  pasa: number;
  pasada: number;
  /** Cuánto antes de cruzar venía a menos de 2 cuerpos y acercándose. */
  aviso: number;
  /** Cuánto duró el cruce, de medio cuerpo atrás a medio cuerpo adelante. */
  cruce: number;
}

export interface MedidasMarcha {
  cuadros: number;
  pasoMax: number;
  velMax: number;
  acelMax: number;
  /** Los mayores de cada tipo por encima del tope general. */
  excesos: Exceso[];
  sinCausa: Exceso[];
  pases: Pase[];
  /** Los segundos seguidos que alguien pasa de la velocidad general, como mucho. */
  piqueMax: number;
}

/**
 * Mide la marcha de las llamas cuadro a cuadro (`dt`: segundos entre muestras de las series). Las series son lugares respecto del frente
 * común del grupo; los pasos se normalizan a 60 cuadros por segundo.
 */
export function medirMarcha(series: readonly SerieLlama[], t0: number, dt: number, causas: readonly Causa[] = []): MedidasMarcha {
  const N = Math.min(...series.map((s) => s.x.length));
  const fps = 1 / dt;
  const paso60 = (1 / 60) / dt; // cuántas muestras son un cuadro a 60 por segundo
  const permitida = (id: number, t: number): boolean => causas.some((c) => c.quienes.includes(id) && t >= c.aviso - 1e-9 && t <= c.hasta + 1e-9);
  const out: MedidasMarcha = { cuadros: N, pasoMax: 0, velMax: 0, acelMax: 0, excesos: [], sinCausa: [], pases: [], piqueMax: 0 };
  // Velocidad de cada una por muestra (cuerpos por segundo). Las series ya son lugares respecto del frente común (el camino que avanza
  // igual para todas), que es la velocidad media del grupo: no hay que restar nada, y que se eche una no mueve a las demás.
  const v: Float64Array[] = series.map(() => new Float64Array(N));
  const vy: Float64Array[] = series.map(() => new Float64Array(N));
  series.forEach((s, k) => {
    for (let i = 1; i < N; i++) {
      if (!s.corre[i] || !s.corre[i - 1]) continue;
      (v[k] as Float64Array)[i] = ((s.x[i] as number) - (s.x[i - 1] as number)) / dt;
      (vy[k] as Float64Array)[i] = s.y ? ((s.y[i] as number) - (s.y[i - 1] as number)) / dt : 0;
    }
  });
  const marcar = (e: Omit<Exceso, "conCausa">): void => {
    const x: Exceso = { ...e, conCausa: permitida(e.id, e.t) };
    out.excesos.push(x);
    if (!x.conCausa) out.sinCausa.push(x);
  };
  series.forEach((s, k) => {
    const vk = v[k] as Float64Array, vyk = vy[k] as Float64Array;
    let seguidos = 0;
    for (let i = 2; i < N; i++) {
      if (!s.corre[i] || !s.corre[i - 1] || !s.corre[i - 2]) {
        seguidos = 0;
        continue;
      }
      const t = t0 + i * dt;
      const vel = Math.hypot(vk[i] as number, vyk[i] as number);
      const cuadro = vel / 60;
      const acel = Math.hypot(((vk[i] as number) - (vk[i - 1] as number)) / dt, ((vyk[i] as number) - (vyk[i - 1] as number)) / dt);
      out.pasoMax = Math.max(out.pasoMax, cuadro);
      out.velMax = Math.max(out.velMax, vel);
      out.acelMax = Math.max(out.acelMax, acel);
      const dentro = permitida(s.id, t);
      if (vel > TOPES.velocidad * TOPES.tolerancia) {
        seguidos += dt;
        out.piqueMax = Math.max(out.piqueMax, seguidos);
        // Sobre el tope general: tiene que haber causa y no pasar el tope del pique.
        if (!dentro || vel > TOPES.pique * TOPES.tolerancia) marcar({ t, id: s.id, tipo: "velocidad", valor: vel });
      } else seguidos = 0;
      if (cuadro > TOPES.cuadro * TOPES.tolerancia * (dentro ? TOPES.pique / TOPES.velocidad : 1)) marcar({ t, id: s.id, tipo: "cuadro", valor: cuadro });
      // La aceleración no tiene permiso: ni en un pique ni en un obstáculo.
      if (acel > TOPES.aceleracion * TOPES.tolerancia) {
        const x: Exceso = { t, id: s.id, tipo: "aceleracion", valor: acel, conCausa: false };
        out.excesos.push(x);
        out.sinCausa.push(x);
      }
    }
  });
  void fps;
  void paso60;
  // Los adelantamientos: cada cambio de orden entre dos que corren y que venían separadas (a la par que se rozan no es adelantar:
  // hace falta que antes y después hayan estado a un cuerpo o más una de la otra).
  const SEP = 1, LEJOS = 2, VENTANA = Math.round(4 / dt);
  for (let a = 0; a < series.length; a++) {
    for (let b = a + 1; b < series.length; b++) {
      const A = series[a] as SerieLlama, B = series[b] as SerieLlama;
      const dif = (i: number): number => (A.x[i] as number) - (B.x[i] as number);
      let previo = 0;
      for (let i = 1; i < N; i++) {
        if (!A.corre[i] || !B.corre[i]) {
          previo = 0;
          continue;
        }
        const signo = Math.sign(dif(i));
        if (previo !== 0 && signo !== 0 && signo !== previo) {
          // ¿Venían separadas y quedan separadas?
          let antes = 0, despues = 0, ultimaLejos = -1;
          for (let j = i - 1; j >= Math.max(0, i - VENTANA) && A.corre[j] && B.corre[j]; j--) {
            const m = Math.abs(dif(j));
            antes = Math.max(antes, m);
            if (ultimaLejos < 0 && m >= LEJOS) ultimaLejos = j;
          }
          for (let j = i + 1; j <= Math.min(N - 1, i + VENTANA) && A.corre[j] && B.corre[j]; j++) despues = Math.max(despues, Math.abs(dif(j)));
          if (antes >= SEP && despues >= SEP) {
            const aviso = ultimaLejos >= 0 ? (i - ultimaLejos) * dt : (i - Math.max(0, i - VENTANA)) * dt;
            let p = i - 1;
            while (p > 0 && A.corre[p - 1] && B.corre[p - 1] && Math.abs(dif(p - 1)) < 0.5) p--;
            let q = i;
            while (q < N - 1 && A.corre[q + 1] && B.corre[q + 1] && Math.abs(dif(q + 1)) < 0.5) q++;
            const pasa = previo < 0 ? A.id : B.id;
            out.pases.push({ t: t0 + i * dt, pasa, pasada: pasa === A.id ? B.id : A.id, aviso, cruce: (q - p) * dt });
          }
        }
        previo = signo || previo;
      }
    }
  }
  out.pases.sort((x, y) => x.t - y.t);
  return out;
}

/* ------------------------------------------------------------------------ la recta con tacto */

/** Lo que separa a un puesto del siguiente cuando entran a la recta, en cuerpos (el mismo con que se ordena el grupo). */
export const ENTRE_PUESTOS = 0.45;

/** Una causa de la recta, medida en segundos desde que se abre (`aviso` y `desde` ya incluyen lo que se ve venir). */
export interface CausaRecta {
  tipo: TipoCausa;
  /** Los carriles que la viven. */
  carriles: number[];
  aviso: number;
  desde: number;
  hasta: number;
}

/** Lo que la recta con tacto deja a la vista. */
export interface InfoMarcha {
  /** Cuánto dura la recta, en segundos. */
  duracion: number;
  /** El momento de cada compuerta (segundos desde que se abre) y el puesto de la ganadora en ella (1 es la primera). */
  compuertas: { t: number; puesto: number }[];
  /** Los motivos a la vista de lo que pasa de 1 cuerpo por segundo: el pique de la ganadora y los momentos de la historia (tropiezo, planta...). */
  causas: CausaRecta[];
  /** El lugar de `k` (cuerpos desde la línea) `tau` segundos después de abrirse la recta; con `tau` negativo, el lugar de entrada. */
  enExtendido(k: number, tau: number): number;
}

/** Una subida y bajada suave de 0 a 1 y otra vez a 0 (de quinto grado): sube `sube` s, sostiene y baja `baja` s, empezando `antes` s antes de `s = 0`. */
export const pulso = (s: number, antes: number, sube: number, sostiene: number, baja: number): number => suave5((s + antes) / sube) * (1 - suave5((s + antes - sube - sostiene) / baja));

const suave5 = (v: number): number => {
  const x = Math.max(0, Math.min(1, v));
  return x * x * x * (x * (6 * x - 15) + 10);
};

/** La interpolación de Hermite monótona (Fritsch y Carlson): continua en la velocidad y sin pasarse de los puntos. */
function hermite(ts: readonly number[], ys: readonly number[], pendienteFinal = 0): (t: number) => number {
  const n = ts.length;
  const h: number[] = [], delta: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    h.push((ts[i + 1] as number) - (ts[i] as number));
    delta.push(((ys[i + 1] as number) - (ys[i] as number)) / (h[i] as number));
  }
  // Pendientes en los puntos: cero al salir (las llamas salen quietas respecto del grupo), `pendienteFinal` al llegar (la ganadora llega con un último
  // envión: pasa tarde y no lleva la punta de más) y, adentro, la media armónica.
  const d: number[] = new Array<number>(n).fill(0);
  d[n - 1] = pendienteFinal;
  for (let i = 1; i < n - 1; i++) {
    const a = delta[i - 1] as number, b = delta[i] as number;
    if (a * b > 0) {
      const w1 = 2 * (h[i] as number) + (h[i - 1] as number), w2 = (h[i] as number) + 2 * (h[i - 1] as number);
      d[i] = (w1 + w2) / (w1 / a + w2 / b);
    }
  }
  return (t: number): number => {
    if (t <= (ts[0] as number)) return ys[0] as number;
    if (t >= (ts[n - 1] as number)) return ys[n - 1] as number;
    let i = 0;
    while (i < n - 2 && t > (ts[i + 1] as number)) i++;
    const x = (t - (ts[i] as number)) / (h[i] as number);
    const x2 = x * x, x3 = x2 * x;
    return (2 * x3 - 3 * x2 + 1) * (ys[i] as number) + (x3 - 2 * x2 + x) * (h[i] as number) * (d[i] as number) + (-2 * x3 + 3 * x2) * (ys[i + 1] as number) + (x3 - x2) * (h[i] as number) * (d[i + 1] as number);
  };
}

/** Lo que se le pide a la curva de base (el resto del tope queda para los obstáculos y los momentos de la historia), y cuántos arreglos de las demás se prueban. */
const ACEL_BASE = 0.55;
const VEL_BASE = 0.7;
const INTENTOS = 160;
/** Hasta cuántos intentos sigue buscando el ideal antes de conformarse con uno bueno. */
const INTENTOS_BUENOS = 32;
/**
 * A tres segundos de la meta (el 90 % de la recta) la cámara de la meta corta de frente y encuadra el grupo de punta: la ganadora tiene que estar
 * entre las cuatro de adelante. Quien viene de atrás sube hasta `SUBIDA_MAX` puestos entre el 75 y el 90 % (más es una aceleración que la marcha no
 * permite). El puesto se sortea, parejo entre los que alcanza, con un poco más de peso a la primera cuando alguien no puede llegar a ella, para que
 * entre las dos de adelante la primera gane tantas veces como la segunda (`audit-delatores`, `recta-90`).
 */
export const PUESTOS_AL_90 = 4;
export const SUBIDA_MAX = 5;
const pesosAl90Memo = new Map<number, number[][]>();
/**
 * `pesos[r - 1][k - 1]`: la probabilidad de ir `k`-ésima a tres segundos de la meta habiendo ido `r`-ésima al 75 %, con `L` carriles. Reparte la ganadora
 * entre las cuatro de adelante casi parejo (un poco más a la primera: un instante después, al 90 %, la que iba primera ya bajó un puesto más seguido de
 * lo que sube la segunda, y el auditor de delatores la mide ahí) respetando lo que cada una alcanza a subir (`SUBIDA_MAX`): se ajustan las filas y
 * las columnas de la tabla hasta que cada puesto reciba lo que le toca.
 */
export function pesosAl90(L: number): number[][] {
  const hecho = pesosAl90Memo.get(L);
  if (hecho) return hecho;
  const topes = Math.min(PUESTOS_AL_90, L);
  const objetivo: number[] = Array.from({ length: topes }, (_, k) => (k === 0 ? 1.1 : k === 1 ? 1 : 0.99));
  const suma = objetivo.reduce((a, b) => a + b, 0);
  for (let k = 0; k < topes; k++) objetivo[k] = (objetivo[k] as number) / suma;
  const m: number[][] = Array.from({ length: L }, (_, i) => Array.from({ length: topes }, (_, k) => (k + 1 >= Math.max(1, i + 1 - SUBIDA_MAX) ? 1 : 0)));
  for (let it = 0; it < 400; it++) {
    for (let k = 0; k < topes; k++) {
      const col = m.reduce((a, f) => a + (f[k] as number), 0);
      if (col > 0) for (const f of m) f[k] = ((f[k] as number) * (objetivo[k] as number) * L) / col;
    }
    for (const f of m) {
      const fila = f.reduce((a, b) => a + b, 0);
      for (let k = 0; k < topes; k++) f[k] = (f[k] as number) / fila;
    }
  }
  pesosAl90Memo.set(L, m);
  return m;
}
/** El puesto al 90 % de quien iba `r75`-ésima al 75 %, con el número `u` en [0, 1). */
export function puestoAl90(L: number, r75: number, u: number): number {
  const fila = pesosAl90(L)[Math.min(L, Math.max(1, r75)) - 1] as number[];
  let acum = 0;
  for (let k = 0; k < fila.length; k++) {
    acum += fila[k] as number;
    if (u < acum) return k + 1;
  }
  return fila.length;
}

/**
 * Le da tacto a la recta de un plan: reemplaza el lugar de cada carril por una curva con la velocidad y la aceleración acotadas, armada así
 * (todo puro, sin mirar quién gana más que para cumplir los puestos que el plan sorteó):
 *
 * - **Compuertas**: siete instantes de la recta (la entrada, el 25, el 50, el 75 y el 90 %, un segundo y medio antes de la meta y la
 *   llegada). En cada una hay un orden y las llamas están a unas décimas de cuerpo una de otra: el pelotón se aprieta de 0,55 cuerpos entre
 *   puestos a la entrada a 0,2 antes de la meta, y así pasar de un puesto al otro cuesta décimas de cuerpo.
 * - **Los puestos de la ganadora** (`base.puestos`: al 7, 25, 50 y 75 %, sorteados parejos por el plan) se cumplen en esas compuertas.
 *   Un segundo y medio antes de la meta va primera, segunda o tercera, un tercio de las veces cada una: la que va primera ahí gana un tercio
 *   de las veces. Las demás se acomodan alrededor de ella con cambios chicos y sin mirar quién es.
 * - **Entre compuertas**, cada llama sigue una curva de Hermite que no frena en cada una (las otras se adelantan o se atrasan unos
 *   décimos de segundo, cada una a su hora). La ganadora cumple sus puestos en el instante exacto.
 * - **Los momentos de la historia** (tropiezo, planta, pique, escupida) son pérdidas o ganancias suaves de unos décimos de cuerpo,
 *   anunciadas, con su rastro: causas en el guion.
 * - **La llegada**: la ganadora cruza primera, con el margen de siempre (entre 0,1 y 0,5 cuerpos), y las demás detrás.
 *
 * El plan que devuelve tiene la misma forma: `pos(k, q)` en fracción de la recta. Sin `Math.random`.
 */
export function conMarcha(base: PlanFinal, op: { entrada: readonly number[]; rng: () => number }): PlanFinal {
  const L = base.lanes.length;
  if (L < 2) return base;
  const rng = op.rng;
  const foto = base.foto;
  const T = segundosDeQ(1, foto);
  const w = base.story.winner;
  const tq = (q: number): number => segundosDeQ(q, foto);
  const entre = (a: number, b: number): number => a + (b - a) * rng();

  /* ------------------------------------------------------------------ compuertas */
  // La quinta compuerta es el corte de la cámara de la meta, exactamente a tres segundos de la meta (el 89,5 % de la recta): ahí la ganadora ya es una de las cuatro de adelante.
  const t25 = tq(0.25), t50 = tq(0.5), t75 = tq(0.75), t90 = Math.min(tq(0.9), T - 3);
  const tiempos = [0, t25, t50, t75, t90, T - 1.5, T];
  const esp = [ENTRE_PUESTOS, 0.3, 0.25, 0.22, 0.2, 0.18, 0];
  const G = tiempos.length;
  const rangoEntrada = new Map<number, number>();
  op.entrada.forEach((k, r) => rangoEntrada.set(k, r));
  // Los puestos de la ganadora (1 es la primera): los que sorteó el plan y, donde el plan no sortea, lo que hace falta para el final.
  const puestoPlan = (q: number): number | undefined => base.puestos.find((p) => Math.abs(p.q - q) < 1e-6)?.r;
  const sorteo = (a: number, b: number): number => a + Math.floor(rng() * (b - a + 1));
  const rw: number[] = new Array<number>(G).fill(1);
  rw[0] = (rangoEntrada.get(w) ?? 0) + 1;
  rw[1] = puestoPlan(0.25) ?? sorteo(1, L);
  rw[2] = puestoPlan(0.5) ?? sorteo(1, L);
  rw[3] = puestoPlan(0.75) ?? sorteo(1, L);
  // Un segundo y medio antes de la meta el pelotón de punta son tres a menos de medio cuerpo y la ganadora es una de las tres, parejo: la que va
  // primera no gana más veces que cualquiera de las otras dos (un tercio, contra el 40 % que tolera la dirección) y las demás la pasan en el último envión.
  const u12 = rng();
  rw[5] = L >= 3 ? (u12 < 1 / 3 ? 1 : u12 < 2 / 3 ? 2 : 3) : L === 2 ? (u12 < 0.3 ? 1 : 2) : 1;
  rw[6] = 1;
  // Al 90 % (a tres segundos de la meta) la ganadora es una de las cuatro de adelante, con el mismo peso para las dos primeras (ver `pesosAl90`);
  // al segundo y medio, una de las tres.
  rw[4] = puestoAl90(L, rw[3] as number, rng());
  const fija90 = true;
  const compuertas = tiempos.map((t, c) => ({ t, puesto: rw[c] as number }));

  /* -------------------------------------------------- los momentos de la historia (efectos suaves) */
  const causas: CausaRecta[] = [];
  const efectos: { k: number; t: number; A: number; antes: number; sube: number; sostiene: number; baja: number }[] = [];
  for (const b of base.story.beats) {
    const tb = tq(b.at);
    const pone = (k: number, A: number, antes: number, sube: number, sostiene: number, baja: number): void => {
      efectos.push({ k, t: tb, A, antes, sube, sostiene, baja });
      causas.push({ tipo: b.kind === "tropiezo" ? "tropiezo" : b.kind === "plantada" ? "plantada" : b.kind === "escupida" ? "escupida" : "pique", carriles: [k], aviso: tb - antes - 1, desde: tb - antes, hasta: tb - antes + sube + sostiene + baja + RASTRO });
    };
    if (b.kind === "tropiezo") pone(b.actor, 0.5, 0.3, 2.6, 0.2, 2.6);
    else if (b.kind === "plantada") pone(b.actor, 0.55, 0.3, 3, 0.2, 3.2);
    else if (b.kind === "pique") pone(b.actor, -0.6, 0.3, 3.2, 0.5, 3.2);
    else if (b.kind === "escupida" && b.target !== undefined) {
      pone(b.actor, 0.2, 0.3, 2, 0, 2);
      pone(b.target, 0.4, 0.3, 2.6, 0.2, 2.6);
    }
  }
  // Se apagan en los últimos tres segundos: la llegada (el margen y el orden) es la que se armó, no la que deja un tropiezo tardío.
  const efectoEn = (k: number, tau: number): number => {
    let v = 0;
    for (const e of efectos) if (e.k === k) v += e.A * pulso(tau - e.t, e.antes, e.sube, e.sostiene, e.baja);
    return -v * (1 - suave5((tau - (T - 3)) / 3));
  };
  // Si hay señuelo se sortea una sola vez, antes de probar arreglos: si no, el arreglo que cumple los topes (que es el que se queda) la descartaría de más.
  const haySenuelo = rng() < 0.85;
  const ocupantes = (s: number[]): number[] => s.map((_, i) => i).sort((a, b) => (s[a] as number) - (s[b] as number));
  const gw = fija90 ? [0, 1, 2, 3, 4, 5, G - 1] : [0, 1, 2, 3, 5, G - 1];
  const N = Math.ceil(T * 60) + 1;
  const dt = T / (N - 1);

  /** Un arreglo de las demás alrededor de la ganadora: sus lugares en cada compuerta, sus curvas y la de la ganadora, tabuladas a 60 por segundo. */
  const armar = (): { serie: Float64Array[]; acel: number; vel: number; fuera: number } => {
    // `slot[c][k]`: el lugar (0 es el primero) de `k` en la compuerta `c`. Las demás conservan su orden y dejan lugar a la ganadora; en cada
    // compuerta se sortean uno o dos cruces entre dos que van juntas, y si la que iba primera sigue primera, la pasa la de atrás.
    const slot: number[][] = [Array.from({ length: L }, (_, k) => rangoEntrada.get(k) ?? k)];
    let senuelo = -1;
    for (let c = 1; c < G; c++) {
      const prev = slot[c - 1] as number[];
      const otras = ocupantes(prev).filter((k) => k !== w);
      // En las compuertas cercanas (tramos de un segundo y medio) los cruces al azar se dejan: cada uno mueve a dos de a un puesto.
      const cruces = c >= 5 ? 0 : rng() < 0.7 ? 1 + (rng() < 0.3 ? 1 : 0) : 0;
      for (let j = 0; j < cruces && otras.length > 1; j++) {
        const i = Math.floor(rng() * (otras.length - 1));
        [otras[i], otras[i + 1]] = [otras[i + 1] as number, otras[i] as number];
      }
      // La señuelo: la última de las demás al 75 % remonta en el último cuarto (dos puestos al 90 %, uno antes de la foto y el resto en la llegada) y llega
      // segunda: la mayor remontada del final no es siempre de la ganadora y quien más sube puede perder en la foto.
      if (c === 4) senuelo = otras.length >= 4 && haySenuelo ? (otras[otras.length - 1] as number) : -1;
      if (senuelo >= 0 && c >= 4) {
        const i0 = otras.indexOf(senuelo);
        const sube = c === 4 ? 2 : c === 5 ? 1 : 6;
        otras.splice(i0, 1);
        otras.splice(Math.max(0, i0 - sube), 0, senuelo);
      }
      const sw = (rw[c] as number) - 1;
      const s = new Array<number>(L).fill(0);
      s[w] = sw;
      let it = 0;
      for (let lugar = 0; lugar < L; lugar++) if (lugar !== sw) s[otras[it++] as number] = lugar;
      // Cambio de punta: si manda la misma que antes y no es la ganadora, la pasa la que sigue.
      if (c >= 2 && c < G - 1) {
        const ant = ocupantes(prev)[0] as number;
        const cur = ocupantes(s);
        if (cur[0] === ant && cur[0] !== w && cur[1] !== w) {
          const a = cur[0] as number, b = cur[1] as number;
          [s[a], s[b]] = [s[b] as number, s[a] as number];
        }
      }
      slot.push(s);
    }
    // La llegada: la ganadora en 0; la segunda a entre 0,1 y 0,3 cuerpos; las demás detrás, cada una a entre 0,12 y 0,25 de la anterior.
    const fin = new Array<number>(L).fill(0);
    let x = 0;
    ocupantes(slot[G - 1] as number[]).forEach((k, i) => {
      if (i > 0) x -= i === 1 ? entre(0.1, 0.3) : entre(0.12, 0.25);
      fin[k] = x;
    });
    const segunda = ocupantes(slot[G - 1] as number[])[1] as number;
    const lugar = (c: number, k: number): number => (c === G - 1 ? (fin[k] as number) : -(esp[c] as number) * ((slot[c] as number[])[k] as number));
    // Las demás, cada una con sus compuertas corridas unos décimos de segundo (así no frenan todas a la vez); la ganadora cumple sus puestos
    // en el instante exacto, entre las que de verdad están a su lado (con los efectos puestos).
    const curvas: ((t: number) => number)[] = new Array(L);
    for (let k = 0; k < L; k++) {
      if (k === w) continue;
      // Cada compuerta se corre como mucho un tercio del tramo vecino más corto (nunca más de 0,6 s): así el orden no se invierte.
      const ts = tiempos.map((t, c) => (c === 0 || c === G - 1 ? t : t + entre(-1, 1) * Math.min(0.6, Math.min(t - (tiempos[c - 1] as number), (tiempos[c + 1] as number) - t) / 3)));
      // La segunda se frena al final (la ganadora la pasa con su envión): si iba adelante, aguanta la punta hasta cerca de la línea.
      const ys2 = tiempos.map((_, c) => lugar(c, k));
      const sube2 = (ys2[G - 2] as number) - (ys2[G - 1] as number);
      const frena = k === segunda && sube2 > 0 ? -Math.min(0.5, (2.2 * sube2) / (T - (tiempos[G - 2] as number))) : 0;
      curvas[k] = hermite(ts, ys2, frena);
    }
    const otraEn = (k: number, tau: number): number => (curvas[k] as (t: number) => number)(tau) + efectoEn(k, tau);
    const ys: number[] = [];
    for (let c = 0; c < G; c++) {
      const t = tiempos[c] as number;
      if (c === 0) ys.push(lugar(0, w));
      else if ((c === 4 && !fija90) || c === G - 1) ys.push(0);
      else {
        const xs = Array.from({ length: L }, (_, k) => k).filter((k) => k !== w).map((k) => otraEn(k, t)).sort((a, b) => b - a);
        const r = rw[c] as number;
        const arriba = r - 2 >= 0 ? (xs[r - 2] as number) : (xs[0] as number) + 0.6 * (esp[c] as number);
        const abajo = r - 1 < xs.length ? (xs[r - 1] as number) : (xs[xs.length - 1] as number) - 0.6 * (esp[c] as number);
        // Dentro del hueco entre las dos que la rodean (no siempre en el medio): cada arreglo que se prueba la pone un poco distinto.
        const f = entre(0.3, 0.7);
        const objetivo = r === 1 ? (xs[0] as number) + 0.6 * (esp[c] as number) : r - 1 >= xs.length ? abajo : arriba * (1 - f) + abajo * f;
        ys.push(objetivo - efectoEn(w, t));
      }
    }
    // El último envión: la ganadora llega a la línea con velocidad (hasta medio cuerpo por segundo más que el grupo) y no frenada: la que iba
    // segunda o tercera la pasa pegada a la meta, y la punta que lleva es la del final y no la de segundo y medio.
    const yPrev = ys[gw[gw.length - 2] as number] as number, hPrev = T - (tiempos[gw[gw.length - 2] as number] as number);
    const envion = Math.min(0.5, Math.max(0, (2.2 * (0 - yPrev)) / hPrev));
    curvas[w] = hermite(gw.map((c) => tiempos[c] as number), gw.map((c) => ys[c] as number), envion);
    const serie = Array.from({ length: L }, (_, k) => {
      const v = new Float64Array(N);
      for (let i = 0; i < N; i++) v[i] = k === w ? (curvas[w] as (t: number) => number)(i * dt) + efectoEn(w, i * dt) : otraEn(k, i * dt);
      return v;
    });
    let acel = 0, vel = 0;
    for (const v of serie) {
      for (let i = 1; i < N; i++) vel = Math.max(vel, Math.abs((v[i] as number) - (v[i - 1] as number)) / dt);
      for (let i = 1; i < N - 1; i++) acel = Math.max(acel, Math.abs((v[i + 1] as number) - 2 * (v[i] as number) + (v[i - 1] as number)) / (dt * dt));
    }
    // A tres segundos de la meta la ganadora tiene que ser una de las cuatro de adelante (la cámara de la meta corta ahí): si el arreglo la deja afuera
    // (dos de las otras casi tocándose a esa hora le quitan el margen), no sirve.
    const iT3 = Math.round((T - 3) / dt);
    const wx = (serie[w] as Float64Array)[iT3] as number;
    const fuera = serie.filter((v, k) => k !== w && (v[iT3] as number) > wx).length + 1 > Math.min(PUESTOS_AL_90, L) ? 1 : 0;
    return { serie, acel, vel, fuera };
  };
  // Se prueban hasta `INTENTOS` arreglos de las demás (cada uno con el azar siguiente) y se queda el primero que cumple los topes de la base;
  // si ninguno cumple, el que menos se pasa. Como el azar es sembrado, la misma ronda arma siempre la misma recta.
  let mejor: { serie: Float64Array[]; acel: number; vel: number; fuera: number } | null = null;
  const peso = (a: { acel: number; vel: number; fuera: number }): number => a.fuera * 1e3 + Math.max(a.acel / ACEL_BASE, a.vel / VEL_BASE);
  for (let i = 0; i < INTENTOS; i++) {
    const a = armar();
    if (!mejor || peso(a) < peso(mejor)) mejor = a;
    if (a.acel <= ACEL_BASE && a.vel <= VEL_BASE && !a.fuera) break;
    // Pasados los primeros intentos se conforma con uno que deje margen para los obstáculos y la unión con el grupo; sigue buscando solo si está lejos.
    if (i >= INTENTOS_BUENOS && !a.fuera && a.acel <= 0.7 && a.vel <= 0.8) break;
  }
  const serie = (mejor as { serie: Float64Array[] }).serie;
  // Los piques grandes de la ganadora (tres puestos o más entre dos compuertas) son una causa a la vista: se anuncian y dejan rastro.
  for (let j = 1; j < gw.length; j++) {
    const c0 = gw[j - 1] as number, c1 = gw[j] as number;
    if (Math.abs((rw[c1] as number) - (rw[c0] as number)) >= 3) causas.push({ tipo: "pique", carriles: [w], aviso: (tiempos[c0] as number) - AVISO, desde: tiempos[c0] as number, hasta: (tiempos[c1] as number) + RASTRO });
  }
  // El lugar a `tau` segundos de abrirse la recta: Catmull-Rom sobre lo tabulado; antes de abrirse (hasta 2 s) sigue la recta que traía.
  const en = (k: number, tau: number): number => {
    const sk = serie[k] as Float64Array;
    if (tau < 0) return (sk[0] as number) + (((sk[1] as number) - (sk[0] as number)) / dt) * Math.max(-2, tau);
    const x = Math.min(N - 1, tau / dt);
    const i = Math.min(N - 2, Math.floor(x));
    const f = x - i;
    // En los extremos se sigue la pendiente (no se repite el último punto): la ganadora llega con velocidad.
    const p1 = sk[i] as number, p2 = sk[i + 1] as number;
    const p0 = i > 0 ? (sk[i - 1] as number) : 2 * p1 - p2, p3 = i + 2 < N ? (sk[i + 2] as number) : 2 * p2 - p1;
    return p1 + 0.5 * f * (p2 - p0 + f * (2 * p0 - 5 * p1 + 4 * p2 - p3 + f * (3 * (p1 - p2) + p3 - p0)));
  };
  const pos = (k: number, q: number): number => q + en(k, tq(q)) * CUERPO + k * 1e-9;
  const puestoEn = (q: number): number => {
    const xs = base.lanes.map((_, j) => pos(j, q));
    return 1 + xs.filter((v, j) => j !== w && v > (xs[w] as number)).length;
  };
  const info: InfoMarcha = { duracion: T, compuertas, causas, enExtendido: en };
  return { ...base, pos, marcha: info, puestos: base.puestos.map(({ q }) => ({ q, r: puestoEn(q) })) };
}
