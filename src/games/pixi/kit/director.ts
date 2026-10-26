import { ARCS } from "../../drama";
import { cabe, centrar, dentro, unir, crecer, type Zona } from "../encuadre";
import { latidosFoco, tiemposFoco } from "../foco";
import { acotar } from "./azar";
import type { Arc, Camara, Caja, FocoPunto, Kit, Momentos, Plan, PlanoToma, Toma, Vista } from "./tipos";

/**
 * El director del kit: los cinco arcos de un sorteo.
 *
 * El director de emoción (`drama.ts`) decide qué historia cuenta el juego; el
 * de cámara (`camera.ts`) sabe moverse; este dice **cuándo** y **cuánto**. Cada
 * juego repetía a mano un `aim()` con un `if` por hora, y sólo dos de diez
 * tenían zoom de emoción. Acá los momentos tienen nombre:
 *
 * 1. **Presentación.** El plano entero, que respira un 1 %: cada uno se busca en
 *    la pantalla. Nunca cuatro segundos quieto.
 * 2. **Tensión.** La cámara se acerca lento, un 12 %, hacia lo que decide (el
 *    puntero, los que quedan), nunca sobre quien gana solo: apuntar a uno solo
 *    lo delata (auditor de delatores). Siempre sobre dos o más.
 * 3. **Silencio.** La música se corta 0,4 s antes del golpe y, ya coronado, el
 *    foco se oscurece y suenan los latidos (`foco.ts`). No empieza nada nuevo.
 * 4. **Golpe.** Un acercamiento del 20 % que se sostiene 0,5 s y vuelve en 1,2;
 *    el sacudón y la fanfarria. Cae cuando golpea el foco, nunca antes.
 * 5. **Foco.** La luz sobre quien gana y el cartel. Si el juego lo pide, la
 *    cámara protege al ganador debajo del cartel.
 *
 * El arco de la historia (remontada, susto, duelo, tapada) da el sabor: una
 * tabla pura, `SABOR[arco]`. Todo sale del plan y de la hora del juego; el
 * director no usa azar. Puro: la cámara llega por una interfaz mínima, así que
 * se prueba en Node sin placa de video.
 */
export type Fase = "presentacion" | "juego" | "tension" | "silencio" | "golpe" | "foco";
export const FASES: readonly Fase[] = ["presentacion", "juego", "tension", "silencio", "golpe", "foco"];

export interface Sabor {
  /** Cuánto sube el acercamiento con la tensión, como fracción (0,12 es un 12 %). */
  empuje: number;
  /** En cuántos segundos de juego antes de coronar sube ese acercamiento. */
  empujeDur: number;
  /** El golpe: cuánto se acerca, cuánto se sostiene y en cuánto vuelve. */
  golpe: { amt: number; hold: number; vuelta: number };
  /** El sacudón del golpe, en unidades `u()` del juego. */
  sacudon: number;
  /** Cuántos latidos graves suenan en el silencio del foco (`latidosFoco`). */
  latidos: number;
  /** La tapada se apaga del todo antes de prender la luz. */
  apagon: boolean;
  /** El duelo es la foto: un marco de cámara y un flash. */
  marco: boolean;
}

/** El empuje del 12 % y el golpe del 20 % sostenido 0,5 s: los valores por defecto del barrido de emoción. */
export const POR_DEFECTO = { empuje: 0.12, golpe: { amt: 0.2, hold: 0.5, vuelta: 1.2 }, sacudon: 10, empujeDur: 4 } as const;

const sabor = (arco: Arc, extra: Partial<Pick<Sabor, "empujeDur" | "sacudon">> & { vuelta?: number } = {}): Sabor => ({
  empuje: POR_DEFECTO.empuje,
  empujeDur: extra.empujeDur ?? POR_DEFECTO.empujeDur,
  golpe: { ...POR_DEFECTO.golpe, vuelta: extra.vuelta ?? POR_DEFECTO.golpe.vuelta },
  sacudon: extra.sacudon ?? POR_DEFECTO.sacudon,
  latidos: latidosFoco(arco).length,
  apagon: arco === "tapada",
  marco: arco === "duelo",
});

