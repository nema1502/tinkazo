import {
  CanvasTexture, DoubleSide, DynamicDrawUsage, InstancedBufferGeometry, InstancedInterleavedBuffer, InterleavedBufferAttribute, LinearFilter,
  LinearMipmapLinearFilter, Mesh, ShaderMaterial, Uint16BufferAttribute, Float32BufferAttribute, Vector2, Vector3, type Texture as TexturaTres,
} from "three";
import { Container, Rectangle, Sprite, Texture } from "pixi.js";
import { pose, poseMusician, type DancerParts, type Instrument, type MusicianParts } from "../pixi/entrada-bailes";
import type { Basura, Motor3D } from "./motor";
import {
  ANCLA_X, ANCLA_Y, CELDA_H, CELDA_W, N_BAILE, N_CAIDA, N_MUSICA, N_SALUDO, N_TROPIEZO, type RepartoOruro,
} from "./oruro-3d-tipos";

/**
 * Los recortes de cartón de La Entrada: cada bailarín es un plano vertical que mira a la cámara, con su dibujo del 2D
 * (revisado, con su respeto) como textura, parado en la calle. Se arma así:
 *
 * 1. `hornear` pasa a un atlas, una sola vez al arrancar, los cuadros de cada traje: el ciclo del paso (16 cuadros), el
 *    saludo, y para la fraternidad del final también el salto, el tropezón, la caída y la cabeza aparte. Los pinta el mismo
 *    ropero y la misma `pose` del 2D, así que el cartón es el dibujo de siempre.
 * 2. `Recortes` dibuja todos con una malla instanciada por atlas: un solo dibujo para doscientos bailarines. La
 *    posición, la inclinación y el salto vienen del 2D en cada cuadro; el cuadro del ciclo sale de la fase del paso.
 */

/** Un cuadro del atlas: en qué atlas está y su rectángulo en coordenadas de textura (la v crece hacia arriba). */
export interface Cel {
  a: number;
  u0: number;
  v0: number;
  du: number;
  dv: number;
}

export interface ClaseCeldas {
  baile: Cel[];
  saludo: Cel[];
  salto: Cel[];
  /** Por hacia dónde se cae: [-1, 1]. */
  tropiezo: [Cel[], Cel[]];
  caida: [Cel[], Cel[]];
  /** Lo que lleva en la cabeza, solo, para que vuele en la caída. */
  cabeza: Cel | null;
}

export interface Atlas {
  texturas: TexturaTres[];
  clases: Map<number, ClaseCeldas>;
  banda: Map<Instrument, Cel[]>;
  /** El músico quieto (la banda se calló). */
  quieto: Map<Instrument, Cel>;
  /** Cuántos píxeles de atlas por unidad del dibujo, en cada atlas. */
  res: number[];
  /** Dónde lleva cada traje el retrato de quien lo baila, en unidades del dibujo respecto de los pies (y hacia abajo es negativa), y cuánto mide. */
  pecho: Map<number, { x: number; y: number; w: number }>;
  /** El retrato de cada persona (por su lugar en la lista) en el atlas de caras. */
  caras: Cel[];
  /** Cuánto tardó el horneado, en milisegundos. */
  ms: number;
  celdas: number;
}

/** El atlas de las caras es la tercera textura: `Cel.a` vale esto. */
export const ATLAS_CARAS = 2;

export const claseId = (g: number, mujer: boolean): number => g * 2 + (mujer ? 1 : 0);

const DOS_PI = Math.PI * 2;
/** El desfase propio de los cuerpos del atlas: alcanza uno solo, el traje es el mismo. */
const SEMILLA = 0.37;
/** Lo que gira por segundo lo que se lleva en la mano (la matraca, la honda): en el atlas da una vuelta por ciclo. */
const GIRO: Record<string, number> = { morenada: 9, llamerada: 11 };

/** Las medidas de una celda a `res` píxeles por unidad del dibujo, y cuántas entran en un cuadrado de `lado`. */
function celdasEn(res: number, lado: number): { cw: number; ch: number; cols: number; cabe: number } {
  const cw = Math.ceil(CELDA_W * res), ch = Math.ceil(CELDA_H * res);
  const cols = Math.floor(lado / cw);
  return { cw, ch, cols, cabe: cols * Math.floor(lado / ch) };
}

