import {
  BackSide, BufferAttribute, BufferGeometry, CanvasTexture, Color, DirectionalLight, DoubleSide, Float32BufferAttribute, Fog,
  HemisphereLight, InstancedMesh, Material, Mesh, MeshBasicMaterial, MeshLambertMaterial, Object3D, PlaneGeometry, Points, PointsMaterial,
  SphereGeometry, SRGBColorSpace, CircleGeometry,
} from "three";
import type { Pose3D } from "./camara";
import { hash } from "./ids";
import type { Motor3D } from "./motor";

/**
 * El mundo común de los juegos en 3D: el cielo con degradé por tema, las luces, la niebla, el suelo con piedras y
 * matas esparcidas por hash, la sombra de contacto barata, y las partículas (polvo y chispas, papel picado) que dependen
 * solo de la hora del juego `t` y del orden en que el 2D las pide.
 *
 * Nada acá usa azar: lo que parece azar sale de `hash` de un lugar o de un número de serie.
 */

/* ===================================================================== el cielo y las luces */

/** Los colores del cielo y de la luz de un tema: el día en el claro, el atardecer en el oscuro. */
export interface PaletaCielo {
  cenit: number;
  medio: number;
  alto: number;
  horizonte: number;
  sol: number;
  /** La luz de arriba y la de abajo de la hemisférica, y su fuerza. */
  hemiCielo: number;
  hemiSuelo: number;
  hemiFuerza: number;
  luzSol: number;
  luzSolFuerza: number;
  /** El suelo base, para lo que el juego no cubre. */
  suelo: number;
}

/**
 * Del tema oscuro de `docs/marca.md` (fondo `#171126`) sale el atardecer morado y naranja de la carrera. Del claro
 * (papel `#fff6e9`) sale un día cálido: el horizonte es el papel y arriba un celeste que no apaga al amarillo.
 */
export const CIELOS: Record<"claro" | "oscuro", PaletaCielo> = {
  oscuro: {
    cenit: 0x1d2248, medio: 0x4b3b6e, alto: 0x7b4a73, horizonte: 0xd98a64, sol: 0xffe9a8,
    hemiCielo: 0xcfd4ff, hemiSuelo: 0x6a5a58, hemiFuerza: 1.35, luzSol: 0xffe2b8, luzSolFuerza: 1.9, suelo: 0x5a4a6e,
  },
  claro: {
    cenit: 0x5aa6df, medio: 0x9ccbea, alto: 0xcfe6ee, horizonte: 0xfff0d6, sol: 0xfffbe6,
    hemiCielo: 0xe8f1ff, hemiSuelo: 0xc9b896, hemiFuerza: 1.55, luzSol: 0xfff3dc, luzSolFuerza: 1.8, suelo: 0xd9c9a8,
  },
};

export interface Ambiente {
  paleta: PaletaCielo;
  cielo: Mesh;
  sol: DirectionalLight;
  /** Cada cuadro, con la `pose` que da `motor.cuadro`: que el cielo siga a la cámara y el sol mire a donde mira ella. */
  seguir(pose: Pose3D): void;
}

export interface OpcionesAmbiente {
  /** La niebla: desde dónde y hasta dónde, en unidades 3D. */
  nieblaCerca?: number;
  nieblaLejos?: number;
  /** De qué lado cae la luz del sol respecto de lo que se mira (por defecto atrás a la izquierda y arriba). */
  solDesde?: readonly [number, number, number];
  /** Cuánto abarca la sombra de mapa alrededor de lo que se mira, en unidades 3D. */
  alcanceSombra?: number;
}

