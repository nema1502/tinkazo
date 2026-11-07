import {
  AdditiveBlending, BufferGeometry, CircleGeometry, DoubleSide, Group, InstancedMesh, Mesh, MeshBasicMaterial, MeshLambertMaterial, Object3D, PlaneGeometry,
  Quaternion, RingGeometry, SphereGeometry, Vector3,
} from "three";
import type { Basura } from "./motor";
import { definir3D } from "./motor";
import { crearAmbiente } from "./escena";
import { crearGeometrias, Materiales, pieza } from "./figuras";
import { hash } from "./ids";
import { perfilFiel, type Mapa, type PerfilMapa, type Pose3D } from "./camara";
import type { Camara2D, EntradaBase, Fabrica3D, Lanzador, Montaje3D } from "./tipos";
import {
  CANICA_R, CIRCULO_R, PEGADORA_DIST, trayectoriaDe, unitarioDe,
  type Datos, type Mapeo, type Pun, type Tiro,
} from "../pixi/bolillas-plan";
import { cercaDe, dibujoDe, anuncioDeDiana, persecucionDe, AGUAYO, CANICA_ESCALA, type Persecucion } from "../pixi/bolillas-arte";
/**
 * Bolillas en 3D: la troya de verdad — la tierra con su relieve, el círculo de yeso, las canicas de vidrio y la mano
 * con el agarre ñati que suelta cada tiro. El plan puro (`pixi/bolillas-plan.ts`) decide todo: esta vista solo dibuja
 * lo que el plan ya puso, cuadro a cuadro, y suena cuando las canicas chocan (el clic de la casa, mudo incluido).
 * No guarda nada que cambie lo que pasa: cada cuadro es función de la hora `t` y del plan que le pasa el 2D.
 *
 * Todo el mundo vive en un grupo (`mundo`) medido en **unidades del círculo** (la tiza queda a `CIRCULO_R`): el grupo
 * se apoya donde el 2D puso el círculo con la cuenta de la casa (`lugarDelMundo`, `mapa.a3D`), así las canicas caen
 * donde el plan las sembró y los nombres, que siguen siendo de PixiJS, se apoyan encima con la misma proyección.
 *
 * El cableado es el de la casa (`src/games/tres/README.md`): este archivo se registra solo (el registro de
 * `registro.ts` descubre todo `*-3d.ts` que exporte `lanzador3D`), Bolillas **no** entra a `JUEGOS_CON_3D` (D3: nace
 * apagada; el 3D se prueba con `?motor=3d`). Falta el enchufe del otro lado: la escena 2D (`pixi/bolillas.ts`, tarea
 * paralela) tiene que seguir el patrón de `guajojo`/`toborochi` — `anfitrion3D` con lienzo transparente,
 * `definicion(tres?)` y `export const bolillasPixi3D = (tres) => crearJuego(definicion(tres), anfitrion3D)` — y pasar
 * la `EntradaBolillas` de cada cuadro con `enchufar3D` + `entradaBase`. Mientras ese enchufe no exista, `lanzador3D`
 * devuelve el juego en 2D y nada se rompe.
 */

/* ===================================================================== lo que el 2D le pasa */

/**
 * La entrada de cada cuadro: lo de siempre (`EntradaBase`) más el plan y el mapeo del círculo. El 2D la arma una vez
 * y la va llenando (`Object.assign(en, entradaBase(S, t))`, como el guajojo), sin crear objetos nuevos por cuadro.
 */
export interface EntradaBolillas extends EntradaBase {
  /** El plan de la ronda (los `datos` del plan), o null mientras no esté. */
  plan: Datos | null;
  /** Cómo cae el círculo en el mundo del 2D: el `mapeo` de la escena (centro y píxeles por unidad del círculo). */
  mapeo: Mapeo;
}

/** La entrada vacía, para armar la escena antes del primer plan (la llena el 2D cuadro a cuadro). */
export function entradaBolillasVacia(): EntradaBolillas {
  return {
    t: 0, w: 0, h: 0, u: 1,
    cam: { x: 0, y: 0, zoom: 1, rot: 0, sacudonX: 0, sacudonY: 0 },
    plan: null,
    mapeo: { cx: 0, cy: 0, e: 100 },
  };
}

/* ===================================================================== las cuentas puras (se prueban en Node) */

/** Lo que dura el vuelo de la mano de afuera antes de tocar mi canica (igual que el 2D): cosmética, no el reloj. */
export const TIRADOR = 0.55;
/** Lo que tarda el tiro en frenar después del golpe (igual que el 2D). */
export const T_DESVIO = 0.45;
/** Lo que la canica que gana tarda en llegar a la orilla desde el roce (el `2` de `trayectoriaDe`). */
export const LLEGADA_TITILA = 2;
/** Cuánto titila, en radianes: se ve, no decide. */
export const TEETER_ALTO = 0.25;
/** El vaivén del titileo, en radianes por segundo. */
export const TEETER_FRECUENCIA = 12;
/** La elevación de la cámara: desde arriba, para que el círculo se lea como círculo. */
export const ELEVACION = 0.93;
/** El radio dibujado de una canica (S17): el del plan, agrandado por el multiplicador de la casa. */
const R_DIBUJO = CANICA_R * CANICA_ESCALA;
const FOV = (32 * Math.PI) / 180;
const ACERCA = 1.08;
/** Lo más que se acerca la cámara 3D, para que el círculo entero siga en cuadro (con perspectiva, de cerca se sale). */
export const ZOOM_MAX = 1.25;

/**
 * Dónde queda el grupo del mundo en el espacio 3D: la cuenta de la casa lleva el centro del círculo del 2D, y la
 * escala pasa de unidades del círculo a unidades del mundo (en profundidad, estirada por `zc` como en todo el 3D).
 */
export function lugarDelMundo(mapa: Mapa, m: Mapeo): { px: number; pz: number; K: number; Kz: number } {
  const [px, , pz] = mapa.a3D(m.cx, m.cy, 0);
  return { px, pz, K: m.e * mapa.s, Kz: m.e * mapa.s * mapa.perfil.zc };
}

/**
 * Cuánto se acerca o se aleja la cámara respecto de lo que encuadra el 2D: hasta el tope es la del director; más
 * allá, el zoom queda en el tope y el centro vuelve hacia el de la pantalla, sin saltos. Depende solo de la cámara
 * del 2D, nunca de quién gana.
 */
export function camaraBolillas(cam: Camara2D, w: number, h: number, tope = ZOOM_MAX): Camara2D {
  if (cam.zoom <= tope) return cam;
  const k = (tope - 1) / (cam.zoom - 1);
  return { ...cam, zoom: tope, x: w / 2 + (cam.x - w / 2) * k, y: h / 2 + (cam.y - h / 2) * k };
}

/** El perfil de cámara de Bolillas: desde arriba, fiel a las proporciones del piso del 2D. */
export const perfilBolillas = (delta = 0): PerfilMapa =>
  perfilFiel(ELEVACION + delta, { fov: FOV, acerca: ACERCA, tam: 1, altoMira: 0, pieMira: 0 });

export type EstadoTiro = "ida" | "desvio";

/** Dónde está la canica de la mano durante su tiro: la ida hasta el primer choque y el desvío hasta su freno. */
export interface PoseTiro {
  x: number;
  y: number;
  estado: EstadoTiro;
  /** El avance en el tramo (0 a 1). */
  f: number;
}

/**
 * La pose de la mano en el segundo `t`, puntada por puntada del plan (S23): en la largada está en `desde`, en
 * `tiro.tMano` toca **mi** canica en `choque` (el primer choque de la cadena, no la del enemigo), y al final del
 * desvío queda en `mano.hasta`. Fuera de la ventana no hay tiro (null). Sin azar: todo sale de `t` y del plan.
 */
export function poseTiro(tiro: Tiro, t: number, vuelo = TIRADOR, desvio = T_DESVIO): PoseTiro | null {
  if (t < tiro.tMano - vuelo || t > tiro.tMano + desvio) return null;
  if (t <= tiro.tMano) {
    const f = Math.min(1, Math.max(0, (t - (tiro.tMano - vuelo)) / vuelo));
    return {
      x: tiro.desde.x + (tiro.choque.x - tiro.desde.x) * f,
      y: tiro.desde.y + (tiro.choque.y - tiro.desde.y) * f,
      estado: "ida",
      f,
    };
  }
  const f = Math.min(1, (t - tiro.tMano) / desvio);
  return {
    x: tiro.choque.x + (tiro.mano.hasta.x - tiro.choque.x) * f,
    y: tiro.choque.y + (tiro.mano.hasta.y - tiro.choque.y) * f,
    estado: "desvio",
    f,
  };
}

