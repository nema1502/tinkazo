import {
  BoxGeometry, BufferGeometry, CanvasTexture, Color, CylinderGeometry, DoubleSide, Euler, Float32BufferAttribute, Group, IcosahedronGeometry, InstancedMesh,
  Matrix4, Mesh, MeshBasicMaterial, MeshLambertMaterial, PlaneGeometry, Points, PointsMaterial, Quaternion, SphereGeometry, SRGBColorSpace,
  Vector3, type Material,
} from "three";
import { LINES } from "../pixi/cablecar-plan";
import { crearAmbiente, Rafagas, type Ambiente } from "./escena";
import { colorDePersona } from "./figuras";
import { hash, hashTexto } from "./ids";
import { Basura, definir3D, type Motor3D } from "./motor";
import { ALZA, PERFIL_TELEFERICO, alMundo, poseLateral, type FaseCamara } from "./teleferico-mapa";
import type { EntradaBase, Fabrica3D, Lanzador, Pantalla3D } from "./tipos";

/**
 * El Teleférico en 3D, con three.js. Va detrás de `?motor=3d` (docs/motores.md, "3D").
 *
 * No decide ni calcula nada del juego: dibuja lo que la escena 2D (`pixi/cablecar.ts`) ya puso, cuadro a cuadro. El
 * plan (las paradas, los cuatro giros, quién sigue arriba) sale de `cablecar-plan.ts` y llega acá ya resuelto: dónde
 * está cada cabina, cuánto se hamaca, quiénes van adentro, cuánta luz hay, cuánto viento. El 3D nunca recibe quién
 * gana: lo sabe recién cuando el 2D pasa `ganadores` en el golpe. Los nombres, los contadores, el andén, el relator y el
 * cartel siguen siendo de PixiJS, encima y transparentes.
 *
 * La escena es una ladera de La Paz al atardecer, un diorama de papel pintado: el cable sube en diagonal entre torres,
 * debajo la hoyada con sus luces, arriba la cordillera. Todo lo del cable está en un solo plano que la cámara mira de
 * frente (`teleferico-mapa.ts`), así lo que PixiJS pone encima (nombres, andén) cae donde corresponde. La profundidad
 * viene de las capas de atrás, de los volúmenes y de una cámara que se levanta con la lente corrida.
 *
 * Sin azar: lo que se mueve es función de la hora del juego (`t`) y lo que parece azar sale de un hash.
 */

/* ===================================================================== lo que el 2D le pasa */

export interface CabinaE {
  /** Dónde cuelga del cable, en el mundo 2D (píxeles; `y` hacia abajo). */
  x: number;
  y: number;
  /** De 0 a 1: cuando se suelta y se va cable abajo, se desvanece. */
  alpha: number;
  /** Cuánto se hamaca, en radianes, como el 2D (positivo: hacia la derecha de la pantalla). */
  giro: number;
  /** El color de su línea (`#rrggbb` como número). */
  color: number;
  /** Quiénes siguen adentro, por su lugar en la lista. */
  quienes: readonly number[];
  /** Ya no lleva a nadie: se pone gris mientras se va. */
  vacia: boolean;
  /** De 0 a 1: la luz roja del techo cuando la mordaza se suelta. */
  duelo: number;
  /** Cuánto se abrió cada puerta (0 cerrada, 1 abierta): la llegada a la cumbre y el susto. */
  puertaIzq: number;
  puertaDer: number;
  /** De 0 a 1: la persona nombrada se asoma por la puerta (el susto). */
  asoma: number;
}

/** Quien salta (al embarcar o al bajarse), con su lugar en el mundo 2D. */
export interface SaltarinE {
  id: number;
  x: number;
  y: number;
  /** De 0 a 1. */
  a: number;
  /** Ya tocó el andén. */
  aterrizo: boolean;
}

/** La forma del cable para este tamaño de pantalla. */
export interface CableE {
  /** La unidad del mundo del teleférico (`G.k`). */
  k: number;
  /** La dirección del cable (`G.dir`), con la `y` hacia abajo. */
  dx: number;
  dy: number;
  /** Cuánto mide una estación a la otra, en píxeles. */
  span: number;
  /** Cuántas estaciones hay entre la base y la cumbre. */
  ns: number;
  cw: number;
  ch: number;
  gap: number;
}

export interface EntradaTeleferico extends EntradaBase {
  cable: CableE;
  nombres: readonly string[];
  cabinas: readonly CabinaE[];
  saltarines: readonly SaltarinE[];
  /** Cuánta luz hay, de 0 (apagón) a 1. */
  luz: number;
  /** El viento, de 0,2 (la brisa) a 1,2 (la ráfaga). */
  viento: number;
  /** Para qué es el encuadre: de eso depende cuánto se levanta la cámara. */
  fase: FaseCamara;
  /** Segundos desde el golpe: negativo antes de que llegue. */
  golpe: number;
  /** Quiénes ganan. Vacío hasta el golpe: el 3D no lo sabe antes. */
  ganadores: readonly number[];
  /** A quién nombra el relator en la puerta. */
  nombrado: number;
  /** Cuándo se suelta la mordaza y cuándo la agarra (Infinity si no pasa). */
  mordaza: { a: number; b: number };
}

/* ===================================================================== números */

const TEMP = { m: new Matrix4(), m2: new Matrix4(), m3: new Matrix4(), q: new Quaternion(), v: new Vector3(), s: new Vector3(), e: new Euler() };
const EJE_Z = new Vector3(0, 0, 1);

const clamp = (x: number, a: number, b: number): number => Math.max(a, Math.min(b, x));
const lerp = (a: number, b: number, k: number): number => a + (b - a) * k;
const suave = (x: number): number => {
  const c = clamp(x, 0, 1);
  return c * c * (3 - 2 * c);
};

function compon(m: Matrix4, x: number, y: number, z: number, rz: number, sx: number, sy = sx, sz = sx): Matrix4 {
  TEMP.q.setFromAxisAngle(EJE_Z, rz);
  TEMP.v.set(x, y, z);
  TEMP.s.set(sx, sy, sz);
  return m.compose(TEMP.v, TEMP.q, TEMP.s);
}

const INK = 0x16161f;
const TINTA_CLARA = 0x191919;
const CREMA = 0xe8e1d3;
const CREMA_OSCURA = 0xd9d2c4;
const VIDRIO = 0x1d2336;
const AMARILLO = 0xffc629;

/** Cuántas personas se dibujan adentro de una cabina como mucho. */
const MAX_POR_CABINA = 12;
/** Las personas que caben en total: las de las cabinas y las que saltan. */
const MAX_GENTE = 300;

/* ===================================================================== geometrías a mano */

/** Junta geometrías ya movidas a su lugar en una sola, sin índices (el sombreado plano no los necesita). */
function fusionar(partes: { geo: BufferGeometry; m: Matrix4; color?: number }[]): BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  const c = new Color();
  for (const p of partes) {
    const g = p.geo.index ? p.geo.toNonIndexed() : p.geo.clone();
    g.applyMatrix4(p.m);
    const a = g.getAttribute("position");
    if (p.color !== undefined) c.setHex(p.color);
    for (let i = 0; i < a.count; i++) {
      pos.push(a.getX(i), a.getY(i), a.getZ(i));
      if (p.color !== undefined) col.push(c.r, c.g, c.b);
    }
    g.dispose();
  }
  const out = new BufferGeometry();
  out.setAttribute("position", new Float32BufferAttribute(pos, 3));
  if (col.length) out.setAttribute("color", new Float32BufferAttribute(col, 3));
  out.computeVertexNormals();
  return out;
}

