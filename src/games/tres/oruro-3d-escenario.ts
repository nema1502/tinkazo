import {
  BackSide, BoxGeometry, CanvasTexture, CatmullRomCurve3, CircleGeometry, Color, ConeGeometry, CylinderGeometry, DirectionalLight, Float32BufferAttribute, Fog,
  Group, HemisphereLight, Material, Mesh, MeshBasicMaterial, MeshLambertMaterial, OctahedronGeometry, Points, PointsMaterial, RepeatWrapping, SphereGeometry,
  SRGBColorSpace, TubeGeometry, Vector3, Matrix4, Quaternion, Euler, BufferGeometry as GeoBase, type BufferGeometry, type InstancedMesh,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { escala3D, type Pose3D } from "./camara";
import { Instancias } from "./figuras";
import { hash } from "./ids";
import { Basura, type Motor3D } from "./motor";
import { ZC_ORURO, type EntradaOruro, type MundoOruro } from "./oruro-3d-tipos";

/**
 * La calle de La Entrada en 3D: una noche de carnaval en Oruro, con fachadas coloniales, graderías llenas, el palco,
 * los arcos de plata, las guirnaldas y, al final, el Socavón. Está armada en los mismos píxeles del mundo 2D que usa el
 * juego (`MundoOruro`), pasados al 3D con la cuenta de la casa: `x * s`, `altura * s`, `y * s * zc`.
 *
 * Todo lo que se repite va instanciado: las fachadas, las ventanas, las graderías, el público, las guirnaldas. Nada de
 * esto decide nada: el público salta y las guirnaldas titilan en función de la hora del juego.
 */

/** Los colores del tema: de noche en el oscuro (la luna es la luz principal) y de día, apenas pasado el mediodía, en el claro. */
export interface PaletaOruro {
  cenit: number;
  medio: number;
  alto: number;
  horizonte: number;
  hemiCielo: number;
  hemiSuelo: number;
  hemiFuerza: number;
  luz: number;
  luzFuerza: number;
  /** El tinte que multiplica a los recortes de cartón: la luz de la noche o la del día. */
  tinteCarton: readonly [number, number, number];
  calle: number;
  vereda: number;
  grada: number;
  frente: number;
  /** Cuánto brillan las guirnaldas y las ventanas (de noche, mucho; de día, apenas). */
  luces: number;
  noche: boolean;
}

export const PALETAS: Record<"claro" | "oscuro", PaletaOruro> = {
  oscuro: {
    cenit: 0x0f1433, medio: 0x1d2248, alto: 0x2e2c5c, horizonte: 0x4a3f78,
    hemiCielo: 0xa9b4ea, hemiSuelo: 0x3d3550, hemiFuerza: 1.25, luz: 0xcfd4ff, luzFuerza: 1.35,
    tinteCarton: [0.94, 0.95, 1.0], calle: 0x4a4260, vereda: 0x6a6280, grada: 0x3b3556, frente: 0x2e2a4a, luces: 1, noche: true,
  },
  claro: {
    cenit: 0x6aa8dc, medio: 0xa9d2ea, alto: 0xf1dcc0, horizonte: 0xffe3bd,
    hemiCielo: 0xfff0dc, hemiSuelo: 0xb9a98f, hemiFuerza: 1.5, luz: 0xfff1d6, luzFuerza: 1.6,
    tinteCarton: [1, 0.99, 0.96], calle: 0x8a8298, vereda: 0xa7a0b4, grada: 0x7c80a0, frente: 0x9a94a8, luces: 0.35, noche: false,
  },
};

const PASTEL = [0xe9b8a5, 0xa9d1c4, 0xf3d37c, 0xb9a6e0, 0xf0a3b6, 0x9ec3e6];
/** Los cinco acentos de la marca, apagados un poco, para el toldo del palco y los banderines. */
const ACENTOS = [0xe93d9c, 0xff7a1a, 0x00a896, 0xffc629, 0x6c4ce0];
const CAMISAS = [0xe93d9c, 0xff7a1a, 0x00a896, 0x6c4ce0, 0xffc629, 0xffffff, 0xd52b1e, 0x1c64c8];
const PIELES = [0xf1c27d, 0xc68642, 0x8d5524, 0xe0ac69];

/** Una caja del mundo 2D: x0..x1 a lo largo, y0..y1 a lo ancho de la calle (la y del 2D), h0..h1 de alto. */
type Caja = readonly [number, number, number, number, number, number, number];

/** El empedrado, dibujado en un lienzo chico, una sola vez. */
function texturaEmpedrado(noche: boolean, color: number): CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const cx = c.getContext("2d");
  if (!cx) return null;
  const base = new Color(color);
  const hex = (k: number): string => `#${new Color().copy(base).multiplyScalar(k).getHexString()}`;
  cx.fillStyle = hex(0.82);
  cx.fillRect(0, 0, 256, 256);
  const filas = 8, lado = 256 / filas;
  for (let j = 0; j < filas; j++) {
    for (let i = 0; i < 8; i++) {
      const desf = (j % 2) * (lado / 2);
      const v = 0.9 + hash(i * 7 + j, 3) * 0.22;
      cx.fillStyle = hex(v * (noche ? 1 : 1.04));
      const x = i * lado + desf + 2, y = j * lado + 2;
      cx.beginPath();
      cx.roundRect(x, y, lado - 4, lado - 4, 6);
      cx.fill();
    }
  }
  const t = new CanvasTexture(c);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export interface Luces {
  hemi: HemisphereLight;
  sol: DirectionalLight;
}

/** El cielo, la luna y las estrellas, que siguen a la cámara; las luces y la niebla. */
export function crearCielo(motor: Motor3D, p: PaletaOruro): { seguir(pose: Pose3D): void; luces: Luces; nieblaRgb: [number, number, number]; nieblaCerca: number; nieblaLejos: number } {
  const B = motor.basura;
  const horizonte = new Color(p.horizonte);
  const nieblaCerca = 55, nieblaLejos = 360;
  motor.escena.fog = new Fog(horizonte, nieblaCerca, nieblaLejos);
  const R = 1200;
  const geo = B.add(new SphereGeometry(R, 24, 14));
  const pos = geo.getAttribute("position");
  const cols: number[] = [];
  const c = new Color();
  const cen = new Color(p.cenit), med = new Color(p.medio), alt = new Color(p.alto);
  for (let i = 0; i < pos.count; i++) {
    const k = Math.sqrt(Math.max(0, Math.min(1, pos.getY(i) / R)));
    if (k < 0.18) c.copy(horizonte).lerp(alt, k / 0.18);
    else if (k < 0.5) c.copy(alt).lerp(med, (k - 0.18) / 0.32);
    else c.copy(med).lerp(cen, (k - 0.5) / 0.5);
    cols.push(c.r, c.g, c.b);
  }
  geo.setAttribute("color", new Float32BufferAttribute(cols, 3));
  const cielo = new Mesh(geo, B.add(new MeshBasicMaterial({ vertexColors: true, side: BackSide, fog: false, depthWrite: false })));
  cielo.renderOrder = -10;
  cielo.frustumCulled = false;
  const grupo = new Group();
  grupo.add(cielo);
  if (p.noche) {
    // La luna, fría, y unas estrellas repartidas por hash.
    const luna = new Mesh(B.add(new SphereGeometry(1, 16, 12)), B.add(new MeshBasicMaterial({ color: 0xe8ecff, fog: false, depthWrite: false })));
    luna.position.set(-300, 260, -700);
    luna.scale.setScalar(34);
    luna.renderOrder = -9;
    grupo.add(luna);
    const pts: number[] = [];
    for (let i = 0; i < 140; i++) {
      const a = hash(i, 1) * Math.PI * 2, e = 0.12 + hash(i, 2) * 1.2;
      pts.push(Math.cos(a) * Math.cos(e) * 1100, Math.sin(e) * 1100, Math.sin(a) * Math.cos(e) * 1100);
    }
    const pg = B.add(new GeoBase());
    pg.setAttribute("position", new Float32BufferAttribute(pts, 3));
    const estrellas = new Points(pg, B.add(new PointsMaterial({ color: 0xdfe6ff, size: 2.4, sizeAttenuation: false, fog: false, depthWrite: false })));
    estrellas.frustumCulled = false;
    estrellas.renderOrder = -9;
    grupo.add(estrellas);
  }
  motor.escena.add(grupo);

  const hemi = new HemisphereLight(p.hemiCielo, p.hemiSuelo, p.hemiFuerza);
  const sol = new DirectionalLight(p.luz, p.luzFuerza);
  sol.position.set(-40, 70, 90);
  motor.escena.add(hemi, sol, sol.target);
  return {
    seguir(pose) {
      grupo.position.set(pose.pos[0], pose.pos[1], pose.pos[2]);
      sol.target.position.set(pose.mira[0], 0, pose.mira[2]);
      sol.position.set(pose.mira[0] - 40, 70, pose.mira[2] + 90);
    },
    luces: { hemi, sol },
    nieblaRgb: [horizonte.r, horizonte.g, horizonte.b],
    nieblaCerca,
    nieblaLejos,
  };
}

/** Lo que cambia con el golpe de la luz: guirnaldas apagadas por el silencio, luz del mundo por el golpe. */
export interface EstadoLuz {
  /** 1 todo prendido; 0,4 en el silencio de la banda. */
  guirnaldas: number;
  /** Multiplica la luz del mundo (el golpe la baja). */
  mundo: number;
}

export class Escenario {
  private readonly grupo = new Group();
  private readonly b = new Basura();
  private readonly s: number;
  private readonly zc = ZC_ORURO;
  private publico: { cuerpo: Instancias; cabeza: Instancias } | null = null;
  private guirnaldas: Instancias | null = null;
  private postes: Instancias | null = null;
  private banderas: Instancias | null = null;
  private lucesFijas: { mat: MeshBasicMaterial; base: Color }[] = [];

  constructor(private readonly motor: Motor3D, readonly m: MundoOruro, private readonly p: PaletaOruro) {
    this.s = escala3D(m.k);
    this.armar();
    motor.escena.add(this.grupo);
  }

  /* ----------------------------------------------------------- las cuentas del mundo 2D al 3D */
  private X = (x: number): number => x * this.s;
  private H = (h: number): number => h * this.s;
  private Z = (y: number): number => y * this.s * this.zc;

  private matLambert(): MeshLambertMaterial {
    return this.b.add(new MeshLambertMaterial({ color: 0xffffff, flatShading: true }));
  }

  private geo<T extends BufferGeometry>(g: T): T {
    return this.b.add(g);
  }

  /** Un montón de cajas en una sola malla, cada una de su color. */
  private lote(cajas: readonly Caja[], mat: Material): InstancedMesh | null {
    if (!cajas.length) return null;
    const inst = new Instancias(this.geo(new BoxGeometry(1, 1, 1)), mat, cajas.length, this.b);
    cajas.forEach((c, i) => {
      const [x0, x1, y0, y1, h0, h1, col] = c;
      inst.poner(i, this.X((x0 + x1) / 2), this.H((h0 + h1) / 2), this.Z((y0 + y1) / 2), this.X(x1 - x0), this.H(h1 - h0), this.Z(y1 - y0), 0, col);
    });
    inst.usar(cajas.length);
    inst.fin();
    this.grupo.add(inst.malla);
    return inst.malla;
  }

  private armar(): void {
    const { m, p } = this;
    const k = m.k;
    const { x0, x1, streetTop: top, streetBot: bot } = m;
    const lam = this.matLambert();
    const largo = x1 - x0;

    /* ------------------------------------------------------------------ la calle y la vereda */
    {
      const tex = texturaEmpedrado(p.noche, p.calle);
      if (tex) {
        this.b.add(tex);
        tex.repeat.set(largo / (150 * k), (bot - top + 900 * k) / (75 * k));
      }
      const mat = this.b.add(new MeshLambertMaterial({ color: 0xffffff, map: tex }));
      const calle = new Mesh(this.geo(new BoxGeometry(1, 1, 1)), mat);
      const y0 = top, y1 = bot + 900 * k;
      calle.scale.set(this.X(largo), this.H(8 * k), this.Z(y1 - y0));
      calle.position.set(this.X((x0 + x1) / 2), -this.H(4 * k), this.Z((y0 + y1) / 2));
      this.grupo.add(calle);
    }
    const lineas: Caja[] = [];
    for (let x = x0; x < x1; x += 80 * k) lineas.push([x, x + 28 * k, (top + bot) / 2 - 1.5 * k, (top + bot) / 2 + 1.5 * k, 0, 0.6 * k, 0xe8e2d0]);
    this.lote(lineas, lam);
    // La vereda y su cordón; las graderías en dos escalones.
    this.lote(
      [
        [x0, x1, top - 18 * k, top, 0, 1.5 * k, p.vereda],
        [x0, x1, top - 3 * k, top, 0, 5 * k, 0x2a2438],
        [x0, x1, top - 40 * k, top - 18 * k, 0, 13 * k, p.grada],
        [x0, x1, top - 58 * k, top - 40 * k, 0, 27 * k, p.grada],
      ],
      lam,
    );

    /* ------------------------------------------------------------------ las fachadas */
    const cuerpos: Caja[] = [];
    const ventanas: Caja[] = [];
    const sombrias: Caja[] = [];
    const balcones: Caja[] = [];
    for (let xf = x0, i = 0; xf < x1; i++) {
      const fw = (120 + hash(i, 1) * 90) * k, fh = (150 + hash(i, 2) * 90) * k;
      const alto = 58 * k + fh;
      cuerpos.push([xf, xf + fw, top - 100 * k, top - 58 * k, 0, alto, PASTEL[i % PASTEL.length] as number]);
      cuerpos.push([xf - 1 * k, xf + fw + 1 * k, top - 100 * k, top - 56 * k, alto, alto + 5 * k, 0x2a2438]);
      // Ventanas y balcones, de a pisos.
      for (let wy = 22 * k, fila = 0; wy < fh - 20 * k; wy += 46 * k, fila++) {
        const hTop = alto - wy;
        for (let wx = xf + 16 * k; wx < xf + fw - 30 * k; wx += 36 * k) {
          const enc = hash(Math.round(wx), Math.round(wy)) < 0.6;
          (enc ? ventanas : sombrias).push([wx, wx + 18 * k, top - 58 * k - 1 * k, top - 58 * k + 4 * k, hTop - 26 * k, hTop, enc ? 0xffd27a : 0x3a2f55]);
        }
        balcones.push([xf + 8 * k, xf + fw - 8 * k, top - 59 * k, top - 51 * k, hTop - 32 * k, hTop - 28 * k, 0x2a2438]);
      }
      xf += fw;
    }
    this.lote(cuerpos, lam);
    this.lote(balcones, lam);
    this.lote(sombrias, this.b.add(new MeshBasicMaterial({ color: 0xffffff })));
    const matLuz = this.b.add(new MeshBasicMaterial({ color: 0xffffff }));
    const malla = this.lote(ventanas, matLuz);
    if (malla) this.lucesFijas.push({ mat: matLuz, base: new Color(0xffffff) });

    /* ------------------------------------------------------------------ el palco */
    {
      const pw = 200 * k, px = 0;
      const toldo: Caja[] = [];
      for (let i = 0; i < 8; i++) {
        const xa = px - pw / 2 - 8 * k + i * ((pw + 16 * k) / 8);
        toldo.push([xa, xa + (pw + 16 * k) / 8, top - 76 * k, top - 40 * k, 112 * k, 120 * k, ACENTOS[i % 5] as number]);
      }
      this.lote(
        [
          [px - pw / 2, px + pw / 2, top - 74 * k, top - 42 * k, 0, 52 * k, 0x6b4423],
          [px - pw / 2 + 4 * k, px - pw / 2 + 12 * k, top - 72 * k, top - 64 * k, 52 * k, 112 * k, 0x4a2f1a],
          [px + pw / 2 - 12 * k, px + pw / 2 - 4 * k, top - 72 * k, top - 64 * k, 52 * k, 112 * k, 0x4a2f1a],
          [px - pw / 2 + 4 * k, px - pw / 2 + 12 * k, top - 52 * k, top - 44 * k, 52 * k, 112 * k, 0x4a2f1a],
          [px + pw / 2 - 12 * k, px + pw / 2 - 4 * k, top - 52 * k, top - 44 * k, 52 * k, 112 * k, 0x4a2f1a],
          ...toldo,
        ],
        lam,
      );
    }

    /* ------------------------------------------------------------------ los arcos de plata */
    this.armarArcos(lam);

    /* ------------------------------------------------------------------ el Socavón */
    this.armarSocavon(lam);

    /* ------------------------------------------------------------------ el público y las luces, que se acomodan cada cuadro */
    const caja = this.geo(new BoxGeometry(1, 1, 1));
    const cab = this.geo(new SphereGeometry(1, 6, 5));
    const maxPub = 520;
    this.publico = {
      cuerpo: new Instancias(caja, lam, maxPub, this.b),
      cabeza: new Instancias(cab, lam, maxPub, this.b),
    };
    this.grupo.add(this.publico.cuerpo.malla, this.publico.cabeza.malla);
    this.guirnaldas = new Instancias(this.geo(new OctahedronGeometry(1, 0)), this.b.add(new MeshBasicMaterial({ color: 0xffffff })), 260, this.b);
    this.grupo.add(this.guirnaldas.malla);
    this.postes = new Instancias(this.geo(new CylinderGeometry(1, 1, 1, 6, 1)), lam, 16, this.b);
    this.banderas = new Instancias(caja, this.b.add(new MeshLambertMaterial({ color: 0xffffff, flatShading: true, side: 2 })), 16, this.b);
    this.grupo.add(this.postes.malla, this.banderas.malla);
    void k;
  }

  private armarArcos(lam: MeshLambertMaterial): void {
    const { m } = this;
    const k = m.k;
    const { streetTop: top, streetBot: bot } = m;
    const postes: Caja[] = [];
    const geos: BufferGeometry[] = [];
    const discos: { x: number; y: number; z: number }[] = [];
    const banderines: { x: number; y: number; z: number; c: number }[] = [];
    const altoPoste = 118 * k, sube = 46 * k;
    m.archX.forEach((ax0, a) => {
      const ax = ax0 + 30 * k;
      const za = top + 5 * k, zb = bot - 5 * k;
      postes.push([ax - 4 * k, ax + 4 * k, za - 4 * k, za + 4 * k, 0, altoPoste, 0xc9ccd6], [ax - 4 * k, ax + 4 * k, zb - 4 * k, zb + 4 * k, 0, altoPoste, 0xc9ccd6]);
      // El medio toro: un tubo que sube desde un poste, cruza la calle y baja al otro.
      const pts: Vector3[] = [];
      for (let i = 0; i <= 12; i++) {
        const th = (i / 12) * Math.PI;
        pts.push(new Vector3(this.X(ax), this.H(altoPoste + sube * Math.sin(th)), this.Z((za + zb) / 2 - ((zb - za) / 2) * Math.cos(th))));
      }
      geos.push(new TubeGeometry(new CatmullRomCurve3(pts), 18, this.H(3.2 * k), 5, false));
      for (let i = 1; i <= 7; i++) {
        const th = (i / 8) * Math.PI;
        discos.push({ x: ax, y: altoPoste + sube * Math.sin(th) - 2 * k, z: (za + zb) / 2 - ((zb - za) / 2) * Math.cos(th) });
      }
      for (let i = 0; i < 9; i++) {
        const th = ((i + 0.5) / 9) * Math.PI;
        banderines.push({ x: ax, y: altoPoste + sube * Math.sin(th) - 14 * k, z: (za + zb) / 2 - ((zb - za) / 2) * Math.cos(th), c: (a + i) % 5 });
      }
    });
    this.lote(postes, lam);
    if (geos.length) {
      const toro = this.geo(mergeGeometries(geos) as BufferGeometry);
      for (const g of geos) g.dispose();
      this.grupo.add(new Mesh(toro, this.b.add(new MeshLambertMaterial({ color: 0xd52b1e, flatShading: true }))));
    }
    // Los discos de plata: gris claro, planos, sin brillo.
    if (discos.length) {
      const d = new Instancias(this.geo(new CylinderGeometry(1, 1, 0.3, 10, 1)), lam, discos.length, this.b);
      discos.forEach((q, i) => {
        d.ponerMatriz(i, new MatrizDisco().poner(this.X(q.x), this.H(q.y), this.Z(q.z), this.H(6 * k)), 0xe6e8ee);
      });
      d.usar(discos.length);
      d.fin();
      this.grupo.add(d.malla);
    }
    if (banderines.length) {
      const bi = new Instancias(this.geo(new ConeGeometry(1, 1, 3, 1)), lam, banderines.length, this.b);
      banderines.forEach((q, i) => {
        bi.poner(i, this.X(q.x), this.H(q.y), this.Z(q.z), this.H(3.4 * k), this.H(9 * k), this.H(3.4 * k), 0, ACENTOS[q.c] as number);
      });
      bi.usar(banderines.length);
      bi.fin();
      this.grupo.add(bi.malla);
    }
  }

  /** El Santuario del Socavón: sin cruz ni imágenes, solo la fachada, la torre, el frontón y la puerta. */
  private armarSocavon(lam: MeshLambertMaterial): void {
    const { m, p } = this;
    const k = m.k;
    const cx = m.doorX, top = m.streetTop;
    const crema = 0xfff3d6, roja = 0xd52b1e, tinta = 0x2a2438;
    // Una luz cálida que se le da al templo: de noche lo ilumina el pueblo, no solo la luna.
    const calido = this.b.add(new MeshLambertMaterial({ color: 0xffffff, flatShading: true, emissive: p.noche ? 0x4a3a22 : 0x1a1408 }));
    const yF = top - 20 * k;
    this.lote(
      [
        // El cuerpo, la torre del campanario y su cornisa.
        [cx - 110 * k, cx + 110 * k, top - 100 * k, yF, 0, 230 * k, crema],
        [cx - 150 * k, cx - 90 * k, top - 92 * k, top - 34 * k, 0, 300 * k, crema],
        [cx - 156 * k, cx - 84 * k, top - 98 * k, top - 28 * k, 300 * k, 312 * k, tinta],
        [cx - 116 * k, cx + 116 * k, top - 104 * k, yF + 3 * k, 226 * k, 234 * k, 0xe8dcc0],
        // La puerta y su marco, y los escalones de la plaza.
        [cx - 30 * k, cx + 30 * k, yF - 1 * k, yF + 4 * k, 0, 112 * k, 0x5b3a29],
        [cx - 38 * k, cx - 30 * k, yF - 1 * k, yF + 5 * k, 0, 120 * k, 0xe8dcc0],
        [cx + 30 * k, cx + 38 * k, yF - 1 * k, yF + 5 * k, 0, 120 * k, 0xe8dcc0],
        [cx - 38 * k, cx + 38 * k, yF - 1 * k, yF + 5 * k, 112 * k, 120 * k, 0xe8dcc0],
        [cx - 70 * k, cx + 70 * k, yF, yF + 10 * k, 0, 4 * k, 0xcfc4ae],
        [cx - 62 * k, cx + 62 * k, yF + 10 * k, yF + 18 * k, 0, 2 * k, 0xcfc4ae],
        // Pilastras a los lados de la fachada.
        [cx - 110 * k, cx - 98 * k, yF - 1 * k, yF + 5 * k, 0, 232 * k, 0xe8dcc0],
        [cx + 98 * k, cx + 110 * k, yF - 1 * k, yF + 5 * k, 0, 232 * k, 0xe8dcc0],
      ],
      calido,
    );
    // Las ventanas altas del frente y del campanario, encendidas.
    this.lote(
      [
        [cx - 80 * k, cx - 62 * k, yF - 1 * k, yF + 3 * k, 130 * k, 180 * k, 0xffd27a],
        [cx + 62 * k, cx + 80 * k, yF - 1 * k, yF + 3 * k, 130 * k, 180 * k, 0xffd27a],
        [cx - 140 * k, cx - 100 * k, top - 35 * k, top - 31 * k, 232 * k, 284 * k, 0xffd27a],
      ],
      this.b.add(new MeshBasicMaterial({ color: 0xffffff })),
    );
    // El techo de la torre y el frontón, en prismas.
    const techo = new Mesh(this.geo(new ConeGeometry(1, 1, 4, 1)), this.b.add(new MeshLambertMaterial({ color: roja, flatShading: true })));
    techo.rotation.y = Math.PI / 4;
    techo.scale.set(this.X(46 * k), this.H(56 * k), this.Z(46 * k) * 0.9);
    techo.position.set(this.X(cx - 120 * k), this.H(312 * k), this.Z(top - 63 * k));
    this.grupo.add(techo);
    const fronton = new Mesh(this.geo(new CylinderGeometry(1, 1, 1, 3, 1)), calido);
    fronton.rotation.set(Math.PI / 2, 0, Math.PI / 2);
    fronton.scale.set(this.H(30 * k), this.X(228 * k) / 2, this.Z(80 * k) / 2);
    fronton.position.set(this.X(cx), this.H(262 * k), this.Z(top - 60 * k));
    this.grupo.add(fronton);
    // La ventana redonda de la fachada y el reloj de la torre.
    const vent = new Mesh(this.geo(new CircleGeometry(1, 14)), this.b.add(new MeshBasicMaterial({ color: 0x9ec3e6 })));
    vent.scale.setScalar(this.H(22 * k));
    vent.position.set(this.X(cx), this.H(180 * k), this.Z(yF + 3.2 * k));
    this.grupo.add(vent);
    const campana = new Mesh(this.geo(new CircleGeometry(1, 10)), this.b.add(new MeshBasicMaterial({ color: 0xffc629 })));
    campana.scale.setScalar(this.H(14 * k));
    campana.position.set(this.X(cx - 120 * k), this.H(262 * k), this.Z(top - 30.6 * k));
    this.grupo.add(campana);
    void lam;
  }

  /* ----------------------------------------------------------- cada cuadro */

  /** El público que salta, las guirnaldas que titilan y las pancartas, en función de la hora y de lo que mira la cámara. */
  actualizar(e: EntradaOruro, luz: EstadoLuz): void {
    const { m, p } = this;
    const k = m.k;
    const top = m.streetTop;
    const congelada = e.silencio;
    // Lo que se ve: el ancho que cubre la cámara, con un margen.
    const mitad = (e.w / 2) / Math.max(0.05, e.cam.zoom) * 1.6 + 120 * k;
    const v0 = e.cam.x - mitad, v1 = e.cam.x + mitad;

    // El público de las graderías, en dos filas, saltando.
    if (this.publico) {
      const { cuerpo, cabeza } = this.publico;
      const paso = 13 * k;
      let n = 0;
      for (let fila = 0; fila < 2; fila++) {
        const y = top - 29 * k - fila * 20 * k;
        const hBase = fila === 0 ? 13 * k : 27 * k;
        const esc = k * (1.2 + fila * 0.12);
        for (let i = Math.floor(v0 / paso); i <= Math.ceil(v1 / paso) && n < cuerpo.max; i++) {
          const salto = congelada ? 0 : Math.abs(Math.sin(e.t * 5 + hash(i, fila + 40) * 6)) * 3 * k;
          const x = i * paso + (hash(i, fila + 20) - 0.5) * 5 * k;
          const camisa = CAMISAS[Math.floor(hash(i, fila + 30) * 8)] as number;
          const piel = PIELES[Math.floor(hash(i, fila + 31) * 4)] as number;
          cuerpo.poner(n, this.X(x), this.H(hBase + salto + 5 * esc), this.Z(y), this.X(8 * esc), this.H(10 * esc), this.X(6 * esc), 0, camisa);
          cabeza.poner(n, this.X(x), this.H(hBase + salto + 12.5 * esc), this.Z(y), this.X(3.5 * esc), this.H(3.5 * esc), this.X(3.5 * esc), 0, piel);
          n++;
        }
      }
      cuerpo.usar(n);
      cabeza.usar(n);
      cuerpo.fin();
      cabeza.fin();
    }

    // Las guirnaldas entre las fachadas: titilan; en el silencio de la banda bajan al 40 %.
    if (this.guirnaldas) {
      const ls = 26 * k;
      const acentos = [0xffc629, 0xe93d9c, 0x00a896, 0xff7a1a];
      const g = this.guirnaldas;
      let n = 0;
      for (let i = Math.floor(v0 / ls); i <= Math.ceil(v1 / ls) && n < g.max; i++) {
        const x = i * ls;
        const alto = 112 * k - Math.sin((x / (160 * k)) * Math.PI) * 16 * k;
        const br = (0.55 + 0.45 * Math.sin(e.t * 3 + i)) * p.luces * luz.guirnaldas;
        const c = new Color(acentos[((i % 4) + 4) % 4] as number).multiplyScalar(0.25 + 0.75 * br);
        g.poner(n, this.X(x), this.H(alto), this.Z(top - 46 * k), this.X(6 * k), this.X(6 * k), this.X(6 * k), 0, c.getHex());
        n++;
      }
      g.usar(n);
      g.fin();
    }

    // Las ventanas encendidas siguen la luz del mundo.
    for (const l of this.lucesFijas) l.mat.color.setScalar(0.35 + 0.65 * p.luces * luz.guirnaldas);

    // Las pancartas: un palo con su bandera del color de la fraternidad, que flamea.
    if (this.postes && this.banderas) {
      let n = 0;
      for (const pa of e.pancartas) {
        if (n >= this.postes.max) break;
        const esc = m.escala;
        const alto = 150 * esc;
        this.postes.poner(n, this.X(pa.x), this.H(alto / 2), this.Z(pa.y), this.X(1.6 * esc), this.H(alto), this.X(1.6 * esc), 0, 0x6b4423);
        const flam = Math.sin(e.t * 3 + pa.g) * 0.18;
        this.banderas.poner(n, this.X(pa.x - 15 * esc), this.H(alto - 20 * esc), this.Z(pa.y), this.X(30 * esc), this.H(40 * esc), this.X(1.2 * esc), flam, pa.color);
        n++;
      }
      this.postes.usar(n);
      this.banderas.usar(n);
      this.postes.fin();
      this.banderas.fin();
    }
  }

  destruir(): void {
    this.motor.escena.remove(this.grupo);
    this.b.vaciar();
  }
}

/** Una matriz de disco parado, de cara a la calle (mira a +x). */
class MatrizDisco {
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly e = new Euler(0, 0, Math.PI / 2);
  poner(x: number, y: number, z: number, r: number): Matrix4 {
    this.q.setFromEuler(this.e);
    return this.m.compose(new Vector3(x, y, z), this.q, new Vector3(r, r, r));
  }
}