export function crearAmbiente(motor: Motor3D, o: OpcionesAmbiente = {}): Ambiente {
  const P = CIELOS[motor.tema];
  const B = motor.basura;
  const horizonte = new Color(P.horizonte);
  motor.escena.fog = new Fog(horizonte, o.nieblaCerca ?? 110, o.nieblaLejos ?? 650);

  // La cúpula del cielo, con el degradé pintado en los vértices.
  const geo = B.add(new SphereGeometry(2600, 24, 14));
  const pos = geo.getAttribute("position");
  const cols: number[] = [];
  const c = new Color();
  const cen = new Color(P.cenit), med = new Color(P.medio), alt = new Color(P.alto);
  for (let i = 0; i < pos.count; i++) {
    const k = Math.max(0, Math.min(1, pos.getY(i) / 2600));
    if (k < 0.2) c.copy(horizonte).lerp(alt, k / 0.2);
    else if (k < 0.5) c.copy(alt).lerp(med, (k - 0.2) / 0.3);
    else c.copy(med).lerp(cen, (k - 0.5) / 0.5);
    cols.push(c.r, c.g, c.b);
  }
  geo.setAttribute("color", new Float32BufferAttribute(cols, 3));
  const cielo = new Mesh(geo, B.add(new MeshBasicMaterial({ vertexColors: true, side: BackSide, fog: false, depthWrite: false })));
  cielo.renderOrder = -10;
  cielo.frustumCulled = false;
  motor.escena.add(cielo);

  const hemi = new HemisphereLight(P.hemiCielo, P.hemiSuelo, P.hemiFuerza);
  motor.escena.add(hemi);
  const sol = new DirectionalLight(P.luzSol, P.luzSolFuerza);
  const desde = o.solDesde ?? [-60, 90, 70];
  sol.position.set(...desde);
  motor.escena.add(sol, sol.target);

  const alcance = o.alcanceSombra ?? 60;
  const aplicarSombras = (): void => {
    const on = motor.ajustes.sombras === "mapa";
    sol.castShadow = on;
    if (on) {
      sol.shadow.mapSize.set(1024, 1024);
      const s = sol.shadow.camera;
      s.left = -alcance;
      s.right = alcance;
      s.top = alcance;
      s.bottom = -alcance;
      s.near = 1;
      s.far = 400;
      s.updateProjectionMatrix();
      sol.shadow.bias = -0.0008;
    } else sol.shadow.map?.dispose();
  };
  aplicarSombras();
  motor.alCambiarNivel(aplicarSombras);

  return {
    paleta: P,
    cielo,
    sol,
    seguir(pose) {
      cielo.position.set(pose.pos[0], pose.pos[1], pose.pos[2]);
      sol.target.position.set(pose.mira[0], 0, pose.mira[2]);
      sol.position.set(pose.mira[0] + desde[0], desde[1], pose.mira[2] + desde[2]);
    },
  };
}

/* ===================================================================== el suelo */

/** Un plano horizontal de color liso: `x0..x1` de ancho y `z0..z1` de fondo, a la altura `y`. */
export function crearSuelo(motor: Motor3D, color: number, x0: number, x1: number, z0: number, z1: number, y = 0): Mesh {
  const B = motor.basura;
  const m = new Mesh(B.add(new PlaneGeometry(Math.max(0.01, x1 - x0), Math.max(0.01, z1 - z0))), B.add(new MeshLambertMaterial({ color })));
  m.rotation.x = -Math.PI / 2;
  m.position.set((x0 + x1) / 2, y, (z0 + z1) / 2);
  m.receiveShadow = true;
  motor.escena.add(m);
  return m;
}

export interface OpcionesEsparcir {
  geo: BufferGeometry;
  material: Material;
  /** Dónde se reparte, en unidades 3D. */
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  /** Cuántas hay en total. */
  cantidad: number;
  /** Cambia el reparto sin cambiar el resto (cada capa de cosas, su semilla). */
  semilla?: number;
  /** Si el lugar está ocupado (la pista, el ruedo), no se pone nada. */
  evitar?: (x: number, z: number) => boolean;
  /** Acomoda la i-ésima: `r` es un número de 0 a 1 propio de ella (para variar tamaño y giro). */
  ubicar: (r: number, d: Object3D, x: number, z: number) => void;
}

