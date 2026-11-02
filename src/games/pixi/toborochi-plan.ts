import { acotar, hashDe, sembrar } from "./kit/azar";
import { planoEntero, planoSobre } from "./kit/director";
import { PRIORIDAD } from "./kit/guion";
import { planNombres } from "./kit/nombres";
import type { Arc, Caja, Contexto, Kit, LineaGuion, Momentos, Plan, Respuestas } from "./kit/tipos";
import { cajaDeFlor, cajaDelArbol, disposicion, geoDe, type Disposicion, type Lugar } from "./toborochi-arbol";

/**
 * El Toborochi: el plan, puro.
 *
 * Un toborochi en flor y sin hojas. Cada persona es una flor en la punta de una
 * rama, con su cara y su nombre. El surazo pasa por la copa en ráfagas: una ola
 * de viento dobla **la copa entera** (nunca una flor sola) y, a su paso, suelta
 * a las flores que la ronda descartó. Quedan dos; un colibrí las visita, duda, y
 * se posa donde ya estaba escrito. Todo esto es la dramatización de un resultado
 * que llega dado (`ctx.ganadores`): el plan no decide nada, solo lo cuenta.
 *
 * Qué NO puede delatar a quien gana (`docs/juegos/toborochi.md`, "Los delatores"):
 *
 * - la ola dobla toda la copa, igual para todas; las flores que tiemblan fuerte
 *   se sortean entre **todas** las que siguen, también las que van a caer;
 * - ninguna rama se vacía antes de la última ola;
 * - el colibrí visita a las dos; la primera visitada gana la mitad de las veces;
 * - la cámara encuadra a las dos finalistas, nunca a una sola.
 *
 * Sin DOM, sin reloj y sin `Math.random`: la misma ronda cuenta lo mismo en
 * cualquier equipo, y se prueba en Node (`toborochi-plan.test.ts`).
 */

/* ------------------------------------------------------------------ los tiempos */
/** Se abren las flores. */
export const T_FLORECE = 2.5;
/** Cada tanda de nombres de la brisa, y cuántos nombres entran en una. */
export const T_TANDA = 1.5;
export const POR_TANDA = 8;
/** Hasta cuánta gente hay tandas: con más no entran los nombres. */
export const LISTA_MAX = 64;
/** Lo que dura una ráfaga sin contar las flores que suelta, y lo que suma cada una (hasta `OLA_EXTRA_MAX`). */
export const T_OLA = 2.8;
export const OLA_POR_CAIDA = 0.12;
export const OLA_EXTRA_MAX = 0.8;
/** La calma entre ráfagas, y lo que suma cada flor que se va con premio. */
export const T_CALMA = 1.0;
export const T_PREMIO = 1.0;
/** "Quedan dos": el viento para en seco. */
export const T_QUEDAN = 1.2;
/** El colibrí: entra, se suspende frente a una flor, va a la otra, y al final calla antes de posarse. */
export const T_ENTRADA = 1.1;
export const T_HOVER = 0.95;
export const T_TRASIEGO = 0.5;
export const T_SILENCIO = 0.4;
/** Dentro de una ráfaga: cuándo termina de nublarse y llega la ola, y cuánto tarda en cruzar la copa. */
export const OLA_LLEGA = 0.9;
export const OLA_CRUZA = 1.4;

/** Cuántas ráfagas hay con `n` personas: 1 con 2, 2 hasta 7, 3 hasta 18, 4 hasta 42, 5 hasta 102 y 6 con más. */
export const olasPara = (n: number): number => (n <= 2 ? 1 : n <= 7 ? 2 : n <= 18 ? 3 : n <= 42 ? 4 : n <= 102 ? 5 : 6);

/**
 * Cuántas flores se lleva cada ráfaga: la mitad en la primera, un poco más del resto en las siguientes y lo que quede
 * en la última (con 18, 8, 5 y 3). Con menos flores que ráfagas, una de práctica que no se lleva a nadie. Siempre suma `f`.
 */
export function repartir(f: number, olas: number): number[] {
  if (f <= 0) return [0];
  if (olas <= 1) return [f];
  if (f < olas) return [0, ...new Array<number>(f).fill(1)];
  const out: number[] = [];
  let resto = f;
  for (let j = 0; j < olas - 1; j++) {
    const take = acotar(Math.round(resto * (0.5 + 0.1 * j)), 1, resto - (olas - 1 - j));
    out.push(take);
    resto -= take;
  }
  out.push(resto);
  return out;
}

export interface Ola {
  j: number;
  t0: number;
  t1: number;
  /** Las que suelta, en el orden en que cruza el frente. */
  cae: number[];
  /** Las flores que tiemblan fuerte: entre todas las que siguen, también las que no caen. */
  tiembla: number[];
  /** Una ráfaga de práctica no se lleva a nadie. */
  practica: boolean;
  ultima: boolean;
}

