import {
  BackSide, BoxGeometry, BufferGeometry, CanvasTexture, CircleGeometry, DoubleSide, Float32BufferAttribute, Group, HemisphereLight,
  InstancedMesh, Mesh, MeshBasicMaterial, MeshLambertMaterial, Object3D, PerspectiveCamera, PlaneGeometry, Quaternion, RepeatWrapping, SRGBColorSpace,
  TorusGeometry, Vector3,
} from "three";
import { crearAmbiente } from "./escena";
import { crearGeometrias, Instancias, Materiales, pieza } from "./figuras";
import { hash } from "./ids";
import { aplicarPose, perfilFiel, poseCamara, type Mapa, type PerfilMapa } from "./camara";
import { definir3D } from "./motor";
import type { Camara2D, EntradaBase, Fabrica3D, Lanzador } from "./tipos";

/**
 * El sapo en 3D. El 2D (`pixi/sapo.ts`) decide todo: los tiros, dónde cae cada argolla y cuándo, quién gana. Esta vista
 * solo dibuja lo que el 2D ya puso, cuadro a cuadro: el cajón con sus agujeros, la rana, la mano y las argollas con
 * su altura de verdad. No guarda nada que cambie lo que pasa: cada cuadro es función de lo que recibe.
 *
 * Todo el cajón vive en un grupo (`mundo`) medido en unidades de la mesa (la rana mide 0,34; la tapa, 3,2): el grupo se
 * lleva al lugar del 2D con la cuenta de la casa (`mapa.a3D`), así los agujeros caen donde el 2D los puso y las fichas
 * de nombre, que siguen siendo de PixiJS, se apoyan en el borde de cada aro con la misma proyección que ve la cámara.
 */

/* ===================================================================== lo que el 2D le pasa */

export interface PuntoMesa {
  x: number;
  y: number;
}

/** El 3D le devuelve al 2D cómo llevar un punto de la mesa a la pantalla (el 2D lo usa para anclar nombres, medallas y el foco). */
export interface Puente {
  aPantalla?: (p: PuntoMesa, alto?: number) => { x: number; y: number } | null;
  /** La caja en la pantalla del aro destacado (el agujero encendido del todo) tal como lo dibujó la cámara del último cuadro, o null. */
  destacada?: () => CajaPantalla | null;
}

/** Una caja en píxeles de la pantalla (los mismos del estadio de PixiJS). */
export interface CajaPantalla {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type EstadoArgolla = "mano" | "vuelo" | "rueda" | "baile" | "hunde" | "boca-entra" | "boca-sale" | "oculta";

export interface ArgollaSapo {
  estado: EstadoArgolla;
  /** Dónde está sobre la tapa, en unidades de la mesa. */
  suelo: PuntoMesa;
  /** Cuánto se levantó de la tapa (el vuelo, un rebote), en unidades de la mesa. */
  alto: number;
  /** Cuánto de su tamaño y cuánto se ve (la boca, el borde de la mesa). */
  escala: number;
  alfa: number;
  /** El avance de lo que hace (el vuelo de 0 a 1, el baile de 0 a 1, el hundirse de 0 a 1). */
  u: number;
  /** Segundos desde que aterrizó, o desde que empezó a rodar. */
  edad: number;
  /** El último tiro: lleva su aro nítido, como en el 2D. */
  ultima: boolean;
  /** El centro del agujero en cuyo borde baila, o null. */
  borde: PuntoMesa | null;
}

export interface AgujeroSapo {
  /** Cuánto apareció (0 a 1, con el rebote del 2D). */
  nace: number;
  /** El color de la cara de quien lo tiene (el aro es de ese color). */
  aro: number;
  /** 0: libre; 0,6: ya cayó una argolla (un premio); 1: cayó la última. */
  lit: number;
}

export interface EntradaSapo extends EntradaBase {
  puente: Puente;
  /** Dónde está la mesa en el mundo 2D: el centro, los píxeles por unidad de la mesa y el aplastamiento vertical. */
  mesa: { cx: number; cy: number; sc: number; tilt: number };
  /** Los agujeros, la rana y la tapa, en unidades de la mesa (`holeLayout`). */
  trazo: { holes: readonly PuntoMesa[]; holeR: number; frogR: number; tableR: number };
  /** Cuánto mide el radio de la argolla, en unidades de la mesa. */
  radio: number;
  agujeros: readonly AgujeroSapo[];
  rana: {
    /** Apertura de la boca de 0 a 1. */
    boca: number;
    /** El ojo: 1 abierto, 0,15 parpadeando. */
    ojo: number;
    /** El palpito de la garganta. */
    garganta: number;
    /** Segundos desde que el último tiro pegó en su labio, o -1. */
    labio: number;
    /** Hacia dónde mira cuando se ríe del golpe (el agujero del ganador), o null antes. */
    mira: PuntoMesa | null;
    /** Quieta del todo: el silencio de antes de que caiga la última argolla. */
    quieta: boolean;
  };
  mano: { visible: boolean; punto: PuntoMesa; /** de -0,8 a 1: el impulso hacia atrás y el suelte */ swing: number; manga: number };
  argollas: readonly ArgollaSapo[];
  /** Cada golpe de una argolla contra la tapa, para las astillas: hora de juego y lugar. */
  golpes: readonly { t: number; punto: PuntoMesa; fuerza: number }[];
  /** De 0 a 1: el empuje de emoción que sube desde que sale la última argolla hasta la corona. */
  tension: number;
  /** La hora de juego en que salió el golpe de la corona, o -1 si falta. */
  golpe: number;
  /** La hora en que cayó la última argolla en su agujero, o -1. */
  adentro: number;
  /** De 0 a 1: cuánto se suelta el tope del acercamiento para el primer plano del final (lo pide el 2D en el celular apaisado). */
  primerPlano?: number;
  /**
   * Con el primer plano, antes de dibujar: recibe la caja del aro destacado tal como lo vería la cámara de este cuadro, la
   * encaja entre el cartel y el relator y devuelve la cámara del 2D corregida (o null si ya cabía). Ver `encajarAntes`.
   */
  encajar?: (caja: CajaPantalla) => Camara2D | null;
}

/* ===================================================================== las cuentas puras (se prueban en Node) */

/** Lo alto de la tapa: la argolla nunca baja de acá mientras no se hunda en un agujero. */
export const TAPA_Y = 0.004;
/** El eje de la argolla (toro de radio mayor 0,7 y grosor 0,3 de su radio exterior). */
export const TORO_R = 0.7;
export const TORO_T = 0.3;
/** La inclinación con que queda montada sobre el aro. */
const MONTADA = 0.22;
/** La cámara, en radianes. */
const FOV = (32 * Math.PI) / 180;

/** La altura de la rana en `(x, z)`: la del cuerpo, para que una argolla que cae encima no la atraviese. */
export function alturaRana(x: number, z: number, fr: number): number {
  const a = x / (0.95 * fr), b = (z + 0.25 * fr) / (0.8 * fr);
  const q = 1 - a * a - b * b;
  return q <= 0 ? 0 : 0.62 * fr + 0.62 * fr * Math.sqrt(q);
}

export interface PoseArgolla {
  x: number;
  y: number;
  z: number;
  /** La inclinación del eje de la argolla respecto de la vertical y hacia dónde, en radianes. */
  inclina: number;
  rumbo: number;
  /** El giro de la argolla sobre su propio eje. */
  gira: number;
  esc: number;
  visible: boolean;
  /** El punto más bajo de la argolla, para comprobar que no se mete en la tapa. */
  bajo: number;
}

/** Cuánto sube la argolla para que su punto más bajo quede a `piso` aunque esté inclinada `inc`. */
export const centroSobre = (piso: number, br: number, inc: number): number => piso + br * TORO_R * Math.sin(inc) + br * TORO_T;

const suave = (x: number): number => {
  const k = Math.min(1, Math.max(0, x));
  return k * k * (3 - 2 * k);
};
const salida3 = (x: number): number => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);