/** Las ventanas del turno (S23), en los segundos del plan: cuándo la mano suelta, toca mi canica y la cadena sigue. */
export interface VentanaCadena {
  /** La mano suelta la canica de afuera (`tiro.tMano - TIRADOR`). */
  suelte: number;
  /** La mano toca mi canica: el primer choque. */
  tMano: number;
  /** Mi canica golpea a la del enemigo: el segundo choque, y la salida. */
  t: number;
  /** La mano se frena después del primer choque. */
  finMano: number;
  /** La canica del enemigo cruza la tiza. */
  tiza: number;
}

/** Las horas del turno, todas del plan: la escena no vuelve a medir la cadena por su cuenta. */
export function ventanaCadena(tiro: Tiro): VentanaCadena {
  return {
    suelte: tiro.tMano - TIRADOR,
    tMano: tiro.tMano,
    t: tiro.t,
    finMano: tiro.tMano + T_DESVIO,
    tiza: tiro.t + tiro.salida.vuelo,
  };
}

/** Lo que rueda una canica: sobre qué eje del piso (`y` es la profundidad) y cuántos radianes. */
export interface Rodado {
  eje: Pun;
  giro: number;
}

/**
 * El rodado de una canica que va de `de` a `a`: el eje perpendicular al viaje —en el plano del piso— y los radianes
 * que rueda, la distancia recorrida sobre su radio, sin patinar. `f` es el avance del tramo (0 a 1, recortado);
 * sin viaje no hay giro. Puro y determinista: la escena solo lo aplica al quaternion.
 */
export function rodadoDe(de: Pun, a: Pun, f: number, radio = R_DIBUJO): Rodado {
  const dx = a.x - de.x;
  const dy = a.y - de.y;
  const largo = Math.hypot(dx, dy);
  const eje = largo > 1e-9 ? { x: dy / largo, y: -dx / largo } : { x: 0, y: 1 };
  const k = Math.min(1, Math.max(0, f));
  return { eje, giro: (k * largo) / Math.max(1e-9, radio) };
}

/**
 * El rodado de la canica del asiento `slot` en el segundo `t` (S21/S23): la del enemigo gira al cruzar la tiza y
 * mi canica gira mientras el empuje la lleva de `choque` a `empuje.hasta`; en la hora del segundo choque se frena
 * y se queda quieta (null). La misma ley de `trayectoriaDe` (el plan), aplicada al dibujo.
 */
export function rodadoDelTurno(d: Pick<Datos, "tiros">, slot: number, t: number, radio = R_DIBUJO): Rodado | null {
  const salida = d.tiros.find((x) => x.slot === slot);
  if (salida && t >= salida.t) {
    const f = salida.salida.vuelo > 1e-9 ? Math.min(1, (t - salida.t) / salida.salida.vuelo) : 1;
    return rodadoDe(salida.empuje.donde, salida.salida.tiza, f, radio);
  }
  // El último empuje de esta canica que ya empezó (los turnos pueden repetir): el mismo que dibuja `trayectoriaDe`.
  let empuje: Tiro | undefined;
  for (const tiro of d.tiros) {
    if (tiro.mio !== slot) continue;
    if (t < tiro.tMano) break;
    empuje = tiro;
  }
  if (!empuje || t >= empuje.t) return null;
  const f = empuje.t > empuje.tMano ? (t - empuje.tMano) / (empuje.t - empuje.tMano) : 1;
  const suaveRodado = f * f * (3 - 2 * f);
  return rodadoDe(empuje.choque, empuje.empuje.hasta, suaveRodado, radio);
}

/**
 * Cuánto titila una canica apoyada en la tiza, en radianes: el vaivén de la lección del sapo — un envolvente de seno
 * que nace y muere en cero, así no hay salto ni de entrada ni de salida, y dentro titila de verdad. Sin azar.
 */
export function titileo(t: number, t0: number, t1: number, alto = TEETER_ALTO, frec = TEETER_FRECUENCIA): number {
  if (!(t1 > t0)) return 0;
  const u = (t - t0) / (t1 - t0);
  if (u <= 0 || u >= 1) return 0;
  return alto * Math.sin(Math.PI * u) * Math.sin((t - t0) * frec);
}

/**
 * El titileo de la canica que gana: empieza cuando llega a la orilla (`casi.t + LLEGADA_TITILA`, el mismo tramo que
 * anima `trayectoriaDe`) y muere exactamente con el golpe del cartel. Determinista, cero en los dos bordes.
 */
export function teeterDelCasi(d: Pick<Datos, "casi" | "duracion">, t: number): number {
  return titileo(t, d.casi.t + LLEGADA_TITILA, d.duracion);
}

/* -------------------------------------------------- el acercamiento a la ganadora */

/** El giro de la canica que gana, en radianes: se ve girar, no vibra. */
export const GIRO_ALTO = 2.4;
/** El vaivén del giro, en radianes por segundo: más lento que el titileo, así se lee como giro y no como temblor. */
export const GIRO_FRECUENCIA = 3.2;
/** Cuánto se aparta la cámara de cerca, por detrás de la canica, en unidades del círculo. */
const CERCA_ATRAS = 0.5;
/** Cuánto se corre de costado: tres cuartos, para que la canica se lea con volumen. */
const CERCA_CUSTADO = 0.16;
/** A qué altura vuela la cámara de cerca (una canica mide 0,20 de alto con el dibujo al doble, S20): el ojo queda por encima del vidrio. */
const CERCA_ALTO = 0.25;
/** El campo de la toma de cerca: apenas más abierto que el del director. */
const CERCA_FOV = (40 * Math.PI) / 180;

/**
 * El giro de la canica que gana sobre la tiza, en radianes: el segundo eje del titileo. Con el vaivén del costado
 * (`teeterDelCasi`), girar sobre la vertical hace que la canica se lea girando — y se queda quieta igual: nace y
 * muere en cero exacto con la misma envolvente del sapo. Sin azar: función de `t` y de las horas del plan.
 */
export function giroDelCasi(d: Pick<Datos, "casi" | "duracion">, t: number): number {
  return titileo(t, d.casi.t + LLEGADA_TITILA, d.duracion, GIRO_ALTO, GIRO_FRECUENCIA);
}

/**
 * La toma de cerca de la canica que gana, en el mundo 3D: por detrás y a un costado del lugar donde está la canica
 * (el plan la lleva con `trayectoriaDe`, así la cámara la sigue mientras rueda), apenas más arriba del vidrio,
 * mirándola de frente. El peso que la mezcla con la del director es `cercaDe` (en `bolillas-arte.ts`: la misma
 * cuenta del 2D, para el velo de los chips); acá solo la pose. Determinista, cosmética.
 */
export function poseDelCerca(
  d: Pick<Datos, "posiciones" | "tiros" | "casi" | "duracion">,
  t: number,
  lugar: { px: number; pz: number; K: number; Kz: number },
  aspecto: number,
): Pose3D {
  // La canica, tal como se dibuja (S25): el mismo punto que la malla, adentro de la tiza con aire para su cuerpo.
  const p = dibujoDe(d, d.casi.slot, t)?.p ?? trayectoriaDe(d, d.casi.slot, t).p;
  const radial = unitarioDe(p);
  // Tres cuartos, del lado del giro: en un celular angosto se aleja un paso para que la canica entre entera.
  const lejos = Math.min(1.35, Math.max(1, 1 / Math.sqrt(Math.max(0.2, aspecto))));
  const cx = p.x + radial.x * CERCA_ATRAS * lejos - radial.y * CERCA_CUSTADO * lejos;
  const cz = p.y + radial.y * CERCA_ATRAS * lejos + radial.x * CERCA_CUSTADO * lejos;
  const { px, pz, K, Kz } = lugar;
  return {
    pos: [px + K * cx, K * CERCA_ALTO * lejos, pz + Kz * cz],
    mira: [px + K * p.x, K * R_DIBUJO * 0.9, pz + Kz * p.y],
    fov: CERCA_FOV,
    giro: 0,
  };
}

