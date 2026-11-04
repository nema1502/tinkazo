import {
  BackSide, BoxGeometry, Color, CylinderGeometry, InstancedBufferAttribute, InstancedMesh, Matrix4, MeshBasicMaterial, MeshLambertMaterial,
  OctahedronGeometry, Quaternion, SphereGeometry, Vector3, type BufferGeometry, type Scene,
} from "three";
import { BAJA_SENTADO, CADERA, HOMBRO_X, HOMBRO_Y, punto, type Cuerpo, type V3 } from "./chovena-3d-brazos";
import type { Basura } from "./motor";

/**
 * Los bailarines de la chovena, todos en pocos dibujos: cada parte del cuerpo (el tipoy, la camisa, las piernas, la
 * cabeza, el sombrero, los brazos...) es una malla instanciada con el color de cada uno por instancia, así que con 2, con
 * 18 o con 200 son las mismas ~20 llamadas de dibujo. El contorno de tinta (el casco invertido) comparte las matrices
 * de la parte que rodea, así que no cuesta cuentas de más.
 *
 * Las medidas son las del 2D (`makeDancer`): el tipoy de los tobillos al cuello, el sombrero de saó con su cinta, las
 * trenzas con la flor. Todo en bailarines: 1 es lo que mide `dh`. La cabeza es un 20 % más grande, como los juguetes de
 * madera de la casa. Sin azar: la piel, el pelo y la flor salen del número de cada uno.
 */

type RGB = readonly [number, number, number];

const tmpC = new Color();
/** Un color de la marca (sRGB) como lo espera un color por instancia: lineal. */
export const lineal = (hex: number): RGB => {
  tmpC.setHex(hex);
  return [tmpC.r, tmpC.g, tmpC.b];
};

export const BLANCO = lineal(0xfbf8f1);
export const PAJA = lineal(0xe2c27c);
const MARRON = lineal(0x5a3a22);
const OJOS = lineal(0x16161f);

export const PIELES = [0xc68a5c, 0xa86f45, 0xd9a273, 0x8f5a36];
export const PELOS = [0x2b1d14, 0x3d2817, 0x151515, 0x4a2f1c];
export const FLORES = [0xff5fa2, 0xff7a1a, 0xffffff, 0xe93d9c];

/** Lo fijo de cada persona, ya en lineal. */
export interface PersonaFija {
  tipoy: boolean;
  cinta: RGB;
  piel: RGB;
  pelo: RGB;
  flor: RGB;
}

export function personaFija(tipoy: boolean, color: number, iPiel: number, iPelo: number, iFlor: number): PersonaFija {
  return {
    tipoy,
    cinta: lineal(color),
    piel: lineal(PIELES[iPiel % PIELES.length] as number),
    pelo: lineal(PELOS[iPelo % PELOS.length] as number),
    flor: lineal(FLORES[iFlor % FLORES.length] as number),
  };
}

/** Una parte del cuerpo de todos: una malla instanciada, con su contorno si lo tiene. */
class Parte {
  readonly malla: InstancedMesh;
  readonly contorno: InstancedMesh | null;
  private readonly col: Float32Array;
  n = 0;

  constructor(escena: Scene, basura: Basura, geo: BufferGeometry, mat: MeshLambertMaterial, readonly cap: number, geoContorno?: BufferGeometry, matContorno?: MeshBasicMaterial) {
    this.malla = new InstancedMesh(geo, mat, Math.max(1, cap));
    this.malla.count = 0;
    this.malla.frustumCulled = false;
    this.col = new Float32Array(Math.max(1, cap) * 3);
    this.malla.instanceColor = new InstancedBufferAttribute(this.col, 3);
    escena.add(this.malla);
    basura.add({ dispose: () => this.malla.dispose() });
    if (geoContorno && matContorno) {
      this.contorno = new InstancedMesh(geoContorno, matContorno, Math.max(1, cap));
      this.contorno.count = 0;
      this.contorno.frustumCulled = false;
      // Las mismas matrices que la parte: el casco invertido es la misma geometría, un poco más gorda.
      this.contorno.instanceMatrix = this.malla.instanceMatrix;
      escena.add(this.contorno);
      basura.add({ dispose: () => this.contorno?.dispose() });
    } else this.contorno = null;
  }

