import { sembrar } from "../pixi/kit/azar";
import { SENUELOS } from "./carrera-base";
import { TAM3D, ZC } from "./carrera-3d-mapa";
import type { Roca } from "./carrera-rocas";

/**
 * La piedrita que se salta: una piedra chica en el medio de cada fila del tramo de piedras, que cada llama de esa fila salta de un brinco
 * corto, a la vista. Las rocas grandes van en los pasillos entre filas (`sembrarRocas`) y nadie las pisa; esta va en el camino, para que se
 * vea que las llamas ven las piedras.
 *
 * Todo es puro: la lista sale de la semilla de la ronda y de la geometría de la pantalla, y el salto, del lugar de la llama. Saltan todas las
 * de la fila, la que gana y las demás, así que el salto no dice nada de nadie.
 *
 * Y en 6 de cada 10 carreras con piedras, a una (pareja entre las del grupo que siguen en pie al terminar un tramo de piedras, sacada de la
 * semilla y del plan, sin mirar quién gana ni la pantalla) se le engancha la pata: el
 * brinco no le alcanza, la piedrita sale despedida hacia el pasillo, frena y tiembla, y ella trastabilla con la cabeza baja y la marca de alerta un rato,
 * sin perder lugar. Es el choque divertido con una piedra, y nada se atraviesa: la piedrita se va antes de quedar debajo de sus patas.
 */

/** El largo de la piedrita, en cuerpos. */
export const PIEDRITA_LARGO = 0.25;
/** Su fondo, como fracción del ancho de la huella del 3D. */
export const PIEDRITA_FONDO = 0.8;
/** Su alto, como fracción del alto de la llama del 3D: debajo de la panza, solo hay que levantar las patas. */
export const PIEDRITA_ALTO = 0.18;
/** Desde cuántos cuerpos después de que empieza el tramo puede estar, y hasta cuántos antes de que termine (sin contar el largo del grupo). */
export const PIEDRITA_DESDE = 1.5;
export const PIEDRITA_HASTA = 6;
/** Dónde van las patas de la llama del 3D, de la de atrás a la de adelante, en unidades del dibujo (las caderas en -16 y 15, con el casco). */
export const PATAS: readonly [number, number] = [-20, 19];
/** Lo alto del brinco, como fracción del alto de la llama del 3D. */
export const SALTO_ALTO = 0.42;
/**
 * Qué parte del brinco va con las patas por encima de la piedrita. Con un arco de seno, de 0,42 de alto sobre una piedrita de 0,18, las patas
 * van por encima en un 72 % del brinco: se pide un poco menos, para que nunca la rocen.
 */
export const SALTO_CUBRE = 0.66;
/** Cuánto puede durar el brinco en el aire, en segundos (M6 de la dirección pide de 0,5 a 0,7): si la pantalla no da, no hay piedrita. */
export const SALTO_AIRE: readonly [number, number] = [0.45, 0.75];
/** El aire entre las patas y la piedrita, como fracción del largo de la huella, por lado. */
const HOLGURA = 0.04;
/** El color de la piedrita, un poco más clara que las rocas de los pasillos: es la que hay que mirar. */
export const PIEDRITA_COLOR = 0xa59a8a;

/** Lo que mide el brinco de una llama de tamaño `esc` sobre una piedrita de semieje `a`: su largo y su alto, en píxeles, y dónde van las patas. */
export function medidasSalto(esc: number, a: number): { largo: number; alto: number; centro: number; patas: number; holgura: number } {
  const k = esc * TAM3D;
  const patas = (PATAS[1] - PATAS[0]) * k;
  const holgura = HOLGURA * 74 * k;
  return { largo: (patas + 2 * a + 2 * holgura) / SALTO_CUBRE, alto: SALTO_ALTO * 100 * k, centro: ((PATAS[0] + PATAS[1]) / 2) * k, patas, holgura };
}

/** Lo que necesita la siembra de las piedritas. */
export interface EntradaPiedritas {
  semilla: number;
  zonas: readonly { desde: number; hasta: number; tipo: string }[];
  /** A qué velocidad avanza el grupo en cada zona, en píxeles por segundo, en el mismo orden que `zonas`. */
  velocidades: readonly number[];
  /** El pie de cada fila del grupo (`forma.yPie`), de atrás hacia adelante. */
  filasY: readonly number[];
  /** El tamaño de las llamas del grupo (`forma.esc`). */
  esc: number;
  cuerpo: number;
  /** Cuánto mide el grupo de la primera a la última, en píxeles: la de atrás también tiene que pasar la piedrita antes de que termine el tramo. */
  profundidad: number;
}

