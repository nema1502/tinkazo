import { minimoPx, tamanoLetra } from "../pixi/kit/nombres";
import { planNombres } from "../nombres";
import { TAM3D } from "./carrera-3d-mapa";
import { alfabetico } from "./carrera-base";
import { LLEGADA_TARDE, crearCaminata, enTanda, ubicarTandas, type Caminata, type UbicacionTandas } from "./carrera-caminata";
import { LLAMA_COLA, LLAMA_HOCICO, carrilesDe, type Carriles, type Forma, type Pantalla } from "./carrera-forma";
import { formaDelGrupo } from "./carrera-filas";
import { CARRIL_DURA, CUERPO } from "./carrera-marcha";
import { ENSANCHE } from "./carrera-obstaculos";
import { RECTA, type Datos } from "./carrera-show";
import type { Tanda } from "./carrera-tandas";
import { medioAncho3D } from "./carrera-subfilas";
import { tarjetaRetrato } from "./carrera-tarjeta";
import { crearTrayectorias, type Trayectorias } from "./carrera-trayectorias";

/** La subida suave de quinto grado de `carrera.ts`, la del paso de las filas a los carriles. */
const suave5 = (v: number): number => {
  const x = Math.max(0, Math.min(1, v));
  return x * x * x * (x * (6 * x - 15) + 10);
};

/**
 * La caminata de las que pasan por el portón, medida sin navegador con la geometría de la escena (`medirGeometria` en `carrera.ts`): las pruebas
 * y `scripts/audit-tacto.mjs` usan estas mismas cuentas.
 */
export const DT = 1 / 60;

/** Las pantallas acostadas de 16:9 y más anchas (el proyector y el escritorio), donde la caminata no pasa de 0,95 cuerpos por segundo. */
export const PANTALLAS_ANCHAS: [string, Pantalla][] = [
  ["1280x720", { w: 1280, h: 720, u: 1, retrato: false, top: 82, bottom: 720 - 106 }],
  ["1920x1080", { w: 1920, h: 1080, u: 1.5, retrato: false, top: 82, bottom: 1080 - 106 }],
  ["2340x1080", { w: 2340, h: 1080, u: 1.5, retrato: false, top: 82, bottom: 1080 - 106 }],
];
/** Las angostas (4:3): caminan más rápido lo justo para llegar a tiempo (ver `crearCaminata`). */
export const PANTALLAS_ANGOSTAS: [string, Pantalla][] = [
  ["1024x768", { w: 1024, h: 768, u: 768 / 720, retrato: false, top: 82, bottom: 768 - 106 }],
];
/** Una pantalla con la cuenta del auditor de sólidos (`scripts/lib/solidos-carrera.mjs`): la unidad, la barra de arriba y la de abajo. */
export function pantallaDe(w: number, h: number): Pantalla {
  const u = w < h ? Math.min(w / 420, h / 900) : h / 720;
  return { w, h, u, retrato: w < h, top: 60 * u, bottom: h - 90 * u };
}
/** Las cuatro pantallas del auditor de sólidos: el proyector, el escritorio, la tableta acostada y el celular parado. */
export const PANTALLAS_SOLIDOS: [string, Pantalla][] = [[1366, 768], [1920, 1080], [844, 390], [390, 844]].map(([w, h]) => [`${w}x${h}`, pantallaDe(w as number, h as number)]);

/** El ancho de un texto sin Pixi, para las pruebas: un poco más de media letra por carácter, el de una letra sin serifa. */
export const anchoAproximado = (texto: string, px: number): number => texto.length * px * 0.56;

/**
 * El alto de la tarjeta de nombres más alta de las tandas en un celular parado, con las mismas entradas que la escena
 * (`disenoTarjetaRetrato` y `hTarjeta` en `carrera.ts`) y el ancho de los textos que da `medir`. La tanda que corre va debajo de esa
 * tarjeta (`ubicarTandas`): sin ella, en el celular parado la tanda de las pruebas quedaba de 10 a 80 píxeles más arriba que la de la escena.
 * Fuera del celular parado, o sin tandas, 0.
 */
