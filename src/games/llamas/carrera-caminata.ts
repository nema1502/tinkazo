import { TAM3D, ZC } from "./carrera-3d-mapa";
import { LLAMA_COLA, LLAMA_HOCICO, formaDe, hudDe, type Forma, type Pantalla } from "./carrera-forma";
import { LLEGADA_TARDE, type Tanda } from "./carrera-tandas";

export { LLEGADA_TARDE };

/**
 * La caminata de las que pasan: de su lugar en la tanda, por el portón, a su lugar en el corral. Pura (sin Pixi ni DOM) para que la
 * escena la dibuje y la prueba la mida con las mismas cuentas.
 *
 * Entran al corral trotando: un camino suave (sin esquinas) y una velocidad que sube y baja de a poco hasta un tope de un cuerpo y medio por
 * segundo, como un pique del grupo (`carrera-marcha.ts`), con su causa a la vista: la cabeza baja, el polvo y la línea del relator que dice
 * quién pasa. Antes pasaban del portón al corral en siete segundos (de 3 a 9 cuerpos por segundo, todas juntas al final). A ese paso la última
 * tanda necesita unos segundos para llegar: `ENTRE_FINAL` (en `carrera-tandas.ts`) se los da, y las que no alcanzan a entrar antes de la
 * salida terminan de entrar en los primeros segundos del grupo (`LLEGADA_TARDE`), como quien llega corriendo a la línea de largada.
 */

/**
 * La caminata, en cuerpos por segundo y por segundo al cuadrado. Es un trote con causa a la vista, así que el tope es el de un pique del grupo
 * (`TOPES.pique`, 1,5), con un poco de margen; la aceleración, la de siempre (1,2). A diferencia del pique del grupo, que dura 2,5 s, el trote
 * dura lo que el camino (de 7 a 13 s): por eso es una causa aparte.
 */
export const CAMINATA = { velocidad: 1.45, aceleracion: 1.1 };
/**
 * Lo que puede valer la aceleración hacia el costado en una curva, en cuerpos por segundo cada segundo. Con el perfil por curva
 * (`perfilPorCurva`) frena solo en la curva y no en todo el camino, y la de costado se suma a la de adelante sin pasar de `ACEL_TOTAL`.
 */
export const ACEL_LATERAL = 1.0;
/**
 * Lo que puede valer la aceleración entera de un camino con el perfil por curva (la de adelante y la de costado juntas, como vector), en
 * cuerpos por segundo cada segundo: el tope de la marcha (M3), sin la tolerancia de la medida. En una curva, la de adelante es lo que queda.
 */
export const ACEL_TOTAL = 1.2;
/**
 * La del camino de siempre (el portón a media altura), que hace todo el camino al tope de su curva más cerrada con 0,5 de aceleración de
 * costado: la que no toca a nadie por ahí trota como siempre.
 */
const ACEL_LATERAL_SIEMPRE = 0.5;
/** Lo que se mide, con el 6 % de tolerancia de la marcha. */
export const TOPES_TROTE = { velocidad: 1.5, aceleracion: 1.2 } as const;

export interface Punto {
  x: number;
  y: number;
}

/** Un camino por unos puntos, suave y siempre hacia adelante (a la derecha): con la tangente horizontal en cada punto. */
export interface Camino {
  /** Lo que mide, en píxeles. */
  largo: number;
  /** Lo más cerrada que es la curva, en 1 / píxel. */
  curvatura: number;
  /** El punto a `s` píxeles del comienzo. */
  en(s: number): Punto;
}

/** Un camino con lo que se avanzó y la curva en cada una de sus muestras: lo que mira el perfil por curva. */
export interface CaminoTrazado extends Camino {
  /** Cuánto se avanzó hasta cada muestra, en píxeles. */
  readonly avances: readonly number[];
  /** La curva en cada muestra, en 1 / píxel: la más cerrada del camino que se recorre en los dos tramos que la tocan. */
  readonly curvas: readonly number[];
}

const MUESTRAS = 48;

export function trazar(puntos: readonly Punto[]): CaminoTrazado {
  const xs: number[] = [];
  const ys: number[] = [];
  const ss: number[] = [];
  let acum = 0;
  // La dirección en cada punto: la de la cuerda entre sus vecinos (la del primer y último tramo en los extremos). Así el camino va derecho en diagonal cuando
  // la fila de salida y la de llegada están lejos una de otra, en vez de torcerse en una S apretada (una curva cerrada a más de un cuerpo por segundo es
  // una aceleración que la marcha no permite).
  const dir = puntos.map((_, i) => {
    const a = puntos[Math.max(0, i - 1)] as Punto, b = puntos[Math.min(puntos.length - 1, i + 1)] as Punto;
    const l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    return { x: (b.x - a.x) / l, y: (b.y - a.y) / l };
  });
  for (let i = 0; i + 1 < puntos.length; i++) {
    const a = puntos[i] as Punto, b = puntos[i + 1] as Punto;
    const da = dir[i] as Punto, db = dir[i + 1] as Punto;
    const cuerda = Math.hypot(b.x - a.x, b.y - a.y);
    for (let k = i === 0 ? 0 : 1; k <= MUESTRAS; k++) {
      const u = k / MUESTRAS;
      // Hermite cúbico con las dos tangentes, de largo igual a la cuerda.
      const h00 = 2 * u ** 3 - 3 * u ** 2 + 1, h10 = u ** 3 - 2 * u ** 2 + u, h01 = -2 * u ** 3 + 3 * u ** 2, h11 = u ** 3 - u ** 2;
      const x = h00 * a.x + h10 * cuerda * da.x + h01 * b.x + h11 * cuerda * db.x;
      const y = h00 * a.y + h10 * cuerda * da.y + h01 * b.y + h11 * cuerda * db.y;
      if (xs.length) acum += Math.hypot(x - (xs[xs.length - 1] as number), y - (ys[ys.length - 1] as number));
      xs.push(x);
      ys.push(y);
      ss.push(acum);
    }
  }
  // La curva más cerrada del camino, en 1 / píxel: el giro entre dos tramos de muestras sobre lo que se avanza. Es la que usa el camino de
  // siempre (`deSiempre`).
  let curvatura = 0;
  for (let k = 2; k < xs.length; k++) {
    const d1 = (ss[k - 1] as number) - (ss[k - 2] as number), d2 = (ss[k] as number) - (ss[k - 1] as number);
    if (d1 < 1e-6 || d2 < 1e-6) continue;
    curvatura = Math.max(curvatura, Math.abs(giro(xs[k - 2] as number, ys[k - 2] as number, xs[k - 1] as number, ys[k - 1] as number, xs[k] as number, ys[k] as number)) / ((d1 + d2) / 2));
  }
  const largo = acum;
  const en = (s: number): Punto => {
    if (s <= 0) return { x: xs[0] as number, y: ys[0] as number };
    if (s >= largo) return { x: xs[xs.length - 1] as number, y: ys[ys.length - 1] as number };
    let lo = 0, hi = ss.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if ((ss[mid] as number) <= s) lo = mid;
      else hi = mid;
    }
    const span = (ss[hi] as number) - (ss[lo] as number);
    const f = span > 0 ? (s - (ss[lo] as number)) / span : 0;
    // Entre dos muestras, un Hermite cúbico con las tangentes de las vecinas: la polilínea tenía una esquina en cada muestra y, a 60 cuadros por
    // segundo, cada esquina era un pico de aceleración de la llama.
    const a = Math.max(0, lo - 1), b = Math.min(ss.length - 1, hi + 1);
    const tg = (i0: number, i1: number, v: number[]): number => ((ss[i1] as number) - (ss[i0] as number) > 0 ? ((v[i1] as number) - (v[i0] as number)) / ((ss[i1] as number) - (ss[i0] as number)) : 0);
    const herm = (v: number[]): number => {
      const f2 = f * f, f3 = f2 * f;
      return (2 * f3 - 3 * f2 + 1) * (v[lo] as number) + (f3 - 2 * f2 + f) * span * tg(a, hi, v) + (-2 * f3 + 3 * f2) * (v[hi] as number) + (f3 - f2) * span * tg(lo, b, v);
    };
    return { x: herm(xs), y: herm(ys) };
  };
  // La curva de cada muestra, medida sobre el camino que se recorre (el Hermite entre muestras, `en`), en `FINO` puntos por tramo: entre dos
  // muestras la curva puede ser más cerrada que el giro de la polilínea, y es la que pide la aceleración de costado en el perfil por curva.
  const curvas = new Array<number>(xs.length).fill(0);
  const FINO = 6;
  for (let k = 1; k < xs.length; k++) {
    const s0 = ss[k - 1] as number, s1 = ss[k] as number;
    if (s1 - s0 < 1e-6) continue;
    const h = (s1 - s0) / FINO;
    let c = 0;
    for (let j = 0; j <= FINO; j++) {
      const p0 = en(s0 + (j - 1) * h), p1 = en(s0 + j * h), p2 = en(s0 + (j + 1) * h);
      const d1 = Math.hypot(p1.x - p0.x, p1.y - p0.y), d2 = Math.hypot(p2.x - p1.x, p2.y - p1.y);
      if (d1 < 1e-9 || d2 < 1e-9) continue;
      c = Math.max(c, Math.abs(giro(p0.x, p0.y, p1.x, p1.y, p2.x, p2.y)) / ((d1 + d2) / 2));
    }
    curvas[k - 1] = Math.max(curvas[k - 1] as number, c);
    curvas[k] = Math.max(curvas[k] as number, c);
  }
  return { largo, curvatura, avances: ss, curvas, en };
}