const mover = (x: number, y: number, z: number, sx = 1, sy = 1, sz = 1): Matrix4 => new Matrix4().compose(new Vector3(x, y, z), new Quaternion(), new Vector3(sx, sy, sz));

/** Una caja de la cabina: centro y tamaño. */
const caja = (x: number, y: number, z: number, w: number, h: number, d: number): { geo: BufferGeometry; m: Matrix4 } => ({ geo: new BoxGeometry(1, 1, 1), m: mover(x, y, z, w, h, d) });

/** Un cilindro vertical de 8 lados (las puntas redondas de la cabina). */
const columna = (x: number, y: number, z: number, r: number, h: number): { geo: BufferGeometry; m: Matrix4 } => ({ geo: new CylinderGeometry(1, 1, 1, 8, 1), m: mover(x, y, z, r, h, r) });

/** Una caja con las puntas redondas, vista de arriba como un estadio: `w` de punta a punta y `d` de fondo. */
function estadio(y: number, w: number, h: number, d: number): { geo: BufferGeometry; m: Matrix4 }[] {
  const r = d / 2;
  const c = (w - d) / 2;
  return [caja(0, y, 0, Math.max(0.01, w - d), h, d), columna(-c, y, 0, r, h), columna(c, y, 0, r, h)];
}

/**
 * La cabina, en píxeles del dibujo y con el colgador en el origen (la `y` crece hacia arriba, el cuerpo cuelga hacia
 * abajo). Mide lo mismo que la del 2D: `cw` de ancho (104) y `ch` de alto (78) debajo de un colgador de 24.
 */
const CAB = { w: 104, h: 78, colgador: 24, fondo: 64 };

function geometriaCascara(): BufferGeometry {
  const piso = -(CAB.colgador + CAB.h);
  const partes = [
    ...estadio(piso + 7, CAB.w, 14, CAB.fondo),
    ...estadio(-(CAB.colgador + 5) + 0, CAB.w + 6, 10, CAB.fondo + 5),
  ];
  const yP = piso + 14 + (CAB.h - 24) / 2;
  for (const [x, z] of [[-20, 32], [20, 32], [-20, -32], [20, -32], [-51, 0], [51, 0]] as const) partes.push(caja(x, yP, z, 4.5, CAB.h - 24, 4.5));
  return fusionar(partes);
}

function geometriaHerraje(): BufferGeometry {
  return fusionar([
    { geo: new CylinderGeometry(1, 1, 1, 6, 1), m: mover(0, -CAB.colgador / 2, 0, 2.6, CAB.colgador, 2.6) },
    caja(0, 0, 0, 34, 11, 16),
    caja(0, -CAB.colgador + 2, 0, 20, 5, 14),
  ]);
}

function geometriaFondo(): BufferGeometry {
  const piso = -(CAB.colgador + CAB.h);
  const yP = piso + 14 + (CAB.h - 24) / 2;
  return fusionar([caja(0, yP, -27, 92, CAB.h - 24, 3), caja(-47, yP, -12, 3, CAB.h - 24, 36), caja(47, yP, -12, 3, CAB.h - 24, 36)]);
}

/** Una hoja de la puerta: el marco (del color de la línea). */
function geometriaMarco(): BufferGeometry {
  const hh = CAB.h - 24;
  return fusionar([
    caja(-9.2, 0, 0, 2.6, hh, 2.6), caja(9.2, 0, 0, 2.6, hh, 2.6), caja(0, hh / 2 - 1.3, 0, 20, 2.6, 2.6), caja(0, -hh / 2 + 1.3, 0, 20, 2.6, 2.6),
  ]);
}

/* ===================================================================== la gente */

const PIELES = [0xf1c9a5, 0xd9a47c, 0xb67a52, 0x8d5a3a, 0xe8b894, 0xc68a62];
const PELOS = [0x16161f, 0x2b1d14, 0x4a2c1a, 0x6b4a2c, 0x16161f, 0x8a6238];
const PANTALON = 0x2d2a52;

interface PosturaGente {
  /** Los pies, en el sistema de la cabina (o del mundo, si no hay cabina). */
  x: number;
  y: number;
  z: number;
  /** El tamaño: 1 es una persona de 100 píxeles de alto. */
  esc: number;
  /** Inclinación del cuerpo entero sobre los pies, en radianes. */
  inclina: number;
  /** De 0 a 1: los dos brazos arriba. */
  festejo: number;
  /** De 0 a 1: un brazo arriba, saludando. */
  saludo: number;
  /** La hora, para que los brazos se agiten. */
  t: number;
}

/**
 * Todas las personas del teleférico en seis dibujos: cabezas, pelo, ojos, torsos, brazos y piernas, cada parte una
 * malla instanciada. No importa cuánta gente haya: las llamadas de dibujo no crecen.
 */
class Gente {
  private readonly cabezas: InstancedMesh;
  private readonly pelos: InstancedMesh;
  private readonly ojos: InstancedMesh;
  private readonly torsos: InstancedMesh;
  private readonly brazos: InstancedMesh;
  private readonly piernas: InstancedMesh;
  private readonly materiales: MeshLambertMaterial[];
  private n = 0;
  private readonly c = new Color();
  private readonly colores = new Map<number, { camisa: Color; piel: Color; pelo: Color }>();

  constructor(private readonly mundo: Group, basura: Basura, max: number) {
    const mat = (): MeshLambertMaterial => basura.add(new MeshLambertMaterial({ flatShading: true }));
    this.materiales = [mat(), mat(), mat(), mat(), mat(), mat()];
    const [mCab, mPelo, mOjo, mTorso, mBrazo, mPierna] = this.materiales as [MeshLambertMaterial, MeshLambertMaterial, MeshLambertMaterial, MeshLambertMaterial, MeshLambertMaterial, MeshLambertMaterial];
    const esf = basura.add(new SphereGeometry(1, 8, 6));
    const ico = basura.add(new IcosahedronGeometry(1, 0));
    const cub = basura.add(new BoxGeometry(1, 1, 1));
    const mk = (g: BufferGeometry, m: Material, cuantas: number): InstancedMesh => {
      const im = new InstancedMesh(g, m, Math.max(1, cuantas));
      im.count = 0;
      im.frustumCulled = false;
      basura.add({ dispose: () => im.dispose() });
      mundo.add(im);
      return im;
    };
    this.cabezas = mk(esf, mCab, max);
    this.pelos = mk(ico, mPelo, max);
    this.ojos = mk(cub, mOjo, max * 2);
    this.torsos = mk(cub, mTorso, max);
    this.brazos = mk(cub, mBrazo, max * 2);
    this.piernas = mk(cub, mPierna, max);
  }

  inicio(): void {
    this.n = 0;
  }

  private de(id: number, nombre: string): { camisa: Color; piel: Color; pelo: Color } {
    let r = this.colores.get(id);
    if (!r) {
      const h = hashTexto(nombre);
      r = {
        camisa: new Color(colorDePersona(nombre)),
        piel: new Color(PIELES[h % PIELES.length] ?? 0xd9a47c),
        pelo: new Color(PELOS[(h >>> 3) % PELOS.length] ?? INK),
      };
      this.colores.set(id, r);
    }
    return r;
  }