/**
 * Dónde está y cómo está inclinada una argolla, a partir de lo que el 2D dice que hace. `br` es su radio en unidades de
 * la mesa; `fr` el de la rana; `mano` y `boca` dónde están en 3D. Sin azar: todo sale de `u` y `edad`.
 */
export function poseArgolla(a: ArgollaSapo, br: number, fr: number, mano: readonly [number, number, number], boca: readonly [number, number, number]): PoseArgolla {
  const esc = Math.max(0.01, a.escala);
  const r = br * esc;
  let x = a.suelo.x, z = a.suelo.y, y = 0, inc = 0, rumbo = 0, gira = 0;
  let visible = a.alfa > 0.02 && a.estado !== "oculta";
  let piso = TAPA_Y;
  switch (a.estado) {
    case "mano": {
      x = mano[0] - 0.03;
      z = mano[2] - 0.02;
      y = mano[1] + 0.01;
      inc = 0.35;
      rumbo = 0.6;
      break;
    }
    case "vuelo": {
      const f = a.u;
      inc = 0.1 + 0.4 * Math.sin(Math.PI * f);
      rumbo = f * 13;
      gira = f * 20;
      // Sale de la mano y no de la tapa: la altura de la mano se apaga en el primer cuarto del vuelo.
      const deLaMano = (mano[1] - 0.02) * Math.pow(Math.max(0, 1 - f * 3), 2);
      y = centroSobre(piso, r, inc) + a.alto + deLaMano;
      break;
    }
    case "rueda": {
      // Plana sobre la tapa; al salir del baile se acuesta en un instante.
      const asiento = a.u > 0 ? MONTADA * Math.max(0, 1 - a.edad / 0.14) : 0;
      inc = asiento;
      rumbo = a.edad * 5;
      gira = a.edad * 9;
      y = centroSobre(piso, r, inc) + a.alto;
      break;
    }
    case "baile": {
      // Montada en el aro del vecino: el lado de adentro apoya en el aro, el de afuera en la madera, y bambolea
      // como una moneda al caer, cada vez menos. Nunca por debajo de la tapa.
      const u = a.u;
      const fuera = a.borde ? Math.atan2(a.suelo.y - a.borde.y, a.suelo.x - a.borde.x) : 0;
      inc = MONTADA + 0.3 * Math.pow(1 - u, 1.5) * (0.6 + 0.4 * Math.abs(Math.sin(a.edad * 17)));
      rumbo = fuera + a.edad * 21 * (1 - 0.4 * u);
      gira = a.edad * 12;
      y = centroSobre(piso, r, inc) + a.alto * 0.5;
      break;
    }
    case "hunde": {
      // Baja por el agujero hasta perderse debajo de la tapa.
      inc = 0.05;
      y = centroSobre(piso, r, inc) - 0.6 * salida3(a.u);
      visible = visible && a.u < 1;
      piso = -1;
      break;
    }
    case "boca-entra": {
      const u = a.u;
      x = a.suelo.x + (boca[0] - a.suelo.x) * u;
      z = a.suelo.y + (boca[2] - a.suelo.y) * u;
      y = centroSobre(piso, r, 0.3) + (boca[1] - 0.02) * suave(u) + alturaRana(x, z, fr) * (1 - suave(u)) * 0;
      inc = 0.3 + u;
      rumbo = u * 6;
      piso = -1;
      break;
    }
    case "boca-sale": {
      const f = a.u;
      inc = 0.2 + 0.3 * Math.sin(Math.PI * f);
      rumbo = f * 10;
      gira = f * 16;
      y = centroSobre(TAPA_Y, r, inc) + a.alto + (boca[1] - 0.02) * Math.pow(1 - f, 2);
      break;
    }
    default:
      visible = false;
  }
  // Por encima del cuerpo de la rana, no a través de él (la argolla que pega en su labio o en su boca).
  if (a.estado === "vuelo" || a.estado === "rueda" || a.estado === "boca-sale") {
    const cuerpo = alturaRana(x, z, fr);
    if (cuerpo > 0) y = Math.max(y, cuerpo + br * TORO_T + (a.estado === "vuelo" ? a.alto : 0));
  }
  // Al salir del borde de la mesa cae por el costado: se achica y baja con lo que se desvanece.
  if (a.alfa < 1 && (a.estado === "rueda" || a.estado === "baile")) {
    y -= (1 - a.alfa) * 0.9;
    piso = -1;
  }
  const bajo = y - br * esc * (TORO_R * Math.sin(inc) + TORO_T);
  return { x, y, z, inclina: inc, rumbo, gira, esc, visible, bajo: piso < 0 ? Math.min(bajo, 0) : bajo };
}

/**
 * Dónde queda el grupo de la mesa en el mundo 3D: la cuenta de la casa (`mapa.a3D`) lleva el centro de la mesa del 2D, y la
 * escala pasa de unidades de la mesa a unidades del mundo (en profundidad, con el aplastamiento del 2D deshecho por `zc`).
 */
export function lugarDelMundo(mapa: Mapa, mesa: { cx: number; cy: number; sc: number; tilt: number }): { px: number; pz: number; K: number; Kz: number } {
  const [px, , pz] = mapa.a3D(mesa.cx, mesa.cy, 0);
  return { px, pz, K: mesa.sc * mapa.s, Kz: mesa.sc * mesa.tilt * mapa.s * mapa.perfil.zc };
}

/** La elevación de la cámara que corresponde al aplastamiento del 2D (`tilt`): en un celular, algo menos alta que de frente. */
export const elevacionDe = (tilt: number): number => (tilt > 0.8 ? 1.1 : Math.asin(Math.min(0.999, Math.max(0.2, tilt))));

/** Cuánto se acerca o se aleja la cámara respecto de lo que encuadra el 2D, por pantalla: con perspectiva la fila de adelante se agranda y el cajón se salía por abajo. */
const AJUSTE = {
  ancho: { acerca: 1.14, levanta: 0, zc: 1, pie: -14 },
  celular: { acerca: 1.04, levanta: 0, zc: 1, pie: 0 },
};