/** El giro entre el tramo de (x0, y0) a (x1, y1) y el de (x1, y1) a (x2, y2), en radianes, de -π a π. */
function giro(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number): number {
  let dth = Math.atan2(y2 - y1, x2 - x1) - Math.atan2(y1 - y0, x1 - x0);
  if (dth > Math.PI) dth -= 2 * Math.PI;
  if (dth < -Math.PI) dth += 2 * Math.PI;
  return dth;
}

export function perfil(largo: number, v = CAMINATA.velocidad, a = CAMINATA.aceleracion): { duracion: number; recorrido(tau: number): number } {
  const ta = v / a;
  const da = 0.5 * a * ta * ta;
  if (largo >= 2 * da) {
    const tc = (largo - 2 * da) / v;
    const duracion = 2 * ta + tc;
    return {
      duracion,
      recorrido(tau) {
        if (tau <= 0) return 0;
        if (tau >= duracion) return largo;
        if (tau < ta) return 0.5 * a * tau * tau;
        if (tau < ta + tc) return da + v * (tau - ta);
        const r = duracion - tau;
        return largo - 0.5 * a * r * r;
      },
    };
  }
  const tm = Math.sqrt(largo / a);
  return {
    duracion: 2 * tm,
    recorrido(tau) {
      if (tau <= 0) return 0;
      if (tau >= 2 * tm) return largo;
      if (tau < tm) return 0.5 * a * tau * tau;
      const r = 2 * tm - tau;
      return largo - 0.5 * a * r * r;
    },
  };
}

/** Un perfil de velocidad: cuánto tarda y qué lleva recorrido, en cuerpos, a los `tau` segundos. */
export interface Perfil {
  duracion: number;
  recorrido(tau: number): number;
}

/**
 * El perfil de un camino con el tope de la curva en cada punto: en una curva cerrada baja lo que haga falta para que la aceleración hacia el
 * costado (la velocidad al cuadrado por la curva) no pase de `lateral`, y en lo derecho va al tope. Antes el tope de la curva más cerrada
 * valía para todo el camino: un camino con una sola curva cerrada se hacía entero despacio, y para llegar a tiempo había que apurarlo todo.
 * Sube y baja la velocidad con la aceleración `a` (de cero al salir y a cero al llegar), así que no hay saltos de velocidad, y en una curva
 * la de adelante es solo lo que deja la de costado para que las dos juntas no pasen de `total`.
 */
export function perfilPorCurva(camino: CaminoTrazado, cuerpo: number, v = CAMINATA.velocidad, a = CAMINATA.aceleracion, lateral = ACEL_LATERAL, total = ACEL_TOTAL): Perfil {
  const n = camino.avances.length;
  const s = camino.avances.map((x) => x / cuerpo);
  // El giro se mide entre dos tramos: cada muestra mira también la curva de sus vecinas.
  const kb = camino.curvas.map((k) => k * cuerpo);
  const kv = kb.map((_, i) => Math.max(kb[Math.max(0, i - 1)] as number, kb[i] as number, kb[Math.min(n - 1, i + 1)] as number));
  const vm = kv.map((k) => (k > 0 ? Math.min(v, Math.sqrt(lateral / k)) : v));
  /**
   * La velocidad que alcanza en un tramo de `ds` cuerpos arrancando a `v0`, con la aceleración de adelante que deja la de costado (la curva
   * del tramo, `k`, con la velocidad más alta de las dos puntas, que es la que más pide): las dos juntas no pasan de `total`.
   */
  const siguiente = (v0: number, ds: number, k: number): number => {
    const conTope = (v1: number): number => Math.min(a, Math.sqrt(Math.max(0, total * total - (v1 * v1 * k) ** 2)));
    const v1 = Math.sqrt(v0 * v0 + 2 * conTope(v0) * ds);
    return Math.sqrt(v0 * v0 + 2 * conTope(v1) * ds);
  };
  const vel = new Array<number>(n).fill(0);
  for (let i = 1; i < n; i++) vel[i] = Math.min(vm[i] as number, siguiente(vel[i - 1] as number, (s[i] as number) - (s[i - 1] as number), Math.max(kv[i - 1] as number, kv[i] as number)));
  vel[n - 1] = 0;
  for (let i = n - 2; i >= 0; i--) vel[i] = Math.min(vel[i] as number, siguiente(vel[i + 1] as number, (s[i + 1] as number) - (s[i] as number), Math.max(kv[i] as number, kv[i + 1] as number)));
  // La hora de cada muestra: entre dos, la aceleración es pareja.
  const hora = new Array<number>(n).fill(0);
  for (let i = 1; i < n; i++) {
    const suma = (vel[i - 1] as number) + (vel[i] as number);
    hora[i] = (hora[i - 1] as number) + (suma > 1e-12 ? (2 * ((s[i] as number) - (s[i - 1] as number))) / suma : 0);
  }
  const duracion = hora[n - 1] as number;
  const largo = s[n - 1] as number;
  return {
    duracion,
    recorrido(tau) {
      if (tau <= 0) return 0;
      if (tau >= duracion) return largo;
      let lo = 0, hi = n - 1;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if ((hora[mid] as number) <= tau) lo = mid;
        else hi = mid;
      }
      const dt = (hora[hi] as number) - (hora[lo] as number);
      if (dt <= 0) return s[lo] as number;
      const r = tau - (hora[lo] as number);
      const ac = ((vel[hi] as number) - (vel[lo] as number)) / dt;
      return Math.min(s[hi] as number, (s[lo] as number) + (vel[lo] as number) * r + 0.5 * ac * r * r);
    },
  };
}

