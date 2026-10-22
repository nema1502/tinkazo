/**
 * Las señales del auditor de delatores: de lo que grabó la página (la traza)
 * a las apuestas de cada semilla. Sin navegador, así se prueba con trazas
 * armadas a mano (`delatores-senales.test.mjs`).
 *
 * Cada señal devuelve, por semilla, sus reglas: `{ regla: { acierta, azar } }`,
 * y anota en `P.tiempos` cuándo se ve (en segundos desde el arranque): lo que
 * se ve a medio segundo del cartel no adelanta nada; lo que se ve diez antes, sí.
 * `azar` es lo que acertaría esa regla si la señal no supiera nada: el tamaño
 * del grupo por el que apuesta sobre el de los que siguen en juego en ese
 * momento. La estadística está en `delatores.mjs`.
 *
 * Lo que se mira es lo mismo que mira la sala:
 *
 * - **los subtítulos**, con la hora exacta en que salen y a quién nombran;
 * - **los nombres en pantalla**: dónde está cada uno, cuadro a cuadro;
 * - **la cámara**: cuánto se acerca, y qué nombre queda en el centro;
 * - **lo que el juego anota para los auditores** (`data-puesto`, `data-mitad`…),
 *   y algún contorno que no es texto (el foco de "¿Quién es?").
 *
 * "Los que siguen en juego" se deduce de la pantalla: alguien sigue mientras
 * su nombre se vuelva a ver más adelante. Al que nombran y desaparece en
 * seguida (el que se cayó, el que se bajó) se lo da por afuera desde que lo
 * nombran: la línea que nombra a un eliminado no es una pista, es el embudo.
 * En los juegos donde los nombres no se ven todo el tiempo (la ruleta, la
 * tómbola, la constelación) siguen todos hasta el final, y en la piñata, donde
 * todos los nombres se ven siempre (los de adentro en una columna, los caídos
 * en otra), sale el que el relator nombra al caer. En el trueque, donde cada nombre
 * se ve solo cuando el encargo prueba su puesto, sale el que cambia o es un
 * callejón, en la línea que lo dice.
 *
 * Cada señal se mide dentro de su arco (sección 8.7): antes del momento que
 * decide (`corte`), que en cada juego es otro: el último tiro del sapo, la
 * compuerta de la tómbola, la última caída de la piñata.
 */
import { bolasEn, nombresEn } from "./delatores-nombres.mjs";

/**
 * Las líneas del relator que marcan momentos, en español (`?lang=es`). Tienen
 * que coincidir con todas las variantes de su clave en src/i18n.ts: lo
 * comprueba `delatores-senales.test.mjs`, así que si cambia una frase, la
 * prueba avisa. Las que llevan un nombre lo aceptan en cualquier lugar (`.+`).
 */
export const MARCADORES = {
  cWin: /^¡(GANAN?|SE LO LLEVAN?|ES PARA|EL TINKAZO ES PARA) .+!$/u,
  // La carrera.
  cStart: /^¡(ALLÁ VAN|Y SALIERON|ARRANCÓ|YA ESTÁN EN CARRERA)!$/u,
  cLast: /^¡(ÚLTIMA RECTA|LOS ÚLTIMOS METROS|YA SE VE LA META|AHÍ ESTÁ LA META)!$/u,
  cFoto: /^¡(FOTO FINISH|POR UNA NARIZ|HAY QUE VER LA FOTO)!$/u,
  // El sapo.
  cSapCount: /^¡\d+ agujeros, uno por nombre!$/u,
  cSapLast: /^¡(Último tiro|Este es el bueno|Se decide ahora)!$/u,
  cSapNear: /^¡(Casi cae en el de .+|Bailó en el borde de .+)!$/u,
  cSapMissBy: /^¡(Pegó al lado de .+ y se fue|Pasó cerca de .+|Se le escapó a .+)!$/u,
  // La ruleta.
  cWheelOn: /^¡(Pasa por .+|Ahí está .+|Ahora .+)!$/u,
  cWheelFalse: /^¿(Se queda en .+|.+\? ¿Será|Paró en .+)\?$/u,
  cWheelMoved: /^¡(NO! ¡SE MOVIÓ|NO ERA! ¡UN GAJO MÁS|CHUTA, SE DESTRABÓ)!$/u,
  cWheelLast: /^¡(YA CASI PARA|AHORA SÍ|SE ACABA EL GIRO)!$/u,
  // La tómbola.
  cTomDoor: /^(¡SE ABRE LA PUERTA!|¡Sale una!|¡Ahí viene!)$/u,
  cTomFake: /^(¡Sale la \d+!|¡Asoma la \d+!|¿La \d+\?)$/u,
  cTomBack: /^(¡NO! ¡SE VOLVIÓ!|¡Se cayó para adentro!|¡No era esa!)$/u,
  cTomBall: /^¡(La número \d+|Salió la \d+|Es la \d+)!$/u,
  // El trompo.
  cTroCount: /^¡(Dos trompos, mano a mano|\d+ trompos bailando)!$/u,
  cTroWobble: /^¡(Cabecea el de .+|.+ se tambalea|Se va el de .+)!$/u,
  cTroEdge: /^¡(.+ casi se sale|.+ en el borde|.+ rozó la tiza)!$/u,
  cTroSpent: /^¡(Se le acabó la cuerda a .+|Se apagó el trompo de .+|.+ se queda sin cuerda)!$/u,
  // La piñata. `cPinOut` también reconoce `cPinOutMany` y `cPinOutMore`: todas son caídas.
  cPinOut: /^¡(Se cayó .+|Se cayeron .+|Afuera .+|.+ al piso)!$/u,
  cPinAlmost: /^¡(Casi se cae .+|.+ se asoma|Se agarra .+)!$/u,
  cPinBreak: /^¡(SE ROMPIÓ|SE ABRIÓ LA PIÑATA|AHÍ CAE)!$/u,
  // De pie (antes ¿Quién es?): la respuesta que sienta a los que no cumplen, y
  // el empate, cuando ninguna pregunta separa a los que quedan.
  cQuiAnswer: /^¡(Sí|No)! (A sentarse los que .+|Se sientan los que .+|Están todos: nadie se sienta|No hay ninguno: nadie se sienta)\.$/u,
  cQuiTie: /^¡(Mismas letras|Nombres casi iguales)! El sorteo ya eligió\.$/u,
  // Oruro.
  cOruCount: /^¡(Dos diablos en la comparsa|\d+ diablos en la comparsa)!$/u,
  cOruMask: /^¡(Casi se le cae la máscara a .+|.+ tropieza|Uy, .+)!$/u,
  cOruArrive: /^¡(LLEGÓ AL SOCAVÓN|SUENAN LAS CAMPANAS|ENTRA AL SANTUARIO)!$/u,
  // La chovena.
  cChoCount: /^¡(Dos en la rueda|\d+ en la rueda)!$/u,
  cChoOut: /^¡(.+ trastabilló|.+ se soltó|Afuera, .+)!$/u,
  cChoWobble: /^¡(.+ se tambalea|Ojo con .+)!$/u,
  cChoHold: /^¡(.+ aguanta|.+ no se soltó|Por un pelo, .+)!$/u,
  cChoBack: /^¡(.+ se había soltado, y vuelve|.+ vuelve a la rueda)!$/u,
  // El teleférico.
  cTelDoor: /^(¡Se abre la puerta de .+!|¿Se baja .+\?|¡.+ está en la puerta!)$/u,
  cTelSlip: /^¡(SE SUELTA LA DE .+|.+ se va cable abajo|Resbala la cabina de .+)!$/u,
  cTelDock: /^¡(LLEGÓ ARRIBA|TOCÓ LA CUMBRE|SE ABRE LA PUERTA)!$/u,
  // El aguayo.
  cPasClose: /^¡(Casi sale .+|.+ en el borde|Se agarra .+)!$/u,
  cPasOut: /^¡(Se cae el bulto de .+|.+ se queda afuera|Sale .+)!$/u,
  // El trueque: las líneas nombran productos, no personas.
  trBusca: /^¿Quién acepta .+\?$/u,
  trCambio: /^¡Cambio! Ahora es .+$/u,
  trCallejon: /^(¡Callejón sin salida!|Por ahí no se puede|¡Ahí no hay cambio!)$/u,
  trNoEs: /^¡No, es para el otro!$/u,
  // La constelación.
  cConstNear: /^¡(Casi toca a .+|Pasó rozando a .+|Uy, .+)!$/u,
  cConstHeading: /^¿(Va para .+|Se queda en .+)…\?$/u,
  cConstDecoy: /^¡(NO, SE FUE PARA OTRO LADO|DIO LA VUELTA|CAMBIÓ DE RUTA|NOOO, SIGUE DE LARGO)!$/u,
};