/**
 * Esparce piedras, matas, flores: `cantidad` copias de `geo` en la zona, en una sola malla instanciada. El lugar de cada
 * una sale de un hash de su número y la semilla, no del azar: la misma ronda se ve siempre igual. Las que caen donde
 * `evitar` dice que no, se descartan (no se vuelven a tirar), así que sale algo menos que `cantidad`.
 */
export function esparcirPorHash(motor: Motor3D, o: OpcionesEsparcir): InstancedMesh {
  const sem = o.semilla ?? 0;
  const d = new Object3D();
  const lugares: { x: number; z: number; r: number }[] = [];
  for (let i = 0; i < o.cantidad; i++) {
    const x = o.x0 + (o.x1 - o.x0) * hash(i * 7 + 1, sem * 13 + 5);
    const z = o.z0 + (o.z1 - o.z0) * hash(i * 11 + 3, sem * 17 + 9);
    if (o.evitar?.(x, z)) continue;
    lugares.push({ x, z, r: hash(i, sem * 19 + 2) });
  }
  const im = new InstancedMesh(o.geo, o.material, Math.max(1, lugares.length));
  im.count = lugares.length;
  lugares.forEach((l, j) => {
    d.position.set(0, 0, 0);
    d.rotation.set(0, 0, 0);
    d.scale.set(1, 1, 1);
    o.ubicar(l.r, d, l.x, l.z);
    d.updateMatrix();
    im.setMatrixAt(j, d.matrix);
  });
  im.instanceMatrix.needsUpdate = true;
  im.frustumCulled = false;
  motor.basura.add({ dispose: () => im.dispose() });
  motor.escena.add(im);
  return im;
}

/* ===================================================================== la sombra de contacto */

/**
 * La sombra barata: un óvalo oscuro bajo cada figura, en una sola malla. `poner(i, x, z, rx, rz, opacidad)` y `usar(n)`.
 * Con la calidad en `baja` (sin sombras) no se dibuja nada.
 */
export class SombrasDeContacto {
  readonly malla: InstancedMesh;
  private readonly d = new Object3D();

  constructor(private readonly motor: Motor3D, readonly max: number, opacidad = 0.3) {
    const B = motor.basura;
    const geo = B.add(new CircleGeometry(1, 18));
    geo.rotateX(-Math.PI / 2);
    const mat = B.add(new MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: opacidad, depthWrite: false }));
    this.malla = new InstancedMesh(geo, mat, Math.max(1, max));
    this.malla.count = 0;
    this.malla.frustumCulled = false;
    this.malla.renderOrder = 1;
    B.add({ dispose: () => this.malla.dispose() });
    motor.escena.add(this.malla);
  }

  usar(n: number): void {
    this.malla.count = this.motor.ajustes.sombras === "no" ? 0 : Math.max(0, Math.min(this.max, n));
  }

  poner(i: number, x: number, z: number, rx: number, rz = rx, y = 0.05): void {
    if (i < 0 || i >= this.max) return;
    const d = this.d;
    d.position.set(x, y, z);
    d.scale.set(rx, 1, rz);
    d.updateMatrix();
    this.malla.setMatrixAt(i, d.matrix);
  }

  fin(): void {
    this.malla.instanceMatrix.needsUpdate = true;
  }
}

/* ===================================================================== las partículas */

/** Un punto blando y redondo para el polvo y las chispas. */
function texturaPunto(motor: Motor3D): CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const cx = c.getContext("2d");
  if (!cx) return null;
  const g = cx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.5, "rgba(255,255,255,0.55)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  cx.fillStyle = g;
  cx.fillRect(0, 0, 64, 64);
  const t = motor.basura.add(new CanvasTexture(c));
  t.colorSpace = SRGBColorSpace;
  return t;
}

