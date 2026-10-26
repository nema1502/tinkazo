/**
 * Las señales de la carrera nueva, a nivel del plan (`audit-delatores race`).
 *
 * La carrera es pura: el plan (`planCarrera`) dice quién se echa y cuándo,
 * quién lleva la punta en cada instante, qué tanda pasa por el portón y en qué
 * orden entra el grupo a la recta, y todo eso sale de la ronda en unos
 * milisegundos. Así que no hace falta un navegador para medir si algo de eso
 * adivina a la ganadora: se arman 1.500 rondas, se mira lo que vería la sala y
 * se compara con el azar.
 *
 * Las señales (cada una, la que mira la sala):
 *
 * - **la punta** (`punta-*`): quién va primera, segunda... al empezar y a un
 *   cuarto, a la mitad y a tres cuartos del grupo. Una regla por lugar.
 * - **el tiempo en la punta** (`tiempo-*`): quién la llevó más, y quién nunca;
 *   y la diferencia entre lo que la llevó la ganadora y lo que la llevaron las
 *   otras finalistas.
 * - **las echadas** (`echa-*`): de dónde sale quien se echa (¿del fondo del
 *   grupo?) y si se echan en el orden de la lista.
 * - **las tandas** (`tanda`, `porton`, `punta-corral`): la tanda de la
 *   ganadora, su lugar en el portón y quién fue la última en pasar.
 * - **la entrada a la recta** (`entrada`) y **la recta** (`recta-25`, `-50`,
 *   `-75`, `recta-90`, `carril`, `duelo-lado`): en qué puesto va la ganadora, en
 *   qué carril corre y de qué lado queda la rival del duelo. La recta es la de
 *   siempre (`planRace`).
 * - **el relator** (`nombra-*`, `drama`): a quién nombra, con las mismas reglas
 *   que en los otros juegos (`senalesSubtitulos`), sobre las líneas del guion.
 *
 * Hay tres clases de resultado por ronda, y cada una tiene su prueba
 * (`delatores.mjs`):
 *
 * - `senales`: reglas de apuesta (`apuesta`), con el azar de esa ronda;
 * - `repartos`: en cuál de `K` casilleros cae la ganadora, contra el reparto
 *   parejo (chi cuadrado con K − 1 grados);
 * - `medias`: un número que sin señal vale cero (promedio, prueba z).
 *
 * Sin `Math.random` ni red. El ganador de cada ronda lo elige la selección del
 * protocolo con la semilla, como en un sorteo de verdad.
 */
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { nombresEn } from "./delatores-nombres.mjs";
import { apuesta, senalesSubtitulos } from "./delatores-senales.mjs";

/** Nombres de pila para las listas de la auditoría: con la inicial del apellido son únicos, y el relator los dice igual que están. */
const PILA = ["Ana", "Beto", "Carla", "Diego", "Elena", "Fabio", "Gala", "Hugo", "Ines", "Jorge", "Karla", "Luis"];

/**
 * La lista de `n` personas de la auditoría: "Ana A.", "Beto A."... y, desde la
 * trece, "Ana B.". Cada nombre ya es su forma corta (`corto`), así que el
 * relator los dice enteros y `nombresEn` los reconoce sin dudar.
 */
export const nombresDeAuditoria = (n) => Array.from({ length: n }, (_, i) => `${PILA[i % PILA.length]} ${String.fromCharCode(65 + Math.floor(i / PILA.length))}.`);

/** La semilla `i`: 64 hex, la misma de los otros juegos del auditor (distintas de las del auditor de emoción). */
export const semillaDe = (i) => createHash("sha256").update(`delator-${i}`).digest("hex");

const bytes = (hex) => Uint8Array.from(hex.match(/../g), (h) => parseInt(h, 16));
const promedio = (xs) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);

/**
 * Carga lo que hace falta del TypeScript del repositorio, sin construirlo: el
 * plan de la carrera, el azar del kit, los textos, la historia del director y
 * la selección del protocolo. Los carga Vite (`runnerImport`), el mismo que
 * usa `vite.config.ts`, así que valen los imports sin extensión.
 */