/** Qué tan lejos del final hay que seguir viéndose para contar "en juego", en segundos de la página. */
export const GRACIA = 2;
/** Cuánto antes del revelado alcanza con estar en pantalla para no haber salido nunca. */
const AL_FINAL = 0.5;

/** Visible para la sala: opaco, de un alto que se lee y con el centro adentro de la pantalla. */
const seVe = (l, W, H) => l.a >= 0.5 && l.h >= 6 && l.x >= 0 && l.x <= W && l.y >= 0 && l.y <= H;

/** Los nombres visibles de un cuadro crudo (`[t, z, i, x, y, h, a, …]` o, sin `z`, desde `desde`). */
function etiquetas(f, desde, n, W, H) {
  const labs = new Map();
  for (let j = desde; j + 4 < f.length; j += 5) {
    const i = f[j], l = { x: f[j + 1], y: f[j + 2], h: f[j + 3], a: f[j + 4] };
    if (i >= 0 && i < n && seVe(l, W, H)) labs.set(i, l);
  }
  return labs;
}

/**
 * Ordena la traza cruda para medir: los tiempos pasan a segundos desde que se
 * vio el estadio, cada cuadro trae sus nombres visibles en un `Map`, cada
 * subtítulo a quién nombra. Con `cfg.numeros` (la tómbola), los nombres son
 * los números de las bolas.
 */
export function preparar(tr, cfg = {}) {
  const names = tr.pose.names;
  const n = names.length;
  const w = tr.pose.winners[0];
  const t0 = tr.t0 ?? 0;
  const T = (t) => Math.round((t - t0) * 1000) / 1000;
  const W = tr.W, H = tr.H;
  const frames = cfg.numeros
    ? (tr.nums ?? []).map((f, k) => ({ t: T(f[0]), z: tr.frames[k]?.[1] ?? 1, labs: etiquetas(f, 1, n, W, H) }))
    : tr.frames.map((f) => ({ t: T(f[0]), z: f[1], labs: etiquetas(f, 2, n, W, H) }));
  const enSub = (s) => (cfg.numeros ? bolasEn(s, n) : nombresEn(s, names));
  const subs = tr.subs.filter(([t]) => t >= t0).map(([t, s]) => ({ t: T(t), s, quienes: enSub(s) }));
  const marks = (tr.marks ?? []).map(([t, k, v]) => ({ t: T(t), k, v }));
  const trazos = (tr.trazos ?? []).map((f) => {
    const items = [];
    for (let j = 1; j + 4 < f.length; j += 5) items.push({ k: f[j], x: f[j + 1], y: f[j + 2], w: f[j + 3], h: f[j + 4] });
    return { t: T(f[0]), items };
  });
  // Cómo llevaba la cámara la escena a la pantalla en cada cuadro (con `escena`
  // en el grabador): el origen y los dos ejes, por la hora del cuadro.
  const escena = new Map((tr.escena ?? []).map((f) => [T(f[0]), f.slice(1)]));
  const revelado = tr.revelado != null ? T(tr.revelado) : (frames.at(-1)?.t ?? 0);
  const primera = new Array(n).fill(null);
  const ultima = new Array(n).fill(null);
  for (const f of frames) {
    for (const i of f.labs.keys()) {
      if (primera[i] === null) primera[i] = f.t;
      ultima[i] = f.t;
    }
  }
  const todos = Array.from({ length: n }, (_, i) => i);
  const arco = marks.find((m) => m.k === "arco")?.v ?? "?";
  const P = { names, n, w, W, H, frames, subs, marks, trazos, escena, revelado, primera, ultima, arco, tiempos: {} };
  P.corte = Math.min(cuando(P, cfg.corte) ?? revelado, revelado);
  // Con `afuera` (en los juegos donde los nombres no se ven todo el tiempo,
  // como el trueque), quién sale y cuándo lo dice el juego, no la pantalla.
  const fuera = cfg.afuera ? cfg.afuera(P) : null;
  // Sigue en juego en `t` el que se vuelve a ver más de `GRACIA` segundos
  // después, o en el momento que decide: el que cae justo ahí (la rival del
  // final) estaba en juego hasta ese momento.
  const modo = cfg.candidatos ?? "visibles";
  const despues = (t) => Math.min(t + GRACIA, P.corte - 0.001);
  P.sigue = (i, t) => {
    if (fuera) return !(fuera.get(i) <= despues(t));
    if (modo === "todos") return true;
    if (primera[i] === null) return false;
    return ultima[i] >= revelado - AL_FINAL || ultima[i] > despues(t);
  };
  P.vivos = (t) => todos.filter((i) => P.sigue(i, t));
  return P;
}

