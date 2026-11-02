import {
  BackSide, BoxGeometry, BufferGeometry, CanvasTexture, CircleGeometry, Color, ConeGeometry, CylinderGeometry, DirectionalLight, DoubleSide,
  Float32BufferAttribute, Fog, Group, HemisphereLight, IcosahedronGeometry, InstancedMesh, Material, Mesh, MeshBasicMaterial, MeshLambertMaterial,
  Object3D, PerspectiveCamera, PlaneGeometry, Scene, SphereGeometry, SRGBColorSpace, Sprite, SpriteMaterial, Texture, Vector3, WebGLRenderer,
} from "three";
import { LLAMA_ALTO } from "./carrera-forma";
import {
  TAM3D, ZC, camara3D, colocar, escala3D,
  type Entrada3D, type Fabrica3D, type Geometria3D, type OpcionesFabrica3D, type Pantalla3D, type Vista3D,
} from "./carrera-3d-mapa";
import { sinAzarDeTres } from "./carrera-3d-ids";
import type { Momento } from "./llama";

/**
 * La carrera de llamas en 3D, con three.js. Prototipo detrás de `?motor=3d`
 * (docs/motores.md, "3D, prototipo").
 *
 * No decide ni calcula nada de la carrera: dibuja lo que la escena 2D
 * (`carrera.ts`) ya puso, desde una cámara con perspectiva que mira lo mismo
 * que el director del 2D (`carrera-3d-mapa.ts`). El estadio de PixiJS queda
 * encima, transparente: el relator, la cinta, el cartel, el foco y los
 * nombres son los de siempre.
 *
 * Sin azar: lo que se mueve es función de la hora del juego (`t`) y lo que
 * parece azar (la tribuna, las piedras) sale de un hash de su lugar.
 */

const hash = (a: number, b = 0): number => {
  let h = (Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39) >>> 0;
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
};

const lerp = (a: number, b: number, k: number): number => a + (b - a) * k;
const GRIS = new Color(0x9d9aa8);

/** Lo que se tira al cerrar: geometrías, materiales y texturas creadas acá. */
class Basura {
  private readonly cosas: { dispose(): void }[] = [];
  add<T extends { dispose(): void }>(x: T): T {
    this.cosas.push(x);
    return x;
  }
  vaciar(): void {
    for (const c of this.cosas) c.dispose();
    this.cosas.length = 0;
  }
}

function lienzo(w: number, h: number): CanvasRenderingContext2D | null {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c.getContext("2d");
}

function texturaDe(cx: CanvasRenderingContext2D, b: Basura): Texture {
  const t = b.add(new CanvasTexture(cx.canvas));
  t.colorSpace = SRGBColorSpace;
  return t;
}

const hex = (c: number): string => `#${c.toString(16).padStart(6, "0")}`;

/* ================================================================= la llama */

interface PataRig {
  cadera: Group;
  rodilla: Group;
}

interface LlamaRig {
  raiz: Group;
  cuerpo: Group;
  cuello: Group;
  orejas: Mesh[];
  cola: Group;
  patas: PataRig[];
  pelaje: MeshLambertMaterial;
  pelajeLejos: MeshLambertMaterial;
  base: Color;
  baseLejos: Color;
  aviso: Sprite;
  avisoMat: SpriteMaterial;
  /** La altura de la cabeza, en unidades del dibujo. */
  cabeza: number;
}

interface Piezas {
  esfera: SphereGeometry;
  cilindro: CylinderGeometry;
  caja: BoxGeometry;
  cono: ConeGeometry;
  sombra: CircleGeometry;
  tinta: MeshLambertMaterial;
  hocico: MeshLambertMaterial;
  sombraMat: MeshBasicMaterial;
  avisos: { "!": Texture | null; "?!": Texture | null; zZ: Texture | null };
}

function crearPiezas(b: Basura): Piezas {
  const sombra = b.add(new CircleGeometry(1, 18));
  sombra.rotateX(-Math.PI / 2);
  const cilindro = b.add(new CylinderGeometry(1, 1, 1, 7, 1));
  const cono = b.add(new ConeGeometry(1, 1, 5, 1));
  cono.translate(0, 0.5, 0);
  const aviso = (txt: string, fondo: number): Texture | null => {
    const cx = lienzo(128, 128);
    if (!cx) return null;
    cx.font = "900 88px system-ui, sans-serif";
    cx.textAlign = "center";
    cx.textBaseline = "middle";
    cx.lineJoin = "round";
    cx.lineWidth = 16;
    cx.strokeStyle = "#16161f";
    cx.strokeText(txt, 64, 70);
    cx.fillStyle = hex(fondo);
    cx.fillText(txt, 64, 70);
    return texturaDe(cx, b);
  };
  return {
    esfera: b.add(new SphereGeometry(1, 10, 8)),
    cilindro,
    caja: b.add(new BoxGeometry(1, 1, 1)),
    cono,
    sombra,
    tinta: b.add(new MeshLambertMaterial({ color: 0x16161f })),
    hocico: b.add(new MeshLambertMaterial({ color: 0x3a2a22 })),
    sombraMat: b.add(new MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false })),
    avisos: { "!": aviso("!", 0xffc629), "?!": aviso("?!", 0xffc629), zZ: aviso("zZ", 0xf3ead8) },
  };
}