/**
 * El sabor de cada arco. Los montos son los mismos (12 % y 20 %): lo que cambia
 * es el ritmo. La remontada ya viene con el envión; el susto sube más despacio
 * y suelta más largo, como una exhalación; el duelo es la foto, seca y corta;
 * la tapada sacude más, porque nadie la esperaba.
 */
export const SABOR: Readonly<Record<Arc, Sabor>> = {
  remontada: sabor("remontada"),
  susto: sabor("susto", { empujeDur: 4.5, vuelta: 1.4, sacudon: 12 }),
  duelo: sabor("duelo", { empujeDur: 3.5, vuelta: 1.0, sacudon: 8 }),
  tapada: sabor("tapada", { sacudon: 12 }),
};

/* ------------------------------------------------------------ el cronograma */

export interface Cronograma {
  arco: Arc;
  presentacionHasta: number;
  tensionDesde: number;
  /** Cuándo empieza a subir el acercamiento: justo para llegar arriba al coronar. */
  empujeDesde: number;
  /** Cuándo se corta la música: 0,4 s antes del respiro. */
  silencioDesde: number;
  corona: number;
  /** Cuándo golpea el foco, en segundos de juego (los del foco son reales y el ritmo los estira). */
  golpeEn: number;
  placaEn: number;
}

type PlanMinimo = Pick<Plan<unknown>, "duracion" | "arco" | "respiro"> & { momentos: Pick<Momentos, "presentacion" | "tension"> };

export function cronograma(plan: PlanMinimo, pace = 1): Cronograma {
  const foco = tiemposFoco(plan.arco);
  const respiro = plan.respiro ?? plan.duracion;
  const empujeDesde = Math.max(plan.momentos.tension.desde, plan.duracion - SABOR[plan.arco].empujeDur);
  return {
    arco: plan.arco,
    presentacionHasta: plan.momentos.presentacion.hasta,
    tensionDesde: plan.momentos.tension.desde,
    empujeDesde,
    silencioDesde: respiro - 0.4 / pace,
    corona: plan.duracion,
    golpeEn: plan.duracion + foco.golpe / pace,
    placaEn: plan.duracion + foco.placa / pace,
  };
}

/** En qué arco está el juego en el segundo `t`. */
export function faseEn(c: Cronograma, t: number): Fase {
  if (t >= c.placaEn) return "foco";
  if (t >= c.golpeEn) return "golpe";
  if (t >= c.silencioDesde) return "silencio";
  if (t >= c.tensionDesde) return "tension";
  if (t < c.presentacionHasta) return "presentacion";
  return "juego";
}

/** Lo que está mal en los momentos de un plan, para las pruebas de cada juego. Vacío si están en orden. */
export function problemasDeMomentos(plan: PlanMinimo & { momentos: Pick<Momentos, "tomas"> }): string[] {
  const p: string[] = [];
  const m = plan.momentos;
  if (!(plan.duracion > 0)) p.push("la duración tiene que ser mayor que cero");
  if (!(m.presentacion.hasta > 0)) p.push("la presentación tiene que durar algo");
  if (m.presentacion.hasta > m.tension.desde) p.push("la presentación termina después de que empieza la tensión");
  if (m.tension.desde > plan.duracion) p.push("la tensión empieza después de coronar");
  if ((plan.respiro ?? plan.duracion) > plan.duracion) p.push("el respiro cae después de coronar");
  if ((plan.respiro ?? plan.duracion) < m.tension.desde) p.push("el respiro cae antes de que empiece la tensión");
  const desdes = (m.tomas ?? []).map((x) => x.desde);
  if (desdes.some((d, i) => i > 0 && d < (desdes[i - 1] as number))) p.push("las tomas intermedias no están en orden");
  if (desdes.some((d) => d < m.presentacion.hasta || d > m.tension.desde)) p.push("una toma intermedia cae fuera de entre la presentación y la tensión");
  if (m.tension.empuje !== undefined && !(m.tension.empuje > 0 && m.tension.empuje <= 0.4)) p.push("el empuje de la tensión tiene que estar entre 0 y 0,4");
  return p;
}