export interface Calma {
  j: number;
  t0: number;
  t1: number;
  /** Quienes se van con premio en esta calma, y a qué hora. */
  premios: { quien: number; t: number }[];
}

export interface Visita {
  quien: number;
  /** Cuándo llega y se suspende frente a la flor. */
  llega: number;
  /** Cuándo se va a la otra (en la última, cuándo calla el zumbido). */
  sale: number;
  /** De qué lado se suspende: -1 a la izquierda, 1 a la derecha. */
  lado: 1 | -1;
}

/** Una flor que cuelga de un hilo y aguanta. */
export interface Hilo {
  quien: number;
  t0: number;
  t1: number;
}

/** Una flor que se cae y se engancha más abajo. */
export interface Engancha {
  quien: number;
  t: number;
  /** Cuánto baja, en la copa unitaria. */
  dv: number;
}

export interface Datos {
  n: number;
  ganador: number;
  rival: number;
  /** Quienes ganan además del primero y la rival: se van en las calmas, con premio. */
  premios: number[];
  /** La rival también gana (hay dos premios o más): al final se enciende junto a la ganadora. */
  rivalGana: boolean;
  arco: Arc;
  /** La tapada: las dos últimas se quedan sin nombre. */
  sinNombres: boolean;
  dis: Disposicion;
  /** El lugar de cada persona en la copa. */
  lugar: Lugar[];
  olas: Ola[];
  calmas: Calma[];
  /** Cuándo se desprende cada flor (infinito si se queda), y por qué. */
  tCae: number[];
  causa: ("" | "viento" | "premio")[];
  /** Cuánto tarda en llegar al suelo. */
  durCaida: number[];
  /** Quién lleva su nombre en vuelo: las que más se ven, no más de `VUELO_MAX` por ráfaga. */
  vuelo: boolean[];
  hilos: Hilo[];
  engancha: Engancha | null;
  /** Una tanda tras otra, de a ocho. */
  tTandas: [number, number] | null;
  tOla0: number;
  tQuedan0: number;
  tColibri0: number;
  visitas: Visita[];
  /** Cuando el colibrí deja a la ganadora y mete el pico: el golpe de la cámara cae poco después. */
  tPico: number;
  /** La hora en que calla el zumbido antes de posarse. */
  tCalla: number;
  /** El colibrí lejano de la primera calma. */
  lejos: [number, number] | null;
}

/** Cuántos nombres vuelan con sus flores en una misma ráfaga. */
export const VUELO_MAX = 10;

/** El nombre de pila, para el relator: corto, y la sala sabe de quién se habla. */
const pilaDe = (formas: readonly (readonly string[])[], i: number): string => (formas[i]?.[1] as string | undefined) ?? "";