export async function cargarCarrera({ raiz = process.cwd() } = {}) {
  const { runnerImport } = await import("vite");
  const cargar = async (ruta) => (await runnerImport(resolve(raiz, ruta), { configFile: false, logLevel: "silent" })).module;
  const [show, kit, textos, drama, select, canonical] = await Promise.all([
    cargar("src/games/llamas/carrera-show.ts"),
    cargar("src/games/pixi/kit/azar.ts"),
    cargar("src/games/llamas/carrera-textos.ts"),
    cargar("src/games/drama.ts"),
    cargar("src/protocol/select.ts"),
    cargar("src/protocol/canonical.ts"),
  ]);
  return {
    planCarrera: show.planCarrera,
    alfabetico: show.alfabetico,
    sembrar: kit.sembrar,
    azarDe: kit.azarDe,
    textos: textos.TEXTOS_CARRERA,
    writeStory: drama.writeStory,
    select: select.select,
    listHash: canonical.listHash,
  };
}

/**
 * La ronda `i` con `n` personas, como la arma el kit (`crearJuego`): el azar
 * sembrado con la ronda, `ctx.azar` aparte, y la ganadora de la selección del
 * protocolo con esa semilla.
 */
export function rondaDe(lib, n, i, idioma = "es") {
  const ronda = semillaDe(i);
  const nombres = nombresDeAuditoria(n);
  const ganador = lib.select(bytes(ronda), lib.listHash(nombres), n, 1)[0];
  const rng = lib.sembrar(parseInt(ronda.slice(0, 8), 16) | 0);
  const dic = lib.textos[idioma];
  const ctx = {
    nombres,
    ganadores: [ganador],
    ronda,
    rng,
    idioma,
    txt: (clave, ...args) => {
      const v = dic[clave];
      return typeof v === "function" ? v(...args) : (v ?? clave);
    },
    azar: (etiqueta) => lib.azarDe(ronda, `race:${etiqueta}`),
    historia: (actores, g) => lib.writeStory(rng, actores, g),
  };
  return { ctx, ronda, nombres, ganador };
}

/** Los tres momentos del grupo en que se mira la punta: a un cuarto, a la mitad y a tres cuartos. */
const MOMENTOS = [0.25, 0.5, 0.75];
/** Cada cuántos segundos se mira quién lleva la punta para sumar su tiempo. */
const PASO = 0.1;

/**
 * Todo lo que ve la sala en una ronda, como observaciones para el auditor:
 * `{ arco, revelado, ganador, tiempos, senales, repartos, medias }`.
 *
 * - `senales[señal][regla]`: `{ acierta, azar }` o null (ver `apuesta`);
 * - `repartos[señal]`: `{ K, k, probs? }`, la ganadora cae en el casillero `k`
 *   de `K` (parejo, o con las `probs` de cada casillero);
 * - `medias[señal]`: `{ v, sd? }`, un número que sin señal vale cero;
 * - `tiempos[señal]`: en qué segundo del show se ve, para decir cuánto antes
 *   del cartel (`revelado`).
 */
