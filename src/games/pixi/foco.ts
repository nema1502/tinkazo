import type { Arc } from "../drama";

/**
 * El foco: el golpe de quien gana, en tres tiempos.
 *
 * Hasta ahora lo único que separaba a quien gana de los demás era la placa
 * amarilla: había que leerla. El foco hace que la sala lo sepa antes de leer,
 * sin palabras (diseño de los juegos para grupos de hasta 30, sección 7):
 *
 * 1. **El silencio y la penumbra.** Apenas corona, la escena se oscurece y
 *    pierde color; un cono de luz baja sobre quien gana. La música ya venía
 *    cortada (el respiro de `stage.breath`), así que no suena nada.
 * 2. **El golpe.** Una onda sale de la ganadora, giran los rayos, suena la
 *    fanfarria y la escena vuelve a respirar.
 * 3. **El nombre.** Un instante después sube la placa con la cara.
 *
 * Cada arco del director le da su sabor: la remontada, rayos que suben desde
 * el piso; el susto, un latido de más antes de que se encienda; el duelo, la
 * foto (un marco de cámara y un flash); la tapada, el apagón total y la luz
 * que prende sobre quien nadie había nombrado.
 *
 * Todo es una función pura de los **segundos reales** desde que corona y del
 * arco: no hay azar, no hay reloj, no se acumula nada. La misma ronda dibuja el
 * mismo foco cuadro por cuadro, y saltar el show a cualquier momento da lo
 * mismo que llegar mirando. Nada de esto decide nada: el ganador ya cruzó
 * cuando el foco se enciende (nunca antes: sería un delator de cámara).
 */

/** Cuándo golpea y cuándo sale la placa, en segundos reales desde que corona. */
export interface TiemposFoco {
  golpe: number;
  placa: number;
}

const TIEMPOS: Record<Arc, TiemposFoco> = {
  // La remontada es la más rápida: ya viene con el envión.
  remontada: { golpe: 0.5, placa: 0.6 },
  // El susto tarda un latido de más: la sala contiene el aire.
  susto: { golpe: 0.95, placa: 1.05 },
  // El duelo es la foto: el flash y el marco, casi de inmediato.
  duelo: { golpe: 0.55, placa: 0.65 },
  // La tapada se apaga del todo y vuelve a prender.
  tapada: { golpe: 0.85, placa: 0.95 },
};

/** Los tiempos del foco de un arco. Sin arco, los de la remontada. */
export const tiemposFoco = (arco: Arc | undefined): TiemposFoco => TIEMPOS[arco ?? "remontada"] ?? TIEMPOS.remontada;

/**
 * Los latidos del silencio: unos golpes graves y suaves, en segundos reales
 * desde que corona, que le dan cuerpo a la espera. Con el susto y la tapada,
 * dos ("lub-dub"); con la remontada y el duelo, uno. Son lo único que suena
 * entre el corte de la música y el golpe.
 */
export function latidosFoco(arco: Arc | undefined): number[] {
  const { golpe } = tiemposFoco(arco);
  return golpe >= 0.8 ? [golpe - 0.5, golpe - 0.25] : [golpe - 0.27];
}

/** El máximo de oscuridad de cada arco, de 0 a 1: la tapada se apaga del todo. */
const OSCURO_MAX: Record<Arc, number> = { remontada: 0.86, susto: 0.95, duelo: 0.8, tapada: 1 };

/** Cuánto de la oscuridad máxima queda mientras se sostiene el cartel. */
const REPOSO = 0.5;

/** La oscuridad que se dibuja con `oscuro` en 1: el negro tinta, a esta opacidad. */
export const OPACIDAD_OSCURA = 0.7;

