import {
  BackSide, BoxGeometry, BufferGeometry, CanvasTexture, CircleGeometry, Color, CylinderGeometry, DoubleSide, Float32BufferAttribute, Group, HemisphereLight,
  InstancedMesh, Mesh, MeshBasicMaterial, MeshLambertMaterial, Object3D, PerspectiveCamera, PlaneGeometry, Quaternion, RepeatWrapping, SphereGeometry,
  SRGBColorSpace, TorusGeometry, Vector3,
} from "three";
import { crearAmbiente } from "./escena";
import { crearGeometrias, Instancias, Materiales, pieza } from "./figuras";
import { hash } from "./ids";
import { MOMENTOS_MONEDA, type Toma } from "../pixi/sapo-plan";
import { AFTER_FINAL } from "../pixi/sapo-tiempos";
import { aplicarPose, perfilFiel, poseCamara, type Mapa, type PerfilMapa, type Pose3D } from "./camara";
import { definir3D } from "./motor";
import type { Camara2D, EntradaBase, Fabrica3D, Lanzador, SenalMano } from "./tipos";

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
  /**
   * El suspenso del borde (S10): la 2D lo marca (`suspensoDe`) cuando esta argolla hace el momento de rodar en el
   * borde del agujero. Opcional: sin la marca el 3D no inventa nada, y la ganadora jamás lo lleva.
   */
  suspenso?: boolean;
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
  /** Lo que la mano lleva lanzando: visible, dónde está y el impulso de siempre, más la señal de la mano (S9,
   * `SenalMano` en `tipos.ts`): la flexión de los dedos y la fase del lanzamiento que calcula el 2D. */
  mano: { visible: boolean; punto: PuntoMesa; /** de -0,8 a 1: el impulso hacia atrás y el suelte */ swing: number; manga: number } & SenalMano;
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

/** Los colores de la bandera de Bolivia, de arriba abajo: rojo, amarillo y verde. Las argollas que tira la mano los llevan. */
export const BANDERA = [0xd52b1e, 0xf9e300, 0x007934] as const;

/**
 * La franja de la bandera que le toca a un punto de la argolla por su lugar de atrás hacia adelante (`z` de `-r` a `r`):
 * tres franjas de igual alto, como la bandera acostada sobre la moneda. Atrás el rojo, al medio el amarillo, adelante el verde.
 */
export const franjaBandera = (z: number, r: number): number =>
  z < -r / 3 ? BANDERA[0] : z > r / 3 ? BANDERA[2] : BANDERA[1];

/**
 * Pinta el aro de la argolla (un toro acostado en el plano `xz`) con las tres franjas: cada cara toma el color de la franja
 * donde cae su centro alrededor del aro, así los bordes quedan netos con el sombreado plano. No mueve ningún vértice: la
 * forma, y con ella la pose y la física, es la misma. Devuelve la geometría sin índice (cada cara con sus tres vértices).
 */
export function pintarArgolla(geo: BufferGeometry): BufferGeometry {
  const suelta = geo.index ? geo.toNonIndexed() : geo;
  if (suelta !== geo) geo.dispose();
  const pos = suelta.getAttribute("position");
  const colores = new Float32Array(pos.count * 3);
  const c = new Color();
  for (let t = 0; t + 2 < pos.count; t += 3) {
    const cx = (pos.getX(t) + pos.getX(t + 1) + pos.getX(t + 2)) / 3;
    const cz = (pos.getZ(t) + pos.getZ(t + 1) + pos.getZ(t + 2)) / 3;
    c.setHex(franjaBandera(cz / Math.max(1e-9, Math.hypot(cx, cz)), 1));
    for (let k = 0; k < 3; k++) c.toArray(colores, (t + k) * 3);
  }
  suelta.setAttribute("color", new Float32BufferAttribute(colores, 3));
  return suelta;
}
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
 * Cuánto agarra la mano (S9), de 0 abierta a 1 cerrada. Con la flexión del 2D (`flex`: 0 curvada agarrando la
 * moneda, 1 abierta de golpe tras soltar, 0,4 en reposo) ella manda; sin la señal se reconstruye la misma curva de
 * la fase (`fase`: recogida de 0 a 1 y látigo de 0 a −1) y, sin fase, del impulso: recogiendo cierra y en el látigo
 * abre. Fuera de rango se amarra, y una señal rota (no finita) no se usa.
 */
export function agarraDe(flex: number | undefined, fase: number | undefined, swing: number): number {
  if (typeof flex === "number" && Number.isFinite(flex)) return 1 - Math.min(1, Math.max(0, flex));
  const f = typeof fase === "number" && Number.isFinite(fase) ? Math.min(1, Math.max(-1, fase)) : 0;
  if (f <= -0.0005) {
    // El látigo: en el primer tramo sigue cerrada de la suelta y abre de golpe; después relaja a reposo (flex 0,4).
    const w = -f;
    return w < 0.35 ? 1 - w / 0.35 : 0.6 * ((w - 0.35) / 0.65);
  }
  if (f > 0) return 1 - 0.4 * (1 - f); // recogiendo: de reposo (0,6) a la mano llena (1)
  const s = Number.isFinite(swing) ? swing : 0; // sin fase útil, el impulso basta
  if (s > 0) return 0.6 + 0.4 * Math.min(1, s);
  return 0.6 - 0.6 * Math.min(1, Math.max(0, -s / 0.8));
}

/**
 * La muñeca (S9), en radianes alrededor del eje del dorso: positiva se echa atrás recogiendo el impulso (la fase de
 * 0 a 1 del 2D), negativa es el látigo adelante de la suelta (la fase de 0 a −1, que sube y vuelve con el propio
 * latigazo). Opcional la fase: sin ella, el impulso solo basta. Nunca pasa de 60 grados: no marear.
 */