  /** Pone una persona. `base` lleva del sistema de la persona (píxeles, pies en el origen, mirando a +z) al del mundo. */
  poner(base: Matrix4, id: number, nombre: string, p: PosturaGente): void {
    if (this.n >= this.cabezas.instanceMatrix.count) return;
    const i = this.n++;
    const col = this.de(id, nombre);
    const { m, m2 } = TEMP;
    // El cuerpo entero: sus pies, su tamaño, su inclinación.
    const e = p.esc;
    compon(m2, p.x, p.y, p.z, p.inclina, e);
    const cuerpo = TEMP.m3.multiplyMatrices(base, m2);
    const parte = (im: InstancedMesh, idx: number, x: number, y: number, z: number, rz: number, sx: number, sy: number, sz: number, color: Color): void => {
      compon(m, x, y, z, rz, sx, sy, sz);
      im.setMatrixAt(idx, m2.multiplyMatrices(cuerpo, m));
      im.setColorAt(idx, color);
    };
    parte(this.cabezas, i, 0, 90, 0, 0, 10.5, 11, 10, col.piel);
    parte(this.pelos, i, 0, 96, -2.2, 0, 11.4, 8.4, 11.4, col.pelo);
    parte(this.torsos, i, 0, 63, 0, 0, 24, 34, 15, col.camisa);
    parte(this.piernas, i, 0, 23, 0, 0, 17, 46, 11, this.c.setHex(PANTALON));
    // Los ojos: dos puntos de tinta al frente.
    parte(this.ojos, 2 * i, -4.1, 91.5, 9.3, 0, 2.4, 3.2, 2, this.c.setHex(INK));
    parte(this.ojos, 2 * i + 1, 4.1, 91.5, 9.3, 0, 2.4, 3.2, 2, this.c.setHex(INK));
    // Los brazos cuelgan de los hombros; con el festejo suben, con el saludo sube uno solo.
    const ag = Math.sin(p.t * 9 + id) * 0.16;
    const rest = 0.1;
    const arriba = Math.PI * 0.86;
    const izq = -(rest * (1 - p.festejo) + arriba * p.festejo + ag * p.festejo);
    const der = rest * (1 - Math.max(p.festejo, p.saludo)) + arriba * Math.max(p.festejo, p.saludo) + (Math.sin(p.t * 8 + id * 2) * 0.22) * Math.max(p.festejo, p.saludo);
    for (const [k, rz, x] of [[0, izq, -14.5], [1, der, 14.5]] as const) {
      // El brazo gira sobre el hombro: su centro queda a media longitud en la dirección que apunta.
      const long = 30;
      const cx = x + Math.sin(rz) * (long / 2), cy = 75 - Math.cos(rz) * (long / 2);
      parte(this.brazos, 2 * i + k, cx, cy, 0, rz, 6.4, long, 6.4, col.camisa);
    }
  }

  fin(): void {
    const n = this.n;
    for (const im of [this.cabezas, this.pelos, this.torsos, this.piernas]) im.count = n;
    this.ojos.count = n * 2;
    this.brazos.count = n * 2;
    for (const im of [this.cabezas, this.pelos, this.torsos, this.piernas, this.ojos, this.brazos]) {
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
    }
  }

  /** En el apagón las personas siguen viéndose: un poco de luz propia. */
  alumbrar(k: number): void {
    for (const m of this.materiales) m.emissive.setScalar(k);
  }
}

/* ===================================================================== el cielo */

interface Cielo {
  grupo: Group;
  /** Lo acomoda a la ventana de este cuadro (la lente corrida lo desplaza) y le pone el alba y la luz. */
  actualizar(alba: number, luz: number, w: number, h: number, fov: number, corrimiento: { x: number; y: number }): void;
}

/** Una paleta del cielo por tema: arriba, en el medio y en el horizonte. */
const CIELO = {
  oscuro: { arriba: "#0b1230", medio: "#2a1b48", abajo: "#b3553f" },
  claro: { arriba: "#8fd0d8", medio: "#c9e7df", abajo: "#f2b27a" },
} as const;

/**
 * El cielo es un fondo pintado que viaja con la cámara (como el papel pintado de un diorama): un degradé que llena la
 * pantalla, con estrellas de noche. El horizonte se pone dorado con el golpe, y baja con la luz en el apagón.
 */
function crearCielo(motor: Motor3D, estrellas: boolean): Cielo {
  const B = motor.basura;
  const paleta = CIELO[motor.tema];
  const cv = document.createElement("canvas");
  cv.width = 2;
  cv.height = 256;
  const cx = cv.getContext("2d") as CanvasRenderingContext2D;
  const tex = B.add(new CanvasTexture(cv));
  tex.colorSpace = SRGBColorSpace;
  let ultimoAlba = -1;
  const pintar = (alba: number): void => {
    const g = cx.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, paleta.arriba);
    g.addColorStop(0.55, paleta.medio);
    g.addColorStop(1, paleta.abajo);
    cx.fillStyle = g;
    cx.fillRect(0, 0, 2, 256);
    if (alba > 0) {
      const a = cx.createLinearGradient(0, 256, 0, 0);
      a.addColorStop(0, `rgba(255,196,92,${0.95 * alba})`);
      a.addColorStop(0.45, `rgba(255,140,110,${0.5 * alba})`);
      a.addColorStop(1, "rgba(255,120,160,0)");
      cx.fillStyle = a;
      cx.fillRect(0, 0, 2, 256);
    }
    tex.needsUpdate = true;
  };
  pintar(0);
  // El plano cuelga de la cámara, lejos, y se acomoda cada cuadro a la ventana que se ve.
  const grupo = new Group();
  const fondo = 3000;
  const mat = B.add(new MeshBasicMaterial({ map: tex, fog: false, depthWrite: false, depthTest: false }));
  const plano = new Mesh(B.add(new PlaneGeometry(1, 1)), mat);
  plano.renderOrder = -20;
  plano.frustumCulled = false;
  grupo.add(plano);
  let puntos: Points | null = null;
  let matEst: PointsMaterial | null = null;
  if (estrellas) {
    const pos: number[] = [];
    for (let i = 0; i < 110; i++) pos.push((hash(i, 11) - 0.5) * 0.98, 0.5 - hash(i, 12) * 0.5 * 0.92, 0.01);
    const g = B.add(new BufferGeometry());
    g.setAttribute("position", new Float32BufferAttribute(pos, 3));
    matEst = B.add(new PointsMaterial({ color: 0xffffff, size: 5.5, sizeAttenuation: false, transparent: true, opacity: 0.6, depthWrite: false, depthTest: false, fog: false }));
    puntos = new Points(g, matEst);
    puntos.renderOrder = -19;
    puntos.frustumCulled = false;
    grupo.add(puntos);
  }
  return {
    grupo,
    actualizar(alba, luz, w, h, fov, corrimiento) {
      const a = Math.round(alba * 40) / 40;
      if (a !== ultimoAlba) {
        ultimoAlba = a;
        pintar(a);
      }
      const visH = 2 * fondo * Math.tan(fov / 2);
      const f = h / (2 * Math.tan(fov / 2));
      // La ventana de la lente corrida no está centrada en el eje: el plano la sigue.
      grupo.position.set((corrimiento.x / f) * fondo, (-corrimiento.y / f) * fondo, -fondo);
      grupo.scale.set(visH * (w / h) * 1.15, visH * 1.15, 1);
      mat.color.setScalar(0.08 + 0.92 * luz);
      if (matEst) matEst.opacity = 0.6 * (0.2 + 0.8 * luz);
      void puntos;
    },
  };
}

/* ===================================================================== la escena fija */

const CASAS_OSCURO = [0x4a3f5f, 0x5a4a62, 0x6a5560, 0x3f3a58, 0x544b63, 0x62505a];
const CASAS_CLARO = [0xb98a6e, 0xc19a7c, 0xa9806a, 0xd0b295, 0xb3957f, 0xc4a086];

