import {
  BoxGeometry, BufferAttribute, BufferGeometry, CircleGeometry, Color, ConeGeometry, CylinderGeometry, DoubleSide, Float32BufferAttribute,
  Group, IcosahedronGeometry, InstancedMesh, Line, LineBasicMaterial, LatheGeometry, Matrix4, Mesh, MeshBasicMaterial, MeshLambertMaterial, Object3D,
  CanvasTexture, PlaneGeometry, RingGeometry, SphereGeometry, SpriteMaterial, Sprite, SRGBColorSpace, Vector2, Vector3,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { Mapa } from "./camara";
import { personaFija, type PersonaFija } from "./chovena-3d-gente";
import type { V3 } from "./chovena-3d-brazos";
import type { EntradaChovena } from "./chovena-3d-tipos";
import { hash } from "./ids";
import type { Motor3D } from "./motor";

/**
 * La plaza chiquitana de la chovena: la tierra colorada con la rueda apisonada, las casas de adobe con su corredor de
 * horcones y su techo de teja, la palmera, el toborochi en flor, el cerro de granito, las dos cuerdas de banderines y
 * la tarima con el conjunto. Todo sale de los números que el 2D ya calculó (`plaza`), pasados por el mapa de la casa.
 *
 * Lo quieto se arma una vez y en pocas mallas (las casas, los árboles y los cerros van juntos en geometrías con el color
 * por vértice). Cada cuadro solo se corre y se agranda con la plaza del 2D, y se mecen los banderines con la hora.
 */

type Tema = "claro" | "oscuro";

const TINTA: Record<Tema, number> = { claro: 0x191919, oscuro: 0x16161f };
const TIERRA: Record<Tema, number> = { claro: 0xc4623a, oscuro: 0x8c3f24 };
const APISONADA: Record<Tema, number> = { claro: 0xd98a5f, oscuro: 0xa5573a };
const BORDE: Record<Tema, number> = { claro: 0xe8a77f, oscuro: 0xc27a56 };
const PASTO: Record<Tema, number> = { claro: 0x5e9a46, oscuro: 0x3f6b35 };
const PAREDES: Record<Tema, readonly number[]> = { claro: [0xe9c27f, 0xd9a866, 0xf0d6a2], oscuro: [0xc9a66b, 0xb88f5a, 0xd2b383] };
const ZOCALO: Record<Tema, number> = { claro: 0x8a5a33, oscuro: 0x5a3a22 };
const TEJA: Record<Tema, number> = { claro: 0xb5532f, oscuro: 0x6e2f1e };
const ALERO: Record<Tema, number> = { claro: 0x8f3f22, oscuro: 0x4e2114 };
const HORCON = 0x5a3a22;
const CERRO: Record<Tema, readonly number[]> = { claro: [0x9c8a8f, 0xa8969a], oscuro: [0x4a4066, 0x433a5c] };
const VENTANA: Record<Tema, number> = { claro: 0x3a2a1e, oscuro: 0x6b4a26 };
const LUZ_VENTANA = 0xffc65a;
const FLAGS = [0xe93d9c, 0xffc629, 0x00a896, 0xff7a1a, 0x4361ee, 0xffffff];

const lin = new Color();

/** Geometrías con color por vértice, para juntarlas en una sola malla. */
class Acumulador {
  private readonly lista: BufferGeometry[] = [];
  /** Agrega una geometría ya colocada (con `matriz`) del color `hex`. */
  agregar(g: BufferGeometry, hex: number, matriz?: Matrix4): void {
    const c = g.index ? g.toNonIndexed() : g.clone();
    if (matriz) c.applyMatrix4(matriz);
    lin.setHex(hex);
    const n = c.getAttribute("position").count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      col[i * 3] = lin.r;
      col[i * 3 + 1] = lin.g;
      col[i * 3 + 2] = lin.b;
    }
    c.setAttribute("color", new BufferAttribute(col, 3));
    this.lista.push(c);
  }
  caja(x: number, y: number, z: number, sx: number, sy: number, sz: number, hex: number, ry = 0, rz = 0): void {
    const m = new Matrix4().makeRotationY(ry).premultiply(new Matrix4().makeTranslation(x, y, z));
    if (rz) m.multiply(new Matrix4().makeRotationZ(rz));
    this.agregar(new BoxGeometry(sx, sy, sz), hex, m);
  }
  construir(): BufferGeometry {
    const g = mergeGeometries(this.lista, false);
    if (!g) throw new Error("no se pudo armar la geometría de la plaza");
    this.lista.length = 0;
    return g;
  }
}