const oscurecer = (c: number, f: number): number => {
  const r = Math.min(255, ((c >> 16) & 255) * f), g = Math.min(255, ((c >> 8) & 255) * f), b = Math.min(255, (c & 255) * f);
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b);
};

/** Una llama de pocos polígonos, mirando a +x, con los pies en y = 0 y medida en unidades del dibujo (`LLAMA_ALTO` de alto). */
function crearLlama3D(P: Piezas, b: Basura, color: { pelaje: number; manta: number }): LlamaRig {
  const base = new Color(color.pelaje);
  const baseLejos = new Color(oscurecer(color.pelaje, 0.72));
  const pelaje = b.add(new MeshLambertMaterial({ color: base, flatShading: true }));
  const pelajeLejos = b.add(new MeshLambertMaterial({ color: baseLejos, flatShading: true }));
  const manta = b.add(new MeshLambertMaterial({ color: color.manta, flatShading: true }));
  const raya = b.add(new MeshLambertMaterial({ color: 0xffc629, flatShading: true }));
  const raiz = new Group();
  const sombra = new Mesh(P.sombra, P.sombraMat);
  sombra.scale.set(26, 1, 12);
  sombra.position.y = 0.4;
  raiz.add(sombra);
  const cuerpo = new Group();
  raiz.add(cuerpo);

  const pieza = (geo: BufferGeometry, mat: Material, x: number, y: number, z: number, sx: number, sy: number, sz: number): Mesh => {
    const m = new Mesh(geo, mat);
    m.position.set(x, y, z);
    m.scale.set(sx, sy, sz);
    return m;
  };

  // El torso, la manta de colores y la cola.
  cuerpo.add(pieza(P.esfera, pelaje, 0, 36, 0, 25, 14, 12.5));
  cuerpo.add(pieza(P.caja, manta, 0, 47.5, 0, 30, 3, 21));
  cuerpo.add(pieza(P.caja, manta, 0, 40, 11.2, 30, 15, 2));
  cuerpo.add(pieza(P.caja, manta, 0, 40, -11.2, 30, 15, 2));
  cuerpo.add(pieza(P.caja, raya, 0, 43, 11.6, 30, 2.4, 1.4));
  cuerpo.add(pieza(P.caja, raya, 0, 43, -11.6, 30, 2.4, 1.4));
  const cola = new Group();
  cola.position.set(-24, 40, 0);
  cola.add(pieza(P.esfera, pelaje, -4, -1, 0, 7, 6, 6));
  cuerpo.add(cola);

  // Las patas: cadera y rodilla, en dos partes. Las de ese lado de la pista, más oscuras.
  const patas: PataRig[] = [];
  const pata = (x: number, z: number, lejos: boolean): void => {
    const mat = lejos ? pelajeLejos : pelaje;
    const cadera = new Group();
    cadera.position.set(x, 30, z);
    cadera.add(pieza(P.cilindro, mat, 0, -8.5, 0, 3.6, 17, 3.6));
    const rodilla = new Group();
    rodilla.position.set(0, -15, 0);
    rodilla.add(pieza(P.cilindro, mat, 0, -8, 0, 3, 16, 3));
    rodilla.add(pieza(P.caja, P.tinta, 0.8, -15.5, 0, 7, 3.4, 5));
    cadera.add(rodilla);
    cuerpo.add(cadera);
    patas.push({ cadera, rodilla });
  };
  pata(-12, -6.5, true);
  pata(15, -6.5, true);
  pata(-16, 6.5, false);
  pata(11, 6.5, false);

  // El cuello, la cabeza, el hocico y las orejas.
  const cuello = new Group();
  cuello.position.set(16, 42, 0);
  cuello.add(pieza(P.cilindro, pelaje, 0.5, 18, 0, 5.8, 36, 5.8));
  cuello.add(pieza(P.esfera, pelaje, 6, 38, 0, 11.5, 8.5, 7.5));
  cuello.add(pieza(P.esfera, P.hocico, 14.5, 36, 0, 6, 4.8, 4.8));
  cuello.add(pieza(P.esfera, P.tinta, 8, 41, 6.2, 1.9, 1.9, 1.9));
  cuello.add(pieza(P.esfera, P.tinta, 8, 41, -6.2, 1.9, 1.9, 1.9));
  const orejas: Mesh[] = [];
  for (const [x, z, f] of [[1, 3.2, 1], [5, -3.2, 0.92]] as const) {
    const o = pieza(P.cono, f === 1 ? pelaje : pelajeLejos, x, 43, z, 3.6, 12 * f, 3.4);
    cuello.add(o);
    orejas.push(o);
  }
  cuerpo.add(cuello);

  // El aviso de los sustos y del descanso ("!", "?!", "zZ"), siempre mirando a la cámara.
  const avisoMat = b.add(new SpriteMaterial({ map: null, transparent: true, depthTest: false, fog: false }));
  const aviso = new Sprite(avisoMat);
  aviso.position.set(22, 112, 0);
  aviso.scale.set(38, 38, 1);
  aviso.renderOrder = 10;
  aviso.visible = false;
  raiz.add(aviso);

  return { raiz, cuerpo, cuello, orejas, cola, patas, pelaje, pelajeLejos, base, baseLejos, aviso, avisoMat, cabeza: LLAMA_ALTO };
}