/**
 * Cuándo pasa un momento, en segundos desde el arranque, o null si no pasó:
 *
 * - `{ clave }` o `{ claves }`: el primer subtítulo de esas líneas (con
 *   `ultima: true`, el último antes del revelado);
 * - `{ marca }`: la primera vez que el juego anota ese dato;
 * - `{ frac }`: esa fracción del show hasta el revelado.
 *
 * `mas` suma segundos de espera.
 */
export function cuando(P, m) {
  if (!m) return null;
  let t = null;
  const claves = m.claves ?? (m.clave ? [m.clave] : null);
  if (claves) {
    const res = claves.map((k) => MARCADORES[k]);
    const xs = P.subs.filter((x) => x.t <= P.revelado && res.some((re) => re.test(x.s)));
    const s = m.ultima ? xs.at(-1) : xs[0];
    t = s ? s.t : null;
  } else if (m.marca) {
    const k = P.marks.find((x) => x.k === m.marca);
    t = k ? k.t : null;
  } else if (m.frac !== undefined) t = m.frac * P.revelado;
  return t === null ? null : t + (m.mas ?? 0);
}

/** Una observación de una regla: si el ganador está en `G`, y el azar `|G ∩ C| / |C|`. Null si no informa. */
export function apuesta(G, C, w) {
  const enC = new Set(C);
  if (!enC.has(w)) return null;
  const g = [...new Set(G)].filter((i) => enC.has(i));
  if (!g.length || g.length >= enC.size) return null;
  return { acierta: g.includes(w), azar: g.length / enC.size };
}

/** El orden de los nombres de un cuadro: por x, por y, o por ángulo alrededor de su centro (desde las doce, en el sentido del reloj). */
export function ordenar(labs, orden) {
  const xs = [...labs.entries()].map(([i, l]) => ({ i, ...l }));
  if (orden === "x") return xs.sort((a, b) => a.x - b.x).map((p) => p.i);
  if (orden === "y") return xs.sort((a, b) => a.y - b.y).map((p) => p.i);
  const cx = xs.reduce((s, p) => s + p.x, 0) / (xs.length || 1);
  const cy = xs.reduce((s, p) => s + p.y, 0) / (xs.length || 1);
  const ang = (p) => (Math.atan2(p.x - cx, -(p.y - cy)) + 2 * Math.PI) % (2 * Math.PI);
  return xs.sort((a, b) => ang(a) - ang(b)).map((p) => p.i);
}

/** El cuadro con más gente en juego visible entre `t` y `t + ventana`. */
export function mejorCuadro(P, t, ventana = 2) {
  let mejor = null;
  for (const f of P.frames) {
    if (f.t < t) continue;
    if (f.t > t + ventana) break;
    const cuenta = [...f.labs.keys()].filter((i) => P.sigue(i, f.t)).length;
    if (!mejor || cuenta > mejor.cuenta) mejor = { f, cuenta };
  }
  return mejor?.f ?? null;
}

/** El último cuadro antes de `t`. */
const cuadroAntes = (P, t) => P.frames.filter((f) => f.t < t).at(-1) ?? null;

/** Los de `labs` ordenados por distancia a un punto, solo los que siguen en juego en `t`. */
function porDistancia(P, labs, x, y, t) {
  return [...labs.entries()]
    .filter(([i]) => P.sigue(i, t))
    .map(([i, l]) => ({ i, d: Math.hypot(l.x - x, l.y - y) }))
    .sort((a, b) => a.d - b.d);
}

/* ================================================================ genéricas */

/**
 * Lo que dicen los subtítulos, antes del momento que decide (`P.corte`):
 *
 * - `nombra-primero`: el primero que nombran.
 * - `nombra-ultimo`: el último que nombran solo (sin otro en la misma línea).
 * - `nombra-mas`: el más nombrado.
 * - `drama`: los que nombraron alguna vez, contra los que nunca (sección 8.7:
 *   "los subtítulos nombran a perdedores y a ganadores en los momentos de
 *   drama, por igual").
 * - `orden-dos`: en la última línea que nombra a dos ("¡Quedan X y Y!"), si
 *   gana el que se nombra primero.
 */