/** Las casas de adobe del fondo, en unidades de `hs` (el alto de una casa en el 2D): una hilera larga. */
function armarCasas(tema: Tema): { cuerpo: BufferGeometry; ventanas: BufferGeometry } {
  const a = new Acumulador();
  const v = new Acumulador();
  const paredes = PAREDES[tema];
  let x = -46;
  let i = 0;
  const techo = new ConeGeometry(1, 1, 4, 1);
  techo.rotateY(Math.PI / 4);
  while (x < 46) {
    const ancho = 1.6 + hash(i, 71) * 1.1;
    const alto = 0.72 + hash(i, 72) * 0.12;
    const prof = 1.3;
    const cx = x + ancho / 2;
    a.caja(cx, alto / 2, -prof / 2, ancho, alto, prof, paredes[i % paredes.length] as number);
    a.caja(cx, alto * 0.07, 0.005, ancho + 0.02, alto * 0.14, 0.02, ZOCALO[tema]);
    // El techo de teja, a cuatro aguas, que sale hacia adelante y se apoya en los horcones.
    const rh = 0.36 + hash(i, 73) * 0.1;
    a.agregar(techo, TEJA[tema], new Matrix4().makeScale(ancho * 0.8, rh, prof * 0.82).premultiply(new Matrix4().makeTranslation(cx, alto + rh / 2 - 0.02, -prof / 2 + 0.06)));
    // El corredor: un alero bajo con sus horcones.
    a.caja(cx, alto * 0.97, 0.3, ancho + 0.3, 0.07, 0.95, ALERO[tema]);
    const nh = Math.max(3, Math.round(ancho / 0.55));
    for (let k = 0; k <= nh; k++) a.caja(x + 0.08 + ((ancho - 0.16) * k) / nh, alto * 0.47, 0.72, 0.07, alto * 0.94, 0.07, HORCON);
    // La puerta, y las ventanas con luz tibia de noche.
    a.caja(cx, alto * 0.31, 0.012, ancho * 0.16, alto * 0.62, 0.02, 0x5a3a22);
    v.caja(cx - ancho * 0.29, alto * 0.47, 0.015, ancho * 0.15, alto * 0.3, 0.02, VENTANA[tema]);
    v.caja(cx + ancho * 0.29, alto * 0.47, 0.015, ancho * 0.15, alto * 0.3, 0.02, VENTANA[tema]);
    x += ancho + 0.35;
    i++;
  }
  return { cuerpo: a.construir(), ventanas: v.construir() };
}

/** El toborochi: el tronco de botella con espinas, y la copa rosada. En unidades de `hs`. */
function armarToborochi(tema: Tema): BufferGeometry {
  const a = new Acumulador();
  const perfil = [[0.02, 0], [0.13, 0.05], [0.21, 0.3], [0.16, 0.55], [0.09, 0.8], [0.06, 1.05]].map(([r, y]) => new Vector2(r as number, y as number));
  a.agregar(new LatheGeometry(perfil, 8), tema === "oscuro" ? 0x5f7046 : 0x8aa36b);
  const rosas = [0xff9ccc, 0xff7eb6, 0xe93d9c];
  for (let i = 0; i < 16; i++) {
    const ang = -Math.PI * (0.1 + 0.8 * hash(i, 81));
    const r = 0.35 + 0.35 * hash(i, 82);
    const tam = 0.14 + 0.08 * hash(i, 83);
    const m = new Matrix4().makeScale(tam, tam * 0.85, tam).premultiply(new Matrix4().makeTranslation(Math.cos(ang) * r * 1.4, 1.15 + Math.sin(-ang) * r * 0.7 - 0.1, (hash(i, 84) - 0.5) * 0.6));
    a.agregar(new IcosahedronGeometry(1, 0), rosas[i % 3] as number, m);
  }
  return a.construir();
}