export interface EstadoFoco {
  /** Todavía no golpeó: silencio. */
  silencio: boolean;
  /** Cuánto cae la penumbra, de 0 a 1 (por la opacidad `OPACIDAD_OSCURA`). */
  oscuro: number;
  /** La luz sobre quien gana, de 0 a 1. */
  luz: number;
  /** Cuánto bajó el cono desde arriba, de 0 a 1. */
  cono: number;
  /** La onda blanca: de 0 a 1 mientras sale, -1 si no está. */
  onda: number;
  /** La onda del color de quien gana, un poco después. */
  onda2: number;
  /** Los rayos que giran, de 0 a 1, y cuánto giraron. */
  rayos: number;
  giro: number;
  /** Los rayos que suben del piso (la remontada), de 0 a 1. */
  suben: number;
  /** El destello de toda la pantalla, de 0 a 1. */
  destello: number;
  /** El marco de la foto sobre quien gana (el duelo), de 0 a 1. */
  marco: number;
  /** El marco chico sobre la rival, de 0 a 1. */
  marcoRival: number;
  /** El latido de la luz después del golpe: 1 es lo normal. */
  pulso: number;
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const outCubic = (v: number): number => 1 - Math.pow(1 - clamp01(v), 3);
const inOutCubic = (v: number): number => {
  const x = clamp01(v);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
};
const outBack = (v: number): number => {
  const x = clamp01(v) - 1;
  return 1 + 2.2 * x * x * x + 1.2 * x * x;
};
/** Un latido: sube y baja en `dur` segundos desde `t0`. */
const latido = (tr: number, t0: number, dur: number): number => {
  const x = (tr - t0) / dur;
  return x <= 0 || x >= 1 ? 0 : Math.sin(Math.PI * x);
};

export const ESTADO_QUIETO: EstadoFoco = Object.freeze({
  silencio: true, oscuro: 0, luz: 0, cono: 0, onda: -1, onda2: -1, rayos: 0, giro: 0, suben: 0, destello: 0, marco: 0, marcoRival: 0, pulso: 1,
});

/**
 * El foco `tr` segundos reales después de coronar. Antes de coronar (`tr <= 0`)
 * no hay nada.
 */
export function estadoFoco(arco: Arc | undefined, tr: number): EstadoFoco {
  const a: Arc = arco ?? "remontada";
  if (!(tr > 0)) return ESTADO_QUIETO;
  const { golpe } = tiemposFoco(a);
  const dg = tr - golpe;
  const silencio = dg < 0;

  // La penumbra: cae rápido y, con el golpe, se afloja hasta el reposo.
  const caida = outCubic(tr / (a === "tapada" ? 0.14 : 0.28));
  const afloja = inOutCubic(dg / 1.0);
  const oscuro = OSCURO_MAX[a] * caida * (silencio ? 1 : 1 - (1 - REPOSO) * afloja);

  // La luz.
  let luz: number;
  if (a === "tapada") {
    // Apagón total, dos chispazos que no terminan de prender, y recién ahí la luz.
    luz = silencio ? 0.42 * Math.max(latido(tr, 0.3, 0.1), latido(tr, 0.52, 0.12)) : 0.2 + 0.8 * outBack(dg / 0.18);
  } else if (a === "susto") {
    // Un hilo de luz que late dos veces ("lub-dub") y se abre con la exhalación.
    const hilo = 0.22 + 0.1 * Math.max(latido(tr, 0.22, 0.2), latido(tr, 0.5, 0.2));
    luz = silencio ? hilo * outCubic(tr / 0.2) : hilo + (1 - hilo) * outBack(dg / 0.3);
  } else {
    const sube = 0.5 * outCubic((tr - 0.06) / 0.3);
    luz = silencio ? sube : 0.5 + 0.5 * outBack(dg / 0.14);
  }
  if (!silencio) luz = Math.min(1, luz) * (0.88 + 0.12 * (1 - inOutCubic(dg / 0.8)));

  // El cono baja desde arriba; en la tapada, justo antes del golpe.
  const t0 = a === "tapada" ? golpe - 0.32 : 0.04;
  const cono = outCubic((tr - t0) / 0.28);

  // Las ondas.
  const dur = a === "susto" ? 1.1 : a === "duelo" ? 0.5 : 0.8;
  const p1 = dg / dur;
  const p2 = (dg - 0.12) / dur;
  const onda = silencio || p1 >= 1 ? -1 : p1;
  const onda2 = p2 <= 0 || p2 >= 1 ? -1 : p2;

  // Los rayos que giran: entran con el golpe y se quedan a media luz.
  const entra = outCubic(dg / 0.15);
  const peso = a === "duelo" ? 0.3 : a === "susto" ? 1 : 0.9;
  const rayos = silencio ? 0 : entra * peso * (1 - 0.45 * clamp01((dg - 0.4) / 1.2));
  const giro = tr * (a === "susto" ? 0.35 : 0.55);

  // La remontada: los rayos suben desde el piso y se van.
  const suben = a === "remontada" && !silencio ? outCubic(dg / 0.35) * (1 - clamp01((dg - 0.5) / 0.6)) : 0;

  // El destello: el susto lo suelta como una exhalación, el duelo es el flash de la foto.
  const maxD = a === "duelo" ? 1 : a === "susto" ? 0.75 : a === "tapada" ? 0.6 : 0.5;
  const destello = silencio ? 0 : maxD * Math.pow(1 - clamp01(dg / (a === "duelo" ? 0.3 : 0.4)), 2);

  // La foto del duelo: el marco entra de golpe y la rival aparece un instante después.
  const marco = a === "duelo" && !silencio ? clamp01(dg / 0.12) * (1 - clamp01((dg - 1.5) / 0.5)) : 0;
  const marcoRival = a === "duelo" && !silencio ? clamp01((dg - 0.35) / 0.15) * (1 - clamp01((dg - 1.5) / 0.4)) : 0;

  // El latido: la luz respira mientras se sostiene el cartel.
  const pulso = silencio ? 1 : 1 + 0.045 * Math.sin(2 * Math.PI * dg * 1.4) * clamp01(dg / 0.5);

  return { silencio, oscuro, luz, cono, onda, onda2, rayos, giro, suben, destello, marco, marcoRival, pulso };
}

/** Un rectángulo en píxeles de pantalla. */
export interface Caja {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * La penumbra alrededor de un cuadrado de lado `2R` centrado en `(cx, cy)`: las
 * cuatro piezas que cubren el resto de una pantalla de `W` por `H`, sin
 * encimarse (si no, la opacidad se sumaría en el borde) y sin salirse. Las
 * piezas más el cuadrado dan siempre la pantalla entera. El cuadrado va en
 * píxeles enteros para que no queden costuras.
 */
export function piezasDePenumbra(cx: number, cy: number, R: number, W: number, H: number): { hueco: Caja; piezas: Caja[] } {
  const x0 = Math.round(cx - R), y0 = Math.round(cy - R);
  const lado = Math.max(2, Math.round(2 * R));
  const x1 = x0 + lado, y1 = y0 + lado;
  const cx0 = Math.max(0, Math.min(W, x0)), cx1 = Math.max(0, Math.min(W, x1));
  const cy0 = Math.max(0, Math.min(H, y0)), cy1 = Math.max(0, Math.min(H, y1));
  const piezas: Caja[] = [
    { x: 0, y: 0, w: W, h: cy0 },
    { x: 0, y: cy1, w: W, h: H - cy1 },
    { x: 0, y: cy0, w: cx0, h: cy1 - cy0 },
    { x: cx1, y: cy0, w: W - cx1, h: cy1 - cy0 },
  ].filter((p) => p.w > 0 && p.h > 0);
  return { hueco: { x: x0, y: y0, w: lado, h: lado }, piezas };
}

/** Los límites sanos del radio de quien gana en pantalla: ni un punto ni media pantalla. */
export const radioSano = (r: number, W: number, H: number, k: number): number => {
  const lo = 26 * k, hi = Math.min(W, H) * 0.3;
  return Number.isFinite(r) ? Math.max(lo, Math.min(hi, r)) : lo;
};