export function altoTarjetaTandas(d: Datos, P: Pantalla, medir: (texto: string, px: number) => number = anchoAproximado): number {
  if (!P.retrato || !d.tandas.length) return 0;
  const formas = planNombres(d.names).formas;
  const minimo = minimoPx("nombre", P.w, P.h);
  return Math.max(...d.tandas.map((h) => {
    const ordenados = alfabetico(d.names, h.miembros);
    return tarjetaRetrato({
      textos: ordenados.map((i) => d.names[i] ?? ""),
      cortos: ordenados.map((i) => (formas[i] as readonly string[] | undefined)?.[2] ?? d.names[i] ?? ""),
      medir,
      w: P.w, h: P.h, u: P.u, pxNominal: Math.max(tamanoLetra("nombre", P.u), minimo), pxMinimo: minimo,
    }).h;
  }));
}

/**
 * La geometría de la escena sin Pixi (`medirGeometria` en `carrera.ts`), con las trayectorias y la caminata armadas como en la escena: la
 * caminata pide a las trayectorias los lugares del corral y del grupo, y las trayectorias le suman a cada una lo que le falta caminar.
 */
export interface GeometriaDePrueba {
  cuerpo: number;
  forma: Forma;
  carr: Carriles;
  F0: number;
  ub: UbicacionTandas;
  tr: Trayectorias;
  cam: Caminata;
}

export function geometriaDe(d: Datos, P: Pantalla, sinPlazo = false, anotar?: (persona: number, eleccion: string) => void): GeometriaDePrueba {
  const cuerpo = CUERPO * ENSANCHE * RECTA * P.w;
  const nombreW = 110 * P.u;
  const grupo = formaDelGrupo({ P, d, nombrePx: 16 * P.u, nombreW, cuerpoPx: cuerpo });
  const forma = grupo.forma;
  forma.profundidad = Math.max(0, d.gente.length - 1) * d.orden.entrePuestos * cuerpo;
  const F0 = -(60 * P.u + LLAMA_HOCICO * forma.esc);
  const ub = ubicarTandas({ P, forma, F0, tam: Math.max(1, ...d.tandas.map((h) => h.miembros.length)), nombreW, hTarjeta: altoTarjetaTandas(d, P) });
  const carr = carrilesDe(P, d.lanes.length, 16 * P.u);
  let cam: Caminata | null = null;
  const tr = crearTrayectorias(d, {
    F0, Xs: F0 + d.distAbre * P.w, ancho: P.w, cuerpo, forma, carr, filaDeLugar: grupo.filaDeLugar,
    get caminata() {
      return cam;
    },
  });
  // Su lugar en el corral: la línea de su fila más su subfila, como en la escena (`lugarEnGrupo` de `carrera-trayectorias.ts`).
  cam = crearCaminata(d.tandas, {
    cuerpo, arena: ub.formaArena, arenaX: ub.arenaX, gateX: ub.gateX, escCorral: forma.esc, retrato: P.retrato,
    corral: (p) => tr.lugarEnGrupo(p, d.tSalida) ?? { x: F0, y: forma.yPie(0) },
    lugar: (p, t) => tr.sinCaminata(p, t),
    frente: (t) => tr.frente(t),
    abre: d.tAbre,
    subfila: (p) => tr.signoDe(p) * tr.delta(),
  }, sinPlazo ? { anotar } : { llegarAntesDe: d.tSalida + LLEGADA_TARDE - 0.1, anotar });
  return { cuerpo, forma, carr, F0, ub, tr, cam };
}

/** Lo que se encima, al entrar al corral, cada una que viene del portón con las que ya lo cruzaron. */
export interface ContactosAlEntrar {
  /** Cuántos cuadros con un par encimado más del 10 %. */
  cuadros: number;
  /** El peor encimado, como fracción de la huella más chica. */
  peor: number;
  /** El primer par encimado: quiénes y cuándo, respecto de la salida. */
  ejemplo: string | null;
}

/** El encimado de dos llamas del 3D (la huella más grande: la del 2D queda adentro): el área común sobre la de la más chica. */
function encimado3D(a: { x: number; y: number; esc: number }, b: { x: number; y: number; esc: number }): number {
  const caja = (c: { x: number; y: number; esc: number }): [number, number, number, number] => [c.x - 36 * c.esc * TAM3D, c.x + 38 * c.esc * TAM3D, c.y - medioAncho3D(c.esc), c.y + medioAncho3D(c.esc)];
  return encimadoCajas(caja(a), caja(b));
}

/**
 * El encimado de dos llamas del 2D, con su huella (de la cola al hocico del dibujo y medio fondo de 13, como `huellaDe` del auditor de
 * sólidos). Queda adentro de la del 3D y mide la mitad, así que su encimado puede pasar del 10 % cuando el del 3D no pasa.
 */