/** La persecución de la ganadora (S24): detrás de su canica y bajo, mirando por delante del empuje. */
const PERSEC_ATRAS = 0.5;
const PERSEC_ALTO = 0.14;
const PERSEC_MIRA = 0.62;
const PERSEC_FOV = (55 * Math.PI) / 180;

/**
 * La toma de la persecución (S24), en el mundo 3D: la cámara se mete detrás de la canica de la ganadora y mira por
 * delante del empuje, así la sala ve el lanzamiento y el choque contra la rival desde su lado. El peso que la mezcla
 * con la del director es `persecucionDe(d, t).peso` (en `bolillas-arte.ts`), la misma cuenta que el 2D; acá solo la
 * pose. Determinista y cosmética: no cambia el plan, ni el orden, ni el ganador.
 */
export function posePersecucion(pers: Persecucion, lugar: { px: number; pz: number; K: number; Kz: number }): Pose3D {
  const { px, pz, K, Kz } = lugar;
  const cx = pers.p.x - pers.dir.x * PERSEC_ATRAS;
  const cz = pers.p.y - pers.dir.y * PERSEC_ATRAS;
  return {
    pos: [px + K * cx, K * PERSEC_ALTO, pz + Kz * cz],
    mira: [
      px + K * (pers.p.x + pers.dir.x * PERSEC_MIRA),
      K * R_DIBUJO * 0.6,
      pz + Kz * (pers.p.y + pers.dir.y * PERSEC_MIRA),
    ],
    fov: PERSEC_FOV,
    giro: 0,
  };
}

/** De la cámara `a` a la `b` con peso `w` (0: `a`; 1: `b`), en línea recta: sin saltos (la lección de la moneda del sapo). */
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

/* --------------------------------------------------- el estallido de pelea (S22) */

/** Los dos choques de la cadena: la mano contra mi canica (el suave) y mi canica contra la del enemigo (el grande). */
export type GolpeCadena = "mano" | "enemigo";
/** Cuánto vive el estallido de pelea de cada choque, en segundos: el grande dura más (y los dos son un parpadeo, S26). */
export const ESTALLIDO_MANO = 0.28;
export const ESTALLIDO_ENEMIGO = 0.42;
/** Las puntas de la estrella del destello y las líneas de velocidad que radian del impacto. */
export const ESTRELLA_PUNTAS = 8;
export const LINEAS_N = 12;
/** Lo más que se sacude la vista, en unidades del círculo: un temblor de pelea, no un salto de encuadre. */
export const SACUDIDA_MAX = 0.035;
/**
 * El tamaño del estallido 3D (S26), medido en canicas dibujadas (`R_DIBUJO`): la estrella no pasa de dos canicas de
 * ancho y ninguna línea se va más allá del alcance — el golpe se lee alrededor de la canica golpeada, no encima del
 * círculo ni del cartel. Los topes valen aunque la receta se retoque.
 */
export const ESTALLIDO_RADIO_TOPE = 2;
export const ESTALLIDO_ALCANCE_TOPE = 2.2;
/** Los velos del estallido (S26: suaves, no una nube blanca): el plato del centro, las puntas y las líneas. */
export const ESTALLO_VELO_CENTRO = 0.5;
export const ESTALLO_VELO_PUNTA = 0.7;
export const ESTALLO_VELO_LINEA = 0.6;
/** Cuánto vive el destello del vidrio sobre la canica golpeada (S13): un parpadeo corto (S26). */
export const DESTELLO_VIDA = 0.2;
/** Lo más que crece el destello del vidrio, en radios dibujados: el gemelo del `flashDe` del 2D (S26). */
export const DESTELLO_RADIO_TOPE = 1.5;
export const DESTELLO_ALFA = 0.5;

/**
 * El destello del vidrio sobre la canica golpeada (S13) en su avance `u` (0 al golpe, 1 ya apagado): dónde flota, cuánto
 * mide y cuánto se ve. S26 lo achicó y lo aclaró — antes era un globo blanco de casi tres canicas de radio encima del
 * círculo—, así que ahora el golpe se lee alrededor de la canica y no encima de la escena. Puro y determinista.
 */
export function destelloDe(u: number, radio = R_DIBUJO): { alto: number; r: number; alfa: number } {
  const k = Math.min(1, Math.max(0, u));
  const s = Math.sin(Math.PI * k);
  return {
    alto: radio * (1 + 0.4 * s),
    r: Math.min(radio * DESTELLO_RADIO_TOPE, radio * (1 + 0.45 * s)),
    alfa: DESTELLO_ALFA * (1 - k),
  };
}

/** Una punta de la estrella: su ángulo y su largo (unidades del círculo). */
export interface PuntoEstrella {
  a: number;
  largo: number;
}

/** Una línea de velocidad: su ángulo, dónde nace y dónde muere (unidades del círculo). */
export interface LineaVelocidad {
  a: number;
  de: number;
  hasta: number;
}

/** Lo que se dibuja en un choque (S22): estrella, líneas de velocidad y micro-sacudida, todo del plan y del hash. */
export interface Estallido {
  golpe: GolpeCadena;
  tiro: Tiro;
  /** La hora del choque. */
  t0: number;
  /** El punto del choque, en unidades del círculo. */
  x: number;
  y: number;
  edad: number;
  vida: number;
  /** El avance del estallido (0 en el choque, tiende a 1 al morir). */
  u: number;
  /** El rumbo del choque: para donde sale lo golpeado. */
  dir: Pun;
  /** El radio de la estrella ya crecida. */
  radio: number;
  /** El velo de la estrella y las líneas (1 al choque, 0 al morir). */
  velo: number;
  puntas: PuntoEstrella[];
  lineas: LineaVelocidad[];
  /** La micro-sacudida de la vista en este instante. */
  sacudida: Pun;
}

/** La receta de cada choque: cuánto vive, cuánto mide su estrella y cuánto sacude (el grande manda, S26 los achicó). */
const RECETA: Record<GolpeCadena, { vida: number; sacudida: number; semilla: number; radio: (tiro: Tiro) => number }> = {
  mano: {
    vida: ESTALLIDO_MANO,
    sacudida: SACUDIDA_MAX * 0.4,
    semilla: 0x51a3,
    radio: () => R_DIBUJO * 0.75,
  },
  enemigo: {
    vida: ESTALLIDO_ENEMIGO,
    sacudida: SACUDIDA_MAX,
    semilla: 0x2e17,
    radio: (tiro) => R_DIBUJO * (1.1 + 0.3 * tiro.salida.fuerza),
  },
};

/**
 * El estallido de pelea de un choque de la cadena en el segundo `t` (S22): el de la mano pega suave en `choque` a
 * la hora `tMano`; el grande pega en `empuje.donde` a la hora `t`, con la estrella más grande y la vida más larga.
 * Las puntas, las líneas y el temblor salen del hash de la hora del choque y de la geometría del plan: la misma
 * tirada estalla igual en cualquier equipo, y nada decide nada. Null fuera de la ventana del choque.
 */
