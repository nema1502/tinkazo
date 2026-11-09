/**
 * Lo que comparten las pruebas de la cámara de la carrera: arma un plan de la carrera, pone a las finalistas donde las pone la escena y
 * corre la cámara a 60 cuadros por segundo, sin navegador. De cada cuadro deja la pose, el plano, y el alto de cada llama en la
 * pantalla calculado por la geometría de la cámara (la misma cuenta que `medir-escala-carrera`: de la cabeza al pie).
 *
 * Las posiciones de la recta son las de `posicion` en `carrera.ts` (`xl`, `yl`) sin la mezcla de la primera segundo y medio, que viene
 * de la forma del grupo: acá las finalistas empiezan ya en sus carriles. La cámara solo lee posiciones, así que lo que cambie el modelo
 * de movimiento no cambia estas pruebas mientras `posicion` siga devolviendo dónde pisa cada una.
 */

import { tiemposFoco } from "../pixi/foco";
import { tamanoLetra } from "../pixi/kit/nombres";
import { camara3D, type Pose3D } from "./carrera-3d-mapa";
import { aLaVistaPx, cajaEnPantalla, crearCamara3D, type Plano, type Puesto } from "./carrera-camara";
import { LLAMA_HOCICO, carrilesDe, type Pantalla } from "./carrera-forma";
import { ENSANCHE } from "./carrera-obstaculos";
import { ctxDe } from "./carrera-prueba";
import { RECTA, planCarrera, type Datos } from "./carrera-show";

/** La pantalla del estadio para un tamaño: las mismas cuentas de `stage.ts` (`u`, `top`, `bottom`, `portrait`). */
export function pantallaDe(w: number, h: number): Pantalla {
  const retrato = h > w * 1.1;
  const u = retrato ? Math.min(w / 420, h / 900) : h / 720;
  return { w, h, u, retrato, top: w <= 520 ? 100 : 82, bottom: h - (w <= 520 ? 118 : 106) };
}

export const PANTALLAS = { proyector: pantallaDe(1920, 1080), celular: pantallaDe(390, 844) } as const;

export interface Cuadro {
  t: number;
  pose: Pose3D;
  plano: Plano;
  corte: boolean;
  foto: boolean;
  puestos: Puesto[];
  /** Alto en la pantalla de cada finalista (por carril) y si se ve (su centro adentro de la pantalla). */
  altos: { alto: number; visible: boolean }[];
}

export interface Corrida {
  d: Datos;
  P: Pantalla;
  carr: ReturnType<typeof carrilesDe>;
  metaX: number;
  Xs: number;
  tGolpe: number;
  cuadros: Cuadro[];
  hitos: { frente: number; foto: number };
  /** Dónde pisa cada finalista en una hora cualquiera: lo que la escena le da a la cámara para las horas de la grilla. */
  puestosEn: (t: number) => Puesto[];
}

/** Un cuadro largo en el medio: el primer cuadro que cae en `desde` o después salta `dur` segundos de golpe (un tirón de la máquina). */
export interface Hueco {
  desde: number;
  dur: number;
}

/** Dónde pisa cada finalista en `t`, como lo calcula `posicion` en la recta (sin la mezcla de entrada). */
export function puestosDe(d: Datos, carr: ReturnType<typeof carrilesDe>, P: Pantalla, Xs: number, t: number): Puesto[] {
  const qq = d.q(t);
  return d.lanes.map((persona, carril) => {
    const pq = d.final.pos(carril, qq);
    return {
      persona,
      x: Xs + (qq + (pq - qq) * ENSANCHE) * RECTA * P.w,
      y: carr.yPie(carril) + (d.final.lateral?.(carril, qq) ?? 0) * carr.altoFila,
      esc: carr.esc,
    };
  });
}

/**
 * Corre la cámara sobre una ronda: de dos segundos antes de abrir la recta a `despues` segundos después de T. Los cuadros caen en `i / fps`
 * (las horas de la grilla de 60 pasos por segundo cuando `fps` divide a 60 o es 120) y, si se pide, con cuadros largos en el medio (`huecos`).
 * Con `saltoGanadora`, desde T quien gana lleva ese salto (`Puesto.salto`, en píxeles del mundo 2D).
 */
export function correr(n: number, semilla: number, P: Pantalla, despues = 7, fps = 60, huecos: readonly Hueco[] = [], bajoCartel?: number, saltoGanadora = 0): Corrida {
  const d = planCarrera(ctxDe(n, semilla)).datos;
  const carr = carrilesDe(P, d.lanes.length, tamanoLetra("nombre", P.u));
  const Xs = 0;
  const metaX = Xs + RECTA * P.w + LLAMA_HOCICO * carr.esc;
  const tGolpe = d.tCrown + tiemposFoco(d.final.story.arc).golpe;
  const cam = crearCamara3D({ marco: { w: P.w, h: P.h, u: P.u }, tAbre: d.tAbre, tCrown: d.tCrown, tGolpe, metaX, carriles: { y0: carr.y0, y1: carr.y1, n: carr.n, esc: carr.esc } });
  const cuadros: Cuadro[] = [];
  let golpeEn: number | null = null;
  const puestosEn = (t: number): Puesto[] => puestosDe(d, carr, P, Xs, t).map((c) => (saltoGanadora > 0 && c.persona === d.campeona && t >= d.tCrown ? { ...c, salto: saltoGanadora } : c));
  const pendientes = [...huecos].sort((a, b) => a.desde - b.desde);
  for (let i = Math.ceil(Math.max(0, d.tAbre - 2) * fps - 1e-9); i / fps <= d.tCrown + despues; i++) {
    const t = i / fps;
    const puestos = puestosEn(t);
    // La cámara del director del 2D en el grupo: mira a la cabeza del grupo, quieta, a zoom 1 (lo que hace `vistaGrupo`).
    const base = camara3D({ x: Xs - 0.2 * P.w, y: P.h / 2, zoom: 1, rot: 0 }, P.w, P.h, P.u, carr.esc);
    if (golpeEn === null && t >= tGolpe) golpeEn = t;
    const s = cam.cuadro({ t, puestos, puestosEn, base, ganadora: d.campeona, golpeEn, bajoCartel });
    const altos = puestos.map((c) => {
      const caja = cajaEnPantalla(s.pose, P.w, P.h, P.u, c);
      return { alto: caja.alto, visible: aLaVistaPx(caja, P.w, P.h) };
    });
    cuadros.push({ t, pose: s.pose, plano: s.plano, corte: s.corte, foto: s.foto, puestos, altos });
    // El cuadro que cae en `desde` o después es seguido por uno que llega `dur` más tarde: entre los dos, un cuadro largo.
    const hueco = pendientes[0];
    if (hueco && t >= hueco.desde) {
      pendientes.shift();
      i += Math.round(hueco.dur * fps) - 1;
    }
  }
  return { d, P, carr, metaX, Xs, tGolpe, cuadros, hitos: cam.hitos(), puestosEn };
}
