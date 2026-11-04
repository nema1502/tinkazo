import {
  AdditiveBlending, BoxGeometry, BufferGeometry, CanvasTexture, Color, CylinderGeometry, DoubleSide, Float32BufferAttribute, Group, Mesh,
  MeshBasicMaterial, MeshLambertMaterial, RingGeometry, Scene, SphereGeometry, SRGBColorSpace, Sprite, SpriteMaterial, Vector3,
} from "three";
import { BORLA_RADIO } from "./carrera-forma";
import { TAM3D, ZC, type Entrada3D } from "./carrera-3d-mapa";

/**
 * Cómo se marca en el 3D a quien va adelante en este momento.
 *
 * Era una bola amarilla con un halo (la borla del 2D), que se leía como una pelota sobre el lomo y tapaba a la llama.
 * Ahora hay tres marcas pensadas para el 3D, que se eligen con `?lider=` para compararlas:
 *
 * - `aro` (por defecto): un aro dorado en el piso, bajo la llama, con su halo y unos tramos que giran. No tapa a nadie, se
 *   lee desde el fondo de la sala y desde un celular, y la perspectiva lo hace más grande cuanto más cerca está.
 * - `banderin`: un mástil sobre el lomo con un banderín dorado que flamea, más alto que la ficha del nombre.
 * - `manta`: la manta de quien va adelante brilla, con una aureola y unas chispas que suben.
 * - `bola`: la de antes, para comparar.
 *
 * Marca a quien va adelante en el momento, el mismo dato que ya mueve la borla del 2D y la ficha amarilla. No decide quién
 * gana ni lo adelanta: sigue lo que le pasa la escena y nada más. Todo sale de la hora (`e.t`); sin azar.
 */

export type ModoLider = "aro" | "banderin" | "manta" | "bola";
export const MODOS_LIDER: readonly ModoLider[] = ["aro", "banderin", "manta", "bola"];
export const MODO_LIDER_BASE: ModoLider = "aro";

/** El modo pedido por `?lider=`; sin pedirlo, o con algo que no existe, el de siempre. */
export function modoLider(busqueda = typeof location === "undefined" ? "" : location.search): ModoLider {
  const v = new URLSearchParams(busqueda).get("lider");
  return (MODOS_LIDER as readonly string[]).includes(v ?? "") ? (v as ModoLider) : MODO_LIDER_BASE;
}

/** De quien va adelante, lo que la marca necesita de su llama. */
export interface Duenia3D {
  raiz: Group;
  mantaMat: MeshLambertMaterial;
  mantaBase: Color;
}

export interface Contexto3D {
  escena: Scene;
  basura: { add<T extends { dispose(): void }>(x: T): T };
  /** La llama de esa persona, si está en la escena. */
  duenia: (persona: number) => Duenia3D | undefined;
  /** El aviso de tinta que tienen las llamas (el color de la raya). */
  tinta: MeshLambertMaterial;
}

export interface Lider3D {
  /** Dibuja la marca de este cuadro. `s` es la escala de píxeles a unidades del 3D. */
  frame(e: Entrada3D, s: number): void;
  /** Para los auditores: el centro de la marca en el piso, si tiene una (el aro). */
  centro?(): Vector3 | null;
  destruir(): void;
}

const ORO = 0xffc629;
const smooth = (k: number): number => {
  const x = Math.max(0, Math.min(1, k));
  return x * x * (3 - 2 * x);
};
const hash = (a: number, b = 0): number => {
  let h = (Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39) >>> 0;
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
};

/** El tamaño de la llama dueña de la marca (lo que mide el modelo por unidad del dibujo) y dónde está su centro. */
function puesto(e: Entrada3D, s: number, c: Contexto3D): { cx: number; cz: number; esc: number; d: Duenia3D | undefined } {
  const b = e.borla;
  const d = b ? c.duenia(b.duenia) : undefined;
  if (!b) return { cx: 0, cz: 0, esc: 0, d };
  // El 2D pone la borla 2 unidades atrás del centro de la llama (8 en la carrera nueva, con la manta sobre el lomo).
  const esc = d ? d.raiz.scale.x : (b.radio / BORLA_RADIO) * s * (TAM3D / 1.25);
  return { cx: b.x * s + (b.manta ? 8 : 2) * (esc / TAM3D), cz: b.pie * s * ZC, esc, d };
}

