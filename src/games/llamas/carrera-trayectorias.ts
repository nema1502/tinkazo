import type { Caminata } from "./carrera-caminata";
import { filaDeRango } from "./carrera-caminata";
import { TAM3D } from "./carrera-3d-mapa";
import { ECHADA_DUR, type Carriles, type Forma } from "./carrera-forma";
import { CARRIL_DURA } from "./carrera-marcha";
import { ENSANCHE } from "./carrera-obstaculos";
import { RECTA } from "./carrera-base";
import { enTropiezo, saltoSobre, type Tropiezo } from "./carrera-piedritas";
import type { Roca } from "./carrera-rocas";
import type { Datos } from "./carrera-show";
import { ABRE_DESDE, deltaSubfila, ECHADA_ABRE, ECHADA_ANTES, FRENADO, medioAncho3D, signosDeSubfila, SUBFILA, umbralSubfila, velocidadAlEcharse, type Signo } from "./carrera-subfilas";
import type { Momento } from "./llama";

/**
 * El lugar de cada llama en el grupo y en la recta, sin Pixi ni three: la misma cuenta que dibuja la escena (`carrera.ts`), sacada a un
 * módulo puro para que la escena, las pruebas y el auditor de sólidos miren exactamente el mismo camino.
 *
 * Es una función de la hora del show: la misma ronda da el mismo lugar llamado directo, avanzando cuadro a cuadro o saltando hacia
 * adelante y hacia atrás. No guarda nada de un cuadro al otro: lo único que guarda es lo que depende de la pantalla (las subfilas y cómo
 * frena cada echada), armado una vez por geometría y rehecho cuando la geometría cambia. Las tandas quedan en la escena: acá entra la
 * carrera desde el corral.
 *
 * Las subfilas: cada llama del grupo corre un poco arriba o un poco abajo de la línea de su fila (`carrera-subfilas.ts`), y dos de una fila
 * que en el plan se juntan van a lados opuestos. La que se echa se abre hacia su propio lado, sin cruzar la otra subfila, y elige cuánto
 * tarda en frenar para quedar quieta donde no toca a nadie.
 */

export interface Posicion {
  x: number;
  y: number;
  esc: number;
  velocidad: number;
  momento: Momento;
  visible: boolean;
  etiquetar?: boolean;
  /** Cuánto se levanta del piso (el salto de la valla), en píxeles. */
  alza?: number;
}

/** La geometría de la pista, en píxeles del mundo 2D. Se lee en cada llamada: puede cambiar con la pantalla. */
export interface GeometriaPista {
  /** Dónde está el frente del grupo parado, en x del mundo. */
  readonly F0: number;
  /** Dónde empieza la recta, en x del mundo. */
  readonly Xs: number;
  /** El ancho de la pantalla, en píxeles (la distancia del plan se mide en anchos). */
  readonly ancho: number;
  /** Cuánto mide un cuerpo en la pantalla, en píxeles. */
  readonly cuerpo: number;
  forma: Pick<Forma, "filas" | "yPie" | "esc" | "altoFila">;
  /** La fila de cada lugar del grupo según el carril (`carrera-filas.ts`); si falta, se usa la fila de siempre. */
  readonly filaDeLugar?: readonly number[];
  carr: Pick<Carriles, "yPie" | "esc" | "altoFila">;
  /** La caminata de las que llegan tarde del portón, si la hay. */
  readonly caminata: Caminata | null;
  /** Las piedritas del tramo de piedras (`carrera-piedritas.ts`): cada llama del grupo salta la de su fila. Sin ellas, nadie salta. */
  readonly piedritas?: readonly Roca[];
  /** El tropiezo de la carrera, si lo hay: a quién se le engancha la pata en su piedrita y cuándo (`elegirTropiezo`). */
  readonly tropiezo?: Tropiezo | null;
  /**
   * Cuánto se corren las subfilas, en medios anchos del cuerpo del 3D (`SUBFILA` si falta). En 0, la carrera de antes: todas en la línea
   * de su fila, la echada alternando de lado entre las de su fila, abierta 0,45 de fila, y frenando con la velocidad del frente en 1,2 s.
   */
  readonly subfila?: number;
}

