import { BufferGeometry, Color, Float32BufferAttribute, LatheGeometry, Vector2 } from "three";
import { hash } from "./ids";

/**
 * Las piezas del árbol del Toborochi en 3D que no dependen de la hora: la flor de cinco pétalos y el tronco de botella.
 * Solo geometría (sin materiales ni escena); todo sale de cuentas y de un hash, nunca del azar.
 */

/* ============================================================================ la flor */

/**
 * La flor de radio 1, en el plano XY mirando a +Z: cinco pétalos anchos que se pisan un poco, cada uno con su lomo en el
 * medio (se ven las facetas) y la punta levantada, como una copita. Con color por vértice (el pétalo es más oscuro en el
 * fondo y más claro en la punta): el color de cada flor lo pone la instancia y se multiplica con este.
 * Un solo `BufferGeometry` para toda la flor: una instancia por flor, no cinco.
 */
export function geoFlor(): BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  const TRAMOS = 6;
  // El ancho medio del pétalo a lo largo de su eje, de 0 (el centro) a 1 (la punta): redondo en la punta, angosto en el pie.
  const ancho = (u: number): number => {
    const x = u < 0.58 ? (u - 0.58) / 0.58 : (u - 0.58) / 0.42;
    return 0.44 * Math.sqrt(Math.max(0, 1 - x * x));
  };
  const us = Array.from({ length: TRAMOS + 1 }, (_, j) => j / TRAMOS);
  for (let p = 0; p < 5; p++) {
    const ang = Math.PI / 2 + (p * Math.PI * 2) / 5;
    const ca = Math.cos(ang), sa = Math.sin(ang);
    // Cada pétalo un poco más arriba que el anterior: donde se pisan no hay dos caras en el mismo plano.
    const capa = 0.014 * p;
    const punto = (u: number, lado: number): [number, number, number, number] => {
      const a = 0.08 + 0.92 * u;
      const b = lado * ancho(u);
      const z = 0.03 + capa + 0.2 * Math.pow(u, 1.8) + 0.07 * (1 - Math.abs(lado)) * Math.sin(Math.PI * Math.min(1, u * 1.05));
      const brillo = 0.7 + 0.3 * Math.pow(u, 0.7) - 0.05 * Math.abs(lado);
      return [a * ca - b * sa, a * sa + b * ca, z, brillo];
    };
    const tri = (A: [number, number, number, number], B: [number, number, number, number], C: [number, number, number, number]): void => {
      for (const v of [A, B, C]) {
        pos.push(v[0], v[1], v[2]);
        col.push(v[3], v[3], v[3]);
      }
    };
    for (let j = 0; j < TRAMOS; j++) {
      const S0 = punto(us[j] as number, 0), S1 = punto(us[j + 1] as number, 0);
      const L0 = punto(us[j] as number, -1), L1 = punto(us[j + 1] as number, -1);
      const R0 = punto(us[j] as number, 1), R1 = punto(us[j + 1] as number, 1);
      // Del lomo al borde, de cada lado; la punta se cierra en un solo vértice.
      tri(S0, L0, S1);
      if (j < TRAMOS - 1) tri(L0, L1, S1);
      tri(S0, S1, R0);
      if (j < TRAMOS - 1) tri(R0, S1, R1);
    }
  }
  const geo = new BufferGeometry();
  geo.setAttribute("position", new Float32BufferAttribute(pos, 3));
  geo.setAttribute("color", new Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  return geo;
}

/* ========================================================================== el tronco */

/** El diámetro del tronco en cada altura (0 en el pie, 1 en la punta del cuello), con el vientre en 1. */
const NUDOS: readonly (readonly [number, number])[] = [
  [0, 0.74], [0.07, 0.9], [0.28, 1.0], [0.46, 0.96], [0.64, 0.78], [0.8, 0.62], [0.92, 0.54], [1, 0.5],
];

/** Un diámetro suave entre los nudos (Catmull-Rom). */
export function diametroDelTronco(s: number): number {
  const x = Math.max(0, Math.min(1, s));
  let i = 0;
  while (i < NUDOS.length - 2 && x > (NUDOS[i + 1] as readonly [number, number])[0]) i++;
  const a = NUDOS[Math.max(0, i - 1)] as readonly [number, number];
  const b = NUDOS[i] as readonly [number, number];
  const c = NUDOS[i + 1] as readonly [number, number];
  const d = NUDOS[Math.min(NUDOS.length - 1, i + 2)] as readonly [number, number];
  const k = (x - b[0]) / Math.max(1e-6, c[0] - b[0]);
  const k2 = k * k, k3 = k2 * k;
  return 0.5 * (2 * b[1] + (-a[1] + c[1]) * k + (2 * a[1] - 5 * b[1] + 4 * c[1] - d[1]) * k2 + (-a[1] + 3 * b[1] - 3 * c[1] + d[1]) * k3);
}

export interface MedidasTronco {
  /** De dónde a dónde va el tronco, de abajo hacia arriba (alturas sobre el piso). */
  y0: number;
  y1: number;
  /** El diámetro del vientre. */
  ancho: number;
}

/** El radio del tronco a la altura `y`. */
export const radioDelTronco = (m: MedidasTronco, y: number): number => (m.ancho * diametroDelTronco((y - m.y0) / (m.y1 - m.y0))) / 2;

/**
 * El tronco de botella: un torno de doce lados con la panza abajo, el cuello cerrado arriba y el pie que se agarra al
 * suelo. Con las estrías del toborochi (lomos verticales) y el color por vértice: más oscuro al pie, más claro en el
 * vientre, con una variación chica por faceta para que no sea una sola mancha.
 */
export function geoTronco(m: MedidasTronco, piel: number, sombra: number, lados = 12, anillos = 20): BufferGeometry {
  const pts: Vector2[] = [];
  for (let i = 0; i <= anillos; i++) {
    const s = i / anillos;
    pts.push(new Vector2(i === anillos ? 0 : radioDelTronco(m, m.y0 + (m.y1 - m.y0) * s), m.y0 + (m.y1 - m.y0) * s));
  }
  const geo = new LatheGeometry(pts, lados);
  const pos = geo.getAttribute("position");
  const cP = new Color(piel), cS = new Color(sombra), c = new Color();
  const col: number[] = [];
  for (let v = 0; v < pos.count; v++) {
    const x = pos.getX(v), z = pos.getZ(v), y = pos.getY(v);
    const rad = Math.hypot(x, z);
    const ang = Math.atan2(x, z);
    // Las estrías: seis lomos que se afinan hacia la punta.
    const s = (y - m.y0) / (m.y1 - m.y0);
    const lomo = 1 + 0.045 * Math.cos(ang * (lados / 2)) * (1 - 0.6 * s);
    if (rad > 1e-3) pos.setXYZ(v, x * lomo, y, z * lomo);
    // El color: del pie oscuro al vientre claro, y el cuello un poco más claro.
    const k = Math.min(1, Math.max(0, s / 0.35));
    c.copy(cS).lerp(cP, 0.35 + 0.65 * k);
    const j = (hash(Math.round(ang * 10) + 40, Math.round(s * anillos)) - 0.5) * 0.12;
    col.push(c.r * (1 + j), c.g * (1 + j), c.b * (1 + j));
  }
  geo.setAttribute("color", new Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  return geo;
}