/** Una palmera. En unidades de `hs`. */
function armarPalmera(tema: Tema): BufferGeometry {
  const a = new Acumulador();
  const tronco = [0x7a5a3a, 0x6e5034, 0x7a5a3a];
  for (let i = 0; i < 3; i++) a.caja(i * 0.04, 0.27 + i * 0.52, 0, 0.1 - i * 0.012, 0.56, 0.1 - i * 0.012, tronco[i] as number);
  const verde = tema === "oscuro" ? 0x2f5c2a : 0x3f7d3a;
  for (let i = 0; i < 8; i++) {
    const ang = (i / 8) * Math.PI * 2;
    // Cada hoja: una tira larga que sale de la copa y cae hacia afuera.
    const m = new Matrix4().makeTranslation(0.5, -0.05, 0).premultiply(new Matrix4().makeRotationZ(-0.35)).premultiply(new Matrix4().makeRotationY(ang)).premultiply(new Matrix4().makeTranslation(0.08, 1.58, 0));
    a.agregar(new BoxGeometry(1.0, 0.03, 0.18), verde, m);
  }
  return a.construir();
}

function armarCerros(tema: Tema): BufferGeometry {
  const a = new Acumulador();
  const col = CERRO[tema];
  const domo = (x: number, z: number, rx: number, ry: number, rz: number, c: number): void => {
    const g = new SphereGeometry(1, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2);
    a.agregar(g, c, new Matrix4().makeScale(rx, ry, rz).premultiply(new Matrix4().makeTranslation(x, 0, z)));
  };
  domo(9, -7, 6.5, 3.6, 4, col[0] as number);
  domo(-15, -9, 5, 2.7, 3.4, col[1] as number);
  domo(27, -10, 7, 3, 4, col[1] as number);
  return a.construir();
}

/** El conjunto de la tarima: lo que se anima con la música. */
interface BandaPartes {
  tarima: Mesh;
  bombo: Mesh;
  bomboParche: Mesh;
  caja: Mesh;
  flauta: Mesh;
  palillos: Mesh[];
  maza: Mesh;
  mazaBola: Mesh;
}

const UNO = new Object3D();

export interface Plaza {
  /** Acomoda lo quieto y mece lo que se mueve para este cuadro. */
  actualizar(e: EntradaChovena, mapa: Mapa): void;
  /** Los tres músicos de la tarima para este cuadro. */
  musicos(e: EntradaChovena, mapa: Mapa): Musico[];
}

export interface Musico {
  fija: PersonaFija;
  /** Los pies, el tamaño, la inclinación y las manos, en el mundo 3D. */
  fx: number;
  fy: number;
  fz: number;
  D: number;
  lean: number;
  manoI: V3;
  manoD: V3;
}

const MUSICOS: { x: number; color: number; piel: number }[] = [
  { x: -0.38, color: 0xe93d9c, piel: 0 },
  { x: 0, color: 0x00a896, piel: 1 },
  { x: 0.38, color: 0xff7a1a, piel: 2 },
];

