import { sembrar } from "../pixi/kit/azar";
import { planoSobre } from "../pixi/kit/director";
import { PRIORIDAD } from "../pixi/kit/guion";
import type { Caja, Contexto, FocoPunto, Kit, LineaGuion, Momentos, Plan, Respuestas, TipoPaso, Toma, Vista, Zona } from "../pixi/kit/tipos";
import { crearOrden, type Orden } from "./carrera-orden";
import { DUR_FINAL, FIJOS, FINALISTAS, PELOTON_MAX, RECTA, TARJETA, T_NOMBRES, T_VUELO, alfabetico, barajar, corto } from "./carrera-base";
import { CIERRE_TRAMO, ESP_MIN, armarTiempos, duracionGrupo, type Terreno, type Tiempos, type Tramo } from "./carrera-tiempos";
import { ENTRE_FINAL, armarTandas, tandasPara, type Tanda } from "./carrera-tandas";
import { duracionNominal, grupoDe, normalDe, tSalidaDe } from "./carrera-duracion";

export { DUR_FINAL, FIJOS, FINALISTAS, PELOTON_MAX, RECTA, TARJETA, T_NOMBRES, T_VUELO, alfabetico, corto, duracionNominal, grupoDe, normalDe, tSalidaDe };
import { planRace, type Plan as PlanFinal } from "./plan";

/**
 * El show de la carrera, puro: la salida, el grupo que se va echando, la recta
 * final y lo que dice el relator, todo en función de la hora.
 *
 * Es una sola carrera, de izquierda a derecha, hacia la meta:
 *
 * 1. **El vuelo** (3 s): la cámara va de la meta a la salida, y se ve el camino.
 * 2. **Los nombres** (3 s): todos, enteros y en orden alfabético, en el corral.
 * 3. **La salida**: el grupo corre, la punta cambia de dueña y de a una se van
 *    echando (`carrera-tiempos.ts`, `carrera-orden.ts`). Un terreno cada tramo.
 * 4. **La recta**: quedan las ocho de la final, que entran sin frenar en el
 *    orden de `planRace` y corren en carriles hasta la meta.
 *
 * Nada de esto decide quién gana: la final la sortea `planRace` (la historia
 * del director de emoción) y el grupo no mira a nadie (`carrera-orden.ts`).
 */

/** Cuánto se mueve el frente del grupo en cada terreno, en anchos de pantalla por segundo. */
export const VELOCIDAD: Record<Terreno, number> = { cuesta: 0.085, barro: 0.07, piedras: 0.095, viento: 0.105 };
const LENTO = 0.4;
/** Desde qué fracción de la cinta la meta entra entera en el plano. */
export const META_ENTERA = 0.8;
/** Desde qué fracción de la final se mira a las de adelante. */
const TENSION = 0.55;
/** Cuánto de la cinta ocupan las tandas, si las hay: el primer tramo. */
const CINTA_TANDAS = 0.14;

const suave = (v: number): number => {
  const x = Math.max(0, Math.min(1, v));
  return x * x * (3 - 2 * x);
};

/* ------------------------------------------------------------------ el plan */

export type FaseCarrera = "vuelo" | "nombres" | "tandas" | "grupo" | "recta" | "fin";

export interface Segmento {
  tipo: "tandas" | "tramo" | "recta";
  terreno?: Terreno;
  /** Dónde empieza y dónde termina en la cinta, de 0 a 1. */
  f0: number;
  f1: number;
}

export interface Suceso {
  desde: number;
  tipo: TipoPaso;
  quien?: number;
}

/** Lo que la escena le pide a la cámara: es lo único que el show no sabe de la pantalla. */
export interface EscenaCarrera {
  vistaPresentacion(t: number): Vista;
  vistaGrupo(t: number): Vista;
  cajaCarriles(t: number): Caja;
  cajasDelFrente(t: number): Caja[];
  caja(t: number): Caja | null;
  /** Donde se ve la carrera: debajo del marcador y de la cinta, encima del relator. */
  zona(): Zona;
  meta(): Caja;
  foco(): FocoPunto;
  protegida(): { caja: Caja; zona: Zona } | null;
}