/** El perfil de cámara del sapo. Conserva las proporciones del piso del 2D (`zc = 1 / sin(elevación)`) salvo lo que dice `AJUSTE`. */
export const perfilSapo = (tilt: number, delta = 0): PerfilMapa => {
  const a = tilt > 0.8 ? AJUSTE.celular : AJUSTE.ancho;
  const base = elevacionDe(tilt) + a.levanta;
  const f = perfilFiel(base, { fov: FOV, acerca: a.acerca, tam: 1, altoMira: 0, pieMira: a.pie });
  return { ...f, zc: f.zc * a.zc, elevacion: base + delta };
};

/**
 * Lo más que se acerca la cámara 3D, en vez de los 1,45 a 1,6 del director del 2D. En 2D el acercamiento recorta la mesa en
 * plano; con perspectiva la fila de adelante se agranda además y los agujeros de abajo se salían de cuadro. Lo que el director
 * pide por encima de esto se achica en la misma proporción (el centro vuelve hacia el de la pantalla), sin saltos: hasta
 * `ZOOM_MAX` la cámara es la del director. Depende solo de la cámara del 2D, nunca de quién gana.
 */
export const ZOOM_MAX = 1.1;
export function camaraDelSapo(cam: Camara2D, w: number, h: number, tope = ZOOM_MAX, primerPlano = 0): Camara2D {
  if (cam.zoom <= tope) return cam;
  const k = (tope - 1) / (cam.zoom - 1);
  const recortada = { ...cam, zoom: tope, x: w / 2 + (cam.x - w / 2) * k, y: h / 2 + (cam.y - h / 2) * k };
  // El primer plano del final suelta el tope de a poco: de la cámara recortada a la del director, sin saltos.
  const p = Math.min(1, Math.max(0, primerPlano));
  if (p <= 0) return recortada;
  if (p >= 1) return cam;
  return { ...cam, zoom: tope + (cam.zoom - tope) * p, x: recortada.x + (cam.x - recortada.x) * p, y: recortada.y + (cam.y - recortada.y) * p };
}

/** Cuánto baja o sube la cámara: entra más alta y baja en 2,5 s; con el empuje de emoción baja 4 grados más; en el golpe, 3 más. */
export function deltaCamara(t: number, tension: number, golpe: number): number {
  const entra = 0.105 * (1 - suave(t / 2.5));
  const empuje = -0.07 * suave(tension);
  const contra = golpe >= 0 ? -0.05 * suave((t - golpe) / 0.6) : 0;
  return entra + empuje + contra;
}

/** Cuánto baja la luz del mundo con el golpe (1: normal). Baja en 0,25 s y vuelve a un poco más de la mitad mientras dura el cartel. */
export function luzDelGolpe(t: number, golpe: number): number {
  if (golpe < 0 || t < golpe) return 1;
  const a = t - golpe;
  const baja = 1 - 0.5 * suave(a / 0.25);
  return a < 0.25 ? baja : baja + 0.18 * suave((a - 0.25) / 1.2);
}

/** La tapa salta un 2 % de su alto cuando cae la última argolla (en unidades de la mesa). */
export const saltoTapa = (t: number, adentro: number): number =>
  adentro >= 0 && t - adentro < 0.25 ? 0.03 * Math.sin((Math.PI * (t - adentro)) / 0.25) : 0;

/** Cuánto crece el anillo amarillo del agujero encendido del todo desde el golpe: un 15 % en 0,3 s. */
export const crecidaAnillo = (t: number, golpe: number): number => 1 + 0.15 * suave((t - golpe) / 0.3);

/** Lo que se dibuja del aro destacado, en unidades de la mesa: su centro, su radio exterior y de qué altura a qué altura. */
export interface AroDestacado {
  x: number;
  z: number;
  radio: number;
  bajo: number;
  alto: number;
}

/**
 * El aro del agujero encendido del todo (`lit >= 1`) con lo que el cuadro le dibuja: el aro de color (radio 1,08 del
 * agujero, tubo de 0,13, alto 1,5) y, desde el golpe, el anillo amarillo que crece (1,1 del agujero, tubo de 0,2). Con el
 * salto de la tapa. Null si ningún agujero está encendido del todo.
 */
export function aroDestacado(e: Pick<EntradaSapo, "trazo" | "agujeros" | "t" | "golpe" | "adentro">): AroDestacado | null {
  const s = e.agujeros.findIndex((a) => a.lit >= 1);
  const h = e.trazo.holes[s];
  if (s < 0 || !h) return null;
  const R = e.trazo.holeR;
  const sube = saltoTapa(e.t, e.adentro);
  const r = R * 1.08 * Math.max(0.0001, (e.agujeros[s] as AgujeroSapo).nace);
  const yAro = 0.0155 * R / 0.145;
  let radio = r * 1.13, bajo = yAro - 0.13 * r * 1.5, alto = yAro + 0.13 * r * 1.5;
  if (e.golpe >= 0) {
    radio = Math.max(radio, R * 1.1 * crecidaAnillo(e.t, e.golpe) * 1.2);
    bajo = Math.min(bajo, 0.02 - 0.2 * R * 1.3);
    alto = Math.max(alto, 0.02 + 0.2 * R * 1.3);
  }
  return { x: h.x, z: h.y, radio, bajo: bajo + sube, alto: alto + sube };
}

/** La caja en la pantalla del contorno de un aro, por la proyección dada y con el lugar del grupo de la mesa (`lugarDelMundo`). */
export function cajaDeAro(aro: AroDestacado, lugar: { px: number; pz: number; K: number; Kz: number },
  proyectar: (x: number, y: number, z: number) => { x: number; y: number } | null): CajaPantalla | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const N = 32;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    const x = lugar.px + lugar.K * (aro.x + aro.radio * Math.cos(a)), z = lugar.pz + lugar.Kz * (aro.z + aro.radio * Math.sin(a));
    for (const y of [aro.bajo, aro.alto]) {
      const p = proyectar(x, lugar.K * y, z);
      if (!p) continue;
      x0 = Math.min(x0, p.x);
      y0 = Math.min(y0, p.y);
      x1 = Math.max(x1, p.x);
      y1 = Math.max(y1, p.y);
    }
  }
  return x1 >= x0 && y1 >= y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}

const camaraPrevia = new PerspectiveCamera(36, 1, 0.5, 4000);
const puntoPrevio = new Vector3();

/**
 * Dónde caería un punto 3D en la pantalla con la cámara que `motor.cuadro` pondría para esta cámara del 2D (la misma
 * `poseCamara` y la misma `aplicarPose`), sin dibujar: para despejar antes del cuadro y no dibujarlo dos veces.
 */
export function proyectorDe(cam: Camara2D, w: number, h: number, u: number, perfil: PerfilMapa): (x: number, y: number, z: number) => { x: number; y: number } | null {
  const pose = poseCamara(cam, h, u, perfil);
  return (x, y, z) => {
    aplicarPose(camaraPrevia, pose, w / Math.max(1, h));
    puntoPrevio.set(x, y, z).project(camaraPrevia);
    if (puntoPrevio.z > 1) return null;
    return { x: ((puntoPrevio.x + 1) / 2) * w, y: ((1 - puntoPrevio.y) / 2) * h };
  };
}