/** El mismo perfil `e` veces más rápido: la velocidad por `e` y la aceleración por `e` al cuadrado. */
const apurado = (p: Perfil, e: number): Perfil => (e === 1 ? p : { duracion: p.duracion / e, recorrido: (tau) => p.recorrido(tau * e) });

/**
 * Cuánto se encima con otra, al elegir su camino, para decir que la roza y que la toca, con la huella del 3D, que es la más grande. La del 2D
 * le queda adentro y mide la mitad, así que su encimado es como mucho el doble: tocar en el 3D desde el 5 % deja al 2D por debajo del 10 % del
 * auditor de sólidos.
 */
const ROZA_CAMINO = 0.01;
const TOCA_CAMINO = 0.05;
/**
 * Contra las de la tanda que esperan en su lugar (y las echadas), lo del auditor (10 %), con la huella del 3D y con la del 2D, que es más
 * chica y puede pasar del 10 % cuando la del 3D no pasa: en la tanda están casi pegadas (la del 3D roza a la de adelante en algo menos), así
 * que al salir de su lugar ya la roza, en cualquier camino. Lo que cuenta es no meterse en ella al avanzar.
 */
const TOCA_TANDA = 0.1;
/** Cada cuánto se mira, al elegir el camino. */
const PASO_CAMINO = 1 / 20;
/**
 * Por dónde puede cruzar el portón, en el orden en que se prueba: la fracción del camino entre la media altura (0, de donde sale a donde va,
 * el de siempre) y su lado (1: una subfila más afuera de la suya, así cruza la fila de su compañera lejos de ella), y un poco más afuera.
 */
const LADOS = [0, 0.25, 0.5, 0.75, 1, 1.5, 2];
/**
 * Por dónde sale de su tanda: derecho hacia el portón (un número de `LADOS`) o, para no pasar a través de las de adelante, por el pasillo entre
 * su fila de la tanda y la de arriba o la de abajo, donde no está parada nadie, hasta pasar a la de adelante de todo.
 */
type Ruta = number | "arriba" | "abajo";
/** A qué ritmo puede trotar, del tope a más tranquilo, si cruzando por ningún lado queda libre: la que llega donde otra todavía pasa la deja pasar. */
const RITMOS = [1, 0.85, 0.7, 0.55];
/**
 * Lo más rápido que puede moverse respecto del frente común un camino que no es el de siempre, en cuerpos por segundo: el tope de paso de la
 * marcha (0,03 cuerpos por cuadro, 1,8 por segundo) con margen, porque se mide cada `PASO_CAMINO` s y no en cada cuadro.
 */
const RAPIDEZ_FRENTE = 1.65;
/**
 * Lo más rápido que un carril adelanta o se atrasa respecto del frente en los primeros segundos de la recta, en cuerpos por segundo, con
 * margen: medido en 72 finales de 76 a 200 personas (12 semillas), da 0,84. La caminata no lee la final, así que un camino que no es el de
 * siempre y que todavía trota con la recta abierta cuenta que su carril puede moverse así de rápido en cualquier dirección.
 */
const CARRIL_FRENTE = 0.9;
/** Cuántas veces vuelve a elegir la que todavía toca a alguien, mirando a todas. */
const VUELTAS = 3;
/** El largo de la llama del 3D en cuerpos en el proyector y el escritorio: en el celular parado mide más cuerpos y el trote va en largos. */
const LARGO_ACOSTADA = 1.77;

/** Cuánto se cruzan dos cajas en el piso: el área común sobre la de la más chica. */
interface Caja {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}
const cajaDe = (x: number, y: number, esc: number): Caja => {
  const m = (13 * esc * TAM3D) / ZC;
  return { x0: x - 36 * esc * TAM3D, x1: x + 38 * esc * TAM3D, y0: y - m, y1: y + m };
};
/** La huella del 2D (de la cola al hocico del dibujo, medio fondo de 13): queda adentro de la del 3D y mide la mitad. */
const caja2D = (x: number, y: number, esc: number): Caja => ({ x0: x + LLAMA_COLA * esc, x1: x + LLAMA_HOCICO * esc, y0: y - 13 * esc, y1: y + 13 * esc });
const encimadas = (a: Caja, b: Caja): number => {
  const dx = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
  const dy = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  if (dx <= 0 || dy <= 0) return 0;
  return (dx * dy) / Math.min((a.x1 - a.x0) * (a.y1 - a.y0), (b.x1 - b.x0) * (b.y1 - b.y0));
};

/** Cuánto queda entre el fondo del corral (con el nombre de la última) y el portón, y entre el portón y el grupo de la tanda, en unidades de la pantalla. */
export const HUECO_PORTON = 40;
export const HUECO_ARENA = 50;

export interface UbicacionTandas {
  gateX: number;
  arenaX: number;
  formaArena: Forma;
}

/**
 * Dónde queda el portón y dónde espera la tanda que corre, atrás del corral (`F0` es el frente del corral). El portón está justo atrás de la
 * última del grupo y la tanda justo atrás del portón: lo que caminan las que pasan es lo justo para que se vea que pasan.
 */
export function ubicarTandas(o: { P: Pantalla; forma: Forma; F0: number; tam: number; nombreW: number; hTarjeta?: number }): UbicacionTandas {
  const { P, forma } = o;
  const sobra = forma.arriba ? o.nombreW / 2 + forma.largo / 2 : o.nombreW + forma.largo;
  const gateX = o.F0 - forma.profundidad - sobra - HUECO_PORTON * P.u;
  // En el celular el cartel ocupa la parte de arriba: el grupo de la tanda va debajo, en filas como en el proyector.
  const banda = P.bottom - hudDe(P).bajo;
  // Y va debajo de su tarjeta de nombres (`hTarjeta`, el alto de la más alta): el grupo empieza donde ella termina, nunca antes de la mitad de la banda.
  // `sobreTop` es lo que `formaDe` suma debajo de `top` (la cabecera de proyector con la que se arma el grupo) hasta el primer renglón de llamas.
  const sobreTop = hudDe({ ...P, retrato: false, w: P.w * 0.8, top: 0 }).bajo + 8 * P.u;
  const topArena = Math.max(P.top + 0.54 * banda, hudDe(P).bajo + 8 * P.u + (o.hTarjeta ?? 0) + 12 * P.u - sobreTop);
  const formaArena = formaDe(P.retrato ? { ...P, retrato: false, w: P.w * 0.8, top: topArena } : { ...P, w: P.w * 0.5 }, o.tam, 4, 0);
  return { gateX, arenaX: gateX - HUECO_ARENA * P.u, formaArena };
}