export function planToborochi(ctx: Contexto): Plan<Datos> {
  const n = Math.max(1, ctx.nombres.length);
  const ganador = ctx.ganadores[0] ?? 0;
  // La historia del director de emoción: su arco da el sabor de la cámara y del foco.
  // El plan la pide acá, antes de gastar el azar en otra cosa: así el orden es siempre el mismo.
  const historia = ctx.historia(Math.max(2, n), ganador % Math.max(2, n));
  const arco = historia.arc;
  const azar = (etiqueta: string): number => ctx.azar(`toborochi:${etiqueta}`);
  /** Un generador sembrado por etiqueta: no gasta el `rng` de la ronda. */
  const rnd = (etiqueta: string): (() => number) => sembrar(Math.floor(azar(etiqueta) * 2 ** 31));

  /* ------------------------------------------------------ quiénes son las dos */
  // Con varios premios, la rival es la segunda; sin ellos, la que escribió la historia.
  let rival = ctx.ganadores[1] ?? historia.rival % Math.max(1, n);
  if (n > 1 && rival === ganador) rival = (ganador + 1) % n;
  const premios = [...new Set(ctx.ganadores.slice(2))].filter((i) => i !== ganador && i !== rival && i >= 0 && i < n);
  const finalistas = [ganador, rival];
  const esFinalista = (i: number): boolean => i === ganador || i === rival;
  const sinNombres = arco === "tapada";

  /* ---------------------------------------------------------------- el árbol */
  const dis = disposicion(n);
  // Cada persona en una flor: un reparto sembrado de la lista entera, así quien gana puede quedar en cualquier rama.
  const rl = rnd("lugares");
  const perm = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rl() * (i + 1));
    [perm[i], perm[j]] = [perm[j] as number, perm[i] as number];
  }
  const lugar: Lugar[] = perm.map((s) => dis.lugares[s] as Lugar);

  /* ------------------------------------------------------- las ráfagas y sus bajas */
  const pool = Array.from({ length: n }, (_, i) => i).filter((i) => !esFinalista(i) && !premios.includes(i));
  let olasN = olasPara(n) + (arco === "duelo" ? 1 : 0);
  let cuentas = repartir(pool.length, olasN);
  // Con premios hace falta al menos una calma donde irse.
  if (premios.length > 0 && cuentas.length < 2) cuentas = [0, ...cuentas];
  olasN = cuentas.length;
  // Quienes sostienen una rama hasta la última ráfaga: las que no se van con premio y las finalistas (que no cuentan: nunca caen).
  const guardia = new Array<number>(dis.ramas).fill(0);
  for (const i of pool) guardia[(lugar[i] as Lugar).rama] = (guardia[(lugar[i] as Lugar).rama] as number) + 1;
  for (const i of finalistas) guardia[(lugar[i] as Lugar).rama] = (guardia[(lugar[i] as Lugar).rama] as number) + 1000;
  // Cada rama sin finalistas guarda una flor para la última ráfaga: esa ráfaga tiene que ser lo bastante grande.
  const libres = guardia.filter((g) => g > 0 && g < 1000).length;
  while (olasN > 1 && (cuentas[olasN - 1] as number) < libres) {
    let m = 0;
    for (let j = 1; j < olasN - 1; j++) if ((cuentas[j] as number) > (cuentas[m] as number)) m = j;
    if ((cuentas[m] as number) <= 0) break;
    cuentas[m] = (cuentas[m] as number) - 1;
    cuentas[olasN - 1] = (cuentas[olasN - 1] as number) + 1;
  }

  // Quién cae en cada ráfaga: la lista sembrada, sin vaciar ninguna rama antes de la última.
  const rc = rnd("cola");
  const cola = [...pool];
  for (let i = cola.length - 1; i > 0; i--) {
    const j = Math.floor(rc() * (i + 1));
    [cola[i], cola[j]] = [cola[j] as number, cola[i] as number];
  }
  const sale = new Set<number>();
  const saleDe = (i: number): void => {
    sale.add(i);
    // Los premios se van en las calmas y no sostienen nada: no cuentan para la rama.
    if (!premios.includes(i)) {
      const r = (lugar[i] as Lugar).rama;
      guardia[r] = (guardia[r] as number) - 1;
    }
  };
  // Los premios se reparten entre las calmas (hay olasN - 1), una tras otra.
  const premiosPorCalma: number[][] = Array.from({ length: Math.max(0, olasN - 1) }, () => []);
  const rp = rnd("premios");
  const premiosOrden = [...premios].sort((a, b) => hashDe(a, 77) - hashDe(b, 77) || a - b);
  premiosOrden.forEach((q, m) => (premiosPorCalma[(m + Math.floor(rp() * 3)) % Math.max(1, premiosPorCalma.length)] as number[]).push(q));

  const caeEn: number[][] = [];
  for (let j = 0; j < olasN; j++) {
    const ultima = j === olasN - 1;
    const queda = cola.filter((i) => !sale.has(i));
    let toma: number[];
    if (ultima) toma = queda;
    else {
      toma = [];
      for (const i of queda) {
        if (toma.length >= (cuentas[j] as number)) break;
        // No se lleva a la última que le queda a su rama.
        if ((guardia[(lugar[i] as Lugar).rama] as number) <= 1) continue;
        toma.push(i);
        saleDe(i);
      }
      // Si por las ramas no alcanzó, se completa con las que haya: la regla es lo mejor que se pueda, no una trampa.
      for (const i of queda) {
        if (toma.length >= (cuentas[j] as number)) break;
        if (!toma.includes(i)) {
          toma.push(i);
          saleDe(i);
        }
      }
    }
    if (ultima) for (const i of toma) saleDe(i);
    caeEn.push(toma);
    // Los premios de la calma que sigue salen de la copa antes de la ráfaga siguiente.
    if (!ultima) for (const q of premiosPorCalma[j] as number[]) saleDe(q);
  }

  /* ----------------------------------------------------------- los tiempos */
  const nT = n >= 2 && n <= LISTA_MAX ? Math.ceil(n / POR_TANDA) : 0;
  const tTandas: [number, number] | null = nT > 0 ? [T_FLORECE, T_FLORECE + nT * T_TANDA] : null;
  let t = tTandas ? tTandas[1] : T_FLORECE + 0.4;
  const tOla0 = t;
  const olas: Ola[] = [];
  const calmas: Calma[] = [];
  const tCae = new Array<number>(n).fill(Infinity);
  const causa = new Array<"" | "viento" | "premio">(n).fill("");
  const durCaida = lugar.map((l) => 0.8 + 0.7 * l.v);
  const rt = rnd("tiempos");
  for (let j = 0; j < olasN; j++) {
    const lista = caeEn[j] as number[];
    const ultima = j === olasN - 1;
    const D = T_OLA + Math.min(OLA_EXTRA_MAX, OLA_POR_CAIDA * lista.length);
    // El frente cruza la copa de izquierda a derecha: cada flor se suelta cuando le llega.
    const ordenada = [...lista].sort((a, b) => (lugar[a] as Lugar).u - (lugar[b] as Lugar).u || a - b);
    ordenada.forEach((i) => {
      const x01 = ((lugar[i] as Lugar).u + 1) / 2;
      tCae[i] = t + OLA_LLEGA + OLA_CRUZA * x01 * 0.9 + 0.12 * rt();
      causa[i] = "viento";
    });
    ordenada.sort((a, b) => (tCae[a] as number) - (tCae[b] as number) || a - b);
    // Las que tiemblan fuerte, entre todas las que siguen en la copa en ese momento.
    const vivas = Array.from({ length: n }, (_, i) => i).filter((i) => !(tCae[i] as number < t));
    const barajadas = vivas.map((i) => ({ i, h: hashDe(i * 31 + j, Math.floor(azar(`tiembla:${j}`) * 2 ** 30)) })).sort((a, b) => a.h - b.h || a.i - b.i);
    const cuantas = Math.min(vivas.length, 3 + Math.floor(rt() * 3));
    olas.push({ j, t0: t, t1: t + D, cae: ordenada, tiembla: barajadas.slice(0, cuantas).map((x) => x.i), practica: lista.length === 0, ultima });
    t += D;
    if (!ultima) {
      const ps = premiosPorCalma[j] as number[];
      const dur = T_CALMA + T_PREMIO * ps.length;
      const pr = ps.map((quien, m) => ({ quien, t: t + 0.3 + m * T_PREMIO }));
      for (const p of pr) {
        tCae[p.quien] = p.t;
        causa[p.quien] = "premio";
        durCaida[p.quien] = (durCaida[p.quien] as number) * 1.4;
      }
      calmas.push({ j, t0: t, t1: t + dur, premios: pr });
      t += dur;
    }
  }
  const tQuedan0 = t;
  t += T_QUEDAN;
  const tColibri0 = t;

  /* ------------------------------------------------------- los giros del arco */
  const rg = rnd("giros");
  const ultimaOla = olas[olas.length - 1] as Ola;
  const hilos: Hilo[] = [];
  let engancha: Engancha | null = null;
  // Quién vive el giro del arco: una flor sorteada entre todas las que siguen cuando empieza la última ráfaga (las dos
  // finalistas y las que esa ráfaga se lleva), nunca por quién gana: si el giro cayera siempre en una finalista, quien lo
  // ve sabría que esa flor llega al final (`audit-delatores`). Si le toca a una de las que caen, el giro pasa y después cae.
  const siguen = [...new Set([...ultimaOla.cae, ganador, rival])].sort((a, b) => a - b);
  const elegida = siguen[Math.floor(rg() * siguen.length)] as number;
  const caeDespues = (q: number, t: number): void => {
    if (!Number.isFinite(tCae[q] as number)) return;
    tCae[q] = t;
    ultimaOla.cae.sort((x, y) => (tCae[x] as number) - (tCae[y] as number) || x - y);
  };
  if (arco === "susto") {
    hilos.push({ quien: elegida, t0: ultimaOla.t0 + 1.5, t1: ultimaOla.t0 + 2.6 });
    caeDespues(elegida, ultimaOla.t0 + 2.7);
  }
  if (arco === "remontada") {
    engancha = { quien: elegida, t: ultimaOla.t0 + OLA_LLEGA + 0.5, dv: 0.17 };
    caeDespues(elegida, engancha.t + 0.9);
  }
  // Una flor sorteada que cuelga de un hilo en la primera ráfaga: el susto también le pasa a las que no ganan. Se sortea
  // entre todas las que siguen después de esa ráfaga, también las finalistas.
  if (olas.length >= 2 && arco !== "susto" && rg() < 0.5) {
    const o0 = olas[0] as Ola;
    const candidatas = Array.from({ length: n }, (_, i) => i).filter((i) => (tCae[i] as number) > o0.t0 + 2.7);
    if (candidatas.length > 0) {
      const quien = candidatas[Math.floor(rg() * candidatas.length)] as number;
      hilos.push({ quien, t0: o0.t0 + 1.5, t1: o0.t0 + 2.5 });
    }
  }

  /* --------------------------------------------------------- el colibrí */
  const rv = rnd("colibri");
  // Dos a cuatro visitas, alternando entre las dos; la última es la ganadora. La primera visitada gana la mitad de las veces.
  const u = rv();
  const L = u < 0.5 ? 2 : 3;
  const otra = (q: number): number => (q === ganador ? rival : ganador);
  const secuencia: number[] = [];
  for (let m = L - 1, q = ganador; m >= 0; m--, q = otra(q)) secuencia.unshift(q);
  const xDe = (q: number): number => (lugar[q] as Lugar).u;
  const ladoDe = (q: number): 1 | -1 => (xDe(q) >= xDe(otra(q)) ? 1 : -1);
  const visitas: Visita[] = [];
  let tv = tColibri0 + T_ENTRADA;
  secuencia.forEach((q, m) => {
    const ultima = m === secuencia.length - 1;
    visitas.push({ quien: q, llega: tv, sale: tv + T_HOVER, lado: ladoDe(q) });
    tv += T_HOVER + (ultima ? T_SILENCIO : T_TRASIEGO);
  });
  const tPico = tv;
  const tCalla = (visitas[visitas.length - 1] as Visita).sale;
  const duracion = tPico;
  const lejos: [number, number] | null = calmas.length > 0 ? [(calmas[0] as Calma).t0 + 0.2, (calmas[0] as Calma).t0 + 1.2] : null;

  // Los nombres en vuelo: de cada ráfaga, hasta diez, las que más se ven (sorteadas, no por quién).
  const vuelo = new Array<boolean>(n).fill(false);
  for (const o of olas) {
    o.cae
      .map((i) => ({ i, h: hashDe(i, 91 + o.j) }))
      .sort((a, b) => a.h - b.h)
      .slice(0, VUELO_MAX)
      .forEach((x) => (vuelo[x.i] = true));
  }
  for (const c of calmas) for (const p of c.premios) vuelo[p.quien] = true;

  const datos: Datos = {
    n, ganador, rival, premios, rivalGana: ctx.ganadores.slice(1).includes(rival), arco, sinNombres, dis, lugar, olas, calmas, tCae, causa, durCaida, vuelo, hilos, engancha, tTandas,
    tOla0, tQuedan0, tColibri0, visitas, tPico, tCalla, lejos,
  };

  /* --------------------------------------------------------------- el relator */
  // Lo que pasó y se cuenta para la prueba del niño. Un hilo solo cuenta como hecho si nada más pasa a su lado (0,5 s).
  const horasFijas: number[] = [];
  for (const o of olas) if (o.cae[0] !== undefined) horasFijas.push(tCae[o.cae[0]] as number);
  for (const c of calmas) for (const pr of c.premios) horasFijas.push(pr.t);
  for (const v of visitas) horasFijas.push(v.llega + 0.05);
  const libre = (x: number): boolean => !horasFijas.some((h) => Math.abs(h - x) < 0.5);
  const engancheContado = engancha !== null && libre(engancha.t + 0.45);
  if (engancheContado && engancha) horasFijas.push(engancha.t + 0.45);
  const hilosContados = new Set<Hilo>();
  for (const h of hilos) {
    if (!libre(h.t0 + 0.1)) continue;
    hilosContados.add(h);
    horasFijas.push(h.t0 + 0.1);
  }
  const hiloContado = (h: Hilo): boolean => hilosContados.has(h);
  const formas = planNombres(ctx.nombres).formas;
  const pila = (i: number): string => pilaDe(formas, i);
  const guion: LineaGuion[] = [{ t: 0.3, texto: ctx.txt("intro"), calor: 0.15, hacer: (k) => k.sonido.escalera([5, 7, 9, 11, 14], 110) }];
  if (tTandas) {
    // Una frase cada tres segundos mientras llegan los nombres, para que la sala siempre tenga qué leer.
    const frases = ["busquen", "ya", "cada"];
    for (let m = 0; tTandas[0] + m * 2.9 < tTandas[1] - 0.5; m++) guion.push({ t: tTandas[0] + m * 2.9, texto: ctx.txt(frases[m % frases.length] as string), calor: 0.2 });
    for (let i = 0; i < nT; i++) guion.push({ t: tTandas[0] + i * T_TANDA, hacer: (k) => k.sonido.escalera([7 + (i % 3), 8 + (i % 3), 9 + (i % 3)], 70) });
  }
  olas.forEach((o, j) => {
    const calor = 0.3 + 0.35 * (j / Math.max(1, olas.length - 1));
    guion.push({ t: o.t0 + 0.1, texto: ctx.txt(j === 0 ? "sopla" : "soplaOtra"), calor, prioridad: PRIORIDAD.importante, hacer: (k) => k.sonido.viento(o.t1 - o.t0, 0.4 + 0.6 * (j / Math.max(1, olas.length - 1)), j) });
    if (j === 0) guion.push({ t: o.t0 + 1.0, texto: ctx.txt("aguanta"), calor: 0.35 });
    // En el medio de la ráfaga, otra frase: ninguna dura más de tres segundos sin decir nada.
    guion.push({ t: o.t0 + (j === 0 ? 2.3 : 2.0), texto: ctx.txt("ahiVa"), calor: calor + 0.05 });
    // Las que caen suenan a punteo, hasta seis por ráfaga, de agudo a grave.
    const sonoras = o.cae.filter((_, m) => o.cae.length <= 6 || m % Math.ceil(o.cae.length / 6) === 0).slice(0, 6);
    sonoras.forEach((q, m) => guion.push({ t: tCae[q] as number, hacer: (k) => k.sonido.una(`cae:${q}`, () => k.sonido.tono(16 - m, "evento", { dur: 0.09, vol: 0.06 })) }));
  });
  for (const c of calmas) {
    if (c.j === 0 && lejos) guion.push({ t: c.t0 + 0.35, texto: ctx.txt("asoma"), calor: 0.3 });
    else guion.push({ t: c.t0 + 0.2, texto: ctx.txt("paso"), calor: 0.3 });
    for (const p of c.premios) {
      guion.push({ t: p.t, texto: () => ctx.txt("conPremio", pila(p.quien)), calor: 0.4, prioridad: PRIORIDAD.importante, hecho: { tipo: "salio", quien: p.quien }, hacer: (k) => k.sonido.salida() });
    }
  }
  for (const h of hilos) {
    guion.push({ t: h.t0 + 0.1, texto: () => ctx.txt("hilo", pila(h.quien)), calor: 0.55, prioridad: PRIORIDAD.importante, ...(hiloContado(h) ? { hecho: { tipo: "casi" as const, quien: h.quien } } : {}), hacer: (k) => k.sonido.latido() });
  }
  if (engancha) {
    const e = engancha;
    guion.push({ t: e.t + 0.45, texto: () => ctx.txt("engancha", pila(e.quien)), calor: 0.55, prioridad: PRIORIDAD.importante, ...(engancheContado ? { hecho: { tipo: "casi" as const, quien: e.quien } } : {}), hacer: (k) => k.sonido.latido() });
  }
  guion.push({ t: tQuedan0 + 0.05, texto: ctx.txt("quedanDos"), calor: 0.6, prioridad: PRIORIDAD.importante, hacer: (k) => k.sonido.tono(10, "evento") });
  guion.push({ t: tColibri0 + 0.1, texto: ctx.txt("colibri"), calor: 0.7, prioridad: PRIORIDAD.importante });
  // El zumbido acompaña cada tramo del vuelo, crece al acercarse y calla antes de posarse.
  guion.push({ t: tColibri0, hacer: (k) => k.sonido.zumbido(T_ENTRADA, 0) });
  // Antes de la primera visita (no después: una línea sobre la última visita delataría a la elegida).
  guion.push({ t: tColibri0 + 0.55, texto: ctx.txt(datos.rivalGana ? "ultimaDos" : "ultima"), calor: 0.8 });
  visitas.forEach((v, m) => {
    const ultima = m === visitas.length - 1;
    guion.push({ t: v.llega, hacer: (k) => k.sonido.zumbido(T_HOVER, 0.6) });
    if (!ultima) guion.push({ t: v.sale, hacer: (k) => k.sonido.zumbido(T_TRASIEGO, 0.3) });
    const texto = sinNombres ? () => ctx.txt(m % 2 === 0 ? "visitaSin" : "visitaOtra") : () => ctx.txt("visita", pila(v.quien));
    guion.push({ t: v.llega + 0.05, texto, calor: 0.75 + 0.05 * m, prioridad: PRIORIDAD.importante, hecho: { tipo: "casi", quien: v.quien }, hacer: (k) => k.sonido.una(`tsip:${m}`, () => k.sonido.tono(18, "evento", { dur: 0.06, vol: 0.04 })) });
  });
  // La sala nunca espera más de tres segundos sin un sonido: un toque suave cada segundo y medio, también con el viento (que no son osciladores).
  for (let x = 0.9, j = 0; x < tPico - 0.3; x += 1.5, j++) guion.push({ t: x, hacer: (k) => k.sonido.tono(7 + (j % 4), "evento", { dur: 0.08, vol: 0.05 }) });

  /* ------------------------------------------------ el contador y la regla del niño */
  const caidas = tCae.filter((c) => Number.isFinite(c)).sort((a, b) => a - b);
  /** Cuántas siguen en el árbol: baja de a una, cuando se desprende cada flor, y es 1 con el golpe. */
  const marcador = (x: number): number => (x >= duracion ? 1 : Math.max(1, n - caidas.filter((c) => c <= x).length));
  const eventos: { desde: number; tipo: Respuestas["paso"]["tipo"]; quien?: number }[] = [{ desde: 0, tipo: "empezo" }];
  for (const o of olas) {
    const primera = o.cae[0];
    if (primera !== undefined) eventos.push({ desde: tCae[primera] as number, tipo: "salio", quien: primera });
  }
  for (const c of calmas) for (const p of c.premios) eventos.push({ desde: p.t, tipo: "salio", quien: p.quien });
  for (const h of hilos) if (hiloContado(h)) eventos.push({ desde: h.t0 + 0.1, tipo: "casi", quien: h.quien });
  if (engancha && engancheContado) eventos.push({ desde: engancha.t + 0.45, tipo: "casi", quien: engancha.quien });
  for (const v of visitas) eventos.push({ desde: v.llega + 0.05, tipo: "casi", quien: v.quien });
  eventos.push({ desde: duracion, tipo: "gano", quien: ganador });
  eventos.sort((a, b) => a.desde - b.desde);
  const vivosEn = (x: number): number[] => Array.from({ length: n }, (_, i) => i).filter((i) => (tCae[i] as number) > x);
  const respuestas = (x: number): Respuestas => {
    const ult = [...eventos].filter((e) => e.desde <= x).at(-1) ?? (eventos[0] as (typeof eventos)[number]);
    return {
      adelante: { quienes: x >= duracion ? [ganador] : vivosEn(x), lugar: x >= duracion ? "centro" : "arriba" },
      hacia: "arriba",
      // Lo que falta se siente más cerca del final que del principio: florecer y leer los nombres es empezar. Sube sin pasos y llega a 1 con el golpe.
      progreso: Math.pow(acotar(x / duracion, 0, 1), 1.25),
      paso: { tipo: ult.tipo, quien: ult.quien, desde: ult.desde },
    };
  };

  /* ----------------------------------------------------------------- la cámara */
  const geo = (k: Kit) => geoDe(k.pantalla(), n);
  const arbol = (k: Kit): Caja => cajaDelArbol(geo(k));
  const momentos: Momentos = {
    // El árbol entero, respirando un 1 %: en celular, la copa arriba y la alfombra abajo.
    presentacion: { hasta: tOla0, toma: planoEntero(arbol) },
    // Desde "quedan dos", las dos finalistas: nunca la visitada, que sería delatarla.
    tension: {
      desde: tQuedan0,
      // Mientras el colibrí decide, las dos; con el pico adentro, ya es de la ganadora y la cámara se le va encima.
      toma: planoSobre((k, t) => (t < tPico || datos.rivalGana ? finalistas : [ganador]).map((q) => cajaDeFlor(geo(k), lugar[q] as Lugar, 2.6)), { margen: 8, zoomMax: 1.9 }),
    },
    // La ganadora, entera, debajo del cartel.
    foco: (k) => {
      const g = geo(k);
      const p = k.pantalla();
      const c = (lugar[ganador] as Lugar);
      const q = k.cam.toScreen(g.cx + c.u * (g.copa.ancho / 2), g.copa.base - c.v * g.copa.alto, p.w, p.h);
      const z = Math.max(0.3, k.cam.toScreen(1, 0, p.w, p.h).x - k.cam.toScreen(0, 0, p.w, p.h).x);
      return { x: q.x, y: q.y, r: g.r * 1.7 * z };
    },
  };

  return {
    duracion,
    arco,
    sentido: "arriba",
    marcador,
    respuestas,
    momentos,
    guion,
    // `primera`: 1 si el colibrí visita primero a quien gana (la mitad de las veces, lo mira `audit-emocion`).
    marcas: { toborochi: `${n}/${olasN}`, primera: (visitas[0] as Visita).quien === ganador ? "1" : "0" },
    datos,
  };
}