/**
 * El despeje antes de dibujar: mide la caja con la cámara de ahora, se la da a `encajar` (el 2D la encaja entre el cartel
 * y el relator y mueve su cámara), y con la cámara corregida (pasada por `ajustar`, el tope del sapo) vuelve a medir. Con
 * perspectiva el corrimiento del 2D no es exacto en el 3D: dos o tres vueltas lo cierran. Para cuando ya cabe.
 */
export function encajarAntes(cam: Camara2D, medir: (c: Camara2D) => CajaPantalla | null,
  encajar: ((caja: CajaPantalla) => Camara2D | null) | undefined, ajustar: (c: Camara2D) => Camara2D, vueltas = 3): Camara2D {
  if (!encajar) return cam;
  let c = cam;
  for (let i = 0; i < vueltas; i++) {
    const caja = medir(c);
    if (!caja) break;
    const nueva = encajar(caja);
    if (!nueva) break;
    c = ajustar(nueva);
  }
  return c;
}

/* ===================================================================== el cajón */

const INK: Record<"claro" | "oscuro", number> = { claro: 0x191919, oscuro: 0x16161f };
const ACENTOS: Record<"claro" | "oscuro", readonly number[]> = {
  claro: [0xe93d9c, 0xff7a1a, 0x00a896, 0xffc629, 0x6c4ce0],
  oscuro: [0xff5cb3, 0xff8b3d, 0x17c3b2, 0xffd24d, 0x9b7bff],
};
const MADERA: Record<"claro" | "oscuro", number> = { claro: 0xd29a5c, oscuro: 0x9a6a3c };
const FRENTE: Record<"claro" | "oscuro", number> = { claro: 0xb4462a, oscuro: 0x7a2e1c };
const CAJON: Record<"claro" | "oscuro", number> = { claro: 0x8f3520, oscuro: 0x5a2014 };
const PISO: Record<"claro" | "oscuro", [number, number]> = { claro: [0xe8d6b8, 0xdcc6a0], oscuro: [0x3b2a3a, 0x4a3849] };
/** La pared de ladrillos de atrás, la del 2D, en el tono del tema (ladrillo, junta). */
const PARED: Record<"claro" | "oscuro", [number, number]> = { claro: [0xecdcb9, 0xd7c196], oscuro: [0x2c2147, 0x1b1432] };
const AMARILLO = 0xffc629;
/** La rana: más clara que la madera para que sea lo primero que se ve (el 2D la separa con su brillo). */
const BRONCE = 0xe0b04a;
const BRONCE_OSC = 0xa8771f;
const GARGANTA = 0xf6dc96;
const MARFIL = 0xfff3cf;
const LENGUA = 0xe0707a;
const PIEL = 0xc68a5c;

const hex = (n: number): string => `#${n.toString(16).padStart(6, "0")}`;

function lienzo(w: number, h: number): CanvasRenderingContext2D | null {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c.getContext("2d");
}