/** La postura: la de `llama.ts` (la misma cuenta, con los ángulos espejados porque acá y es para arriba). */
function poner(r: LlamaRig, P: Piezas, ph: number, speed: number, m: Momento): void {
  const sw = 0.55;
  let lean = speed > 1.25 ? 0.07 : 0;
  let plegada = 0;
  let legA = [Math.sin(ph) * sw, Math.sin(ph + 0.9) * sw, Math.sin(ph + Math.PI) * sw, Math.sin(ph + Math.PI + 0.9) * sw];
  let cuelloRot = Math.sin(ph * 2) * 0.05;
  let aviso: "!" | "?!" | "zZ" | null = null;
  if (m?.kind === "plantada") {
    legA = [0.25, -0.35, 0.25, -0.35];
    lean = -0.1;
    cuelloRot = -0.25;
    aviso = "!";
  } else if (m?.kind === "tropiezo") lean = 0.35 * Math.sin(Math.PI * Math.min(1, m.p * 1.4));
  else if (m?.kind === "escupida") cuelloRot = -0.35 * Math.sin(Math.PI * m.p);
  else if (m?.kind === "escupido") {
    lean = -0.12 * Math.sin(Math.PI * m.p * 3);
    aviso = "?!";
  } else if (m?.kind === "echada") {
    plegada = Math.min(1, m.p);
    cuelloRot = -0.1;
    if (m.p >= 1) aviso = "zZ";
  }
  const fases = [ph, ph + 0.9, ph + Math.PI, ph + Math.PI + 0.9];
  const rigida = m?.kind === "plantada" || speed < 0.1;
  r.patas.forEach((l, i) => {
    const a = plegada ? lerp(legA[i] ?? 0, i % 2 ? 1.25 : -1.25, plegada) : (legA[i] ?? 0);
    const k = plegada ? plegada * (i % 2 ? -1.9 : 1.9) : rigida ? 0 : Math.max(0, -Math.cos(fases[i] ?? 0)) * (i % 2 === 0 ? 1.05 : 0.8);
    l.cadera.rotation.z = -a;
    l.rodilla.rotation.z = -k;
    l.cadera.scale.y = 1 - 0.3 * plegada;
  });
  r.cuerpo.rotation.z = -lean;
  r.cuerpo.position.y = plegada ? -15 * plegada : speed > 0.1 ? Math.abs(Math.sin(ph)) * 4 : 0;
  r.cuello.rotation.z = -cuelloRot;
  r.orejas[0]?.rotation.set(0, 0, Math.sin(ph * 2 + 1) * 0.25);
  r.orejas[1]?.rotation.set(0, 0, Math.sin(ph * 2 + 2) * 0.25);
  r.cola.rotation.z = Math.sin(ph * 2) * 0.4;
  r.pelaje.color.copy(r.base).lerp(GRIS, plegada);
  r.pelajeLejos.color.copy(r.baseLejos).lerp(GRIS, plegada);
  const tex = aviso ? P.avisos[aviso] : null;
  r.aviso.visible = !!tex;
  if (tex) {
    r.avisoMat.map = tex;
    r.avisoMat.needsUpdate = true;
    r.aviso.scale.set(aviso === "!" ? 30 : 44, 38, 1);
  }
}

/* ================================================================= la vista */

interface Colocada {
  rig: LlamaRig;
  cabeza: Vector3;
  pie: Vector3;
  vista: boolean;
}

export const crearVista3D: Fabrica3D = (o: OpcionesFabrica3D): Vista3D => sinAzarDeTres(() => armarVista3D(o));