export function senalesSubtitulos(P) {
  const out = {};
  const w = P.w;
  const antes = P.subs.filter((s) => s.t < P.corte);
  const conVivos = antes.map((s) => ({ ...s, vivos: [...new Set(s.quienes)].filter((i) => P.sigue(i, s.t)) }));
  const primero = conVivos.find((s) => s.vivos.length);
  if (primero) {
    const quien = primero.quienes.find((i) => primero.vivos.includes(i));
    out["nombra-primero"] = { el: apuesta([quien], P.vivos(primero.t), w) };
    P.tiempos["nombra-primero"] = primero.t;
  }
  const ultimo = conVivos.filter((s) => s.vivos.length === 1).at(-1);
  if (ultimo) {
    out["nombra-ultimo"] = { el: apuesta(ultimo.vivos, P.vivos(ultimo.t), w) };
    P.tiempos["nombra-ultimo"] = ultimo.t;
  }
  const veces = new Map();
  for (const s of conVivos) for (const i of s.quienes) if (s.vivos.includes(i)) veces.set(i, (veces.get(i) ?? 0) + 1);
  const C = P.vivos(P.corte - 0.001);
  const enC = [...veces.entries()].filter(([i]) => C.includes(i));
  if (enC.length) {
    const tope = Math.max(...enC.map(([, v]) => v));
    out["nombra-mas"] = { el: apuesta(enC.filter(([, v]) => v === tope).map(([i]) => i), C, w) };
    const nombrados = enC.map(([i]) => i);
    out.drama = {
      nombrados: apuesta(nombrados, C, w),
      callados: apuesta(C.filter((i) => !nombrados.includes(i)), C, w),
    };
    // Quién es el más nombrado, y quién nunca, se sabe con la última línea que nombra a alguien.
    const ultimaConNombre = conVivos.filter((s) => s.vivos.length).at(-1);
    if (ultimaConNombre) P.tiempos["nombra-mas"] = P.tiempos.drama = ultimaConNombre.t;
  }
  const dos = conVivos.filter((s) => s.vivos.length === 2 && s.vivos.includes(w)).at(-1);
  if (dos) {
    const [a, b] = dos.quienes.filter((i, k, xs) => dos.vivos.includes(i) && xs.indexOf(i) === k);
    out["orden-dos"] = { "el-primero": apuesta([a], [a, b], w), "el-segundo": apuesta([b], [a, b], w) };
    P.tiempos["orden-dos"] = dos.t;
  }
  return out;
}

/**
 * La cámara: en los acercamientos (un 20% más cerca que lo de siempre en ese
 * show), qué nombre queda en el centro de la pantalla. `camara` apuesta por el
 * que más tiempo estuvo en el centro y por el último, antes del corte.
 */
export function senalCamara(P, cfg = {}) {
  const antes = P.frames.filter((f) => f.t < P.corte);
  if (antes.length < 4) return {};
  const zs = antes.map((f) => f.z).sort((a, b) => a - b);
  const base = zs[Math.floor(zs.length / 2)];
  const radio = (cfg.radioFoco ?? 0.22) * Math.min(P.W, P.H);
  const tiempo = new Map();
  let ultimo = null;
  antes.forEach((f, k) => {
    if (f.z < base * 1.2) return;
    const cerca = porDistancia(P, f.labs, P.W / 2, P.H / 2, f.t)[0];
    if (!cerca || cerca.d > radio) return;
    const dt = (antes[k + 1]?.t ?? P.corte) - f.t;
    tiempo.set(cerca.i, (tiempo.get(cerca.i) ?? 0) + dt);
    ultimo = { i: cerca.i, t: f.t };
  });
  if (!tiempo.size) return {};
  if (ultimo) P.tiempos.camara = ultimo.t;
  const C = P.vivos(P.corte - 0.001);
  const dentro = [...tiempo.entries()].filter(([i]) => C.includes(i));
  const tope = Math.max(0, ...dentro.map(([, v]) => v));
  return {
    camara: {
      "mas-tiempo": dentro.length ? apuesta(dentro.filter(([, v]) => v === tope).map(([i]) => i), C, P.w) : null,
      ultimo: ultimo ? apuesta([ultimo.i], P.vivos(ultimo.t), P.w) : null,
    },
  };
}

/**
 * Dónde arranca cada uno: en el momento `desde`, el puesto del ganador en el
 * orden de la pantalla (`x`, `y` o `angulo`). Una regla por puesto: "gana el
 * que arranca tercero desde arriba".
 */
export function senalArranque(P, cfg) {
  const out = {};
  for (const a of [cfg.arranque ?? []].flat()) {
    const t = cuando(P, a.desde ?? { frac: 0.15 });
    if (t === null) continue;
    const f = mejorCuadro(P, t, a.ventana ?? 2);
    if (!f) continue;
    const labs = new Map([...f.labs].filter(([i]) => P.sigue(i, f.t)));
    if (!labs.has(P.w) || labs.size < 2) continue;
    const orden = ordenar(labs, a.orden ?? "x");
    const reglas = {};
    orden.forEach((i, r) => (reglas[`puesto-${r + 1}`] = apuesta([i], orden, P.w)));
    out[`arranque-${a.orden ?? "x"}`] = reglas;
    P.tiempos[`arranque-${a.orden ?? "x"}`] = f.t;
  }
  return out;
}

/**
 * El mano a mano: desde que quedan dos (la última línea que nombra a dos con
 * el ganador adentro, o cuando en pantalla siguen solo dos), de qué lado está
 * cada uno (`lado-x`, `lado-y`) y, en los juegos donde se salta, quién salta
 * primero (`salta-primero`): el primero que sube de golpe respecto del otro.
 */