  reset(): void {
    this.n = 0;
  }

  poner(m: Matrix4, c: RGB, mult: RGB, brillo: number): void {
    if (this.n >= this.cap) return;
    this.malla.setMatrixAt(this.n, m);
    const j = this.n * 3;
    this.col[j] = c[0] * mult[0] * brillo;
    this.col[j + 1] = c[1] * mult[1] * brillo;
    this.col[j + 2] = c[2] * mult[2] * brillo;
    this.n++;
  }

  fin(conContorno: boolean): void {
    this.malla.count = this.n;
    this.malla.instanceMatrix.needsUpdate = true;
    if (this.malla.instanceColor) this.malla.instanceColor.needsUpdate = true;
    if (this.contorno) this.contorno.count = conContorno ? this.n : 0;
  }
}

const UP = new Vector3(0, 1, 0);

/** Una geometría de contorno: la misma, más gorda a los costados y apenas más larga. */
const gordo = (g: BufferGeometry, xz: number, y: number): BufferGeometry => g.clone().scale(xz, y, xz);

export class Gente {
  private readonly partes: Parte[] = [];
  private readonly tipoy: Parte;
  private readonly camisa: Parte;
  private readonly piernas: Parte;
  private readonly pies: Parte;
  private readonly cabeza: Parte;
  private readonly ojos: Parte | null;
  private readonly pelo: Parte;
  private readonly trenzas: Parte | null;
  private readonly flor: Parte | null;
  private readonly ala: Parte;
  private readonly copa: Parte;
  private readonly cintas: Parte;
  private readonly brazos: Parte;
  private readonly manos: Parte;
  private readonly lap: Parte;
  /** Con mucha gente, las partes chicas (ojos, trenzas, flor) y el contorno de tinta se apagan. */
  readonly liviano: boolean;

  private readonly Mup = new Matrix4();
  private readonly Mleg = new Matrix4();
  private readonly Lm = new Matrix4();
  private readonly Mw = new Matrix4();
  private readonly tmp = new Matrix4();
  private readonly q = new Quaternion();
  private readonly pm = new Vector3();
  private readonly dir = new Vector3();
  private readonly esc = new Vector3();
  private readonly SL: V3 = [0, 0, 0];
  private readonly SR: V3 = [0, 0, 0];

  constructor(escena: Scene, basura: Basura, cap: number, tinta: number, liviano: boolean, contorno: boolean) {
    this.liviano = liviano;
    const mat = basura.add(new MeshLambertMaterial({ color: 0xffffff, flatShading: true }));
    const mTinta = basura.add(new MeshBasicMaterial({ color: tinta, side: BackSide }));
    const seg = liviano ? [6, 4] : [8, 6];
    const cil = (r0: number, r1: number, lados: number): CylinderGeometry => basura.add(new CylinderGeometry(r0, r1, 1, lados, 1));
    const esfera = basura.add(new SphereGeometry(1, seg[0], seg[1]));
    const caja = basura.add(new BoxGeometry(1, 1, 1));
    const octa = basura.add(new OctahedronGeometry(1, 0));
    const geoTipoy = cil(0.65, 1, 8);
    const conC = contorno && !liviano;
    const parte = (geo: BufferGeometry, n: number, cont?: [number, number]): Parte => {
      const g = cont && conC ? basura.add(gordo(geo, cont[0], cont[1])) : undefined;
      const p = new Parte(escena, basura, geo, mat, cap * n, g, g ? mTinta : undefined);
      this.partes.push(p);
      return p;
    };
    this.tipoy = parte(geoTipoy, 1, [1.12, 1.03]);
    this.camisa = parte(caja, 1, [1.12, 1.03]);
    this.piernas = parte(cil(1, 1, 6), 2);
    this.pies = parte(caja, 2);
    this.cabeza = parte(esfera, 1, [1.14, 1.14]);
    this.ojos = liviano ? null : parte(esfera, 2);
    this.pelo = parte(esfera, 1);
    this.trenzas = liviano ? null : parte(caja, 2);
    this.flor = liviano ? null : parte(octa, 1);
    this.ala = parte(cil(1, 1, 10), 1);
    this.copa = parte(cil(1, 1, 8), 1);
    this.cintas = parte(cil(1, 1, 8), 2);
    this.brazos = parte(cil(1, 1, 5), 2);
    this.manos = parte(octa, 2);
    this.lap = parte(esfera, 1);
  }