function armarVista3D(o: OpcionesFabrica3D): Vista3D {
  const renderer = new WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance", preserveDrawingBuffer: !!o.auditar });
  const canvas = renderer.domElement;
  document.getElementById("tres-canvas")?.remove();
  canvas.id = "tres-canvas";
  // Justo debajo del lienzo de PixiJS, que va transparente encima.
  o.lienzoPixi.before(canvas);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  renderer.setPixelRatio(dpr);
  let W = 0, H = 0;

  const escena = new Scene();
  const camara = new PerspectiveCamera(36, 1, 0.5, 4000);
  const basura = new Basura();
  const piezas = crearPiezas(basura);
  // El color del horizonte: donde el cielo y la niebla se juntan.
  const HORIZONTE = new Color(0xd98a64);
  escena.fog = new Fog(HORIZONTE, 110, 650);
  escena.add(new HemisphereLight(0xcfd4ff, 0x6a5a58, 1.35));
  const sol = new DirectionalLight(0xffe2b8, 1.9);
  sol.position.set(-60, 90, 70);
  escena.add(sol);
  escena.add(sol.target);

  let fijo: Group | null = null;
  let fijoBasura = new Basura();
  let cielo: Mesh | null = null;
  let tribuna: { malla: InstancedMesh; base: { x: number; y: number; z: number; ph: number }[]; dummy: Object3D } | null = null;
  const llamas = new Map<number, Colocada>();
  const grupoLlamas = new Group();
  escena.add(grupoLlamas);
  let borla: Group | null = null;

  /* -------------------------------------------------------- lo fijo del mundo */
  function armarMundo(g: Geometria3D): void {
    if (fijo) {
      escena.remove(fijo);
      fijoBasura.vaciar();
    }
    fijoBasura = new Basura();
    const B = fijoBasura;
    fijo = new Group();
    escena.add(fijo);
    tribuna = null;
    const s = escala3D(g.u);
    const X = (px: number): number => px * s;
    const Z = (py: number): number => py * s * ZC;
    const mat = (c: number, extra: { flat?: boolean } = {}): MeshLambertMaterial => B.add(new MeshLambertMaterial({ color: c, flatShading: extra.flat ?? true }));
    const geoCaja = B.add(new BoxGeometry(1, 1, 1));
    const geoCil = B.add(new CylinderGeometry(1, 1, 1, 8, 1));
    const caja = (c: number, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): Mesh => {
      const m = new Mesh(geoCaja, mat(c));
      m.scale.set(Math.max(0.01, x1 - x0), Math.max(0.01, y1 - y0), Math.max(0.01, z1 - z0));
      m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
      fijo?.add(m);
      return m;
    };
    const u = g.u;
    const xMin = X(g.F0 - g.corral - 900 * u), xMax = X(g.metaX + 1500 * u);
    const zTop = Z(g.y0 - 24 * u), zBot = Z(g.y1 + 700 * u);

    // El cielo: una cúpula con degradé que acompaña a la cámara.
    {
      const geo = B.add(new SphereGeometry(2600, 24, 14));
      const pos = geo.getAttribute("position");
      const cols: number[] = [];
      const zen = new Color(0x1d2248), med = new Color(0x4b3b6e), alto = new Color(0x7b4a73), hor = HORIZONTE;
      const c = new Color();
      for (let i = 0; i < pos.count; i++) {
        const k = Math.max(0, Math.min(1, pos.getY(i) / 2600));
        if (k < 0.2) c.copy(hor).lerp(alto, k / 0.2);
        else if (k < 0.5) c.copy(alto).lerp(med, (k - 0.2) / 0.3);
        else c.copy(med).lerp(zen, (k - 0.5) / 0.5);
        cols.push(c.r, c.g, c.b);
      }
      geo.setAttribute("color", new Float32BufferAttribute(cols, 3));
      const m = new Mesh(geo, B.add(new MeshBasicMaterial({ vertexColors: true, side: BackSide, fog: false, depthWrite: false })));
      m.renderOrder = -10;
      cielo = m;
      fijo.add(m);
      // El sol, bajo, en el fondo.
      const sc = new Mesh(B.add(new SphereGeometry(60, 18, 12)), B.add(new MeshBasicMaterial({ color: 0xffe9a8, fog: false })));
      sc.position.set(X(g.metaX) * 0.75, 90, Z(g.y0) - 1500);
      fijo.add(sc);
    }

    // El suelo: la base oscura de todo el paisaje y, encima, una franja por terreno.
    const base = new Mesh(B.add(new PlaneGeometry(xMax - xMin + 4000, 5000)), mat(0x5a4a6e, { flat: false }));
    base.rotation.x = -Math.PI / 2;
    base.position.set((xMin + xMax) / 2, -0.05, zTop - 1500 + 2500);
    fijo.add(base);
    const zonaMedia = (zTop + zBot) / 2;
    for (const z of g.zonas) {
      const a = Math.max(xMin, X(z.desde)), b = Math.min(xMax, X(z.hasta));
      if (b <= a) continue;
      const m = new Mesh(B.add(new PlaneGeometry(b - a, zBot - zTop)), mat(z.color, { flat: false }));
      m.rotation.x = -Math.PI / 2;
      m.position.set((a + b) / 2, 0, zonaMedia);
      fijo.add(m);
      // Una franja oscura en el borde de atrás, como en el 2D.
      caja(0x14141f, a, b, 0, 0.12, zTop, zTop + 0.5);
    }

    // Lo que decora cada terreno: lodo, piedras, matas y rayas de viento, repartidos con un hash del lugar.
    {
      const lista: Record<string, { x: number; z: number; r: number; e: number }[]> = { barro: [], piedras: [], viento: [], cuesta: [], corral: [], recta: [] };
      const T = 150 * u;
      g.zonas.forEach((z, zi) => {
        const a = Math.max(g.F0 - g.corral - 400 * u, z.desde), b = Math.min(g.metaX + 400 * u, z.hasta);
        for (let i = Math.floor(a / T); i * T < b; i++) {
          for (let m = 0; m < 4; m++) {
            const px = i * T + hash(i * 31 + m, zi * 7 + 1) * T;
            if (px < a || px > b) continue;
            const py = lerp(g.y0, g.y1 + 30 * u, hash(i * 17 + m, zi * 5 + 3));
            lista[z.tipo]?.push({ x: X(px), z: Z(py), r: hash(i * 13 + m, zi * 3 + 9), e: z.acento });
          }
        }
      });
      const instanciar = (geo: BufferGeometry, color: number, items: { x: number; z: number; r: number }[], f: (it: { x: number; z: number; r: number }, d: Object3D) => void, flat = true): void => {
        if (!items.length) return;
        const im = new InstancedMesh(geo, mat(color, { flat }), items.length);
        const d = new Object3D();
        items.forEach((it, j) => {
          d.rotation.set(0, 0, 0);
          d.scale.set(1, 1, 1);
          f(it, d);
          d.updateMatrix();
          im.setMatrixAt(j, d.matrix);
        });
        im.instanceMatrix.needsUpdate = true;
        fijo?.add(im);
      };
      const ico = B.add(new IcosahedronGeometry(1, 0));
      const cono = B.add(new ConeGeometry(1, 1, 5));
      const disco = B.add(new CylinderGeometry(1, 1, 1, 10));
      instanciar(ico, 0xcfd2dc, lista.piedras ?? [], (it, d) => {
        d.position.set(it.x, 0.5 + it.r * 0.3, it.z);
        d.scale.set(0.9 + it.r * 1.1, 0.6 + it.r * 0.7, 0.8 + it.r);
        d.rotation.set(it.r * 3, it.r * 7, 0);
      });
      instanciar(disco, 0x3e2a1c, lista.barro ?? [], (it, d) => {
        d.position.set(it.x, 0.06, it.z);
        d.scale.set(1.4 + it.r * 1.6, 0.1, 0.8 + it.r * 0.9);
      });
      instanciar(cono, 0x2f9e44, lista.cuesta ?? [], (it, d) => {
        d.position.set(it.x, 0.6, it.z);
        d.scale.set(0.45, 1.2 + it.r * 0.6, 0.45);
      });
      instanciar(geoCaja, 0xffffff, lista.viento ?? [], (it, d) => {
        d.position.set(it.x, 0.1 + it.r * 0.2, it.z);
        d.scale.set(1.8 + it.r * 2.6, 0.06, 0.1);
      });
    }

    // Los carriles de la recta: rayas blancas, desde un poco antes de los portones hasta la meta.
    {
      const aR = X(Math.max(g.Xs - 160 * u, g.F0)), bR = X(g.metaX);
      const alto = (g.carY1 - g.carY0) / Math.max(1, g.carN);
      for (let j = 0; j <= g.carN; j++) {
        const z = Z(g.carY0 + j * alto);
        caja(0xf4efe6, aR, bR, 0, 0.1, z - 0.13, z + 0.13);
      }
    }

    // Postes con su banderita, uno cada 0,2 anchos de pantalla, en el borde de atrás de la pista.
    {
      const gap = g.pasoPostes;
      for (let i = Math.max(0, Math.floor((g.F0 - 400 * u) / gap)); g.F0 + i * gap < g.metaX - 40 * u; i++) {
        const px = g.F0 + i * gap + gap * 0.5;
        const zona = g.zonas.find((q) => px >= q.desde && px < q.hasta);
        const x = X(px);
        const poste = new Mesh(geoCil, mat(0x16161f));
        poste.scale.set(0.12, 2.6, 0.12);
        poste.position.set(x, 1.3, zTop + 0.6);
        fijo.add(poste);
        const bandera = new Mesh(B.add(triangulo(1.5, 0.9)), B.add(new MeshLambertMaterial({ color: zona?.acento ?? 0xffc629, side: DoubleSide, flatShading: true })));
        bandera.position.set(x + 0.06, 2.55, zTop + 0.6);
        fijo.add(bandera);
      }
    }

    // La salida: línea a cuadros y, atrás, el corral con su cerca.
    {
      const zA = Z(g.y0 - 14 * u), zB = Z(g.y1 + 8 * u);
      const filas = 14;
      const ancho = (zB - zA) / filas;
      for (let i = 0; i < filas; i++) caja(i % 2 ? 0x16161f : 0xffffff, -0.45, 0.45, 0, 0.12, zA + i * ancho, zA + (i + 1) * ancho);
      const x0 = X(-g.corral);
      for (const z of [zA, zB]) {
        caja(0x8a6238, x0, 0, 1.1, 1.4, z - 0.1, z + 0.1);
        caja(0x8a6238, x0, 0, 0.5, 0.8, z - 0.1, z + 0.1);
        for (let px = -g.corral; px <= 0; px += 70 * u) caja(0x6b4a2c, X(px) - 0.1, X(px) + 0.1, 0, 1.6, z - 0.12, z + 0.12);
      }
      if (g.conPorton) {
        const x = X(g.gateX);
        for (const z of [zA, zB]) caja(0x6b4a2c, x - 0.2, x + 0.2, 0, 2.2, z - 0.2, z + 0.2);
      }
      if (g.conPortonesRecta) {
        const x = X(g.Xs);
        const alto = (g.carY1 - g.carY0) / Math.max(1, g.carN);
        for (let j = 0; j <= g.carN; j++) {
          const z = Z(g.carY0 + j * alto);
          caja(0x16161f, x - 0.1, x + 0.1, 0, 1.3, z - 0.1, z + 0.1);
          const bola = new Mesh(B.add(new SphereGeometry(0.28, 8, 6)), mat(0xffc629));
          bola.position.set(x, 1.5, z);
          fijo.add(bola);
        }
      }
      rotulo(g.rotuloSalida, 0xf3ead8, X(26 * u) + 2.6, 2.2, (zA + zB) / 2 - 1, 5.2, 1.3);
    }

    // La meta: línea a cuadros, dos postes, una viga a cuadros y el cartel.
    {
      const xm = X(g.metaX);
      const zA = Z(g.y0 - 14 * u), zB = Z(g.y1 + 8 * u);
      const filas = 14;
      const ancho = (zB - zA) / filas;
      for (let i = 0; i < filas; i++) {
        caja(i % 2 ? 0x16161f : 0xffffff, xm - 0.5, xm, 0, 0.13, zA + i * ancho, zA + (i + 1) * ancho);
        caja(i % 2 ? 0xffffff : 0x16161f, xm, xm + 0.5, 0, 0.13, zA + i * ancho, zA + (i + 1) * ancho);
      }
      const alto = 190 * u * s;
      for (const z of [zA - 0.5, zB + 0.5]) caja(0x16161f, xm - 0.18, xm + 0.18, 0, alto, z - 0.18, z + 0.18);
      const viga = caja(0xffffff, xm - 0.15, xm + 0.15, alto - 1.1, alto, zA - 0.5, zB + 0.5);
      viga.material = B.add(new MeshLambertMaterial({ map: cuadros(Math.max(4, Math.round((zB - zA) / 0.7)), 2, B), flatShading: true }));
      rotulo(g.rotuloMeta, 0xffc629, xm, alto + 1.8, (zA + zB) / 2, Math.max(7, (zB - zA) * 0.5), 2.2);
    }

    // La tribuna del estadio, atrás de la meta, con la gente que salta con la hora del juego.
    {
      const xm = X(g.metaX);
      const x0 = xm - 70, x1 = xm + 38;
      const tiers = 4;
      const baseZ = zTop - 4;
      const dummy = new Object3D();
      const base: { x: number; y: number; z: number; ph: number }[] = [];
      for (let k = 0; k < tiers; k++) {
        const z0 = baseZ - k * 3.2 - 3.2, z1 = baseZ - k * 3.2;
        caja(k % 2 ? 0x3a3a4e : 0x2f2f44, x0, x1, 0, 1.6 + k * 1.5, z0, z1);
        const filas = Math.floor((x1 - x0) / 1.15);
        for (let i = 0; i < filas; i++) {
          if (hash(i * 5 + k, 77) < 0.12) continue;
          base.push({ x: x0 + 0.6 + i * 1.15 + (hash(i, k) - 0.5) * 0.3, y: 1.6 + k * 1.5 + 0.55, z: (z0 + z1) / 2, ph: hash(i, k * 9 + 3) * 6.28 });
        }
      }
      const colores = [0xff4d4d, 0xffc629, 0x2f9e44, 0x4d7cff, 0xf3ead8, 0xd96aa7, 0x7ad0e8];
      const malla = new InstancedMesh(geoCaja, B.add(new MeshLambertMaterial({ flatShading: true })), base.length);
      base.forEach((p, i) => {
        dummy.position.set(p.x, p.y, p.z);
        dummy.scale.set(0.7, 1.05, 0.7);
        dummy.updateMatrix();
        malla.setMatrixAt(i, dummy.matrix);
        malla.setColorAt(i, new Color(colores[Math.floor(hash(i, 5) * colores.length)] ?? 0xffffff));
      });
      malla.instanceMatrix.needsUpdate = true;
      if (malla.instanceColor) malla.instanceColor.needsUpdate = true;
      fijo.add(malla);
      tribuna = { malla, base, dummy };
    }

    // Los cerros del fondo.
    {
      const geo = B.add(new ConeGeometry(1, 1, 6));
      const m1 = mat(0x3a3566), m2 = mat(0x2d2a52);
      for (let i = 0; i < 26; i++) {
        const r = hash(i, 11);
        const h = 50 + r * 120;
        const m = new Mesh(geo, i % 2 ? m1 : m2);
        m.scale.set(80 + hash(i, 12) * 120, h, 70 + hash(i, 13) * 80);
        m.position.set(lerp(xMin, xMax, (i + hash(i, 14) * 0.6) / 26), h / 2 - 2, zTop - 420 - hash(i, 15) * 380);
        fijo.add(m);
      }
    }

    /* -- ayudas de arriba -- */
    function triangulo(w: number, h: number): BufferGeometry {
      const geo = new BufferGeometry();
      geo.setAttribute("position", new Float32BufferAttribute([0, 0, 0, w, -h * 0.4, 0, 0, -h, 0], 3));
      geo.computeVertexNormals();
      return geo;
    }
    function cuadros(nx: number, ny: number, bs: Basura): Texture {
      const cx = lienzo(nx * 16, ny * 16);
      const t = cx ? texturaDe(cx, bs) : null;
      if (cx) {
        for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
          cx.fillStyle = (i + j) % 2 ? "#16161f" : "#ffffff";
          cx.fillRect(i * 16, j * 16, 16, 16);
        }
        if (t) t.needsUpdate = true;
      }
      return t ?? new Texture();
    }
    function rotulo(txt: string, color: number, x: number, y: number, z: number, ancho: number, alto: number): void {
      const cx = lienzo(512, Math.round(512 * (alto / ancho)));
      if (!cx || !fijo) return;
      cx.font = `900 ${Math.round(cx.canvas.height * 0.62)}px system-ui, sans-serif`;
      cx.textAlign = "center";
      cx.textBaseline = "middle";
      cx.lineJoin = "round";
      cx.lineWidth = cx.canvas.height * 0.2;
      cx.strokeStyle = "#16161f";
      cx.strokeText(txt, 256, cx.canvas.height * 0.54);
      cx.fillStyle = hex(color);
      cx.fillText(txt, 256, cx.canvas.height * 0.54);
      const t = texturaDe(cx, B);
      const m = new Mesh(B.add(new PlaneGeometry(ancho, alto)), B.add(new MeshBasicMaterial({ map: t, transparent: true, side: DoubleSide })));
      m.position.set(x, y, z);
      fijo.add(m);
    }
  }
  armarMundo(o.geometria());

  /* ------------------------------------------------------------- el cuadro */
  const v = new Vector3();
  const auditoria = o.auditar ? { cuadros: 0, intervalos: [] as number[], cpu: [] as number[], ultima: 0, t: 0, horas: [] as number[], puestos: [] as { persona: number; x: number; z: number }[] } : null;
  if (auditoria) (window as unknown as { __tres: typeof auditoria }).__tres = auditoria;

  function frame(e: Entrada3D): void {
    sinAzarDeTres(() => cuadro(e));
  }

  function cuadro(e: Entrada3D): void {
    const t0 = auditoria ? performance.now() : 0;
    if (e.w !== W || e.h !== H) {
      W = e.w;
      H = e.h;
      renderer.setSize(W, H, false);
      camara.aspect = W / H;
    }
    const s = escala3D(e.u);

    // Las llamas: se crean cuando aparecen y se tiran cuando se van.
    const vistas = new Set<number>();
    let escSum = 0;
    for (const c of e.gente) {
      vistas.add(c.persona);
      let l = llamas.get(c.persona);
      if (!l) {
        const rig = crearLlama3D(piezas, basura, o.colores(c.persona));
        grupoLlamas.add(rig.raiz);
        l = { rig, cabeza: new Vector3(), pie: new Vector3(), vista: false };
        llamas.set(c.persona, l);
      }
      const p = colocar(c, e.u);
      l.rig.raiz.visible = true;
      l.rig.raiz.position.set(p.x, p.y, p.z);
      l.rig.raiz.scale.setScalar(p.escala);
      poner(l.rig, piezas, c.fase, c.velocidad, c.momento);
      l.pie.set(p.x, p.y, p.z);
      l.cabeza.set(p.x + 6 * p.escala, p.y + l.rig.cabeza * p.escala, p.z);
      escSum += c.esc;
    }
    for (const [persona, l] of [...llamas]) {
      if (vistas.has(persona)) continue;
      grupoLlamas.remove(l.rig.raiz);
      l.rig.pelaje.dispose();
      l.rig.pelajeLejos.dispose();
      l.rig.avisoMat.dispose();
      llamas.delete(persona);
    }

    // La borla del líder.
    if (e.borla) {
      if (!borla) {
        borla = new Group();
        const bola = new Mesh(basura.add(new SphereGeometry(1, 12, 9)), basura.add(new MeshLambertMaterial({ color: 0xffc629, emissive: 0x4a3600 })));
        const palo = new Mesh(basura.add(new CylinderGeometry(0.1, 0.1, 1, 6)), piezas.tinta);
        palo.position.y = -0.6;
        const halo = new Mesh(basura.add(new SphereGeometry(1.9, 10, 8)), basura.add(new MeshBasicMaterial({ color: 0xffc629, transparent: true, opacity: 0.25, depthWrite: false })));
        borla.add(bola, palo, halo);
        escena.add(borla);
      }
      borla.visible = true;
      borla.position.set(e.borla.x * s, e.borla.alto * s * TAM3D, e.borla.pie * s * ZC);
      borla.scale.setScalar(Math.max(0.5, e.borla.radio * s * TAM3D));
    } else if (borla) borla.visible = false;

    // La tribuna salta con la hora: más cuando termina.
    if (tribuna) {
      const fiesta = e.corona >= 0 ? 1 : 0.35;
      const d = tribuna.dummy;
      tribuna.base.forEach((p, i) => {
        d.position.set(p.x, p.y + Math.max(0, Math.sin(e.t * 6 + p.ph)) * 0.4 * fiesta, p.z);
        d.scale.set(0.7, 1.05, 0.7);
        d.updateMatrix();
        tribuna?.malla.setMatrixAt(i, d.matrix);
      });
      tribuna.malla.instanceMatrix.needsUpdate = true;
    }

    // La cámara: la del director del 2D, con perspectiva.
    const esc = e.gente.length ? escSum / e.gente.length : 0.5;
    const pose = camara3D(e.cam, e.w, e.h, e.u, esc);
    camara.fov = (pose.fov * 180) / Math.PI;
    camara.position.set(...pose.pos);
    camara.up.set(Math.sin(pose.giro), Math.cos(pose.giro), 0);
    camara.lookAt(pose.mira[0], pose.mira[1], pose.mira[2]);
    camara.updateProjectionMatrix();
    camara.updateMatrixWorld();
    cielo?.position.copy(camara.position);
    sol.target.position.set(pose.mira[0], 0, pose.mira[2]);
    sol.position.set(pose.mira[0] - 60, 90, pose.mira[2] + 70);

    renderer.render(escena, camara);

    if (auditoria) {
      const ahora = performance.now();
      if (auditoria.ultima) auditoria.intervalos.push(ahora - auditoria.ultima);
      auditoria.ultima = ahora;
      auditoria.cpu.push(ahora - t0);
      auditoria.cuadros++;
      auditoria.horas = e.horas;
      auditoria.t = e.t;
      auditoria.puestos = e.gente.map((c) => ({ persona: c.persona, x: colocar(c, e.u).x, z: colocar(c, e.u).z }));
    }
  }

  function pantallaDe(persona: number): Pantalla3D | null {
    const l = llamas.get(persona);
    if (!l || W === 0) return null;
    v.copy(l.cabeza).project(camara);
    if (v.z > 1) return null;
    const x = ((v.x + 1) / 2) * W, y = ((1 - v.y) / 2) * H;
    v.copy(l.pie).project(camara);
    const yPie = ((1 - v.y) / 2) * H;
    return { x, y, alto: Math.abs(yPie - y) };
  }

  return {
    frame,
    pantallaDe,
    reconstruir(g: Geometria3D) {
      sinAzarDeTres(() => armarMundo(g));
    },
    destruir() {
      for (const l of llamas.values()) {
        l.rig.pelaje.dispose();
        l.rig.pelajeLejos.dispose();
        l.rig.avisoMat.dispose();
      }
      llamas.clear();
      fijoBasura.vaciar();
      basura.vaciar();
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
    },
  };
}