export interface Trayectorias {
  /** La posición de `persona` en `t`, con su postura: la misma forma que usa la escena. */
  posicion(persona: number, t: number): Posicion;
  /**
   * Dónde está el lugar de `persona` en `t` sin lo que le falta caminar desde el portón: su lugar en el corral hasta la salida y, después, en
   * el grupo o, con la recta abierta, en el frente común de la recta a la altura de su carril. Es lo que mira la caminata para elegir por dónde
   * entra al corral sin tocar a nadie (`carrera-caminata.ts`), y eso se ve antes de la salida: no lee la final (lo que adelanta o se corre
   * cada carril, que se arma alrededor de la ganadora) ni quién se echa.
   */
  sinCaminata(persona: number, t: number): { x: number; y: number };
  /**
   * La x del frente común en `t`, en la pantalla: la del grupo hasta que se abre la recta (quieta antes de la salida) y, después, la del
   * frente de la recta. Lo que se mueve un lugar respecto de ella es lo que mide la prueba del paso del corral al carril.
   */
  frente(t: number): number;
  /** Dónde va quien está en el grupo en `t`, o null si no es del grupo: la línea de su fila más su subfila. */
  lugarEnGrupo(persona: number, t: number): { x: number; y: number } | null;
  /** La fila del grupo de `persona`. */
  filaDe(persona: number): number;
  /**
   * Dónde pisa la finalista del carril `carril` en `t`, ya abierta la recta: entre su fila del grupo y su carril mientras pasa de una al otro,
   * y su carril después, con lo que se corre al costado. Ahí caen las piedras y sale y llega la escupida (`carrera-obstaculos-vista.ts`).
   */
  piso(carril: number, t: number): number;
  /** De qué tamaño se dibuja en `t` la finalista del carril `carril`, ya abierta la recta: el del grupo mientras pasa a su carril, y el del carril después. */
  escEn(carril: number, t: number): number;
  /**
   * Las muestras de todas las personas del grupo y de la recta entre `desde` y `hasta`, cada `paso` segundos: por persona, un arreglo
   * con cuatro números por muestra (x, y, alza, esc), en píxeles del mundo 2D.
   */
  muestras(desde: number, hasta: number, paso: number): Map<number, Float64Array>;
  /** El lado de subfila de `persona`: -1 arriba de la línea de su fila, +1 abajo, 0 sin subfilas. */
  signoDe(persona: number): Signo;
  /** Cuánto se corre cada subfila de la línea de su fila en esta pantalla, en píxeles (0 sin subfilas). */
  delta(): number;
  /** Cuántos segundos tarda en frenar `persona` al echarse (`FRENADOS`). */
  frenadoDe(persona: number): number;
  /** Cuánto se abre la echada desde la línea de su fila en esta pantalla, en píxeles. */
  apertura(): number;
  /**
   * Hasta dónde se corre `persona` desde la línea de su fila al echarse, en píxeles y sin el signo: la apertura si su fila tiene
   * `ABRE_DESDE` o más, y su subfila (no se mueve) si no.
   */
  aperturaDe(persona: number): number;
  /** Por fila, cuánto se corre de su línea hacia arriba y hacia abajo alguna de las que corren en ella: lo que deja libre la siembra de rocas. */
  bandas(): { arriba: number; abajo: number }[];
}

const lerp = (a: number, b: number, k: number): number => a + (b - a) * k;
/** Sin subfilas: cuánto se abre al costado la que se va a echar, como fracción de la fila. La de atrás le pasa al lado. */
export const ECHADA_COSTADO = 0.45;
/** Cuándo empieza a abrirse la echada y cuánto tarda (`carrera-subfilas.ts`, que las mira para elegir los lados). */
export { ECHADA_ABRE, ECHADA_ANTES };
/**
 * Los frenados que puede elegir la echada, en segundos, del de siempre al más largo: sale con su propia velocidad y frena parejo, así que
 * no hay salto de velocidad. Más largo es frenar más suave y quedar quieta un poco más adelante. Nunca más corto que el de siempre.
 */