/* ====================================================================== el aro */

/** Cuántos segundos tarda el aro en asentarse en su nueva dueña: es lo que dura el salto, y la ficha cambia a la vez que él. */
export const SALTO_ARO = 0.2;
/** El tamaño del aro a los `dt` segundos de cambiar de dueña, respecto del de siempre: arranca 28 % más grande y se asienta con la curva suave. */
export const golpeAro = (dt: number): number => 1 + 0.28 * (1 - smooth(dt / SALTO_ARO));

function aro(c: Contexto3D): Lider3D {
  const B = c.basura;
  let dueno = -1, desde = 0;
  const raiz = new Group();
  raiz.visible = false;
  c.escena.add(raiz);
  const plano = (g: BufferGeometry): BufferGeometry => {
    g.rotateX(-Math.PI / 2);
    return g;
  };
  const oro = B.add(new MeshBasicMaterial({ color: ORO, transparent: true, opacity: 0.96, depthWrite: false, fog: false, side: DoubleSide }));
  const pale = B.add(new MeshBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0.9, depthWrite: false, fog: false, side: DoubleSide }));
  const resplandor = B.add(new MeshBasicMaterial({ color: ORO, transparent: true, opacity: 0.2, depthWrite: false, fog: false, side: DoubleSide }));
  const tinta = B.add(new MeshBasicMaterial({ color: 0x16161f, transparent: true, opacity: 0.5, depthWrite: false, fog: false, side: DoubleSide }));
  // De adentro para afuera: el resplandor, el borde de tinta, el aro, su filo claro y los tramos que giran.
  const mk = (g: BufferGeometry, m: MeshBasicMaterial, y: number, orden: number): Mesh => {
    const me = new Mesh(B.add(plano(g)), m);
    me.position.y = y;
    me.renderOrder = orden;
    raiz.add(me);
    return me;
  };
  mk(new RingGeometry(0, 1, 40, 1), resplandor, 0, 1);
  mk(new RingGeometry(0.6, 1.0, 56, 1), tinta, 0.002, 2);
  mk(new RingGeometry(0.66, 0.95, 56, 1), oro, 0.004, 3);
  mk(new RingGeometry(0.66, 0.74, 56, 1), pale, 0.006, 4);
  const giro = new Group();
  raiz.add(giro);
  for (let i = 0; i < 6; i++) {
    const t = new Mesh(B.add(plano(new RingGeometry(1.06, 1.3, 8, 1, (i * Math.PI) / 3, 0.5))), oro);
    t.position.y = 0.004;
    t.renderOrder = 3;
    giro.add(t);
  }
  return {
    frame(e, s) {
      const p = puesto(e, s, c);
      raiz.visible = !!e.borla && p.esc > 0;
      if (!raiz.visible) return;
      // Quien lo lleva cambia: el aro salta a su lugar de una vez, un poco más grande, y se asienta en un instante, sin viajar de una llama a otra.
      if (e.borla && e.borla.duenia !== dueno) {
        dueno = e.borla.duenia;
        desde = e.t;
      }
      const pulso = (1 + 0.035 * Math.sin(e.t * 5.2)) * golpeAro(e.t - desde);
      // El mismo lugar que la malla de la llama: su x y su z, en el piso. Un óvalo que la abraza de punta a punta y no se mete en el carril de al lado.
      const pos = p.d?.raiz.position;
      raiz.position.set((pos ? pos.x : p.cx) + 1 * p.esc, 0.08 * (p.esc / 0.015), pos ? pos.z : p.cz);
      raiz.scale.set(58 * p.esc * pulso, 1, 27 * p.esc * pulso);
      giro.rotation.y = -e.t * 0.9;
    },
    centro: () => (raiz.visible ? raiz.position : null),
    destruir() {
      c.escena.remove(raiz);
    },
  };
}

/* ================================================================== el banderín */