/* ------------------------------------------------------ lo que la escena le pregunta al plan */

export type FaseToborochi = "florece" | "tandas" | "ola" | "calma" | "quedan" | "colibri";

/** En qué fase está el show en el segundo `t`, con la ráfaga o la calma si toca. */
export function faseDe(d: Datos, t: number): { fase: FaseToborochi; ola: Ola | null; calma: Calma | null } {
  if (t >= d.tColibri0) return { fase: "colibri", ola: null, calma: null };
  if (t >= d.tQuedan0) return { fase: "quedan", ola: null, calma: null };
  for (const o of d.olas) if (t >= o.t0 && t < o.t1) return { fase: "ola", ola: o, calma: null };
  for (const c of d.calmas) if (t >= c.t0 && t < c.t1) return { fase: "calma", ola: null, calma: c };
  if (d.tTandas && t >= d.tTandas[0] && t < d.tTandas[1]) return { fase: "tandas", ola: null, calma: null };
  return { fase: "florece", ola: null, calma: null };
}

const suave = (v: number): number => {
  const x = acotar(v, 0, 1);
  return x * x * (3 - 2 * x);
};

/**
 * La fuerza del viento de 0 a 1 en el segundo `t`: sube cuando llega la ráfaga, tiene su cresta cuando el frente cruza
 * la copa y se apaga al terminar. Una ráfaga de práctica llega al 60 %. Parar en seco en "quedan dos".
 */