export const FRENADOS: readonly number[] = [FRENADO, 1.6, 2.0, 2.4];
/**
 * Cuánto pasa al lado de la echada la de su misma subfila: sus cajas quedan a esta fracción de dos medios anchos, así que como mucho se
 * rozan un 8 %. Lo mismo la echada contra la subfila más cercana de la fila vecina.
 */
export const PASA = 0.92;
/** Cuánto se encima, como mucho, una echada al elegir su frenado: con más que esto (la huella del 3D) la opción toca a alguien. */
const TOCA = 0.05;
/** Cuántos segundos después de echarse se mira si la echada toca a alguien al elegir su frenado. */
const VENTANA_FRENO = 8;
/** Cada cuánto se mira, al elegir el frenado. */
const PASO_FRENO = 0.1;
const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
/** Una subida suave de 0 a 1 (de quinto grado): continua en la velocidad y en la aceleración. */
const suave5 = (v: number): number => {
  const x = clamp01(v);
  return x * x * x * (x * (6 * x - 15) + 10);
};

/**
 * Cuánto se abre la echada desde la línea de su fila, en píxeles. Sin subfilas, 0,45 de fila, como siempre. Con subfilas, lo justo para
 * que la de su misma subfila pase al lado (δ más casi dos medios anchos), sin acercarse a la subfila más cercana de la fila vecina, y
 * repartiendo el aire por igual entre la de su subfila y la costura con la fila vecina cuando la fila es ancha: así, en el proyector y en
 * el escritorio, dos echadas de filas vecinas abiertas una hacia la otra tampoco se tocan.
 */
export function aperturaEchada(esc: number, altoFila: number, subfila: number = SUBFILA): number {
  if (!subfila) return ECHADA_COSTADO * altoFila;
  const dos = 2 * medioAncho3D(esc);
  const dl = deltaSubfila(esc, subfila);
  return Math.min(altoFila - dl - PASA * dos, Math.max(dl + PASA * dos, (altoFila + dl) / 3));
}

/** Si dos echadas de filas vecinas, abiertas una hacia la otra, se tocarían: la fila es angosta para las dos aperturas. */
export function costurasJuntas(esc: number, altoFila: number, subfila: number = SUBFILA): boolean {
  return subfila > 0 && altoFila - 2 * aperturaEchada(esc, altoFila, subfila) < PASA * 2 * medioAncho3D(esc);
}

/** Las subfilas de una pantalla: cuánto se corren, cuánto se abre la echada y el lado de cada una. */
export interface SubfilasDePantalla {
  delta: number;
  apertura: number;
  signo: Map<number, Signo>;
}

/**
 * Las subfilas de una pantalla, puras: el corrimiento, la apertura de la echada y el signo de cada una (`signosDeSubfila`, con las
 * costuras si la fila es angosta). Lo usan las trayectorias y la caminata de las tandas (`carrera-caminata-datos.ts`).
 */
export function subfilasDe(d: Datos, forma: Pick<Forma, "esc" | "altoFila">, filaDe: (persona: number) => number, cuerpo: number, subfila: number = SUBFILA): SubfilasDePantalla {
  return {
    delta: deltaSubfila(forma.esc, subfila),
    apertura: aperturaEchada(forma.esc, forma.altoFila, subfila),
    // Las costuras solo importan si la fila es angosta para dos aperturas (y solo entre filas que se abren: `ABRE_DESDE`).
    signo: signosDeSubfila(d, filaDe, umbralSubfila(forma.esc, cuerpo), subfila, { costuras: costurasJuntas(forma.esc, forma.altoFila, subfila) }),
  };
}