/**
 * Qué resolución pide el atlas según cuánta gente hay: con pocos, se acercan mucho; con muchos, son chicos. **Es la
 * misma para todos los trajes**: que la fraternidad del final se vea más nítida que las otras delataría a quien gana.
 */
const resPedida = (n: number): number => (n <= 40 ? 1.6 : n <= 100 ? 1.15 : 0.85);

/**
 * Pasa a cartón los trajes de la ronda. Se hace una vez, sin azar: la misma ronda da el mismo atlas. Si el ropero o el
 * motor no dan (sin memoria), devuelve null y la vista no arranca (el 2D sigue como siempre).
 */
export function hornear(motor: Motor3D, rep: RepartoOruro, n: number, lado = 2048): Atlas | null {
  const t0 = performance.now();
  const { renderer, wardrobe } = rep.pixi;
  const heroes = rep.clases.filter((c) => c.g === rep.heroe);
  const otras = rep.clases.filter((c) => c.g !== rep.heroe);
  const instrumentos = [...new Set(rep.banda)];
  const frat = (g: number) => rep.frats.find((f) => f.g === g);
  const maxLado = Math.min(lado, motor.renderer.capabilities.maxTextureSize);

  const clases = new Map<number, ClaseCeldas>();
  const banda = new Map<Instrument, Cel[]>();
  const quieto = new Map<Instrument, Cel>();
  const texturas: TexturaTres[] = [];
  const resUsada: number[] = [];
  const pecho = new Map<number, { x: number; y: number; w: number }>();
  let total = 0;

  const grupos: { heroe: boolean; cl: { g: number; mujer: boolean }[]; musicos: boolean }[] = [
    { heroe: false, cl: otras, musicos: true },
    { heroe: true, cl: heroes, musicos: false },
  ];
  const cuantasDe = (grupo: (typeof grupos)[number]): number => {
    const porClase = grupo.heroe ? N_BAILE + N_SALUDO + 2 + 2 * N_TROPIEZO + 2 * N_CAIDA + 1 : N_BAILE + N_SALUDO;
    return grupo.cl.length * porClase + (grupo.musicos ? instrumentos.length * (N_MUSICA + 1) : 0);
  };
  // La resolución común: la pedida, o la que deje entrar a todos en el cuadrado mayor.
  let res = resPedida(n);
  for (let i = 0; i < 60 && grupos.some((g) => celdasEn(res, maxLado).cabe < cuantasDe(g)); i++) res *= 0.94;
  grupos.forEach((grupo, a) => {
    const cuantas = cuantasDe(grupo);
    if (!cuantas) return;
    // El lado más chico en que entran con la resolución común.
    let lad = 512;
    while (celdasEn(res, lad).cabe < cuantas && lad < maxLado) lad *= 2;
    const { cw, ch, cols } = celdasEn(res, lad);
    const hoja = new Container();
    let k = 0;
    const lugar = (): { x: number; y: number; cel: Cel } => {
      const cx = k % cols, cy = Math.floor(k / cols);
      k++;
      return {
        x: cx * cw + ANCLA_X * res,
        y: cy * ch + ANCLA_Y * res,
        cel: { a, u0: (cx * cw) / lad, v0: 1 - ((cy + 1) * ch) / lad, du: cw / lad, dv: ch / lad },
      };
    };
    const cuerpos: DancerParts[] = [];
    const musicos: MusicianParts[] = [];
    const clavar = (p: { root: Container }, x: number, y: number): void => {
      p.root.rotation = 0;
      p.root.position.set(x, y);
      hoja.addChild(p.root);
    };

    for (const c of grupo.cl) {
      const f = frat(c.g);
      if (!f) continue;
      const giro = GIRO[f.dance] ?? 0;
      const nuevo = (): DancerParts => {
        const p = wardrobe.make(f.dance, f.color, Texture.EMPTY, SEMILLA, c.mujer);
        cuerpos.push(p);
        // El retrato del pecho no va en el cartón (es de cada persona): se anota dónde va para ponerlo aparte.
        if (!pecho.has(claseId(c.g, c.mujer))) {
          const av = p.root.children.find((h) => h instanceof Sprite && h.texture === Texture.EMPTY) as Sprite | undefined;
          if (av) pecho.set(claseId(c.g, c.mujer), { x: av.position.x, y: av.position.y, w: Math.abs(av.width) });
        }
        return p;
      };
      const cc: ClaseCeldas = { baile: [], saludo: [], salto: [], tropiezo: [[], []], caida: [[], []], cabeza: null };
      for (let j = 0; j < N_BAILE; j++) {
        const { x, y, cel } = lugar();
        const p = nuevo();
        const fase = (j / N_BAILE) * 2 * DOS_PI;
        pose(p, { mode: "dance", b: fase - p.seed * 0.35, e: 1, t: giro ? (j / N_BAILE) * (DOS_PI / giro) : 0, f: 0, dir: 1 }, x, y, res, res);
        clavar(p, x, y);
        cc.baile.push(cel);
      }
      for (let j = 0; j < N_SALUDO; j++) {
        const { x, y, cel } = lugar();
        const p = nuevo();
        pose(p, { mode: "salute", b: 0, e: 1, t: ((j / N_SALUDO) * DOS_PI - p.seed) / 7, f: 0, dir: 1 }, x, y, res, res);
        clavar(p, x, y);
        cc.saludo.push(cel);
      }
      if (grupo.heroe) {
        for (const alto of [8, 50]) {
          const { x, y, cel } = lugar();
          const p = nuevo();
          pose(p, { mode: "jump", b: 0, e: 1, t: 0.3, f: alto, dir: 1 }, x, y, res, res);
          clavar(p, x, y);
          cc.salto.push(cel);
        }
        [-1, 1].forEach((dir, di) => {
          for (let j = 0; j < N_TROPIEZO; j++) {
            const { x, y, cel } = lugar();
            const p = nuevo();
            pose(p, { mode: "stumble", b: 0, e: 1, t: 0.3, f: (j + 0.5) / N_TROPIEZO, dir }, x, y, res, res);
            clavar(p, x, y);
            (cc.tropiezo[di] as Cel[]).push(cel);
          }
          for (let j = 0; j < N_CAIDA; j++) {
            const { x, y, cel } = lugar();
            const p = nuevo();
            pose(p, { mode: "fall", b: 0, e: 1, t: 0.3, f: (j + 0.5) / N_CAIDA, dir }, x, y, res, res);
            // Lo que llevaba en la cabeza sale volando aparte: el cuerpo queda sin eso y con la cara de abajo.
            p.head.visible = false;
            clavar(p, x, y);
            (cc.caida[di] as Cel[]).push(cel);
          }
        });
        {
          const { x, y, cel } = lugar();
          const p = nuevo();
          pose(p, { mode: "dance", b: 0, e: 1, t: 0, f: 0, dir: 1 }, x, y, res, res);
          // Solo lo que lleva en la cabeza.
          for (const h of p.root.children) h.visible = h === p.head;
          clavar(p, x, y);
          cc.cabeza = cel;
        }
      }
      clases.set(claseId(c.g, c.mujer), cc);
    }

    if (grupo.musicos) {
      for (const kind of instrumentos) {
        const lista: Cel[] = [];
        for (let j = 0; j < N_MUSICA; j++) {
          const { x, y, cel } = lugar();
          const m = wardrobe.musician(kind, 0.4);
          musicos.push(m);
          poseMusician(m, (j / N_MUSICA) * DOS_PI, 1, x, y, res);
          clavar(m, x, y);
          lista.push(cel);
        }
        banda.set(kind, lista);
        const { x, y, cel } = lugar();
        const m = wardrobe.musician(kind, 0.4);
        musicos.push(m);
        poseMusician(m, 0, 0, x, y, res);
        clavar(m, x, y);
        quieto.set(kind, cel);
      }
    }

    const tx = renderer.generateTexture({ target: hoja, frame: new Rectangle(0, 0, lad, lad), resolution: 1, antialias: true });
    const lienzo = renderer.extract.canvas({ target: tx }) as HTMLCanvasElement;
    const tex = new CanvasTexture(lienzo);
    tex.generateMipmaps = true;
    tex.minFilter = LinearMipmapLinearFilter;
    tex.magFilter = LinearFilter;
    tex.anisotropy = Math.min(4, motor.renderer.capabilities.getMaxAnisotropy());
    motor.basura.add(tex);
    texturas[a] = tex;
    resUsada[a] = res;
    total += k;
    tx.destroy(true);
    hoja.destroy({ children: true });
  });

  // Los retratos de todos, en un atlas aparte: una celda por persona.
  const caras: Cel[] = [];
  if (rep.caras.length) {
    const celda = n <= 50 ? 64 : 32;
    const cols = Math.ceil(Math.sqrt(rep.caras.length));
    const filas = Math.ceil(rep.caras.length / cols);
    let lad = 64;
    while (lad < Math.max(cols, filas) * celda) lad *= 2;
    const hoja = new Container();
    rep.caras.forEach((tx, i) => {
      const cx = i % cols, cy = Math.floor(i / cols);
      const sp = new Sprite(tx);
      sp.anchor.set(0.5);
      sp.width = sp.height = celda * 0.94;
      sp.position.set(cx * celda + celda / 2, cy * celda + celda / 2);
      hoja.addChild(sp);
      caras.push({ a: ATLAS_CARAS, u0: (cx * celda) / lad, v0: 1 - ((cy + 1) * celda) / lad, du: celda / lad, dv: celda / lad });
    });
    const tx = renderer.generateTexture({ target: hoja, frame: new Rectangle(0, 0, lad, lad), resolution: 1, antialias: true });
    const tex = new CanvasTexture(renderer.extract.canvas({ target: tx }) as HTMLCanvasElement);
    tex.generateMipmaps = true;
    tex.minFilter = LinearMipmapLinearFilter;
    tex.magFilter = LinearFilter;
    motor.basura.add(tex);
    texturas[ATLAS_CARAS] = tex;
    tx.destroy(true);
    hoja.destroy({ children: true });
  }

  return { texturas, clases, banda, quieto, res: resUsada, pecho, caras, ms: performance.now() - t0, celdas: total };
}