interface Fijos {
  clave: string;
  grupo: Group;
  basura: Basura;
  /** Las posiciones de las estaciones, en el sistema del 3D (píxeles, `y` hacia arriba). */
  estaciones: { x: number; y: number; ancho: number; cumbre: boolean; base: boolean; color: number; mastil: { x: number; y: number } }[];
  luces: { a: Points | null; b: Points | null; ma: PointsMaterial | null; mb: PointsMaterial | null };
}

/** Un reparto de cajas para un solo dibujo. */
class Cajas {
  private readonly dato: { m: Matrix4; color: number }[] = [];
  agregar(x: number, y: number, z: number, w: number, h: number, d: number, color: number, rz = 0): void {
    this.dato.push({ m: compon(new Matrix4(), x, y, z, rz, w, h, d), color });
  }
  construir(basura: Basura, mat: Material): InstancedMesh {
    const im = new InstancedMesh(basura.add(new BoxGeometry(1, 1, 1)), mat, Math.max(1, this.dato.length));
    const c = new Color();
    this.dato.forEach((d, i) => {
      im.setMatrixAt(i, d.m);
      im.setColorAt(i, c.setHex(d.color));
    });
    im.count = this.dato.length;
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.frustumCulled = false;
    basura.add({ dispose: () => im.dispose() });
    return im;
  }
}