export function senalesDuelo(P, cfg = {}) {
  const antes = P.subs.filter((s) => s.t < P.corte);
  const linea = antes
    .map((s) => ({ s, vivos: [...new Set(s.quienes)].filter((i) => P.sigue(i, s.t)) }))
    .filter((x) => x.vivos.length === 2 && x.vivos.includes(P.w))
    .at(-1);
  let par = linea ? linea.vivos : null;
  let t2 = linea ? linea.s.t : null;
  if (!par && (cfg.candidatos ?? "visibles") === "visibles") {
    // Quedan dos desde que los demás ya no se vuelven a ver: se los da por
    // afuera `GRACIA` segundos antes de que se vayan, así que las posiciones
    // del mano a mano se miran después de que se fueron.
    const f = P.frames.find((x) => x.t < P.corte && P.vivos(x.t).length === 2);
    if (f) {
      par = P.vivos(f.t);
      t2 = f.t + GRACIA + 0.001;
    }
  }
  if (!par || !par.includes(P.w)) return {};
  const otro = par.find((i) => i !== P.w);
  const ambos = P.frames.filter((x) => x.t >= t2 && x.t < P.corte && x.labs.has(P.w) && x.labs.has(otro));
  const out = {};
  const f = ambos[0];
  if (f) {
    const a = f.labs.get(P.w), b = f.labs.get(otro);
    if (Math.abs(a.x - b.x) > 4) {
      const izq = a.x < b.x ? P.w : otro;
      out["lado-x"] = { izquierda: apuesta([izq], par, P.w), derecha: apuesta([izq === P.w ? otro : P.w], par, P.w) };
      P.tiempos["lado-x"] = f.t;
    }
    if (Math.abs(a.y - b.y) > 4) {
      const arriba = a.y < b.y ? P.w : otro;
      out["lado-y"] = { arriba: apuesta([arriba], par, P.w), abajo: apuesta([arriba === P.w ? otro : P.w], par, P.w) };
      P.tiempos["lado-y"] = f.t;
    }
  }
  if (cfg.salta && ambos.length > 2) {
    const umbral = cfg.salta === true ? 8 : cfg.salta;
    const d0 = ambos[0].labs.get(P.w).y - ambos[0].labs.get(otro).y;
    for (const x of ambos) {
      const d = x.labs.get(P.w).y - x.labs.get(otro).y - d0;
      if (Math.abs(d) < umbral) continue;
      const primero = d < 0 ? P.w : otro;
      out["salta-primero"] = { el: apuesta([primero], par, P.w), "el-otro": apuesta([primero === P.w ? otro : P.w], par, P.w) };
      P.tiempos["salta-primero"] = x.t;
      break;
    }
  }
  return out;
}

/**
 * Una clase de línea del relator, como señal propia: la última de esas líneas
 * (antes del corte, o del revelado con `hasta: "revelado"`) nombra a alguien,
 * y la regla apuesta por esa persona. Sirve para "quién cabecea", "a quién se
 * le cae la máscara", "qué caramelo se asoma": si nombran casi siempre al que
 * gana, o nunca, la sala lo aprende.
 */
export function linea(nombre, claves, { hasta = "corte" } = {}) {
  const res = claves.map((k) => MARCADORES[k]);
  const f = (P) => {
    const tope = hasta === "revelado" ? P.revelado : P.corte;
    const l = P.subs.filter((s) => s.t < tope && res.some((re) => re.test(s.s))).at(-1);
    if (!l) return {};
    const quienes = [...new Set(l.quienes)].filter((i) => P.sigue(i, l.t));
    if (!quienes.length) return {};
    P.tiempos[nombre] = l.t;
    return { [nombre]: { "el-nombrado": apuesta(quienes, P.vivos(l.t), P.w) } };
  };
  Object.defineProperty(f, "name", { value: `linea-${nombre}` });
  return f;
}

/* ============================================================== de un juego */

/**
 * La carrera, con lo que anota (`data-puesto`, el puesto de la ganadora en
 * cada cuadro, y `data-mitad`, en el que cruza la mitad):
 *
 * - `puesto-25`, `puesto-50`, `puesto-75`: en qué puesto va la ganadora a esa
 *   altura de la carrera. Una regla por puesto.
 * - `recta`: al 90%, con la cámara cerrada sobre las dos de adelante, si gana
 *   la que va primera o la segunda (solo cuando la ganadora es una de esas
 *   dos). La auditoría lo vio: "en la recta final, la que va primera pierde".
 */
export function senalesCarrera(P) {
  const go = cuando(P, { clave: "cStart" });
  const mitad = P.marks.find((m) => m.k === "mitad");
  if (go === null || !mitad || mitad.t <= go) return {};
  const dur = 2 * (mitad.t - go);
  const puestos = P.marks.filter((m) => m.k === "puesto");
  const clasif = P.marks.find((m) => m.k === "clasificatoria")?.v ?? "";
  const N = Number(clasif.split("/")[0]) || Math.min(8, P.n);
  const puestoEn = (q) => {
    const t = go + q * dur;
    let v = null;
    for (const m of puestos) {
      if (m.t > t) break;
      v = Number(m.v);
    }
    return v;
  };
  const out = {};
  // Los puestos hacen de personas: la "ganadora" es su puesto, y cada regla
  // apuesta por un puesto entre los N de la pista.
  const lugares = Array.from({ length: N }, (_, k) => k + 1);
  for (const q of [0.25, 0.5, 0.75]) {
    const p = puestoEn(q);
    if (!p) continue;
    const reglas = {};
    for (const k of lugares) reglas[`puesto-${k}`] = apuesta([k], lugares, p);
    out[`puesto-${Math.round(q * 100)}`] = reglas;
    P.tiempos[`puesto-${Math.round(q * 100)}`] = go + q * dur;
  }
  const p90 = puestoEn(0.9);
  if (p90 === 1 || p90 === 2) {
    out.recta = { primera: apuesta([1], [1, 2], p90), segunda: apuesta([2], [1, 2], p90) };
    P.tiempos.recta = go + 0.9 * dur;
  }
  return out;
}

/**
 * El sapo: el "¡Casi!" (`cSapNear`, la argolla que baila en el borde de un
 * agujero y el relator nombra a su dueño) y los tiros a la madera que nombran
 * al que estaba más cerca (`cSapMissBy`). Hasta el 4 de octubre de 2026 el
 * casi caía siempre en un vecino del ganador, y con dos casi el ganador quedaba
 * en el medio.
 *
 * - `casi`: gana el del casi, o uno de sus dos vecinos de mesa.
 * - `entre-casis`: con dos casi, gana el que queda entre los dos (por el lado
 *   más corto de la mesa).
 * - `fallo-cerca`: gana el que nombraron en el último tiro a la madera, o un vecino.
 *
 * El orden de los agujeros sale de la pantalla: los nombres, ya en la mesa,
 * ordenados por ángulo alrededor de la rana.
 */