/**
 * Una piedrita por fila en cada tramo de piedras, en el medio de la fila y en un lugar de la semilla. Si en esa pantalla el brinco quedaría
 * muy corto o muy largo (en un celular parado las llamas son grandes y van despacio: el brinco duraría más de un segundo), el tramo no lleva.
 * La semilla es la de las rocas, pasada por otra mezcla: las rocas no cambian.
 */
export function sembrarPiedritas(e: EntradaPiedritas): Roca[] {
  if (!e.filasY.length) return [];
  const azar = sembrar((e.semilla ^ 0x2545f491) | 0);
  const k = e.esc * TAM3D;
  const a = (PIEDRITA_LARGO * e.cuerpo) / 2;
  const b = (PIEDRITA_FONDO * 13 * k) / ZC;
  const alto = PIEDRITA_ALTO * 100 * k;
  const salto = medidasSalto(e.esc, a);
  const salida: Roca[] = [];
  e.zonas.forEach((z, i) => {
    if (z.tipo !== "piedras") return;
    const v = e.velocidades[i] ?? 0;
    const aire = v > 0 ? salto.largo / v : Infinity;
    if (aire < SALTO_AIRE[0] || aire > SALTO_AIRE[1]) return;
    const x0 = z.desde + PIEDRITA_DESDE * e.cuerpo, x1 = z.hasta - PIEDRITA_HASTA * e.cuerpo - e.profundidad;
    if (!(x1 > x0)) return;
    e.filasY.forEach((y, fila) => {
      salida.push({ tipo: "piedrita", x: x0 + azar() * (x1 - x0), y, a, b, giro: (azar() * 2 - 1) * 0.3, alto, fila, tramo: i });
    });
  });
  return salida.sort((p, q) => p.x - q.x);
}

/**
 * El brinco de una llama de la fila `fila` cuyo origen está en `x`, con tamaño `esc`: cuánto se levanta y cuánto lleva (de 0 a 1), o null.
 * `omitir` es la piedrita que no salta (la de su tropiezo, si le toca).
 */
export function saltoSobre(piedritas: readonly Roca[], fila: number, x: number, esc: number, omitir = -1): { alza: number; p: number } | null {
  for (let k = 0; k < piedritas.length; k++) {
    const r = piedritas[k] as Roca;
    if (r.fila !== fila || k === omitir) continue;
    const m = medidasSalto(esc, r.a);
    const p = (x + m.centro - (r.x - m.largo / 2)) / m.largo;
    if (p > 0 && p < 1) return { alza: m.alto * Math.sin(Math.PI * p), p };
  }
  return null;
}

/** La caja de las patas de una llama (origen `x`, `y`, tamaño `esc`), en el piso, con la holgura del brinco. */
export function cajaDePatas(x: number, y: number, esc: number): { x0: number; x1: number; y0: number; y1: number } {
  const k = esc * TAM3D;
  const hol = HOLGURA * 74 * k;
  return { x0: x + PATAS[0] * k - hol, x1: x + PATAS[1] * k + hol, y0: y - (13 * k) / ZC, y1: y + (13 * k) / ZC };
}

/** Si las patas de una llama (su caja en el piso) tocan una piedrita, en el piso. */
export function patasSobre(c: { x0: number; x1: number; y0: number; y1: number }, r: Roca): boolean {
  const px = Math.max(c.x0, Math.min(r.x, c.x1)), py = Math.max(c.y0, Math.min(r.y, c.y1));
  return ((px - r.x) / r.a) ** 2 + ((py - r.y) / r.b) ** 2 < 1;
}

/**
 * Tira las piedritas que alguna llama pisa sin estar por encima: la que se echa encima de una, la que todavía viene caminando del portón o
 * la que ya pasa a su carril. Las muestras son las de las trayectorias con los brincos puestos (cuatro números por muestra: x, y, alza, esc).
 * Sacar una piedrita solo saca su brinco: las demás no cambian.
 */
