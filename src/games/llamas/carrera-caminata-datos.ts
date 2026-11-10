import { LLEGADA_TARDE, crearCaminata, filaDeRango, ubicarTandas } from "./carrera-caminata";
import { carrilesDe, formaDe, type Pantalla } from "./carrera-forma";
import { CARRIL_DURA, CUERPO } from "./carrera-marcha";
import { ENSANCHE } from "./carrera-obstaculos";
import { RECTA, type Datos } from "./carrera-show";

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

export interface MedidaCaminata {
  /** El mayor desplazamiento por cuadro, la mayor velocidad y el mayor cambio de velocidad del trote solo, respecto de su lugar en el corral. */
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
  const cuerpo = CUERPO * ENSANCHE * RECTA * P.w;
  const nombreW = 110 * P.u;
  const forma = formaDe(P, Math.max(1, d.gente.length), 16 * P.u, nombreW);
  forma.profundidad = Math.max(0, d.gente.length - 1) * d.orden.entrePuestos * cuerpo;
  const F0 = -(60 * P.u + 30 * forma.esc);
  const ub = ubicarTandas({ P, forma, F0, tam: Math.max(...d.tandas.map((h) => h.miembros.length)), nombreW });
  const corral = (p: number): { x: number; y: number } => ({ x: F0 + d.orden.puntaje(p, d.tSalida) * cuerpo, y: forma.yPie(filaDeRango(d.orden.rango(p), forma.filas)) });
  const cam = crearCaminata(d.tandas, { cuerpo, arena: ub.formaArena, arenaX: ub.arenaX, gateX: ub.gateX, escCorral: forma.esc, corral }, sinPlazo ? {} : { llegarAntesDe: d.tSalida + LLEGADA_TARDE - 0.1 });
  // Los carriles de la final y el paso de las filas del grupo a ellos, como en la escena.
  const carr = carrilesDe(P, d.lanes.length, 16 * P.u);
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
      const medir = (lugar: (t: number) => { x: number; y: number }): { paso: number; vel: number; acel: number } => {
        const out = { paso: 0, vel: 0, acel: 0 };
        let a = lugar(t0), b = lugar(t0 + DT), vPrev = Math.hypot(b.x - a.x, b.y - a.y) / cuerpo / DT;
        for (let t = t0 + 2 * DT; t <= t1; t += DT) {
          const c2 = lugar(t);
          const dd = Math.hypot(c2.x - b.x, c2.y - b.y) / cuerpo;
          out.paso = Math.max(out.paso, dd);
          const v = dd / DT;
          out.vel = Math.max(out.vel, v);
          out.acel = Math.max(out.acel, Math.abs(v - vPrev) / DT);
          vPrev = v;
          a = b;
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