export function crearPlaza(motor: Motor3D): Plaza {
  const B = motor.basura;
  const tema = motor.tema;
  const escena = motor.escena;
  const lamb = (c: number): MeshLambertMaterial => B.add(new MeshLambertMaterial({ color: c, flatShading: true }));
  const vert = B.add(new MeshLambertMaterial({ vertexColors: true, flatShading: true, side: DoubleSide }));

  /* ------------------------------------------------------------- el suelo */
  const tierra = new Mesh(B.add(new PlaneGeometry(900, 900)), lamb(TIERRA[tema]));
  tierra.rotation.x = -Math.PI / 2;
  escena.add(tierra);
  const sueloG = new Group();
  escena.add(sueloG);
  const disco = new Mesh(B.add(new CircleGeometry(1.12, 56)), B.add(new MeshLambertMaterial({ color: APISONADA[tema], polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })));
  disco.rotation.x = -Math.PI / 2;
  disco.position.y = 0.0004;
  sueloG.add(disco);
  const borde = new Mesh(B.add(new RingGeometry(1.1, 1.135, 64)), B.add(new MeshBasicMaterial({ color: BORDE[tema], polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 })));
  borde.rotation.x = -Math.PI / 2;
  borde.position.y = 0.0006;
  sueloG.add(borde);
  const aro = new Mesh(B.add(new RingGeometry(0.595, 0.605, 64)), B.add(new MeshBasicMaterial({ color: BORDE[tema], transparent: true, opacity: 0.5, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 })));
  aro.rotation.x = -Math.PI / 2;
  aro.position.y = 0.0006;
  sueloG.add(aro);
  // Las matas de pasto de afuera de la plaza.
  const mata = B.add(new ConeGeometry(0.012, 0.05, 4, 1));
  mata.translate(0, 0.025, 0);
  const pastos = new InstancedMesh(mata, lamb(PASTO[tema]), 90);
  pastos.frustumCulled = false;
  const dummy = new Object3D();
  let np = 0;
  for (let i = 0; i < 160 && np < 90; i++) {
    const px = (hash(i, 61) - 0.5) * 7, pz = -2.1 + hash(i, 62) * 4.6;
    if ((px / 1.25) ** 2 + (pz / 1.25) ** 2 < 1) continue;
    dummy.position.set(px, 0, pz);
    dummy.rotation.set(0, hash(i, 63) * 6, 0);
    dummy.scale.setScalar(0.7 + hash(i, 64) * 0.8);
    dummy.updateMatrix();
    pastos.setMatrixAt(np++, dummy.matrix);
  }
  pastos.count = np;
  B.add({ dispose: () => pastos.dispose() });
  sueloG.add(pastos);

  /* ---------------------------------------------------- casas, árboles y cerros */
  const casasG = new Group();
  escena.add(casasG);
  const casas = armarCasas(tema);
  casasG.add(new Mesh(B.add(casas.cuerpo), vert));
  casasG.add(new Mesh(B.add(casas.ventanas), B.add(new MeshLambertMaterial({ color: 0xffffff, vertexColors: true, flatShading: true, emissive: tema === "oscuro" ? LUZ_VENTANA : 0x000000, emissiveIntensity: 0.45 }))));
  const cerros = new Mesh(B.add(armarCerros(tema)), vert);
  cerros.position.z = -4;
  casasG.add(cerros);
  const toborochi = new Mesh(B.add(armarToborochi(tema)), vert);
  const palmera = new Mesh(B.add(armarPalmera(tema)), vert);
  escena.add(toborochi, palmera);

  /* --------------------------------------------------------- los banderines */
  const NF = 28;
  const triangulo = B.add(new BufferGeometry());
  triangulo.setAttribute("position", new Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, 0, -1.1, 0], 3));
  triangulo.computeVertexNormals();
  const flags = new InstancedMesh(triangulo, B.add(new MeshBasicMaterial({ side: DoubleSide })), NF * 2);
  flags.frustumCulled = false;
  B.add({ dispose: () => flags.dispose() });
  const cc = new Color();
  for (let i = 0; i < NF * 2; i++) flags.setColorAt(i, cc.setHex(FLAGS[(i + (i >= NF ? 3 : 0)) % FLAGS.length] as number));
  if (flags.instanceColor) flags.instanceColor.needsUpdate = true;
  escena.add(flags);
  const cuerdaMat = B.add(new LineBasicMaterial({ color: TINTA[tema] }));
  const cuerdas = [0, 1].map(() => {
    const g = B.add(new BufferGeometry());
    g.setAttribute("position", new Float32BufferAttribute(new Float32Array(3 * (NF + 1)), 3));
    const l = new Line(g, cuerdaMat);
    l.frustumCulled = false;
    escena.add(l);
    return l;
  });

  /* -------------------------------------------------------- las notas que suben */
  // Mientras suena, cinco notas suben de la tarima; con el corte no hay ninguna.
  const notas: Sprite[] = [];
  {
    const lienzo = typeof document !== "undefined" ? document.createElement("canvas") : null;
    const cx2 = lienzo?.getContext("2d");
    let tex: CanvasTexture | null = null;
    if (lienzo && cx2) {
      lienzo.width = lienzo.height = 64;
      cx2.fillStyle = tema === "oscuro" ? "#f6efe2" : "#191919";
      cx2.beginPath();
      cx2.ellipse(24, 46, 11, 8, -0.3, 0, Math.PI * 2);
      cx2.fill();
      cx2.lineWidth = 5;
      cx2.strokeStyle = cx2.fillStyle;
      cx2.beginPath();
      cx2.moveTo(34, 44);
      cx2.lineTo(34, 12);
      cx2.lineTo(50, 22);
      cx2.stroke();
      tex = B.add(new CanvasTexture(lienzo));
      tex.colorSpace = SRGBColorSpace;
    }
    for (let i = 0; i < 5; i++) {
      const sp = new Sprite(B.add(new SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false, opacity: 0 })));
      sp.visible = false;
      escena.add(sp);
      notas.push(sp);
    }
  }

  /* --------------------------------------------------------- la tarima y el conjunto */
  const madera = lamb(0x7a5a3a);
  const marron = lamb(0x5a3a22);
  const parche = B.add(new MeshLambertMaterial({ color: 0xf6efe2, flatShading: true }));
  const bombo = lamb(0xb5532f);
  const roja = lamb(0xd7263d);
  const cuero = lamb(0xf0e6d2);
  const cilBase = B.add(new CylinderGeometry(1, 1, 1, 10, 1));
  const cajaBase = B.add(new BoxGeometry(1, 1, 1));
  const esferaBase = B.add(new SphereGeometry(1, 8, 6));
  const mk = (g: BufferGeometry, m: MeshLambertMaterial): Mesh => {
    const x = new Mesh(g, m);
    x.frustumCulled = false;
    escena.add(x);
    return x;
  };
  const banda: BandaPartes = {
    tarima: mk(cajaBase, madera),
    bombo: mk(cilBase, bombo),
    bomboParche: mk(cilBase, parche),
    caja: mk(cilBase, cuero),
    flauta: mk(cilBase, lamb(0xd9b26a)),
    palillos: [mk(cilBase, marron), mk(cilBase, marron)],
    maza: mk(cilBase, marron),
    mazaBola: mk(esferaBase, parche),
  };
  void roja;
  const fijas = MUSICOS.map((m) => personaFija(false, m.color, m.piel, 0, 0));

  const UPV = new Vector3(0, 1, 0);
  const dv = new Vector3();
  /** Pone un cilindro de radio `r` entre los puntos `a` y `b`. */
  const poner = (m: Mesh, a: V3, b: V3, r: number): void => {
    dv.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const largo = dv.length();
    UNO.position.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
    UNO.scale.set(r, Math.max(1e-5, largo), r);
    if (largo > 1e-6) UNO.quaternion.setFromUnitVectors(UPV, dv.multiplyScalar(1 / largo));
    UNO.updateMatrix();
    m.matrixAutoUpdate = false;
    m.matrix.copy(UNO.matrix);
    m.matrixWorldNeedsUpdate = true;
  };

  const musicos: Musico[] = MUSICOS.map((_, i) => ({ fija: fijas[i] as PersonaFija, fx: 0, fy: 0, fz: 0, D: 1, lean: 0, manoI: [0, 0, 0], manoD: [0, 0, 0] }));
  const tmp: [V3, V3, V3, V3] = [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]];

  return {
    actualizar(e, mapa) {
      const P = e.plaza;
      const s = mapa.s;
      const [cx3, , cz3] = mapa.a3D(P.cx, P.cy);
      const R = P.rx * s;
      sueloG.position.set(cx3, 0, cz3);
      sueloG.scale.setScalar(R);
      const [hx, , hz] = mapa.a3D(P.cx, P.yB);
      casasG.position.set(hx, 0, hz);
      casasG.scale.setScalar(P.hs * s * 0.82);
      const [tx, , tz] = mapa.a3D(P.cx + P.rx * 1.18, P.yB + P.hs * 0.25);
      toborochi.position.set(tx, 0, tz);
      toborochi.scale.setScalar(P.hs * s);
      const [px, , pz] = mapa.a3D(P.cx - P.rx * 1.2, P.yB + P.hs * 0.3);
      palmera.position.set(px, 0, pz);
      palmera.scale.setScalar(P.hs * s);

      // Los banderines: dos cuerdas cruzadas sobre el fondo de la plaza, que se mecen con la hora.
      const D = P.dh * s;
      const t = e.t;
      for (let c = 0; c < 2; c++) {
        const z0 = cz3 - (c === 0 ? 1.55 : 1.05) * R, z1 = cz3 - (c === 0 ? 1.05 : 1.55) * R;
        const x0 = cx3 - 2.4 * R, x1 = cx3 + 2.4 * R;
        const alto = (1.85 + c * 0.3) * D;
        const hundida = 0.5 * D;
        const punto = (f: number): V3 => [x0 + (x1 - x0) * f, alto - hundida * 4 * f * (1 - f) + Math.sin(t * 1.4 + f * 9 + c) * 0.03 * D, z0 + (z1 - z0) * f];
        const pos = (cuerdas[c] as Line).geometry.getAttribute("position");
        for (let k = 0; k <= NF; k++) {
          const q = punto(k / NF);
          pos.setXYZ(k, q[0], q[1], q[2]);
        }
        pos.needsUpdate = true;
        for (let k = 0; k < NF; k++) {
          const q = punto((k + 0.5) / NF), r = punto((k + 0.95) / NF);
          const ancho = Math.hypot(r[0] - q[0], r[2] - q[2]) * 0.5;
          const mecer = Math.sin(t * 2.2 + k * 1.7 + c) * 0.25;
          UNO.position.set(q[0], q[1], q[2]);
          UNO.rotation.set(mecer, Math.atan2(r[0] - q[0], r[2] - q[2]) - Math.PI / 2, 0);
          UNO.scale.set(ancho, ancho * 0.9, ancho);
          UNO.updateMatrix();
          flags.setMatrixAt(c * NF + k, UNO.matrix);
        }
      }
      flags.instanceMatrix.needsUpdate = true;

      // Las notas que suben de la tarima, con la música.
      const toca = e.banda.toca;
      notas.forEach((sp, i) => {
        const f = (t * 0.55 + i / 5) % 1;
        sp.visible = toca;
        if (!toca) return;
        const nx = P.cx + (hash(i, 91) - 0.5) * P.dh * 1.4 + Math.sin(t * 2 + i) * P.dh * 0.05;
        const [x, y, z] = mapa.a3D(nx, P.cy - 1.3 * P.ry, (1.15 + f * 1.1) * P.dh);
        sp.position.set(x, y, z);
        sp.scale.setScalar(0.34 * D);
        (sp.material as SpriteMaterial).opacity = Math.sin(f * Math.PI) * 0.9;
      });
    },
    musicos(e, mapa) {
      const P = e.plaza;
      const Bp = 0.86 * P.dh;
      const by = P.cy - 1.3 * P.ry;
      const s = mapa.s;
      const en = (X: number, Y: number, Z = 0, out: V3 = [0, 0, 0]): V3 => {
        const [x, y, z] = mapa.a3D(P.cx + X * Bp, by, Y * Bp);
        out[0] = x;
        out[1] = y;
        out[2] = z + Z * Bp * s;
        return out;
      };
      // La tarima.
      const [tx, ty, tz] = en(0, 0.01);
      banda.tarima.position.set(tx, ty, tz);
      banda.tarima.scale.set(1.24 * Bp * s, 0.1 * Bp * s, 0.5 * Bp * s);
      const toca = e.banda.toca;
      const pulso = e.banda.pulso;
      const sb = Math.sin(Math.PI * pulso);
      MUSICOS.forEach((m, i) => {
        const o = musicos[i] as Musico;
        const rebote = toca ? Math.abs(Math.sin(Math.PI * pulso + i)) * 0.02 : 0;
        const f = en(m.x, 0.06 + rebote);
        o.fx = f[0];
        o.fy = f[1];
        o.fz = f[2];
        o.D = Bp * s;
        o.lean = toca ? Math.sin(Math.PI * pulso + i * 1.7) * 0.03 : 0;
      });
      // El pífano: del labio hacia adelante y abajo, con las dos manos encima.
      const fy = toca ? sb * 0.008 : 0;
      const [m0, m1, m2] = [MUSICOS[0] as (typeof MUSICOS)[0], MUSICOS[1] as (typeof MUSICOS)[0], MUSICOS[2] as (typeof MUSICOS)[0]];
      const boca = en(m0.x - 0.0, 0.86 + fy, 0.1, tmp[0]);
      const punta = en(m0.x + 0.15, 0.56 + fy, 0.17, tmp[1]);
      poner(banda.flauta, boca, punta, 0.016 * Bp * s);
      const o0 = musicos[0] as Musico;
      en(m0.x + 0.05, 0.76 + fy, 0.13, o0.manoI);
      en(m0.x + 0.1, 0.66 + fy, 0.15, o0.manoD);
      // La caja colgada, y los palillos: repiquetean, o quedan arriba en el corte (es la señal).
      const o1 = musicos[1] as Musico;
      const cja = en(m1.x - 0.06, 0.5, 0.16, tmp[2]);
      banda.caja.position.set(cja[0], cja[1], cja[2]);
      banda.caja.scale.set(0.1 * Bp * s, 0.12 * Bp * s, 0.1 * Bp * s);
      banda.caja.rotation.set(0, 0, 0);
      banda.caja.matrixAutoUpdate = true;
      const golpe = toca ? Math.abs(Math.sin(Math.PI * pulso * 2)) : 0;
      [1, -1].forEach((lado, k) => {
        const sube = toca ? 0 : 1;
        const ma = lado > 0 ? o1.manoI : o1.manoD;
        const hx = m1.x + lado * 0.1;
        en(hx, 0.6 + sube * 0.24 + (lado > 0 ? golpe : 1 - golpe) * (toca ? 0.05 : 0), 0.12, ma);
        const punta2 = toca ? en(m1.x - 0.06 + lado * 0.04, 0.58 + (lado > 0 ? golpe : 1 - golpe) * 0.1, 0.16, tmp[3]) : en(hx + lado * 0.04, 1.1, 0.12, tmp[3]);
        poner(banda.palillos[k] as Mesh, ma, punta2, 0.012 * Bp * s);
      });
      // El bombo y su maza: la maza sube y baja con cada golpe fuerte.
      const o2 = musicos[2] as Musico;
      const bm = en(m2.x + 0.03, 0.44, 0.18, tmp[0]);
      banda.bombo.position.set(bm[0], bm[1], bm[2]);
      banda.bombo.scale.set(0.16 * Bp * s, 0.26 * Bp * s, 0.16 * Bp * s);
      banda.bombo.matrixAutoUpdate = true;
      const parcheP = en(m2.x + 0.03, 0.575, 0.18, tmp[1]);
      banda.bomboParche.position.set(parcheP[0], parcheP[1], parcheP[2]);
      banda.bomboParche.scale.set(0.15 * Bp * s, 0.012 * Bp * s, 0.15 * Bp * s);
      banda.bomboParche.matrixAutoUpdate = true;
      const fuerte = toca ? Math.max(0, Math.cos(Math.PI * pulso)) : 0;
      en(m2.x + 0.1, 0.66 + fuerte * 0.12, 0.14, o2.manoI);
      en(m2.x - 0.08, 0.55, 0.15, o2.manoD);
      const topeMaza = en(m2.x + 0.14, 0.66 + fuerte * 0.12 + 0.2, 0.12, tmp[2]);
      poner(banda.maza, o2.manoI, topeMaza, 0.012 * Bp * s);
      banda.mazaBola.position.set(topeMaza[0], topeMaza[1], topeMaza[2]);
      banda.mazaBola.scale.setScalar(0.035 * Bp * s);
      banda.mazaBola.matrixAutoUpdate = true;
      return musicos;
    },
  };
}