function encimado2D(a: { x: number; y: number; esc: number }, b: { x: number; y: number; esc: number }): number {
  const caja = (c: { x: number; y: number; esc: number }): [number, number, number, number] => [c.x + LLAMA_COLA * c.esc, c.x + LLAMA_HOCICO * c.esc, c.y - 13 * c.esc, c.y + 13 * c.esc];
  return encimadoCajas(caja(a), caja(b));
}

/** El área común de dos cajas en el piso (de x0 a x1 y de y0 a y1) sobre la de la más chica. */
function encimadoCajas(A: [number, number, number, number], B: [number, number, number, number]): number {
  const dx = Math.min(A[1], B[1]) - Math.max(A[0], B[0]);
  const dy = Math.min(A[3], B[3]) - Math.max(A[2], B[2]);
  if (dx <= 0 || dy <= 0) return 0;
  return (dx * dy) / Math.min((A[1] - A[0]) * (A[3] - A[2]), (B[1] - B[0]) * (B[3] - B[2]));
}

/**
 * Cuánto se encima, al entrar al corral, cada una que viene del portón con las demás: de la primera salida por el portón hasta que llega la
 * última, a 30 cuadros por segundo, con la huella del 3D y la cuenta del auditor de sólidos (el área común sobre la de la más chica, desde el
 * 10 %). Antes de la salida del grupo mira solo a las que ya cruzaron el portón (las de la tanda que esperan quedan atrás, en otra cuenta);
 * desde la salida, a todo el grupo, con su lugar de verdad (`posicion` de las trayectorias).
 */
export function contactosAlEntrar(d: Datos, P: Pantalla): ContactosAlEntrar {
  const out: ContactosAlEntrar = { cuadros: 0, peor: 0, ejemplo: null };
  if (!d.tandas.length) return out;
  const { tr, cam, ub } = geometriaDe(d, P);
  const salidas = new Map<number, number>();
  for (const h of d.tandas) h.pasan.forEach((p, j) => salidas.set(p, h.salidas[j] as number));
  const t0 = Math.min(...salidas.values());
  const t1 = Math.max(...d.gente.map((p) => cam.llega(p)));
  for (let t = t0; t <= t1 + 1e-9; t += 1 / 30) {
    const lista: { p: number; x: number; y: number; esc: number }[] = [];
    for (const p of d.gente) {
      if (t < (salidas.get(p) as number) || t >= (d.tiempos.cae.get(p) ?? Infinity)) continue;
      if (t < d.tSalida) {
        const w = cam.en(p, t);
        if (w && w.x >= ub.gateX) lista.push({ p, x: w.x, y: w.y, esc: w.esc });
      } else {
        const pos = tr.posicion(p, t);
        lista.push({ p, x: pos.x, y: pos.y, esc: pos.esc });
      }
    }
    let hay = false;
    for (let a = 0; a < lista.length; a++) {
      for (let b = a + 1; b < lista.length; b++) {
        const A = lista[a] as (typeof lista)[number], B = lista[b] as (typeof lista)[number];
        const v = encimado3D(A, B);
        if (v <= 0.1) continue;
        hay = true;
        out.peor = Math.max(out.peor, v);
        out.ejemplo ??= `${A.p} y ${B.p} a los ${(t - d.tSalida).toFixed(2)} s de la salida, ${(v * 100).toFixed(0)} %`;
      }
    }
    if (hay) out.cuadros++;
  }
  return out;
}

export interface MedidaCaminata {
  /**
   * El mayor desplazamiento por cuadro, la mayor velocidad y la mayor aceleración del trote solo, respecto de su lugar en el corral. La
   * aceleración es la del vector velocidad: la de adelante y la de costado juntas.
   */
  paso: number;
  vel: number;
  acel: number;
  /**
   * Lo mismo respecto del frente común (lo que ve la sala), de la salida por el portón hasta dos cuadros después de llegar: el trote más lo que se
   * mueve su lugar (el paseo del grupo o, si la recta ya se abrió, su carril).
   */
  pasoFrente: number;
  velFrente: number;
  acelFrente: number;
  tarde: number;
  antesDeEchada: boolean;
  caminan: number;
}

