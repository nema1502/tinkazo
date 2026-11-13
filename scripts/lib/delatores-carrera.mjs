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
 *   qué carril corre y de qué lado queda la rival del duelo.
 * - **la fila del grupo** (`fila-grupo`, `fila-grupo-celular` y
 *   `entrada-con-filas-de-mas`): en qué fila larga la ganadora, contra el cupo
 *   de cada fila, en el escritorio y en el celular; y si las rondas en que el
 *   grupo tiene filas de más anuncian algo del puesto de entrada. Y su
 *   fila del dibujo (`fila-dibujo`, `fila-dibujo-celular`): si larga fuera de la
 *   fila que le daría el dibujo de siempre a su puesto de salida, contra la gente
 *   que larga fuera. Y su
 *   subfila (`subfila`, `subfila-celular`): si corre arriba o abajo de la línea
 *   de su fila, contra la gente de la ronda; y si comparte la fila con otra
 *   finalista (`fila-compartida`), contra las finalistas de la ronda.
 * - **el tropiezo en las piedritas** (`tropiezo`): si la víctima es la ganadora,
 *   contra su parte de los pares (llama, tramo de piedras) del sorteo; y si es
 *   finalista (`tropiezo-finalista`), contra la parte de finalistas entre las que
 *   corren al empezar su tramo. La recta es la de
 *   siempre (`planRace`) o, con `nueva`, la intercambiable (`carrera-recta.ts`):
 *   ahí se mide además `recta-88` (el acordeón) y `suceso-ganadora` (¿le pasan a
 *   la ganadora tantos sucesos como a cualquiera?), y el camino entero lo mira
 *   el adivinador (`delatores-bayes.mjs`). En las dos se mide a quién le tocan
 *   los obstáculos (`obstaculo-piedras`, `obstaculo-viento`, `obstaculo-salta-mal`):
 *   la ganadora tiene que recibir tantos como cualquiera.
 * - **lo que solo le pasa a la ganadora** (`senalesDeLaRecta`): la que sube o baja
 *   tres puestos de golpe entre dos compuertas hasta el 75 % (`subida-3`,
 *   `caida-3`) y, entre las cuatro de adelante a tres segundos de la meta, la que
 *   subió tres desde el 75 % (`subida-3-al-T3`), la que llega más rápido al corte
 *   de la cámara (`rapida-al-corte`) y la que queda con el hueco más raro con su
 *   vecina (`hueco-al-corte`, fila a mirar que no frena); la que va primera al 25, al 50 y
 *   al 75 % (`punta-repetida`); la que se atrasa o se adelanta medio cuerpo y
 *   vuelve sin un obstáculo encima (`atraso-vuelve`, `adelanto-vuelve`, este
 *   hasta antes del 75 %, antes de que se arme el grupo de punta), y lo mismo
 *   mientras se arma el grupo, entre las cuatro de adelante en el corte y
 *   contra las cuatro (`vuelve-en-el-grupo`); a quién
 *   le toca cada momento de la historia (`momento-plantada`, `-tropiezo`,
 *   `-pique`, `-escupida`, `-escupido`) y el tropiezo grande del susto
 *   (`susto`); y las líneas del relator que dicen el arco (`linea-arco`). En el
 *   corral, la vecina de un corte de la alternancia (`subfila-corte`) y la única
 *   de su lado en una fila de tres o más (`subfila-sola`, fila a mirar que no
 *   frena: `FILAS_A_MIRAR`), en las dos pantallas.
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
  const [show, kit, textos, drama, select, canonical, base, filas, forma, marcha, obstaculos, trayectorias, caminata, piedritas] = await Promise.all([
    cargar("src/games/llamas/carrera-show.ts"),
    cargar("src/games/pixi/kit/azar.ts"),
    cargar("src/games/llamas/carrera-textos.ts"),
    cargar("src/games/drama.ts"),
    cargar("src/protocol/select.ts"),
    cargar("src/protocol/canonical.ts"),
    cargar("src/games/llamas/carrera-base.ts"),
    cargar("src/games/llamas/carrera-filas.ts"),
    cargar("src/games/llamas/carrera-forma.ts"),
    cargar("src/games/llamas/carrera-marcha.ts"),
    cargar("src/games/llamas/carrera-obstaculos.ts"),
    cargar("src/games/llamas/carrera-trayectorias.ts"),
    cargar("src/games/llamas/carrera-caminata.ts"),
    cargar("src/games/llamas/carrera-piedritas.ts"),
  ]);
  return {
    planCarrera: show.planCarrera,
    /** El dibujo de siempre de las filas del grupo: la fila de cada puesto de salida (`fila-dibujo`). */
    filaDeRango: caminata.filaDeRango,
    /** Quién tropieza en las piedritas y en qué tramo, de la semilla y del plan, y entre quiénes se sortea (`tropiezo`). */
    victimaDelTropiezo: piedritas.victimaDelTropiezo,
    paresDelTropiezo: piedritas.paresDelTropiezo,
    alfabetico: show.alfabetico,
    sembrar: kit.sembrar,
    azarDe: kit.azarDe,
    textos: textos.TEXTOS_CARRERA,
    writeStory: drama.writeStory,
    select: select.select,
    listHash: canonical.listHash,
    /** Las medidas fijas del show (`carrera-base.ts`): la tarjeta de «cómo se juega», lo que no se estira, el vuelo de la cámara. */
    constantes: { TARJETA: base.TARJETA, FIJOS: base.FIJOS, T_VUELO: base.T_VUELO },
    /** El cuerpo de una llama en fracción de la recta (`carrera-marcha.ts`): la vara de los atrasos y adelantos que vuelven. */
    CUERPO: marcha.CUERPO,
    /**
     * El grupo de una ronda en una pantalla, con las filas repartidas según el carril (`carrera-filas.ts`), armado como lo arma
     * el auditor de sólidos: la pantalla, el nombre y el cuerpo salen del tamaño pedido. Devuelve la forma, la fila de cada
     * lugar, cuántas filas da la forma de siempre en esa pantalla y el lado de subfila de cada una (`subfilasDe`).
     */
    filasDelGrupo: (d, W, H) => {
      const u = W < H ? Math.min(W / 420, H / 900) : H / 720;
      const P = { w: W, h: H, u, retrato: W < H, top: 60 * u, bottom: H - 90 * u };
      const cuerpo = marcha.CUERPO * obstaculos.ENSANCHE * base.RECTA * W;
      const grupo = filas.formaDelGrupo({ P, d, nombrePx: 16 * u, nombreW: 110 * u, cuerpoPx: cuerpo });
      const deHoy = forma.formaDe(P, Math.max(1, d.gente.length), 16 * u, 110 * u);
      const signo = trayectorias.subfilasDe(d, grupo.forma, (p) => grupo.filaDeLugar[d.orden.rango(p)], cuerpo).signo;
      return { forma: grupo.forma, filaDeLugar: grupo.filaDeLugar, filasDeHoy: deHoy.filas, signo };
    },
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

/* ----------------------------------------------- las filas de la recta y del corral */

/** Las compuertas en que se mira el puesto de cada una para las subidas y las caídas: la entrada, el 25, el 50 y el 75 % de la recta. */
const COMPUERTAS = [0, 0.25, 0.5, 0.75];
/** Cada cuántos segundos se mira la recta para los atrasos y los adelantos que vuelven. */
const PASO_RECTA = 0.1;
/** Cuántos segundos antes y después del momento compara el observador de atrasos y adelantos. */
const VENTANA_VUELVE = 3.5;
/** Cuántos cuerpos tiene que quedar detrás (o delante) de lo que estaba antes y después para marcarla. */
const UMBRAL_VUELVE = 0.45;
/** El tramo de la recta que mira ese observador: después de la entrada y antes del final. */
const TRAMO_VUELVE = [0.12, 0.85];
/**
 * Hasta dónde mira el adelanto que vuelve: el punto de después no pasa del 75 % menos lo que se corre una compuerta (`CORRE_COMPUERTA`).
 * Entre el 75 % y tres segundos antes de la meta se arma el grupo de punta que encuadra la cámara, y la ganadora siempre entra en él: la que
 * se adelanta y después cede en ese tramo es una de las que quedan afuera, y eso es el piso de un cuarto de T-3 que mide `recta-T3` contra
 * las cuatro, no un delator contra las ocho. Como la compuerta del 75 % de cada llama se corre hasta 0,6 s, las que la tienen antes ya van
 * hacia el grupo al pasar el 75 %: el tramo limpio termina 0,6 s antes.
 */
const TOPE_ADELANTO = 0.75;
/** Lo más que la marcha corre la hora de una compuerta de una llama (`carrera-marcha.ts`, las compuertas corridas de las demás). */
const CORRE_COMPUERTA = 0.6;
/** Cuántos segundos antes del corte de la cámara se mira quién llega más rápido a él (`rapida-al-corte`). */
const ANTES_DEL_CORTE = 0.6;
/**
 * Lo más chico que se ve de un hueco raro en el corte (`hueco-al-corte`), en cuerpos: una milésima de cuerpo es menos de medio píxel en 1080p aun con
 * la llama más grande del cierre (450 píxeles de alto, `medir-escala-carrera`). Con las cuatro en su lugar de la grilla los huecos difieren en
 * millonésimas de cuerpo (el redondeo de las curvas tabuladas): elegir la rara por esa diferencia es elegir por la forma de la curva después del
 * corte, que nadie ve. Si ningún hueco se aparta de los otros lo que se ve, la ronda no informa.
 */
export const HUECO_VISIBLE = 0.001;
/** Cuánto tapa un obstáculo el movimiento de quien lo sufre: de dos segundos antes a seis después. */
const TAPA_OBSTACULO = [2, 6];
/** Los momentos de la historia que se miran uno por uno. */
const MOMENTOS_RECTA = ["plantada", "tropiezo", "pique", "escupida"];
/** Las líneas del relator que dicen el arco sin nombrar a nadie, y de qué arco es cada una. */
const LINEAS_DEL_ARCO = [["carDuelo", "duelo"], ["carAprieta", "duelo"], ["carRemonta", "remontada"], ["carCuela", "tapada"]];

/** Cuántos puestos es una subida grande: tres o, con menos de cuatro carriles, de la última a la primera. */
export const subidaGrande = (L) => Math.min(3, L - 1);

/** La franja de puestos de `plan.ts` (1 es la primera) entre las fracciones `a` y `b` del pelotón: `[desde, hasta]`. */
export function franjaDePuestos(L, a, b) {
  const lo = Math.min(L, Math.floor(a * L) + 1);
  const hi = Math.max(lo, Math.min(L, Math.ceil(b * L)));
  return [lo, hi];
}

/** El puesto (0 es la primera) de cada carril en `q`: cuántas van delante en el lugar que ve la sala. */
function puestosEn(f, L, q) {
  const xs = Array.from({ length: L }, (_, k) => f.pos(k, q));
  return xs.map((x, k) => xs.filter((y, j) => j !== k && y > x).length);
}

/** Una media de Bernoulli: si la ganadora (`kw`) está entre las `tocadas`, contra la parte de los `L` carriles que lo están. Null si no informa. */
function bernoulli(tocadas, kw, L) {
  const p = [...tocadas].filter((k) => k >= 0 && k < L).length / L;
  if (!(p > 0 && p < 1)) return null;
  return { v: ((tocadas.has(kw) ? 1 : 0) - p) / Math.sqrt(p * (1 - p)), sd: 1 };
}

/**
 * Las filas de la recta que miran lo que solo le pasa a la ganadora (o que nunca le pasa): las subidas y las caídas grandes, la punta que se
 * repite, los atrasos y adelantos que vuelven, los momentos de la historia, el susto y las líneas del arco. Leen el lugar de cada carril en el
 * plan final (`d.final.pos`) y la lista de momentos del plan; a la ganadora solo la usan para juzgar.
 *
 * Los momentos se leen de `d.final.marcha.momentos` y, si el plan no la tiene, de la historia (`d.final.story.beats`): así la misma fila mide la
 * carrera de hoy y la que reparte esos momentos entre todas. El susto, solo de `d.final.marcha.sustos` (los carriles con arco susto): sin ese
 * campo no hay fila. Son de la carrera de siempre: `observar` no las pide en la nueva.
 *
 * Devuelve `{ senales, medias, tiempos }` como `observar`. `guion` son las líneas del relator (`{ t, texto }`), `txt` el diccionario de la ronda
 * y `cuerpo` el cuerpo de una llama en fracción de la recta (sin él no se miran los atrasos ni los adelantos).
 */
export function senalesDeLaRecta({ d, guion = [], txt, cuerpo }) {
  const senales = {};
  const medias = {};
  const tiempos = {};
  const f = d.final;
  const L = d.lanes.length;
  const w = d.campeona;
  const kw = d.lanes.indexOf(w);
  if (L < 2 || kw < 0) return { senales, medias, tiempos };
  const personas = (ks) => ks.map((k) => d.lanes[k]);
  const carriles = Array.from({ length: L }, (_, k) => k);
  const lug = COMPUERTAS.map((q) => puestosEn(f, L, q));
  const U = subidaGrande(L);

  /* ------------------------------------- la subida y la caída grandes */
  // Entre dos compuertas seguidas, hasta el 75 %: en la carrera de siempre las demás conservan su orden y se mueven de a uno.
  for (const [clave, regla, sentido] of [["subida-3", "subio", 1], ["caida-3", "cayo", -1]]) {
    const marcadas = new Set();
    let t = Infinity;
    for (let s = 0; s + 1 < COMPUERTAS.length; s++) {
      for (const k of carriles) {
        if (sentido * (lug[s][k] - lug[s + 1][k]) < U) continue;
        marcadas.add(k);
        t = Math.min(t, d.tDeQ(COMPUERTAS[s + 1]));
      }
    }
    senales[clave] = { [regla]: apuesta(personas([...marcadas]), d.lanes, w) };
    tiempos[clave] = Number.isFinite(t) ? t : d.tDeQ(COMPUERTAS[COMPUERTAS.length - 1]);
  }

  // A tres segundos de la meta la cámara corta y encuadra a las cuatro de adelante: entre ellas, la que subió tres o más desde el 75 %, contra las
  // cuatro (la ganadora está siempre entre las cuatro, y eso ya lo mide `recta-T3`). Con cuatro carriles o menos, las cuatro son todas.
  const tT3 = d.tCrown - 3;
  /** Las cuatro de adelante en el corte de la cámara (con cuatro carriles o menos, todas). Vacío si el corte no cae después del 75 %. */
  let cuatroAlCorte = [];
  if (tT3 > d.tDeQ(0.75)) {
    const lT3 = puestosEn(f, L, d.q(tT3));
    const cuatro = carriles.filter((k) => lT3[k] < Math.min(4, L));
    cuatroAlCorte = cuatro;
    const subieron = cuatro.filter((k) => lug[3][k] - lT3[k] >= U);
    senales["subida-3-al-T3"] = { subio: apuesta(personas(subieron), personas(cuatro), w) };
    tiempos["subida-3-al-T3"] = tT3;
    // En el corte, entre esas mismas (con tres carriles o más): la que llega más rápido (la que más avanzó en los 0,6 s antes) y la que queda
    // con el hueco más raro con su vecina de adelante (la primera, con la segunda), contra la mediana de los huecos. Una sola marcada, contra
    // las cuatro: si la ganadora llega al corte todavía subiendo, o queda fuera de la grilla de las demás, se ve antes de que se sepa nada.
    if (L >= 3) {
      const en = (t) => {
        const q = d.q(t);
        return carriles.map((k) => f.pos(k, q));
      };
      const antes = en(tT3 - ANTES_DEL_CORTE);
      const corte = en(tT3);
      const rapida = cuatro.reduce((b, k) => (b < 0 || corte[k] - antes[k] > corte[b] - antes[b] ? k : b), -1);
      senales["rapida-al-corte"] = { "la-mas-rapida": apuesta(personas([rapida]), personas(cuatro), w) };
      tiempos["rapida-al-corte"] = tT3;
      const orden = [...cuatro].sort((a, b) => corte[b] - corte[a]);
      const hueco = new Map(orden.map((k, j) => [k, j === 0 ? corte[k] - corte[orden[1]] : corte[orden[j - 1]] - corte[k]]));
      const hs = [...hueco.values()].sort((a, b) => a - b);
      const mediana = hs[Math.floor(hs.length / 2)];
      const rara = cuatro.reduce((b, k) => (b < 0 || Math.abs(hueco.get(k) - mediana) > Math.abs(hueco.get(b) - mediana) ? k : b), -1);
      const seVe = !(cuerpo > 0) || Math.abs(hueco.get(rara) - mediana) > HUECO_VISIBLE * cuerpo;
      senales["hueco-al-corte"] = { "el-mas-raro": seVe ? apuesta(personas([rara]), personas(cuatro), w) : null };
      tiempos["hueco-al-corte"] = tT3;
    }
  }

  /* ------------------------------------------------ la punta que se repite */
  const lideres = [1, 2, 3].map((s) => lug[s].indexOf(0));
  senales["punta-repetida"] = { "la-misma": lideres.every((k) => k === lideres[0]) ? apuesta([d.lanes[lideres[0]]], d.lanes, w) : null };
  tiempos["punta-repetida"] = d.tDeQ(0.75);

  /* ------------------------------------------- el atraso y el adelanto que vuelven */
  // Cada décima, el lugar de cada una en cuerpos respecto del promedio del pelotón. Se marca la que, entre el 12 y el 85 % de la recta, queda medio
  // cuerpo detrás (o delante) de donde estaba 3,5 s antes y de donde está 3,5 s después, sin un obstáculo encima (suyo, o de quien escupe). Todo
  // lo que se mira se completa antes del corte de la cámara (tres segundos antes de la meta), y el adelanto, 0,6 s antes del 75 % (`TOPE_ADELANTO`).
  if (cuerpo > 0) {
    const tA = d.tAbre;
    const N = Math.floor((d.tCrown - tA) / PASO_RECTA + 1e-6) + 1;
    const x = carriles.map(() => new Float64Array(N));
    for (let j = 0; j < N; j++) {
      const q = d.q(tA + j * PASO_RECTA);
      let suma = 0;
      for (const k of carriles) {
        x[k][j] = (f.pos(k, q) - q) / cuerpo;
        suma += x[k][j];
      }
      for (const k of carriles) x[k][j] -= suma / L;
    }
    const tapado = carriles.map(() => new Uint8Array(N));
    const tapar = (k, tc) => {
      if (!(k >= 0 && k < L)) return;
      const a = Math.max(0, Math.floor((tc - TAPA_OBSTACULO[0] - tA) / PASO_RECTA));
      const b = Math.min(N - 1, Math.ceil((tc + TAPA_OBSTACULO[1] - tA) / PASO_RECTA));
      for (let j = a; j <= b; j++) tapado[k][j] = 1;
    };
    for (const o of f.obstaculos ?? []) {
      if (o.tipo === "salto") for (const m of o.malas ?? []) tapar(m, d.tDeQ(o.llegan?.[m] ?? o.q));
      else if (o.tipo === "escupida") {
        tapar(o.carriles[0], d.tDeQ(o.q));
        tapar(o.escupe, d.tDeQ(o.q));
      } else for (const k of o.carriles ?? []) tapar(k, d.tDeQ(o.q));
    }
    const h = Math.round(VENTANA_VUELVE / PASO_RECTA);
    /** La décima de la hora `t`, hacia abajo. */
    const decima = (t) => Math.floor((t - tA) / PASO_RECTA + 1e-6);
    const jA = Math.max(h, Math.floor((d.tDeQ(TRAMO_VUELVE[0]) - tA) / PASO_RECTA));
    // El punto de después no pasa de tres segundos antes de la meta: ahí corta la cámara y lo que sigue es la llegada, donde a la ganadora
    // siempre le sale que vuelve (llega primera).
    const jB = Math.min(N - 1 - h, Math.ceil((d.tDeQ(TRAMO_VUELVE[1]) - tA) / PASO_RECTA), decima(d.tCrown - 3) - h);
    // El adelanto, con el punto de después hasta 0,6 s antes del 75 % (`TOPE_ADELANTO`).
    const jBAdelanto = Math.min(jB, decima(d.tDeQ(TOPE_ADELANTO) - CORRE_COMPUERTA) - h);
    // La primera décima en que cada una queda marcada (−1 si nunca).
    const atras = new Array(L).fill(-1);
    const adelante = new Array(L).fill(-1);
    for (const k of carriles) {
      const xk = x[k];
      for (let j = jA; j <= jB; j++) {
        if (tapado[k][j - h] || tapado[k][j] || tapado[k][j + h]) continue;
        const antes = xk[j - h], despues = xk[j + h], ahora = xk[j];
        if (atras[k] < 0 && Math.min(antes, despues) - ahora >= UMBRAL_VUELVE) atras[k] = j;
        if (adelante[k] < 0 && j <= jBAdelanto && ahora - Math.max(antes, despues) >= UMBRAL_VUELVE) adelante[k] = j;
      }
    }
    for (const [clave, primera, fin] of [["atraso-vuelve", atras, jB], ["adelanto-vuelve", adelante, jBAdelanto]]) {
      const marcadas = carriles.filter((k) => primera[k] >= 0);
      senales[clave] = { marcadas: apuesta(personas(marcadas), d.lanes, w) };
      // Se ve cuando vuelve: 3,5 s después de la primera marca (o al cerrar el tramo, si no hay ninguna).
      const j0 = marcadas.length ? Math.min(...marcadas.map((k) => primera[k])) : Math.max(0, fin);
      tiempos[clave] = Math.min(d.tCrown, tA + (j0 + h) * PASO_RECTA);
    }

    // La misma marca en el tramo del grupo de punta, contra las cuatro: el atraso y el adelanto que vuelven y se terminan de ver entre el 75 %
    // (menos lo que se corre una compuerta) y el corte de la cámara. En ese tramo se arma el grupo que encuadra la cámara y la ganadora siempre
    // entra en él, así que contra las ocho no es pareja ni en la carrera más justa (es el piso de un cuarto de `recta-T3`): se juzga entre las
    // cuatro de adelante en el corte, contra las cuatro. Si la ganadora cede o se atrasa y vuelve en ese tramo de otra forma que las otras tres
    // del grupo, se ve acá.
    if (cuatroAlCorte.length && tT3 > d.tDeQ(0.75)) {
      const jGrupo = Math.min(N - 1 - h, decima(tT3) - h);
      const desde = Math.max(jA, jBAdelanto + 1);
      const atrasG = new Set(), adelanteG = new Set();
      for (const k of cuatroAlCorte) {
        const xk = x[k];
        for (let j = desde; j <= jGrupo; j++) {
          if (tapado[k][j - h] || tapado[k][j] || tapado[k][j + h]) continue;
          const antes = xk[j - h], despues = xk[j + h], ahora = xk[j];
          if (Math.min(antes, despues) - ahora >= UMBRAL_VUELVE) atrasG.add(k);
          if (ahora - Math.max(antes, despues) >= UMBRAL_VUELVE) adelanteG.add(k);
        }
      }
      senales["vuelve-en-el-grupo"] = { atraso: apuesta(personas([...atrasG]), personas(cuatroAlCorte), w), adelanto: apuesta(personas([...adelanteG]), personas(cuatroAlCorte), w) };
      tiempos["vuelve-en-el-grupo"] = tT3;
    }
  }

  /* ---------------------------------------------- los momentos de la historia */
  // Contra la parte de carriles que tienen cada momento (z de Bernoulli, como los obstáculos). La escupida da dos: quien escupe y a quien le llega.
  const lista = f.marcha?.momentos ?? f.story?.beats ?? [];
  const momento = (clave, bs, quien) => {
    const r = bernoulli(new Set(bs.map(quien)), kw, L);
    if (!r) return;
    medias[clave] = r;
    tiempos[clave] = d.tDeQ(Math.min(...bs.map((b) => b.at)));
  };
  for (const kind of MOMENTOS_RECTA) momento(`momento-${kind}`, lista.filter((b) => b.kind === kind), (b) => b.actor);
  momento("momento-escupido", lista.filter((b) => b.kind === "escupida" && b.target !== undefined), (b) => b.target);

  /* --------------------------------------------------------------- el susto */
  // El tropiezo grande del susto, de los carriles que lo tienen según la marcha (`marcha.sustos`). Sin ese campo no hay fila: armarla con la
  // ganadora cuando el arco es susto no mediría nada que vea la sala (daría lo mismo en cada ronda), y lo de hoy ya lo miden `momento-tropiezo`
  // (el tropiezo del susto está en la historia) y `atraso-vuelve`.
  const sustos = Array.isArray(f.marcha?.sustos) ? f.marcha.sustos.map((s) => (typeof s === "number" ? s : s.actor)) : [];
  const rs = bernoulli(new Set(sustos), kw, L);
  if (rs) {
    medias.susto = rs;
    const tropiezos = lista.filter((b) => b.kind === "tropiezo" && sustos.includes(b.actor)).map((b) => b.at);
    tiempos.susto = d.tDeQ(tropiezos.length ? Math.min(...tropiezos) : 0.5);
  }

  /* ---------------------------------------------------- las líneas del arco */
  // El relator dice el arco sin nombrar a nadie, y el arco dice en qué franja va la ganadora al 75 % (`plan.ts`): el duelo en el primer cuarto, la
  // remontada y la tapada en la mitad de atrás. La sala apuesta por las que van ahí.
  if (typeof txt === "function") {
    const moldes = LINEAS_DEL_ARCO.map(([c, arco]) => [txt(c), arco]).filter(([s]) => typeof s === "string" && s.length > 0);
    let dicha = null;
    for (const l of guion) {
      if (l.texto === undefined || !(l.t < d.tCrown)) continue;
      const s = typeof l.texto === "function" ? l.texto() : l.texto;
      const m = moldes.find(([molde]) => molde === s);
      if (m && (!dicha || l.t < dicha.t)) dicha = { t: l.t, arco: m[1] };
    }
    if (dicha) {
      const [lo, hi] = dicha.arco === "duelo" ? franjaDePuestos(L, 0, 0.25) : franjaDePuestos(L, 0.5, 1);
      const enLaFranja = carriles.filter((k) => lug[3][k] + 1 >= lo && lug[3][k] + 1 <= hi);
      senales["linea-arco"] = { franja: apuesta(personas(enLaFranja), d.lanes, w) };
      tiempos["linea-arco"] = Math.max(dicha.t, d.tDeQ(0.75));
    }
  }

  return { senales, medias, tiempos };
}

/**
 * Las filas que se miran sin frenar: si dan delator, el auditor las cuenta como a mirar.
 *
 * - `subfila-sola` sale de la regla de los carriles del corral (dos finalistas de una misma fila van siempre a lados opuestos, así que la
 *   que va sola de su lado es casi siempre finalista): se mira hasta que esa regla cambie, y cambiarla pide cuidar que dos finalistas de la
 *   misma fila no se crucen al pasar a sus carriles. Con 1.500 rondas, la ganadora va sola de su lado 1,30 veces lo que le toca con 18
 *   personas (649 rondas contra 500 esperadas, p menor que 1e-12) y 1,89 veces con 30 (31 contra 16,4, p 2,4e-4).
 * - `hueco-al-corte` (13 de noviembre de 2026): en el corte de la cámara, en las rondas en que se ve un hueco raro (de 7 a 15 de cada 100
 *   con 4 a 200 personas), la del hueco raro con su vecina es la ganadora más de lo que le toca. Con 1.500 rondas, contra 25 %: 47 de 105
 *   con 4 (44,8 %, p 1,7e-5), 55 de 117 con 5 (47 %, p 4,3e-7), 62 de 172 con 6 (36 %, p 0,0017), 71 de 194 con 7 (36,6 %, p 4,5e-4),
 *   75 de 210 con 8 (35,7 %, p 7,1e-4), 89 de 226 con 18 (39,4 %, p 2,7e-6), 67 de 180 con 30 (37,2 %, p 3,8e-4), 62 de 173 con 60
 *   (35,8 %, p 0,0020), 57 de 171 con 100 (33,3 %, p 0,018, limpia) y 58 de 164 con 200 (35,4 %, p 0,0040). Con 3 sale al revés: 7 de
 *   55, contra 33,3 % (p 9,0e-4). Con 2 la fila no sale. La causa está medida, capa por capa y con 4 personas: con la marcha sola la de
 *   hueco raro es la ganadora 0,261 de las veces, con los obstáculos 0,260 y con el tope de aceleración encima, 0,291. El tope reparte
 *   hacia atrás, a los cuadros de antes del corte, el exceso de lo que la ganadora hace después (subir a su puesto y cruzar primera), y eso corre su lugar en
 *   el corte unas diezmilésimas de cuerpo (3,3e-4 de media, contra 1,5e-4 de las otras). El arreglo es un tope de aceleración que no
 *   cruce el corte: lo de antes del corte corregido solo con lo de antes, y lo de después desde el lugar y la velocidad que cada una trae.
 *   Se probaron cuatro versiones y ninguna cerró sin romper otra prueba de la marcha, así que la fila se mira hasta que entre ese tope.
 */
export const FILAS_A_MIRAR = new Set(["subfila-sola", "subfila-sola-celular", "hueco-al-corte"]);

/** El veredicto con que cuenta una fila en el resumen del auditor: el de su prueba, salvo que una fila a mirar no frena. */
export const cuentaComo = (senal, veredicto) => (veredicto === "delator" && FILAS_A_MIRAR.has(senal) ? "mirar" : veredicto);

/**
 * Las filas de la subfila del corral: dentro de cada fila del grupo, en el orden del grupo (`rango`), las que van seguidas del mismo lado de la
 * línea (un corte de la alternancia, `subfila-corte`) y, en las filas de tres o más, la única de su lado (`subfila-sola`). Si la ganadora es
 * vecina de un corte, o va sola de su lado, contra la parte de la gente de la ronda que lo es. `fila(p)` es la fila de `p`, `signo` el lado de
 * cada una (−1 arriba, 1 abajo, 0 en la línea). Devuelve los dos repartos (o null, si nadie lo es o lo es toda la gente).
 */
export function senalesDeLaSubfila({ gente, fila, rango, signo, w }) {
  const porFila = new Map();
  for (const p of gente) {
    const fl = fila(p);
    if (!porFila.has(fl)) porFila.set(fl, []);
    porFila.get(fl).push(p);
  }
  const vecinas = new Set();
  const solas = new Set();
  for (const miembros of porFila.values()) {
    miembros.sort((a, b) => rango(a) - rango(b) || a - b);
    const lados = miembros.map((p) => signo.get(p) ?? 0);
    if (miembros.length >= 3) {
      for (const s of [-1, 1]) {
        const deEseLado = miembros.filter((_, j) => lados[j] === s);
        if (deEseLado.length === 1) solas.add(deEseLado[0]);
      }
    }
    for (let j = 0; j + 1 < miembros.length; j++) {
      if (lados[j] !== 0 && lados[j] === lados[j + 1]) {
        vecinas.add(miembros[j]);
        vecinas.add(miembros[j + 1]);
      }
    }
  }
  const reparto = (conjunto) => {
    const p = conjunto.size / gente.length;
    return p > 0 && p < 1 ? { K: 2, k: conjunto.has(w) ? 1 : 0, probs: [1 - p, p] } : null;
  };
  return { "subfila-corte": reparto(vecinas), "subfila-sola": reparto(solas) };
}

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

  /* ------------------------------------------- la fila del grupo */
  // En qué fila larga la ganadora: cada fila recibe según su cupo de lugares, así que el reparto va contra el cupo de esa ronda.
  let grupoEscritorio = null;
  if (typeof lib.filasDelGrupo === "function" && d.gente.length >= 2 && d.orden.rango(w) >= 0) {
    for (const [clave, W, H] of [["fila-grupo", 1366, 768], ["fila-grupo-celular", 390, 844]]) {
      const g = lib.filasDelGrupo(d, W, H);
      if (clave === "fila-grupo") grupoEscritorio = g;
      // Los cortes de la alternancia y la única de su lado de la subfila (`senalesDeLaSubfila`), también cuando el grupo es una sola fila.
      if (g.signo) {
        const sufijo = clave === "fila-grupo" ? "" : "-celular";
        const sf = senalesDeLaSubfila({ gente: d.gente, fila: (p) => g.filaDeLugar[d.orden.rango(p)], rango: (p) => d.orden.rango(p), signo: g.signo, w });
        for (const [nombre, r] of Object.entries(sf)) {
          if (!r) continue;
          repartos[`${nombre}${sufijo}`] = r;
          tiempos[`${nombre}${sufijo}`] = d.tSalida + 0.6;
        }
      }
      const filaW = g.filaDeLugar[d.orden.rango(w)];
      if (filaW === undefined || g.forma.filas < 2) continue;
      const conteo = new Array(g.forma.filas).fill(0);
      for (const f of g.filaDeLugar) conteo[f]++;
      repartos[clave] = { K: g.forma.filas, k: filaW, probs: conteo.map((c) => c / d.gente.length) };
      tiempos[clave] = d.tSalida + 0.6;
      // La subfila de la ganadora (arriba o abajo de la línea de su fila), contra cuántas van arriba en toda la gente de la ronda: si estar
      // arriba o abajo marcara a las finalistas, la ganadora caería de un lado más que la gente.
      const sw = g.signo?.get(w);
      if (sw === -1 || sw === 1) {
        // Contra las que van fuera de la línea: la que está sola en su fila va en ella.
        let arriba = 0, fuera = 0;
        for (const p of d.gente) {
          const s = g.signo.get(p);
          if (s === -1) arriba++;
          if (s === -1 || s === 1) fuera++;
        }
        const sub = clave === "fila-grupo" ? "subfila" : "subfila-celular";
        repartos[sub] = { K: 2, k: sw === -1 ? 0 : 1, probs: [arriba / fuera, 1 - arriba / fuera] };
        tiempos[sub] = d.tSalida + 0.6;
      }
      // Si la ganadora larga fuera del dibujo de siempre (`filaDeRango`, una fila tras otra por puesto de salida), contra la parte de la gente
      // que larga fuera de él. En el corral el orden se lee: si las demás prefirieran su fila de siempre y las finalistas fueran a la de su
      // carril, la que queda fuera del dibujo sería una finalista o una desplazada por una, desde antes de la salida.
      if (typeof lib.filaDeRango === "function") {
        const fueraDelDibujo = (p) => g.filaDeLugar[d.orden.rango(p)] !== lib.filaDeRango(d.orden.rango(p), g.forma.filas);
        const fuera = d.gente.filter(fueraDelDibujo).length / d.gente.length;
        if (fuera > 0 && fuera < 1) {
          const dib = clave === "fila-grupo" ? "fila-dibujo" : "fila-dibujo-celular";
          repartos[dib] = { K: 2, k: fueraDelDibujo(w) ? 1 : 0, probs: [1 - fuera, fuera] };
          tiempos[dib] = d.tSalida;
        }
      }
      // Si la ganadora comparte su fila con otra finalista (una arriba y otra abajo), contra cuántas finalistas la comparten.
      if (clave === "fila-grupo" && L >= 2) {
        const filaDe = (p) => g.filaDeLugar[d.orden.rango(p)];
        const comparte = (p) => d.lanes.some((q) => q !== p && filaDe(q) === filaDe(p));
        const fraccion = d.lanes.filter(comparte).length / L;
        if (fraccion > 0 && fraccion < 1) {
          repartos["fila-compartida"] = { K: 2, k: comparte(w) ? 1 : 0, probs: [1 - fraccion, fraccion] };
          tiempos["fila-compartida"] = d.tSalida + 0.6;
        }
      }
    }
  }

  /* ------------------------------------------------------------ el tropiezo */
  // Quién tropieza en las piedritas sale de la semilla y del plan (`victimaDelTropiezo`), parejo entre los pares (llama, tramo de piedras) de
  // las que siguen en pie al empezar cada tramo (con la carrera de antes, al terminarlo): la ganadora, contra su parte de esos pares. La
  // pantalla solo decide si se ve, nunca a quién.
  if (typeof lib.victimaDelTropiezo === "function" && d.semillaRocas !== undefined) {
    const e = { semilla: d.semillaRocas, tramos: d.tramos, gente: d.gente, cae };
    const v = lib.victimaDelTropiezo(e);
    if (v) {
      const pares = lib.paresDelTropiezo(e);
      const p = pares.filter(([q]) => q === w).length / pares.length;
      if (p > 0 && p < 1) {
        repartos.tropiezo = { K: 2, k: v.quien === w ? 1 : 0, probs: [1 - p, p] };
        tiempos.tropiezo = d.tramos[v.tramo].t0;
      }
      // Y si la que tropieza es finalista, contra la parte de finalistas entre las que corren al empezar ese tramo, que es lo que ve la sala: si
      // se sorteara entre las que siguen en pie al terminarlo, la que tropieza no se echaría nunca en ese tramo, y ver tropezar a una diría que
      // llega a la recta. No mira la regla del sorteo: la cuenta es la de las que corren.
      const tramo = d.tramos[v.tramo];
      const corren = d.gente.filter((g) => cae(g) >= tramo.t0);
      const finalistas = new Set(d.lanes);
      const pf = corren.length ? corren.filter((g) => finalistas.has(g)).length / corren.length : 0;
      if (pf > 0 && pf < 1) {
        repartos["tropiezo-finalista"] = { K: 2, k: finalistas.has(v.quien) ? 1 : 0, probs: [1 - pf, pf] };
        tiempos["tropiezo-finalista"] = tramo.t0;
      }
    }
  }

  /* ------------------------------------------------ la entrada a la recta */
  const entrada = d.vivas(d.tAbre);
  const puestoEntrada = entrada.indexOf(w);
  if (puestoEntrada >= 0 && entrada.length === L && L >= 2) {
    repartos.entrada = { K: L, k: puestoEntrada };
    tiempos.entrada = d.tAbre;
    // Las filas de más se ven desde la salida: si anuncian algo, lo anuncian también del puesto de entrada de la ganadora.
    if (grupoEscritorio && grupoEscritorio.forma.filas > grupoEscritorio.filasDeHoy) {
      repartos["entrada-con-filas-de-mas"] = { K: L, k: puestoEntrada };
      tiempos["entrada-con-filas-de-mas"] = d.tAbre;
    }
  }

  /* ------------------------------------------------------------- la recta */
  if (L >= 2 && kw >= 0) {
    const puestoEn = (q) => {
      const xs = d.lanes.map((_, j) => d.final.pos(j, q));
      return xs.filter((x, j) => j !== kw && x > xs[kw]).length;
    };
    // La carrera nueva se decide al 88 %: ahí se mira el acordeón; el 90 % ya es el ataque y no se juzga como señal limpia.
    for (const q of d.nueva ? [0.25, 0.5, 0.75, 0.88] : [0.25, 0.5, 0.75]) {
      repartos[`recta-${Math.round(q * 100)}`] = { K: L, k: puestoEn(q) };
      tiempos[`recta-${Math.round(q * 100)}`] = d.tDeQ(q);
    }
    // A tres segundos de la meta la cámara de la meta corta de frente y encuadra el grupo de punta: la ganadora está entre las cuatro de adelante, y entre las
    // cuatro (como a 1,5 s entre las tres) cae parejo: que se sepa cuál de ellas es, es un delator. Un casillero de más, con probabilidad cero, recoge
    // las rondas en que la ganadora queda afuera (si pasa una sola vez, es un fallo).
    for (const [nombre, segundos, tope] of [["recta-T3", 3, 4], ["recta-T15", 1.5, 3]]) {
      if (L < tope) continue;
      const qT = d.q(d.tCrown - segundos);
      repartos[nombre] = { K: tope + 1, k: Math.min(puestoEn(qT), tope), probs: [...Array.from({ length: tope }, () => 1 / tope), 0] };
      tiempos[nombre] = d.tCrown - segundos;
    }
    const qTop = d.nueva ? 0.88 : 0.9;
    const alTop = d.lanes.map((g, j) => ({ g, x: d.final.pos(j, qTop) })).sort((a, b) => b.x - a.x);
    const [a, b] = [alTop[0].g, alTop[1].g];
    senales[`recta-${Math.round(qTop * 100)}`] = { primera: apuesta([a], [a, b], w), segunda: apuesta([b], [a, b], w) };
    tiempos[`recta-${Math.round(qTop * 100)}`] = d.tDeQ(qTop);
    if (d.nueva) {
      // Los sucesos le pasan a cualquiera: la ganadora tiene uno tantas veces como le toca por azar (z de Bernoulli).
      const tocadas = new Set();
      for (const bt of d.final.story.beats) {
        tocadas.add(bt.actor);
        if (bt.target !== undefined) tocadas.add(bt.target);
      }
      const p = tocadas.size / L;
      if (p > 0 && p < 1) {
        medias["suceso-ganadora"] = { v: ((tocadas.has(kw) ? 1 : 0) - p) / Math.sqrt(p * (1 - p)), sd: 1 };
        tiempos["suceso-ganadora"] = d.tDeQ(0.56);
      }
    }
    // Los obstáculos (`carrera-obstaculos.ts`) le tocan a cualquiera: a quién le caen las piedras, a quién le toca la ráfaga y quién salta mal.
    // La ganadora tiene uno tantas veces como le toca por azar (z de Bernoulli), igual que los sucesos de la recta nueva.
    for (const o of d.final.obstaculos ?? []) {
      // La escupida da dos filas: a quién le llega y quién escupe (la vecina también pierde un poco, y ninguna de las dos puede delatar).
      const filas = o.tipo === "escupida"
        ? [["obstaculo-escupida", o.carriles], ["obstaculo-escupe", [o.escupe]]]
        : [[o.tipo === "piedras" ? "obstaculo-piedras" : o.tipo === "salto" ? "obstaculo-salta-mal" : "obstaculo-viento", o.tipo === "salto" ? o.malas : o.carriles]];
      for (const [clave, tocadas] of filas) {
        const p = tocadas.length / L;
        if (!(p > 0 && p < 1)) continue;
        medias[clave] = { v: ((tocadas.includes(kw) ? 1 : 0) - p) / Math.sqrt(p * (1 - p)), sd: 1 };
        tiempos[clave] = d.tDeQ(o.q);
      }
    }
    // Lo que en la carrera de siempre le pasa solo a la ganadora, o nunca le pasa: las subidas y caídas grandes, la punta repetida, los atrasos y
    // adelantos que vuelven, los momentos de la historia, el susto y las líneas del arco (`senalesDeLaRecta`). Solo en la de siempre: en la
    // nueva el arco es una etiqueta de cómo llegó la ganadora (el susto, que iba adelante al 88 %) y sus sucesos los mide `suceso-ganadora`.
    if (!d.nueva) {
      const deLaRecta = senalesDeLaRecta({ d, guion: plan.guion, txt: ctx.txt, cuerpo: lib.CUERPO });
      Object.assign(senales, deLaRecta.senales);
      Object.assign(medias, deLaRecta.medias);
      Object.assign(tiempos, deLaRecta.tiempos);
    }
    repartos.carril = { K: L, k: kw };
    tiempos.carril = d.tAbre;
    // El duelo: la rival corre arriba o abajo de la ganadora (sorteado).
    const { winner, rival } = d.final.story;
    if (!d.nueva && plan.arco === "duelo" && rival !== winner) {
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
  // Las líneas de los obstáculos nombran a la víctima: la ganadora tiene que ser nombrada tantas veces como cualquiera
  // de la final (z de Bernoulli, como las filas de los obstáculos). Se reconocen por su molde en el idioma de la ronda.
  const SENAL = "\u0001";
  const moldes = ["carCuidadoPiedras", "carTumbaValla", "carEscupen"].map((c) => ctx.txt(c, SENAL)).filter((m) => typeof m === "string" && m.includes(SENAL)).map((m) => m.split(SENAL));
  const nombradasObs = new Set();
  let tNombra = Infinity;
  for (const l of subs) {
    if (l.t < d.tAbre - 1e-9 || !moldes.some(([a, b]) => l.s.startsWith(a) && l.s.endsWith(b) && l.s.length > a.length + b.length)) continue;
    for (const g of l.quienes) if (d.lanes.includes(g)) nombradasObs.add(g);
    tNombra = Math.min(tNombra, l.t);
  }
  const pNombra = nombradasObs.size / L;
  if (L >= 2 && pNombra > 0 && pNombra < 1) {
    medias["obstaculo-nombra"] = { v: ((nombradasObs.has(w) ? 1 : 0) - pNombra) / Math.sqrt(pNombra * (1 - pNombra)), sd: 1 };
    tiempos["obstaculo-nombra"] = tNombra;
  }
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