export function senalesSapo(P) {
  const t = cuando(P, { clave: "cSapCount", mas: 2 });
  const f = t === null ? null : mejorCuadro(P, t, 3);
  if (!f) return {};
  const mesa = ordenar(new Map([...f.labs].filter(([i]) => P.sigue(i, f.t))), "angulo");
  const k = mesa.length;
  if (k < 3 || !mesa.includes(P.w)) return {};
  const vecinos = (i) => {
    const r = mesa.indexOf(i);
    return [mesa[(r + 1) % k], mesa[(r - 1 + k) % k]];
  };
  const antes = P.subs.filter((s) => s.t < P.corte);
  const casis = antes.filter((s) => MARCADORES.cSapNear.test(s.s) && s.quienes.length === 1 && mesa.includes(s.quienes[0]));
  const out = {};
  const ultimo = casis.at(-1);
  if (ultimo) {
    const c = ultimo.quienes[0];
    out.casi = { "el-del-casi": apuesta([c], mesa, P.w), "sus-vecinos": apuesta(vecinos(c), mesa, P.w) };
    P.tiempos.casi = ultimo.t;
  }
  if (casis.length >= 2) {
    const a = mesa.indexOf(casis.at(-2).quienes[0]), b = mesa.indexOf(casis.at(-1).quienes[0]);
    if (a !== b) {
      const ida = (b - a + k) % k, vuelta = (a - b + k) % k;
      const [desde, pasos] = ida <= vuelta ? [a, ida] : [b, vuelta];
      const medio = Array.from({ length: pasos - 1 }, (_, j) => mesa[(desde + j + 1) % k]);
      if (medio.length) {
        out["entre-casis"] = { medio: apuesta(medio, mesa, P.w) };
        P.tiempos["entre-casis"] = casis.at(-1).t;
      }
    }
  }
  const fallo = antes.filter((s) => MARCADORES.cSapMissBy.test(s.s) && s.quienes.length === 1 && mesa.includes(s.quienes[0])).at(-1);
  if (fallo) {
    out["fallo-cerca"] = { "el-nombrado": apuesta(fallo.quienes, mesa, P.w), "sus-vecinos": apuesta(vecinos(fallo.quienes[0]), mesa, P.w) };
    P.tiempos["fallo-cerca"] = fallo.t;
  }
  return out;
}

/**
 * La ruleta: mientras frena, el relator nombra cada gajo que pasa bajo la
 * flecha, y en el susto se para en uno ("¿Se queda en X?") y avanza otro. Los
 * gajos van en el orden de la lista, así que "el siguiente" de alguien es el
 * que sigue en la lista. La auditoría lo vio: "el final es siempre 'un gajo
 * más', así que el que queda trabado pierde".
 *
 * - `gajo`: del último nombrado antes de que la rueda se trabe, gana él, el
 *   siguiente o el anterior.
 */
export function senalesRuleta(P) {
  const nombradas = P.subs.filter((s) => s.t < P.corte && (MARCADORES.cWheelOn.test(s.s) || MARCADORES.cWheelFalse.test(s.s)) && s.quienes.length === 1);
  const l = nombradas.at(-1);
  if (!l) return {};
  const i = l.quienes[0], n = P.n;
  const C = P.vivos(l.t);
  P.tiempos.gajo = l.t;
  return {
    gajo: {
      "el-nombrado": apuesta([i], C, P.w),
      "el-siguiente": apuesta([(i + 1) % n], C, P.w),
      "el-anterior": apuesta([(i - 1 + n) % n], C, P.w),
    },
  };
}

/**
 * La tómbola:
 *
 * - `compuerta`: justo antes de que se abra la puerta, con la cámara encima de
 *   la compuerta, la bola más cerca del centro de la pantalla (la que espera
 *   en la boca) y las dos más cerca. "Antes de que se abra la compuerta, la
 *   ganadora ya espera en la boca."
 */
export function senalesTombola(P) {
  const t = cuando(P, { clave: "cTomDoor" });
  if (t === null) return {};
  const f = cuadroAntes(P, t);
  if (!f) return {};
  const cerca = porDistancia(P, f.labs, P.W / 2, P.H / 2, f.t);
  if (cerca.length < 3) return {};
  const C = P.vivos(f.t);
  P.tiempos.compuerta = f.t;
  return { compuerta: { "la-de-la-boca": apuesta([cerca[0].i], C, P.w), "las-dos-de-la-boca": apuesta([cerca[0].i, cerca[1].i], C, P.w) } };
}

/**
 * "¿Quién es?": en cada pregunta un foco salta de carta en carta, y en la
 * última "frena de a poco y se queda en la carta de quien gana justo antes de
 * la respuesta" (el código lo dice así). El foco es un contorno amarillo, que
 * el grabador sigue (`trazos`); su carta es la del nombre más cerca de su centro.
 *
 * - `foco`: la carta donde está el foco en el último cuadro antes de la
 *   última respuesta.
 */
export function senalesQuien(P) {
  const ultimo = P.trazos.filter((x) => x.t < P.corte && x.items.some((it) => it.w > 20 && it.h > 20)).at(-1);
  if (!ultimo) return {};
  const foco = ultimo.items.filter((it) => it.w > 20 && it.h > 20).sort((a, b) => b.w * b.h - a.w * a.h)[0];
  const f = cuadroAntes(P, ultimo.t + 0.001);
  if (!f) return {};
  const cerca = porDistancia(P, f.labs, foco.x, foco.y, f.t)[0];
  if (!cerca || cerca.d > Math.max(foco.w, foco.h)) return {};
  P.tiempos.foco = ultimo.t;
  return { foco: { "la-del-foco": apuesta([cerca.i], P.vivos(ultimo.t), P.w) } };
}

/**
 * La constelación: el paquete salta de estrella en estrella, y en el último
 * salto amaga ("¿Se queda en X…?") con una de las cuatro estrellas más cerca
 * de la ganadora. La auditoría lo vio: "gana la vecina del amago final".
 *
 * - `amague`: gana la del amague, o la estrella más cerca de ella, o una de
 *   sus dos o tres más cercanas. Las distancias salen del cuadro con más
 *   nombres a la vista ("¡El cielo está lleno!").
 *
 * Que el paquete nunca toque a la ganadora antes del último salto lo mide
 * `drama` (las que nombra el relator al pasar, contra las que nunca).
 */