export function descartarPiedritas(piedritas: readonly Roca[], muestras: Map<number, Float64Array>): Roca[] {
  return piedritas.filter((r) => {
    for (const a of muestras.values()) {
      for (let i = 0; i + 3 < a.length; i += 4) {
        const x = a[i] as number;
        if (Math.abs(x - r.x) > r.a + 120 * (a[i + 3] as number)) continue;
        if ((a[i + 2] as number) >= r.alto) continue;
        if (patasSobre(cajaDePatas(x, a[i + 1] as number, a[i + 3] as number), r)) return false;
      }
    }
    return true;
  });
}

/* ------------------------------------------------------------------ el tropiezo */

/** En qué parte de las carreras con tramos de piedras se sortea a quién se le engancha la pata. */
export const TROPIEZO_PROB = 0.6;
/** Lo que alcanza a levantarse la que tropieza, como fracción del alto de la llama del 3D: menos que la piedrita, así que la pata engancha. */
export const TROPIEZO_ALZA = 0.08;
/** Cuánto antes de engancharla empieza el brinco corto, y cuánto dura, en segundos. */
export const TROPIEZO_ANTES = 0.15;
export const TROPIEZO_BRINCO = 0.4;
/** Cuánto dura con la cabeza baja desde que engancha, en segundos (M6 pide el tropiezo de 0,6 a 1 s). */
export const TROPIEZO_CABEZA = 0.75;
/** Desde cuánto antes de engancharla hasta cuánto después lleva su ficha la marca de alerta, en segundos: como la víctima de un obstáculo. */
export const MARCA_TROPIEZO: readonly [number, number] = [0.1, 1.6];
/**
 * Cuánto sale despedida la piedrita hacia el pasillo, en filas, y en cuántos segundos: sale rápido y frena. Con 0,4 s, en 1 de 300
 * carreras con 18 la pata la tapaba un 35,2 % en un cuadro, apenas más que el golpe permitido: con 0,3 s sale antes de quedar debajo.
 */
export const TROPIEZO_RUEDA = 0.5;
export const TROPIEZO_RUEDA_DURA = 0.3;
/** Cuánto tiembla al quedar quieta: dos sacudidas en 0,4 s, en fracción de su largo. */
export const TROPIEZO_TIEMBLA = 0.3;

/** El tropiezo de una carrera: quién, en qué piedrita (su lugar en la lista), cuándo la engancha y hacia qué lado sale (0: tiembla en su lugar). */
export interface Tropiezo {
  quien: number;
  piedrita: number;
  t: number;
  lado: number;
}

/** Un cruce: quién pasa una piedrita corriendo, cuál y cuándo la tocarían sus patas de adelante si no saltara. */
export interface Cruce {
  quien: number;
  piedrita: number;
  t: number;
}

/**
 * Los cruces de las piedritas, sacados de las muestras de las trayectorias con los brincos puestos: para cada llama que salta una piedrita,
 * la muestra anterior a la primera en que la caja de sus patas llega a la piedrita (si tropieza, la piedrita sale despedida justo cuando la
 * pata la alcanza, y no después de tenerla adentro). En orden de hora.
 */
export function crucesDe(piedritas: readonly Roca[], muestras: Map<number, Float64Array>, desde: number, paso: number): Cruce[] {
  const out: Cruce[] = [];
  piedritas.forEach((r, k) => {
    for (const [quien, a] of muestras) {
      for (let i = 0; i + 3 < a.length; i += 4) {
        const x = a[i] as number;
        if (Math.abs(x - r.x) > r.a + 120 * (a[i + 3] as number) || !((a[i + 2] as number) > 0)) continue;
        const c = cajaDePatas(x, a[i + 1] as number, a[i + 3] as number);
        if (c.x1 < r.x - r.a || c.y1 < r.y - r.b || c.y0 > r.y + r.b) continue;
        out.push({ quien, piedrita: k, t: desde + (i / 4 - 1) * paso });
        break;
      }
    }
  });
  return out.sort((p, q) => p.t - q.t || p.quien - q.quien);
}