/** La caja en el piso de la huella del 3D de una llama en (`x`, `y`) de tamaño `esc`. */
interface Caja {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}
const cajaDe = (x: number, y: number, esc: number): Caja => {
  const m = medioAncho3D(esc);
  return { x0: x - 36 * esc * TAM3D, x1: x + 38 * esc * TAM3D, y0: y - m, y1: y + m };
};
/** Cuánto se enciman dos cajas: el área común sobre el área de la más chica. */
const encimadas = (a: Caja, b: Caja): number => {
  const dx = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
  const dy = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  if (dx <= 0 || dy <= 0) return 0;
  return (dx * dy) / Math.min((a.x1 - a.x0) * (a.y1 - a.y0), (b.x1 - b.x0) * (b.y1 - b.y0));
};

/** Lo armado para una geometría: cambia con la pantalla, nunca con la hora. */
interface Preparado {
  forma: GeometriaPista["forma"];
  filaDeLugar: readonly number[] | undefined;
  cuerpo: number;
  carr: GeometriaPista["carr"];
  subfila: number;
  F0: number;
  Xs: number;
  ancho: number;
  delta: number;
  apertura: number;
  signo: Map<number, Signo>;
  /** El lado al que se abre cada echada: con subfilas, su signo. */
  lado: Map<number, number>;
  /** Las que se abren al echarse: sin subfilas, todas; con subfilas, las de filas de `ABRE_DESDE` o más. */
  seAbre: Set<number>;
  /** Cuánto tarda en frenar cada echada. */
  frenado: Map<number, number>;
}

/**
 * Lo armado por ronda, para las últimas geometrías: dos trayectorias de la misma ronda con la misma geometría (la escena y una prueba, o
 * varias pruebas) lo arman una sola vez. Las claves son los objetos de la geometría y sus números: la escena los rehace al cambiar de pantalla.
 */
const preparados = new WeakMap<object, Preparado[]>();
/** Cuántas geometrías por ronda se guardan. */
const PREPARADOS_MAX = 4;