export function observar(lib, plan, ctx) {
  const d = plan.datos;
  const w = d.campeona;
  const L = d.lanes.length;
  const kw = d.lanes.indexOf(w);
  const cae = (g) => d.tiempos.cae.get(g) ?? Infinity;
  const senales = {};
  const repartos = {};
  const medias = {};
  const tiempos = {};

  /* ------------------------------------------------------------ la punta */
  // Hay grupo si corren más de las ocho de la final y dura lo suficiente para mirarlo.
  const hayGrupo = d.gente.length > L && d.tAbre - d.tSalida > 4;
  if (hayGrupo) {
    const lugares = [["inicio", d.tSalida + 0.6], ...MOMENTOS.map((f) => [`${Math.round(f * 100)}`, d.tSalida + f * (d.tAbre - d.tSalida)])];
    for (const [nombre, t] of lugares) {
      const C = d.vivas(t);
      senales[`punta-${nombre}`] = {
        primera: apuesta([C[0]], C, w),
        ultima: apuesta([C[C.length - 1]], C, w),
        adelante: apuesta(C.slice(0, Math.floor(C.length / 2)), C, w),
      };
      tiempos[`punta-${nombre}`] = t;
    }

    /* ------------------------------------------- el tiempo en la punta */
    // Cuánto llevó la punta cada una, mirando el orden de verdad cada décima: a la mitad del grupo y al final.
    const T50 = d.tSalida + 0.5 * (d.tAbre - d.tSalida);
    const Tfin = d.tAbre - 0.2;
    const acum = new Map();
    let aMitad = null;
    for (let t = d.tSalida; t < Tfin; t += PASO) {
      if (aMitad === null && t >= T50) aMitad = new Map(acum);
      const l = d.lider(t);
      acum.set(l, (acum.get(l) ?? 0) + PASO);
    }
    aMitad ??= new Map(acum);
    const tiempoEn = (T, S) => {
      const C = d.vivas(T);
      const lleva = (g) => S.get(g) ?? 0;
      const tope = Math.max(...C.map(lleva));
      return { mas: apuesta(C.filter((g) => lleva(g) === tope), C, w), nunca: apuesta(C.filter((g) => lleva(g) === 0), C, w) };
    };
    senales["tiempo-mitad"] = tiempoEn(T50, aMitad);
    tiempos["tiempo-mitad"] = T50;
    senales["tiempo-fin"] = tiempoEn(Tfin, acum);
    tiempos["tiempo-fin"] = Tfin;
    // La ganadora contra el promedio de las otras que llegan a la recta: sin señal, la diferencia vale cero.
    const otras = d.vivas(Tfin).filter((g) => g !== w);
    if (otras.length) {
      medias["tiempo-dif"] = { v: ((acum.get(w) ?? 0) - promedio(otras.map((g) => acum.get(g) ?? 0))) / (Tfin - d.tSalida) };
      tiempos["tiempo-dif"] = Tfin;
    }

    /* ------------------------------------------------------ las echadas */
    const ec = d.tiempos.echadas;
    if (ec.length >= 3) {
      for (const [nombre, k] of [["primera", 0], ["mitad", Math.floor(ec.length / 2)], ["ultima", ec.length - 1]]) {
        const e = ec[k];
        const C = d.vivas(e.t - 0.01);
        if (!C.includes(e.quien)) continue;
        // Si las echadas no miran el lugar de nadie, la que se echa sale del fondo del grupo tanto como cualquiera.
        senales[`echa-${nombre}`] = { fondo: apuesta(C.slice(Math.ceil(C.length / 2)), C, e.quien) };
        tiempos[`echa-${nombre}`] = e.t;
      }
    }
    if (ec.length >= 5) {
      // Correlación de Spearman entre el orden en que se echan y el orden de la lista (alfabético):
      // sin señal vale cero, con varianza 1 / (m − 1); estandarizada, media 0 y desvío 1.
      const m = ec.length;
      const quienes = ec.map((e) => e.quien);
      const rango = new Map(lib.alfabetico(ctx.nombres, quienes).map((g, r) => [g, r + 1]));
      const suma = quienes.reduce((s, g, k) => s + (k + 1 - rango.get(g)) ** 2, 0);
      const rho = 1 - (6 * suma) / (m * (m * m - 1));
      medias["echa-orden-lista"] = { v: rho * Math.sqrt(m - 1), sd: 1 };
      tiempos["echa-orden-lista"] = ec[m - 1].t;
    }
  }

  /* ------------------------------------------------------------- tandas */
  if (d.tandas.length) {
    const T = d.tandas.length;
    const h = d.tandas.findIndex((x) => x.miembros.includes(w));
    if (h >= 0) {
      // Las tandas son del mismo tamaño (±1) y la ganadora sale de toda la lista: cae en cada una según su tamaño.
      repartos.tanda = { K: T, k: h, probs: d.tandas.map((x) => x.miembros.length / d.n) };
      tiempos.tanda = d.tandas[h].t0;
      const plazas = d.tandas[0].pasan.length;
      const j = d.tandas[h].pasan.indexOf(w);
      if (plazas > 1 && j >= 0 && d.tandas.every((x) => x.pasan.length === plazas)) {
        repartos.porton = { K: plazas, k: j };
        tiempos.porton = d.tandas[h].salidas[j];
      }
    }
    // "Adelante" es el corral: la última que pasó por el portón, apenas termina la última tanda.
    const corral = d.lider(d.tSalida - 0.05);
    senales["punta-corral"] = { "la-ultima": apuesta([corral], d.gente, w) };
    tiempos["punta-corral"] = d.tSalida - 0.05;
  }

  /* ------------------------------------------------ la entrada a la recta */
  const entrada = d.vivas(d.tAbre);
  const puestoEntrada = entrada.indexOf(w);
  if (puestoEntrada >= 0 && entrada.length === L && L >= 2) {
    repartos.entrada = { K: L, k: puestoEntrada };
    tiempos.entrada = d.tAbre;
  }

  /* ------------------------------------------------------------- la recta */
  if (L >= 2 && kw >= 0) {
    const puestoEn = (q) => {
      const xs = d.lanes.map((_, j) => d.final.pos(j, q));
      return xs.filter((x, j) => j !== kw && x > xs[kw]).length;
    };
    for (const q of [0.25, 0.5, 0.75]) {
      repartos[`recta-${Math.round(q * 100)}`] = { K: L, k: puestoEn(q) };
      tiempos[`recta-${Math.round(q * 100)}`] = d.tDeQ(q);
    }
    const al90 = d.lanes.map((g, j) => ({ g, x: d.final.pos(j, 0.9) })).sort((a, b) => b.x - a.x);
    const [a, b] = [al90[0].g, al90[1].g];
    senales["recta-90"] = { primera: apuesta([a], [a, b], w), segunda: apuesta([b], [a, b], w) };
    tiempos["recta-90"] = d.tDeQ(0.9);
    repartos.carril = { K: L, k: kw };
    tiempos.carril = d.tAbre;
    // El duelo: la rival corre arriba o abajo de la ganadora (sorteado).
    const { winner, rival } = d.final.story;
    if (plan.arco === "duelo" && rival !== winner) {
      const [arriba, abajo] = winner < rival ? [w, d.lanes[rival]] : [d.lanes[rival], w];
      senales["duelo-lado"] = { arriba: apuesta([arriba], [arriba, abajo], w), abajo: apuesta([abajo], [arriba, abajo], w) };
      tiempos["duelo-lado"] = d.tAbre;
    }
  }

  /* ------------------------------------------------------------ el relator */
  // Las líneas que dice, desde la salida (antes están las tandas, donde pasar por el portón ya es estar en el grupo),
  // con quién nombra cada una. "Sigue" es quien no se echó todavía y corre el grupo.
  const enGrupo = new Set(d.gente);
  const subs = plan.guion
    .filter((l) => l.texto !== undefined && l.t >= d.tSalida - 0.01)
    .map((l) => {
      const s = l.texto();
      return { t: l.t, s, quienes: nombresEn(s, ctx.nombres) };
    });
  const P = {
    names: ctx.nombres,
    n: d.n,
    w,
    subs,
    marks: [],
    frames: [],
    corte: d.tCrown,
    revelado: d.tCrown,
    arco: plan.arco,
    tiempos: {},
    sigue: (g, t) => enGrupo.has(g) && cae(g) > t,
    vivos: (t) => d.gente.filter((g) => cae(g) > t),
  };
  Object.assign(senales, senalesSubtitulos(P));
  Object.assign(tiempos, P.tiempos);

  return { arco: plan.arco, revelado: d.tCrown, ganador: w, tiempos, senales, repartos, medias };
}