/**
 * La fila del corral de quien sale en el puesto `rango`: las filas intercaladas (arriba, abajo, arriba...) para que la salida sea un pelotón y no
 * una escalera. Dos de la misma fila quedan a `filas` puestos una de otra: los nombres no se pisan.
 */
export function filaDeRango(rango: number, filas: number): number {
  const r = rango % filas;
  const mitad = Math.ceil(filas / 2);
  return r % 2 === 0 ? r / 2 : Math.min(filas - 1, mitad + (r - 1) / 2);
}

export interface GeometriaCaminata {
  /** Cuántos píxeles mide un cuerpo. */
  cuerpo: number;
  /** El grupo de la tanda (los lugares donde esperan) y dónde está. */
  arena: Pick<Forma, "slot" | "yPie" | "esc" | "altoFila" | "filas">;
  arenaX: number;
  /** El portón: la x por donde pasan (es tan alto como la pista). */
  gateX: number;
  /** El tamaño con que llegan al corral. */
  escCorral: number;
  /** Su lugar en el corral. */
  corral: (persona: number) => Punto;
  /**
   * Dónde está el lugar de `persona` a la hora `t`, sin lo que le falta caminar: el del corral hasta la salida y, después, el del grupo o el
   * de la recta (`sinCaminata` de `carrera-trayectorias.ts`, que no lee la final). Con él, cada una elige el camino por el que no toca a
   * ninguna de las que ya pasaron (`LADOS`); sin él, todas van por el de siempre.
   */
  lugar?: (persona: number, t: number) => Punto;
  /** La x del frente común a la hora `t` (`frente` de `carrera-trayectorias.ts`): lo rápido que va cada una se mide respecto de ella. */
  frente?: (t: number) => number;
  /** Cuándo se abre la recta (`tAbre`): desde ahí cada carril adelanta o se atrasa según la final, que la caminata no lee (`CARRIL_FRENTE`). */
  abre?: number;
  /** Cuánto se corre su subfila de la línea de su fila, con su signo (el signo por δ): de qué lado de su fila llega. */
  subfila?: (persona: number) => number;
  /** Si la pantalla está parada (el celular): ahí la llama mide muchos cuerpos y el trote va en largos de llama, como en el proyector. */
  retrato?: boolean;
}

export interface EnMarcha extends Punto {
  esc: number;
  /** Qué parte del camino lleva hecha (0 a 1). */
  avance: number;
  /** Si todavía está caminando (falso: ya está en su lugar). */
  camina: boolean;
}

export interface OpcionesCaminata {
  /** A más tardar cuándo tiene que estar cada una en su lugar (la hora del show): si el camino de esta pantalla no alcanza a tope, camina más rápido. */
  llegarAntesDe?: number;
  /** Para las pruebas y los auditores: qué camino eligió cada una y cuánto toca con él (en el corral y antes, tocando y rozando). */
  anotar?: (persona: number, eleccion: string) => void;
}

export interface Caminata {
  /** Dónde está `persona` en `t`, o null si todavía no salió. */
  en(persona: number, t: number): EnMarcha | null;
  /** Cuándo llega a su lugar en el corral. */
  llega(persona: number): number;
  /** Lo que recorre en total, en cuerpos. */
  largo(persona: number): number;
  /** Cuánto más rápido que el tope camina (1: al tope; más, si el camino de esta pantalla no alcanza a hacerse a tiempo). */
  escala(persona: number): number;
  /** En qué puesto del grupo apretado de su tanda espera (`arena.slot`): ver `puestosEnTanda`. */
  puesto(persona: number): number;
  /**
   * Cuándo aparecen en sus lugares las de la tanda `h`: lo de `apareceTanda` y, además, nunca antes de que las que pasaron por el portón en
   * las tandas de antes hayan salido de los lugares de la tanda. Si no es una de sus tandas, lo de `apareceTanda`.
   */
  aparece(h: Tanda, previa?: Tanda): number;
}

/**
 * El puesto de cada una en el grupo apretado de su tanda (`arena.slot`). Las que pasan esperan adelante: en la primera columna (o en las
 * primeras, si en la tanda pasan más que las filas que tiene), cada una en la fila de la tanda más cerca de la altura de su lugar en el
 * corral, en el mismo orden de arriba abajo que en el corral (la asignación monótona que menos altura suma, con programación dinámica). En
 * una misma fila, la que sale antes espera más adelante. Las que no pasan llenan los demás puestos en su orden alfabético.
 *
 * Una excepción: si la que sale antes tiene que cruzar la fila de otra que sale después para llegar a la altura de su lugar en el corral (en
 * el celular parado la tanda va abajo, debajo de su tarjeta, y casi todas suben), se cambian de puesto. Así la que sale antes queda más cerca
 * de adonde va y la otra, cuando sale, ya tiene el camino libre.
 *
 * Antes esperaban en el puesto de su orden alfabético: la que salía desde atrás caminaba a través de las de adelante de su fila (en la tanda
 * esperan casi pegadas) en ocho de cada diez carreras con 60 personas, y el pasillo entre filas la sacaba limpia pero la dejaba entrar al
 * corral desde la altura de su fila de la tanda, cruzando a las que ya estaban. Desde adelante sale derecho al portón y entra al corral a su
 * altura. También deja a las dos últimas en salir de arriba abajo como en el corral (lo que hacían los cambios de puesto de antes).
 *
 * No se ve ni cambia nada del plan: en la tanda no hay nombres (están en el cartel, en orden alfabético), el orden de salida es el mismo y
 * cada una va a su lugar de siempre en el corral. Lo que se compara son alturas de la pantalla, pero lo único que decide es dónde espera,
 * sin nombre, cada una: a nadie le pasa otra cosa por el tamaño de la pantalla. No mira quién gana ni quién es finalista: mira quién pasa,
 * que se ve en cuanto sale.
 */