export function crearTrayectorias(d: Datos, geo: GeometriaPista): Trayectorias {
  const genteSet = new Set(d.gente);
  const carrilDe = new Map<number, number>();
  d.lanes.forEach((p, k) => carrilDe.set(p, k));
  const caeDe = (p: number): number => d.tiempos.cae.get(p) ?? Infinity;
  /** Dónde está el frente del grupo (el origen de la primera) en el mundo. */
  const xFrente = (t: number): number => geo.F0 + d.dist(Math.min(t, d.tAbre)) * geo.ancho;
  const filaDe = (persona: number): number => geo.filaDeLugar?.[d.orden.rango(persona)] ?? filaDeRango(d.orden.rango(persona), geo.forma.filas);

  let prep: Preparado | null = null;
  /**
   * Lo que depende de la pantalla, armado una vez por geometría: si la forma, las filas, el cuerpo, los carriles o dónde están el frente
   * y la recta cambian, se rehace.
   */
  function preparar(): Preparado {
    const forma = geo.forma, filaDeLugar = geo.filaDeLugar, cuerpo = geo.cuerpo, carr = geo.carr, subfila = geo.subfila ?? SUBFILA;
    const F0 = geo.F0, Xs = geo.Xs, ancho = geo.ancho;
    const igual = (x: Preparado): boolean => x.forma === forma && x.filaDeLugar === filaDeLugar && x.cuerpo === cuerpo && x.carr === carr && x.subfila === subfila && x.F0 === F0 && x.Xs === Xs && x.ancho === ancho;
    if (prep && igual(prep)) return prep;
    const lista = preparados.get(d) ?? [];
    const ya = lista.find(igual);
    if (ya) return (prep = ya);
    const s = subfilasDe(d, forma, filaDe, cuerpo, subfila);
    const lado = new Map<number, number>();
    const seAbre = new Set<number>();
    if (subfila > 0) {
      for (const [p, v] of s.signo) lado.set(p, v);
      const enFila = new Map<number, number>();
      for (const p of d.gente) enFila.set(filaDe(p), (enFila.get(filaDe(p)) ?? 0) + 1);
      for (const p of d.gente) if ((enFila.get(filaDe(p)) ?? 0) >= ABRE_DESDE) seAbre.add(p);
    } else {
      for (const p of d.gente) seAbre.add(p);
      // Sin subfilas, el lado de siempre: alterna entre las que se echan de la misma fila, en el orden en que quedan echadas a lo largo de
      // la pista, para que dos que se echan una detrás de la otra no terminen en el mismo costado; en la última fila la primera va hacia
      // adelante, que es su afuera.
      const porFila = new Map<number, number[]>();
      for (const p of d.gente) {
        const f = filaDe(p);
        const miembros = porFila.get(f) ?? [];
        miembros.push(p);
        porFila.set(f, miembros);
      }
      const xCae = (p: number): number => xFrente(Math.min(caeDe(p), d.tAbre)) + d.orden.puntaje(p, Math.max(d.tSalida, Math.min(caeDe(p), d.tAbre))) * cuerpo;
      for (const [f, miembros] of porFila) {
        const seEchan = miembros.filter((p) => caeDe(p) < Infinity).sort((a, b) => xCae(a) - xCae(b));
        seEchan.forEach((p, k) => lado.set(p, f === forma.filas - 1 ? (k % 2 === 0 ? 1 : -1) : k % 2 === 0 ? -1 : 1));
      }
    }
    const nuevo: Preparado = { forma, filaDeLugar, cuerpo, carr, subfila, F0, Xs, ancho, delta: s.delta, apertura: s.apertura, signo: s.signo, lado, seAbre, frenado: new Map() };
    // Queda guardado antes de elegir los frenados: lo que se calcula mientras tanto (la caminata, que pide los lugares del corral) ya lo ve.
    prep = nuevo;
    lista.push(nuevo);
    if (lista.length > PREPARADOS_MAX) lista.shift();
    preparados.set(d, lista);
    if (subfila > 0) elegirFrenados(nuevo);
    return nuevo;
  }

  function lugarEnGrupo(persona: number, t: number): { x: number; y: number } | null {
    if (!genteSet.has(persona)) return null;
    const pr = preparar();
    const tt = Math.max(d.tSalida, Math.min(t, d.tAbre));
    return { x: xFrente(tt) + d.orden.puntaje(persona, tt) * geo.cuerpo, y: geo.forma.yPie(filaDe(persona)) + (pr.signo.get(persona) ?? 0) * pr.delta };
  }

  /** El paso de las filas del grupo a los carriles de la recta. */
  const fraccionMovida = (t: number): number => suave5((t - d.tCarriles) / CARRIL_DURA);

  /**
   * Cuánto se corre al costado `persona` en `t` porque se va a echar (o ya se echó), desde donde va en su subfila: empieza antes de
   * echarse, dura 1,7 s con la subida suave, y la que viene atrás en su subfila le pasa al lado sin tocarla. Con subfilas se abre hacia su
   * propio lado y nunca cruza la otra subfila; en una fila de dos o menos nadie corre en su subfila, y se echa ahí mismo.
   */
  const corrimientoEchada = (pr: Preparado, persona: number, t: number): number => {
    const cae = caeDe(persona);
    if (t < cae - ECHADA_ANTES) return 0;
    const desde = (pr.signo.get(persona) ?? 0) * pr.delta;
    const hasta = (pr.lado.get(persona) ?? 1) * (pr.seAbre.has(persona) ? pr.apertura : pr.delta);
    return (hasta - desde) * suave5((t - (cae - ECHADA_ANTES)) / ECHADA_ABRE);
  };

  /**
   * La posición de `persona` en `t`. Con `completa` en false, sin los brincos ni el tropiezo de las piedritas (que salen de las rocas, que
   * a su vez se siembran mirando estas posiciones) y sin la caminata del portón: es lo que mira la echada al elegir su frenado.
   */
  function posicionEn(persona: number, t: number, completa: boolean): Posicion {
    const pr = preparar();
    const cae = caeDe(persona);
    const carril = carrilDe.get(persona) ?? -1;
    const corriendo: Momento = null;
    // Antes de la salida: en el corral, quietas, en el orden de salida.
    if (t < d.tSalida) {
      const lg = lugarEnGrupo(persona, d.tSalida) ?? { x: geo.F0, y: geo.forma.yPie(0) };
      return { x: lg.x, y: lg.y, esc: geo.forma.esc, velocidad: 0.35, momento: corriendo, visible: true };
    }
    // Echada: frena parejo desde su velocidad y queda quieta, abierta hacia su lado: el grupo la rodea y la deja atrás.
    if (t >= cae) {
      const lg = lugarEnGrupo(persona, cae) ?? { x: geo.F0, y: geo.forma.yPie(0) };
      const s = t - cae;
      const T = pr.subfila > 0 ? (pr.frenado.get(persona) ?? FRENADO) : FRENADO;
      // Con subfilas sale con su propia velocidad (la del frente más la de su puntaje); sin ellas, con la del frente, como antes.
      const v0 = pr.subfila > 0 ? velocidadAlEcharse(d, persona, cae) * geo.cuerpo : (xFrente(cae) - xFrente(cae - 0.1)) / 0.1;
      const sd = Math.min(s, T);
      const desliza = v0 * (sd - (sd * sd) / (2 * T));
      return { x: lg.x + desliza, y: lg.y + corrimientoEchada(pr, persona, t), esc: geo.forma.esc, velocidad: 0, momento: { kind: "echada", p: s / ECHADA_DUR }, visible: true };
    }
    // Las últimas en pasar por el portón terminan de entrar al corral en los primeros segundos del grupo: lo que les falta se suma a su lugar.
    // Al elegir los frenados no se mira la caminata: la caminata pide los lugares del corral, y así la elección es la misma la arme quien la arme.
    const tarde = completa && d.tandas.length && t < cae ? geo.caminata : null;
    const w = tarde && t < tarde.llega(persona) ? tarde.en(persona, t) : null;
    const c = w ? lugarEnGrupo(persona, d.tSalida) : null;
    const falta = w && c ? { x: w.x - c.x, y: w.y - c.y } : null;
    if (t < d.tAbre || carril < 0) {
      const lg = lugarEnGrupo(persona, t) ?? { x: geo.F0, y: geo.forma.yPie(0) };
      const desp = corrimientoEchada(pr, persona, t);
      if (w && falta) return { x: lg.x + falta.x, y: lg.y + desp + falta.y, esc: w.esc, velocidad: w.camina ? 1.4 : 1, momento: w.camina ? { kind: "trote", p: w.avance } : corriendo, visible: true };
      // Las finalistas empiezan a pasar a su carril un poco antes de abrirse la recta.
      const e0 = carril >= 0 ? fraccionMovida(t) : 0;
      if (e0 > 0) return { x: lg.x, y: lerp(lg.y + desp, geo.carr.yPie(carril), e0), esc: lerp(geo.forma.esc, geo.carr.esc, e0), velocidad: 1, momento: corriendo, visible: true };
      if (completa) {
        // La que tropieza: un brinco que no alcanza y la cabeza baja, sin perder lugar. Esa piedrita no la salta.
        const tz = geo.tropiezo;
        const suya = tz && tz.quien === persona ? tz : null;
        const tropezon = suya ? enTropiezo(suya, t, geo.forma.esc) : null;
        if (tropezon) return { x: lg.x, y: lg.y + desp, esc: geo.forma.esc, velocidad: 1, momento: { kind: "malsalto", p: tropezon.p }, visible: true, alza: tropezon.alza };
        // La piedrita de su fila: la salta de un brinco corto, con las patas por encima. Es función del lugar y nada más.
        const brinco = geo.piedritas?.length ? saltoSobre(geo.piedritas, filaDe(persona), lg.x, geo.forma.esc, suya ? suya.piedrita : -1) : null;
        if (brinco) return { x: lg.x, y: lg.y + desp, esc: geo.forma.esc, velocidad: 1, momento: { kind: "salto", p: brinco.p }, visible: true, alza: brinco.alza };
      }
      return { x: lg.x, y: lg.y + desp, esc: geo.forma.esc, velocidad: 1, momento: corriendo, visible: true };
    }
    // La recta: de la forma del grupo a su carril, sin frenar.
    const qq = d.q(t);
    const pq = d.final.pos(carril, qq);
    const xl = geo.Xs + (qq + (pq - qq) * ENSANCHE) * RECTA * geo.ancho;
    const yl = geo.carr.yPie(carril) + (d.final.lateral?.(carril, qq) ?? 0) * geo.carr.altoFila;
    const alza = (d.final.salto?.(carril, qq) ?? 0) * geo.carr.altoFila;
    const e = fraccionMovida(t);
    const m = d.final.beatOf(carril, qq);
    const lg = lugarEnGrupo(persona, d.tAbre) ?? { x: xl, y: yl };
    if (w && falta) return { x: xl + falta.x, y: lerp(lg.y, yl, e) + falta.y, esc: w.esc + lerp(geo.forma.esc, geo.carr.esc, e) - geo.forma.esc, velocidad: w.camina ? 1.4 : 1.1, momento: w.camina ? { kind: "trote", p: w.avance } : m, visible: true, alza };
    return { x: xl, y: lerp(lg.y, yl, e), esc: lerp(geo.forma.esc, geo.carr.esc, e), velocidad: e >= 1 ? (m?.kind === "plantada" ? 0 : 1.2) : 1.1, momento: m, visible: true, alza };
  }

  /**
   * El frenado de cada echada, una vez por geometría y en el orden en que se echan: la primera de `FRENADOS` con la que, desde que empieza a
   * abrirse hasta `VENTANA_FRENO` s después de echarse, no toca a ninguna que corre ni a ninguna echada que ya eligió. Si ninguna queda
   * libre, la que toca menos veces (y entre esas, la más corta). Mira la huella del 3D cada `PASO_FRENO` s.
   */
  function elegirFrenados(pr: Preparado): void {
    const caen = d.gente.filter((p) => Number.isFinite(caeDe(p))).sort((a, b) => caeDe(a) - caeDe(b) || a - b);
    if (!caen.length) return;
    const personas = [...new Set([...d.gente, ...d.lanes])];
    const decidida = new Set<number>();
    const tFin = Math.max(d.tAbre, d.tCarriles + CARRIL_DURA);
    // Las posiciones de las demás en la grilla, guardadas: mientras corre, nadie depende de los frenados; echada, solo se mira a la que ya eligió.
    const guardadas = new Map<number, Map<number, Caja>>();
    const cajaEn = (q: number, i: number): Caja => {
      let porHora = guardadas.get(q);
      if (!porHora) guardadas.set(q, (porHora = new Map()));
      let c = porHora.get(i);
      if (!c) {
        const pos = posicionEn(q, d.tSalida + i * PASO_FRENO, false);
        c = cajaDe(pos.x, pos.y, pos.esc);
        porHora.set(i, c);
      }
      return c;
    };
    const filaDeP = new Map(d.gente.map((p) => [p, filaDe(p)] as const));
    for (const p of caen) {
      const cae = caeDe(p);
      const i0 = Math.max(0, Math.ceil((cae - ECHADA_ANTES - d.tSalida) / PASO_FRENO - 1e-9));
      const i1 = Math.floor((Math.min(cae + VENTANA_FRENO, tFin) - d.tSalida) / PASO_FRENO + 1e-9);
      // Solo pueden tocarla las de su fila y las de las vecinas, y las finalistas que pasan a sus carriles.
      const fp = filaDeP.get(p) as number;
      const cerca = personas.filter((q) => q !== p && (d.lanes.includes(q) || Math.abs((filaDeP.get(q) ?? -9) - fp) <= 1));
      let mejor = FRENADOS[0] as number;
      let menos = Infinity;
      for (const T of FRENADOS) {
        pr.frenado.set(p, T);
        let toca = 0;
        for (let i = i0; i <= i1; i++) {
          const t = d.tSalida + i * PASO_FRENO;
          const pos = posicionEn(p, t, false);
          const a = cajaDe(pos.x, pos.y, pos.esc);
          for (const q of cerca) {
            if (caeDe(q) <= t && !decidida.has(q)) continue;
            const b = cajaEn(q, i);
            if (b.x1 < a.x0 || b.x0 > a.x1) continue;
            if (encimadas(a, b) > TOCA) toca++;
          }
        }
        if (toca < menos) {
          menos = toca;
          mejor = T;
        }
        if (toca === 0) break;
      }
      pr.frenado.set(p, mejor);
      decidida.add(p);
    }
  }

  const posicion = (persona: number, t: number): Posicion => posicionEn(persona, t, true);

  return {
    posicion,
    sinCaminata(persona, t) {
      // Lo que se elige con esto se ve antes de la salida: nada sale de la final (que se arma alrededor de la ganadora) ni de quién se echa.
      // Con la recta abierta, el frente común de la recta y la y de su carril, sin lo que cada carril adelanta ni se corre en la final.
      const lg = lugarEnGrupo(persona, t) ?? { x: geo.F0, y: geo.forma.yPie(0) };
      const carril = carrilDe.get(persona) ?? -1;
      if (t < d.tAbre || carril < 0) return lg;
      return { x: lg.x + d.q(t) * RECTA * geo.ancho, y: lerp(lg.y, geo.carr.yPie(carril), fraccionMovida(t)) };
    },
    frente: (t) => (t < d.tAbre ? xFrente(Math.max(d.tSalida, t)) : geo.Xs + d.q(t) * RECTA * geo.ancho),
    lugarEnGrupo,
    filaDe,
    piso(carril, t) {
      // La misma cuenta que `y` en `posicion` para la recta.
      const tt = Math.max(t, d.tAbre);
      const yl = geo.carr.yPie(carril) + (d.final.lateral?.(carril, d.q(tt)) ?? 0) * geo.carr.altoFila;
      const lg = lugarEnGrupo(d.lanes[carril] as number, d.tAbre);
      return lg ? lerp(lg.y, yl, fraccionMovida(tt)) : yl;
    },
    escEn(carril, t) {
      // La misma cuenta que `esc` en `posicion` para la recta.
      return lerp(geo.forma.esc, geo.carr.esc, fraccionMovida(Math.max(t, d.tAbre)));
    },
    muestras(desde, hasta, paso) {
      const n = Math.max(0, Math.floor((hasta - desde) / paso + 1e-9) + 1);
      const salida = new Map<number, Float64Array>();
      const personas = new Set<number>([...d.gente, ...d.lanes]);
      for (const p of personas) {
        const a = new Float64Array(n * 4);
        for (let i = 0; i < n; i++) {
          const pos = posicion(p, desde + i * paso);
          a[i * 4] = pos.x;
          a[i * 4 + 1] = pos.y;
          a[i * 4 + 2] = pos.alza ?? 0;
          a[i * 4 + 3] = pos.esc;
        }
        salida.set(p, a);
      }
      return salida;
    },
    signoDe: (persona) => preparar().signo.get(persona) ?? 0,
    delta: () => preparar().delta,
    frenadoDe: (persona) => preparar().frenado.get(persona) ?? FRENADO,
    apertura: () => preparar().apertura,
    aperturaDe: (persona) => {
      const pr = preparar();
      return pr.seAbre.has(persona) ? pr.apertura : pr.delta;
    },
    bandas() {
      const pr = preparar();
      const out = Array.from({ length: geo.forma.filas }, () => ({ arriba: 0, abajo: 0 }));
      for (const p of d.gente) {
        const s = pr.signo.get(p) ?? 0;
        const b = out[filaDe(p)];
        if (!b || s === 0) continue;
        if (s < 0) b.arriba = pr.delta;
        else b.abajo = pr.delta;
      }
      return out;
    },
  };
}
