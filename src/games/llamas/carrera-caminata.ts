import { formaDe, hudDe, type Forma, type Pantalla } from "./carrera-forma";
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
/** Lo que puede valer la aceleración hacia el costado en una curva, en cuerpos por segundo cada segundo. */
const ACEL_LATERAL = 0.5;
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

const MUESTRAS = 48;

export function trazar(puntos: readonly Punto[]): Camino {
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
  // La curva más cerrada del camino, en 1 / píxel: el giro entre dos tramos de muestras sobre lo que se avanza.
  let curvatura = 0;
  for (let k = 2; k < xs.length; k++) {
    const d1 = (ss[k - 1] as number) - (ss[k - 2] as number), d2 = (ss[k] as number) - (ss[k - 1] as number);
    if (d1 < 1e-6 || d2 < 1e-6) continue;
    const a1 = Math.atan2((ys[k - 1] as number) - (ys[k - 2] as number), (xs[k - 1] as number) - (xs[k - 2] as number));
    const a2 = Math.atan2((ys[k] as number) - (ys[k - 1] as number), (xs[k] as number) - (xs[k - 1] as number));
    let dth = a2 - a1;
    if (dth > Math.PI) dth -= 2 * Math.PI;
    if (dth < -Math.PI) dth += 2 * Math.PI;
    curvatura = Math.max(curvatura, Math.abs(dth) / ((d1 + d2) / 2));
  }
  const largo = acum;
  return {
    largo,
    curvatura,
    en(s) {
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
    },
  };
}

/** Cuánto tarda en recorrer `largo` (en cuerpos) arrancando y frenando de a poco, y qué lleva hecho a los `tau` segundos. */
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
  arena: Pick<Forma, "slot" | "yPie" | "esc">;
  arenaX: number;
  /** El portón: la x por donde pasan (es tan alto como la pista). */
  gateX: number;
  /** El tamaño con que llegan al corral. */
  escCorral: number;
  /** Su lugar en el corral. */
  corral: (persona: number) => Punto;
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
}

const suave = (v: number): number => {
  const x = Math.max(0, Math.min(1, v));
  return x * x * (3 - 2 * x);
};

export function crearCaminata(tandas: readonly Tanda[], g: GeometriaCaminata, op: OpcionesCaminata = {}): Caminata {
  interface Marcha {
    ts: number;
    camino: Camino;
    largo: number;
    p: ReturnType<typeof perfil>;
    esc0: number;
    llega: number;
    escala: number;
  }
  const marchas = new Map<number, Marcha>();
  for (const h of tandas) {
    h.pasan.forEach((persona, j) => {
      const s = g.arena.slot(h.miembros.indexOf(persona));
      const a: Punto = { x: g.arenaX - s.dx, y: g.arena.yPie(s.fila) };
      const c = g.corral(persona);
      // Pasa por el portón a media altura entre de donde sale y adonde va: el portón es tan alto como la pista, así que no da vuelta de más.
      const camino = trazar([a, { x: g.gateX, y: (a.y + c.y) / 2 }, c]);
      const largo = camino.largo / g.cuerpo;
      const ts = h.salidas[j] as number;
      // En las pantallas angostas (4:3, el celular parado) el camino mide más cuerpos: ahí camina más rápido lo justo para llegar a tiempo,
      // en vez de llegar tarde y saltar. Con las de 16:9 y más anchas no hace falta (`escala` es 1).
      // En una curva cerrada la velocidad baja lo que haga falta para que la aceleración hacia el costado (la velocidad al cuadrado por la curvatura) no pase de
      // 0,5 cuerpos por segundo cada segundo: con la tangente en diagonal casi no hace falta.
      const kb = camino.curvatura * g.cuerpo;
      const vTope = kb > 0 ? Math.min(CAMINATA.velocidad, Math.sqrt(ACEL_LATERAL / kb)) : CAMINATA.velocidad;
      const base = perfil(largo, vTope);
      const escala = op.llegarAntesDe === undefined ? 1 : Math.max(1, base.duracion / Math.max(1, op.llegarAntesDe - ts));
      const p = escala > 1 ? perfil(largo, vTope * escala, CAMINATA.aceleracion * escala * escala) : base;
      marchas.set(persona, { ts, camino, largo, p, esc0: g.arena.esc, llega: ts + p.duracion, escala });
    });
  }
  return {
    en(persona, t) {
      const m = marchas.get(persona);
      if (!m || t < m.ts) return null;
      const r = m.p.recorrido(t - m.ts);
      const f = m.largo > 0 ? r / m.largo : 1;
      const pt = m.camino.en(r * g.cuerpo);
      return { x: pt.x, y: pt.y, esc: m.esc0 + (g.escCorral - m.esc0) * suave(f), avance: f, camina: t < m.llega };
    },
    llega: (persona) => marchas.get(persona)?.llega ?? -Infinity,
    largo: (persona) => marchas.get(persona)?.largo ?? 0,
    escala: (persona) => marchas.get(persona)?.escala ?? 1,
  };
}
