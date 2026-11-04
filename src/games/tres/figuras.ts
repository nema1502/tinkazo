import {
  BoxGeometry, Color, ConeGeometry, CylinderGeometry, Group, InstancedMesh, Matrix4, Mesh, MeshLambertMaterial, Object3D, SphereGeometry,
  type BufferGeometry, type Material,
} from "three";
import { avatarColor } from "../../avatar";
import { hashTexto } from "./ids";
import type { Basura } from "./motor";

/**
 * Las piezas con que se arman las figuras del 3D: pocos polígonos, sombreado plano (cada cara de su color, sin
 * suavizar: es el estilo de la casa), materiales y geometrías compartidos, y todo anotado en la `Basura` del motor
 * para soltarlo al cerrar.
 *
 * Los modelos se arman en **píxeles del dibujo** (una persona mide `PERSONA_ALTO`, igual que la llama de la carrera
 * mide `LLAMA_ALTO`) y se escalan con `mapa.escalaFigura(esc)`: así el 3D y el 2D hablan en las mismas unidades.
 */

const BLANCO = new Color(0xffffff);

/** Las geometrías básicas, una vez por juego. */
export interface Geometrias {
  esfera: SphereGeometry;
  cilindro: CylinderGeometry;
  caja: BoxGeometry;
  /** Con la base en y = 0 y la punta en y = 1. */
  cono: ConeGeometry;
}

export function crearGeometrias(b: Basura): Geometrias {
  const cono = b.add(new ConeGeometry(1, 1, 6, 1));
  cono.translate(0, 0.5, 0);
  return {
    esfera: b.add(new SphereGeometry(1, 10, 8)),
    cilindro: b.add(new CylinderGeometry(1, 1, 1, 8, 1)),
    caja: b.add(new BoxGeometry(1, 1, 1)),
    cono,
  };
}

/** Materiales de sombreado plano, uno por color. */
export class Materiales {
  private readonly memo = new Map<number, MeshLambertMaterial>();
  constructor(private readonly basura: Basura) {}
  plano(color: number): MeshLambertMaterial {
    let m = this.memo.get(color);
    if (!m) {
      m = this.basura.add(new MeshLambertMaterial({ color, flatShading: true }));
      this.memo.set(color, m);
    }
    return m;
  }
}

/** Una pieza: la geometría y el material en su lugar y a su tamaño. */
export function pieza(geo: BufferGeometry, mat: Material, x: number, y: number, z: number, sx: number, sy: number, sz: number): Mesh {
  const m = new Mesh(geo, mat);
  m.position.set(x, y, z);
  m.scale.set(sx, sy, sz);
  return m;
}

/**
 * Muchas figuras iguales en un solo dibujo (la tribuna, doscientas personas): `poner` acomoda la i-ésima, `usar(n)`
 * dice cuántas se dibujan, y `fin()` sube las matrices a la placa. Sin azar: el color de cada una lo elige quien llama.
 */
export class Instancias {
  readonly malla: InstancedMesh;
  private readonly d = new Object3D();
  private readonly c = new Color();
  private conColor = false;

  constructor(geo: BufferGeometry, mat: Material, readonly max: number, basura?: Basura) {
    this.malla = new InstancedMesh(geo, mat, Math.max(1, max));
    this.malla.count = 0;
    // Las instancias se mueven por toda la escena: el cálculo de lo que se ve de three.js usa la caja de una sola.
    this.malla.frustumCulled = false;
    basura?.add({ dispose: () => this.malla.dispose() });
  }

  usar(n: number): void {
    this.malla.count = Math.max(0, Math.min(this.max, n));
  }

  poner(i: number, x: number, y: number, z: number, sx: number, sy = sx, sz = sx, ry = 0, color?: number): void {
    if (i < 0 || i >= this.max) return;
    const d = this.d;
    d.position.set(x, y, z);
    d.rotation.set(0, ry, 0);
    d.scale.set(sx, sy, sz);
    d.updateMatrix();
    this.malla.setMatrixAt(i, d.matrix);
    if (color !== undefined) {
      this.malla.setColorAt(i, this.c.setHex(color));
      this.conColor = true;
    }
  }

  /** Como `poner`, pero con la matriz ya armada (cuando la figura se inclina en más de un eje, como un trompo que cabecea). */
  ponerMatriz(i: number, m: Matrix4, color?: number): void {
    if (i < 0 || i >= this.max) return;
    this.malla.setMatrixAt(i, m);
    if (color !== undefined) {
      this.malla.setColorAt(i, this.c.setHex(color));
      this.conColor = true;
    }
  }

  /** El color de la i-ésima mezclado hacia blanco (el destello de un golpe), de 0 a 1. */
  ponerColorMezclado(i: number, color: number, haciaBlanco: number): void {
    if (i < 0 || i >= this.max) return;
    this.malla.setColorAt(i, this.c.setHex(color).lerp(BLANCO, Math.max(0, Math.min(1, haciaBlanco))));
    this.conColor = true;
  }

