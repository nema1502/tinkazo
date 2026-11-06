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
import { cercaDe, anuncioDeDiana, AGUAYO, CANICA_ESCALA } from "../pixi/bolillas-arte";
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

/** Lo que dura el vuelo de la canica de la pegadora antes del impacto (igual que el 2D): cosmética, no el reloj. */
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

/** Dónde está la canica de la pegadora durante su tiro: la ida hasta el impacto y el desvío hasta su freno. */
export interface PoseTiro {
  x: number;
  y: number;
  estado: EstadoTiro;
  /** El avance en el tramo (0 a 1). */
  f: number;
}

/**
 * La pose del tiro en el segundo `t`, puntada por puntada del plan: en la largada está en `desde`, en `tiro.t` está
 * en `impacto`, y al final del desvío queda en `deflexion.hasta`. Fuera de la ventana no hay tiro (null). Sin azar:
 * todo sale de `t` y de los datos del plan.
 */
export function poseTiro(tiro: Tiro, t: number, vuelo = TIRADOR, desvio = T_DESVIO): PoseTiro | null {
  if (t < tiro.t - vuelo || t > tiro.t + desvio) return null;
  if (t <= tiro.t) {
    const f = Math.min(1, Math.max(0, (t - (tiro.t - vuelo)) / vuelo));
    return {
      x: tiro.desde.x + (tiro.impacto.x - tiro.desde.x) * f,
      y: tiro.desde.y + (tiro.impacto.y - tiro.desde.y) * f,
      estado: "ida",
      f,
    };
  }
  const f = Math.min(1, (t - tiro.t) / desvio);
  return {
    x: tiro.impacto.x + (tiro.deflexion.hasta.x - tiro.impacto.x) * f,
    y: tiro.impacto.y + (tiro.deflexion.hasta.y - tiro.impacto.y) * f,
    estado: "desvio",
    f,
  };
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
  const p = trayectoriaDe(d, d.casi.slot, t).p;
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

/* ===================================================================== la paleta */

const PIEL = 0xc68a5c;
const MANGA = 0xe93d9c;
const CHALK: Record<"claro" | "oscuro", number> = { claro: 0xf6f2e8, oscuro: 0xd8d2c4 };
const TIERRA: Record<"claro" | "oscuro", number> = { claro: 0xc9a877, oscuro: 0x4a3624 };
const TIERRA_BARRIDA: Record<"claro" | "oscuro", number> = { claro: 0xbfa070, oscuro: 0x403020 };
const PIEDRA: Record<"claro" | "oscuro", number> = { claro: 0x8a7a64, oscuro: 0x544438 };
const POLVO: Record<"claro" | "oscuro", number> = { claro: 0xd8c09a, oscuro: 0x6a5442 };
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
  const matVidrio = new Map<number, MeshLambertMaterial>();
  const vidrioDe = (color: number): MeshLambertMaterial => {
    let m = matVidrio.get(color);
    if (!m) {
      m = B.add(new MeshLambertMaterial({ color, transparent: true, opacity: 0.55, flatShading: true, depthWrite: false }));
      matVidrio.set(color, m);
    }
    return m;
  };
  const armarCanica = (color: number, esc: number): { grupo: Group; vidrio: Mesh; centro: Mesh; brillo: Mesh; sombra: Mesh } => {
    const grupo = new Group();
    const vidrio = new Mesh(geoVidrio, vidrioDe(color));
    vidrio.scale.setScalar(esc);
    vidrio.renderOrder = 2;
    const centro = new Mesh(geoVidrio, mat.plano(color));
    centro.scale.setScalar(esc * 0.45);
    centro.renderOrder = 1;
    const brillo = new Mesh(geoVidrio, B.add(new MeshBasicMaterial({ color: 0xffffff })));
    brillo.scale.setScalar(esc * 0.2);
    brillo.position.set(-esc * 0.34, esc * 0.42, -esc * 0.28);
    brillo.renderOrder = 3;
    grupo.add(centro, vidrio, brillo);
    grupo.visible = false;
    mundo.add(grupo);
    // La sombra de contacto (S13): un plano chico debajo de la canica, apoyado en la tierra. Va al mundo, no al
    // grupo: la canica rueda (gira su grupo) y la sombra queda plana en el piso, como la de la casa.
    const sombra = new Mesh(geoSombra, matSombra);
    const ss = esc / CANICA_R;
    sombra.scale.set(ss, 1, ss * 0.6);
    sombra.visible = false;
    mundo.add(sombra);
    return { grupo, vidrio, centro, brillo, sombra };
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
  const matSombra = B.add(new MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.24, depthWrite: false }));

  // La canica de la pegadora: un pelo más chica, como en el 2D.
  const tiradorCanica = armarCanica(VIDRIOS[0] as number, R_DIBUJO * 0.85);
  const R_TIRADOR = R_DIBUJO * 0.85;

  // El destello del golpe: un puntito de luz sobre la canica golpeada, una décima de segundo. No es el flash de
  // la cámara: es el vidrio que la devuelve.
  const destello = new Mesh(geoVidrio, B.add(new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false })));
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
          polvo.actualizar(e.t);
          chispo.actualizar(e.t);
          return;
        }

        /* -------- las canicas: el plan dice dónde está cada una y qué le pasa */
        for (let slot = 0; slot < d.posiciones.length; slot++) {
          const c = canicaDe(slot, d);
          const tray = trayectoriaDe(d, slot, e.t);
          c.grupo.visible = true;
          c.grupo.position.set(tray.p.x, R_DIBUJO, tray.p.y);
          puestos.set(slot, tray.p);
          // El rodado: la golpeada rueda lo que el plan dice que vuela; la que está quieta, no gira.
          qTilt.identity();
          const tiro = d.tiros.find((x) => x.slot === slot);
          if (tiro && e.t >= tiro.t) {
            const f = Math.min(1, (e.t - tiro.t) / tiro.salida.vuelo);
            const largo = Math.hypot(tiro.salida.tiza.x - tiro.impacto.x, tiro.salida.tiza.y - tiro.impacto.y);
            eje.set(tiro.salida.dir.y, 0, -tiro.salida.dir.x);
            qRoll.setFromAxisAngle(eje, (f * largo) / R_DIBUJO);
            qTilt.multiply(qRoll);
          }
          // El titileo de la que gana: vaivén sobre la tiza, cero en los dos bordes (la lección del sapo).
          if (tray.estado === "titila") {
            const radial = unitarioDe({ x: tray.p.x, y: tray.p.y });
            eje.set(radial.y, 0, -radial.x);
            qRoll.setFromAxisAngle(eje, teeterDelCasi(d, e.t));
            qTilt.multiply(qRoll);
          }
          c.grupo.quaternion.copy(qTilt);
        }

        /* -------- los choques: polvo, destello y el clic de la casa */
        let tiroVivo: Tiro | undefined;
        d.tiros.forEach((tiro, i) => {
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
          if (e.t >= tiro.t && e.t < tiro.t + 0.2) tiroVivo = tiro;
        });
        if (tiroVivo) {
          // El destello sobre la canica golpeada: sube y apaga en 0,2 s.
          const u = (e.t - tiroVivo.t) / 0.2;
          destello.visible = true;
          destello.position.set(tiroVivo.impacto.x, R_DIBUJO * (1 + 0.4 * Math.sin(Math.PI * u)), tiroVivo.impacto.y);
          destello.scale.setScalar(R_DIBUJO * (1.4 + 1.4 * Math.sin(Math.PI * u)));
          (destello.material as MeshBasicMaterial).opacity = 0.85 * (1 - u);
        } else destello.visible = false;

        // El roce del casi: la canica que gana derrapa hacia la tiza y levanta un poco de polvo.
        const claveCasi = "casi";
        if (e.t >= d.casi.t && !polvos.has(claveCasi)) {
          polvos.add(claveCasi);
          polvo.nuevo(d.casi.t, d.casi.desde.x, d.casi.desde.y, 0.5);
        }
        polvo.actualizar(e.t);
        chispo.actualizar(e.t);

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
        }

        /* -------- la mano y la canica de la pegadora */
        let manoViva: Tiro | undefined;
        for (const tiro of d.tiros) {
          if (e.t >= tiro.t - TIRADOR - 0.45 && e.t <= tiro.t + T_DESVIO + 0.25) {
            manoViva = tiro;
            break;
          }
        }
        mano.visible = manoViva !== undefined;
        if (manoViva) {
          const tiro = manoViva;
          const dir = unitarioDe({ x: tiro.impacto.x - tiro.desde.x, y: tiro.impacto.y - tiro.desde.y });
          const suelte = tiro.t - TIRADOR;
          let atras: number;
          if (e.t < suelte - 0.15) atras = 0.16 - 0.07 * suave((e.t - (suelte - 0.45)) / 0.3);
          else if (e.t < suelte) atras = 0.09 + 0.05 * suave((e.t - (suelte - 0.15)) / 0.15);
          else atras = 0.14 + 0.06 * suave((e.t - suelte) / 0.2);
          const hx = tiro.desde.x - dir.x * atras;
          const hz = tiro.desde.y - dir.y * atras;
          mano.position.set(hx, 0.002, hz);
          mano.rotation.y = Math.atan2(dir.x, dir.y);
          // La canica de la pegadora: en la mano hasta el suelte, después el plan la lleva.
          const enVuelo = poseTiro(tiro, e.t);
          if (enVuelo) {
            tiradorCanica.grupo.visible = true;
            tiradorCanica.grupo.position.set(enVuelo.x, R_TIRADOR, enVuelo.y);
            const tramo = enVuelo.estado === "ida" ? { de: tiro.desde, a: tiro.impacto } : { de: tiro.impacto, a: tiro.deflexion.hasta };
            eje.set(tramo.a.y - tramo.de.y, 0, -(tramo.a.x - tramo.de.x));
            const dist = Math.hypot(tramo.a.x - tramo.de.x, tramo.a.y - tramo.de.y);
            qRoll.setFromAxisAngle(eje, (enVuelo.f * dist) / R_TIRADOR);
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
        const cerca = cercaDe(d, e.t);
        if (cerca > 0) {
          Object.assign(pose, mezclarPose(pose, poseDelCerca(d, e.t, { px, pz, K, Kz }, e.w / Math.max(1, e.h)), cerca));
        }
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