export interface OpcionesRafagas {
  /** Cuántas ráfagas caben a la vez (las más viejas se pisan). */
  max?: number;
  /** Cuántas partículas por ráfaga, con la calidad más alta. */
  porRafaga?: number;
  /** El color de las partículas. */
  color: number;
  /** El tamaño de cada punto, en unidades 3D. */
  tam?: number;
  /** Cuánto dura una partícula, en segundos de juego. */
  vida?: number;
  /** La gravedad, en unidades por segundo al cuadrado (positiva: cae). */
  gravedad?: number;
  /** La velocidad de salida, en unidades por segundo. */
  velocidad?: number;
  /** Cuánto sube de más cada partícula al salir (el polvo flota; las chispas saltan). */
  empujeArriba?: number;
}

/**
 * Polvo, chispas, astillas: ráfagas que el 2D pide con `emitir(t, x, y, z)` cuando pasa algo (un choque, una caída). La
 * posición de cada partícula es función de `t - t0` y de un hash de su número: la misma ronda se ve igual. Se dibujan
 * con la calidad del equipo (la mitad o un cuarto de las partículas en `media` y `baja`).
 */
export class Rafagas {
  /** El objeto de three.js, para ponerlo en un grupo (por ejemplo, uno que escala con el mundo del juego). */
  readonly objeto: Points;
  private readonly pos: Float32Array;
  private readonly col: Float32Array;
  private readonly eventos: { t0: number; x: number; y: number; z: number; fuerza: number; serie: number }[] = [];
  private serie = 0;
  private readonly max: number;
  private readonly por: number;
  private readonly vida: number;
  private readonly g: number;
  private readonly vel: number;
  private readonly arriba: number;
  private readonly rgb: Color;

  constructor(private readonly motor: Motor3D, o: OpcionesRafagas) {
    this.max = o.max ?? 12;
    this.por = o.porRafaga ?? 18;
    this.vida = o.vida ?? 0.9;
    this.g = o.gravedad ?? 6;
    this.vel = o.velocidad ?? 4;
    this.arriba = o.empujeArriba ?? 1.5;
    this.rgb = new Color(o.color);
    const n = this.max * this.por;
    this.pos = new Float32Array(n * 3).fill(-1e4);
    this.col = new Float32Array(n * 4);
    const geo = motor.basura.add(new BufferGeometry());
    geo.setAttribute("position", new BufferAttribute(this.pos, 3));
    geo.setAttribute("color", new BufferAttribute(this.col, 4));
    const mat = motor.basura.add(new PointsMaterial({
      size: o.tam ?? 0.9, sizeAttenuation: true, vertexColors: true, transparent: true, depthWrite: false, map: texturaPunto(motor), fog: false,
    }));
    this.objeto = new Points(geo, mat);
    this.objeto.frustumCulled = false;
    motor.escena.add(this.objeto);
  }

  /** Una ráfaga que sale de `(x, y, z)` (unidades 3D) en la hora `t`. `fuerza` de 0 a 2: un roce o un choque fuerte. */
  emitir(t: number, x: number, y: number, z: number, fuerza = 1): void {
    this.eventos.push({ t0: t, x, y, z, fuerza, serie: this.serie++ });
    if (this.eventos.length > this.max) this.eventos.shift();
  }

  /** Acomoda todas las partículas para la hora `t`. Llamala en cada cuadro. */
  actualizar(t: number): void {
    const visibles = Math.max(0, Math.round(this.por * this.motor.ajustes.particulas));
    this.pos.fill(-1e4);
    this.col.fill(0);
    this.eventos.forEach((e, ei) => {
      const edad = t - e.t0;
      if (edad < 0 || edad > this.vida) return;
      const k = edad / this.vida;
      for (let j = 0; j < visibles; j++) {
        const i = (ei * this.por + j) * 3;
        const a = hash(e.serie * 131 + j, 1) * Math.PI * 2;
        const r = (0.35 + 0.65 * hash(e.serie * 131 + j, 2)) * this.vel * e.fuerza;
        const vy = (0.4 + hash(e.serie * 131 + j, 3)) * this.arriba * e.fuerza;
        // Sale rápido y se frena (el aire), y cae con la gravedad.
        const frena = 1 - Math.exp(-3 * edad);
        this.pos[i] = e.x + Math.cos(a) * r * frena / 3;
        this.pos[i + 1] = Math.max(0.02, e.y + vy * edad * (1 - k * 0.5) - (this.g * edad * edad) / 2 * 0.15);
        this.pos[i + 2] = e.z + Math.sin(a) * r * frena / 3;
        const c = (ei * this.por + j) * 4;
        this.col[c] = this.rgb.r;
        this.col[c + 1] = this.rgb.g;
        this.col[c + 2] = this.rgb.b;
        this.col[c + 3] = (1 - k) * (1 - k) * 0.85;
      }
    });
    const geo = this.objeto.geometry;
    geo.attributes.position!.needsUpdate = true;
    geo.attributes.color!.needsUpdate = true;
  }
}