export function vientoEn(d: Datos, t: number): number {
  for (const o of d.olas) {
    if (t < o.t0 || t >= o.t1) continue;
    const u = t - o.t0;
    const D = o.t1 - o.t0;
    const sube = suave(u / OLA_LLEGA) * 0.35;
    const cresta = u > OLA_LLEGA && u < OLA_LLEGA + OLA_CRUZA + 0.2 ? Math.sin((Math.PI * (u - OLA_LLEGA)) / (OLA_CRUZA + 0.2)) : 0;
    const apaga = 1 - suave((u - (D - 0.5)) / 0.5);
    return acotar((sube + 0.65 * cresta) * apaga * (o.practica ? 0.6 : 1), 0, 1);
  }
  return 0;
}

/** Por dónde va el frente del viento al cruzar la copa, de 0 (izquierda) a 1 (derecha); -1 si no hay ráfaga. */
export function frenteEn(d: Datos, t: number): number {
  for (const o of d.olas) {
    if (t < o.t0 || t >= o.t1) continue;
    return acotar((t - o.t0 - OLA_LLEGA) / OLA_CRUZA, -0.2, 1.2);
  }
  return -1;
}

/** Cuánto está nublado el sur, de 0 a 0,5: se va cerrando de a poco en cada ráfaga y no se aclara del todo hasta el final. */
export function nubladoEn(d: Datos, t: number): number {
  if (t >= d.tQuedan0) return 0.5 * (1 - suave((t - d.tQuedan0) / T_QUEDAN));
  let nube = 0;
  for (const o of d.olas) {
    const sube = suave((t - (o.t0 - 0.3)) / 1.1);
    const baja = o.ultima ? 0 : 0.5 * suave((t - (o.t1 - 0.2)) / 1.0);
    nube = Math.max(nube, (0.25 + 0.25 * ((o.j + 1) / d.olas.length)) * sube * (1 - baja));
  }
  return nube;
}