/** Dónde está la piedrita `indice` en `t`: quieta hasta el tropiezo; después sale despedida hacia el pasillo, frena y tiembla dos veces. */
export function piedritaEn(r: Roca, tropiezo: Tropiezo | null | undefined, indice: number, t: number, altoFila: number): { x: number; y: number; giro: number } {
  if (!tropiezo || tropiezo.piedrita !== indice || t <= tropiezo.t) return { x: r.x, y: r.y, giro: r.giro };
  const s = Math.min(1, (t - tropiezo.t) / TROPIEZO_RUEDA_DURA);
  // Sale rápido y frena: la velocidad baja pareja hasta cero (sin salto de lugar: empieza en su lugar).
  const rueda = 1 - (1 - s) * (1 - s) * (1 - s);
  const quieta = t - tropiezo.t - TROPIEZO_RUEDA_DURA;
  const tiembla = quieta > 0 && quieta < 0.4 ? Math.sin((quieta / 0.4) * Math.PI * 4) * (1 - quieta / 0.4) * TROPIEZO_TIEMBLA * r.a : 0;
  return { x: r.x + tiembla, y: r.y + tropiezo.lado * TROPIEZO_RUEDA * altoFila * rueda, giro: r.giro + tropiezo.lado * 2.5 * rueda };
}

/** Lo que el tropiezo lee del plan: la semilla de las rocas, los tramos, la gente del grupo y cuándo se echa cada una. Nada de la pantalla. */
export interface EntradaTropiezo {
  semilla: number;
  tramos: readonly { t0: number; t1: number; terreno: string }[];
  gente: readonly number[];
  /** Cuándo se echa cada una (Infinity si no se echa). */
  cae: (persona: number) => number;
}

/** Quién tropieza, en qué tramo de piedras (su lugar en los tramos del plan) y hacia qué lado sale la piedrita si va en la línea de su fila. */
export interface VictimaTropiezo {
  quien: number;
  tramo: number;
  lado: number;
}

/**
 * Entre quiénes se sortea el tropiezo: un par (llama, tramo de piedras) por cada llama del grupo que sigue en pie al empezar ese tramo.
 *
 * Con la marcha pareja (`senuelos`, el interruptor `SENUELOS`) se mira al empezar el tramo. Antes se miraba al terminarlo, y entonces la que
 * tropezaba no se echaba en ese tramo: con 18 personas era finalista el 100 % de las veces, contra el 80 % de las que corren al empezar. Si la
 * víctima se echa antes de llegar a su piedrita, no cruza ninguna y no hay tropiezo (`elegirTropiezo`): nunca se muestra a otra. Con
 * `senuelos` en false, la regla de antes, número por número.
 */
export function paresDelTropiezo(e: EntradaTropiezo, senuelos: boolean = SENUELOS): [number, number][] {
  const pares: [number, number][] = [];
  e.tramos.forEach((tr, i) => {
    if (tr.terreno !== "piedras") return;
    const desde = senuelos ? tr.t0 : tr.t1;
    for (const p of e.gente) if (e.cae(p) >= desde) pares.push([p, i]);
  });
  return pares;
}

/**
 * Quién tropieza y en qué tramo de piedras, una vez por ronda: de la semilla y del plan, sin la pantalla y sin mirar quién gana. En 6 de cada
 * 10 carreras con tramos de piedras, un par (llama, tramo) parejo entre `paresDelTropiezo`. La pantalla solo ubica la piedrita: si en ella la
 * víctima no cruza una piedrita en ese tramo (el celular parado no lleva) o la piedrita no tiene adónde salir, esa pantalla no muestra
 * tropiezo, y nunca muestra a otra llama. Antes se elegía entre los cruces de la pantalla, así que con la misma semilla dos pantallas
 * podían mostrar a dos llamas distintas, y cambiar el tamaño de la ventana la volvía a elegir.
 */
export function victimaDelTropiezo(e: EntradaTropiezo, senuelos: boolean = SENUELOS): VictimaTropiezo | null {
  const pares = paresDelTropiezo(e, senuelos);
  if (!pares.length) return null;
  const azar = sembrar((e.semilla ^ 0x7f4a7c15) | 0);
  if (azar() >= TROPIEZO_PROB) return null;
  const [quien, tramo] = pares[Math.min(pares.length - 1, Math.floor(azar() * pares.length))] as [number, number];
  return { quien, tramo, lado: azar() < 0.5 ? 1 : -1 };
}