export function senalesConstelacion(P) {
  const l = P.subs.filter((s) => s.t < P.corte && MARCADORES.cConstHeading.test(s.s) && s.quienes.length === 1).at(-1);
  if (!l) return {};
  const d = l.quienes[0];
  let cielo = null;
  for (const f of P.frames) if (!cielo || f.labs.size > cielo.labs.size) cielo = f;
  if (!cielo || !cielo.labs.has(d)) return {};
  const yo = cielo.labs.get(d);
  const cerca = [...cielo.labs.entries()].filter(([i]) => i !== d).map(([i, q]) => ({ i, dd: Math.hypot(q.x - yo.x, q.y - yo.y) })).sort((a, b) => a.dd - b.dd).map((x) => x.i);
  const C = P.vivos(l.t);
  P.tiempos.amague = l.t;
  return {
    amague: {
      "la-del-amague": apuesta([d], C, P.w),
      "su-vecina": apuesta(cerca.slice(0, 1), C, P.w),
      "sus-dos-vecinas": apuesta(cerca.slice(0, 2), C, P.w),
      "sus-tres-vecinas": apuesta(cerca.slice(0, 3), C, P.w),
    },
  };
}

/**
 * El trueque: cada persona es un puesto de la feria, con un toldo del color de
 * lo que acepta. En cada pase el relator pregunta "¿Quién acepta papa?", se
 * prenden con un aro crema los puestos que la aceptan, y el encargo prueba
 * uno: cambia ("¡Cambio! Ahora es maíz") o es un callejón. En el último pase,
 * la entrega, el encargo llega a quien espera, que es el ganador. Los nombres
 * se ven solo al pasar lista, en el puesto que se prueba y en la ruta del
 * final, así que el aro se reconoce por el nombre que queda justo encima de su
 * puesto, pasando lo que se ve a la escena con la cámara de ese cuadro.
 *
 * - `prendido-antes`: al empezar la entrega, entre los puestos que siguen en
 *   juego, los que se prendieron en algún pase anterior contra los que nunca.
 *   El plan (`trueque-plan.ts`) prende a quien espera recién en la entrega, y
 *   ningún pase anterior lleva lo que él acepta: si así nunca gana un puesto
 *   que ya se prendió, la sala lo puede aprender.
 * - `entrega`: con dos o más prendidos en la entrega, si gana el primero que
 *   prueba el encargo o uno de los otros. El plan prueba primero el callejón.
 */
export function senalesTrueque(P) {
  if (!P.escena.size) return {};
  const aEscena = (t, x, y) => {
    const m = P.escena.get(t);
    if (!m) return null;
    const [ox, oy, ax, ay, bx, by] = m;
    const det = ax * by - ay * bx;
    if (!det) return null;
    const dx = x - ox, dy = y - oy;
    return { x: (dx * by - dy * bx) / det, y: (ax * dy - ay * dx) / det, z: Math.hypot(ax, ay) };
  };
  // Dónde queda el nombre de cada puesto en la escena: la primera vez que se ve.
  const puesto = new Map();
  for (const f of P.frames) {
    for (const [i, l] of f.labs) {
      if (puesto.has(i)) continue;
      const q = aEscena(f.t, l.x, l.y);
      if (q) puesto.set(i, q);
    }
  }
  // Un aro es del puesto cuyo nombre queda justo encima: más cerca del borde
  // de arriba del aro que su radio. El de la fila de abajo queda a casi un
  // diámetro.
  const deQuien = (t, it) => {
    const c = aEscena(t, it.x, it.y);
    if (!c || Math.abs(it.w - it.h) > 0.25 * Math.max(it.w, it.h)) return null;
    const R = it.h / 2 / c.z;
    let mejor = null;
    for (const [i, q] of puesto) {
      const d = Math.hypot(q.x - c.x, q.y - (c.y - R));
      if (d < R && (!mejor || d < mejor.d)) mejor = { i, d };
    }
    return mejor ? mejor.i : null;
  };
  const prendidos = (desde, hasta) => {
    const out = new Set();
    for (const f of P.trazos) {
      if (f.t < desde || f.t >= hasta) continue;
      for (const it of f.items) {
        if (it.k !== 0) continue;
        const i = deQuien(f.t, it);
        if (i !== null) out.add(i);
      }
    }
    return out;
  };
  const out = {};
  const antes = prendidos(-Infinity, P.corte - 0.05);
  const C = P.vivos(P.corte - 0.001);
  if (C.length >= 2) {
    P.tiempos["prendido-antes"] = P.corte;
    out["prendido-antes"] = {
      prendidos: apuesta(C.filter((i) => antes.has(i)), C, P.w),
      "nunca-prendidos": apuesta(C.filter((i) => !antes.has(i)), C, P.w),
    };
  }
  const D = [...prendidos(P.corte + 0.05, P.revelado)];
  const primero = P.frames.find((f) => f.t > P.corte && f.t < P.revelado && f.labs.size);
  if (D.length >= 2 && primero) {
    const i = [...primero.labs.keys()].find((j) => D.includes(j));
    if (i !== undefined) {
      out.entrega = { "el-primero": apuesta([i], D, P.w), "los-otros": apuesta(D.filter((j) => j !== i), D, P.w) };
      P.tiempos.entrega = primero.t;
    }
  }
  return out;
}

/**
 * Quién sale del trueque y cuándo: el puesto que cambia (ya no vuelve a
 * cambiar, y la feria lo apaga) y el callejón, en la línea que lo dice. Es el
 * nombre a la vista en ese momento, el del puesto que se está probando.
 */
export function afueraTrueque(P) {
  const fuera = new Map();
  const res = [MARCADORES.trCambio, MARCADORES.trCallejon, MARCADORES.trNoEs];
  for (const s of P.subs) {
    if (s.t > P.revelado || !res.some((re) => re.test(s.s))) continue;
    const f = cuadroAntes(P, s.t + 0.001);
    if (!f) continue;
    for (const i of f.labs.keys()) if (!fuera.has(i)) fuera.set(i, s.t);
  }
  return fuera;
}