  inicio(): void {
    for (const p of this.partes) p.reset();
  }

  fin(contorno: boolean): void {
    const c = contorno && !this.liviano;
    for (const p of this.partes) p.fin(c);
  }

  private poner(p: Parte, M: Matrix4, px: number, py: number, pz: number, sx: number, sy: number, sz: number, c: RGB, mult: RGB, brillo: number): void {
    this.Lm.set(sx, 0, 0, px, 0, sy, 0, py, 0, 0, sz, pz, 0, 0, 0, 1);
    this.Mw.multiplyMatrices(M, this.Lm);
    p.poner(this.Mw, c, mult, brillo);
  }

  private cilindro(p: Parte, a: V3, b: V3, radio: number, c: RGB, mult: RGB, brillo: number): void {
    this.dir.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const largo = this.dir.length();
    if (largo < 1e-6) return;
    this.dir.multiplyScalar(1 / largo);
    this.q.setFromUnitVectors(UP, this.dir);
    this.pm.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
    this.esc.set(radio, largo, radio);
    this.Mw.compose(this.pm, this.q, this.esc);
    p.poner(this.Mw, c, mult, brillo);
  }

  /**
   * Dibuja a una persona. `c` dice dónde está parada y cómo, `levI` y `levD` cuánto levanta cada pie (en bailarines),
   * `sentado` de 0 a 1, `manoI` y `manoD` dónde quedan sus manos en el mundo 3D. `mult` y `brillo` son el tinte de quien
   * ya salió y el realce de quien gana.
   */
  persona(f: PersonaFija, c: Cuerpo, levI: number, levD: number, sentado: number, manoI: V3, manoD: V3, mult: RGB, brillo: number): void {
    const D = c.D;
    const baja = c.baja;
    // El cuerpo de arriba pivota sobre la cadera (se inclina); las piernas, no.
    const { Mup, Mleg, tmp } = this;
    Mup.makeRotationY(c.yaw);
    Mup.premultiply(tmp.makeTranslation(0, -CADERA, 0));
    Mup.premultiply(tmp.makeRotationZ(c.lean));
    Mup.premultiply(tmp.makeScale(D, D, D));
    Mup.premultiply(tmp.makeTranslation(c.fx, c.fy + (CADERA - baja) * D, c.fz));
    Mleg.makeRotationY(c.yaw);
    Mleg.premultiply(tmp.makeScale(D, D, D));
    Mleg.premultiply(tmp.makeTranslation(c.fx, c.fy, c.fz));

    if (sentado <= 0.5) {
      for (let li = 0; li < 2; li++) {
        const lado = li === 0 ? 1 : -1;
        const lev = li === 0 ? levI : levD;
        const tope = f.tipoy ? 0.13 : CADERA - baja;
        const largo = Math.max(0.02, tope - lev);
        const r = f.tipoy ? 0.024 : 0.042;
        this.poner(this.piernas, Mleg, lado * 0.055, lev + largo / 2, 0, r, largo, r, f.tipoy ? f.piel : BLANCO, mult, brillo);
        this.poner(this.pies, Mleg, lado * 0.055, lev + 0.02, 0.035, 0.05, 0.04, 0.11, MARRON, mult, brillo);
      }
    } else {
      // Sentado con las piernas cruzadas: un óvalo blanco.
      this.poner(this.lap, Mleg, 0, 0.075, 0.02, 0.19, 0.075, 0.14, BLANCO, mult, brillo);
    }

    if (f.tipoy) {
      // El tipoy: blanco, de los tobillos al cuello, con la cinta del color de la persona en el escote y en el ruedo.
      const yb = Math.max(0.11, baja + 0.02), yt = 0.78, h = yt - yb;
      this.poner(this.tipoy, Mup, 0, (yb + yt) / 2, 0, 0.23, h, 0.23, BLANCO, mult, brillo);
      const radioEn = (y: number): number => 0.23 - 0.08 * ((y - yb) / h) + 0.012;
      const ye = yt - 0.04, yr = yb + 0.035;
      this.poner(this.cintas, Mup, 0, ye, 0, radioEn(ye), 0.05, radioEn(ye), f.cinta, mult, brillo);
      this.poner(this.cintas, Mup, 0, yr, 0, radioEn(yr), 0.06, radioEn(yr), f.cinta, mult, brillo);
      // El pelo en dos trenzas, y la flor.
      this.poner(this.pelo, Mup, 0, 0.915, -0.012, 0.106, 0.09, 0.108, f.pelo, mult, brillo);
      if (this.trenzas) {
        this.poner(this.trenzas, Mup, 0.1, 0.775, -0.015, 0.034, 0.2, 0.034, f.pelo, mult, brillo);
        this.poner(this.trenzas, Mup, -0.1, 0.775, -0.015, 0.034, 0.2, 0.034, f.pelo, mult, brillo);
      }
      if (this.flor) this.poner(this.flor, Mup, -0.075, 0.975, 0.04, 0.036, 0.036, 0.036, f.flor, mult, brillo);
    } else {
      // La camisa blanca y el pantalón del mismo lienzo; el sombrero de saó con la cinta de su color.
      this.poner(this.camisa, Mup, 0, 0.595, 0, 0.25, 0.37, 0.15, BLANCO, mult, brillo);
      this.poner(this.ala, Mup, 0, 0.955, 0, 0.18, 0.02, 0.18, PAJA, mult, brillo);
      this.poner(this.copa, Mup, 0, 1.005, 0, 0.085, 0.1, 0.085, PAJA, mult, brillo);
      this.poner(this.cintas, Mup, 0, 0.972, 0, 0.089, 0.032, 0.089, f.cinta, mult, brillo);
    }
    this.poner(this.cabeza, Mup, 0, 0.88, 0, 0.1, 0.105, 0.1, f.piel, mult, brillo);
    if (this.ojos) {
      this.poner(this.ojos, Mup, 0.04, 0.892, 0.088, 0.013, 0.013, 0.013, OJOS, mult, 1);
      this.poner(this.ojos, Mup, -0.04, 0.892, 0.088, 0.013, 0.013, 0.013, OJOS, mult, 1);
    }

    // Los brazos: del hombro a la mano, que el cuadro de afuera ya puso donde corresponde (de la mano del vecino, arriba, caídas).
    punto(c, HOMBRO_X, HOMBRO_Y, 0, this.SL);
    punto(c, -HOMBRO_X, HOMBRO_Y, 0, this.SR);
    const manga = f.tipoy ? f.piel : BLANCO;
    this.cilindro(this.brazos, this.SL, manoI, 0.036 * D, manga, mult, brillo);
    this.cilindro(this.brazos, this.SR, manoD, 0.036 * D, manga, mult, brillo);
    this.mano(manoI, 0.04 * D, f.piel, mult, brillo);
    this.mano(manoD, 0.04 * D, f.piel, mult, brillo);
  }

  private mano(m: V3, r: number, c: RGB, mult: RGB, brillo: number): void {
    this.pm.set(m[0], m[1], m[2]);
    this.esc.set(r, r, r);
    this.Mw.compose(this.pm, this.q.identity(), this.esc);
    this.manos.poner(this.Mw, c, mult, brillo);
  }
}

export { BAJA_SENTADO };