/** Un reborde de terreno: la cara de arriba y la de adelante, con colores de vértice. */
function terreno(xs: readonly number[], altura: (x: number) => number, z0: number, z1: number, yBase: number, arriba: number, frente: number, variar = 0.1): BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  const c = new Color();
  const quad = (a: number[], b: number[], cc: number[], d: number[], color: number, k: number): void => {
    c.setHex(color).multiplyScalar(k);
    for (const v of [a, b, cc, a, cc, d]) {
      pos.push(v[0] as number, v[1] as number, v[2] as number);
      col.push(c.r, c.g, c.b);
    }
  };
  for (let i = 0; i < xs.length - 1; i++) {
    const xa = xs[i] as number, xb = xs[i + 1] as number;
    const ya = altura(xa), yb = altura(xb);
    const k = 1 + (hash(i, 31) - 0.5) * variar * 2;
    quad([xa, ya, z0], [xb, yb, z0], [xb, yb, z1], [xa, ya, z1], arriba, k);
    quad([xa, yBase, z0], [xb, yBase, z0], [xb, yb, z0], [xa, ya, z0], frente, k);
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

/** Una cordillera: picos de una cinta vertical, con nieve en los más altos. */
function cordillera(x0: number, x1: number, base: (x: number) => number, alto: number, paso: number, z: number, color: number, nieve: number | null, sem: number): BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  const c = new Color();
  const tri = (a: number[], b: number[], d: number[], color_: number, k = 1): void => {
    c.setHex(color_).multiplyScalar(k);
    for (const v of [a, b, d]) {
      pos.push(v[0] as number, v[1] as number, v[2] as number);
      col.push(c.r, c.g, c.b);
    }
  };
  const picos: { x: number; y: number }[] = [];
  for (let x = x0, i = 0; x <= x1 + paso; x += paso * (0.6 + hash(i, sem) * 0.8), i++) picos.push({ x, y: base(x) + alto * (0.3 + hash(i, sem + 1) * 0.7) });
  for (let i = 0; i < picos.length - 1; i++) {
    const a = picos[i] as { x: number; y: number }, b = picos[i + 1] as { x: number; y: number };
    const piso = Math.min(base(a.x), base(b.x)) - alto * 4;
    const k = 1 + (hash(i, sem + 2) - 0.5) * 0.12;
    tri([a.x, a.y, z], [b.x, b.y, z], [a.x, piso, z], color, k);
    tri([b.x, b.y, z], [b.x, piso, z], [a.x, piso, z], color, k);
    if (nieve !== null && a.y - base(a.x) > alto * 0.72) {
      const w = paso * 0.22;
      tri([a.x - w, a.y - alto * 0.2, z + 1], [a.x, a.y, z + 1], [a.x + w, a.y - alto * 0.2, z + 1], nieve, 1);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

function armarFijos(motor: Motor3D, c: CableE, clave: string): Fijos {
  const basura = new Basura();
  const grupo = new Group();
  const oscuro = motor.tema === "oscuro";
  const k = c.k;
  // La recta del cable en el sistema del 3D (la `y` sube): cada estación a `span` de la anterior.
  const pend = -c.dy / c.dx;
  const sx = c.dx * c.span, sy = -c.dy * c.span;
  const pos = (s: number): { x: number; y: number } => ({ x: sx * s, y: sy * s });
  const Yc = (x: number): number => x * pend;
  const NS = c.ns;
  const x0 = pos(-4).x, x1 = pos(NS + 5).x;
  const cajas = new Cajas();
  const matLambert = basura.add(new MeshLambertMaterial({ flatShading: true }));
  const casas = oscuro ? CASAS_OSCURO : CASAS_CLARO;

  /* ---- el suelo, con los valles bajo cada vano: las estaciones en lo alto y las torres en el fondo */
  const valle = Math.min(380 * k, 0.5 * c.span);
  const limpio = (x: number): number => {
    // 0 junto a una estación y 1 entre dos: así las estaciones quedan firmes y no flotan.
    const f = x / sx;
    const d = Math.abs(f - Math.round(f));
    return suave(d / 0.16);
  };
  const suelo = (x: number): number => {
    const f = x / sx;
    const v = Math.sin(Math.PI * f) ** 2;
    const bache = (hash(Math.floor(x / (46 * k)), 5) - 0.5) * 34 * k;
    return Yc(x) - 122 * k - v * valle * (0.55 + 0.45 * hash(Math.floor(f), 7)) + bache * limpio(x);
  };
  const xs: number[] = [];
  for (let x = x0; x <= x1; x += 46 * k) xs.push(x);
  const cTop = oscuro ? 0x4a4260 : 0xc8a98a, cFrente = oscuro ? 0x2f2a45 : 0xa88b72;
  const ladera = new Mesh(basura.add(terreno(xs, suelo, 40 * k, -150 * k, Yc(0) - 4000 * k, cTop, cFrente, 0.12)), basura.add(new MeshLambertMaterial({ vertexColors: true, flatShading: true, side: DoubleSide })));
  ladera.frustumCulled = false;
  grupo.add(ladera);

  // Las casas de la hoyada, sueltas sobre el suelo, lejos de las estaciones y del paso de las cabinas.
  const nCasas = Math.round((x1 - x0) / (84 * k));
  for (let i = 0; i < nCasas; i++) {
    const x = x0 + hash(i, 41) * (x1 - x0);
    const f = x / sx;
    const v = Math.sin(Math.PI * f) ** 2;
    if (v < 0.35) continue;
    // Ni encima de una torre.
    if (Math.abs(x - pos(Math.floor(f) + 0.5).x) < 70 * k) continue;
    const z = -150 * k + hash(i, 43) * 180 * k;
    const w = (22 + hash(i, 44) * 26) * k, h = (16 + hash(i, 45) * 30) * k, d = (20 + hash(i, 46) * 22) * k;
    cajas.agregar(x, suelo(x) + h / 2 - 2 * k, z, w, h, d, casas[Math.floor(hash(i, 47) * casas.length)] as number);
  }

  /* ---- las colinas del fondo y la cordillera, todas paralelas al cable */
  const ondulada = (x: number, sem: number): number => 0.55 + 0.45 * Math.sin(x / (700 * k) + sem) * Math.cos(x / (1300 * k) + sem * 2);
  const perfil1 = (x: number): number => Yc(x) - 120 * k + 160 * k * ondulada(x, 1);
  const perfil2 = (x: number): number => Yc(x) + 140 * k + 260 * k * ondulada(x, 4);
  const colina = (z: number, perfil: (x: number) => number, color: number, frente: number): Mesh => {
    const xsC: number[] = [];
    for (let x = x0 - 6000 * k; x <= x1 + 6000 * k; x += 90 * k * (1 + Math.abs(z) / (2400 * k))) xsC.push(x);
    const m = new Mesh(basura.add(terreno(xsC, perfil, z, z - 260 * k, Yc(0) - 6000 * k, color, frente, 0.08)), basura.add(new MeshLambertMaterial({ vertexColors: true, flatShading: true, side: DoubleSide })));
    m.frustumCulled = false;
    return m;
  };
  grupo.add(colina(-700 * k, perfil1, oscuro ? 0x3a3566 : 0xb9a7c9, oscuro ? 0x2d2a52 : 0x9d8fb3));
  grupo.add(colina(-1500 * k, perfil2, oscuro ? 0x332f5c : 0xa99bbf, oscuro ? 0x27244a : 0x8f82a6));
  // Casas sobre las colinas del medio, más chicas y más juntas.
  const nMed = Math.round((x1 - x0) / (120 * k));
  for (let i = 0; i < nMed; i++) {
    const x = x0 - 2000 * k + hash(i, 51) * (x1 - x0 + 4000 * k);
    const z = -(780 + hash(i, 53) * 160) * k;
    const alto = (60 + hash(i, 54) * 90) * k;
    const yb = perfil1(x) - 14 * k;
    cajas.agregar(x, yb + alto / 2 - 8 * k, z, (50 + hash(i, 55) * 60) * k, alto, (40 + hash(i, 56) * 40) * k, casas[Math.floor(hash(i, 57) * casas.length)] as number);
  }
  const cord1 = new Mesh(
    basura.add(cordillera(x0 - 9000 * k, x1 + 9000 * k, (x) => Yc(x) + 900 * k, 700 * k, 520 * k, -5200 * k, oscuro ? 0x3b3563 : 0xb9a7c9, 0xe8e4f4, 61)),
    basura.add(new MeshLambertMaterial({ vertexColors: true, flatShading: true, side: DoubleSide })),
  );
  cord1.frustumCulled = false;
  grupo.add(cord1);
  const cord2 = new Mesh(
    basura.add(cordillera(x0 - 9000 * k, x1 + 9000 * k, (x) => Yc(x) + 560 * k, 560 * k, 760 * k, -7600 * k, oscuro ? 0x2d2a52 : 0x9d8fb3, null, 71)),
    basura.add(new MeshLambertMaterial({ vertexColors: true, flatShading: true, side: DoubleSide })),
  );
  cord2.frustumCulled = false;
  grupo.add(cord2);

  /* ---- las torres: una por vano, detrás del plano del cable */
  const pilones: Matrix4[] = [];
  for (let i = 0; i <= NS; i++) {
    const p = pos(i + 0.5);
    const base = suelo(p.x) - 12 * k;
    const alto = p.y - 8 * k - base;
    // Una pirámide chata de cuatro lados: ancha abajo, angosta arriba.
    pilones.push(compon(new Matrix4(), p.x, base + alto / 2, -50 * k, 0, 24 * k, alto, 18 * k));
    cajas.agregar(p.x, p.y - 2 * k, -50 * k, 58 * k, 10 * k, 16 * k, TINTA_CLARA);
    // Los rodillos que sostienen el cable, hacia el plano de las cabinas.
    cajas.agregar(p.x - 18 * k, p.y + 3 * k, -22 * k, 9 * k, 9 * k, 56 * k, TINTA_CLARA);
    cajas.agregar(p.x + 18 * k, p.y + 3 * k, -22 * k, 9 * k, 9 * k, 56 * k, TINTA_CLARA);
  }
  const pil = new InstancedMesh(
    basura.add(new CylinderGeometry(0.34, 1, 1, 4, 1).rotateY(Math.PI / 4)),
    basura.add(new MeshLambertMaterial({ color: oscuro ? 0x2b2640 : 0x3a3450, flatShading: true })),
    Math.max(1, pilones.length),
  );
  pilones.forEach((m, i) => pil.setMatrixAt(i, m));
  pil.count = pilones.length;
  pil.frustumCulled = false;
  basura.add({ dispose: () => pil.dispose() });
  grupo.add(pil);

  /* ---- el cable: dos cuerdas finas de punta a punta */
  const a = pos(-1.5), b = pos(NS + 2.5);
  const largo = Math.hypot(b.x - a.x, b.y - a.y), ang = Math.atan2(b.y - a.y, b.x - a.x) - Math.PI / 2;
  const cables = new InstancedMesh(basura.add(new CylinderGeometry(1, 1, 1, 5, 1)), basura.add(new MeshLambertMaterial({ color: oscuro ? 0x0d0b16 : TINTA_CLARA, flatShading: true })), 2);
  cables.setMatrixAt(0, compon(new Matrix4(), (a.x + b.x) / 2, (a.y + b.y) / 2, 0, ang, 2.4 * k, largo, 2.4 * k));
  cables.setMatrixAt(1, compon(new Matrix4(), (a.x + b.x) / 2, (a.y + b.y) / 2 - 14 * k, -22 * k, ang, 2 * k, largo, 2 * k));
  cables.frustumCulled = false;
  basura.add({ dispose: () => cables.dispose() });
  grupo.add(cables);

  /* ---- las estaciones */
  const estaciones: Fijos["estaciones"] = [];
  for (let s = 0; s <= NS + 1; s++) {
    const p = pos(s);
    const cumbre = s === NS + 1, base = s === 0;
    const ancho = (cumbre ? 230 : base ? 210 : 160) * k;
    const color = cumbre ? AMARILLO : Number.parseInt((LINES[(s + 2) % LINES.length] as string).slice(1), 16);
    const sueloS = p.y - 120 * k;
    // El cuerpo, detrás del plano de las cabinas.
    cajas.agregar(p.x, p.y - 40 * k, -69 * k, ancho, 160 * k, 62 * k, oscuro ? CREMA_OSCURA : CREMA);
    cajas.agregar(p.x, p.y + 44 * k, -69 * k, ancho + 10 * k, 8 * k, 70 * k, TINTA_CLARA);
    cajas.agregar(p.x, p.y + 32 * k, -36 * k, ancho, 16 * k, 4 * k, color);
    // La ventana grande de la estación, oscura, y el zócalo.
    cajas.agregar(p.x, p.y - 38 * k, -37.5 * k, ancho - 28 * k, 102 * k, 2 * k, oscuro ? 0x2b2640 : 0x3a3450);
    cajas.agregar(p.x, sueloS - 3 * k, -69 * k, ancho + 20 * k, 10 * k, 66 * k, TINTA_CLARA);
    // El mástil de su bandera, sobre la esquina izquierda del techo.
    const mx = p.x - ancho / 2 + 14 * k;
    cajas.agregar(mx, p.y + 40 * k + 68 * k, -69 * k, 4 * k, 136 * k, 4 * k, TINTA_CLARA);
    // El andén de la derecha, a la altura del piso de la cabina.
    cajas.agregar(p.x + (56 * k + ancho / 2) / 2 + 2 * k, p.y - (CAB.colgador + CAB.h - 14) * k - 12 * k, -2 * k, ancho / 2 - 56 * k + 4 * k, 22 * k, 72 * k, oscuro ? 0x6a6478 : 0xb9b1a2);
    if (base) cajas.agregar(p.x - (56 * k + ancho / 2) / 2 - 2 * k, p.y - (CAB.colgador + CAB.h - 14) * k - 12 * k, -2 * k, ancho / 2 - 56 * k + 4 * k, 22 * k, 72 * k, oscuro ? 0x6a6478 : 0xb9b1a2);
    estaciones.push({ x: p.x, y: p.y, ancho, cumbre, base, color, mastil: { x: mx, y: p.y + 40 * k + 134 * k } });
  }

  const malla = cajas.construir(basura, matLambert);
  grupo.add(malla);

  /* ---- las luces de la ciudad en la hoyada (de noche) */
  const luces: Fijos["luces"] = { a: null, b: null, ma: null, mb: null };
  if (oscuro) {
    const mk = (par: number): { p: Points; m: PointsMaterial } => {
      const v: number[] = [];
      const cols: number[] = [];
      const cc = new Color();
      const n = Math.round((x1 - x0) / (14 * k));
      for (let i = par; i < n; i += 2) {
        const x = x0 + hash(i, 81) * (x1 - x0);
        const capa = hash(i, 82);
        let y: number, z: number;
        if (capa < 0.3) {
          // Sobre el suelo de la hoyada.
          z = (30 - hash(i, 85) * 170) * k;
          y = suelo(x) + 3 * k;
        } else if (capa < 0.6) {
          // En la barranca de adelante.
          z = 41 * k;
          y = suelo(x) - (6 + hash(i, 83) * 150) * k;
        } else if (capa < 0.85) {
          z = -699 * k;
          y = perfil1(x) - (6 + hash(i, 83) * 150) * k;
        } else {
          z = -1499 * k;
          y = perfil2(x) - (10 + hash(i, 83) * 240) * k;
        }
        v.push(x, y, z);
        cc.setHex(hash(i, 84) > 0.5 ? 0xffd38a : 0xffb35c);
        cols.push(cc.r, cc.g, cc.b);
      }
      const g = basura.add(new BufferGeometry());
      g.setAttribute("position", new Float32BufferAttribute(v, 3));
      g.setAttribute("color", new Float32BufferAttribute(cols, 3));
      const m = basura.add(new PointsMaterial({ size: 3.2, sizeAttenuation: false, vertexColors: true, transparent: true, depthWrite: false, fog: false }));
      const p = new Points(g, m);
      p.frustumCulled = false;
      return { p, m };
    };
    const A = mk(0), B = mk(1);
    luces.a = A.p;
    luces.b = B.p;
    luces.ma = A.m;
    luces.mb = B.m;
    grupo.add(A.p, B.p);
  }

  return { clave, grupo, basura, estaciones, luces };
}

/* ===================================================================== las banderas */

/**
 * Las banderas de las estaciones y los banderines de la cumbre: una sola malla, con los vértices movidos cada cuadro
 * por la hora y el viento (como en el 2D: ondulan hacia la izquierda y con la ráfaga se estiran).
 */
class Banderas {
  private readonly geo: BufferGeometry;
  private readonly pos: Float32Array;
  readonly malla: Mesh;
  private readonly max: number;
  private n = 0;

  constructor(private readonly motor: Motor3D, private readonly f: Fijos, private readonly c: CableE) {
    const NSEG = 6;
    this.max = (f.estaciones.length * NSEG * 2 + 11) * 3 * 3 + 12 * 3;
    this.pos = new Float32Array(this.max * 3);
    const col = new Float32Array(this.max * 3);
    const cc = new Color();
    let v = 0;
    const pon = (color: number): void => {
      cc.setHex(color);
      col[v * 3] = cc.r;
      col[v * 3 + 1] = cc.g;
      col[v * 3 + 2] = cc.b;
      v++;
    };
    for (const e of f.estaciones) for (let i = 0; i < NSEG * 6; i++) pon(e.color);
    const cumbre = f.estaciones[f.estaciones.length - 1];
    if (cumbre) for (let i = 0; i < 11; i++) for (let j = 0; j < 3; j++) pon(Number.parseInt((LINES[i % LINES.length] as string).slice(1), 16));
    this.n = v;
    this.geo = motor.basura.add(new BufferGeometry());
    this.geo.setAttribute("position", new Float32BufferAttribute(this.pos.subarray(0, v * 3), 3));
    this.geo.setAttribute("color", new Float32BufferAttribute(col.subarray(0, v * 3), 3));
    this.geo.setDrawRange(0, v);
    this.malla = new Mesh(this.geo, motor.basura.add(new MeshLambertMaterial({ vertexColors: true, flatShading: true, side: DoubleSide })));
    this.malla.frustumCulled = false;
    this.actualizar(0, 0.2, 0);
  }

  actualizar(t: number, viento: number, fiesta: number): void {
    const { f, c } = this;
    const k = c.k;
    const a = this.geo.getAttribute("position") as Float32BufferAttribute;
    const arr = a.array as Float32Array;
    let i = 0;
    const v = (x: number, y: number, z: number): void => {
      arr[i++] = x;
      arr[i++] = y;
      arr[i++] = z;
    };
    const NSEG = 6;
    f.estaciones.forEach((e, s) => {
      const w = 88 * k, h = 46 * k;
      const len = w * (0.82 + 0.22 * viento), amp = h * (0.1 + 0.34 * viento);
      const ph = t * (3.4 + viento * 8) + s * 1.9;
      const onda = (q: number): number => Math.sin(ph - q * 4) * amp * q;
      for (let j = 0; j < NSEG; j++) {
        const q0 = j / NSEG, q1 = (j + 1) / NSEG;
        const x0 = e.mastil.x - q0 * len, x1 = e.mastil.x - q1 * len;
        const z0 = -69 * k + onda(q0) * 0.55, z1 = -69 * k + onda(q1) * 0.55;
        const yA0 = e.mastil.y - onda(q0) * 0.7, yA1 = e.mastil.y - onda(q1) * 0.7;
        const yB0 = yA0 - h, yB1 = yA1 - h * 1.05;
        v(x0, yA0, z0); v(x1, yA1, z1); v(x0, yB0, z0);
        v(x1, yA1, z1); v(x1, yB1, z1); v(x0, yB0, z0);
      }
    });
    const cum = f.estaciones[f.estaciones.length - 1];
    if (cum) {
      const x0 = cum.x - cum.ancho / 2, x1 = cum.x + cum.ancho / 2;
      const sag = 28 * k;
      const y0 = cum.y + 36 * k;
      const en = (q: number): { x: number; y: number } => ({ x: x0 + (x1 - x0) * q, y: y0 - sag * 4 * q * (1 - q) });
      for (let n = 0; n < 11; n++) {
        const p = en((n + 0.5) / 11);
        const sw = Math.sin(t * (3 + viento * 6) + n * 1.3) * (0.12 + viento * 0.3 + fiesta * 0.5);
        const half = ((x1 - x0) / 11) * 0.42, len = 22 * k;
        const co = Math.cos(sw), si = Math.sin(sw);
        const r = (px: number, py: number): [number, number] => [p.x + px * co - py * si, p.y - (px * si + py * co)];
        const A = r(-half, 0), B = r(half, 0), C = r(0, len);
        v(A[0], A[1], -35 * k); v(B[0], B[1], -35 * k); v(C[0], C[1], -35 * k);
      }
    }
    a.needsUpdate = true;
    void this.n;
  }
}

/* ===================================================================== la vista */

/** Cuánto sube la cámara en cada fase y a qué ritmo se acomoda (por segundo). */
const RITMO_ALZA = 2.2;

const fabrica: Fabrica3D<EntradaTeleferico> = (motor, o) => {
  const oscuro = motor.tema === "oscuro";
  const amb: Ambiente = crearAmbiente(motor, { nieblaCerca: 56, nieblaLejos: 340, solDesde: oscuro ? [-90, 40, 80] : [-70, 70, 80] });
  amb.cielo.visible = false;
  // La luz de cada tema: de atardecer en los dos, más baja y cálida en el oscuro.
  const hemi = motor.escena.children.find((x) => (x as { isHemisphereLight?: boolean }).isHemisphereLight) as unknown as { color: Color; groundColor: Color; intensity: number } | undefined;
  if (hemi) {
    hemi.color.setHex(oscuro ? 0xb9a6e0 : 0xfff1dc);
    hemi.groundColor.setHex(oscuro ? 0x6a4a50 : 0xc9a88a);
    hemi.intensity = oscuro ? 1.25 : 1.4;
  }
  amb.sol.color.setHex(oscuro ? 0xffc89a : 0xffe3bf);
  amb.sol.intensity = oscuro ? 1.9 : 1.6;
  const luzSol = amb.sol.intensity;
  const luzHemi = hemi?.intensity ?? 1.3;
  const cielo = crearCielo(motor, oscuro);
  motor.camara.add(cielo.grupo);
  motor.escena.add(motor.camara);

  const mundo = new Group();
  motor.escena.add(mundo);

  const basura = motor.basura;
  const matCascara = basura.add(new MeshLambertMaterial({ flatShading: true }));
  const matHerraje = basura.add(new MeshLambertMaterial({ color: TINTA_CLARA, flatShading: true }));
  const matFondo = basura.add(new MeshLambertMaterial({ color: VIDRIO, flatShading: true }));
  const matMarco = basura.add(new MeshLambertMaterial({ flatShading: true }));
  const matVidrio = basura.add(new MeshBasicMaterial({ color: 0x9fb4d8, transparent: true, opacity: 0.18, depthWrite: false, side: DoubleSide }));
  const matLampara = basura.add(new MeshBasicMaterial({ color: 0xff3b30, fog: false }));
  const MAX_CAB = 10;
  const mk = (g: BufferGeometry, m: Material, n: number): InstancedMesh => {
    const im = new InstancedMesh(basura.add(g), m, n);
    im.count = 0;
    im.frustumCulled = false;
    basura.add({ dispose: () => im.dispose() });
    mundo.add(im);
    return im;
  };
  const cascara = mk(geometriaCascara(), matCascara, MAX_CAB);
  const herraje = mk(geometriaHerraje(), matHerraje, MAX_CAB);
  const fondo = mk(geometriaFondo(), matFondo, MAX_CAB);
  const marcos = mk(geometriaMarco(), matMarco, MAX_CAB * 2);
  const vidrios = mk(new PlaneGeometry(20, CAB.h - 24), matVidrio, MAX_CAB * 2);
  const lamparas = mk(new SphereGeometry(1, 8, 6), matLampara, MAX_CAB);
  const gente = new Gente(mundo, basura, MAX_GENTE);
  const polvo = new Rafagas(motor, { max: 10, porRafaga: 6, color: oscuro ? 0xcbbfae : 0xb9a58a, tam: 0.7, vida: 0.7, gravedad: 4, velocidad: 2.4, empujeArriba: 1.1 });
  const chispas = new Rafagas(motor, { max: 8, porRafaga: 5, color: 0xffd24d, tam: 0.5, vida: 0.5, gravedad: 9, velocidad: 4, empujeArriba: 2 });

  let fijos: Fijos | null = null;
  let banderas: Banderas | null = null;
  let alza = Number.NaN;
  let ultimaT = -1;
  const posiciones = new Map<number, [number, number, number]>();
  const yaCayo = new Set<number>();
  let ultimoGolpe = -1;
  let ultimoChispa = -1;
  let agarro = false;

  const reponer = (e: EntradaTeleferico): void => {
    const c = e.cable;
    const clave = `${Math.round(c.span)}|${Math.round(c.k * 100)}|${c.ns}|${Math.round(c.dy * 1000)}`;
    if (fijos && fijos.clave === clave) return;
    if (fijos) {
      mundo.remove(fijos.grupo);
      fijos.basura.vaciar();
    }
    if (banderas) {
      mundo.remove(banderas.malla);
    }
    fijos = armarFijos(motor, c, clave);
    mundo.add(fijos.grupo);
    banderas = new Banderas(motor, fijos, c);
    mundo.add(banderas.malla);
  };

  const luzDe = (luz: number): void => {
    const f = 0.1 + 0.9 * luz;
    amb.sol.intensity = luzSol * f;
    if (hemi) hemi.intensity = luzHemi * f;
    if (motor.escena.fog) (motor.escena.fog as { color: Color }).color.setHex(oscuro ? 0xb3553f : 0xf2b27a).multiplyScalar(0.12 + 0.88 * luz);
    const extra = (1 - luz) * 0.5;
    matCascara.emissive.setScalar(extra * 0.6);
    matFondo.emissive.setScalar(extra * 0.5);
    matMarco.emissive.setScalar(extra * 0.5);
    gente.alumbrar(extra * 0.55);
  };

  return {
    frame(e) {
      motor.cuadro(e, PERFIL_TELEFERICO, (mapa, pose) => {
        const s = mapa.s;
        reponer(e);
        const fj = fijos as Fijos;
        mundo.scale.setScalar(s);
        // La niebla se mide en píxeles del dibujo: así cerca de la cámara no hay y la cordillera queda en la bruma.
        if (motor.escena.fog) {
          const fg = motor.escena.fog as unknown as { near: number; far: number };
          fg.near = 1900 * s;
          fg.far = 10500 * s;
        }

        /* ---- la cámara: la del director, levantada con la lente corrida */
        const dt = ultimaT < 0 ? 0 : clamp(e.t - ultimaT, 0, 0.25);
        ultimaT = e.t;
        const meta = ALZA[e.fase];
        alza = Number.isNaN(alza) ? meta : lerp(alza, meta, 1 - Math.exp(-dt * RITMO_ALZA));
        const p = poseLateral(e.cam, e.h, e.u, alza, pose.fov);
        pose.pos = p.pos;
        pose.mira = p.mira;
        motor.camara.setViewOffset(e.w, e.h, p.corrimiento.x, p.corrimiento.y, e.w, e.h);

        /* ---- el mundo: cielo, luces, luces de la ciudad */
        const alba = e.golpe > 0 ? 0.6 * (1 - (1 - clamp(e.golpe / 1.2, 0, 1)) ** 3) : 0;
        cielo.actualizar(alba, e.luz, e.w, e.h, p.fov, p.corrimiento);
        luzDe(e.luz);
        amb.seguir(pose);
        amb.sol.castShadow = false;
        if (fj.luces.ma && fj.luces.mb) {
          fj.luces.ma.opacity = (0.55 + 0.35 * Math.sin(e.t * 2)) * (0.06 + 0.94 * e.luz);
          fj.luces.mb.opacity = (0.55 + 0.35 * Math.sin(e.t * 2 + 2.2)) * (0.06 + 0.94 * e.luz);
        }
        const fiesta = Math.max(e.golpe > 0 ? Math.exp(-e.golpe * 0.9) : 0, 0);
        banderas?.actualizar(e.t, e.viento, fiesta);

        /* ---- las cabinas y su gente */
        const k = e.cable.k;
        gente.inicio();
        posiciones.clear();
        let nc = 0, nm = 0;
        const topeGente = motor.ajustes.nivel === "baja" ? 8 : MAX_POR_CABINA;
        const cabinaGanadora = e.ganadores.length ? e.cabinas.findIndex((cb) => e.ganadores.some((g) => cb.quienes.includes(g))) : -1;
        e.cabinas.forEach((cb, idx) => {
          if (cb.alpha <= 0 || nc >= MAX_CAB) return;
          const w = alMundo(mapa, cb.x, cb.y);
          const sc = k * (0.45 + 0.55 * clamp(cb.alpha, 0, 1));
          // La cabina entera cuelga del cable y gira sobre el colgador: el 2D gira hacia la derecha de la pantalla.
          const Mc = compon(new Matrix4(), w[0] / s, w[1] / s, 0, -cb.giro, sc);
          cascara.setMatrixAt(nc, Mc);
          herraje.setMatrixAt(nc, Mc);
          fondo.setMatrixAt(nc, Mc);
          cascara.setColorAt(nc, TEMPC.setHex(cb.vacia ? 0x77727f : cb.color).multiplyScalar(0.9));
          // Las dos hojas de la puerta: cerradas en el medio, abiertas hacia los costados.
          for (const [lado, abierta] of [[-1, cb.puertaIzq], [1, cb.puertaDer]] as const) {
            const x = lado * (10 + 30 * clamp(abierta, 0, 1));
            const z = 33.5 + (abierta > 0.02 ? 1.2 : 0);
            const yP = -(CAB.colgador + CAB.h - 14) + (CAB.h - 24) / 2;
            const Md = TEMP.m2.multiplyMatrices(Mc, compon(TEMP.m, x, yP, z, 0, 1));
            marcos.setMatrixAt(nm, Md);
            marcos.setColorAt(nm, TEMPC.setHex(cb.vacia ? 0x77727f : cb.color).multiplyScalar(0.9));
            vidrios.setMatrixAt(nm, Md);
            nm++;
          }
          // La luz roja del techo: el resbalón de la mordaza, o la de emergencia del apagón.
          const emergencia = e.luz < 1 && Math.sin(e.t * 6 + idx * 1.9) > -0.3 ? 1 - e.luz : 0;
          const r = Math.max(cb.duelo > 0.02 ? 0.8 + 0.2 * cb.duelo : 0, emergencia);
          lamparas.setMatrixAt(nc, TEMP.m2.multiplyMatrices(Mc, compon(TEMP.m, 0, -CAB.colgador + 3, 0, 0, 7 * r + 0.001, 5 * r + 0.001, 7 * r + 0.001)));
          // Las personas, de pie en dos filas, de frente a la sala.
          const m = Math.min(cb.quienes.length, topeGente);
          const filas = m <= 2 ? 1 : 2;
          const esc = m <= 2 ? 0.56 : m <= 6 ? 0.5 : 0.46;
          for (let j = 0; j < m; j++) {
            const id = cb.quienes[j] as number;
            const fila = filas === 1 ? 0 : j % 2;
            const enFila = filas === 1 ? m : Math.ceil((m - fila) / 2);
            const col = filas === 1 ? j : (j - fila) / 2;
            const ancho = m <= 2 ? 30 : 72;
            let x = enFila === 1 ? 0 : -ancho / 2 + (col * ancho) / (enFila - 1) + (fila ? ancho / (2 * Math.max(1, enFila - 1)) * 0.5 : 0);
            x += (hash(id, 3) - 0.5) * 3;
            const y = -(CAB.colgador + CAB.h - 14) + (fila ? 3.5 : 0);
            const z = filas === 1 ? 4 : fila ? -13 : 10;
            let festejo = 0, saludo = 0, inclina = 0, salto = 0;
            let xx = x;
            if (e.ganadores.includes(id) && e.golpe > 0) {
              const f = suave(e.golpe / 0.4);
              festejo = f;
              xx = lerp(x, 30, f);
              salto = Math.abs(Math.sin(e.golpe * 6.5)) * 9 * f * Math.exp(-e.golpe * 0.35);
            } else if (idx === cabinaGanadora && e.golpe > 0) {
              saludo = suave(e.golpe / 0.6);
              xx = lerp(x, -22, saludo);
            }
            if (id === e.nombrado && cb.asoma > 0.01) {
              xx = lerp(x, 40, cb.asoma);
              inclina = -cb.asoma * 0.3;
              saludo = Math.max(saludo, cb.asoma * 0.8);
            }
            gente.poner(Mc, id, e.nombres[id] ?? "", { x: xx, y: y + salto, z, esc: esc * (0.96 + 0.08 * hash(id, 9)), inclina, festejo, saludo, t: e.t });
            posiciones.set(id, [w[0], w[1] + 1.3 * s, 0]);
          }
          nc++;
        });
        // Cabinas que no se dibujan este cuadro.
        for (const im of [cascara, herraje, fondo, lamparas]) im.count = nc;
        marcos.count = nm;
        vidrios.count = nm;
        for (const im of [cascara, herraje, fondo, marcos, vidrios, lamparas]) {
          im.instanceMatrix.needsUpdate = true;
          if (im.instanceColor) im.instanceColor.needsUpdate = true;
        }

        /* ---- los que saltan (al embarcar o al bajarse) */
        for (const sa of e.saltarines) {
          const w = alMundo(mapa, sa.x, sa.y);
          const base = compon(TEMP.m3, w[0] / s, w[1] / s - 44 * k * 0.4, 8 * k, 0, 1);
          gente.poner(base, sa.id, e.nombres[sa.id] ?? "", { x: 0, y: 0, z: 0, esc: 0.34 * k, inclina: 0, festejo: 0.9, saludo: 0, t: e.t + sa.id });
          if (sa.aterrizo && !yaCayo.has(sa.id)) {
            yaCayo.add(sa.id);
            polvo.emitir(e.t, w[0], w[1] - 22 * k * s, 6 * k * s, 0.5);
          }
        }
        gente.fin();

        /* ---- las chispas de la mordaza */
        const mA = e.mordaza.a, mB = e.mordaza.b;
        if (Number.isFinite(mA) && e.t >= mA) {
          const cb = e.cabinas.find((c0) => c0.duelo > 0) ?? e.cabinas[0];
          if (cb) {
            const w = alMundo(mapa, cb.x, cb.y);
            if (e.t < mB) {
              const b = Math.floor(e.t / 0.06);
              if (b !== ultimoChispa) {
                ultimoChispa = b;
                chispas.emitir(e.t, w[0], w[1] + 0.2, 0.4, 0.45);
              }
            } else if (!agarro && e.t < mB + 0.3) {
              agarro = true;
              for (let j = 0; j < 3; j++) chispas.emitir(e.t + j * 0.02, w[0], w[1] + 0.2, 0.4, 1.3);
            }
          }
        }
        if (e.golpe > 0 && ultimoGolpe < 0) ultimoGolpe = e.t;
        polvo.actualizar(e.t);
        chispas.actualizar(e.t);
      });
    },
    pantallaDe(id): Pantalla3D | null {
      const p = posiciones.get(id);
      if (!p) return null;
      return motor.pantalla([p[0], p[1], p[2]], [p[0], p[1] - 0.9, p[2]]);
    },
    reconstruir() {
      if (fijos) fijos.clave = "";
    },
    destruir() {
      if (fijos) fijos.basura.vaciar();
      motor.camara.clearViewOffset();
      motor.camara.remove(cielo.grupo);
      void o;
    },
  };
};

const TEMPC = new Color();

export const montaje = definir3D(fabrica);

/** Lo que `registro.ts` busca: con este archivo el teleférico aparece en 3D sin tocar ningún otro. */
export const lanzador3D = async (): Promise<Lanzador> => {
  const m = await import("../pixi/cablecar");
  return (names, winners, beacon, done) => m.cableCarPixi(names, winners, beacon, done, montaje);
};