export function estallidoDe(tiro: Tiro, golpe: GolpeCadena, t: number): Estallido | null {
  const rec = RECETA[golpe];
  const t0 = golpe === "mano" ? tiro.tMano : tiro.t;
  const edad = t - t0;
  if (edad < 0 || edad >= rec.vida) return null;
  const u = edad / rec.vida;
  const clave = Math.round(t0 * 1000) + rec.semilla;
  const crece = suave(Math.min(1, edad / (rec.vida * 0.35)));
  // El tope de S26 vale aunque la receta se retoque: la estrella nunca pasa de dos canicas de ancho.
  const base = Math.min(R_DIBUJO * ESTALLIDO_RADIO_TOPE, rec.radio(tiro) * (0.45 + 0.75 * crece));
  const dir = golpe === "mano"
    ? unitarioDe({ x: tiro.choque.x - tiro.desde.x, y: tiro.choque.y - tiro.desde.y })
    : tiro.salida.dir;
  const x = golpe === "mano" ? tiro.choque.x : tiro.empuje.donde.x;
  const y = golpe === "mano" ? tiro.choque.y : tiro.empuje.donde.y;
  const fase = hash(clave, 61) * Math.PI * 2;
  const amp = rec.sacudida * Math.pow(1 - u, 3) * (0.35 + 0.65 * crece) * 0.5;
  return {
    golpe,
    tiro,
    t0,
    x,
    y,
    edad,
    vida: rec.vida,
    u,
    dir,
    radio: base,
    velo: (1 - u) * (1 - u),
    puntas: Array.from({ length: ESTRELLA_PUNTAS }, (_, j) => ({
      a: fase + (j * Math.PI * 2) / ESTRELLA_PUNTAS + (hash(clave + j, 62) - 0.5) * 0.16,
      largo: base * (0.55 + 0.45 * hash(clave + j, 63)),
    })),
    lineas: Array.from({ length: LINEAS_N }, (_, j) => {
      const de = base * (0.5 + 0.35 * u);
      return {
        a: (j * Math.PI * 2) / LINEAS_N + (hash(clave + j, 64) - 0.5) * 0.22,
        de,
        // Cortas (S26), y nunca más allá del alcance del golpe: el tope vale aunque se retoque el largo.
        hasta: de + Math.min(base * (0.35 + 0.4 * hash(clave + j, 65)) * (0.3 + 0.7 * u), R_DIBUJO * ESTALLIDO_ALCANCE_TOPE - de),
      };
    }),
    sacudida: {
      x: amp * Math.sin(edad * 118 + fase),
      y: amp * Math.sin(edad * 97 + fase * 1.7),
    },
  };
}

/** Los estallidos vivos en el segundo `t`: los de cada tiro, en el orden del plan (los dos choques pueden solaparse). */
export function estallidosDe(d: Pick<Datos, "tiros">, t: number): Estallido[] {
  const vivos: Estallido[] = [];
  for (const tiro of d.tiros) {
    const mano = estallidoDe(tiro, "mano", t);
    if (mano) vivos.push(mano);
    const enemigo = estallidoDe(tiro, "enemigo", t);
    if (enemigo) vivos.push(enemigo);
  }
  return vivos;
}

/** La micro-sacudida sumada de los estallidos vivos, en unidades del círculo. */
export function sacudidaDe(vivos: readonly Estallido[]): Pun {
  let x = 0, y = 0;
  for (const e of vivos) {
    x += e.sacudida.x;
    y += e.sacudida.y;
  }
  return { x, y };
}

/**
 * La pose con la micro-sacudida del choque: corre la cámara un pelo hacia donde tiembla el impacto, con la mezcla
 * de la casa (la misma del acercamiento), sin tocar la mira, el campo ni el giro. Chica a propósito: el encuadre
 * del director manda, y esto es un temblor de pelea, no un cambio de toma.
 */
export function poseSacudida(pose: Pose3D, sac: Pun, K: number, Kz: number, peso = 1): Pose3D {
  if (!sac.x && !sac.y) return pose;
  const movida: Pose3D = { ...pose, pos: [pose.pos[0] + K * sac.x, pose.pos[1], pose.pos[2] + Kz * sac.y] };
  return mezclarPose(pose, movida, Math.min(1, Math.max(0, peso)));
}

/* ===================================================================== la paleta */

const PIEL = 0xc68a5c;
const MANGA = 0xe93d9c;
const CHALK: Record<"claro" | "oscuro", number> = { claro: 0xf6f2e8, oscuro: 0xd8d2c4 };
const TIERRA: Record<"claro" | "oscuro", number> = { claro: 0xc9a877, oscuro: 0x4a3624 };
const TIERRA_BARRIDA: Record<"claro" | "oscuro", number> = { claro: 0xbfa070, oscuro: 0x403020 };
const PIEDRA: Record<"claro" | "oscuro", number> = { claro: 0x8a7a64, oscuro: 0x544438 };
const POLVO: Record<"claro" | "oscuro", number> = { claro: 0xd8c09a, oscuro: 0x6a5442 };
/** La opacidad del vidrio de una canica: translúcida, y se apaga entera cuando la canica sale del juego (S25). */
const VIDRIO_OPACIDAD = 0.55;
/** La opacidad de la sombra de contacto de cada canica (S13): se va con su canica (S25). */
const SOMBRA_OPACIDAD = 0.24;
/** Los vidrios de las canicas: el celeste de la 2D y los acentos de la casa. */
const VIDRIOS = [0x8fd0c8, 0xe93d9c, 0xffc629, 0x00a896, 0x6c4ce0, 0xff7a1a];

const suave = (x: number): number => {
  const k = Math.min(1, Math.max(0, x));
  return k * k * (3 - 2 * k);
};

/* ===================================================================== el polvo de la tierra */

/**
 * El polvo del choque: ráfagas de piedritas de tierra que saltan del punto del golpe. Cada partícula es función de
 * `t - t0` y de un hash de su número (la misma ronda levanta el mismo polvo). Vive dentro del grupo del mundo, así
 * que habla en unidades del círculo.
 */
class Polvo {
  private readonly malla: InstancedMesh;
  private readonly d = new Object3D();
  private readonly eventos: { t0: number; x: number; z: number; fuerza: number; serie: number }[] = [];
  private serie = 0;
  private readonly vistos = new Set<number>();
  static readonly POR = 9;
  static readonly MAX = 6;
  static readonly VIDA = 0.65;

  constructor(padre: Object3D, geo: BufferGeometry, mat: MeshLambertMaterial, basura: Basura) {
    this.malla = new InstancedMesh(geo, mat, Polvo.POR * Polvo.MAX);
    this.malla.count = 0;
    this.malla.frustumCulled = false;
    basura.add({ dispose: () => this.malla.dispose() });
    padre.add(this.malla);
  }

  /** Registra una ráfaga una sola vez (por su hora). */
  nuevo(t: number, x: number, z: number, fuerza: number): void {
    const clave = Math.round(t * 1000);
    if (this.vistos.has(clave)) return;
    this.vistos.add(clave);
    this.eventos.push({ t0: t, x, z, fuerza, serie: this.serie++ });
    if (this.eventos.length > Polvo.MAX) this.eventos.shift();
  }

  actualizar(t: number): void {
    const d = this.d;
    let n = 0;
    for (const e of this.eventos) {
      const edad = t - e.t0;
      if (edad < 0 || edad > Polvo.VIDA) continue;
      for (let j = 0; j < Polvo.POR; j++) {
        const a = hash(e.serie * 17 + j, 31) * Math.PI * 2;
        const v = (0.1 + 0.25 * hash(e.serie * 17 + j, 32)) * e.fuerza;
        const vy = (0.25 + 0.4 * hash(e.serie * 17 + j, 33)) * e.fuerza;
        const avance = (1 - Math.exp(-5 * edad)) / 5;
        d.position.set(e.x + Math.cos(a) * v * avance * 3, Math.max(0.004, 0.012 + vy * edad - 2.2 * edad * edad), e.z + Math.sin(a) * v * avance * 3);
        d.scale.setScalar(0.012 * (1 - edad / Polvo.VIDA) + 0.002);
        d.updateMatrix();
        this.malla.setMatrixAt(n++, d.matrix);
      }
    }
    this.malla.count = n;
    this.malla.instanceMatrix.needsUpdate = true;
  }
}

/* ============================================================== las chispas del vidrio */

/**
 * Las chispas del choque: rayitos de brillo que saltan del impacto, más rápidos y más cortos que el polvo — el
 * destello del vidrio que se roza. Cada chispa es función de `t - t0` y de un hash de su número (la misma tirada
 * suelta las mismas chispas), y sale por el rumbo de la canica golpeada que trae el plan. Vive dentro del grupo del
 * mundo (unidades del círculo), igual que el polvo.
 */
class Chispas {
  private readonly malla: InstancedMesh;
  private readonly d = new Object3D();
  private readonly eventos: { t0: number; x: number; z: number; dx: number; dz: number; serie: number }[] = [];
  private serie = 0;
  private readonly vistos = new Set<number>();
  static readonly POR = 7;
  static readonly MAX = 5;
  static readonly VIDA = 0.38;

  constructor(padre: Object3D, geo: BufferGeometry, basura: Basura) {
    this.malla = new InstancedMesh(
      geo,
      basura.add(new MeshBasicMaterial({ color: 0xffefb8, transparent: true, opacity: 0.95, blending: AdditiveBlending, depthWrite: false })),
      Chispas.POR * Chispas.MAX,
    );
    this.malla.count = 0;
    this.malla.frustumCulled = false;
    basura.add({ dispose: () => this.malla.dispose() });
    padre.add(this.malla);
  }