/* ============================================================================ el dibujo instanciado */

const VERT = /* glsl */ `
uniform vec3 uRight;
uniform vec3 uFwd;
attribute vec3 aPos;
attribute vec2 aSize;
attribute vec2 aAnc;
attribute vec4 aUv;
attribute vec2 aAng;
attribute vec3 aTint;
varying vec2 vUv;
varying vec3 vTint;
varying float vDepth;
void main() {
  vec2 l = (position.xy - aAnc) * aSize;
  float c = cos(aAng.x), s = sin(aAng.x);
  vec2 r = vec2(c * l.x - s * l.y, s * l.x + c * l.y);
  float cp = cos(aAng.y), sp = sin(aAng.y);
  vec3 wp = aPos + uRight * r.x + vec3(0.0, r.y * cp, 0.0) + uFwd * (r.y * sp);
  vec4 mv = viewMatrix * vec4(wp, 1.0);
  gl_Position = projectionMatrix * mv;
  vUv = aUv.xy + position.xy * aUv.zw;
  vTint = aTint;
  vDepth = -mv.z;
}`;

const FRAG = /* glsl */ `
uniform sampler2D uMap;
uniform vec3 uFog;
uniform vec2 uFogRange;
uniform vec3 uLuz;
varying vec2 vUv;
varying vec3 vTint;
varying float vDepth;
void main() {
  vec4 t = texture2D(uMap, vUv);
  #ifdef COBERTURA
  if (t.a < 0.02) discard;
  #else
  if (t.a < 0.5) discard;
  #endif
  vec3 col = t.rgb * vTint * uLuz;
  float ff = clamp((vDepth - uFogRange.x) / (uFogRange.y - uFogRange.x), 0.0, 1.0);
  col = mix(col, uFog, ff);
  gl_FragColor = vec4(col, t.a);
}`;