/* ------------------------------------------------------------------- tomas */

/** La zona libre y el tamaño de la pantalla: lo que el director necesita para encuadrar una caja. */
export interface Pantalla {
  w: number;
  h: number;
  /** La unidad de diseño (`u()`). */
  k: number;
  /** Entre la barra de arriba y el relator. */
  zona: Zona;
  /** Hasta dónde baja el cartel del ganador (`PixiStage.placaBajo`): debajo de ahí, el ganador se ve entero. */
  placaBajo?: number;
}

/** La vista que deja la caja entera dentro de la zona, con el mayor acercamiento que entre (y no más de `zoomMax`). */
export function resolverToma(p: PlanoToma, pant: Pick<Pantalla, "w" | "h" | "zona">): Vista {
  if ("vista" in p) return p.vista;
  const zona = p.zona ?? pant.zona;
  const cabeEn = cabe(p.caja, zona);
  const z = Math.min(Number.isFinite(cabeEn) ? cabeEn : 1, p.zoomMax ?? Infinity);
  return centrar(p.caja, zona, pant.w, pant.h, Number.isFinite(z) && z > 0 ? z : 1);
}

/** La vista más parecida que deja la meta entera en la pantalla: la meta (o la cinta del camino) está en todo cuadro. */
export function guardarMeta(v: Vista, meta: Caja | null, pant: Pick<Pantalla, "w" | "h" | "zona">): Vista {
  return meta ? dentro(meta, pant.zona, v, pant.w, pant.h) : v;
}

/** ¿El cartel está encima de quien gana? Pasa si su centro queda por encima del borde de abajo del cartel. */
export const tapaAlGanador = (placaBajo: number, foco: FocoPunto): boolean => foco.y < placaBajo;

/** El cuadrado de quien gana, de la pantalla al mundo, para la vista `v`: lo que la cámara tiene que proteger. */
export function cajaDelFoco(f: FocoPunto, v: Vista, w: number, h: number): Caja {
  const z = v.z > 0 ? v.z : 1;
  return { x: v.x + (f.x - w / 2) / z - f.r / z, y: v.y + (f.y - h / 2) / z - f.r / z, w: (2 * f.r) / z, h: (2 * f.r) / z };
}

/** La toma del plano entero: toda la caja a la vista, respirando un 1 %. */
export const planoEntero =
  (caja: Caja | ((k: Kit) => Caja), respira = 0.01): Toma =>
  (k) => ({ caja: typeof caja === "function" ? caja(k) : caja, respira });

/**
 * La toma sobre lo que decide: las cajas de los que quedan, con un margen. Pide
 * dos o más: con una sola, la cámara apunta a un solo y lo delata.
 */
export const planoSobre =
  (cajas: (k: Kit, t: number) => readonly Caja[], o: { margen?: number; zoomMax?: number; ritmo?: number; respira?: number } = {}): Toma =>
  (k, t) => {
    const cs = cajas(k, t);
    return { caja: crecer(unir(cs), o.margen ?? 0), zoomMax: o.zoomMax, ritmo: o.ritmo, respira: o.respira };
  };

/** La toma que vale en el segundo `t`: la presentación, la última intermedia que ya empezó, o la de la tensión. */
export function elegirToma(m: Pick<Momentos, "presentacion" | "tomas" | "tension">, t: number): Toma {
  if (t >= m.tension.desde) return m.tension.toma;
  if (t < m.presentacion.hasta) return m.presentacion.toma;
  let toma = m.presentacion.toma;
  for (const x of m.tomas ?? []) if (x.desde <= t) toma = x.toma;
  return toma;
}

/* ---------------------------------------------------------------- el director */