  /** Registra una ráfaga una sola vez (por su hora), con el rumbo de la canica golpeada. */
  nuevo(t: number, x: number, z: number, dx: number, dz: number): void {
    const clave = Math.round(t * 1000);
    if (this.vistos.has(clave)) return;
    this.vistos.add(clave);
    this.eventos.push({ t0: t, x, z, dx, dz, serie: this.serie++ });
    if (this.eventos.length > Chispas.MAX) this.eventos.shift();
  }

  actualizar(t: number): void {
    const d = this.d;
    let n = 0;
    for (const e of this.eventos) {
      const edad = t - e.t0;
      if (edad < 0 || edad > Chispas.VIDA) continue;
      const base = Math.atan2(e.dz, e.dx);
      for (let j = 0; j < Chispas.POR; j++) {
        const a = base + (hash(e.serie * 29 + j, 51) - 0.5) * 1.9;
        const v = 0.35 + 0.55 * hash(e.serie * 29 + j, 52);
        const vy = 0.3 + 0.5 * hash(e.serie * 29 + j, 53);
        const avance = (1 - Math.exp(-7 * edad)) / 7;
        d.position.set(
          e.x + Math.cos(a) * v * avance,
          Math.max(0.004, R_DIBUJO * 0.9 + vy * edad - 3.2 * edad * edad),
          e.z + Math.sin(a) * v * avance,
        );
        d.scale.setScalar(Math.max(0.001, 0.011 * CANICA_ESCALA * (1 - edad / Chispas.VIDA)));
        d.updateMatrix();
        this.malla.setMatrixAt(n++, d.matrix);
      }
    }
    this.malla.count = n;
    this.malla.instanceMatrix.needsUpdate = true;
  }
}

/* ================================================== el estallido de pelea en la tierra */

/**
 * El dibujo del estallido de pelea (S22): la estrella de destello y las líneas de velocidad que radian del impacto,
 * planas en la tierra, aditivas y de pocos polígonos (el estilo de la casa). La geometría y el velo salen de la
 * cuenta pura (`estallidoDe`, `estallidosDe`); esta clase solo los pone en el mundo, en unidades del círculo.
 */
class Estallidos {
  private readonly unidades: { grupo: Group; centro: Mesh; puntas: Mesh[]; lineas: Mesh[] }[] = [];
  static readonly MAX = 3;

  constructor(padre: Object3D, geo: BufferGeometry, basura: Basura) {
    for (let i = 0; i < Estallidos.MAX; i++) {
      const grupo = new Group();
      const matCentro = basura.add(new MeshBasicMaterial({ color: 0xfff4c2, transparent: true, blending: AdditiveBlending, depthWrite: false }));
      const matPunta = basura.add(new MeshBasicMaterial({ color: 0xffd24a, transparent: true, blending: AdditiveBlending, depthWrite: false }));
      const matLinea = basura.add(new MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: AdditiveBlending, depthWrite: false }));
      const centro = new Mesh(geo, matCentro);
      centro.renderOrder = 5;
      grupo.add(centro);
      const puntas = Array.from({ length: ESTRELLA_PUNTAS }, () => {
        const malla = new Mesh(geo, matPunta);
        malla.renderOrder = 6;
        grupo.add(malla);
        return malla;
      });
      const lineas = Array.from({ length: LINEAS_N }, () => {
        const malla = new Mesh(geo, matLinea);
        malla.renderOrder = 6;
        grupo.add(malla);
        return malla;
      });
      grupo.visible = false;
      padre.add(grupo);
      this.unidades.push({ grupo, centro, puntas, lineas });
    }
  }

  actualizar(vivos: readonly Estallido[]): void {
    for (let i = 0; i < this.unidades.length; i++) {
      const u = this.unidades[i] as { grupo: Group; centro: Mesh; puntas: Mesh[]; lineas: Mesh[] };
      const est = vivos[i];
      u.grupo.visible = est !== undefined;
      if (!est) continue;
      u.grupo.position.set(est.x, 0.02, est.y);
      // El destello del centro: un plato aditivo que late con el velo de la estrella.
      u.centro.scale.set(est.radio * 1.1, 1, est.radio * 1.1);
      (u.centro.material as MeshBasicMaterial).opacity = ESTALLO_VELO_CENTRO * est.velo;
      // Las puntas de la estrella: radian del impacto, cada una con su largo del hash.
      for (let j = 0; j < u.puntas.length; j++) {
        const p = est.puntas[j] as PuntoEstrella;
        const malla = u.puntas[j] as Mesh;
        const mid = p.largo / 2;
        malla.position.set(Math.cos(p.a) * mid, 0.001 + j * 0.0004, Math.sin(p.a) * mid);
        malla.rotation.y = -p.a;
        malla.scale.set(p.largo, 1, est.radio * 0.16);
        (malla.material as MeshBasicMaterial).opacity = ESTALLO_VELO_PUNTA * est.velo;
      }
      // Las líneas de velocidad: más afuera que la estrella, y corren hacia afuera mientras el golpe vive.
      for (let j = 0; j < u.lineas.length; j++) {
        const l = est.lineas[j] as LineaVelocidad;
        const malla = u.lineas[j] as Mesh;
        const mid = (l.de + l.hasta) / 2;
        malla.position.set(Math.cos(l.a) * mid, 0.002 + j * 0.0004, Math.sin(l.a) * mid);
        malla.rotation.y = -l.a;
        malla.scale.set(l.hasta - l.de, 1, est.radio * 0.07);
        (malla.material as MeshBasicMaterial).opacity = ESTALLO_VELO_LINEA * est.velo;
      }
    }
  }
}

/* ===================================================================== la fábrica */

const SUBE = new Vector3(0, 1, 0);