const FLOATS = 16;

/** Una malla instanciada de recortes para un atlas. */
class Capa {
  readonly malla: Mesh;
  private readonly datos: Float32Array;
  private readonly buf: InstancedInterleavedBuffer;
  private readonly geo: InstancedBufferGeometry;
  readonly material: ShaderMaterial;
  usadas = 0;

  constructor(readonly max: number, textura: TexturaTres, coberturaDeBordes: boolean, basura: Basura) {
    this.datos = new Float32Array(max * FLOATS);
    this.buf = new InstancedInterleavedBuffer(this.datos, FLOATS, 1);
    this.buf.setUsage(DynamicDrawUsage);
    const g = new InstancedBufferGeometry();
    g.setIndex(new Uint16BufferAttribute([0, 1, 2, 0, 2, 3], 1));
    g.setAttribute("position", new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0], 3));
    g.setAttribute("aPos", new InterleavedBufferAttribute(this.buf, 3, 0));
    g.setAttribute("aSize", new InterleavedBufferAttribute(this.buf, 2, 3));
    g.setAttribute("aAnc", new InterleavedBufferAttribute(this.buf, 2, 5));
    g.setAttribute("aUv", new InterleavedBufferAttribute(this.buf, 4, 7));
    g.setAttribute("aAng", new InterleavedBufferAttribute(this.buf, 2, 11));
    g.setAttribute("aTint", new InterleavedBufferAttribute(this.buf, 3, 13));
    g.instanceCount = 0;
    this.geo = g;
    this.material = new ShaderMaterial({
      uniforms: {
        uMap: { value: textura },
        uRight: { value: new Vector3(1, 0, 0) },
        uFwd: { value: new Vector3(0, 0, -1) },
        uFog: { value: new Vector3(0.5, 0.5, 0.6) },
        uFogRange: { value: new Vector2(60, 380) },
        uLuz: { value: new Vector3(1, 1, 1) },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      side: DoubleSide,
      transparent: false,
      depthWrite: true,
      alphaToCoverage: coberturaDeBordes,
      defines: coberturaDeBordes ? { COBERTURA: "" } : {},
    });
    this.malla = new Mesh(g, this.material);
    this.malla.frustumCulled = false;
    basura.add(g);
    basura.add(this.material);
  }

  empezar(): void {
    this.usadas = 0;
  }

  poner(c: Cel, x: number, y: number, z: number, w: number, h: number, ancX: number, ancY: number, roll: number, pitch: number, r: number, g: number, b: number): void {
    if (this.usadas >= this.max) return;
    const d = this.datos, o = this.usadas++ * FLOATS;
    d[o] = x; d[o + 1] = y; d[o + 2] = z;
    d[o + 3] = w; d[o + 4] = h;
    d[o + 5] = ancX; d[o + 6] = ancY;
    d[o + 7] = c.u0; d[o + 8] = c.v0; d[o + 9] = c.du; d[o + 10] = c.dv;
    d[o + 11] = roll; d[o + 12] = pitch;
    d[o + 13] = r; d[o + 14] = g; d[o + 15] = b;
  }

  terminar(): void {
    this.geo.instanceCount = this.usadas;
    this.buf.needsUpdate = true;
    this.malla.visible = this.usadas > 0;
  }
}