function banderin(c: Contexto3D): Lider3D {
  const B = c.basura;
  const raiz = new Group();
  raiz.visible = false;
  c.escena.add(raiz);
  const COL = 9;
  const ALTO = 30, LARGO = 50;
  // Un banderín que se afina hacia la punta: se mueve moviendo los vértices con la hora.
  const tela = (): { geo: BufferGeometry; pos: Float32Array } => {
    const geo = new BufferGeometry();
    const pos = new Float32Array((COL + 1) * 2 * 3);
    const idx: number[] = [];
    for (let i = 0; i < COL; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    geo.setAttribute("position", new Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    return { geo: B.add(geo), pos };
  };
  const mover = (t: { geo: BufferGeometry; pos: Float32Array }, e: number, dz: number, margen: number): void => {
    for (let i = 0; i <= COL; i++) {
      const k = i / COL;
      const x = -LARGO * k - margen * (k === 0 ? 0 : 1.2);
      const y = -ALTO * (1 - k * 0.92);
      const z = Math.sin(k * 5.5 - e * 8.5) * 5 * k + dz;
      t.pos.set([x, margen, z], i * 6);
      t.pos.set([x, y - margen, z], i * 6 + 3);
    }
    const a = t.geo.getAttribute("position");
    (a.array as Float32Array).set(t.pos);
    a.needsUpdate = true;
    t.geo.computeVertexNormals();
  };
  const frente = tela(), fondo = tela();
  const matOro = B.add(new MeshBasicMaterial({ color: ORO, side: DoubleSide, fog: false }));
  const matTinta = B.add(new MeshBasicMaterial({ color: 0x16161f, side: DoubleSide, fog: false }));
  const mFondo = new Mesh(fondo.geo, matTinta);
  const mFrente = new Mesh(frente.geo, matOro);
  mFrente.frustumCulled = mFondo.frustumCulled = false;
  const mastil = new Mesh(B.add(new CylinderGeometry(1, 1, 1, 6, 1)), c.tinta);
  mastil.scale.set(1.6, 1, 1.6);
  const punta = new Mesh(B.add(new SphereGeometry(1, 10, 8)), matOro);
  punta.scale.setScalar(3.4);
  const paño = new Group();
  paño.add(mFondo, mFrente);
  raiz.add(mastil, punta, paño);
  const BASE = 46, TOPE = 176;
  mastil.scale.y = TOPE - BASE;
  mastil.position.y = (BASE + TOPE) / 2;
  punta.position.y = TOPE + 2;
  paño.position.set(-1.2, TOPE - 2, 0);
  return {
    frame(e, s) {
      const p = puesto(e, s, c);
      raiz.visible = !!e.borla && p.esc > 0;
      if (!raiz.visible) return;
      raiz.position.set(p.cx - 15 * p.esc, 0, p.cz);
      raiz.scale.setScalar(p.esc);
      // El borde de tinta es el mismo paño, un poco más grande y atrás: el contorno que lo despega del cielo.
      mover(frente, e.t, 0.6, 0);
      mover(fondo, e.t, -0.4, 3.2);
    },
    destruir() {
      c.escena.remove(raiz);
    },
  };
}

/* ====================================================================== la manta */

function mantaBrilla(c: Contexto3D): Lider3D {
  const B = c.basura;
  const lienzo = typeof document === "undefined" ? null : document.createElement("canvas");
  let tex: CanvasTexture | null = null;
  if (lienzo) {
    lienzo.width = lienzo.height = 128;
    const cx = lienzo.getContext("2d");
    if (cx) {
      const g = cx.createRadialGradient(64, 64, 4, 64, 64, 64);
      g.addColorStop(0, "rgba(255,233,168,0.95)");
      g.addColorStop(0.35, "rgba(255,198,41,0.55)");
      g.addColorStop(1, "rgba(255,198,41,0)");
      cx.fillStyle = g;
      cx.fillRect(0, 0, 128, 128);
      tex = B.add(new CanvasTexture(lienzo));
      tex.colorSpace = SRGBColorSpace;
    }
  }
  const raiz = new Group();
  raiz.visible = false;
  c.escena.add(raiz);
  const halo = new Sprite(B.add(new SpriteMaterial({ map: tex, transparent: true, blending: AdditiveBlending, depthWrite: false, fog: false })));
  halo.scale.set(104, 74, 1);
  halo.position.set(0, 46, 0);
  halo.renderOrder = 5;
  raiz.add(halo);
  const chispaGeo = B.add(new BoxGeometry(1, 1, 1));
  const chispaMat = B.add(new MeshBasicMaterial({ color: 0xfff1b8, fog: false }));
  const chispas = Array.from({ length: 7 }, (_, i) => {
    const m = new Mesh(chispaGeo, chispaMat);
    m.userData.i = i;
    raiz.add(m);
    return m;
  });
  const oro = new Color(ORO);
  let dueño = -1, previo = -1, desde = 0;
  const poner = (d: Duenia3D | undefined, k: number, t: number): void => {
    if (!d) return;
    d.mantaMat.color.copy(d.mantaBase).lerp(oro, 0.42 * k);
    d.mantaMat.emissive.set(ORO).multiplyScalar(k * (0.5 + 0.18 * Math.sin(t * 6)));
  };
  return {
    frame(e, s) {
      const b = e.borla;
      if (b && b.duenia !== dueño) {
        previo = dueño;
        dueño = b.duenia;
        desde = e.t;
      }
      const k = smooth((e.t - desde) / 0.3);
      if (previo >= 0) {
        poner(c.duenia(previo), 1 - k, e.t);
        if (k >= 1) {
          poner(c.duenia(previo), 0, e.t);
          previo = -1;
        }
      }
      const p = puesto(e, s, c);
      raiz.visible = !!b && p.esc > 0;
      if (!raiz.visible) return;
      poner(p.d, k, e.t);
      raiz.position.set(p.cx, p.d ? p.d.raiz.position.y : 0, p.cz);
      raiz.scale.setScalar(p.esc);
      halo.material.opacity = k * (0.8 + 0.2 * Math.sin(e.t * 6));
      for (const m of chispas) {
        const i = m.userData.i as number;
        const fase = (e.t * 0.8 + i / chispas.length) % 1;
        const tam = 2.6 * (1 - fase) * k;
        m.position.set((hash(i, 3) - 0.5) * 26, 50 + fase * 48, (hash(i, 7) - 0.5) * 16);
        m.scale.setScalar(Math.max(0.001, tam));
        m.rotation.set(fase * 5, fase * 7, 0);
      }
    },
    destruir() {
      c.escena.remove(raiz);
      poner(c.duenia(dueño), 0, 0);
      poner(c.duenia(previo), 0, 0);
    },
  };
}

/* ======================================================================== la bola */

function bola(c: Contexto3D): Lider3D {
  const B = c.basura;
  let borla: Group | null = null;
  let manta: Group | null = null;
  return {
    frame(e, s) {
      const b = e.borla;
      if (b?.manta) {
        if (!manta) {
          manta = new Group();
          const tira = new Mesh(B.add(new BoxGeometry(2.4, 0.22, 1.7)), B.add(new MeshLambertMaterial({ color: ORO, emissive: 0x4a3600 })));
          const rayaA = new Mesh(B.add(new BoxGeometry(0.2, 0.26, 1.74)), c.tinta);
          rayaA.position.x = -1;
          const rayaB = rayaA.clone();
          rayaB.position.x = 1;
          manta.add(tira, rayaA, rayaB);
          c.escena.add(manta);
        }
        manta.visible = true;
        manta.position.set(b.x * s, b.alto * s * TAM3D, b.pie * s * ZC);
        manta.scale.setScalar(Math.max(0.5, b.radio * s * TAM3D));
      } else if (manta) manta.visible = false;
      if (b && !b.manta) {
        if (!borla) {
          borla = new Group();
          const esfera = new Mesh(B.add(new SphereGeometry(1, 12, 9)), B.add(new MeshLambertMaterial({ color: ORO, emissive: 0x4a3600 })));
          const palo = new Mesh(B.add(new CylinderGeometry(0.1, 0.1, 1, 6)), c.tinta);
          palo.position.y = -0.6;
          const halo = new Mesh(B.add(new SphereGeometry(1.9, 10, 8)), B.add(new MeshBasicMaterial({ color: ORO, transparent: true, opacity: 0.25, depthWrite: false })));
          borla.add(esfera, palo, halo);
          c.escena.add(borla);
        }
        borla.visible = true;
        borla.position.set(b.x * s, b.alto * s * TAM3D, b.pie * s * ZC);
        borla.scale.setScalar(Math.max(0.5, b.radio * s * TAM3D));
      } else if (borla) borla.visible = false;
    },
    destruir() {
      if (borla) c.escena.remove(borla);
      if (manta) c.escena.remove(manta);
    },
  };
}

export function crearLider3D(modo: ModoLider, c: Contexto3D): Lider3D {
  switch (modo) {
    case "banderin": return banderin(c);
    case "manta": return mantaBrilla(c);
    case "bola": return bola(c);
    default: return aro(c);
  }
}
