import { CanvasSource, Container, Sprite, Texture } from "pixi.js";
import { avatarColor } from "../../avatar";
import { OPACIDAD_OSCURA, piezasDePenumbra, radioSano, type EstadoFoco } from "./foco";

/**
 * Dibuja el foco (`foco.ts`) en la capa del cartel. Solo dibuja: cada cuadro
 * recibe el estado y el punto donde está quien gana, y lo pone en pantalla. No
 * guarda nada del cuadro anterior.
 *
 * Todo son sprites de texturas de lienzo que se arman una vez, antes de mostrar
 * el estadio: en cada cuadro solo se mueven, se escalan y se aclaran. Nada de
 * `Graphics` que se rearme (volver a triangular un trazo en cada cuadro le
 * costaba a un celular de gama media: con la CPU cuatro veces más lenta, el
 * show bajaba de 120 a 65 cuadros por segundo en el golpe).
 */

/** Dónde está quien gana, en píxeles de pantalla. */
export interface FocoPunto {
  /** El centro del cuerpo y el radio de la zona que ocupa. */
  x: number;
  y: number;
  r: number;
  /** Dónde pisa, en y de pantalla; sin esto, un poco debajo del cuerpo. */
  pies?: number;
  /** El color de quien gana, para su onda. */
  color?: number;
  /** La rival del duelo, si se ve. */
  rival?: { x: number; y: number; r: number } | null;
}

/** El color de la cara de una persona como número, para su onda. */
export const colorDeNombre = (name: string): number => {
  const n = parseInt((avatarColor(name) || "#ffc629").replace("#", ""), 16);
  return Number.isFinite(n) ? n : 0xffc629;
};

const TINTA = 0x0a0816;
const ORO = 0xffe9a8;
const BLANCO = 0xfff6dc;

/** Un lienzo de `ancho` por `alto` con lo que dibuje `pintar`, pasado a textura. */
function hornear(ancho: number, alto: number, pintar: (cx: CanvasRenderingContext2D, w: number, h: number) => void): Texture {
  const c = document.createElement("canvas");
  c.width = ancho;
  c.height = alto;
  const cx = c.getContext("2d");
  if (cx) pintar(cx, ancho, alto);
  return new Texture({ source: new CanvasSource({ resource: c, autoGenerateMipmaps: true, scaleMode: "linear" }) });
}