/** La madera de la tapa: vetas, la guarda de triángulos de colores en los bordes de adelante y atrás, y el borde de tinta. */
function texturaTapa(tema: "claro" | "oscuro", ancho: number, fondo: number): CanvasTexture | null {
  const cx = lienzo(512, 512);
  if (!cx) return null;
  const W = 512, H = 512;
  cx.fillStyle = hex(MADERA[tema]);
  cx.fillRect(0, 0, W, H);
  // Las vetas: líneas a lo ancho, con una ondulación que sale de un hash (la misma madera siempre).
  for (let i = 1; i < 14; i++) {
    const y = (i * H) / 14;
    cx.strokeStyle = tema === "oscuro" ? "rgba(22,22,31,0.16)" : "rgba(25,25,25,0.14)";
    cx.lineWidth = 1.5 + hash(i, 3) * 2.5;
    cx.beginPath();
    cx.moveTo(6, y);
    for (let x = 6; x <= W - 6; x += 32) cx.lineTo(x, y + (hash(i, x) - 0.5) * 5);
    cx.stroke();
  }
  // La guarda: triángulos de los cinco acentos, mirando hacia adentro, en el borde de adelante y el de atrás.
  const banda = 30, paso = banda * 1.7;
  const col = ACENTOS[tema];
  const aspecto = ancho / fondo;
  for (let x = 6, k = 0; x < W - 8; x += paso, k++) {
    cx.fillStyle = hex(col[k % col.length] as number);
    cx.beginPath();
    cx.moveTo(x, 6);
    cx.lineTo(x + paso / 2, 6 + banda * aspecto);
    cx.lineTo(Math.min(W - 6, x + paso), 6);
    cx.fill();
    cx.beginPath();
    cx.moveTo(x, H - 6);
    cx.lineTo(x + paso / 2, H - 6 - banda * aspecto);
    cx.lineTo(Math.min(W - 6, x + paso), H - 6);
    cx.fill();
  }
  cx.strokeStyle = hex(INK[tema]);
  cx.lineWidth = 8;
  cx.strokeRect(4, 4, W - 8, H - 8);
  const t = new CanvasTexture(cx.canvas);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/**
 * El piso del patio: tablones a lo ancho, del color del tema. Solo hay juntas horizontales: con la cámara de frente no
 * se cierran en diagonal hacia el fondo, que era lo que cansaba la vista.
 */
function texturaPiso(tema: "claro" | "oscuro"): CanvasTexture | null {
  const cx = lienzo(64, 128);
  if (!cx) return null;
  const [base, tablon] = PISO[tema];
  cx.fillStyle = hex(base);
  cx.fillRect(0, 0, 64, 128);
  cx.fillStyle = hex(tablon);
  cx.fillRect(0, 0, 64, 62);
  cx.fillStyle = tema === "oscuro" ? "rgba(22,22,31,0.35)" : "rgba(25,25,25,0.16)";
  cx.fillRect(0, 62, 64, 3);
  cx.fillRect(0, 126, 64, 2);
  const t = new CanvasTexture(cx.canvas);
  t.colorSpace = SRGBColorSpace;
  t.wrapS = t.wrapT = RepeatWrapping;
  t.repeat.set(1, 30);
  t.anisotropy = 4;
  return t;
}

/** La pared de ladrillos de atrás del cajón: la del 2D, con hileras corridas y juntas. Cada celda de la textura mide 3,6 unidades de la mesa. */
function texturaPared(tema: "claro" | "oscuro"): CanvasTexture | null {
  const cx = lienzo(512, 512);
  if (!cx) return null;
  const [ladrillo, junta] = PARED[tema];
  cx.fillStyle = hex(junta);
  cx.fillRect(0, 0, 512, 512);
  const cols = 6, filas = 12, w = 512 / cols, h = 512 / filas;
  for (let f = 0; f < filas; f++) {
    const corrido = f % 2 ? w / 2 : 0;
    for (let c = -1; c < cols; c++) {
      // Un poco de variación de tono por ladrillo, que sale de un hash (la misma pared siempre).
      const v = (hash(f * 13 + c, 7) - 0.5) * (tema === "oscuro" ? 0.12 : 0.08);
      cx.fillStyle = hex(ladrillo);
      cx.fillRect(c * w + corrido + 3, f * h + 3, w - 6, h - 6);
      cx.fillStyle = v > 0 ? `rgba(255,255,255,${v})` : `rgba(0,0,0,${-v})`;
      cx.fillRect(c * w + corrido + 3, f * h + 3, w - 6, h - 6);
    }
  }
  const t = new CanvasTexture(cx.canvas);
  t.colorSpace = SRGBColorSpace;
  t.wrapS = t.wrapT = RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

/** Las astillas del golpe: ocho por golpe, cinco golpes a la vez como mucho. Cada una es función de la hora y de su número. */
class Astillas {
  private readonly malla: InstancedMesh;
  private readonly d = new Object3D();
  private readonly eventos: { t0: number; x: number; z: number; fuerza: number; serie: number }[] = [];
  private serie = 0;
  private readonly vistos = new Set<number>();
  static readonly POR = 8;
  static readonly MAX = 5;

  constructor(padre: Object3D, geo: BoxGeometry, mat: MeshLambertMaterial, basura: { add<T extends { dispose(): void }>(x: T): T }) {
    this.malla = new InstancedMesh(geo, mat, Astillas.POR * Astillas.MAX);
    this.malla.count = 0;
    this.malla.frustumCulled = false;
    basura.add({ dispose: () => this.malla.dispose() });
    padre.add(this.malla);
  }

  /** Registra un golpe una sola vez (por su hora y lugar). */
  nuevo(t: number, x: number, z: number, fuerza: number): void {
    const k = Math.round(t * 1000) * 7 + this.vistos.size;
    const clave = Math.round(t * 1000);
    if (this.vistos.has(clave)) return;
    this.vistos.add(clave);
    void k;
    this.eventos.push({ t0: t, x, z, fuerza, serie: this.serie++ });
    if (this.eventos.length > Astillas.MAX) this.eventos.shift();
  }

  actualizar(t: number, cuantas: number): void {
    const d = this.d;
    let n = 0;
    for (const e of this.eventos) {
      const edad = t - e.t0;
      if (edad < 0 || edad > 0.7) continue;
      const vis = Math.max(2, Math.round(Astillas.POR * cuantas));
      for (let j = 0; j < vis; j++) {
        const a = hash(e.serie * 17 + j, 31) * Math.PI * 2;
        const v = (0.25 + 0.5 * hash(e.serie * 17 + j, 32)) * e.fuerza;
        const vy = (0.9 + 0.9 * hash(e.serie * 17 + j, 33)) * e.fuerza;
        const avance = (1 - Math.exp(-5 * edad)) / 5;
        d.position.set(e.x + Math.cos(a) * v * avance * 3, Math.max(0.01, 0.03 + vy * edad - 2.6 * edad * edad), e.z + Math.sin(a) * v * avance * 3);
        d.rotation.set(edad * (5 + 6 * hash(j, 34)), edad * (4 + 5 * hash(j, 35)), 0);
        d.scale.setScalar(1 - edad / 0.7);
        d.updateMatrix();
        this.malla.setMatrixAt(n++, d.matrix);
      }
    }
    this.malla.count = n;
    this.malla.instanceMatrix.needsUpdate = true;
  }
}

const SUBE = new Vector3(0, 1, 0);

const fabrica: Fabrica3D<EntradaSapo> = (motor, o) => {
  const tema = o.tema;
  const B = motor.basura;
  const g = crearGeometrias(B);
  const mat = new Materiales(B);
  const tinta = INK[tema];
  // El sol, más de frente que de arriba: la cara de la rana que mira a la cámara es la más clara de la escena.
  const amb = crearAmbiente(motor, { solDesde: [-45, 72, 95], nieblaCerca: 90, nieblaLejos: 260 });
  // El piso cubre toda la vista: el cielo no se ve y no hace falta pintarlo.
  amb.cielo.visible = false;
  motor.renderer.setClearColor(PISO[tema][0]);
  const hemi = motor.escena.children.find((c): c is HemisphereLight => c.type === "HemisphereLight");
  // El sombreado plano de three.js reparte la luz entre pi: con las de la carrera (1,35 y 1,9) el sapo salía a 0,8 de su color.
  // Acá, a poco más de 1, el color de la marca llega entero y la cara al sol queda por encima.
  const hemi0 = tema === "claro" ? 1.75 : 1.55;
  const sol0 = tema === "claro" ? 3 : 2.7;
  if (hemi) hemi.intensity = hemi0;
  amb.sol.intensity = sol0;

  const mundo = new Group();
  motor.escena.add(mundo);
  const tintaBack = B.add(new MeshBasicMaterial({ color: tinta, side: BackSide }));
  const tintaPlana = B.add(new MeshBasicMaterial({ color: tinta }));
  /** El contorno de tinta de la casa: la misma pieza, de atrás hacia adelante y un poco más grande. */
  const contorno = (m: Mesh, grosor = 1.07): Mesh => {
    const h = new Mesh(m.geometry, tintaBack);
    h.position.copy(m.position);
    h.rotation.copy(m.rotation);
    h.scale.copy(m.scale).multiplyScalar(grosor);
    m.parent?.add(h);
    return h;
  };

  /* ---------------------------------------------------------------- el patio y el cajón */
  const tableR = 1.55;
  const ancho = tableR * 2.1, fondo = tableR * 2.05;
  const losa = 0.14, cuerpoAlto = 0.55;
  const texPiso = texturaPiso(tema);
  if (texPiso) B.add(texPiso);
  const piso = new Mesh(B.add(new PlaneGeometry(60, 60)), B.add(new MeshLambertMaterial({ map: texPiso, color: texPiso ? 0xffffff : PISO[tema][0] })));
  piso.rotation.x = -Math.PI / 2;
  piso.position.y = -losa - cuerpoAlto;
  mundo.add(piso);

  // La pared de ladrillos pegada al fondo del cajón, como el cajón del 2D contra su pared: las hileras quedan horizontales.
  const alturaPared = 9, zPared = -(fondo * 0.97) / 2 - 0.5;
  const texPared = texturaPared(tema);
  if (texPared) {
    B.add(texPared);
    texPared.repeat.set(40 / 3.6, alturaPared / 3.6);
  }
  const pared = new Mesh(B.add(new PlaneGeometry(40, alturaPared)), B.add(new MeshLambertMaterial({ map: texPared, color: texPared ? 0xffffff : PARED[tema][0] })));
  pared.position.set(0, -losa - cuerpoAlto + alturaPared / 2, zPared);
  mundo.add(pared);

  // La guirnalda de banderines: una cuerda que cuelga entre los dos extremos de la pared y triángulos de los cinco acentos.
  const NB = 17, NC = 18;
  const trianguloGeo = new BufferGeometry();
  trianguloGeo.setAttribute("position", new Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, 0, -1, 0], 3));
  trianguloGeo.computeVertexNormals();
  B.add(trianguloGeo);
  const banderines = new Instancias(trianguloGeo, B.add(new MeshLambertMaterial({ color: 0xffffff, side: DoubleSide })), NB, B);
  const cuerdas = new Instancias(g.caja, tintaPlana, NC, B);
  const xG0 = -(ancho * 0.97) / 2 - 0.3, xG1 = (ancho * 0.97) / 2 + 0.3, yAlto = 0.95, caida = 0.34;
  const yCuerda = (u: number): number => yAlto - caida * 4 * u * (1 - u);
  const ladoBanderin = 0.26;
  for (let i = 0; i < NB; i++) {
    const u = (i + 0.5) / NB;
    banderines.poner(i, xG0 + (xG1 - xG0) * u, yCuerda(u) - 0.01, zPared + 0.04, ladoBanderin, ladoBanderin * 1.15, 1, 0, ACENTOS[tema][i % 5]);
  }
  for (let i = 0; i < NC; i++) {
    const ua = i / NC, ub = (i + 1) / NC;
    const ax = xG0 + (xG1 - xG0) * ua, bx = xG0 + (xG1 - xG0) * ub;
    const ay = yCuerda(ua), by = yCuerda(ub);
    const o = new Object3D();
    o.position.set((ax + bx) / 2, (ay + by) / 2, zPared + 0.04);
    o.rotation.z = Math.atan2(by - ay, bx - ax);
    o.scale.set(Math.hypot(bx - ax, by - ay) + 0.01, 0.022, 0.022);
    o.updateMatrix();
    cuerdas.malla.setMatrixAt(i, o.matrix);
  }
  banderines.usar(NB);
  cuerdas.usar(NC);
  banderines.fin();
  cuerdas.fin();
  mundo.add(banderines.malla, cuerdas.malla);

  // La sombra dura del cajón en el piso: un rectángulo de tinta corrido a la derecha y adelante.
  const sombraCajon = new Mesh(B.add(new PlaneGeometry(ancho * 1.0, fondo * 1.0)), B.add(new MeshBasicMaterial({ color: tinta, transparent: true, opacity: 0.32, depthWrite: false })));
  sombraCajon.rotation.x = -Math.PI / 2;
  sombraCajon.position.set(0.22, -losa - cuerpoAlto + 0.004, 0.2);
  mundo.add(sombraCajon);

  const cuerpoMat = mat.plano(FRENTE[tema]);
  const cuerpo = pieza(g.caja, cuerpoMat, 0, -losa - cuerpoAlto / 2, 0, ancho * 0.97, cuerpoAlto, fondo * 0.97);
  mundo.add(cuerpo);
  contorno(cuerpo, 1.012);
  // Los cinco cajoncitos del frente, con sus pomos amarillos.
  const cajones = new Instancias(g.caja, mat.plano(CAJON[tema]), 5, B);
  const pomos = new Instancias(g.esfera, mat.plano(AMARILLO), 5, B);
  const zFrente = (fondo * 0.97) / 2;
  for (let i = 0; i < 5; i++) {
    const x = -ancho * 0.97 / 2 + ((i + 0.5) * ancho * 0.97) / 5;
    cajones.poner(i, x, -losa - cuerpoAlto * 0.5, zFrente + 0.006, (ancho * 0.97) / 5 * 0.72, cuerpoAlto * 0.56, 0.03);
    pomos.poner(i, x, -losa - cuerpoAlto * 0.5, zFrente + 0.03, 0.028, 0.028, 0.028);
  }
  cajones.usar(5);
  pomos.usar(5);
  cajones.fin();
  pomos.fin();
  mundo.add(cajones.malla, pomos.malla);

  // La tapa: la losa de madera y, arriba, la cara pintada con las vetas y la guarda.
  const tapa = new Group();
  mundo.add(tapa);
  const losaMesh = pieza(g.caja, mat.plano(tema === "oscuro" ? 0x7e5530 : 0xb98249), 0, -losa / 2, 0, ancho, losa, fondo);
  tapa.add(losaMesh);
  contorno(losaMesh, 1.01);
  const texTapa = texturaTapa(tema, ancho, fondo);
  if (texTapa) B.add(texTapa);
  const cara = new Mesh(
    B.add(new PlaneGeometry(ancho, fondo)),
    B.add(new MeshLambertMaterial(texTapa ? { map: texTapa } : { color: MADERA[tema] })),
  );
  cara.rotation.x = -Math.PI / 2;
  cara.position.y = 0.0015;
  tapa.add(cara);

  /* ---------------------------------------------------------------- los agujeros */
  const MAX_AG = 12;
  const discos = new Instancias(B.add(new CircleGeometry(1, 20).rotateX(-Math.PI / 2)), B.add(new MeshBasicMaterial({ color: 0x140f0a })), MAX_AG, B);
  tapa.add(discos.malla);
  const toroAro = B.add(new TorusGeometry(1, 0.13, 5, 20).rotateX(Math.PI / 2));
  const aros = new Instancias(toroAro, B.add(new MeshLambertMaterial({ color: 0xffffff, flatShading: true })), MAX_AG, B);
  tapa.add(aros.malla);
  const anilloGanador = new Mesh(B.add(new TorusGeometry(1, 0.2, 5, 22).rotateX(Math.PI / 2)), B.add(new MeshBasicMaterial({ color: AMARILLO })));
  anilloGanador.visible = false;
  tapa.add(anilloGanador);

  /* ---------------------------------------------------------------- la rana */
  const rana = new Group();
  tapa.add(rana);
  const fr = 0.34;
  const cuerpoR = pieza(g.esfera, mat.plano(BRONCE), 0, 0.62 * fr, -0.25 * fr, 0.95 * fr, 0.62 * fr, 0.8 * fr);
  rana.add(cuerpoR);
  contorno(cuerpoR, 1.06);
  for (const sx of [-1, 1]) {
    const pata = pieza(g.esfera, mat.plano(BRONCE_OSC), sx * 0.8 * fr, 0.28 * fr, -0.3 * fr, 0.42 * fr, 0.3 * fr, 0.55 * fr);
    rana.add(pata);
    contorno(pata, 1.08);
    const delantera = pieza(g.esfera, mat.plano(BRONCE_OSC), sx * 0.5 * fr, 0.17 * fr, 0.42 * fr, 0.2 * fr, 0.17 * fr, 0.3 * fr);
    rana.add(delantera);
    contorno(delantera, 1.1);
    // Los ojos: grandes, claros y sobre la cabeza, para que la rana mire a la cámara (con el color del cuerpo parecía una tortuga).
    const ojo = pieza(g.esfera, mat.plano(MARFIL), sx * 0.5 * fr, 1.08 * fr, -0.28 * fr, 0.33 * fr, 0.33 * fr, 0.33 * fr);
    rana.add(ojo);
    contorno(ojo, 1.1);
  }
  const pupilas = [-1, 1].map((sx) => {
    const p = pieza(g.esfera, tintaPlana, sx * 0.5 * fr, 1.27 * fr, -0.03 * fr, 0.17 * fr, 0.17 * fr, 0.13 * fr);
    rana.add(p);
    return p;
  });
  const garganta = pieza(g.esfera, mat.plano(GARGANTA), 0, 0.42 * fr, 0.33 * fr, 0.55 * fr, 0.34 * fr, 0.36 * fr);
  rana.add(garganta);
  const boca = pieza(g.esfera, tintaPlana, 0, 0.72 * fr, 0.5 * fr, 0.55 * fr, 0.06 * fr, 0.16 * fr);
  rana.add(boca);
  const lengua = pieza(g.esfera, mat.plano(LENGUA), 0, 0.7 * fr, 0.5 * fr, 0.27 * fr, 0.12 * fr, 0.12 * fr);
  lengua.visible = false;
  rana.add(lengua);
  // La sombra de contacto: dura, más oscura y corrida a la derecha y adelante, para despegar a la rana de la madera.
  const sombraRana = new Mesh(B.add(new CircleGeometry(1, 20).rotateX(-Math.PI / 2)), B.add(new MeshBasicMaterial({ color: tinta, transparent: true, opacity: 0.55, depthWrite: false })));
  sombraRana.scale.set(1.3 * fr, 1, 1.05 * fr);
  sombraRana.position.set(0.09, 0.004, -0.02);
  tapa.add(sombraRana);

  /* ---------------------------------------------------------------- la mano */
  const mano = new Group();
  tapa.add(mano);
  const piel = mat.plano(PIEL);
  const palma = pieza(g.esfera, piel, 0, 0, 0, 0.075, 0.06, 0.075);
  mano.add(palma);
  contorno(palma, 1.1);
  for (const [dx, dz] of [[-0.06, -0.05], [-0.02, -0.08], [0.03, -0.08]] as const) {
    const dedo = pieza(g.esfera, piel, dx, 0.01, dz, 0.028, 0.026, 0.028);
    mano.add(dedo);
    contorno(dedo, 1.15);
  }
  // El brazo entra desde abajo a la derecha de la pantalla (hacia la cámara y a la derecha).
  const dirBrazo = new Vector3(0.55, 0.04, 0.83).normalize();
  const antebrazo = new Group();
  mano.add(antebrazo);
  const qBrazo = new Quaternion().setFromUnitVectors(SUBE, dirBrazo);
  antebrazo.quaternion.copy(qBrazo);
  const muneca = pieza(g.cilindro, piel, 0, 0.12, 0, 0.042, 0.24, 0.042);
  antebrazo.add(muneca);
  const matManga = new MeshLambertMaterial({ color: 0xe93d9c, flatShading: true });
  B.add(matManga);
  const manga = pieza(g.cilindro, matManga, 0, 1.9, 0, 0.065, 3.4, 0.065);
  antebrazo.add(manga);
  const mangaHull = pieza(g.cilindro, tintaBack, 0, 1.9, 0, 0.074, 3.42, 0.074);
  antebrazo.add(mangaHull);
  // El puño crema de la manga, para que la mano se separe del brazo turquesa.
  const punio = pieza(g.cilindro, mat.plano(0xf6efe2), 0, 0.27, 0, 0.078, 0.07, 0.078);
  antebrazo.add(punio);
  contorno(punio, 1.12);

  /* ---------------------------------------------------------------- las argollas */
  const toroArgolla = B.add(new TorusGeometry(TORO_R, TORO_T, 5, 12).rotateX(Math.PI / 2));
  const matArgolla = mat.plano(AMARILLO);
  const toroAnillo = B.add(new TorusGeometry(1, 0.05, 4, 22).rotateX(Math.PI / 2));
  const ellas = Array.from({ length: 4 }, () => {
    const grupo = new Group();
    const toro = new Mesh(toroArgolla, matArgolla);
    const casco = new Mesh(toroArgolla, tintaBack);
    casco.scale.setScalar(1.13);
    const anillo = new Mesh(toroAnillo, matArgolla);
    const anilloTinta = new Mesh(toroAnillo, tintaBack);
    anillo.visible = anilloTinta.visible = false;
    grupo.add(casco, toro, anillo, anilloTinta);
    grupo.visible = false;
    tapa.add(grupo);
    const sombra = new Mesh(B.add(new CircleGeometry(1, 16).rotateX(-Math.PI / 2)), B.add(new MeshBasicMaterial({ color: tinta, transparent: true, opacity: 0.38, depthWrite: false })));
    sombra.visible = false;
    tapa.add(sombra);
    return { grupo, toro, casco, anillo, anilloTinta, sombra };
  });
  const astillas = new Astillas(tapa, B.add(new BoxGeometry(0.035, 0.012, 0.018)), mat.plano(tema === "oscuro" ? 0xc79a62 : 0xe0b27a), B);

  /* ---------------------------------------------------------------- por cuadro */
  let K = 1, Kz = 1, px = 0, pz = 0;
  let ultimosAgujeros: readonly PuntoMesa[] = [];
  let radioAro = 0.15;
  const q = new Quaternion();
  const n = new Vector3();
  motor.alCambiarNivel((a) => {
    sombraCajon.visible = a.sombras !== "no";
  });

  return {
    frame(e) {
      const m = e.mesa;
      const perfil = perfilSapo(m.tilt, deltaCamara(e.t, e.tension, e.golpe));
      const ajustar = (c: Camara2D): Camara2D => camaraDelSapo(c, e.w, e.h, ZOOM_MAX, e.primerPlano ?? 0);
      // El aro destacado, con lo que este cuadro le dibuja, y dónde queda el grupo de la mesa: lo que mide el despeje.
      const aro = aroDestacado(e);
      const lugar = lugarDelMundo(motor.mapa(e.u, perfil), m);
      // Con el primer plano, el despeje del cartel y el relator va antes de dibujar: la cámara que dibuja es la despejada.
      const cam = encajarAntes(ajustar(e.cam), (c) => (aro ? cajaDeAro(aro, lugar, proyectorDe(c, e.w, e.h, e.u, perfil)) : null), e.encajar, ajustar);
      // La cuenta de la casa fija el lugar del mundo 2D en el 3D; la elevación base mantiene el piso con las proporciones del 2D.
      motor.cuadro({ ...e, cam }, perfil, (mapa, pose) => {
        ({ px, pz, K, Kz } = lugarDelMundo(mapa, m));
        mundo.position.set(px, 0, pz);
        mundo.scale.set(K, K, Kz);
        const tz = e.trazo;
        ultimosAgujeros = tz.holes;
        radioAro = tz.holeR;
        const luz = luzDelGolpe(e.t, e.golpe);
        if (hemi) hemi.intensity = hemi0 * (0.45 + 0.55 * luz);
        amb.sol.intensity = sol0 * (0.35 + 0.65 * luz);

        // La tapa salta un 2 % de su alto cuando cae la última argolla.
        tapa.position.y = saltoTapa(e.t, e.adentro);

        // Los agujeros.
        discos.usar(tz.holes.length);
        aros.usar(tz.holes.length);
        anilloGanador.visible = false;
        for (let s = 0; s < tz.holes.length; s++) {
          const h = tz.holes[s] as PuntoMesa;
          const ag = e.agujeros[s] as AgujeroSapo;
          const f = Math.max(0.0001, ag.nace);
          const lit = ag.lit > 0;
          discos.poner(s, h.x, 0.006, h.y, tz.holeR * f * 0.98, 1, tz.holeR * f * 0.98);
          const r = tz.holeR * 1.08 * f;
          aros.poner(s, h.x, 0.0155 * tz.holeR / 0.145, h.y, r, r * (lit ? 1.5 : 1), r, 0, lit ? AMARILLO : ag.aro);
          if (ag.lit >= 1 && e.golpe >= 0) {
            anilloGanador.visible = true;
            const k = crecidaAnillo(e.t, e.golpe);
            anilloGanador.position.set(h.x, 0.02, h.y);
            anilloGanador.scale.set(tz.holeR * 1.1 * k, tz.holeR * 1.3, tz.holeR * 1.1 * k);
          }
        }
        discos.fin();
        aros.fin();

        // La rana.
        const r = e.rana;
        const abre = r.boca;
        boca.scale.set(0.55 * fr * (0.7 + 0.3 * abre), (0.06 + 0.3 * abre) * fr * 0.9, 0.16 * fr);
        boca.position.y = (0.7 + 0.04 * abre) * fr;
        lengua.visible = abre > 0.55;
        lengua.scale.set(0.27 * fr, 0.12 * fr * abre, 0.12 * fr);
        garganta.scale.set(0.55 * fr * r.garganta, 0.34 * fr * r.garganta, 0.36 * fr * r.garganta);
        for (const p of pupilas) p.scale.y = 0.17 * fr * Math.max(0.15, r.ojo);
        const atras = r.labio >= 0 && r.labio < 0.6 ? -0.14 * Math.sin((Math.PI * r.labio) / 0.6) : 0;
        let giro = 0;
        if (r.mira && e.golpe >= 0) {
          const ang = Math.atan2(r.mira.x, Math.max(0.2, r.mira.y + 1.5));
          giro = Math.max(-0.5, Math.min(0.5, ang)) * suave((e.t - e.golpe) / 0.5);
        }
        rana.rotation.set(atras, giro, 0);

        // La mano.
        const mn = e.mano;
        mano.visible = mn.visible;
        const hy = 0.13 - 0.07 * mn.swing;
        mano.position.set(mn.punto.x, hy, mn.punto.y + 0.09 * mn.swing);
        mano.rotation.set(0.15 * mn.swing, 0, 0);
        // En el celular la mesa mide menos píxeles por unidad y la mano y el brazo se perdían: se agrandan lo que hace falta.
        mano.scale.setScalar(Math.max(1, Math.min(1.9, 190 / m.sc)));
        matManga.color.setHex(mn.manga);

        // Las argollas.
        const manoMundo: [number, number, number] = [mn.punto.x, hy, mn.punto.y + 0.09 * mn.swing];
        const bocaMundo: [number, number, number] = [0, 0.72 * fr, 0.5 * fr];
        const brArgolla = e.radio;
        ellas.forEach((el, i) => {
          const a = e.argollas[i];
          if (!a) {
            el.grupo.visible = false;
            el.sombra.visible = false;
            return;
          }
          const p = poseArgolla(a, brArgolla, fr, manoMundo, bocaMundo);
          el.grupo.visible = p.visible;
          if (!p.visible) {
            el.sombra.visible = false;
            return;
          }
          el.grupo.position.set(p.x, p.y, p.z);
          n.set(Math.sin(p.inclina) * Math.cos(p.rumbo), Math.cos(p.inclina), Math.sin(p.inclina) * Math.sin(p.rumbo));
          q.setFromUnitVectors(SUBE, n);
          el.grupo.quaternion.copy(q);
          el.grupo.scale.setScalar(brArgolla * p.esc);
          el.toro.rotation.y = p.gira;
          el.casco.rotation.y = p.gira;
          const conAro = a.ultima && (a.estado === "mano" || a.estado === "vuelo");
          el.anillo.visible = el.anilloTinta.visible = false;
          if (conAro) {
            // El aro nítido del último tiro, como en el 2D: plano y apoyado alrededor de la argolla.
            el.anillo.visible = true;
            el.anillo.scale.setScalar(1.6);
          }
          // La sombra sobre la tapa: sale de un sol fijo, igual para todos los tiros.
          const sobreTapa = a.estado === "vuelo" || a.estado === "rueda" || a.estado === "baile" || a.estado === "boca-sale" || a.estado === "mano";
          el.sombra.visible = sobreTapa && a.alfa > 0.05;
          if (el.sombra.visible) {
            const alto = Math.max(0, p.y - brArgolla * TORO_T);
            const k = 1 - Math.min(0.45, alto * 0.45);
            el.sombra.position.set(a.suelo.x + alto * 0.45 + 0.012, TAPA_Y + 0.001, a.suelo.y + alto * 0.3 + 0.012);
            el.sombra.scale.set(brArgolla * 1.05 * k, 1, brArgolla * 1.05 * k);
          }
        });

        // Las astillas.
        for (const gp of e.golpes) astillas.nuevo(gp.t, gp.punto.x, gp.punto.y, gp.fuerza);
        astillas.actualizar(e.t, motor.ajustes.particulas);

        amb.seguir(pose);
      });
      // Lo que el 2D usa para anclar sus nombres, medallas y el foco a lo que la cámara 3D ve.
      e.puente.aPantalla = (p, alto = 0) => motor.proyectar(px + K * p.x, K * alto, pz + Kz * p.y);
      // Y la caja del aro destacado medida con la cámara que lo dibujó de verdad (no con el contorno 2D, que no se ve).
      e.puente.destacada = () => (aro ? cajaDeAro(aro, lugar, (x, y, z) => motor.proyectar(x, y, z)) : null);
    },
    pantallaDe(id) {
      // El agujero `id`: el centro de su aro en la pantalla y lo que mide de ancho.
      const h = ultimosAgujeros[id];
      if (!h) return null;
      const c = motor.proyectar(px + K * h.x, 0, pz + Kz * h.y);
      const b = motor.proyectar(px + K * (h.x + radioAro), 0, pz + Kz * h.y);
      return c && b ? { x: c.x, y: c.y, alto: Math.abs(b.x - c.x) * 2 } : null;
    },
    destruir() {
      motor.escena.remove(mundo);
    },
  };
};

export const montaje = definir3D(fabrica);

/** Lo que `registro.ts` busca: no hace falta editar ningún otro archivo para que el sapo aparezca en 3D. */
export const lanzador3D = async (): Promise<Lanzador> => {
  const m = await import("../pixi/sapo");
  return (names, winners, beacon, done) => m.sapoPixi(names, winners, beacon, done, montaje);
};
