import {
  BackSide, BufferGeometry, CanvasTexture, ConeGeometry, CylinderGeometry, Float32BufferAttribute, Mesh, MeshBasicMaterial, Object3D,
  Quaternion, SRGBColorSpace, Vector3, type Group,
} from "three";
import type { Basura, Motor3D } from "./motor";
import type { Materiales } from "./figuras";

/**
 * Las piezas que comparten las partes de la piñata en 3D: el contexto, la paleta del tema, el contorno de tinta, el
 * caramelo y unas cuentas chicas para acomodar un cilindro entre dos puntos. Todo en píxeles del dibujo del 2D: el
 * escenario entero se escala una vez por `escala3D(u)`.
 */

export type Tema = "claro" | "oscuro";

/** Lo que cada parte necesita: el motor, dónde tirar lo que crea, los materiales de sombreado plano y el escenario al que se suma. */
export interface Ctx {
  motor: Motor3D;
  B: Basura;
  tema: Tema;
  mat: Materiales;
  /** La raíz de todo lo que se dibuja: escalada a píxeles del 2D, con su y = 0 en el piso. */
  escenario: Group;
  tinta: MeshBasicMaterial;
  /** El color de la tinta del tema, para el contorno y las sombras. */
  inkHex: number;
}

export const INK: Record<Tema, number> = { claro: 0x191919, oscuro: 0x16161f };

/** Los acentos de la marca del tema que corresponde (docs/marca.md): magenta, naranja, turquesa, amarillo, morado. */
export const ACENTOS: Record<Tema, readonly [number, number, number, number, number]> = {
  claro: [0xe93d9c, 0xff7a1a, 0x00a896, 0xffc629, 0x6c4ce0],
  oscuro: [0xff5cb3, 0xff8b3d, 0x17c3b2, 0xffd24d, 0x9b7bff],
};

/** Los colores de los siete picos y de los flecos, como `CONE` del 2D: magenta, naranja, turquesa, morado, amarillo, magenta, turquesa. */
export const coloresPicos = (t: Tema): number[] => {
  const [m, n, tu, a, mo] = ACENTOS[t];
  return [m, n, tu, mo, a, m, tu];
};

/** El contorno de tinta: la misma geometría por dentro (`BackSide`), un poco más grande. */
export function contorno(c: Ctx, m: Mesh, k = 1.07): Mesh {
  const h = new Mesh(m.geometry, c.tinta);
  h.scale.setScalar(k);
  m.add(h);
  return h;
}

const ARRIBA = new Vector3(0, 1, 0);
const dirV = new Vector3();
const quatV = new Quaternion();

/** Pone un cilindro unitario (radio 1, alto 1, eje y) entre dos puntos, con su radio. */
export function entre(m: Object3D, ax: number, ay: number, az: number, bx: number, by: number, bz: number, radio: number): void {
  dirV.set(bx - ax, by - ay, bz - az);
  const largo = dirV.length() || 1e-6;
  m.position.set((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);
  m.quaternion.copy(quatV.setFromUnitVectors(ARRIBA, dirV.multiplyScalar(1 / largo)));
  m.scale.set(radio, largo, radio);
}

/** Junta geometrías en una sola (sin índice), para dibujarlas de una vez. */
export function fusionar(B: Basura, partes: BufferGeometry[]): BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  for (const g of partes) {
    const ng = g.index ? g.toNonIndexed() : g;
    const p = ng.getAttribute("position");
    const n = ng.getAttribute("normal");
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      if (n) nor.push(n.getX(i), n.getY(i), n.getZ(i));
    }
    if (ng !== g) ng.dispose();
    g.dispose();
  }
  const out = B.add(new BufferGeometry());
  out.setAttribute("position", new Float32BufferAttribute(pos, 3));
  if (nor.length) out.setAttribute("normal", new Float32BufferAttribute(nor, 3));
  return out;
}

/**
 * El caramelo en unidades de su tamaño `s` (el que usa el 2D): un cilindro de seis lados acostado de 2,2 de largo y las
 * dos puntas retorcidas, que son conos de cinco lados. El eje largo es x.
 */
export function geometriaCaramelo(B: Basura): BufferGeometry {
  const cuerpo = new CylinderGeometry(0.72, 0.72, 2.2, 6, 1);
  cuerpo.rotateZ(Math.PI / 2);
  const punta = (signo: 1 | -1): ConeGeometry => {
    const c = new ConeGeometry(0.52, 0.56, 5, 1);
    // El cono mira a +y: se acuesta con la punta hacia afuera.
    c.rotateZ(-signo * (Math.PI / 2));
    c.translate(signo * 1.33, 0, 0);
    return c;
  };
  return fusionar(B, [cuerpo, punta(1), punta(-1)]);
}

/** Una textura dibujada en un lienzo al arrancar (como mucho 512 de lado). */
export function textura(c: Ctx, w: number, h: number, dibujar: (cx: CanvasRenderingContext2D) => void): CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const lienzo = document.createElement("canvas");
  lienzo.width = w;
  lienzo.height = h;
  const cx = lienzo.getContext("2d");
  if (!cx) return null;
  dibujar(cx);
  const t = c.B.add(new CanvasTexture(lienzo));
  t.colorSpace = SRGBColorSpace;
  return t;
}

export const hex = (n: number): string => `#${n.toString(16).padStart(6, "0")}`;