export function munecaDe(fase: number | undefined, swing: number): number {
  const s = Number.isFinite(swing) ? Math.min(1, Math.max(-1, swing)) : 0;
  if (typeof fase === "number" && Number.isFinite(fase)) {
    const f = Math.min(1, Math.max(-1, fase));
    if (f > 0) return 0.38 * f;
    if (f < 0) return -0.68 * Math.sin(Math.PI * -f);
    return 0;
  }
  return 0.38 * Math.max(0, s) - 0.68 * (s < 0 ? Math.sin(Math.PI * -s) : 0);
}

/**
 * El suspenso del borde (S10): qué tiros hacen el momento de rodar en el borde, elegido de forma determinista con el
 * índice del tiro y el hash de la casa, sin consumir aleatoriedad nueva. La 2D lo usa para marcar
 * `ArgollaSapo.suspenso`; el 3D solo viste la marca, nunca la inventa, y la ganadora jamás la lleva.
 */
export const SAL_SUSPENSO = 121;
export const suspensoDe = (i: number): boolean => hash(i, SAL_SUSPENSO) >= 0.45;

/**
 * La pose del suspenso (S10): la argolla marcada da vueltas sobre el borde del agujero (`a.borde`) como si se fuera
 * a caer, y termina exactamente donde el plan la puso (la onda muere en `u` 0 y 1). Sin la marca, sin borde, en la
 * ganadora o fuera del baile, devuelve la pose del plan tal cual. Nunca baja de la tapa: si al ladearse su punto más
 * bajo quedara debajo, se levanta lo justo.
 */