/** Cuántos cuerpos, cuánto tarda y qué tope de paso, velocidad y aceleración tiene la caminata, con un nombre de ancho `110 u` y letra de `16 u`. */
export function medirCaminata(d: Datos, P: Pantalla, sinPlazo = false): MedidaCaminata {
  // La geometría, las trayectorias y la caminata, como en la escena; los carriles de la final y el paso de las filas del grupo a ellos, también.
  const { cuerpo, F0, tr, cam, carr } = geometriaDe(d, P, sinPlazo);
  const corral = (p: number): { x: number; y: number } => tr.lugarEnGrupo(p, d.tSalida) ?? { x: F0, y: 0 };
  const fraccionMovida = (t: number): number => suave5((t - d.tCarriles) / CARRIL_DURA);
  let paso = 0, vel = 0, acel = 0, pasoFrente = 0, velFrente = 0, acelFrente = 0, tarde = -Infinity, caminan = 0;
  let antesDeEchada = true;
  for (const h of d.tandas) {
    for (const p of h.pasan) {
      caminan++;
      const llega = cam.llega(p);
      tarde = Math.max(tarde, llega - d.tSalida);
      if (llega > (d.tiempos.cae.get(p) ?? Infinity)) antesDeEchada = false;
      // La posición respecto del frente común: la caminata más lo que se mueve su lugar, que es el del grupo (el paseo, que arranca en la salida)
      // o, desde que se abre la recta, el de su carril (la misma cuenta que `posicion` en `carrera.ts`).
      const c = corral(p);
      const k = d.lanes.indexOf(p);
      const rel = (t: number): { x: number; y: number } => {
        const w = cam.en(p, t);
        let g: { x: number; y: number };
        if (t < d.tAbre || k < 0) {
          const tt = Math.max(d.tSalida, Math.min(t, d.tAbre));
          g = { x: F0 + d.orden.puntaje(p, tt) * cuerpo, y: c.y };
        } else {
          const q = d.q(t);
          const yl = carr.yPie(k) + (d.final.lateral?.(k, q) ?? 0) * carr.altoFila;
          const e = fraccionMovida(t);
          g = { x: F0 + ((d.final.pos(k, q) - q) / CUERPO) * cuerpo, y: c.y + (yl - c.y) * e };
        }
        if (!w) return { x: g.x - 1e9, y: g.y };
        return t < llega ? { x: g.x + (w.x - c.x), y: g.y + (w.y - c.y) } : g;
      };
      // La caminata sola, respecto de su lugar en el corral: el trote, con sus topes.
      const sola = (t: number): { x: number; y: number } => cam.en(p, t) ?? { x: c.x - 1e9, y: c.y };
      const t0 = (h.salidas[h.pasan.indexOf(p)] as number) + 0.01;
      // Hasta dos cuadros después de llegar: así se ve también el empalme con su lugar, en el grupo o en la recta.
      const t1 = Math.min(llega + 2 * DT, d.tiempos.cae.get(p) ?? Infinity);
      // La aceleración se mide como vector (el cambio de la velocidad en x y en y entre dos cuadros): así cuenta también la de costado en una
      // curva, que no cambia lo rápido que va y que el cambio de la rapidez sola no ve.
      const medir = (lugar: (t: number) => { x: number; y: number }): { paso: number; vel: number; acel: number } => {
        const out = { paso: 0, vel: 0, acel: 0 };
        const a = lugar(t0);
        let b = lugar(t0 + DT);
        let vPrev = { x: (b.x - a.x) / cuerpo / DT, y: (b.y - a.y) / cuerpo / DT };
        for (let t = t0 + 2 * DT; t <= t1; t += DT) {
          const c2 = lugar(t);
          const v = { x: (c2.x - b.x) / cuerpo / DT, y: (c2.y - b.y) / cuerpo / DT };
          const rapidez = Math.hypot(v.x, v.y);
          out.paso = Math.max(out.paso, rapidez * DT);
          out.vel = Math.max(out.vel, rapidez);
          out.acel = Math.max(out.acel, Math.hypot(v.x - vPrev.x, v.y - vPrev.y) / DT);
          vPrev = v;
          b = c2;
        }
        return out;
      };
      const frente = medir(rel), trote = medir(sola);
      paso = Math.max(paso, trote.paso);
      vel = Math.max(vel, trote.vel);
      acel = Math.max(acel, trote.acel);
      pasoFrente = Math.max(pasoFrente, frente.paso);
      velFrente = Math.max(velFrente, frente.vel);
      acelFrente = Math.max(acelFrente, frente.acel);
    }
  }
  return { paso, vel, acel, pasoFrente, velFrente, acelFrente, tarde, antesDeEchada, caminan };
}