/** Las texturas del foco, todas blancas (el color se pone con `tint`) menos la del hueco. */
function armarTexturas(): Record<"luz" | "hueco" | "rayos" | "cono" | "anillo" | "marco" | "abanico", Texture> {
  return {
    // El resplandor: blanco al centro, transparente en el borde.
    luz: hornear(256, 256, (cx, L) => {
      const g = cx.createRadialGradient(L / 2, L / 2, 0, L / 2, L / 2, L / 2);
      g.addColorStop(0, "rgba(255,255,255,1)");
      g.addColorStop(0.22, "rgba(255,255,255,0.72)");
      g.addColorStop(0.55, "rgba(255,255,255,0.22)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      cx.fillStyle = g;
      cx.fillRect(0, 0, L, L);
    }),
    // El hueco de la penumbra: transparente al centro y opaco en el borde.
    hueco: hornear(256, 256, (cx, L) => {
      const g = cx.createRadialGradient(L / 2, L / 2, 0, L / 2, L / 2, L / 2);
      g.addColorStop(0, "rgba(10,8,22,0)");
      g.addColorStop(0.36, "rgba(10,8,22,0)");
      g.addColorStop(0.58, "rgba(10,8,22,0.38)");
      g.addColorStop(0.8, "rgba(10,8,22,0.84)");
      g.addColorStop(1, "rgba(10,8,22,1)");
      cx.fillStyle = g;
      cx.fillRect(0, 0, L, L);
    }),
    // Dieciocho rayos que se apagan hacia afuera.
    rayos: hornear(512, 512, (cx, L) => {
      const c = L / 2;
      const g = cx.createRadialGradient(c, c, 0, c, c, c);
      g.addColorStop(0, "rgba(255,255,255,0.95)");
      g.addColorStop(0.6, "rgba(255,255,255,0.4)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      cx.fillStyle = g;
      const N = 18;
      for (let i = 0; i < N; i++) {
        const a = (i / N) * Math.PI * 2;
        const w = (Math.PI / N) * 0.42;
        cx.beginPath();
        cx.moveTo(c, c);
        cx.lineTo(c + Math.cos(a - w) * c, c + Math.sin(a - w) * c);
        cx.lineTo(c + Math.cos(a + w) * c, c + Math.sin(a + w) * c);
        cx.closePath();
        cx.fill();
      }
    }),
    // El cono: el vértice arriba y la base abajo, más claro al centro que a los costados.
    cono: hornear(128, 256, (cx, w, h) => {
      const g = cx.createLinearGradient(0, 0, w, 0);
      g.addColorStop(0, "rgba(255,255,255,0.35)");
      g.addColorStop(0.5, "rgba(255,255,255,1)");
      g.addColorStop(1, "rgba(255,255,255,0.35)");
      cx.fillStyle = g;
      cx.beginPath();
      cx.moveTo(w / 2, 0);
      cx.lineTo(w, h);
      cx.lineTo(0, h);
      cx.closePath();
      cx.fill();
    }),
    // La onda: un anillo que se agranda y se apaga.
    anillo: hornear(256, 256, (cx, L) => {
      cx.strokeStyle = "#fff";
      cx.lineWidth = L * 0.035;
      cx.beginPath();
      cx.arc(L / 2, L / 2, L / 2 - L * 0.04, 0, Math.PI * 2);
      cx.stroke();
    }),
    // El visor de una cámara: cuatro esquinas.
    marco: hornear(128, 128, (cx, L) => {
      cx.strokeStyle = "#fff";
      cx.lineWidth = L * 0.03;
      cx.lineCap = "round";
      cx.lineJoin = "round";
      const m = L * 0.05, a = L * 0.5;
      for (const [sx, sy] of [[0, 0], [1, 0], [1, 1], [0, 1]] as const) {
        const x = m + sx * (L - 2 * m), y = m + sy * (L - 2 * m);
        const dx = sx ? -1 : 1, dy = sy ? -1 : 1;
        cx.beginPath();
        cx.moveTo(x + dx * a * 0.6, y);
        cx.lineTo(x, y);
        cx.lineTo(x, y + dy * a * 0.6);
        cx.stroke();
      }
    }),
    // Nueve rayos que salen de los pies y se abren hacia arriba: el vértice abajo al centro.
    abanico: hornear(640, 512, (cx, w, h) => {
      const ox = w / 2, oy = h;
      const g = cx.createLinearGradient(0, h, 0, 0);
      g.addColorStop(0, "rgba(255,255,255,0.95)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      cx.fillStyle = g;
      const N = 9, L = h;
      for (let i = 0; i < N; i++) {
        const f = (i / (N - 1)) * 2 - 1;
        const ang = -Math.PI / 2 + f * 0.62;
        const nx = -Math.sin(ang), ny = Math.cos(ang);
        const ex = ox + Math.cos(ang) * L, ey = oy + Math.sin(ang) * L;
        const base = 12 * (1 - Math.abs(f) * 0.4);
        cx.beginPath();
        cx.moveTo(ox + nx * base, oy + ny * base);
        cx.lineTo(ox - nx * base, oy - ny * base);
        cx.lineTo(ex, ey);
        cx.closePath();
        cx.fill();
      }
    }),
  };
}

const sprite = (tx: Texture, anchorX = 0.5, anchorY = 0.5): Sprite => {
  const s = new Sprite(tx);
  s.anchor.set(anchorX, anchorY);
  s.visible = false;
  return s;
};

export class FocoVista {
  readonly root = new Container();
  private tx: ReturnType<typeof armarTexturas> | null = null;
  private armado = false;
  /** Las cuatro piezas de la penumbra, el hueco con borde suave, y el destello de toda la pantalla. */
  private piezas: Sprite[] = [];
  private hueco!: Sprite;
  private destello!: Sprite;
  private conos: Sprite[] = [];
  private piso!: Sprite;
  private rayos!: Sprite;
  private suben!: Sprite;
  private luz!: Sprite;
  private ondas: Sprite[] = [];
  private marcos: Sprite[] = [];

  constructor() {
    this.root.visible = false;
  }

  /** Las texturas que hay que soltar al cerrar el estadio. */
  soltar(): void {
    this.root.destroy({ children: true });
    if (this.tx) for (const t of Object.values(this.tx)) t.destroy(true);
    this.tx = null;
  }

  private armar(): void {
    if (this.armado) return;
    this.armado = true;
    const tx = (this.tx = armarTexturas());
    const solido = (): Sprite => {
      const s = sprite(Texture.WHITE, 0, 0);
      return s;
    };
    this.piezas = [solido(), solido(), solido(), solido()];
    for (const p of this.piezas) p.tint = TINTA;
    this.hueco = sprite(tx.hueco, 0, 0);
    this.conos = [sprite(tx.cono, 0.5, 0), sprite(tx.cono, 0.5, 0)];
    this.piso = sprite(tx.luz);
    this.rayos = sprite(tx.rayos);
    this.suben = sprite(tx.abanico, 0.5, 1);
    this.luz = sprite(tx.luz);
    this.ondas = [sprite(tx.anillo), sprite(tx.anillo)];
    this.marcos = [sprite(tx.marco), sprite(tx.marco)];
    this.destello = solido();
    this.destello.tint = 0xffffff;
    for (const s of [...this.conos, this.piso, this.rayos, this.suben, this.luz, ...this.ondas]) s.blendMode = "screen";
    this.root.addChild(
      ...this.piezas, this.hueco, ...this.conos, this.piso, this.rayos, this.suben, this.luz, ...this.ondas, ...this.marcos, this.destello,
    );
  }

  /** Arma las texturas antes de que haga falta: el primer cuadro del foco no puede tardar. */
  calentar(): void {
    this.armar();
  }

  esconder(): void {
    this.root.visible = false;
  }

  /** Pone el foco en el estado `e`, sobre `p`, en una pantalla de `W` por `H` con la unidad `k`. */
  pintar(e: EstadoFoco, p: FocoPunto, W: number, H: number, k: number): void {
    this.armar();
    const vivo = e.oscuro > 0.001 || e.destello > 0.001;
    this.root.visible = vivo;
    if (!vivo) return;
    const r = radioSano(p.r, W, H, k);
    const { x, y } = p;
    const pies = p.pies ?? y + r * 0.95;

    // La penumbra: cuatro piezas y el hueco con borde suave.
    const R = r * 2.5;
    const { hueco, piezas } = piezasDePenumbra(x, y, R, W, H);
    const oscuridad = e.oscuro * OPACIDAD_OSCURA;
    this.piezas.forEach((s, i) => {
      const q = piezas[i];
      s.visible = !!q && oscuridad > 0.001;
      if (!q) return;
      s.position.set(q.x, q.y);
      s.width = q.w;
      s.height = q.h;
      s.alpha = oscuridad;
    });
    this.hueco.visible = oscuridad > 0.001;
    this.hueco.position.set(hueco.x, hueco.y);
    this.hueco.width = hueco.w;
    this.hueco.height = hueco.h;
    this.hueco.alpha = oscuridad;

    // El cono de luz que baja desde arriba hasta los pies: el vértice queda un
    // cuarto de pantalla arriba del borde, y la base llega a `e.cono` del camino.
    const apiceY = -H * 0.25;
    const largo = pies - apiceY;
    const verCono = e.cono > 0.001 && e.luz > 0.001;
    [[1.7 * r, 0.14], [1.0 * r, 0.12]].forEach(([mitad, alfa], i) => {
      const s = this.conos[i] as Sprite;
      s.visible = verCono;
      if (!verCono) return;
      s.position.set(x, apiceY);
      s.width = 2 * (mitad as number) * e.cono;
      s.height = largo * e.cono;
      s.tint = ORO;
      s.alpha = (alfa as number) * e.luz;
    });

    // El charco de luz en el piso.
    this.piso.visible = e.luz > 0.001;
    this.piso.position.set(x, pies);
    this.piso.tint = ORO;
    this.piso.width = 3.8 * r * e.pulso;
    this.piso.height = 0.8 * r * e.pulso;
    this.piso.alpha = 0.55 * e.luz;

    // El resplandor y los rayos que giran.
    this.luz.visible = e.luz > 0.001;
    this.luz.position.set(x, y);
    this.luz.tint = ORO;
    this.luz.width = this.luz.height = r * (2 + 1.7 * e.luz) * e.pulso;
    this.luz.alpha = 0.6 * e.luz;
    this.rayos.visible = e.rayos > 0.001;
    this.rayos.position.set(x, y);
    this.rayos.tint = BLANCO;
    this.rayos.width = this.rayos.height = r * 7.5 * (0.85 + 0.15 * e.rayos);
    this.rayos.rotation = e.giro;
    this.rayos.alpha = 0.42 * e.rayos;

    // Los rayos que suben del piso: un abanico que sale de los pies.
    this.suben.visible = e.suben > 0.001;
    this.suben.position.set(x, pies);
    this.suben.tint = ORO;
    this.suben.height = H * 0.95 * e.suben;
    this.suben.width = this.suben.height * 1.25;
    this.suben.alpha = 0.5 * Math.min(1, e.suben * 1.5);

    // Las ondas: una blanca y, un poco después, una del color de quien gana.
    const onda = (s: Sprite, prog: number, radio0: number, radio1: number, tinte: number, alfa: number): void => {
      s.visible = prog >= 0;
      if (prog < 0) return;
      const q = 1 - Math.pow(1 - prog, 3);
      s.position.set(x, y);
      s.width = s.height = 2 * r * (radio0 + (radio1 - radio0) * q);
      s.tint = tinte;
      s.alpha = Math.pow(1 - prog, 1.25) * alfa;
    };
    onda(this.ondas[0] as Sprite, e.onda, 0.9, 5.3, BLANCO, 0.95);
    onda(this.ondas[1] as Sprite, e.onda2, 0.8, 4.6, p.color ?? ORO, 0.9);

    // La foto del duelo: el marco de cámara sobre quien gana y uno chico sobre la rival.
    const marco = (s: Sprite, cx: number, cy: number, m: number, alfa: number): void => {
      s.visible = alfa > 0.001;
      if (!s.visible) return;
      s.position.set(cx, cy);
      s.width = s.height = 2 * m;
      s.alpha = alfa;
    };
    marco(this.marcos[0] as Sprite, x, y, r * 1.5 * (1 + 0.45 * (1 - e.marco)), e.marco);
    marco(this.marcos[1] as Sprite, p.rival?.x ?? 0, p.rival?.y ?? 0, p.rival ? radioSano(p.rival.r, W, H, k) * 1.35 * (1 + 0.45 * (1 - e.marcoRival)) : 0, p.rival ? e.marcoRival * 0.75 : 0);

    // El destello de toda la pantalla.
    this.destello.visible = e.destello > 0.001;
    this.destello.width = W;
    this.destello.height = H;
    this.destello.alpha = Math.min(1, e.destello);
  }
}