/** Cuánto cuelga de su hilo la flor `i` en `t`, de 0 a 1 (1 en el medio del tirón). */
export function hiloEn(d: Datos, i: number, t: number): number {
  const h = d.hilos.find((x) => x.quien === i);
  if (!h || t < h.t0 || t >= h.t1) return 0;
  return Math.sin((Math.PI * (t - h.t0)) / (h.t1 - h.t0));
}

/** Cuánto bajó la flor que se engancha más abajo, de 0 a 1 (con un rebote al llegar). */
export function bajaEn(d: Datos, i: number, t: number): number {
  const e = d.engancha;
  if (!e || e.quien !== i || t < e.t) return 0;
  const u = (t - e.t) / 0.5;
  if (u >= 1) return 1 + 0.08 * Math.exp(-(u - 1) * 6) * Math.sin((u - 1) * 24);
  return u * u;
}

/** ¿Tiembla fuerte la flor `i` en `t`? Se sortea entre todas las que siguen. */
export function tiembla(d: Datos, i: number, t: number): number {
  const o = d.olas.find((x) => t >= x.t0 && t < x.t1);
  return o?.tiembla.includes(i) ? vientoEn(d, t) : 0;
}

/** La visita del colibrí en el segundo `t`, o `null` si no hay. */
export function visitaEn(d: Datos, t: number): { visita: Visita; indice: number } | null {
  for (let m = 0; m < d.visitas.length; m++) {
    const v = d.visitas[m] as Visita;
    const fin = m === d.visitas.length - 1 ? d.tPico : v.sale + T_TRASIEGO;
    if (t >= v.llega && t < fin) return { visita: v, indice: m };
  }
  return null;
}

/** Las que siguen en el árbol en el segundo `t`, en el orden de la lista. */
export function enElArbolEn(d: Datos, t: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < d.n; i++) if ((d.tCae[i] as number) > t) out.push(i);
  return out;
}

/** La hora en que la flor `i` llega al suelo, o infinito si no cae. */
export const tPosa = (d: Datos, i: number): number => (d.tCae[i] as number) + (d.durCaida[i] as number);

/** Quién cayó y ya está en el suelo en `t`, en el orden en que llegó. */
export function enElSueloEn(d: Datos, t: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < d.n; i++) if (tPosa(d, i) <= t) out.push(i);
  return out.sort((a, b) => tPosa(d, a) - tPosa(d, b) || a - b);
}