export function puestosEnTanda(tandas: readonly Tanda[], arena: Pick<Forma, "slot" | "yPie" | "filas" | "altoFila">, corral: (persona: number) => Punto): Map<number, number> {
  const puestos = new Map<number, number>();
  for (const h of tandas) {
    const n = h.miembros.length, F = Math.max(1, arena.filas), k = h.pasan.length;
    if (!k) {
      h.miembros.forEach((p, i) => puestos.set(p, i));
      continue;
    }
    // Los puestos de adelante: en cada fila, sus primeras `cap` columnas, de arriba abajo y de adelante atrás.
    const cap = Math.ceil(k / F);
    const lugares: { puesto: number; y: number; col: number }[] = [];
    for (let c = 0; c < cap; c++) for (let r = 0; r < F; r++) {
      const puesto = c * F + r;
      if (puesto < n) lugares.push({ puesto, y: arena.yPie(arena.slot(puesto).fila), col: c });
    }
    lugares.sort((a, b) => a.y - b.y || a.col - b.col || a.puesto - b.puesto);
    // Las que pasan, de arriba abajo por la altura de su lugar en el corral.
    const quien = h.pasan.map((p, j) => ({ p, j, y: corral(p).y })).sort((a, b) => a.y - b.y || a.j - b.j);
    // La asignación monótona que menos altura suma: `f[i][s]` es lo menos que suman las primeras `i` en los primeros `s` puestos.
    const K = quien.length, S = lugares.length;
    const f: number[][] = Array.from({ length: K + 1 }, (_, i) => new Array<number>(S + 1).fill(i === 0 ? 0 : Infinity));
    for (let i = 1; i <= K; i++) for (let sl = 1; sl <= S; sl++) {
      const usar = (f[i - 1]?.[sl - 1] as number) + Math.abs((lugares[sl - 1] as { y: number }).y - (quien[i - 1] as { y: number }).y);
      (f[i] as number[])[sl] = Math.min(f[i]?.[sl - 1] as number, usar);
    }
    const elegidos: { q: (typeof quien)[number]; l: (typeof lugares)[number] }[] = [];
    for (let i = K, sl = S; i > 0 && sl > 0; sl--) {
      if (f[i]?.[sl] === f[i]?.[sl - 1]) continue;
      elegidos.push({ q: quien[i - 1] as (typeof quien)[number], l: lugares[sl - 1] as (typeof lugares)[number] });
      i--;
    }
    // En una misma fila, la que sale antes espera más adelante.
    const porFila = new Map<number, typeof elegidos>();
    for (const e of elegidos) porFila.set(e.l.y, [...(porFila.get(e.l.y) ?? []), e]);
    const usados = new Set<number>();
    for (const grupo of porFila.values()) {
      const ls = grupo.map((e) => e.l).sort((a, b) => a.col - b.col);
      const qs = grupo.map((e) => e.q).sort((a, b) => a.j - b.j);
      qs.forEach((q, i) => {
        const l = ls[i] as { puesto: number };
        puestos.set(q.p, l.puesto);
        usados.add(l.puesto);
      });
    }
    // La que sale antes no puede tener que cruzar la fila de otra que todavía espera: si para llegar a su altura del corral pasa por la fila
    // de una que sale después, se cambian de puesto (la que sale antes queda más cerca de adonde va, y cuando sale la otra ya no está).
    {
      const yDe = (p: number): number => arena.yPie(arena.slot(puestos.get(p) as number).fila);
      const orden = [...h.pasan];
      for (let vuelta = 0; vuelta < K * K; vuelta++) {
        let cambio = false;
        for (let a = 0; a < orden.length && !cambio; a++) {
          for (let b = a + 1; b < orden.length && !cambio; b++) {
            const antes = orden[a] as number, despues = orden[b] as number;
            const ya = yDe(antes), yb = yDe(despues), va = corral(antes).y - ya;
            if (yb === ya || Math.sign(yb - ya) !== Math.sign(va) || Math.abs(yb - ya) >= Math.abs(va) + arena.altoFila / 2) continue;
            const pa = puestos.get(antes) as number, pb = puestos.get(despues) as number;
            puestos.set(antes, pb);
            puestos.set(despues, pa);
            cambio = true;
          }
        }
        if (!cambio) break;
      }
      // Después de los cambios, en cada fila la que sale antes vuelve a quedar más adelante.
      const filasUsadas = new Map<number, number[]>();
      for (const q of h.pasan) {
        const y = yDe(q);
        filasUsadas.set(y, [...(filasUsadas.get(y) ?? []), q]);
      }
      for (const enFila of filasUsadas.values()) {
        const ps = enFila.map((q) => puestos.get(q) as number).sort((x, y) => x - y);
        enFila.forEach((q, i) => puestos.set(q, ps[i] as number));
      }
    }
    // Las que no pasan, en orden alfabético en los demás puestos.
    const pasa = new Set(h.pasan);
    const libres = Array.from({ length: n }, (_, i) => i).filter((i) => !usados.has(i));
    h.miembros.filter((p) => !pasa.has(p)).forEach((p, i) => puestos.set(p, libres[i] as number));
  }
  return puestos;
}

const suave = (v: number): number => {
  const x = Math.max(0, Math.min(1, v));
  return x * x * (3 - 2 * x);
};

/** Cuánto sigue a la vista la que no pasó, echada en su lugar, después de que termina su tanda, en segundos. */
export const ECHADA_VISIBLE = 1.2;
/** Cuánto antes del cartel de su tanda aparece cada una en su lugar, en segundos. */
export const ANTES_DEL_CARTEL = 0.2;

/**
 * Cuándo aparecen en sus lugares las de la tanda `h`: un poco antes de su cartel, pero nunca antes de que se vayan las echadas de la tanda de
 * antes (`previa`), que ocupan los mismos lugares. Antes aparecían 1,4 s antes de que se fueran, de pie adentro de las echadas.
 */
export function apareceTanda(h: Tanda, previa?: Tanda): number {
  return Math.max(h.t0 - ANTES_DEL_CARTEL, previa ? previa.tFin + ECHADA_VISIBLE : -Infinity);
}

/** Dónde está una de una tanda antes de la salida del grupo, y qué hace: espera en su tanda, echada (no pasó), camina al corral o ya está en él. */
export type EnTanda =
  | { que: "oculta" }
  | { que: "espera" | "echada" | "camina" | "corral"; x: number; y: number; esc: number; desde: number; avance: number };

/**
 * Dónde está `persona` de la tanda `h` a la hora `t`, antes de la salida del grupo: la cuenta que dibuja la escena (`carrera.ts`) y que miden
 * las pruebas y el auditor de sólidos. Espera en su lugar de la tanda; si no pasa, se echa ahí cuando se cierra el portón (`desde` es esa hora) y
 * se va un poco después de que termina su tanda; si pasa, sale por el portón a su hora y camina a su lugar en el corral (`caminata`). Las tandas
 * usan los mismos lugares: con `previa` (la tanda de antes), cada una aparece cuando ya se fueron las echadas de la anterior (`apareceTanda`) y,
 * con la caminata, cuando las que pasaron ya salieron de esos lugares (`Caminata.aparece`).
 */