/**
 * El tropiezo en esta pantalla: el de la víctima del plan (`victimaDelTropiezo`), en la piedrita de su fila de ese tramo de piedras, si la
 * cruza (`cruces`). Si no la cruza, no hay tropiezo: nunca otra llama.
 *
 * La piedrita sale hacia el pasillo de un lado o del otro (el que se aleja de las patas de la víctima, y si no sirve, no hay tropiezo; o
 * el sorteado en el plan si va en la línea de su fila), si en su camino y donde queda no hay una roca y ninguna llama la pisa
 * (`muestras`, a `paso` desde `desde`): mira las patas de todas, menos las de la víctima en su tropezón. Si ningún lado sirve, esa carrera
 * no tiene tropiezo: una piedrita que se queda en el camino la pisaría la misma víctima al reponerse.
 */
export function elegirTropiezo(
  e: { semilla: number; piedritas: readonly Roca[]; rocas: readonly Roca[]; altoFila: number; muestras: Map<number, Float64Array>; desde: number; paso: number; victima: VictimaTropiezo | null },
  cruces: readonly Cruce[],
): Tropiezo | null {
  const v = e.victima;
  if (!v) return null;
  const c = cruces.find((x) => x.quien === v.quien && e.piedritas[x.piedrita]?.tramo === v.tramo);
  if (!c) return null;
  const r = e.piedritas[c.piedrita] as Roca;
  const sorteado = v.lado;
  // Si la víctima corre corrida de la línea de su fila (su subfila), la piedrita sale primero hacia el otro lado: lejos de sus patas.
  const suyas = e.muestras.get(c.quien);
  const iv = Math.round((c.t - e.desde) / e.paso);
  const yv = suyas && iv >= 0 && iv * 4 + 1 < suyas.length ? (suyas[iv * 4 + 1] as number) : r.y;
  const corrida = Math.abs(yv - r.y) > 1e-6;
  const primero = corrida ? -Math.sign(yv - r.y) : sorteado;
  const libre = (lado: number): boolean => {
    const tz: Tropiezo = { ...c, lado };
    // Ninguna roca en su camino ni donde queda.
    for (const f of [0.5, 1]) {
      const y = r.y + lado * TROPIEZO_RUEDA * e.altoFila * f;
      if (e.rocas.some((o) => Math.abs(o.x - r.x) < o.a + r.a * (1 + TROPIEZO_TIEMBLA) + 4 && Math.abs(o.y - y) < o.b + r.b + 4)) return false;
    }
    // Ninguna llama la pisa desde que sale (la víctima, después de su tropezón).
    for (const [quien, a] of e.muestras) {
      for (let i = 0; i + 3 < a.length; i += 4) {
        const t = e.desde + (i / 4) * e.paso;
        if (t <= c.t || (quien === c.quien && t < c.t + TROPIEZO_CABEZA)) continue;
        const x = a[i] as number;
        if (Math.abs(x - r.x) > r.a * 2 + 120 * (a[i + 3] as number)) continue;
        const p = piedritaEn(r, tz, c.piedrita, t, e.altoFila);
        if (patasSobre(cajaDePatas(x, a[i + 1] as number, a[i + 3] as number), { ...r, x: p.x, y: p.y })) return false;
      }
    }
    return true;
  };
  // Hacia la víctima corrida no sale nunca: le pasaría por debajo de las patas mientras se repone.
  const lado = libre(primero) ? primero : !corrida && libre(-primero) ? -primero : 0;
  return lado ? { quien: c.quien, piedrita: c.piedrita, t: c.t, lado } : null;
}

/**
 * Lo que hace la víctima en su tropiezo, a la hora `t`: un brinco corto que no alcanza (la pata engancha la piedrita) y la cabeza baja hasta
 * que se repone. `null` fuera de su ventana. Es función de la hora: empieza y termina en cero, sin salto de lugar ni de alto.
 */
export function enTropiezo(tropiezo: Tropiezo, t: number, esc: number): { alza: number; p: number } | null {
  const t0 = tropiezo.t - TROPIEZO_ANTES, t1 = tropiezo.t + TROPIEZO_CABEZA;
  if (t <= t0 || t >= t1) return null;
  const b = Math.min(1, (t - t0) / TROPIEZO_BRINCO);
  return { alza: TROPIEZO_ALZA * 100 * esc * TAM3D * Math.sin(Math.PI * b), p: (t - t0) / (t1 - t0) };
}