  fin(): void {
    this.malla.instanceMatrix.needsUpdate = true;
    if (this.conColor && this.malla.instanceColor) this.malla.instanceColor.needsUpdate = true;
  }
}

/* ===================================================================== la persona */

/** Lo que mide una persona en unidades del dibujo. */
export const PERSONA_ALTO = 100;

const PIELES = [0xf1c9a5, 0xd9a47c, 0xb67a52, 0x8d5a3a, 0xe8b894, 0xc68a62];
const PELOS = [0x16161f, 0x2b1d14, 0x4a2c1a, 0x6b4a2c, 0x16161f, 0x8a6238];

/** El color de la cara de una persona como número: el mismo que `colorDeNombre` (`pixi/foco-vista.ts`) para su onda y su foco. */
export const colorDePersona = (nombre: string): number => {
  const n = parseInt((avatarColor(nombre) || "#ffc629").replace("#", ""), 16);
  return Number.isFinite(n) ? n : 0xffc629;
};

export interface PersonaRig {
  raiz: Group;
  /** La altura de la cabeza (arriba), en unidades del dibujo. */
  cabeza: number;
  /**
   * La postura. `fase`: la del paso, en radianes. `velocidad`: 0 parada, 1 caminando, más, corriendo. `festejo`: de 0 a
   * 1, los brazos arriba. Es función de lo que le pasan: sin estado ni azar.
   */
  poner(fase: number, velocidad: number, festejo: number): void;
}

/**
 * Una persona genérica y simple: piernas, cuerpo del color de su nombre (el mismo de su cara en el 2D), cabeza con
 * piel y pelo repartidos por un hash de su nombre, y brazos que se mueven. Los pies en y = 0 y mirando a +x.
 */
export function crearPersona(g: Geometrias, m: Materiales, nombre: string): PersonaRig {
  const h = hashTexto(nombre);
  const camisa = m.plano(colorDePersona(nombre));
  const piel = m.plano(PIELES[h % PIELES.length] ?? PIELES[0] as number);
  const pelo = m.plano(PELOS[(h >>> 3) % PELOS.length] ?? PELOS[0] as number);
  const pantalon = m.plano(0x2d2a52);
  const raiz = new Group();

  const piernas: Group[] = [];
  for (const z of [-5, 5]) {
    const cadera = new Group();
    cadera.position.set(0, 46, z);
    cadera.add(pieza(g.cilindro, pantalon, 0, -23, 0, 4.6, 46, 4.6));
    raiz.add(cadera);
    piernas.push(cadera);
  }
  const torso = new Group();
  torso.position.set(0, 46, 0);
  torso.add(pieza(g.caja, camisa, 0, 17, 0, 15, 34, 22));
  raiz.add(torso);
  const brazos: Group[] = [];
  for (const z of [-13, 13]) {
    const hombro = new Group();
    hombro.position.set(0, 58, z);
    hombro.add(pieza(g.cilindro, camisa, 0, -14, 0, 3.8, 28, 3.8));
    hombro.add(pieza(g.esfera, piel, 0, -29, 0, 4.2, 4.2, 4.2));
    raiz.add(hombro);
    brazos.push(hombro);
  }
  const cabeza = new Group();
  cabeza.position.set(0, 82, 0);
  cabeza.add(pieza(g.esfera, piel, 0, 8, 0, 10, 11, 10));
  cabeza.add(pieza(g.esfera, pelo, -1.5, 12, 0, 10.6, 8.6, 10.6));
  raiz.add(cabeza);

  return {
    raiz,
    cabeza: PERSONA_ALTO,
    poner(fase, velocidad, festejo) {
      const paso = Math.min(1, velocidad) * 0.7;
      piernas[0]!.rotation.z = Math.sin(fase) * paso;
      piernas[1]!.rotation.z = -Math.sin(fase) * paso;
      const balanceo = Math.min(1, velocidad) * 0.8;
      // Con el festejo, los brazos suben y se agitan; si no, acompañan el paso.
      brazos[0]!.rotation.z = (1 - festejo) * (-Math.sin(fase) * balanceo) + festejo * (Math.PI * 0.85 + Math.sin(fase * 2) * 0.2);
      brazos[1]!.rotation.z = (1 - festejo) * (Math.sin(fase) * balanceo) + festejo * (Math.PI * 0.85 - Math.sin(fase * 2) * 0.2);
      raiz.position.y = velocidad > 0.1 ? Math.abs(Math.sin(fase)) * 3 * Math.min(1, velocidad) : 0;
      cabeza.rotation.z = Math.sin(fase * 2) * 0.04 * Math.min(1, velocidad);
    },
  };
}