/** Todos los recortes de la escena: una capa por atlas. */
export class Recortes {
  readonly capas: Capa[] = [];

  constructor(motor: Motor3D, private readonly atlas: Atlas, max: number) {
    atlas.texturas.forEach((tex, a) => {
      if (!tex) return;
      const capa = new Capa(max, tex, motor.ajustes.antialias, motor.basura);
      this.capas[a] = capa;
      motor.escena.add(capa.malla);
    });
  }

  empezar(): void {
    for (const c of this.capas) c?.empezar();
  }

  /** `wU`: ancho de la celda en unidades 3D, con el signo de hacia dónde mira. `hU`: su alto. */
  poner(c: Cel, x: number, y: number, z: number, wU: number, hU: number, ancX: number, ancY: number, roll: number, pitch: number, r: number, g: number, b: number): void {
    this.capas[c.a]?.poner(c, x, y, z, wU, hU, ancX, ancY, roll, pitch, r, g, b);
  }

  terminar(derecha: readonly [number, number, number], adelante: readonly [number, number, number], luz: readonly [number, number, number], niebla: readonly [number, number, number], nCerca: number, nLejos: number): void {
    for (const c of this.capas) {
      if (!c) continue;
      c.terminar();
      const u = c.material.uniforms;
      (u.uRight!.value as Vector3).set(derecha[0], derecha[1], derecha[2]);
      (u.uFwd!.value as Vector3).set(adelante[0], adelante[1], adelante[2]);
      (u.uLuz!.value as Vector3).set(luz[0], luz[1], luz[2]);
      (u.uFog!.value as Vector3).set(niebla[0], niebla[1], niebla[2]);
      (u.uFogRange!.value as Vector2).set(nCerca, nLejos);
    }
  }

  ancla(): { x: number; y: number } {
    return { x: ANCLA_X / CELDA_W, y: (CELDA_H - ANCLA_Y) / CELDA_H };
  }

  get atlasUsado(): Atlas {
    return this.atlas;
  }
}