export interface EntornoDirector {
  cam: Camara;
  kit: Kit;
  pantalla(): Pantalla;
  /** Anota un dato para los auditores (`data-*` del lienzo). */
  marcar(clave: string, valor: string): void;
  /** Cuánto estira el reloj la duración elegida. */
  ritmo(): number;
}

export interface Director {
  readonly cronograma: Cronograma;
  /** Lleva la cámara a donde toca en el segundo `t`. Devuelve el arco en que está. */
  cuadro(t: number): Fase;
  /** El golpe de la cámara, una sola vez. Devuelve la hora de la cámara en que cayó. */
  golpe(): number;
}

/** Lo que protege la cámara por su cuenta: el cuadrado de quien gana, debajo del cartel y encima del relator. */
function protegidoDelFoco(m: Pick<Momentos, "foco">, env: EntornoDirector, pant: Pantalla): { caja: Caja; zona: Zona } | null {
  if (pant.placaBajo === undefined) return null;
  const caja = cajaDelFoco(m.foco(env.kit), { x: env.cam.x, y: env.cam.y, z: env.cam.zoom }, pant.w, pant.h);
  return { caja, zona: { x0: 0, y0: pant.placaBajo, x1: pant.w, y1: pant.zona.y1 } };
}

export function crearDirector(plan: PlanMinimo & { momentos: Momentos }, env: EntornoDirector): Director {
  const c = cronograma(plan, env.ritmo());
  const s = SABOR[plan.arco];
  const empuje = plan.momentos.tension.empuje ?? s.empuje;
  let ultima: Fase | null = null;
  let empujeDado = false;
  let golpeHora: number | null = null;

  return {
    cronograma: c,
    cuadro(t) {
      const fase = faseEn(c, t);
      if (fase !== ultima) {
        ultima = fase;
        env.marcar("momento", fase);
      }
      // El empuje de la tensión: una sola vez, lento, para llegar arriba al coronar.
      if (!empujeDado && t >= c.empujeDesde && t < c.corona) {
        empujeDado = true;
        env.cam.tension(Math.max(0.5, c.corona - c.empujeDesde), empuje);
      }
      const pant = env.pantalla();
      const p = elegirToma(plan.momentos, t)(env.kit, t);
      // La meta (o la cinta del camino) está en todo cuadro: ninguna toma la suelta.
      const v = guardarMeta(resolverToma(p, pant), plan.momentos.meta?.(env.kit, t) ?? null, pant);
      const respira = p.respira ? 1 + p.respira * Math.sin(t * 1.05) : 1;
      env.cam.lookAt(v.x, v.y, v.z * respira, p.ritmo ?? 3);
      // Con quien gana ya a la vista, ningún zoom lo corta ni lo mete debajo del cartel.
      if (fase === "golpe" || fase === "foco") {
        // Si el juego no dijo qué proteger, se protege a quien gana, debajo del cartel: el cartel nunca queda encima.
        const g = plan.momentos.protegido?.(env.kit) ?? protegidoDelFoco(plan.momentos, env, pant);
        env.cam.proteger(g ? g.caja : null, g ? g.zona : undefined);
      }
      return fase;
    },
    golpe() {
      if (golpeHora !== null) return golpeHora;
      const g = s.golpe;
      golpeHora = env.cam.golpe(g.amt, g.hold, g.vuelta);
      env.cam.shake(s.sacudon * env.pantalla().k);
      env.marcar("golpe", golpeHora.toFixed(3));
      return golpeHora;
    },
  };
}

/** Los arcos de la historia, para las pruebas que recorren los cuatro. */
export const ARCOS: readonly Arc[] = ARCS;

/** Una fracción de `t` entre dos segundos, de 0 a 1: para los juegos que mezclan tomas a mano. */
export const avance = (t: number, desde: number, hasta: number): number => (hasta <= desde ? (t >= desde ? 1 : 0) : acotar((t - desde) / (hasta - desde), 0, 1));