export function teeterSapo(p: PoseArgolla, a: ArgollaSapo, br: number): PoseArgolla {
  if (a.suspenso !== true || !a.borde || a.ultima || a.estado !== "baile" || !p.visible) return p;
  const onda = Math.sin(Math.PI * Math.min(1, Math.max(0, a.u)));
  if (onda <= 1e-9) return p;
  const dx = p.x - a.borde.x, dz = p.z - a.borde.y;
  const d = Math.hypot(dx, dz);
  if (d <= 1e-9) return p;
  // Un arco corto alrededor del borde, a lo sumo del radio de la argolla.
  const teta = Math.min(1.1, (0.9 * br * p.esc * onda) / d);
  const cos = Math.cos(teta), sin = Math.sin(teta);
  const x = a.borde.x + dx * cos - dz * sin;
  const z = a.borde.y + dx * sin + dz * cos;
  // El bamboleo: se ladea más, como si fuera a caerse, y el canto gira con la vuelta.
  const inc = p.inclina + 0.22 * onda * (0.55 + 0.45 * Math.sin(a.edad * 9));
  const r = br * p.esc;
  const piso = TAPA_Y + r * (TORO_R * Math.sin(inc) + TORO_T);
  // Si la pose del plan ya iba cayéndose del canto (se desvanece fuera de la mesa), no se la levanta: sigue igual.
  const y = p.bajo >= TAPA_Y - 1e-9 ? Math.max(p.y, piso) : p.y;
  const bajo = y - r * (TORO_R * Math.sin(inc) + TORO_T);
  return { ...p, x, z, y, inclina: inc, rumbo: p.rumbo + teta * 1.5, gira: p.gira + 2.5 * onda, bajo };
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

/* ===================================================================== las tomas de los tiros */

/**
 * Las tomas de los tiros (`tomasDeTiros` en el plan): la cámara es cosmética, nunca cambia dónde cae una argolla ni
 * quién gana; solo cambia desde dónde se mira lo que el 2D ya puso. Cada cuadro sigue siendo función de lo que llega.
 *
 * - `seguir`: mientras la argolla vuela la cámara baja, gira hacia el lado de la mano (se ve el tiro desde quien tira)
 *   y se arrima a la argolla; con el golpe vuelve a la del director. Antes la cámara no se movía con el tiro y no
 *   emocionaba (pedido del 6 de noviembre de 2026).
 * - `moneda`: la última argolla. La cámara se va detrás de ella desde la suelta, la sigue con zoom y la ve entrar.
 *
 * El 2D marca la última argolla con `ultima` (es `final` en `tiemposDeTiros`, el último tiro del plan): por las
 * pruebas del plan, ese tiro es siempre el acierto del último premio, así que es la misma marca que `tomasDeTiros`.
 */
export const tomaDeArgolla = (a: ArgollaSapo): Toma => (a.ultima ? "moneda" : "seguir");

/**
 * Cuánto se mueve la cámara con la toma `seguir`, en el punto más cercano: cuánto baja y cuánto gira hacia la mano
 * (radianes), qué parte del camino hacia la argolla corre el centro y cuánto más se acerca sobre el tope de `ZOOM_MAX`.
 * En el celular la mesa ya ocupa casi todo el ancho: gira y se acerca menos, para que los agujeros de los costados no
 * salgan de cuadro (lo cuida la prueba con una cámara de three.js).
 */
export const SEGUIR = {
  ancho: { baja: 0.16, gira: 0.2, sigue: 0.3, acerca: 0.1 },
  celular: { baja: 0.18, gira: 0.1, sigue: 0.15, acerca: 0.04 },
} as const;
/** La parte del vuelo en que la cámara entra al tiro, y los segundos que tarda en volver después del golpe (el 2D lo suelta a los 0,8). */
const ENTRA_TIRO = 0.3;
const VUELVE = 0.7;
const esCelular = (tilt: number): boolean => tilt > 0.8;

/**
 * Qué tan metida está la cámara en el tiro de ahora (de 0 a 1) y hacia dónde mira (un punto de la mesa, o null). Sube
 * con el vuelo, sigue igual en el golpe y baja en `VUELVE` segundos; la boca de la rana también la suelta de a poco, y
 * la argolla que escupe no la vuelve a acercar. Con la última argolla en juego no hace nada: esa tiene su propia toma.
 */
export function cercaniaDelTiro(argollas: readonly ArgollaSapo[], golpes: readonly { t: number; punto: PuntoMesa }[], t: number): { cerca: number; foco: PuntoMesa | null } {
  if (argollas.some((a) => tomaDeArgolla(a) === "moneda")) return { cerca: 0, foco: null };
  let cerca = 0;
  let foco: PuntoMesa | null = null;
  const tomar = (c: number, p: PuntoMesa): void => {
    if (c > cerca) {
      cerca = c;
      foco = p;
    }
  };
  for (const a of argollas) {
    if (a.estado === "vuelo") tomar(suave(a.u / ENTRA_TIRO), a.suelo);
    else if (a.estado === "boca-entra" || a.estado === "oculta" || a.estado === "boca-sale") tomar(1 - suave(a.edad / VUELVE), a.suelo);
  }
  for (const g of golpes) if (t >= g.t) tomar(1 - suave((t - g.t) / VUELVE), g.punto);
  return { cerca, foco };
}

/** La cámara del 2D con la toma `seguir`: el centro corre hacia la argolla y el zoom sube un poco, sobre lo que dejó `camaraDelSapo`. */
export function camaraDelTiro(cam: Camara2D, cerca: number, foco: PuntoMesa | null, mesa: { cx: number; cy: number; sc: number; tilt: number }): Camara2D {
  if (cerca <= 0) return cam;
  const k = esCelular(mesa.tilt) ? SEGUIR.celular : SEGUIR.ancho;
  const zoom = cam.zoom * (1 + k.acerca * cerca);
  if (!foco) return { ...cam, zoom };
  const fx = mesa.cx + foco.x * mesa.sc, fy = mesa.cy + foco.y * mesa.sc * mesa.tilt;
  const s = k.sigue * cerca;
  return { ...cam, zoom, x: cam.x + (fx - cam.x) * s, y: cam.y + (fy - cam.y) * s };
}

/** El perfil con la toma `seguir`: más baja y girada hacia la mano. La cuenta de la casa (`zc`) no cambia: los agujeros quedan donde estaban. */
export function perfilDelTiro(p: PerfilMapa, cerca: number, tilt: number): PerfilMapa {
  if (cerca <= 0) return p;
  const k = esCelular(tilt) ? SEGUIR.celular : SEGUIR.ancho;
  return { ...p, elevacion: p.elevacion - k.baja * cerca, azimut: p.azimut + k.gira * cerca };
}

/** Cuánto se queda la cámara de la moneda sobre el agujero después de que la argolla cae, y lo que tarda en volver a la del director (antes de la corona). */
const SOSTIENE = 0.8;
const SUELTA = AFTER_FINAL - SOSTIENE - 0.3;

/**
 * La toma `moneda`: cuánto manda (0, la del director; 1, la de la argolla), qué argolla sigue y por qué parte del vuelo
 * va (`s`, 1 cuando ya cayó). Entra en la suelta (`MOMENTOS_MONEDA.vuela`), se queda mientras se hunde y suelta antes
 * de la corona. La mano todavía no es la toma: el 2D la manda sin `ultima`.
 */
export function pesoMoneda(argollas: readonly ArgollaSapo[]): { peso: number; argolla: ArgollaSapo | null; s: number } {
  const a = argollas.find((x) => tomaDeArgolla(x) === "moneda" && (x.estado === "vuelo" || x.estado === "hunde"));
  if (!a) return { peso: 0, argolla: null, s: 0 };
  if (a.estado === "vuelo") return { peso: suave(a.u / MOMENTOS_MONEDA.vuela), argolla: a, s: a.u };
  return { peso: 1 - suave((a.edad - SOSTIENE) / SUELTA), argolla: a, s: 1 };
}

/**
 * La cámara de la última argolla, en el mundo 3D: detrás de ella (del lado de la mano), un poco arriba y al costado
 * contrario del brazo, mirando adelante y abajo, hacia donde va. Con el vuelo se acerca y cierra el campo; en `entra`
 * baja la mirada hasta el agujero y lo ve de arriba mientras la argolla se hunde. Nunca baja de la tapa ni atraviesa
 * la rana. `p` es la pose de la argolla (`poseArgolla`), `mano` dónde está la mano en la mesa y `aspecto` el de la
 * pantalla: en un celular angosto se aleja un poco más para que el agujero entre de costado a costado.
 */
export function poseMoneda(
  a: ArgollaSapo, s: number, p: { x: number; y: number; z: number }, mano: PuntoMesa, fr: number, lugar: { px: number; pz: number; K: number; Kz: number }, aspecto: number,
): Pose3D {
  const vuela = suave(s / MOMENTOS_MONEDA.entra);
  const entra = suave((s - MOMENTOS_MONEDA.entra) / (1 - MOMENTOS_MONEDA.entra));
  // El rumbo: de la mano a la argolla sobre la tapa. Un empujón chico hacia la rana le da rumbo en la suelta, cuando
  // la argolla todavía está en la mano; después no se nota. Con el rebote en el labio el rumbo gira sin saltar.
  const lm = Math.hypot(mano.x, mano.y) || 1;
  let dx = a.suelo.x - mano.x - (mano.x / lm) * 0.05, dz = a.suelo.y - mano.y - (mano.y / lm) * 0.05;
  const ld = Math.hypot(dx, dz) || 1;
  dx /= ld;
  dz /= ld;
  // Al costado contrario del brazo, que entra desde la derecha.
  let ox = dz, oz = -dx;
  if (ox > 0) {
    ox = -ox;
    oz = -oz;
  }
  const lejos = Math.min(1.7, Math.max(1, 1 / Math.sqrt(Math.max(0.2, aspecto))));
  const y = Math.max(TAPA_Y, p.y);
  const atras = (1.25 - 0.1 * vuela - 0.35 * entra) * lejos;
  const sube = (0.42 + 0.33 * entra) * lejos;
  const costado = 0.14 * (1 - entra) * lejos;
  const adelante = 0.6 * (1 - entra) * lejos;
  const bajaMira = 0.2 * (1 - entra) * lejos;
  const cx = p.x - dx * atras + ox * costado, cz = p.z - dz * atras + oz * costado;
  const cy = Math.max(y + sube, 0.25, alturaRana(cx, cz, fr) + 0.2);
  const mx = p.x + dx * adelante, mz = p.z + dz * adelante, my = Math.max(0, y - bajaMira);
  const { px, pz, K, Kz } = lugar;
  return {
    pos: [px + K * cx, K * cy, pz + Kz * cz],
    mira: [px + K * mx, K * my, pz + Kz * mz],
    fov: ((46 - 4 * vuela - 8 * entra) * Math.PI) / 180,
    giro: 0,
  };
}

/** De la cámara `a` a la `b` con peso `w` (0: `a`; 1: `b`), en línea recta: sin saltos. */
export function mezclarPose(a: Pose3D, b: Pose3D, w: number): Pose3D {
  if (w <= 0) return a;
  if (w >= 1) return b;
  const l = (x: number, y: number): number => x + (y - x) * w;
  return {
    pos: [l(a.pos[0], b.pos[0]), l(a.pos[1], b.pos[1]), l(a.pos[2], b.pos[2])],
    mira: [l(a.mira[0], b.mira[0]), l(a.mira[1], b.mira[1]), l(a.mira[2], b.mira[2])],
    fov: l(a.fov, b.fov),
    giro: l(a.giro, b.giro),
  };
}

/* ===================================================================== el cajón */

const INK: Record<"claro" | "oscuro", number> = { claro: 0x191919, oscuro: 0x16161f };
const MADERA: Record<"claro" | "oscuro", number> = { claro: 0xd29a5c, oscuro: 0x9a6a3c };
const CAJON: Record<"claro" | "oscuro", number> = { claro: 0x8f3520, oscuro: 0x5a2014 };

/* ---------------------------------------------------------------- la mesa rústica (S7) */

/**
 * Las medidas del cajón rústico, en unidades de la mesa. La mesa manda más en la escena: la tapa sobresale más del radio
 * del 2D (`SOBRE_TAPA` por lado), la losa es un tablón más grueso y el cuerpo patas más altas. Los agujeros no se mueven:
 * siguen saliendo del trazo del 2D, que vive en la cara de arriba; todo lo grande crece hacia afuera y hacia abajo.
 */
export const CAJON_MESA = {
  losa: 0.18,
  cuerpoAlto: 0.8,
  pataGrosor: 0.16,
  bordeGrosor: 0.13,
} as const;
/** Cuánto sobresale la tapa del radio de la mesa del 2D, por lado: un canto ancho que se ve de madera. */
export const SOBRE_TAPA = { x: 0.2, z: 0.17 } as const;
/** El ancho y el fondo de la tapa para el radio de la mesa del 2D. */
export const anchoCajon = (tableR: number): number => tableR * 2 + SOBRE_TAPA.x * 2;
export const fondoCajon = (tableR: number): number => tableR * 2 + SOBRE_TAPA.z * 2;

/**
 * La madera rústica: tablones de tonos más ricos que el plano de antes, con variación de tabla a tabla (más rojiza,
 * más clara, más tostada), para que la mesa parezca de madera de verdad y no de un solo color.
 */
export const MADERA_RUSTICA: Record<"claro" | "oscuro", readonly number[]> = {
  claro: [0xa87238, 0x96622f, 0xbc8a4e, 0x82541f],
  oscuro: [0x6e4520, 0x5c3818, 0x825428, 0x4c2d12],
};
/** El tono de la tabla `i`: siempre el mismo para la misma tabla (sale del índice, no del azar), ciclando la paleta. */
export const colorTabla = (tema: "claro" | "oscuro", i: number): number => {
  const tonos = MADERA_RUSTICA[tema];
  return tonos[((i % tonos.length) + tonos.length) % tonos.length] as number;
};

/**
 * El aguayo: la bandera primero (rojo, amarillo, verde) y después los colores de la chalina de la casa. Con estas rayas
 * va la faja del canto de la mesa, la banda del frente del cajón y la guarda de la tapa, estilo wiphala.
 */
export const AGUAYO = [BANDERA[0], BANDERA[1], BANDERA[2], 0xe07a2e, 0xf2ead8, 0x2b6cd5] as const;
/** El color de la raya `i` del aguayo: cicla por la paleta. */
export const franjaAguayo = (i: number): number => AGUAYO[((i % AGUAYO.length) + AGUAYO.length) % AGUAYO.length] as number;
const PISO: Record<"claro" | "oscuro", [number, number]> = { claro: [0xe8d6b8, 0xdcc6a0], oscuro: [0x3b2a3a, 0x4a3849] };
/** La pared de ladrillos de atrás, la del 2D, en el tono del tema (ladrillo, junta). */
const PARED: Record<"claro" | "oscuro", [number, number]> = { claro: [0xecdcb9, 0xd7c196], oscuro: [0x2c2147, 0x1b1432] };
const AMARILLO = 0xffc629;
/** La rana: más clara que la madera para que sea lo primero que se ve (el 2D la separa con su brillo). */
const RANA = 0x5cb746;
const RANA_OSC = 0x3d7a24;
const GARGANTA = 0xc9e8a0;
const MARFIL = 0xfff3cf;
const LENGUA = 0xe0707a;
/** Las manchas del lomo y el labio, el brillo de la cabeza, el iris, los cachetes. */
const RANA_CLARO = 0x9ade6b;
const IRIS = 0x4f9d3a;
const RUBOR = 0xf08c84;
const PIEL = 0xdba27f;
const PIEL_OSC = 0xc08a68;
const PUNIO = 0xf6efe2;

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
  // Las tablas: bandas horizontales con el tono de cada una (la misma madera siempre, con su variación de tono).
  const filas = 6;
  for (let f = 0; f < filas; f++) {
    cx.fillStyle = hex(colorTabla(tema, f));
    cx.fillRect(0, (f * H) / filas, W, H / filas);
  }
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
  // La guarda: rayas del aguayo, mirando hacia adentro, en el borde de adelante y el de atrás.
  const banda = 30, paso = banda * 1.7;
  const col = AGUAYO;
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
 * La cara de la moneda: la bandera de Bolivia en tres franjas de igual alto (rojo arriba, verde abajo). Va en el disco que
 * llena el aro de la argolla; arriba de la textura es `-z` del disco acostado, igual que en `franjaBandera`.
 */
function texturaBandera(): CanvasTexture | null {
  const cx = lienzo(64, 64);
  if (!cx) return null;
  BANDERA.forEach((color, i) => {
    const y0 = Math.round((i * 64) / 3), y1 = Math.round(((i + 1) * 64) / 3);
    cx.fillStyle = hex(color);
    cx.fillRect(0, y0, 64, y1 - y0);
  });
  const t = new CanvasTexture(cx.canvas);
  t.colorSpace = SRGBColorSpace;
  return t;
}

/**
 * La tela del aguayo: rayas verticales de los colores de la wiphala, para la faja del canto de la mesa y la banda del
 * frente del cajón. La misma tela para las dos, un solo dibujo más en el presupuesto.
 */
function texturaAguayo(): CanvasTexture | null {
  const cx = lienzo(AGUAYO.length * 8, 16);
  if (!cx) return null;
  (AGUAYO as readonly number[]).forEach((color, i) => {
    cx.fillStyle = hex(color);
    cx.fillRect(i * 8, 0, 8, 16);
  });
  const t = new CanvasTexture(cx.canvas);
  t.colorSpace = SRGBColorSpace;
  t.wrapS = RepeatWrapping;
  t.repeat.set(3, 1);
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
/** Un punto fuera de toda pantalla: donde va el nombre de un agujero que la cámara de la moneda deja detrás. */
const FUERA = { x: -1e4, y: -1e4 };

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
  const ancho = anchoCajon(tableR), fondo = fondoCajon(tableR);
  const losa = CAJON_MESA.losa, cuerpoAlto = CAJON_MESA.cuerpoAlto;
  const texPiso = texturaPiso(tema);
  if (texPiso) B.add(texPiso);
  const piso = new Mesh(B.add(new PlaneGeometry(60, 60)), B.add(new MeshLambertMaterial({ map: texPiso ?? undefined, color: texPiso ? 0xffffff : PISO[tema][0] })));
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
  const pared = new Mesh(B.add(new PlaneGeometry(40, alturaPared)), B.add(new MeshLambertMaterial({ map: texPared ?? undefined, color: texPared ? 0xffffff : PARED[tema][0] })));
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
    banderines.poner(i, xG0 + (xG1 - xG0) * u, yCuerda(u) - 0.01, zPared + 0.04, ladoBanderin, ladoBanderin * 1.15, 1, 0, BANDERA[i % 3]);
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

  // El cuerpo, de madera rústica como la tapa, y las cuatro patas gruesas del canto que bajan hasta el piso.
  const cuerpoMat = mat.plano(colorTabla(tema, 0));
  const cuerpo = pieza(g.caja, cuerpoMat, 0, -losa - cuerpoAlto / 2, 0, ancho * 0.97, cuerpoAlto, fondo * 0.97);
  mundo.add(cuerpo);
  contorno(cuerpo, 1.012);
  const patas = new Instancias(g.caja, mat.plano(colorTabla(tema, 3)), 4, B);
  const gp = CAJON_MESA.pataGrosor;
  let iPata = 0;
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    patas.poner(iPata++, sx * (ancho / 2 - gp / 2), -losa - cuerpoAlto / 2, sz * (fondo / 2 - gp / 2), gp, cuerpoAlto + losa, gp);
  }
  patas.usar(4);
  patas.fin();
  mundo.add(patas.malla);
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
  const losaMesh = pieza(g.caja, mat.plano(colorTabla(tema, 2)), 0, -losa / 2, 0, ancho, losa, fondo);
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
  // El marco rústico: cuatro vigas gruesas alrededor del canto, un pelo más altas que el tablón y colgando por debajo.
  const marco = new Instancias(g.caja, mat.plano(colorTabla(tema, 1)), 4, B);
  const gb = CAJON_MESA.bordeGrosor, bh = losa + 0.012;
  marco.poner(0, 0, -losa / 2 + 0.006, fondo / 2 - gb / 2, ancho, bh, gb);
  marco.poner(1, 0, -losa / 2 + 0.006, -fondo / 2 + gb / 2, ancho, bh, gb);
  marco.poner(2, -ancho / 2 + gb / 2, -losa / 2 + 0.006, 0, gb, bh, fondo - gb * 2);
  marco.poner(3, ancho / 2 - gb / 2, -losa / 2 + 0.006, 0, gb, bh, fondo - gb * 2);
  marco.usar(4);
  marco.fin();
  tapa.add(marco.malla);
  // La faja del aguayo colgada del canto de adelante: rayas de la wiphala sobre la madera (y un recodo de la misma tela
  // pintado en el borde de arriba del frente del cajón). Una sola tela, dos piezas.
  const texAguayo = texturaAguayo();
  if (texAguayo) B.add(texAguayo);
  const matFaja = B.add(new MeshLambertMaterial(texAguayo ? { map: texAguayo } : { color: franjaAguayo(1) }));
  const fajaAlto = cuerpoAlto * 0.34;
  tapa.add(pieza(g.caja, matFaja, 0, 0.012 - (fajaAlto + 0.012) / 2, fondo / 2 + 0.006, ancho * 0.46, fajaAlto + 0.012, 0.03));
  mundo.add(pieza(g.caja, matFaja, 0, -losa - 0.045, (fondo * 0.97) / 2 + 0.012, ancho * 0.97, 0.07, 0.02));

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
  const cuerpoR = pieza(g.esfera, mat.plano(RANA), 0, 0.62 * fr, -0.25 * fr, 0.95 * fr, 0.62 * fr, 0.8 * fr);
  rana.add(cuerpoR);
  contorno(cuerpoR, 1.06);
  // Las manchas del lomo y el brillo de la cabeza van apoyadas en el cuerpo (la misma cuenta que `alturaRana`): no lo cambian.
  const manchas = new Instancias(g.esfera, mat.plano(RANA_OSC), 5, B);
  const MANCHAS = [[0, -0.6, 0.15], [-0.34, -0.78, 0.12], [0.34, -0.78, 0.12], [-0.78, -0.6, 0.09], [0.78, -0.6, 0.09]] as const;
  MANCHAS.forEach(([x, z, r], i) => manchas.poner(i, x * fr, alturaRana(x * fr, z * fr, fr) - 0.025 * fr, z * fr, r * fr, 0.06 * fr, r * 0.85 * fr));
  manchas.usar(MANCHAS.length);
  manchas.fin();
  rana.add(manchas.malla);
  const brillo = pieza(g.esfera, mat.plano(RANA_CLARO), -0.32 * fr, alturaRana(-0.32 * fr, 0.12 * fr, fr) - 0.02 * fr, 0.12 * fr, 0.2 * fr, 0.05 * fr, 0.12 * fr);
  rana.add(brillo);
  // Los dedos de las patas de adelante, tres por pata, con su tinta.
  const dedosRana = new Instancias(g.esfera, mat.plano(RANA_OSC), 6, B);
  const dedosTinta = new Instancias(g.esfera, tintaBack, 6, B);
  // El párpado: media esfera de bronce que baja sobre el ojo cuando parpadea.
  const mediaEsfera = B.add(new SphereGeometry(1, 10, 4, 0, Math.PI * 2, 0, Math.PI / 2));
  const parpados: Mesh[] = [];
  for (const sx of [-1, 1]) {
    const pata = pieza(g.esfera, mat.plano(RANA_OSC), sx * 0.8 * fr, 0.28 * fr, -0.3 * fr, 0.42 * fr, 0.3 * fr, 0.55 * fr);
    rana.add(pata);
    contorno(pata, 1.08);
    const delantera = pieza(g.esfera, mat.plano(RANA_OSC), sx * 0.5 * fr, 0.17 * fr, 0.42 * fr, 0.2 * fr, 0.17 * fr, 0.3 * fr);
    rana.add(delantera);
    contorno(delantera, 1.1);
    for (let d = -1; d <= 1; d++) {
      const i = (sx < 0 ? 0 : 3) + d + 1;
      const x = (sx * 0.5 + d * 0.12) * fr, z = (0.68 - Math.abs(d) * 0.04) * fr;
      dedosRana.poner(i, x, 0.06 * fr, z, 0.075 * fr, 0.06 * fr, 0.09 * fr, d * 0.35);
      dedosTinta.poner(i, x, 0.06 * fr, z, 0.075 * fr * 1.25, 0.06 * fr * 1.25, 0.09 * fr * 1.2, d * 0.35);
    }
    // El zócalo del ojo: bronce, para que el ojo nazca de la cabeza y no parezca pegado encima.
    const zocalo = pieza(g.esfera, mat.plano(RANA), sx * 0.5 * fr, 0.92 * fr, -0.3 * fr, 0.36 * fr, 0.26 * fr, 0.36 * fr);
    rana.add(zocalo);
    contorno(zocalo, 1.08);
    // Los ojos: grandes, claros y sobre la cabeza, para que la rana mire a la cámara (con el color del cuerpo parecía una tortuga).
    const ojo = pieza(g.esfera, mat.plano(MARFIL), sx * 0.5 * fr, 1.08 * fr, -0.28 * fr, 0.33 * fr, 0.33 * fr, 0.33 * fr);
    rana.add(ojo);
    contorno(ojo, 1.1);
    const parpado = pieza(mediaEsfera, mat.plano(RANA), sx * 0.5 * fr, 1.08 * fr, -0.28 * fr, 0.345 * fr, 0.345 * fr, 0.345 * fr);
    rana.add(parpado);
    parpados.push(parpado);
    // Los cachetes, al costado de la boca.
    const cachete = pieza(g.esfera, mat.plano(RUBOR), sx * 0.6 * fr, 0.8 * fr, 0.3 * fr, 0.12 * fr, 0.08 * fr, 0.08 * fr);
    rana.add(cachete);
    // Las narinas, dos puntos de tinta arriba de la boca.
    rana.add(pieza(g.esfera, tintaPlana, sx * 0.13 * fr, 1.0 * fr, 0.36 * fr, 0.04 * fr, 0.03 * fr, 0.03 * fr));
  }
  dedosRana.usar(6);
  dedosTinta.usar(6);
  dedosRana.fin();
  dedosTinta.fin();
  rana.add(dedosTinta.malla, dedosRana.malla);
  // El iris verde, la pupila y el brillo del ojo: los tres se cierran con el parpadeo.
  const irises = [-1, 1].map((sx) => {
    const p = pieza(g.esfera, mat.plano(IRIS), sx * 0.5 * fr, 1.26 * fr, -0.06 * fr, 0.23 * fr, 0.23 * fr, 0.12 * fr);
    rana.add(p);
    return p;
  });
  const pupilas = [-1, 1].map((sx) => {
    const p = pieza(g.esfera, tintaPlana, sx * 0.5 * fr, 1.27 * fr, -0.03 * fr, 0.17 * fr, 0.17 * fr, 0.13 * fr);
    rana.add(p);
    return p;
  });
  const blanco = B.add(new MeshBasicMaterial({ color: 0xffffff }));
  const destellos = [-1, 1].map((sx) => {
    const p = pieza(g.esfera, blanco, (sx * 0.5 - 0.06) * fr, 1.34 * fr, 0.08 * fr, 0.05 * fr, 0.05 * fr, 0.03 * fr);
    rana.add(p);
    return p;
  });
  const garganta = pieza(g.esfera, mat.plano(GARGANTA), 0, 0.42 * fr, 0.33 * fr, 0.55 * fr, 0.34 * fr, 0.36 * fr);
  rana.add(garganta);
  // El labio: un borde de bronce oscuro detrás de la boca, que la acompaña cuando se abre.
  const labio = pieza(g.esfera, mat.plano(RANA_OSC), 0, 0.72 * fr, 0.48 * fr, 0.6 * fr, 0.1 * fr, 0.16 * fr);
  rana.add(labio);
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
  // Una mano derecha, palma abajo, que pellizca la argolla: el dorso, cuatro dedos que se curvan hacia la mesa y el pulgar
  // por debajo del lado de adentro. Solo es dibujo: dónde está y cómo se mueve lo decide el cuadro con lo que manda el 2D.
  const mano = new Group();
  tapa.add(mano);
  const piel = mat.plano(PIEL);
  const pielOsc = mat.plano(PIEL_OSC);
  const palma = pieza(g.esfera, piel, 0, 0.012, 0.005, 0.08, 0.045, 0.085);
  mano.add(palma);
  contorno(palma, 1.1);
  // Índice, medio, anular y meñique: el del medio es el más largo; las puntas bajan hacia la mesa. Cada dedo vive en
  // un grupo con su pivote en el nudillo (S9): así se curva con la flexión que manda el 2D, y en reposo (rotación 0)
  // la pose es la de siempre.
  const dedos: { g: Group; peso: number }[] = [];
  const PESO_DEDO = [1.05, 1, 0.95, 0.85]; // el meñique cierra menos
  let idDedo = 0;
  for (const [dx, largo, gira] of [[-0.05, 0.036, 0.12], [-0.017, 0.044, 0.03], [0.017, 0.041, -0.04], [0.05, 0.031, -0.14]] as const) {
    const dedoG = new Group();
    dedoG.position.set(dx, -0.004, -0.055);
    const dedo = pieza(g.esfera, piel, 0, 0, -0.007 - largo * 0.75, 0.019, 0.018, largo);
    dedo.rotation.set(-0.55, gira, 0);
    dedoG.add(dedo);
    contorno(dedo, 1.15);
    mano.add(dedoG);
    dedos.push({ g: dedoG, peso: PESO_DEDO[idDedo++] ?? 1 });
    // El nudillo, apenas más oscuro, donde el dedo sale del dorso: él no gira, gira el dedo.
    mano.add(pieza(g.esfera, pielOsc, dx, 0.03, -0.055, 0.017, 0.012, 0.015));
  }
  const pulgarG = new Group();
  pulgarG.position.set(-0.072, -0.01, -0.03);
  mano.add(pulgarG);
  const pulgar = pieza(g.esfera, piel, 0, 0, 0, 0.02, 0.019, 0.042);
  pulgar.rotation.set(-0.35, -0.65, 0);
  pulgarG.add(pulgar);
  contorno(pulgar, 1.15);
  // El brazo entra desde abajo a la derecha de la pantalla (hacia la cámara y a la derecha). La muñeca (S9) va entre
  // la palma y el antebrazo: se echa atrás recogiendo el impulso y arrea el látigo adelante en la suelta.
  const munecaG = new Group();
  mano.add(munecaG);
  const dirBrazo = new Vector3(0.55, 0.04, 0.83).normalize();
  const antebrazo = new Group();
  munecaG.add(antebrazo);
  const qBrazo = new Quaternion().setFromUnitVectors(SUBE, dirBrazo);
  antebrazo.quaternion.copy(qBrazo);
  // La muñeca y el antebrazo, que se ensancha hacia el codo (un cono truncado: más fino en la mano).
  const conoBrazo = B.add(new CylinderGeometry(1.3, 1, 1, 8, 1));
  const muneca = pieza(conoBrazo, piel, 0, 0.13, 0, 0.038, 0.26, 0.038);
  antebrazo.add(muneca);
  contorno(muneca, 1.1);
  antebrazo.add(pieza(g.esfera, piel, 0, 0.02, 0, 0.044, 0.04, 0.044));
  const matManga = new MeshLambertMaterial({ color: 0xe93d9c, flatShading: true });
  B.add(matManga);
  // Los pliegues de la manga, del mismo color un poco más oscuro.
  const matPliegue = B.add(new MeshLambertMaterial({ color: 0xa82a70, flatShading: true }));
  const manga = pieza(g.cilindro, matManga, 0, 1.9, 0, 0.065, 3.4, 0.065);
  antebrazo.add(manga);
  const mangaHull = pieza(g.cilindro, tintaBack, 0, 1.9, 0, 0.074, 3.42, 0.074);
  antebrazo.add(mangaHull);
  for (const y of [0.42, 0.6]) antebrazo.add(pieza(g.cilindro, matPliegue, 0, y, 0, 0.069, 0.03, 0.069));
  // El puño crema de la manga, para que la mano se separe del brazo turquesa; ensanchado hacia la mano y con un botón arriba.
  const punio = pieza(B.add(new CylinderGeometry(1, 1.12, 1, 8, 1)), mat.plano(PUNIO), 0, 0.27, 0, 0.074, 0.08, 0.074);
  antebrazo.add(punio);
  contorno(punio, 1.12);
  // Lo que en el antebrazo mira hacia arriba (el brazo está acostado): ahí va el botón, a la vista de la cámara.
  const arribaBrazo = SUBE.clone().applyQuaternion(qBrazo.clone().invert());
  const boton = pieza(g.esfera, mat.plano(AMARILLO), arribaBrazo.x * 0.085, 0.27, arribaBrazo.z * 0.085, 0.014, 0.014, 0.014);
  antebrazo.add(boton);
  contorno(boton, 1.3);

  /* ---------------------------------------------------------------- las argollas */
  // La moneda de la bandera: el canto con las tres franjas (colores por cara) y el disco de adentro con la bandera
  // pintada. Dieciocho tramos en el canto: los límites caen en ±20°, donde las franjas de la cara cortan el canto.
  const toroArgolla = B.add(pintarArgolla(new TorusGeometry(TORO_R, TORO_T, 5, 18).rotateX(Math.PI / 2)));
  const matArgolla = B.add(new MeshLambertMaterial({ vertexColors: true, flatShading: true }));
  const texCara = texturaBandera();
  if (texCara) B.add(texCara);
  // El disco no pasa del eje del canto: la argolla ocupa lo mismo que antes y `poseArgolla` vale igual.
  const discoArgolla = B.add(new CircleGeometry(TORO_R, 18).rotateX(-Math.PI / 2));
  const matCara = B.add(new MeshLambertMaterial(texCara ? { map: texCara, side: DoubleSide } : { color: BANDERA[1], side: DoubleSide }));
  const matAnillo = mat.plano(AMARILLO);
  const toroAnillo = B.add(new TorusGeometry(1, 0.05, 4, 22).rotateX(Math.PI / 2));
  const ellas = Array.from({ length: 4 }, () => {
    const grupo = new Group();
    const toro = new Mesh(toroArgolla, matArgolla);
    // La cara gira con el canto (`toro.rotation.y`).
    toro.add(new Mesh(discoArgolla, matCara));
    const casco = new Mesh(toroArgolla, tintaBack);
    casco.scale.setScalar(1.13);
    const anillo = new Mesh(toroAnillo, matAnillo);
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
      // La toma `seguir` de cada tiro: baja, gira hacia la mano y se arrima a la argolla, sobre la cámara del director.
      const tiro = cercaniaDelTiro(e.argollas, e.golpes, e.t);
      const perfil = perfilDelTiro(perfilSapo(m.tilt, deltaCamara(e.t, e.tension, e.golpe)), tiro.cerca, m.tilt);
      const ajustar = (c: Camara2D): Camara2D => camaraDelSapo(c, e.w, e.h, ZOOM_MAX, e.primerPlano ?? 0);
      // El aro destacado, con lo que este cuadro le dibuja, y dónde queda el grupo de la mesa: lo que mide el despeje.
      const aro = aroDestacado(e);
      const lugar = lugarDelMundo(motor.mapa(e.u, perfil), m);
      // La toma manda sobre la cámara del director; con el primer plano, el despeje del cartel y el relator va antes de
      // dibujar: la cámara que dibuja es la despejada.
      const cam = encajarAntes(camaraDelTiro(ajustar(e.cam), tiro.cerca, tiro.foco, m), (c) => (aro ? cajaDeAro(aro, lugar, proyectorDe(c, e.w, e.h, e.u, perfil)) : null), e.encajar, ajustar);
      // La toma `moneda` de la última argolla: reemplaza la pose al final del cuadro, mezclada con la del director.
      const moneda = pesoMoneda(e.argollas);
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
        for (const p of irises) p.scale.y = 0.23 * fr * Math.max(0.15, r.ojo);
        for (const p of destellos) p.visible = r.ojo > 0.5;
        // El párpado: abierto queda echado atrás sobre la coronilla del ojo; al parpadear baja y tapa la pupila.
        const cierra = Math.min(1, Math.max(0, (1 - r.ojo) / 0.85));
        for (const p of parpados) p.rotation.x = -1.35 + 1.85 * cierra;
        labio.scale.set(boca.scale.x * 1.1, boca.scale.y + 0.05 * fr, 0.16 * fr);
        labio.position.y = boca.position.y;
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
        matPliegue.color.setHex(mn.manga).multiplyScalar(0.72);
        // S9: los dedos se curvan con la flexión que manda el 2D (o con el impulso, si no hay señal) y la muñeca
        // arrea el látigo en la suelta. Con las señales en reposo las rotaciones quedan en 0: la pose de siempre.
        const agarra = agarraDe(mn.flex, mn.fase, mn.swing);
        for (const d of dedos) d.g.rotation.x = -1.05 * agarra * d.peso;
        pulgarG.rotation.x = -0.75 * agarra;
        munecaG.rotation.x = munecaDe(mn.fase, mn.swing);

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
          const p = teeterSapo(poseArgolla(a, brArgolla, fr, manoMundo, bocaMundo), a, brArgolla);
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

        // La cámara de la última argolla: el motor aplica la pose después de este dibujo (como en el guajojo).
        if (moneda.peso > 0 && moneda.argolla) {
          const pa = poseArgolla(moneda.argolla, brArgolla, fr, manoMundo, bocaMundo);
          Object.assign(pose, mezclarPose(pose, poseMoneda(moneda.argolla, moneda.s, pa, mn.punto, fr, { px, pz, K, Kz }, e.w / Math.max(1, e.h)), moneda.peso));
        }
        amb.seguir(pose);
      });
      // Lo que el 2D usa para anclar sus nombres, medallas y el foco a lo que la cámara 3D ve. Con la cámara de la moneda
      // un agujero puede quedar detrás de ella: su nombre va fuera de la pantalla y no vuelve al lugar de la cámara 2D.
      const enMoneda = moneda.peso > 0;
      e.puente.aPantalla = (p, alto = 0) => motor.proyectar(px + K * p.x, K * alto, pz + Kz * p.y) ?? (enMoneda ? FUERA : null);
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