/**
 * Quién cae de la piñata y cuándo: el que nombra el relator al caer ("¡Afuera
 * X!", "¡Se cayeron X y Y!"). Los nombres ya no sirven: desde octubre se ven
 * todos, todo el tiempo (la columna de los de adentro y la de los caídos), y
 * hasta el 21 de octubre el auditor tomaba aparecer por caer, así que el susto
 * (el caramelo que se asoma) quedaba sin medir. El que cae sin nombre ("¡Se
 * cayó X y 3 más!", con mucha gente) sigue contando en juego: el azar sube y
 * la prueba se vuelve más prudente, nunca más fácil.
 */
export function afueraPinata(P) {
  const fuera = new Map();
  for (const s of P.subs) {
    if (s.t > P.revelado || !MARCADORES.cPinOut.test(s.s)) continue;
    for (const i of s.quienes) if (!fuera.has(i)) fuera.set(i, s.t);
  }
  return fuera;
}

/* ================================================================== juegos */

/**
 * Cómo se mira cada juego:
 *
 * - `candidatos`: `visibles` (siguen los que se vuelven a ver) o `todos`.
 * - `corte`: el momento que decide; las señales se miden antes. Sin corte, el
 *   cartel del ganador.
 * - `arranque`: cuándo y en qué orden se mira dónde arranca cada uno.
 * - `salta`: si en el mano a mano se salta (Oruro).
 * - `afuera`: quién sale y cuándo, si no se deduce de la pantalla (el trueque).
 * - `numeros`, `trazos`, `escena`: qué más tiene que grabar la página.
 * - `especificas`: las señales propias del juego.
 */
export const JUEGOS = {
  race: {
    candidatos: "visibles",
    arranque: { desde: { clave: "cStart" }, orden: "y", ventana: 1 },
    especificas: [senalesCarrera],
  },
  sapo: {
    candidatos: "visibles",
    corte: { clave: "cSapLast" },
    arranque: { desde: { clave: "cSapCount", mas: 2 }, orden: "angulo", ventana: 3 },
    especificas: [senalesSapo],
  },
  wheel: {
    candidatos: "todos",
    corte: { claves: ["cWheelMoved", "cWheelLast"] },
    especificas: [senalesRuleta, linea("amague", ["cWheelFalse"])],
  },
  tombola: {
    candidatos: "todos",
    numeros: true,
    corte: { clave: "cTomDoor" },
    especificas: [senalesTombola, linea("asoma", ["cTomFake"], { hasta: "revelado" })],
  },
  trompo: {
    candidatos: "visibles",
    corte: { clave: "cTroSpent" },
    arranque: { desde: { clave: "cTroCount", mas: 1 }, orden: "angulo" },
    especificas: [linea("cabecea", ["cTroWobble"]), linea("borde", ["cTroEdge"])],
  },
  pinata: {
    candidatos: "todos",
    afuera: afueraPinata,
    corte: { clave: "cPinBreak" },
    especificas: [linea("asoma", ["cPinAlmost"])],
  },
  // De pie: desde el 20 de octubre ya no hay foco que salte de carta en carta
  // (quien-plan.ts). El contorno amarillo de opacidad 0,9 se sigue mirando por
  // si vuelve: hoy no da datos.
  quien: {
    candidatos: "visibles",
    corte: { claves: ["cQuiAnswer", "cQuiTie"], ultima: true },
    trazos: [{ color: 0xffc629, alpha: 0.9 }],
    especificas: [senalesQuien],
  },
  trueque: {
    candidatos: "todos",
    afuera: afueraTrueque,
    corte: { clave: "trBusca", ultima: true },
    trazos: [{ color: 0xf6efe2, capa: 1 }],
    escena: true,
    especificas: [senalesTrueque],
  },
  oruro: {
    candidatos: "visibles",
    corte: { clave: "cOruArrive" },
    salta: true,
    arranque: [
      { desde: { clave: "cOruCount" }, orden: "x" },
      { desde: { clave: "cOruCount" }, orden: "y" },
    ],
    especificas: [linea("mascara", ["cOruMask"])],
  },
  chovena: {
    candidatos: "visibles",
    corte: { clave: "cChoOut", ultima: true },
    arranque: { desde: { clave: "cChoCount", mas: 1 }, orden: "angulo" },
    especificas: [linea("tambalea", ["cChoWobble", "cChoHold"]), linea("vuelve", ["cChoBack"])],
  },
  teleferico: {
    candidatos: "visibles",
    corte: { clave: "cTelDock" },
    especificas: [linea("puerta", ["cTelDoor"]), linea("mordaza", ["cTelSlip"])],
  },
  pasanaku: {
    candidatos: "visibles",
    corte: { clave: "cPasOut", ultima: true },
    especificas: [linea("borde", ["cPasClose"])],
  },
  stellar: {
    candidatos: "todos",
    corte: { clave: "cConstDecoy" },
    especificas: [senalesConstelacion, linea("roce", ["cConstNear"])],
  },
};

/** Lo que tiene que grabar la página para un juego. */
export const grabarPara = (juego) => {
  const c = JUEGOS[juego] ?? {};
  return { numeros: !!c.numeros, trazos: c.trazos ?? [], escena: !!c.escena };
};

/**
 * Todas las señales de una semilla: `{ señal: { regla: { acierta, azar } | null } }`,
 * y `tiempos`: cuándo se vio cada señal, en segundos desde el arranque.
 */
export function senales(tr, juego) {
  const cfg = JUEGOS[juego] ?? { candidatos: "visibles" };
  const P = preparar(tr, cfg);
  const out = {
    ...senalesSubtitulos(P),
    ...senalCamara(P, cfg),
    ...senalArranque(P, cfg),
    ...senalesDuelo(P, cfg),
  };
  for (const f of cfg.especificas ?? []) Object.assign(out, f(P, cfg));
  return { arco: P.arco, corte: P.corte, revelado: P.revelado, senales: out, tiempos: P.tiempos };
}