export interface OpcionesPapel {
  /** Cuántas tiras con la calidad más alta. */
  cantidad?: number;
  /** Los colores de las tiras (los de la paleta de la casa por defecto). */
  colores?: readonly number[];
  /** De dónde cae y hasta dónde, en unidades 3D. */
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  /** La altura de la que cae. */
  alto: number;
}

const PAPEL_COLORES = [0xe93d9c, 0xff7a1a, 0xffc629, 0x00a896, 0x6c4ce0];

/**
 * El papel picado de quien gana: cae desde `t0` (la hora del golpe) y se queda cayendo. Cada tira es función de
 * `t - t0` y de su número; ninguna usa azar.
 */
export class PapelPicado {
  private readonly malla: InstancedMesh;
  private readonly d = new Object3D();
  private readonly c = new Color();
  private readonly n: number;
  t0 = Infinity;

  constructor(private readonly motor: Motor3D, private readonly o: OpcionesPapel) {
    this.n = o.cantidad ?? 160;
    const B = motor.basura;
    const geo = B.add(new PlaneGeometry(0.34, 0.2));
    const mat = B.add(new MeshBasicMaterial({ side: DoubleSide, fog: false }));
    this.malla = new InstancedMesh(geo, mat, this.n);
    this.malla.count = 0;
    this.malla.frustumCulled = false;
    const colores = o.colores ?? PAPEL_COLORES;
    for (let i = 0; i < this.n; i++) this.malla.setColorAt(i, this.c.setHex(colores[i % colores.length] ?? 0xffc629));
    if (this.malla.instanceColor) this.malla.instanceColor.needsUpdate = true;
    B.add({ dispose: () => this.malla.dispose() });
    motor.escena.add(this.malla);
  }

  /** El golpe del ganador: desde esta hora cae el papel. */
  desde(t: number): void {
    if (t < this.t0) this.t0 = t;
  }

  actualizar(t: number): void {
    const edad = t - this.t0;
    const visibles = edad < 0 || !Number.isFinite(edad) ? 0 : Math.round(this.n * this.motor.ajustes.particulas);
    this.malla.count = visibles;
    if (!visibles) return;
    const { x0, x1, z0, z1, alto } = this.o;
    const d = this.d;
    for (let i = 0; i < visibles; i++) {
      const retraso = hash(i, 4) * 1.6;
      const e = edad - retraso;
      if (e < 0) {
        d.position.set(0, -1e3, 0);
        d.scale.setScalar(0);
      } else {
        const vel = 2.2 + hash(i, 5) * 1.6;
        // Vuelve a caer desde arriba cuando llega al piso: cae para siempre mientras dure el cartel.
        const y = alto - ((e * vel) % alto);
        const bal = Math.sin(e * (1.2 + hash(i, 6)) + hash(i, 7) * 6.28) * 0.7;
        d.position.set(x0 + (x1 - x0) * hash(i, 8) + bal, y, z0 + (z1 - z0) * hash(i, 9));
        d.rotation.set(e * (2 + hash(i, 10) * 3), e * (1 + hash(i, 11) * 2), 0);
        d.scale.setScalar(1);
      }
      d.updateMatrix();
      this.malla.setMatrixAt(i, d.matrix);
    }
    this.malla.instanceMatrix.needsUpdate = true;
  }
}