export interface Datos {
  n: number;
  names: string[];
  cortos: string[];
  final: PlanFinal;
  /** Los índices de las ocho de la final, por carril. */
  lanes: number[];
  /** Las que salen del corral, en el orden de la fila de salida. */
  gente: number[];
  tiempos: Tiempos;
  orden: Orden;
  tVuelo: number;
  tNombres: number;
  tSalida: number;
  tAbre: number;
  tCrown: number;
  tramos: Tramo[];
  /** Avance del frente en anchos de pantalla desde la salida. */
  dist(t: number): number;
  distAbre: number;
  /** Lo que mide el camino de la salida a la meta, en anchos de pantalla. */
  total: number;
  /** La fracción de la recta final que se corrió en `t` (0 a 1), con la cámara lenta de la foto. */
  q(t: number): number;
  /** El momento de la recta en que pasa la fracción `q`. */
  tDeQ(q: number): number;
  /** La fracción de la cinta en que va el frente en `t`. */
  frac(t: number): number;
  cinta: Segmento[];
  /** Cuándo la meta entra entera en el plano. */
  t80: number;
  /** La primera en `t` (índice en la lista). */
  lider(t: number): number;
  /** Las que siguen en el grupo en `t`, de la primera a la última. */
  vivas(t: number): number[];
  campeona: number;
  fase(t: number): FaseCarrera;
  sucesos: Suceso[];
  cambiosDePunta: { t: number; quien: number }[];
  /** Las tandas, si hay más de 30 (vacío si no). */
  tandas: Tanda[];
  /** La tanda que corre en `t` (-1 si no hay, o si todavía no empezó o ya terminaron). */
  tanda(t: number): number;
  /** Cuándo el relator dice quién va adelante (un cambio de punta o, si no entró ninguno en un tramo, quien va primero). */
  lineasAdelante: number[];
}

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