const fabrica: Fabrica3D<EntradaBolillas> = (motor, o) => {
  const tema = o.tema;
  const B = motor.basura;
  const g = crearGeometrias(B);
  const mat = new Materiales(B);
  // El sol de la tarde sobre la tierra: ni el cielo ni la niebla se tapan, la tierra se pierde en el horizonte.
  const amb = crearAmbiente(motor, { solDesde: [-40, 80, 60], nieblaCerca: 45, nieblaLejos: 230 });

  const mundo = new Group();
  motor.escena.add(mundo);

  /* ------------------------------------------------------------- la tierra con su relieve */
  // Un campo de tierra facetado: bajas y molinos que salen de un hash, barridos parejos dentro del círculo
  // (la troya se barre antes de jugar). Pocos polígonos, sombreado plano: el estilo de la casa.
  const geoTierra = B.add(new PlaneGeometry(11, 11, 26, 26));
  geoTierra.rotateX(-Math.PI / 2);
  {
    const pos = geoTierra.attributes.position!;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const r = Math.hypot(x, z);
      const fuera = Math.min(1, Math.max(0, (r - CIRCULO_R - CANICA_R * 2) / 1.4));
      const bache = (0.008 + 0.06 * hash(i, 11) * hash(i, 11)) * fuera + 0.003 * hash(i, 12) * (1 - fuera);
      pos.setY(i, bache - 0.012 * (1 - fuera));
    }
  }
  const tierra = new Mesh(geoTierra, B.add(new MeshLambertMaterial({ color: TIERRA[tema], flatShading: true })));
  tierra.receiveShadow = true;
  mundo.add(tierra);

  // El piso barrido de la troya, apenas más claro que la tierra de alrededor.
  const barrida = new Mesh(
    B.add(new CircleGeometry(CIRCULO_R * 0.96, 40).rotateX(-Math.PI / 2)),
    B.add(new MeshLambertMaterial({ color: TIERRA_BARRIDA[tema], flatShading: true })),
  );
  barrida.position.y = 0.006;
  mundo.add(barrida);

  // La tiza: el círculo que decide, dibujado en la tierra.
  const tiza = new Mesh(
    B.add(new RingGeometry(CIRCULO_R * 0.93, CIRCULO_R * 1.03, 48).rotateX(-Math.PI / 2)),
    B.add(new MeshLambertMaterial({ color: CHALK[tema], flatShading: true, side: DoubleSide })),
  );
  tiza.position.y = 0.012;
  mundo.add(tiza);

  // Piedritas alrededor (nunca adentro del ruedo): el mismo reparto por hash de siempre.
  {
    const nP = 70;
    const piedras = new InstancedMesh(g.esfera, B.add(new MeshLambertMaterial({ color: PIEDRA[tema], flatShading: true })), nP);
    piedras.frustumCulled = false;
    const d = new Object3D();
    let puestos = 0;
    for (let i = 0; i < nP * 2 && puestos < nP; i++) {
      const a = hash(i, 21) * Math.PI * 2;
      const r = CIRCULO_R * 1.15 + hash(i, 22) * 3.6;
      const s = 0.012 + 0.024 * hash(i, 23);
      d.position.set(r * Math.cos(a), s * 0.5 + 0.01, r * Math.sin(a));
      d.scale.set(s, s * 0.7, s);
      d.rotation.set(0, hash(i, 24) * Math.PI, 0);
      d.updateMatrix();
      piedras.setMatrixAt(puestos++, d.matrix);
    }
    piedras.count = puestos;
    piedras.instanceMatrix.needsUpdate = true;
    B.add({ dispose: () => piedras.dispose() });
    mundo.add(piedras);
  }

  /* ------------------------------------------------------------- las canicas de vidrio */
  // Una canica: la piel de vidrio (transparente), el remolino de color adentro y el brillo en la parte de arriba.
  const geoVidrio = B.add(new SphereGeometry(1, 10, 8));
  /**
   * Una canica con **sus** materiales: la que cruza la tiza baja su opacidad hasta desaparecer sin apagar a las demás
   * (S25), que comparten la geometría pero no el vidrio. La sombra de contacto va con ella.
   */
  const armarCanica = (
    color: number,
    esc: number,
  ): { grupo: Group; vidrio: Mesh; centro: Mesh; brillo: Mesh; sombra: Mesh; velo: (v: number) => void } => {
    const grupo = new Group();
    const mallaVidrio = B.add(new MeshLambertMaterial({ color, transparent: true, opacity: VIDRIO_OPACIDAD, flatShading: true, depthWrite: false }));
    const vidrio = new Mesh(geoVidrio, mallaVidrio);
    vidrio.scale.setScalar(esc);
    vidrio.renderOrder = 2;
    const mallaCentro = B.add(new MeshLambertMaterial({ color, flatShading: true, transparent: true }));
    const centro = new Mesh(geoVidrio, mallaCentro);
    centro.scale.setScalar(esc * 0.45);
    centro.renderOrder = 1;
    const mallaBrillo = B.add(new MeshBasicMaterial({ color: 0xffffff, transparent: true }));
    const brillo = new Mesh(geoVidrio, mallaBrillo);
    brillo.scale.setScalar(esc * 0.2);
    brillo.position.set(-esc * 0.34, esc * 0.42, -esc * 0.28);
    brillo.renderOrder = 3;
    grupo.add(centro, vidrio, brillo);
    grupo.visible = false;
    mundo.add(grupo);
    // La sombra de contacto (S13): un plano chico debajo de la canica, apoyado en la tierra. Va al mundo, no al
    // grupo: la canica rueda (gira su grupo) y la sombra queda plana en el piso, como la de la casa.
    const mallaSombra = B.add(new MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: SOMBRA_OPACIDAD, depthWrite: false }));
    const sombra = new Mesh(geoSombra, mallaSombra);
    const ss = esc / CANICA_R;
    sombra.scale.set(ss, 1, ss * 0.6);
    sombra.visible = false;
    mundo.add(sombra);
    // El velo de la salida (S25): 1 entera, 0 ida del todo, en los cuatro materiales de esta canica.
    const velo = (v: number): void => {
      mallaVidrio.opacity = VIDRIO_OPACIDAD * v;
      mallaCentro.opacity = v;
      mallaBrillo.opacity = v;
      mallaSombra.opacity = SOMBRA_OPACIDAD * v;
    };
    return { grupo, vidrio, centro, brillo, sombra, velo };
  };
  const canicas = new Map<number, ReturnType<typeof armarCanica>>();
  const canicaDe = (slot: number, d: Datos): ReturnType<typeof armarCanica> => {
    let c = canicas.get(slot);
    if (!c) {
      const persona = d.canicas[slot] ?? slot;
      c = armarCanica(VIDRIOS[persona % VIDRIOS.length] as number, R_DIBUJO);
      canicas.set(slot, c);
    }
    return c;
  };

  // La sombra de contacto: el plano chico que comparten todas las canicas (estilo de la casa: pocos polígonos).
  const geoSombra = B.add(new CircleGeometry(CANICA_R * 1.35, 14).rotateX(-Math.PI / 2));

  // La canica de la pegadora: un pelo más chica, como en el 2D.
  const tiradorCanica = armarCanica(VIDRIOS[0] as number, R_DIBUJO * 0.85);
  const R_TIRADOR = R_DIBUJO * 0.85;

  // El destello del golpe: un puntito de luz sobre la canica golpeada, un parpadeo. No es el flash de la cámara: es
  // el vidrio que la devuelve (y desde S26 es chico: lo mide `destelloDe`).
  const destello = new Mesh(geoVidrio, B.add(new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: DESTELLO_ALFA, depthWrite: false })));
  destello.visible = false;
  destello.renderOrder = 4;
  mundo.add(destello);

  /* ------------------------------------------------------------- la mano con el agarre ñati */
  const mano = new Group();
  mundo.add(mano);
  const piel = mat.plano(PIEL);
  const palma = pieza(g.esfera, piel, 0, 0.055, 0, 0.075, 0.05, 0.07);
  mano.add(palma);
  // El ñati: los nudillos doblados alrededor de la canica y el pulgar encima.
  for (const [dx, dz] of [[-0.033, -0.052], [0.008, -0.062], [0.048, -0.05]] as const) {
    mano.add(pieza(g.esfera, piel, dx, 0.022, dz, 0.022, 0.022, 0.022));
  }
  mano.add(pieza(g.esfera, piel, 0.008, 0.075, -0.012, 0.02, 0.028, 0.02));
  // El brazo entra desde abajo, atrás de la mano, con la manga de la casa.
  const muneca = pieza(g.cilindro, piel, 0, 0.02, -0.1, 0.026, 0.16, 0.026);
  muneca.rotation.x = 1.1;
  mano.add(muneca);
  const manga = pieza(g.cilindro, mat.plano(MANGA), 0, -0.045, -0.36, 0.042, 0.5, 0.042);
  manga.rotation.x = 1.1;
  mano.add(manga);
  mano.visible = false;

  /* ------------------------------------------------------------- el polvo y las sombras */
  const polvo = new Polvo(mundo, g.esfera, B.add(new MeshLambertMaterial({ color: POLVO[tema], flatShading: true })), B);
  const chispo = new Chispas(mundo, g.esfera, B);

  /* --------------------------------------------------------- el anuncio de la diana (S19) */
  // El anillo con rayas que le dice a la sala a cuál canica le va a pegar la pegadora: pocos polígonos,
  // la cuenta pura (`anuncioDeDiana` de `bolillas-arte.ts`) decide qué tiro, el pulso y el reparto de rayas;
  // esta vista solo lo dibuja. Los colores son los del aguayo de la casa.
  const grupoAnuncio = new Group();
  mundo.add(grupoAnuncio);
  const matAnillo = B.add(new MeshBasicMaterial({ color: CHALK[tema], transparent: true, opacity: 0.6, side: DoubleSide, depthWrite: false }));
  const anillo = new Mesh(B.add(new RingGeometry(0.94, 1.06, 40).rotateX(-Math.PI / 2)), matAnillo);
  anillo.renderOrder = 1;
  grupoAnuncio.add(anillo);
  const matsAguayo = AGUAYO.map((c) => B.add(new MeshBasicMaterial({ color: c, transparent: true, opacity: 0.8, side: DoubleSide, depthWrite: false })));
  const geoRaya = B.add(new PlaneGeometry(1, 1).rotateX(-Math.PI / 2));
  const rayas = Array.from({ length: 12 }, () => {
    const raya = new Mesh(geoRaya, matsAguayo[0] as MeshBasicMaterial);
    raya.renderOrder = 2;
    grupoAnuncio.add(raya);
    return raya;
  });
  grupoAnuncio.visible = false;

  // La línea punteada negra del anuncio (S28): del choque a la diana, tramo por tramo. Vive en su propio grupo
  // porque los tramos van en unidades del mundo (el del anillo se mueve y escala con la canica).
  const grupoLinea = new Group();
  mundo.add(grupoLinea);
  // Dos capas como en el 2D: un halo claro más ancho y el tramo negro encima, para que se lea sobre la tierra oscura.
  const matLinea = B.add(new MeshBasicMaterial({ color: 0x14100c, transparent: true, opacity: 0.9, side: DoubleSide, depthWrite: false }));
  const matLineaHalo = B.add(new MeshBasicMaterial({ color: 0xf6f2e8, transparent: true, opacity: 0.5, side: DoubleSide, depthWrite: false }));
  const TRAMOS_MAX = 24;
  const tramos = Array.from({ length: TRAMOS_MAX }, () => {
    const halo = new Mesh(geoRaya, matLineaHalo);
    halo.renderOrder = 2;
    halo.visible = false;
    grupoLinea.add(halo);
    const malla = new Mesh(geoRaya, matLinea);
    malla.renderOrder = 3;
    malla.visible = false;
    grupoLinea.add(malla);
    return { halo, malla };
  });
  grupoLinea.visible = false;

  // El estallido de pelea de los dos choques (S22): la estrella y las líneas, planas en la tierra.
  const estallidos3d = new Estallidos(mundo, geoRaya, B);

  /* ------------------------------------------------------------- el sonido de la casa */
  // El clic de canica contra canica NO suena acá: lo emite el 2D por la voz del kit (`k.sonido`, eventosDe de
  // `bolillas-sonido.ts`, con el eco, el golpe seco de la caída y los ticks del titileo), y el cuadro del 2D corre
  // también cuando esta vista está enchufada. Una sola voz, mudo incluido.

  /* ------------------------------------------------------------- por cuadro */
  let px = 0, pz = 0, K = 1, Kz = 1;
  const puestos = new Map<number, Pun>();
  const polvos = new Set<string>();
  const eje = new Vector3();
  const qTilt = new Quaternion();
  const qRoll = new Quaternion();

  return {
    frame(e) {
      const d = e.plan;
      motor.cuadro({ ...e, cam: camaraBolillas(e.cam, e.w, e.h) }, perfilBolillas(), (mapa, pose) => {
        // La cuenta de la casa fija el lugar del círculo del 2D en el 3D.
        ({ px, pz, K, Kz } = lugarDelMundo(mapa, e.mapeo));
        mundo.position.set(px, 0, pz);
        mundo.scale.set(K, K, Kz);
        if (!d || !d.posiciones.length) {
          mano.visible = false;
          tiradorCanica.grupo.visible = false;
          tiradorCanica.sombra.visible = false;
          destello.visible = false;
          grupoAnuncio.visible = false;
          estallidos3d.actualizar([]);
          polvo.actualizar(e.t);
          chispo.actualizar(e.t);
          return;
        }

        /* -------- las canicas: el plan dice dónde está cada una y qué le pasa */
        for (let slot = 0; slot < d.posiciones.length; slot++) {
          const c = canicaDe(slot, d);
          // El dibujo de la canica (S25), la misma cuenta pura que la 2D: entera mientras juega —adentro de la tiza,
          // con aire para su cuerpo doblado (S20)—, apagándose apenas cruza, y nada después: ni la malla, ni su sombra.
          const dib = dibujoDe(d, slot, e.t);
          if (!dib) {
            c.grupo.visible = false;
            c.sombra.visible = false;
            // Sin lugar no hay ficha: el chip del 2D se apoya en lo que esta vista proyecta.
            puestos.delete(slot);
            continue;
          }
          c.grupo.visible = true;
          c.grupo.position.set(dib.p.x, R_DIBUJO, dib.p.y);
          // El velo de la salida: la que cruza la tiza se apaga en un parpadeo (S25).
          c.velo(dib.velo);
          // La sombra de contacto, apoyada en la tierra junto a su canica (S13) y apagada con ella (S25).
          c.sombra.visible = true;
          c.sombra.position.set(dib.p.x + R_DIBUJO * 0.15, 0.016, dib.p.y - R_DIBUJO * 0.18);
          puestos.set(slot, dib.p);
          // El rodado de la cadena (S21/S23): la del enemigo gira al cruzar la tiza y mi canica gira mientras el
          // empuje la lleva de `choque` a `empuje.hasta`; la que está quieta, no gira. La cuenta es una sola.
          qTilt.identity();
          const rod = rodadoDelTurno(d, slot, e.t);
          if (rod) {
            eje.set(rod.eje.x, 0, rod.eje.y);
            qRoll.setFromAxisAngle(eje, rod.giro);
            qTilt.multiply(qRoll);
          }
          // El titileo de la que gana: vaivén sobre la tiza, cero en los dos bordes (la lección del sapo).
          if (dib.estado === "titila") {
            const radial = unitarioDe({ x: dib.p.x, y: dib.p.y });
            eje.set(radial.y, 0, -radial.x);
            qRoll.setFromAxisAngle(eje, teeterDelCasi(d, e.t));
            qTilt.multiply(qRoll);
          }
          c.grupo.quaternion.copy(qTilt);
        }

        /* -------- los choques: polvo, destello y el clic de la casa */
        let tiroVivo: Tiro | undefined;
        d.tiros.forEach((tiro, i) => {
          // El primer choque de la cadena (S23): la mano toca mi canica. Más suave que el segundo: menos tierra.
          const claveMano = `${i}:mano`;
          if (e.t >= tiro.tMano && !polvos.has(claveMano)) {
            polvos.add(claveMano);
            const dirMano = unitarioDe({ x: tiro.choque.x - tiro.desde.x, y: tiro.choque.y - tiro.desde.y });
            polvo.nuevo(e.t, tiro.choque.x, tiro.choque.y, 0.5);
            chispo.nuevo(e.t, tiro.choque.x, tiro.choque.y, dirMano.x, dirMano.y);
          }
          const claveIda = `${i}:golpe`;
          if (e.t >= tiro.t && !polvos.has(claveIda)) {
            polvos.add(claveIda);
            polvo.nuevo(e.t, tiro.impacto.x, tiro.impacto.y, 0.9 + 0.3 * hash(i, 41));
            chispo.nuevo(e.t, tiro.impacto.x, tiro.impacto.y, tiro.salida.dir.x, tiro.salida.dir.y);
          }
          const claveTiza = `${i}:tiza`;
          if (e.t >= tiro.t + tiro.salida.vuelo && !polvos.has(claveTiza)) {
            polvos.add(claveTiza);
            polvo.nuevo(e.t, tiro.salida.tiza.x, tiro.salida.tiza.y, 0.45);
          }
          if (e.t >= tiro.t && e.t < tiro.t + DESTELLO_VIDA) tiroVivo = tiro;
        });
        if (tiroVivo) {
          // El destello sobre la canica golpeada: sube y se apaga en `DESTELLO_VIDA`, chico y suave (S26).
          const de = destelloDe((e.t - tiroVivo.t) / DESTELLO_VIDA);
          destello.visible = true;
          destello.position.set(tiroVivo.impacto.x, de.alto, tiroVivo.impacto.y);
          destello.scale.setScalar(de.r);
          (destello.material as MeshBasicMaterial).opacity = de.alfa;
        } else destello.visible = false;

        // El roce del casi: la canica que gana derrapa hacia la tiza y levanta un poco de polvo.
        const claveCasi = "casi";
        if (e.t >= d.casi.t && !polvos.has(claveCasi)) {
          polvos.add(claveCasi);
          polvo.nuevo(d.casi.t, d.casi.desde.x, d.casi.desde.y, 0.5);
        }
        polvo.actualizar(e.t);
        chispo.actualizar(e.t);
        // El estallido de pelea (S22): estrella, líneas de velocidad y el temblor, en los dos choques del turno.
        const estallidos = estallidosDe(d, e.t);
        estallidos3d.actualizar(estallidos);

        /* -------- el anuncio de la diana: el anillo con rayas alrededor de la canica que viene */
        const digo = anuncioDeDiana(d, e.t);
        grupoAnuncio.visible = digo != null;
        if (digo) {
          grupoAnuncio.position.set(digo.tiro.impacto.x, 0.012, digo.tiro.impacto.y);
          grupoAnuncio.scale.setScalar(1 + 0.22 * digo.pulso);
          matAnillo.opacity = 0.35 + 0.5 * digo.pulso;
          anillo.scale.setScalar(digo.anillo);
          for (let j = 0; j < rayas.length; j++) {
            const raya = digo.rayas[j] as { a: number; de: number; hasta: number; color: number };
            const malla = rayas[j] as Mesh;
            malla.material = matsAguayo[AGUAYO.indexOf(raya.color as (typeof AGUAYO)[number]) % matsAguayo.length] as MeshBasicMaterial;
            const mid = (raya.de + raya.hasta) / 2;
            malla.position.set(Math.cos(raya.a) * mid, 0.002, Math.sin(raya.a) * mid);
            malla.rotation.y = -raya.a;
            malla.scale.set(raya.hasta - raya.de, 1, CANICA_R * CANICA_ESCALA * 0.3);
          }
          for (const m of matsAguayo) m.opacity = 0.65 + 0.3 * digo.pulso;
          // La línea punteada negra (S28): del choque a la diana, con el pulso del anuncio. Los guiones los da
          // `guionesDe` en el arte puro (parejos y apartados del vidrio de las dos canicas); acá solo se ponen. El ancho
          // de las dos capas es el del 2D, para que la línea se vea igual en los dos motores.
          grupoLinea.visible = true;
          matLinea.opacity = 0.75 + 0.25 * digo.pulso;
          matLineaHalo.opacity = 0.35 + 0.3 * digo.pulso;
          for (let j = 0; j < tramos.length; j++) {
            const par = tramos[j] as { halo: Mesh; malla: Mesh };
            const tramo = digo.linea[j];
            par.halo.visible = tramo != null;
            par.malla.visible = tramo != null;
            if (!tramo) continue;
            const [a, b] = tramo;
            const dx = b.x - a.x;
            const dz = b.y - a.y;
            const largo = Math.hypot(dx, dz);
            const giro = -Math.atan2(dz, dx);
            const medio = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
            par.halo.position.set(medio.x, 0.004, medio.y);
            par.halo.rotation.y = giro;
            par.halo.scale.set(largo, 1, CANICA_R * CANICA_ESCALA * 0.34);
            par.malla.position.set(medio.x, 0.005, medio.y);
            par.malla.rotation.y = giro;
            par.malla.scale.set(largo, 1, CANICA_R * CANICA_ESCALA * 0.2);
          }
        } else {
          grupoLinea.visible = false;
        }

        /* -------- la mano y la canica de la mano */
        let manoViva: Tiro | undefined;
        for (const tiro of d.tiros) {
          if (e.t >= tiro.tMano - TIRADOR - 0.45 && e.t <= tiro.tMano + T_DESVIO + 0.25) {
            manoViva = tiro;
            break;
          }
        }
        mano.visible = manoViva !== undefined;
        if (manoViva) {
          const tiro = manoViva;
          const dir = unitarioDe({ x: tiro.choque.x - tiro.desde.x, y: tiro.choque.y - tiro.desde.y });
          const suelte = tiro.tMano - TIRADOR;
          let atras: number;
          if (e.t < suelte - 0.15) atras = 0.16 - 0.07 * suave((e.t - (suelte - 0.45)) / 0.3);
          else if (e.t < suelte) atras = 0.09 + 0.05 * suave((e.t - (suelte - 0.15)) / 0.15);
          else atras = 0.14 + 0.06 * suave((e.t - suelte) / 0.2);
          const hx = tiro.desde.x - dir.x * atras;
          const hz = tiro.desde.y - dir.y * atras;
          mano.position.set(hx, 0.002, hz);
          mano.rotation.y = Math.atan2(dir.x, dir.y);
          // La canica de la mano: en el agarre hasta el suelte, después el plan la lleva a mi canica (`choque`).
          const enVuelo = poseTiro(tiro, e.t);
          if (enVuelo) {
            tiradorCanica.grupo.visible = true;
            tiradorCanica.grupo.position.set(enVuelo.x, R_TIRADOR, enVuelo.y);
            const tramo = enVuelo.estado === "ida" ? { de: tiro.desde, a: tiro.choque } : { de: tiro.choque, a: tiro.mano.hasta };
            const rodVuelo = rodadoDe(tramo.de, tramo.a, enVuelo.f, R_TIRADOR);
            eje.set(rodVuelo.eje.x, 0, rodVuelo.eje.y);
            qRoll.setFromAxisAngle(eje, rodVuelo.giro);
            tiradorCanica.grupo.quaternion.copy(qRoll);
          } else {
            // En el agarre ñati: bajo la palma, entre los nudillos y el pulgar.
            tiradorCanica.grupo.visible = true;
            tiradorCanica.grupo.position.set(hx + dir.x * 0.05, R_TIRADOR, hz + dir.y * 0.05);
            tiradorCanica.grupo.quaternion.identity();
          }
          tiradorCanica.sombra.visible = true;
          tiradorCanica.sombra.position.set(tiradorCanica.grupo.position.x + 0.01, 0.016, tiradorCanica.grupo.position.z - 0.015);
          puestos.set(-1, { x: tiradorCanica.grupo.position.x, y: tiradorCanica.grupo.position.z });
        } else {
          tiradorCanica.grupo.visible = false;
          tiradorCanica.sombra.visible = false;
          puestos.delete(-1);
        }

        // La toma de cerca de la ganadora (S14): el peso sale del plan (`cercaDe`), la pose sigue a la canica
        // (`poseDelCerca`), y el motor aplica la pose ya mezclada después de este dibujo (la manera de la casa).
        // Cosmética: el ganador y el plan no cambian; la cámara solo lee el casi.
        // La persecución de la ganadora (S24): en el último turno la cámara se mete detrás de su canica y la
        // acompaña hasta el golpe contra la rival. Mismo idioma que la toma de cerca: la pose se mezcla acá y el
        // motor la aplica después de este dibujo.
        const persigue = persecucionDe(d, e.t);
        if (persigue && persigue.peso > 0) {
          Object.assign(pose, mezclarPose(pose, posePersecucion(persigue, { px, pz, K, Kz }), persigue.peso));
        }
        const cerca = cercaDe(d, e.t);
        if (cerca > 0) {
          Object.assign(pose, mezclarPose(pose, poseDelCerca(d, e.t, { px, pz, K, Kz }, e.w / Math.max(1, e.h)), cerca));
        }
        // La micro-sacudida del choque (S22): chica y determinista, encima de la pose que eligió el director
        // (y de la toma de cerca, si está). Es el idioma de la casa para un beat de cámara de esta vista.
        const sac = sacudidaDe(estallidos);
        Object.assign(pose, poseSacudida(pose, sac, K, Kz));
        amb.seguir(pose);
      });
    },

    pantallaDe(id) {
      // La canica del asiento `id` (o la de la pegadora, en -1): su centro en la pantalla y lo que mide de alto.
      const p = puestos.get(id);
      if (!p) return null;
      const c = motor.proyectar(px + K * p.x, K * R_DIBUJO, pz + Kz * p.y);
      const t = motor.proyectar(px + K * p.x, K * R_DIBUJO * 2.2, pz + Kz * p.y);
      return c && t ? { x: c.x, y: c.y, alto: Math.abs(t.y - c.y) * 2 } : null;
    },

    destruir() {
      motor.escena.remove(mundo);
    },
  };
};

export const montaje = definir3D(fabrica);

/** Lo que `registro.ts` busca: el módulo se registra solo por llamarse `bolillas-3d.ts` y exportar esto. */
export const lanzador3D = async (): Promise<Lanzador> => {
  const m = await import("../pixi/bolillas");
  // El enchufe del 2D (patrón guajojo): cuando `bolillasPixi3D` exista, el 3D arranca con el lienzo transparente.
  const con3D = m as typeof m & { bolillasPixi3D?: (tres: Montaje3D<EntradaBolillas>) => Lanzador };
  if (con3D.bolillasPixi3D) {
    const lanza = con3D.bolillasPixi3D(montaje);
    return (nombres, ganadores, baliza, listo) => lanza(nombres, ganadores, baliza, listo);
  }
  // Todavía sin el enchufe (la tarea paralela dueña de pixi/bolillas*): el juego corre en 2D, como siempre.
  return m.bolillasPixi;
};