export function enTanda(h: Tanda, persona: number, t: number, arena: Pick<Forma, "slot" | "yPie" | "esc">, arenaX: number, caminata: Caminata | null, previa?: Tanda): EnTanda {
  if (t < (caminata ? caminata.aparece(h, previa) : apareceTanda(h, previa))) return { que: "oculta" };
  const s = arena.slot(caminata ? caminata.puesto(persona) : h.miembros.indexOf(persona));
  const lugar = { x: arenaX - s.dx, y: arena.yPie(s.fila), esc: arena.esc, avance: 0 };
  const j = h.pasan.indexOf(persona);
  if (j < 0) {
    if (t >= h.tFin + ECHADA_VISIBLE) return { que: "oculta" };
    if (t >= h.tCierra) return { que: "echada", ...lugar, desde: h.tCierra };
    return { que: "espera", ...lugar, desde: h.t0 };
  }
  const ts = h.salidas[j] as number;
  if (t < ts) return { que: "espera", ...lugar, desde: h.t0 };
  const w = caminata?.en(persona, t);
  if (!w) return { que: "oculta" };
  return { que: w.camina ? "camina" : "corral", x: w.x, y: w.y, esc: w.esc, desde: ts, avance: w.avance };
}

export function crearCaminata(tandas: readonly Tanda[], g: GeometriaCaminata, op: OpcionesCaminata = {}): Caminata {
  interface Marcha {
    ts: number;
    camino: Camino;
    largo: number;
    p: Perfil;
    esc0: number;
    llega: number;
    escala: number;
    /** Su lugar en el corral. */
    c: Punto;
  }
  interface Sale {
    h: Tanda;
    /** Cuál tanda es, en la lista. */
    k: number;
    j: number;
    persona: number;
    ts: number;
  }
  // En el celular parado la llama mide muchos cuerpos: ahí el tope del trote va en largos de llama (los mismos que en el proyector), y no en
  // cuerpos, que la hacían cruzar el corral en veinte segundos y apurar a todas para llegar juntas a la hora de la salida.
  const enLargos = g.retrato ? Math.max(1, (74 * TAM3D * g.escCorral) / g.cuerpo / LARGO_ACOSTADA) : 1;
  const V = CAMINATA.velocidad * enLargos, A = CAMINATA.aceleracion * enLargos, LAT = ACEL_LATERAL * enLargos, TOT = ACEL_TOTAL * enLargos;
  const VT = TOPES_TROTE.velocidad * enLargos;
  /** El largo de la llama del 3D en la tanda: hasta dónde va por el pasillo para dejar atrás a la de adelante de todo. */
  const largoTanda = 74 * TAM3D * g.arena.esc;
  const puestos = puestosEnTanda(tandas, g.arena, g.corral);
  const puesto = (persona: number): number => puestos.get(persona) ?? 0;
  /** El camino de quien sale `o` por la ruta `ruta`, guardado: los ritmos lo comparten. Null si esa ruta no existe (no hay pasillo de ese lado). */
  const caminos = new Map<string, { camino: CaminoTrazado; c: Punto } | null>();
  const caminoDe = (o: Sale, ruta: Ruta): { camino: CaminoTrazado; c: Punto } | null => {
    const clave = `${o.persona}:${ruta}`;
    if (caminos.has(clave)) return caminos.get(clave) ?? null;
    const s = g.arena.slot(puesto(o.persona));
    const a: Punto = { x: g.arenaX - s.dx, y: g.arena.yPie(s.fila) };
    const c = g.corral(o.persona);
    let r: { camino: CaminoTrazado; c: Punto } | null = null;
    if (typeof ruta === "number") {
      // Pasa por el portón a media altura entre de donde sale y adonde va (el portón es tan alto como la pista, así que no da vuelta de más) o,
      // si con eso cruzaría la subfila de su compañera de fila cerca de ella, más hacia su lado: una subfila más afuera de la suya.
      const yMedio = (a.y + c.y) / 2;
      const yLado = c.y + (g.subfila?.(o.persona) ?? 0);
      r = { camino: trazar([a, { x: g.gateX, y: yMedio + (yLado - yMedio) * ruta }, c]), c };
    } else if (ruta === "arriba" || s.fila < g.arena.filas - 1) {
      // Por el pasillo: se corre de costado a media fila de la suya, lejos de las dos filas que lo rodean, sigue derecho hasta dejar atrás a
      // la de adelante de todo de la tanda (ya pasado el portón) y de ahí va a su lugar.
      const y = a.y + ((ruta === "arriba" ? -1 : 1) * g.arena.altoFila) / 2;
      const x1 = a.x + 0.2 * largoTanda, x2 = Math.max(g.arenaX + 1.05 * largoTanda, g.gateX + 0.1 * largoTanda);
      if (x2 > x1 + 0.2 * largoTanda && c.x > x2 + 0.2 * largoTanda) r = { camino: trazar([a, { x: x1, y }, { x: x2, y }, c]), c };
    }
    caminos.set(clave, r);
    return r;
  };
  /**
   * La marcha de quien sale `o` cruzando el portón a la altura `lado`, con el tope de su trote por `ritmo` y su tope de apuro (`apuroMax`): si
   * el camino no se hace antes de `llegarAntesDe`, va más rápido lo justo, y si eso pasa de `apuroMax` (o si va a un ritmo más tranquilo que
   * el tope y así no llega), no sirve (null). Con `alTope`, trota a la velocidad del tope de la medida (`TOPES_TROTE`) y no a la de la
   * caminata, que tiene un poco de margen, con la misma aceleración: es lo último que prueba la que con ningún camino queda libre, y nunca pasa
   * de ese tope.
   */
  const armar = (o: Sale, ruta: Ruta, ritmo = 1, apuroMax = Infinity, alTope = false): Marcha | null => {
    const r = caminoDe(o, ruta);
    if (!r) return null;
    const { camino, c } = r;
    const largo = camino.largo / g.cuerpo;
    // En las pantallas angostas (4:3) el camino mide más cuerpos: ahí camina más rápido lo justo para llegar a tiempo, en vez de llegar tarde y
    // saltar. Con las de 16:9 y más anchas no hace falta (`escala` es 1). En una curva cerrada frena lo justo (`perfilPorCurva`).
    const base = perfilPorCurva(camino, g.cuerpo, alTope ? VT : V * ritmo, A, LAT, TOT);
    const escala = op.llegarAntesDe === undefined ? 1 : Math.max(1, base.duracion / Math.max(1, op.llegarAntesDe - o.ts));
    if (escala > apuroMax + 1e-9 || (ritmo < 1 && escala > 1)) return null;
    const p = apurado(base, escala);
    return { ts: o.ts, camino, largo, p, esc0: g.arena.esc, llega: o.ts + p.duracion, escala, c };
  };
  /**
   * La marcha de siempre: por el portón a media altura, todo el camino al tope de su curva más cerrada (`ACEL_LATERAL_SIEMPRE`) y, si con eso
   * no llega a tiempo, más rápido lo justo. Es la que lleva quien no toca a nadie por ahí.
   */
  const deSiempre = (o: Sale): Marcha => {
    const { camino, c } = caminoDe(o, 0) as { camino: CaminoTrazado; c: Punto };
    const largo = camino.largo / g.cuerpo;
    const kb = camino.curvatura * g.cuerpo;
    const vTope = kb > 0 ? Math.min(V, Math.sqrt((ACEL_LATERAL_SIEMPRE * enLargos) / kb)) : V;
    const base = perfil(largo, vTope, A);
    const escala = op.llegarAntesDe === undefined ? 1 : Math.max(1, base.duracion / Math.max(1, op.llegarAntesDe - o.ts));
    const p = escala > 1 ? perfil(largo, vTope * escala, A * escala * escala) : base;
    return { ts: o.ts, camino, largo, p, esc0: g.arena.esc, llega: o.ts + p.duracion, escala, c };
  };
  const enMarcha = (m: Marcha, t: number): { x: number; y: number; esc: number; avance: number } => {
    const r = m.p.recorrido(t - m.ts);
    const f = m.largo > 0 ? r / m.largo : 1;
    const pt = m.camino.en(r * g.cuerpo);
    return { x: pt.x, y: pt.y, esc: m.esc0 + (g.escCorral - m.esc0) * suave(f), avance: f };
  };
  const salen: Sale[] = tandas.flatMap((h, k) => h.pasan.map((persona, j) => ({ h, k, j, persona, ts: h.salidas[j] as number })));
  salen.sort((x, y) => x.ts - y.ts || x.persona - y.persona);
  const marchas = new Map<number, Marcha>();
  const lugar = g.lugar;
  if (!lugar || !salen.length) {
    for (const o of salen) marchas.set(o.persona, deSiempre(o));
  } else {
    // Cada una, en el orden en que sale, elige el primer camino con el que no toca a ninguna de las que ya salieron (las que caminan y las que
    // ya están en su lugar, que desde la salida corren con el grupo), mirando cada `PASO_CAMINO` s con la huella del 3D: por dónde cruza el
    // portón (`LADOS`) y, si con ninguno queda libre, a qué ritmo trota (`RITMOS`: la que llega donde otra todavía pasa la deja pasar). Primero
    // cuenta lo que toca pasado el portón (el corral) y después lo de antes; si ninguno queda libre, prueba a la velocidad del tope de la
    // medida, y si tampoco, se queda con el que menos toca. Después, la que todavía toca a alguien vuelve a elegir mirando a todas,
    // también a las que salieron después (`VUELTAS`). Todo sale de dónde está cada una: la elección es la misma la arme quien la arme, y no
    // mira quién gana.
    const t0 = (salen[0] as Sale).ts;
    const lugares = new Map<number, Map<number, Punto>>();
    const lugarEn = (persona: number, i: number): Punto => {
      let porHora = lugares.get(persona);
      if (!porHora) lugares.set(persona, (porHora = new Map()));
      let l = porHora.get(i);
      if (!l) porHora.set(i, (l = lugar(persona, t0 + i * PASO_CAMINO)));
      return l;
    };
    const centroEnMundo = (persona: number, m: Marcha, i: number): { x: number; y: number; esc: number } => {
      const t = t0 + i * PASO_CAMINO;
      const l = lugarEn(persona, i);
      if (t >= m.llega) return { x: l.x, y: l.y, esc: g.escCorral };
      const w = enMarcha(m, t);
      return { x: l.x + w.x - m.c.x, y: l.y + w.y - m.c.y, esc: w.esc };
    };
    const cajaEnMundo = (persona: number, m: Marcha, i: number): Caja => {
      const c = centroEnMundo(persona, m, i);
      return cajaDe(c.x, c.y, c.esc);
    };
    const cajas = new Map<Marcha, Map<number, Caja>>();
    const cajaDeQuien = (persona: number, i: number): Caja => {
      const m = marchas.get(persona) as Marcha;
      let porHora = cajas.get(m);
      if (!porHora) cajas.set(m, (porHora = new Map()));
      let c = porHora.get(i);
      if (!c) porHora.set(i, (c = cajaEnMundo(persona, m, i)));
      return c;
    };
    // Las de las tandas en su lugar: esperan su salida o, las que no pasan, se echan ahí, y se van cuando se va la tanda (`enTanda`).
    const quietas = tandas.map((h, k) => {
      const desde = apareceTanda(h, tandas[k - 1]);
      return {
        desde, hasta: h.tFin + ECHADA_VISIBLE,
        lista: h.miembros.map((persona) => {
          const s = g.arena.slot(puesto(persona));
          const j = h.pasan.indexOf(persona);
          return { persona, caja: cajaDe(g.arenaX - s.dx, g.arena.yPie(s.fila), g.arena.esc), caja2: caja2D(g.arenaX - s.dx, g.arena.yPie(s.fila), g.arena.esc), hasta: j < 0 ? h.tFin + ECHADA_VISIBLE : (h.salidas[j] as number) };
        }),
      };
    });
    /** Lo que cuenta, en orden: las muestras en que toca a otra pasado el portón y antes de él, y las muestras en que la roza. */
    const contar = (o: Sale, m: Marcha, contra: readonly Sale[]): number[] => {
      const cuenta = [0, 0, 0, 0];
      const i0 = Math.ceil((m.ts - t0) / PASO_CAMINO - 1e-9), i1 = Math.floor((m.llega - t0) / PASO_CAMINO + 1e-9);
      for (let i = i0; i <= i1; i++) {
        const t = t0 + i * PASO_CAMINO;
        const centro = centroEnMundo(o.persona, m, i);
        const yo = cajaDe(centro.x, centro.y, centro.esc);
        const yo2 = caja2D(centro.x, centro.y, centro.esc);
        const antes = enMarcha(m, t).x < g.gateX ? 1 : 0;
        // Solo las de su tanda: las de la anterior ya se fueron cuando sale, y la siguiente aparece cuando ya salió de sus lugares (`aparece`).
        for (const tq of [quietas[o.k]]) {
          if (!tq || t < tq.desde || t >= tq.hasta) continue;
          for (const q of tq.lista) {
            if (q.persona === o.persona || t >= q.hasta || q.caja.x1 < yo.x0 || q.caja.x0 > yo.x1) continue;
            if (encimadas(yo, q.caja) > TOCA_TANDA || encimadas(yo2, q.caja2) > TOCA_TANDA) (cuenta[antes] as number)++;
          }
        }
        for (const q of contra) {
          if (q === o || t0 + i * PASO_CAMINO < q.ts) continue;
          const otra = cajaDeQuien(q.persona, i);
          if (otra.x1 < yo.x0 || otra.x0 > yo.x1) continue;
          const v = encimadas(yo, otra);
          if (v > TOCA_CAMINO) (cuenta[antes] as number)++;
          if (v > ROZA_CAMINO) (cuenta[2 + antes] as number)++;
        }
      }
      return cuenta;
    };
    const menor = (a: readonly number[], b: readonly number[]): boolean => {
      const k = a.findIndex((x, j) => x !== b[j]);
      return k >= 0 && (a[k] as number) < (b[k] as number);
    };
    const toca = (c: readonly number[]): boolean => (c[0] as number) + (c[1] as number) > 0;
    /**
     * Lo más rápido que se mueve respecto del frente común, en cuerpos por segundo: lo que camina más lo que se mueve su lugar, hacia adelante
     * y de costado (en el grupo, el paseo, y en la recta que se abre en la salida, el avance de su carril y el paso a él mientras todavía
     * entra). Es lo que mide la prueba del paso del corral al carril (`carrera-caminata.test.ts`), muestreado cada `PASO_CAMINO` s. Con
     * `conCarril`, con la recta abierta suma lo que puede moverse su carril en la final (`CARRIL_FRENTE`), que el lugar no trae.
     */
    const rapidez = (o: Sale, m: Marcha, conCarril = false): number => {
      const i0 = Math.ceil((m.ts - t0) / PASO_CAMINO - 1e-9), i1 = Math.floor((m.llega - t0) / PASO_CAMINO + 1e-9) + 1;
      let max = 0, antes: Punto | null = null;
      for (let i = i0; i <= i1; i++) {
        const t = t0 + i * PASO_CAMINO;
        const w = t < m.llega ? enMarcha(m, t) : m.c;
        const l = lugarEn(o.persona, i);
        const r = { x: w.x + l.x - (g.frente?.(t) ?? l.x), y: w.y + l.y - 2 * m.c.y };
        const carril = conCarril && g.abre !== undefined && t >= g.abre ? CARRIL_FRENTE * enLargos : 0;
        if (antes) max = Math.max(max, Math.hypot(r.x - antes.x, r.y - antes.y) / PASO_CAMINO / g.cuerpo + carril);
        antes = r;
      }
      return max;
    };
    /** El mejor camino de `o` mirando a `contra`: el primero que no toca ni roza, o el que menos. */
    const elegir = (o: Sale, contra: readonly Sale[]): { m: Marcha; cuenta: number[]; que: string } => {
      const referencia = deSiempre(o);
      let mejor = { m: referencia, cuenta: contar(o, referencia, contra), que: "de siempre" };
      if (mejor.cuenta.every((c) => c === 0)) return mejor;
      // A tope (o con el apuro que ya necesita el camino de siempre) y a los otros ritmos. Ninguno puede moverse respecto del frente más
      // rápido que el de siempre o que `RAPIDEZ_FRENTE`, contando con la recta abierta lo que puede moverse su carril.
      const tope = Math.max(1, referencia.escala);
      const rapidezMax = Math.max(RAPIDEZ_FRENTE * enLargos, rapidez(o, referencia));
      const probar = (m: Marcha | null, que: string): boolean => {
        if (!m || rapidez(o, m, true) > rapidezMax + 1e-9) return false;
        const cuenta = contar(o, m, contra);
        if (menor(cuenta, mejor.cuenta)) mejor = { m, cuenta, que };
        return cuenta.every((c) => c === 0);
      };
      // Los pasillos, del lado de su lugar primero, enseguida del camino de siempre: son los que la sacan de la tanda sin pasar a través de nadie.
      const s = g.arena.slot(puesto(o.persona));
      const pasillos: Ruta[] = g.corral(o.persona).y < g.arena.yPie(s.fila) ? ["arriba", "abajo"] : ["abajo", "arriba"];
      const rutas: Ruta[] = [0, ...pasillos, ...LADOS.slice(1)];
      // Si con ninguno queda libre, prueba a la velocidad del tope de la medida (`alTope`): nunca más rápido, y el apuro es solo el que ya
      // necesita el camino de siempre en esta pantalla.
      for (const ritmo of RITMOS) for (const ruta of rutas) if (probar(armar(o, ruta, ritmo, tope), `${ruta} al ${ritmo}`)) return mejor;
      if (toca(mejor.cuenta)) for (const ruta of rutas) if (probar(armar(o, ruta, 1, tope, true), `${ruta} al tope`)) return mejor;
      return mejor;
    };
    const eleccion = new Map<number, { cuenta: number[]; que: string }>();
    salen.forEach((o, k) => {
      const e = elegir(o, salen.slice(0, k));
      marchas.set(o.persona, e.m);
      eleccion.set(o.persona, e);
    });
    for (let vuelta = 0; vuelta < VUELTAS; vuelta++) {
      let cambio = false;
      for (const o of salen) {
        const ahora = contar(o, marchas.get(o.persona) as Marcha, salen);
        if (!toca(ahora)) continue;
        const e = elegir(o, salen);
        if (menor(e.cuenta, ahora)) {
          marchas.set(o.persona, e.m);
          eleccion.set(o.persona, e);
          cambio = true;
        }
      }
      if (!cambio) break;
    }
    if (op.anotar) for (const o of salen) op.anotar(o.persona, `${eleccion.get(o.persona)?.que}, toca ${contar(o, marchas.get(o.persona) as Marcha, salen).join("/")}`);
  }
  // Cuándo aparece cada tanda: nunca antes de que las que pasaron en las de antes salgan de los lugares de la tanda (los mismos para todas),
  // con las dos huellas desde el 10 %. En el celular parado la tanda va abajo y la última en pasar sube despacio por delante de ella: la
  // siguiente aparecía de pie sobre ella. Nunca después de un segundo antes de su primera salida.
  const apareceEn = tandas.map((h, k) => apareceTanda(h, tandas[k - 1]));
  {
    const tam = Math.max(0, ...tandas.map((h) => h.miembros.length));
    const lugares3: Caja[] = [], lugares2: Caja[] = [];
    for (let i = 0; i < tam; i++) {
      const s = g.arena.slot(i);
      lugares3.push(cajaDe(g.arenaX - s.dx, g.arena.yPie(s.fila), g.arena.esc));
      lugares2.push(caja2D(g.arenaX - s.dx, g.arena.yPie(s.fila), g.arena.esc));
    }
    const xMax = Math.max(-Infinity, ...lugares3.map((c) => c.x1));
    let despeja = -Infinity;
    tandas.forEach((h, k) => {
      if (k > 0) apareceEn[k] = Math.min(Math.max(apareceEn[k] as number, despeja), Math.max(apareceEn[k] as number, (h.salidas[0] ?? Infinity) - 1));
      for (const persona of h.pasan) {
        const m = marchas.get(persona);
        if (!m) continue;
        for (let t = m.ts; t <= m.llega; t += 1 / 60) {
          const w = enMarcha(m, t);
          const c3 = cajaDe(w.x, w.y, w.esc);
          if (c3.x0 > xMax) break;
          const c2 = caja2D(w.x, w.y, w.esc);
          if (lugares3.some((q, i) => encimadas(c3, q) > TOCA_TANDA || encimadas(c2, lugares2[i] as Caja) > TOCA_TANDA)) despeja = Math.max(despeja, t + 1 / 60);
        }
      }
    });
  }
  return {
    aparece: (h, previa) => {
      const k = tandas.indexOf(h);
      return k < 0 ? apareceTanda(h, previa) : (apareceEn[k] as number);
    },
    en(persona, t) {
      const m = marchas.get(persona);
      if (!m || t < m.ts) return null;
      return { ...enMarcha(m, t), camina: t < m.llega };
    },
    llega: (persona) => marchas.get(persona)?.llega ?? -Infinity,
    largo: (persona) => marchas.get(persona)?.largo ?? 0,
    escala: (persona) => marchas.get(persona)?.escala ?? 1,
    puesto,
  };
}