export function planCarrera(ctx: Contexto): Plan<Datos> {
  const names = ctx.nombres;
  const n = names.length;
  const campeona = ctx.ganadores[0] ?? 0;
  // La final: la historia del director de emoción, con el azar de la ronda como siempre.
  const final = planRace(names, campeona, ctx.rng, { sceneryDraws: Math.min(8, n) + 24 * 2 + 18 * 2 + 6 * 4 + 60 * 3, co: ctx.ganadores.slice(1) });
  const lanes = final.lanes;
  const arco = final.story.arc;
  const cortos = names.map(corto);
  const rngGrupo = sembrar(Math.floor(ctx.azar("carrera:grupo") * 4294967296));

  /* ------------------------------------------------------- quién corre el grupo */
  const esFinal = new Set(lanes);
  const conTandas = n > PELOTON_MAX;
  const tand = conTandas ? armarTandas({ n, nombres: names, finalistas: lanes, t0: T_VUELO, rng: sembrar(Math.floor(ctx.azar("carrera:tandas") * 4294967296)) }) : null;
  const tandas = tand?.tandas ?? [];
  let gente: number[];
  let fila: number[];
  if (tand) {
    gente = tand.gente;
    fila = barajar(tand.gente.filter((i) => !esFinal.has(i)), rngGrupo);
  } else {
    const otras = barajar(names.map((_, i) => i).filter((i) => !esFinal.has(i)), rngGrupo);
    const cuantas = grupoDe(n);
    fila = otras.slice(0, Math.max(0, cuantas - lanes.length));
    gente = cuantas > 0 ? barajar([...lanes, ...fila], rngGrupo) : [...lanes];
  }

  /* -------------------------------------------------------------- los tiempos */
  const tVuelo = T_VUELO;
  const tSalida = tand ? tand.tFin + ENTRE_FINAL : tSalidaDe(n);
  const tNombres = tSalida;
  const tiempos = armarTiempos({ t0: tSalida, fila, total: gente.length, rng: rngGrupo });
  const tAbre = tiempos.abre;
  const tConv = tiempos.echadas.length ? tiempos.ultima + 0.3 : tSalida;

  // La recta: nominalmente DUR_FINAL; en el duelo, la llegada en cámara lenta desde la foto.
  const foto = Math.min(1, final.foto);
  const tDeQ = (q: number): number => (q <= foto ? tAbre + q * DUR_FINAL : tAbre + foto * DUR_FINAL + ((q - foto) * DUR_FINAL) / LENTO);
  const q = (t: number): number => {
    const s = t - tAbre;
    if (s <= 0) return 0;
    const sf = foto * DUR_FINAL;
    return Math.min(1, s <= sf ? s / DUR_FINAL : foto + ((s - sf) * LENTO) / DUR_FINAL);
  };
  const tCrown = tDeQ(1);

  /* --------------------------------------------------------------- el orden */
  const entrada = lanes.map((_, k) => k).sort((a, b) => final.pos(b, 0.067) - final.pos(a, 0.067) || a - b).map((k) => lanes[k] as number);
  const orden = crearOrden({
    gente, cae: (i) => tiempos.cae.get(i) ?? Infinity, finalistas: lanes, entrada, t0: tSalida, tConv, tAbre,
    rng: sembrar(Math.floor(ctx.azar("carrera:orden") * 4294967296)),
  });

  /* ---------------------------------------------------------------- distancia */
  const PASO = 0.05;
  const tramos = tiempos.tramos;
  const velEn = (t: number): number => {
    if (t <= tSalida) return 0;
    let v = tramos.length ? VELOCIDAD[(tramos[tramos.length - 1] as Tramo).terreno] : 0.1;
    for (let i = 0; i < tramos.length; i++) {
      const tr = tramos[i] as Tramo;
      if (t < tr.t1) {
        v = VELOCIDAD[tr.terreno];
        // Entre un terreno y el siguiente la velocidad cambia despacio, no de golpe.
        const sig = tramos[i + 1];
        if (sig) v += (VELOCIDAD[sig.terreno] - v) * suave((t - (tr.t1 - 0.5)) / 1);
        break;
      }
    }
    return v * suave((t - tSalida) / 1.4);
  };
  const pasos = Math.ceil(tAbre / PASO) + 1;
  const acum: number[] = new Array<number>(pasos + 1).fill(0);
  for (let i = 1; i <= pasos; i++) acum[i] = (acum[i - 1] as number) + 0.5 * (velEn((i - 1) * PASO) + velEn(i * PASO)) * PASO;
  const distGrupo = (t: number): number => {
    const x = Math.max(0, Math.min(t, tAbre)) / PASO;
    const i = Math.min(pasos - 1, Math.floor(x));
    return (acum[i] as number) + ((acum[i + 1] as number) - (acum[i] as number)) * (x - i);
  };
  const dAbre = distGrupo(tAbre);
  const total = dAbre + RECTA;
  const dist = (t: number): number => (t <= tAbre ? distGrupo(t) : dAbre + RECTA * q(t));
  // La cinta: con tandas, las tandas son el primer tramo y el cursor avanza de tanda en tanda.
  const S0 = conTandas ? CINTA_TANDAS : 0;
  const enCinta = (d: number): number => S0 + (1 - S0) * (d / total);
  const fracTandas = (t: number): number => {
    if (!tandas.length || t <= T_VUELO) return 0;
    const h = tandas.findIndex((x) => t < x.tFin);
    if (h < 0) return 1;
    const x = tandas[h] as Tanda;
    return (h + clamp01((t - x.t0) / (x.tFin - x.t0))) / tandas.length;
  };
  const frac = (t: number): number => clamp01(t < tSalida && conTandas ? S0 * fracTandas(t) : enCinta(dist(t)));
  const cinta: Segmento[] = [
    ...(conTandas ? [{ tipo: "tandas" as const, f0: 0, f1: S0 }] : []),
    ...tramos.map((tr): Segmento => ({ tipo: "tramo", terreno: tr.terreno, f0: enCinta(distGrupo(tr.t0)), f1: enCinta(distGrupo(tr.t1)) })),
    { tipo: "recta", f0: enCinta(dAbre), f1: 1 },
  ];
  // Cuándo la meta entra entera en el plano.
  let t80 = tCrown;
  for (let t = 0; t <= tCrown; t += 0.05) if (frac(t) >= META_ENTERA) { t80 = t; break; }

  /* ----------------------------------------------------------- líder y vivas */
  const ranking = (t: number): number[] => {
    const qq = q(t);
    return lanes.map((_, k) => k).sort((a, b) => final.pos(b, qq) - final.pos(a, qq) || entrada.indexOf(lanes[a] as number) - entrada.indexOf(lanes[b] as number)).map((k) => lanes[k] as number);
  };
  // Con tandas, "adelante" es el corral: la última que pasó por el portón (o, antes de la primera, la primera de la tanda).
  const delCorral = (t: number): number => {
    let ult = -1;
    for (const h of tandas) h.pasan.forEach((p, j) => { if ((h.salidas[j] as number) <= t) ult = p; });
    if (ult >= 0) return ult;
    const h = tandas.find((x) => t < x.tFin) ?? tandas[0];
    return (h?.miembros[0] ?? lanes[0]) as number;
  };
  const lider = (t: number): number => (t >= tAbre ? (ranking(t)[0] as number) : t < tSalida && conTandas ? delCorral(t) : (orden.lider(Math.max(t, tSalida)) >= 0 ? orden.lider(Math.max(t, tSalida)) : (lanes[0] as number)));
  const tanda = (t: number): number => (conTandas && t >= T_VUELO - 0.3 ? tandas.findIndex((x) => t < x.tFin) : -1);
  const vivas = (t: number): number[] => (t >= tAbre ? ranking(t) : t < tSalida ? orden.en(tSalida) : orden.en(t));
  const fase = (t: number): FaseCarrera => (t < tVuelo ? "vuelo" : t < tNombres ? (conTandas ? "tandas" : "nombres") : t < tAbre ? "grupo" : t < tCrown ? "recta" : "fin");

  /* ------------------------------------------------------------------ sucesos */
  const sucesos: Suceso[] = [{ desde: 0, tipo: "empezo" }, { desde: tSalida, tipo: "empezo" }];
  for (const e of tiempos.echadas) sucesos.push({ desde: e.t, tipo: "salio", quien: e.quien });
  for (const h of tandas) {
    h.pasan.forEach((p, j) => sucesos.push({ desde: h.salidas[j] as number, tipo: "adelante", quien: p }));
    if (h.noPasan.length) sucesos.push({ desde: h.tCierra, tipo: "salio", quien: h.noPasan[0] });
  }
  // Un cambio de punta no se pisa con una echada: dos hechos a menos de un instante y ninguno se ve.
  const cambios = orden.cambios.filter((c) => !tiempos.echadas.some((e) => c.t > e.t - 0.5 && c.t < e.t + 0.8) && c.t < tAbre - 0.6);
  for (const c of cambios) sucesos.push({ desde: c.t, tipo: "adelante", quien: c.quien });
  const bt = final.story.beats.map((b) => ({ b, t: tDeQ(b.at) })).sort((a, b) => a.t - b.t);
  for (const { b, t } of bt) {
    if (b.kind === "pique") sucesos.push({ desde: t, tipo: "adelante", quien: lanes[b.actor] });
    else if (b.kind === "tropiezo" || b.kind === "plantada") sucesos.push({ desde: t, tipo: "freno", quien: lanes[b.actor] });
    else if (b.kind === "escupida" && b.target !== undefined) sucesos.push({ desde: t, tipo: "freno", quien: lanes[b.target] });
  }
  sucesos.push({ desde: tCrown, tipo: "gano", quien: campeona });
  sucesos.sort((a, b) => a.desde - b.desde);
  const ultimoSuceso = (t: number): Suceso => {
    let s = sucesos[0] as Suceso;
    for (const x of sucesos) if (x.desde <= t) s = x;
    return s;
  };

  /* ------------------------------------------------------------------- guion */
  type Cand = { prio: number; linea: LineaGuion; tipo?: "adelante" };
  const cand: Cand[] = [];
  const decir = (prio: number, t: number, l: Omit<LineaGuion, "t">, tipo?: "adelante"): void => void cand.push({ prio, linea: { t, ...l }, tipo });
  const sonar = (t: number, hacer: LineaGuion["hacer"]): void => void cand.push({ prio: 0, linea: { t, hacer } });
  const variante = (etiqueta: string): number => Math.floor(ctx.azar(etiqueta) * 3);
  const nom = (i: number): string => cortos[i] ?? "";
  // "Busquen su nombre" cae en el cartel de los nombres, a los 3 s: con hasta 30 el cartel termina en la salida y la
  // línea de la salida (más importante) la tapaba si se decía justo ahí.
  const noImportan = T_VUELO + 0.2;

  decir(4, 0.4, { texto: () => ctx.txt("carMeta"), calor: 0.15 });
  decir(4, noImportan, { texto: () => ctx.txt("carBusquen"), calor: 0.2, hacer: (k) => k.sonido.escalera([7, 8, 9], 80) });
  // Las tandas: cada una pasa a su gente por el portón, de a una, y las demás se echan juntas cuando se cierra.
  tandas.forEach((h, i) => {
    if (i > 0) decir(4, h.t0 + 0.8, { texto: () => ctx.txt("carTanda"), calor: 0.25 });
    h.pasan.forEach((p, j) => decir(5, h.salidas[j] as number, { texto: () => ctx.txt("carPasa", nom(p)), calor: 0.3, hecho: { tipo: "adelante", quien: p }, hacer: (k) => k.sonido.tono(9, "evento", { dur: 0.1, vol: 0.045 }) }));
    if (h.noPasan.length) decir(5, h.tCierra, { texto: () => ctx.txt("carCierraTanda"), calor: 0.3, hecho: { tipo: "salio", quien: h.noPasan[0] as number }, hacer: (k) => k.sonido.salida() });
  });
  decir(5, tSalida + 0.05, { texto: () => ctx.txt("carSalida"), calor: 0.35, grito: true, prioridad: PRIORIDAD.importante, hacer: (k) => k.sonido.escalera([7, 9, 12], 70) });
  const claveTerreno: Record<Terreno, string> = { cuesta: "carCuesta", barro: "carBarro", piedras: "carPiedras", viento: "carViento" };
  tramos.forEach((tr, k) => {
    if (k === 0) return;
    // El terreno nuevo se dice apenas cambia, pero nunca a menos de 1,2 s de la última echada del tramo anterior (con su desorden).
    const ultima = Math.max(tr.t0 - CIERRE_TRAMO, ...tiempos.echadas.filter((e) => e.tramo === k - 1).map((e) => e.t));
    decir(3, Math.max(tr.t0 + 0.1, ultima + ESP_MIN + 0.05), { texto: () => ctx.txt("carTramo", ctx.txt(claveTerreno[tr.terreno])), calor: 0.3 + 0.4 * (k / Math.max(1, tramos.length)), hacer: (kk) => kk.sonido.escalera([4, 5, 7], 70) });
  });
  if (tramos.length) decir(3, (tramos[0] as Tramo).t0 + 1.4, { texto: () => ctx.txt("carTramo", ctx.txt(claveTerreno[(tramos[0] as Tramo).terreno])), calor: 0.3 });
  const calorEn = (t: number): number => 0.3 + 0.45 * clamp01((t - tSalida) / Math.max(1, tAbre - tSalida));
  for (const e of tiempos.echadas) {
    decir(5, e.t, {
      texto: () => ctx.txt("carEcha", nom(e.quien), variante(`eco:${e.quien}`)),
      calor: calorEn(e.t),
      hecho: { tipo: "salio", quien: e.quien },
      hacer: (k) => {
        k.sonido.salida();
        k.cam.punch(0.025);
      },
    });
  }
  for (const c of cambios) {
    decir(2, c.t, {
      texto: () => ctx.txt("carAdelante", nom(c.quien), variante(`adl:${c.quien}:${Math.round(c.t)}`)),
      calor: calorEn(c.t),
      hecho: { tipo: "adelante", quien: c.quien },
      hacer: (k) => k.sonido.tono(9, "evento", { dur: 0.1, vol: 0.04 }),
    }, "adelante");
  }
  if (tAbre > tSalida) decir(4, tAbre - 0.4, { texto: () => ctx.txt("carRecta"), calor: 0.7, prioridad: PRIORIDAD.importante, hacer: (k) => k.sonido.escalera([5, 7, 10], 60) });
  decir(3, Math.max(t80, tAbre + 3), { texto: () => ctx.txt("carCasi"), calor: 0.75 });

  // La historia de la final, una línea por momento y sin nombres: quién se planta, tropieza o viene de atrás se ve en
  // la pista, y nombrarlo delataba: los momentos chicos nunca eran de la ganadora, y su momento del arco, siempre.
  // Los nombres de la final son los de la tribuna, más abajo.
  for (const { b, t } of bt) {
    const quien = lanes[b.actor] as number;
    const calor = Math.min(0.9, 0.5 + 0.35 * clamp01((t - tAbre) / DUR_FINAL));
    const solo = !sucesos.some((s) => s.desde > t + 0.001 && s.desde < t + 0.35);
    if (b.kind === "plantada") decir(4, t, { texto: () => ctx.txt("carPlantada"), calor, ...(solo ? { hecho: { tipo: "freno" as const, quien } } : {}) });
    else if (b.kind === "tropiezo") decir(4, t, { texto: () => ctx.txt("carTropiezo"), calor, ...(solo ? { hecho: { tipo: "freno" as const, quien } } : {}), hacer: (k) => k.sonido.tono(1, "evento", { dur: 0.09, vol: 0.05 }) });
    else if (b.kind === "pique") decir(3, t, { texto: () => ctx.txt("carPique"), calor, ...(solo ? { hecho: { tipo: "adelante" as const, quien } } : {}) });
    else if (b.kind === "escupida" && b.target !== undefined) decir(3, t, { texto: () => ctx.txt("carEscupida"), calor });
  }
  if (arco === "remontada") decir(4, tDeQ(0.74), { texto: () => ctx.txt("carRemonta"), calor: 0.8 });
  else if (arco === "duelo") {
    decir(4, tDeQ(0.52), { texto: () => ctx.txt("carDuelo"), calor: 0.7 });
    decir(3, tDeQ(0.52) + 1.4, { texto: () => ctx.txt("carAprieta"), calor: 0.72 });
    decir(5, tDeQ(final.foto), { texto: () => ctx.txt("carFoto"), calor: 0.95, grito: true, prioridad: PRIORIDAD.importante });
  } else if (arco === "tapada") decir(4, tDeQ(0.88), { texto: () => ctx.txt("carCuela"), calor: 0.9 });
  // Las patas: un golpe de casco cada medio segundo, parejo.
  for (let t = tSalida + 0.5, j = 0; t < tCrown - 0.4; t += 0.5, j++) sonar(t, (k) => k.sonido.tono(j % 2 ? 3 : 0, "fondo", { dur: 0.05, vol: 0.022 }));

  // Se acepta primero lo que importa; lo que queda a menos de 1,2 s de una línea aceptada se tira.
  const aceptar = (todas: readonly Cand[]): Cand[] => {
    const out: Cand[] = [];
    for (const c of [...todas].sort((a, b) => b.prio - a.prio || a.linea.t - b.linea.t)) {
      if (c.linea.texto === undefined) {
        out.push(c);
        continue;
      }
      // Quién va adelante puede caer a 0,9 s de otra línea; todo lo demás, a 1,2 s (o 1 s entre dos importantes).
      const sep = c.tipo === "adelante" ? 0.9 : ESP_MIN - 0.001 - (c.prio >= 4 ? 0.2 : 0);
      if (out.every((a) => a.linea.texto === undefined || Math.abs(a.linea.t - c.linea.t) >= (a.prio >= 4 || c.tipo === "adelante" ? sep : ESP_MIN - 0.001))) out.push(c);
    }
    return out;
  };
  let aceptadas = aceptar(cand);
  // Tres tiempos por tramo: qué pasó (la echada), qué pasa (quién va adelante) y qué sigue (el terreno). Si en un tramo
  // ningún cambio de punta alcanzó a decirse, se dice quién va adelante en el hueco más largo entre dos líneas.
  for (const tr of tramos) {
    const hay = aceptadas.some((a) => a.tipo === "adelante" && a.linea.t >= tr.t0 && a.linea.t < tr.t1);
    if (hay) continue;
    const textos = aceptadas.filter((a) => a.linea.texto !== undefined && a.linea.t > tr.t0 - 1 && a.linea.t < tr.t1 + 1).map((a) => a.linea.t).sort((x, y) => x - y);
    let mejor = { t: -1, hueco: 0 };
    for (let i = 0; i + 1 < textos.length; i++) {
      const a = Math.max(textos[i] as number, tr.t0), b = Math.min(textos[i + 1] as number, tr.t1 - 0.3);
      if (b - a > mejor.hueco) mejor = { t: (a + b) / 2, hueco: b - a };
    }
    if (mejor.hueco < 1.85) continue;
    const quien = lider(mejor.t);
    decir(2, mejor.t, { texto: () => ctx.txt("carVa", nom(quien)), calor: calorEn(mejor.t) }, "adelante");
    aceptadas = aceptar(cand);
  }
  // La tribuna: en la final, el relator solo nombra a las que grita la tribuna ("¡Vamos, Ana!"), hasta cuatro de las
  // ocho, sorteadas aparte sin mirar quién gana ni quién va adelante, y en los huecos de lo que ya se dice. Así lo que
  // se nombra en la final (a quién, en qué orden, quién primero y quién último) es el mismo para cualquiera: el
  // auditor de delatores midió que nombrar a la ganadora por su momento (la que viene de atrás, la del tropiezo, la
  // del mano a mano) la nombraba más que a las otras y la ponía última en la remontada.
  const gritan = barajar([...lanes], sembrar(Math.floor(ctx.azar("carrera:tribuna") * 4294967296)));
  const hinchadas: number[] = [];
  const desdeFinal = tAbre + 1.2, hastaFinal = tCrown - 2;
  for (let k = 0; k < Math.min(4, gritan.length); k++) {
    const puestas = [desdeFinal, hastaFinal, ...hinchadas, ...aceptadas.filter((a) => a.linea.texto !== undefined && a.linea.t > desdeFinal && a.linea.t < hastaFinal).map((a) => a.linea.t)].sort((x, y) => x - y);
    let mejor = { t: -1, hueco: 0 };
    for (let i = 0; i + 1 < puestas.length; i++) {
      const hueco = (puestas[i + 1] as number) - (puestas[i] as number);
      if (hueco > mejor.hueco) mejor = { t: ((puestas[i] as number) + (puestas[i + 1] as number)) / 2, hueco };
    }
    if (mejor.hueco < 2.5) break;
    hinchadas.push(mejor.t);
  }
  hinchadas.sort((x, y) => x - y).forEach((t, k) => {
    const quien = gritan[k] as number;
    decir(2, t, { texto: () => ctx.txt("carHinchada", nom(quien)), calor: Math.min(0.9, 0.5 + 0.35 * clamp01((t - tAbre) / DUR_FINAL)) });
  });
  aceptadas = aceptar(cand);
  const guion = aceptadas.map((c) => c.linea).sort((a, b) => a.t - b.t);
  const lineasAdelante = aceptadas.filter((a) => a.tipo === "adelante").map((a) => a.linea.t).sort((x, y) => x - y);

  /* ---------------------------------------------------------------- momentos */
  const escenaDe = (k: Kit): EscenaCarrera => k.escena as EscenaCarrera;
  const tomaVuelo: Toma = (k, t) => ({ vista: escenaDe(k).vistaPresentacion(t), ritmo: 10 });
  const tomaGrupo: Toma = (k, t) => ({ vista: escenaDe(k).vistaGrupo(t), ritmo: 6 });
  const tomaRecta: Toma = (k, t) => ({ caja: escenaDe(k).cajaCarriles(t), zona: escenaDe(k).zona(), respira: 0.01, ritmo: 4 });
  const sobreLasDeAdelante = planoSobre((k, t) => escenaDe(k).cajasDelFrente(t), { margen: 40, ritmo: 3, respira: 0.01 });
  // La cámara no mete la carrera debajo de la cinta: la zona empieza donde termina el marcador.
  const tomaFinal: Toma = (k, t) => {
    const p = sobreLasDeAdelante(k, t);
    return "caja" in p ? { ...p, zona: escenaDe(k).zona() } : p;
  };
  const tTension = tAbre + TENSION * (tCrown - tAbre);
  const momentos: Momentos = {
    presentacion: { hasta: tSalida, toma: tomaVuelo },
    tomas: [{ desde: tSalida, toma: tomaGrupo }, { desde: tAbre, toma: tomaRecta }],
    // El acercamiento de la tensión es del 15 %: con el golpe del 20 % el plano llega a 1,6 veces el general (`audit-emocion`).
    tension: { desde: tTension, toma: tomaFinal, empuje: 0.15 },
    meta: (k, t) => (t >= t80 ? escenaDe(k).meta() : null),
    foco: (k) => escenaDe(k).foco(),
    protegido: (k) => escenaDe(k).protegida(),
  };

  /* --------------------------------------------------- marcador y respuestas */
  const marcador = (t: number): number => (t >= tCrown ? 1 : Math.max(1, n - eliminadasHasta(t)));
  function eliminadasHasta(t: number): number {
    return tiempos.echadas.filter((e) => e.t <= t).length + tandas.filter((h) => h.tCierra <= t).reduce((acc, h) => acc + h.noPasan.length, 0);
  }
  const respuestas = (t: number): Respuestas => {
    const s = ultimoSuceso(t);
    return {
      adelante: { quienes: [t >= tCrown ? campeona : lider(t)], lugar: "derecha" },
      hacia: "derecha",
      progreso: frac(Math.min(t, tCrown)),
      paso: { tipo: s.tipo, quien: s.quien, desde: s.desde },
    };
  };

  const datos: Datos = {
    n, names, cortos, final, lanes, gente, tiempos, orden, tVuelo, tNombres, tSalida, tAbre, tCrown, tramos,
    dist, distAbre: dAbre, total, q, tDeQ, frac, cinta, t80, lider, vivas, campeona, fase, sucesos, cambiosDePunta: cambios, lineasAdelante, tandas, tanda,
  };
  return {
    duracion: tCrown,
    arco,
    sentido: "derecha",
    normal: normalDe(n),
    marcador,
    respuestas,
    momentos,
    guion,
    // `mitad` es el puesto (1 es la primera) de la ganadora a la mitad de la recta: lo lee `audit-emocion`, nadie más.
    marcas: { peloton: String(tiempos.echadas.length), clasificatoria: `${gente.length}/${n}`, mitad: String(vivas(tDeQ(0.5)).indexOf(campeona) + 1) },
    datos,
  };
}