/** Lo que se encima en las tandas, antes de la salida del grupo, por clase de par. */
export interface EncimadasEnTandas {
  /** Cuadros con una de pie (esperando su tanda o recién aparecida) adentro de una echada de otra tanda. */
  sobreEchadaAjena: number;
  /** Cuadros con una que camina hacia el portón encima de una echada de su tanda. */
  caminaSobreEchada: number;
  /** Cuadros con una que camina encima de otra que espera su tanda. */
  caminaSobreQuieta: number;
  /** Cuadros con dos que caminan encimadas, una por lo menos todavía antes del portón (las de después las mide `contactosAlEntrar`). */
  caminaSobreCamina: number;
  /** El primer caso de la primera clase. */
  ejemplo: string | null;
  /** El primer caso de las tres clases de la que camina. */
  ejemploCamina: string | null;
}

/**
 * Lo que se encima en las tandas, de la primera a la salida del grupo, a 30 cuadros por segundo, con la cuenta que dibuja la escena (`enTanda`) y
 * la huella de `motor` (desde el 10 %, como el auditor de sólidos): las que esperan contra las echadas de otra tanda, y las que caminan contra las
 * echadas, contra las que esperan y entre ellas antes del portón (las filas de las tandas del auditor). `g` es la geometría de la pantalla, para
 * medir los dos motores con la misma caminata.
 */
export function encimadasEnTandas(d: Datos, P: Pantalla, motor: "3d" | "2d" = "3d", g: GeometriaDePrueba = geometriaDe(d, P)): EncimadasEnTandas {
  const out: EncimadasEnTandas = { sobreEchadaAjena: 0, caminaSobreEchada: 0, caminaSobreQuieta: 0, caminaSobreCamina: 0, ejemplo: null, ejemploCamina: null };
  if (!d.tandas.length) return out;
  const { cam, ub } = g;
  const encimado = motor === "2d" ? encimado2D : encimado3D;
  const tandaDe = new Map<number, number>();
  d.tandas.forEach((h, k) => h.miembros.forEach((m) => tandaDe.set(m, k)));
  const t0 = Math.min(...d.tandas.map((h) => h.t0)) - 0.2;
  for (let t = t0; t < d.tSalida; t += 1 / 30) {
    const de = [...tandaDe].flatMap(([p, k]) => {
      const e = enTanda(d.tandas[k] as Tanda, p, t, ub.formaArena, ub.arenaX, cam, d.tandas[k - 1]);
      return e.que === "oculta" ? [] : [{ p, k, ...e }];
    });
    let ajena = false, sobreEchada = false, sobreQuieta = false, sobreCamina = false;
    for (const a of de) {
      if (a.que === "echada" || a.que === "corral") continue;
      for (const b of de) {
        if (b === a || b.que === "corral" || (a.que === "espera" && b.que !== "echada")) continue;
        // Dos que caminan: el par una sola vez, y solo si una no cruzó el portón todavía.
        if (b.que === "camina" && (b.p < a.p || (a.x >= ub.gateX && b.x >= ub.gateX))) continue;
        const v = encimado(a, b);
        if (v <= 0.1) continue;
        if (a.que === "espera" && b.que === "echada") {
          if (a.k !== b.k) {
            ajena = true;
            out.ejemplo ??= `${a.p} (tanda ${a.k}) sobre ${b.p} (tanda ${b.k}) a los ${(t - d.tSalida).toFixed(2)} s de la salida`;
          }
          continue;
        }
        if (b.que === "echada") sobreEchada = true;
        else if (b.que === "espera") sobreQuieta = true;
        else sobreCamina = true;
        out.ejemploCamina ??= `${a.p} (tanda ${a.k + 1}) camina sobre ${b.p} (${b.que}, tanda ${b.k + 1}) a los ${(t - d.tSalida).toFixed(2)} s de la salida, ${(v * 100).toFixed(0)} %`;
      }
    }
    if (ajena) out.sobreEchadaAjena++;
    if (sobreEchada) out.caminaSobreEchada++;
    if (sobreQuieta) out.caminaSobreQuieta++;
    if (sobreCamina) out.caminaSobreCamina++;
  }
  return out;
}
