import { Container, Graphics, Rectangle, Sprite, type Renderer, type Texture } from "pixi.js";
import type { Dance } from "./entrada-plan";

/**
 * Los bailarines de La Entrada: cinco trajes de la entrada de Oruro y cómo se
 * mueve cada uno al ritmo de la banda.
 *
 * - **Diablada**: máscara con cuernos anillados, ojos saltones y la culebra en
 *   la frente; capa bordada con estrellas, pechera dorada y el tridente. Salta
 *   con la rodilla alta.
 * - **Morenada**: el traje de moreno, una campana pesada y bordada; la máscara
 *   de ojos desorbitados y la lengua afuera, con su corona, y la matraca que
 *   gira en la mano. Paso cansino, de un lado al otro.
 * - **Caporales**: botas altas con cascabeles, chaqueta con hombreras y
 *   sombrero. Salta y patea al aire.
 * - **Tinkus**: la montera, un casco duro, con plumas; la almilla tejida, la
 *   chuspa y las abarcas. Agachado, zapateando, con los puños arriba.
 * - **Llamerada**: el sombrero con flecos de colores, el poncho, la honda que da
 *   vueltas sobre la cabeza y la llamita en la otra mano.
 *
 * Cada pieza se dibuja una sola vez y se pasa a una textura (`bake`), y cada
 * bailarín es un puñado de sprites con esas texturas. Dibujados como Graphics,
 * con doscientos bailarines la placa copiaba cientos de miles de vértices por
 * cuadro y la escena iba a 25 cuadros por segundo (auditor exigente, 21 de
 * octubre de 2026). Lo que lleva el color de la fraternidad se dibuja con ese
 * color, una vez por fraternidad; lo que es igual en todas (las piernas, las
 * máscaras, lo que se lleva en la mano) se comparte.
 *
 * La cara es del cuerpo y lo de la cabeza es aparte: en el tropezón y en la
 * caída se corre y vuela la máscara, el sombrero o la montera, y la cara queda
 * en su lugar. Con la cara adentro de lo que volaba, en la caída se veía rodar
 * una cabeza por el piso (21 de octubre de 2026).
 *
 * Las unidades son las del dibujo: los pies en (0, 0), la punta de lo que lleva
 * en la cabeza a unos 130 hacia arriba.
 */

const INK = 0x191919;
const GOLD = 0xffc629;
const GOLD_D = 0xb8860b;
const WHITE = 0xffffff;
/** Los colores de piel de las caras sin máscara. */
const SKINS = [0xf1c7a0, 0xdba577, 0xc68a5c, 0x8d5a3b];
/** Los colores de pelo. */
const HAIRS = [0x2b1d14, 0x3d2817, 0x151515, 0x4a2f1c];
/** Las máscaras de la diablada, como las de antes. */
const DEVIL_MASKS = [0xd52b1e, 0x1f7a3a, 0x1c64c8];
const FEATHERS = [0xe93d9c, 0xffc629, 0x00a896, 0xd52b1e, 0x6c4ce0];

/** Lo que el juego mueve de cada bailarín. */
export interface DancerParts {
  /** Va a los pies: `pose` lo ubica, lo inclina y lo escala. */
  root: Container;
  legL: Container;
  legR: Container;
  armL: Container;
  armR: Container;
  /**
   * Lo que lleva en la cabeza: la máscara, el sombrero o la montera. Es lo que
   * casi se cae en el susto y vuela en la caída; la cara queda en su lugar.
   */
  head: Container;
  /** La cara de abajo de la máscara: se ve cuando la máscara se corre o se cae. */
  under: Container | null;
  /** La cara de siempre y la del susto, que se cambian en el tropezón y en la caída. */
  feat: Container | null;
  featOh: Container | null;
  /** Lo que lleva en la mano derecha: el tridente, la matraca, la honda. */
  prop: Container | null;
  cape: Container | null;
  dance: Dance;
  /** Un desfase propio, para que no sean robots. */
  seed: number;
}

/** El estado de un bailarín en un cuadro. */
export type PoseMode = "dance" | "salute" | "jump" | "stumble" | "fall";
export interface Pose {
  mode: PoseMode;
  /** La fase del paso, en radianes: una vuelta por cada dos tiempos de la banda. */
  b: number;
  /** Cuánto baila, de 0 (quieto) a 1. */
  e: number;
  /** El reloj del juego, para lo que gira solo. */
  t: number;
  /** En el salto, la altura; en el tropezón y la caída, por dónde va (0 a 1). */
  f: number;
  /** Para dónde se cae: -1 a la izquierda, 1 a la derecha. */
  dir: number;
}

const ease = (x: number): number => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const hexKey = (c: number): string => c.toString(16);

/** Los hombros, la cadera y la cabeza, iguales en todos: así los cinco bailan con el mismo esqueleto. */
const SHOULDER_X = 13;
const SHOULDER_Y = -66;
const HIP_X = 6;
const HIP_Y = -14;
const HEAD_Y = -86;
/** Dónde queda la mano, en el brazo que cuelga del hombro. */
const HAND_Y = 24.5;

type Draw = (g: Graphics) => void;

export class Wardrobe {
  private readonly cache = new Map<string, { tx: Texture; fr: Rectangle }>();

  /** `res` son los píxeles de textura por unidad del dibujo: lo que se ve nítido de cerca. */
  constructor(private readonly renderer: Renderer, private readonly res: number) {}

  /**
   * Un dibujo pasado a textura una sola vez (por `key`), y un sprite de él con
   * el origen en (ox, oy) del dibujo: ahí gira y ahí se ubica.
   */
  private bake(key: string, draw: Draw, ox = 0, oy = 0, tint?: number): Sprite {
    let c = this.cache.get(key);
    if (!c) {
      const g = new Graphics();
      draw(g);
      const b = g.getLocalBounds();
      const x0 = Math.floor(b.x) - 2, y0 = Math.floor(b.y) - 2;
      const fr = new Rectangle(x0, y0, Math.ceil(b.x + b.width) + 2 - x0, Math.ceil(b.y + b.height) + 2 - y0);
      const tx = this.renderer.generateTexture({ target: g, frame: fr, resolution: this.res, antialias: true, textureSourceOptions: { autoGenerateMipmaps: true } });
      g.destroy();
      c = { tx, fr };
      this.cache.set(key, c);
    }
    const s = new Sprite(c.tx);
    s.anchor.set((ox - c.fr.x) / c.fr.width, (oy - c.fr.y) / c.fr.height);
    s.position.set(ox, oy);
    if (tint !== undefined) s.tint = tint;
    return s;
  }

  /** Suelta las texturas. Los bailarines se destruyen aparte. */
  destroy(): void {
    for (const c of this.cache.values()) c.tx.destroy(true);
    this.cache.clear();
  }

  /** El brazo que cuelga del hombro, del color de la fraternidad: manga y guante. */
  private arm(color: number, x: number): Sprite {
    const s = this.bake("arm", (g) => g.roundRect(-3.6, -1, 7.2, 23, 3.4).fill(WHITE).stroke({ width: 1.6, color: INK }).circle(0, HAND_Y, 4).fill(WHITE).stroke({ width: 1.4, color: INK }), 0, 0, color);
    s.position.set(x, SHOULDER_Y);
    return s;
  }

  /** El brazo derecho con lo que lleva en la mano: el brazo y la cosa giran cada uno a su manera. */
  private armWith(color: number, prop: Sprite): { arm: Container; prop: Container } {
    const arm = new Container();
    arm.position.set(SHOULDER_X, SHOULDER_Y);
    const a = this.arm(color, 0);
    a.position.set(0, 0);
    prop.position.set(0, HAND_Y);
    arm.addChild(a, prop);
    return { arm, prop };
  }

  private leg(key: string, draw: Draw, x: number): Sprite {
    const s = this.bake(key, draw, 0, 0);
    s.position.set(x, HIP_Y);
    return s;
  }

  /** El pelo de arriba, con la raya al medio, con su color (uno de `HAIRS`). */
  private hair(h: number): Sprite {
    const color = HAIRS[h] as number;
    return this.bake(`hair-cap-${h}`, (g) => g
      .moveTo(-12.3, -86).bezierCurveTo(-13.2, -101.5, 13.2, -101.5, 12.3, -86)
      .bezierCurveTo(9, -91, 3, -93.5, 0, -92).bezierCurveTo(-3, -93.5, -9, -91, -12.3, -86)
      .closePath().fill(color).stroke({ width: 1.4, color: INK }));
  }

  /**
   * La cara que queda en el cuerpo: la piel, el pelo y la expresión, la de
   * siempre (`featKey`) y la del susto, que se cambian en el tropezón y en la
   * caída.
   */
  private face(skin: number, h: number, featKey: string, drawFeat: Draw): { c: Container; feat: Container; featOh: Container } {
    const c = new Container();
    const feat = new Container();
    feat.addChild(this.bake(featKey, drawFeat));
    const featOh = new Container();
    featOh.addChild(this.bake("feat-oh", featOhDraw));
    featOh.visible = false;
    c.addChild(this.bake("face", (g) => g.circle(0, -85, 12).fill(WHITE).stroke({ width: 2, color: INK }), 0, 0, skin), this.hair(h), feat, featOh);
    return { c, feat, featOh };
  }

  /** La cara de abajo de una máscara, asustada: se ve cuando la máscara se corre o se cae. */
  private underMask(skin: number, h: number): Container {
    const c = new Container();
    c.addChild(this.bake("face", (g) => g.circle(0, -85, 12).fill(WHITE).stroke({ width: 2, color: INK }), 0, 0, skin), this.hair(h), this.bake("feat-oh", featOhDraw));
    c.visible = false;
    return c;
  }

  /** Un bailarín de `dance` con el color de su fraternidad y su cara en el pecho. */
  make(dance: Dance, color: number, face: Texture, seed: number): DancerParts {
    const root = new Container();
    const skin = SKINS[Math.floor(frac(seed * 7.13) * SKINS.length)] as number;
    const hairI = Math.floor(frac(seed * 2.71) * HAIRS.length);
    const c = hexKey(color);
    let cape: Container | null = null;
    let prop: Container | null = null;
    let under: Container | null = null;
    const faces: { feat: Container | null; featOh: Container | null } = { feat: null, featOh: null };
    /** La cara a la vista, con el pelo y la expresión. */
    const bare = (key: string, draw: Draw): Container => {
      const fc = this.face(skin, hairI, key, draw);
      faces.feat = fc.feat;
      faces.featOh = fc.featOh;
      return fc.c;
    };
    const head = new Container();
    head.pivot.set(0, HEAD_Y);
    head.position.set(0, HEAD_Y);
    const avatar = new Sprite(face);
    avatar.anchor.set(0.5);
    avatar.width = avatar.height = 14;
    let legL: Sprite, legR: Sprite, armL: Container, armR: Container;

    if (dance === "diablada") {
      const capeS = this.bake(`dia-cape-${c}`, (g) => {
        g.poly([-16, -70, 16, -70, 30, -18, -30, -18]).fill(color).stroke({ width: 2.4, color: INK, join: "round" });
        for (let i = 0; i < 4; i++) g.star(-12 + i * 8, -40 + (i % 2) * 10, 5, 3.2, 1.4).fill(GOLD);
      }, 0, -70);
      cape = capeS;
      const draw: Draw = (g) => g.rect(-3.5, -6, 7, 12).fill(0x5b1a6e).stroke({ width: 1.6, color: INK }).roundRect(-5, 4, 11, 8, 2.5).fill(INK).rect(-5, 4, 11, 2).fill(GOLD);
      legL = this.leg("dia-leg", draw, -HIP_X);
      legR = this.leg("dia-leg", draw, HIP_X);
      const body = this.bake("dia-body", (g) => g
        .poly([-15, -42, 15, -42, 20, -12, -20, -12]).fill(0x5b1a6e).stroke({ width: 2, color: INK })
        .moveTo(-7, -42).lineTo(-9, -12).moveTo(7, -42).lineTo(9, -12).stroke({ width: 1.5, color: GOLD })
        .rect(-20, -15, 40, 3).fill(GOLD)
        .rect(-13, -68, 26, 27).fill(GOLD).stroke({ width: 2, color: INK })
        .circle(-6, -62, 2).fill(0xe93d9c).circle(6, -62, 2).fill(0x00a896).circle(0, -46, 2).fill(0xe93d9c)
        .star(-8, -50, 4, 3.4, 1).fill(WHITE).star(8, -56, 4, 2.8, 0.9).fill(WHITE));
      avatar.position.set(0, -55);
      armL = this.arm(color, -SHOULDER_X);
      // El tridente, siempre parado: el brazo sube y baja, el tridente no se acuesta.
      const r = this.armWith(color, this.bake("dia-trident", (g) => g
        .moveTo(0, 16).lineTo(0, -38).stroke({ width: 2.6, color: INK })
        .moveTo(0, 16).lineTo(0, -38).stroke({ width: 1.2, color: GOLD })
        .moveTo(-6, -32).lineTo(-6, -42).moveTo(6, -32).lineTo(6, -42).moveTo(-6, -32).lineTo(6, -32).moveTo(0, -38).lineTo(0, -46)
        .stroke({ width: 2, color: GOLD })));
      armR = r.arm;
      prop = r.prop;
      under = this.underMask(skin, hairI);
      const mk = Math.floor(frac(seed * 3.7) * DEVIL_MASKS.length);
      head.addChild(this.bake(`dia-mask-${mk}`, (g) => g
        .poly([-12, -90, -26, -106, -34, -128, -22, -114, -8, -96]).fill(GOLD).stroke({ width: 1.8, color: INK })
        .poly([12, -90, 26, -106, 34, -128, 22, -114, 8, -96]).fill(GOLD).stroke({ width: 1.8, color: INK })
        .moveTo(-20, -104).lineTo(-15, -108).moveTo(-26, -114).lineTo(-21, -117).moveTo(20, -104).lineTo(15, -108).moveTo(26, -114).lineTo(21, -117)
        .stroke({ width: 1.4, color: GOLD_D })
        .ellipse(0, -84, 15, 16).fill(DEVIL_MASKS[mk] as number).stroke({ width: 2.4, color: INK })
        .moveTo(0, -99).bezierCurveTo(-7, -96, 6, -93, 0, -90).stroke({ width: 2.6, color: 0x1f7a3a })
        .circle(0, -90, 2).fill(0x1f7a3a)
        .circle(-6, -86, 5.6).fill(GOLD).stroke({ width: 1.2, color: INK }).circle(6, -86, 5.6).fill(GOLD).stroke({ width: 1.2, color: INK })
        .circle(-6, -86, 4).fill(WHITE).circle(6, -86, 4).fill(WHITE)
        .circle(-6, -86, 2.2).fill(0x1f7a3a).circle(6, -86, 2.2).fill(0x1f7a3a)
        .rect(-8, -77, 16, 5).fill(WHITE).stroke({ width: 1.2, color: INK })
        .moveTo(-4, -77).lineTo(-4, -72).moveTo(0, -77).lineTo(0, -72).moveTo(4, -77).lineTo(4, -72).stroke({ width: 1, color: INK })));
      root.addChild(cape, legL, legR, body, avatar, armL, armR, under, head);
    } else if (dance === "morenada") {
      const draw: Draw = (g) => g.rect(-3.5, -2, 7, 9).fill(0x2b2d42).stroke({ width: 1.4, color: INK }).roundRect(-5, 6, 11, 7, 2.5).fill(INK);
      legL = this.leg("mor-leg", draw, -HIP_X);
      legR = this.leg("mor-leg", draw, HIP_X);
      // La campana del moreno: ancha abajo, pesada, bordada, con sus hombreras.
      const body = this.bake(`mor-bell-${c}`, (g) => {
        g.moveTo(-13, -70).lineTo(13, -70).bezierCurveTo(20, -52, 30, -30, 31, -14).lineTo(26, -6).lineTo(-26, -6).lineTo(-31, -14).bezierCurveTo(-30, -30, -20, -52, -13, -70)
          .closePath().fill(color).stroke({ width: 2.4, color: INK, join: "round" });
        g.rect(-17, -50, 34, 4).fill(GOLD).rect(-24, -32, 48, 4).fill(GOLD).rect(-29, -15, 58, 4).fill(GOLD);
        g.rect(-2, -68, 4, 60).fill({ color: GOLD, alpha: 0.85 });
        const lent = [0xe93d9c, 0x00a896, WHITE, 0xe93d9c, 0x00a896];
        for (let i = 0; i < 5; i++) g.circle(-12 + i * 6, -40, 1.8).fill(lent[i] as number).circle(-20 + i * 10, -22, 2).fill(lent[(i + 2) % 5] as number);
        for (const s of [-1, 1]) {
          g.ellipse(s * 15, -69, 8, 4.5).fill(GOLD).stroke({ width: 1.4, color: INK });
          for (let f = 0; f < 4; f++) g.moveTo(s * (10 + f * 3), -66).lineTo(s * (10 + f * 3), -60).stroke({ width: 1.2, color: GOLD_D });
        }
      });
      avatar.position.set(0, -58);
      armL = this.arm(color, -SHOULDER_X);
      // La matraca gira en la mano derecha.
      const r = this.armWith(color, this.bake("mor-matraca", (g) => g
        .rect(-1.4, -2, 2.8, 9).fill(0x6b4423).stroke({ width: 1, color: INK })
        .roundRect(-2, -16, 15, 9, 2).fill(0x8b5a2b).stroke({ width: 1.4, color: INK })
        .rect(-2, -16, 15, 2.4).fill(GOLD)));
      armR = r.arm;
      prop = r.prop;
      under = this.underMask(skin, hairI);
      head.addChild(this.bake("mor-mask", (g) => {
        // La corona con sus plumas.
        g.moveTo(-4, -104).bezierCurveTo(-14, -118, -18, -122, -22, -126).stroke({ width: 3, color: 0xe93d9c, cap: "round" });
        g.moveTo(4, -104).bezierCurveTo(14, -118, 18, -122, 22, -126).stroke({ width: 3, color: 0x00a896, cap: "round" });
        g.poly([-13, -98, -13, -108, -8, -103, -3, -112, 0, -104, 3, -112, 8, -103, 13, -108, 13, -98]).fill(GOLD).stroke({ width: 1.6, color: INK, join: "round" });
        g.circle(-6, -101, 1.8).fill(0xd52b1e).circle(6, -101, 1.8).fill(0x1f7a3a);
        // La máscara de moreno, de metal labrado: los ojos desorbitados y la
        // lengua afuera, el cansancio del soroche. Plateada y no del color de una
        // piel: pintada de oscuro y con labios gruesos, fuera de Bolivia se lee
        // como caricatura.
        g.ellipse(0, -84, 14, 15).fill(0xc9ccd6).stroke({ width: 2.2, color: INK });
        g.moveTo(-11, -94).lineTo(-3, -91).moveTo(11, -94).lineTo(3, -91).stroke({ width: 1.6, color: GOLD_D });
        g.circle(-6, -87, 6.4).fill(WHITE).stroke({ width: 1.2, color: INK }).circle(6, -87, 6.4).fill(WHITE).stroke({ width: 1.2, color: INK });
        g.circle(-5, -86, 2.8).fill(INK).circle(7, -86, 2.8).fill(INK);
        g.ellipse(0, -75, 6, 2.6).fill(INK).roundRect(-3, -76, 6, 9, 3).fill(0xe93d9c).stroke({ width: 1, color: INK });
      }));
      root.addChild(legL, legR, body, avatar, armL, armR, under, head);
    } else if (dance === "caporales") {
      const draw: Draw = (g) => g
        .rect(-3.5, -6, 7, 7).fill(0xf4f4f4).stroke({ width: 1.4, color: INK })
        .roundRect(-4.6, -1, 9.2, 13, 2.5).fill(0xfafafa).stroke({ width: 1.4, color: INK })
        .circle(-3, 0.5, 1.7).fill(GOLD).stroke({ width: 0.7, color: INK }).circle(0, 1, 1.7).fill(GOLD).stroke({ width: 0.7, color: INK }).circle(3, 0.5, 1.7).fill(GOLD).stroke({ width: 0.7, color: INK })
        .rect(-5.2, 10.5, 10.4, 2.5).fill(INK);
      legL = this.leg("cap-leg", draw, -HIP_X);
      legR = this.leg("cap-leg", draw, HIP_X);
      const body = this.bake(`cap-jacket-${c}`, (g) => {
        g.roundRect(-13, -70, 26, 46, 5).fill(color).stroke({ width: 2.2, color: INK })
          .poly([-12, -73, -30, -71, -32, -61, -12, -61]).fill(color).stroke({ width: 2, color: INK, join: "round" })
          .poly([12, -73, 30, -71, 32, -61, 12, -61]).fill(color).stroke({ width: 2, color: INK, join: "round" });
        g.rect(-5, -68, 10, 40).fill(0xfafafa).stroke({ width: 1, color: INK });
        for (let i = 0; i < 4; i++) g.circle(0, -63 + i * 9, 1.6).fill(GOLD);
        for (const s of [-1, 1]) for (let f = 0; f < 6; f++) g.moveTo(s * (14 + f * 3), -61).lineTo(s * (14 + f * 3), -56).stroke({ width: 1.3, color: GOLD });
        g.rect(-14, -27, 28, 4).fill(INK).rect(-13, -23, 26, 10).fill(0xf4f4f4).stroke({ width: 1.2, color: INK });
      });
      avatar.position.set(-6.5, -50);
      avatar.width = avatar.height = 11;
      armL = this.arm(color, -SHOULDER_X);
      armR = this.arm(color, SHOULDER_X);
      const fc = bare("feat-smile", featSmile);
      head.addChild(this.bake("cap-hat", (g) => g
        .ellipse(0, -97, 22, 5).fill(INK)
        .roundRect(-10, -111, 20, 14, 4).fill(INK)
        .rect(-10, -101, 20, 3).fill(GOLD)
        .moveTo(9, -104).bezierCurveTo(16, -112, 20, -118, 15, -124).stroke({ width: 2.6, color: WHITE, cap: "round" })));
      root.addChild(legL, legR, body, avatar, armL, armR, fc, head);
    } else if (dance === "tinkus") {
      const draw: Draw = (g) => g
        .rect(-4.2, -6, 8.4, 7).fill(0x262626).stroke({ width: 1.4, color: INK })
        .rect(-2.6, 1, 5.2, 7).fill(0x8d5a3b).stroke({ width: 1, color: INK })
        .roundRect(-4.6, 8, 10, 4.4, 1.6).fill(0x6b4423).stroke({ width: 1, color: INK });
      legL = this.leg("tin-leg", draw, -HIP_X);
      legR = this.leg("tin-leg", draw, HIP_X);
      const body = this.bake(`tin-almilla-${c}`, (g) => {
        g.roundRect(-14, -70, 28, 52, 4).fill(color).stroke({ width: 2.2, color: INK });
        const franjas = [0xe93d9c, GOLD, 0x00a896, WHITE];
        for (let i = 0; i < 4; i++) g.rect(-13, -61 + i * 9, 26, 2.6).fill(franjas[i] as number);
        // La chuspa, la bolsita tejida que cuelga a un costado.
        g.moveTo(-10, -66).lineTo(10, -30).stroke({ width: 1.4, color: INK }).roundRect(6, -32, 10, 10, 2).fill(0xe93d9c).stroke({ width: 1.2, color: INK });
      });
      avatar.position.set(-4, -46);
      avatar.width = avatar.height = 12;
      armL = this.arm(color, -SHOULDER_X);
      armR = this.arm(color, SHOULDER_X);
      const fc = bare("feat-shout", featShout);
      head.addChild(this.bake(`tin-head-${c}`, (g) => {
        // La montera, el casco duro, con sus plumas de colores.
        for (let i = 0; i < 5; i++) {
          const a = -0.6 + i * 0.3;
          const x = Math.sin(a) * 18, y = -103 - Math.cos(a) * 18;
          g.moveTo(0, -103).quadraticCurveTo(x * 0.4, -110, x, y).stroke({ width: 3.6, color: FEATHERS[i] as number, cap: "round" });
        }
        g.moveTo(-14, -92).bezierCurveTo(-14, -108, 14, -108, 14, -92).closePath().fill(color).stroke({ width: 2, color: INK })
          .ellipse(0, -92, 18, 3.6).fill(color).stroke({ width: 1.8, color: INK })
          .circle(0, -103, 2.6).fill(GOLD).stroke({ width: 1, color: INK });
      }));
      root.addChild(legL, legR, body, avatar, armL, armR, fc, head);
    } else {
      const draw: Draw = (g) => g.rect(-3.6, -6, 7.2, 14).fill(0xf2ece0).stroke({ width: 1.4, color: INK }).roundRect(-4.8, 7, 10, 5, 1.6).fill(0x6b4423).stroke({ width: 1, color: INK });
      legL = this.leg("lla-leg", draw, -HIP_X);
      legR = this.leg("lla-leg", draw, HIP_X);
      const body = this.bake(`lla-poncho-${c}`, (g) => {
        g.roundRect(-12, -68, 24, 50, 4).fill(0xf2ece0).stroke({ width: 2, color: INK });
        g.poly([-21, -70, 21, -70, 25, -42, 0, -30, -25, -42]).fill(color).stroke({ width: 2.2, color: INK, join: "round" });
        g.moveTo(-23, -46).lineTo(0, -35).lineTo(23, -46).stroke({ width: 2.4, color: GOLD });
        g.moveTo(-22, -52).lineTo(0, -41).lineTo(22, -52).stroke({ width: 2, color: 0xe93d9c });
        g.rect(-2, -70, 4, 30).fill({ color: 0x00a896, alpha: 0.9 });
      });
      avatar.position.set(0, -56);
      avatar.width = avatar.height = 12;
      // En la izquierda la llamita, y en la derecha la honda, que da vueltas:
      // así baila el llamero (en.wikipedia.org/wiki/Llamerada).
      const l = this.bake(`lla-arm-${c}`, (g) => g
        .roundRect(-3.6, -1, 7.2, 23, 3.4).fill(color).stroke({ width: 1.6, color: INK }).circle(0, HAND_Y, 4).fill(color).stroke({ width: 1.4, color: INK })
        .roundRect(-9, 22, 13, 7, 3).fill(WHITE).stroke({ width: 1.2, color: INK })
        .rect(-9, 12, 4, 12).fill(WHITE).stroke({ width: 1.1, color: INK })
        .poly([-10, 12, -9, 8, -7, 12]).fill(WHITE).stroke({ width: 0.9, color: INK })
        .rect(-7, 28, 2, 5).fill(INK).rect(1, 28, 2, 5).fill(INK)
        .rect(-9, 17, 4, 2).fill(0xe93d9c));
      l.position.set(-SHOULDER_X, SHOULDER_Y);
      armL = l;
      const r = this.armWith(color, this.bake("lla-honda", (g) => g.moveTo(0, 0).lineTo(0, -24).stroke({ width: 1.2, color: 0x6b4423 }).circle(0, -26, 3).fill(0x8a8a8a).stroke({ width: 1, color: INK })));
      armR = r.arm;
      prop = r.prop;
      // Los labios fruncidos del llamero que silba para que lo sigan sus llamas.
      const fc = bare("feat-whistle", featWhistle);
      // El sombrero y sus flecos de colores.
      head.addChild(this.bake(`lla-head-${c}`, (g) => {
        g.ellipse(0, -96, 21, 4.6).fill(color).stroke({ width: 1.8, color: INK }).roundRect(-9, -105, 18, 9, 3).fill(color).stroke({ width: 1.8, color: INK });
        const cs = [0xe93d9c, GOLD, 0x00a896, WHITE, 0xd52b1e, 0x6c4ce0, GOLD];
        for (let i = 0; i < 7; i++) g.rect(-15 + i * 4.6, -94, 2.4, 6 + (i % 2) * 3).fill(cs[i] as number);
      }));
      root.addChild(legL, legR, body, avatar, armL, armR, fc, head);
    }
    return { root, legL, legR, armL, armR, head, under, feat: faces.feat, featOh: faces.featOh, prop, cape, dance, seed };
  }

  /**
   * Un músico de la banda de bronces que abre la entrada: uniforme azul con
   * botones dorados y gorra con visera, y su instrumento. No es nadie de la
   * lista: la banda no participa, acompaña.
   */
  musician(kind: Instrument, seed: number): MusicianParts {
    const NAVY = 0x1d2b5c;
    const root = new Container();
    const skin = SKINS[Math.floor(frac(seed * 5.31) * SKINS.length)] as number;
    const draw: Draw = (g) => g.rect(-3.6, -6, 7.2, 14).fill(NAVY).stroke({ width: 1.4, color: INK }).roundRect(-5, 7, 11, 6, 2.5).fill(INK);
    const legL = this.leg("mus-leg", draw, -HIP_X);
    const legR = this.leg("mus-leg", draw, HIP_X);
    const arm = (x: number): Sprite => {
      const s = this.bake("mus-arm", (g) => g.roundRect(-3.6, -1, 7.2, 23, 3.4).fill(NAVY).stroke({ width: 1.6, color: INK }).circle(0, HAND_Y, 3.8).fill(0xd9a273).stroke({ width: 1.2, color: INK }));
      s.position.set(x, SHOULDER_Y);
      return s;
    };
    const armL = arm(-SHOULDER_X);
    const armR = arm(SHOULDER_X);
    const torso = this.bake("mus-torso", (g) => {
      g.roundRect(-13, -70, 26, 52, 5).fill(NAVY).stroke({ width: 2.2, color: INK });
      for (let i = 0; i < 4; i++) g.circle(0, -62 + i * 10, 1.7).fill(GOLD);
      g.ellipse(-14, -69, 6, 3.4).fill(GOLD).ellipse(14, -69, 6, 3.4).fill(GOLD);
    });
    const face = this.bake("face", (g) => g.circle(0, -85, 12).fill(WHITE).stroke({ width: 2, color: INK }), 0, 0, skin);
    const gorra = this.bake("mus-gorra", (g) => g
      .circle(-4.5, -85, 1.7).fill(INK).circle(4.5, -85, 1.7).fill(INK)
      .roundRect(-12, -103, 24, 10, 3).fill(NAVY).stroke({ width: 1.6, color: INK })
      .rect(-12, -97, 24, 2.6).fill(GOLD)
      .ellipse(4, -93, 11, 2.6).fill(INK));
    let horn: Sprite;
    if (kind === "bajo") {
      horn = this.bake("mus-bajo", (g) => g
        .ellipse(0, -46, 20, 22).stroke({ width: 5, color: GOLD_D })
        .ellipse(0, -46, 20, 22).stroke({ width: 3, color: GOLD })
        .moveTo(16, -60).bezierCurveTo(22, -86, 18, -100, 10, -110).stroke({ width: 5, color: GOLD })
        .circle(10, -116, 15).fill(GOLD).stroke({ width: 2, color: INK }).circle(10, -116, 9).fill(GOLD_D), 0, -46);
    } else if (kind === "trompeta") {
      horn = this.bake("mus-trompeta", (g) => g
        .rect(4, -82, 22, 3.4).fill(GOLD).stroke({ width: 1, color: INK })
        .poly([24, -86, 34, -91, 34, -71, 24, -76]).fill(GOLD).stroke({ width: 1.2, color: INK })
        .rect(10, -79, 3, 6).fill(GOLD_D).rect(15, -79, 3, 6).fill(GOLD_D), 4, -80);
    } else if (kind === "bombo") {
      horn = this.bake("mus-bombo", (g) => g
        .roundRect(-18, -60, 36, 30, 6).fill(0xf6efe2).stroke({ width: 2.2, color: INK })
        .rect(-18, -60, 36, 5).fill(0xd52b1e).rect(-18, -35, 36, 5).fill(0xd52b1e)
        .moveTo(-14, -55).lineTo(14, -35).moveTo(14, -55).lineTo(-14, -35).stroke({ width: 1.2, color: GOLD_D }), 0, -45);
    } else {
      horn = this.bake("mus-platillos", (g) => g
        .ellipse(-20, -58, 4, 12).fill(GOLD).stroke({ width: 1.4, color: INK })
        .ellipse(20, -58, 4, 12).fill(GOLD).stroke({ width: 1.4, color: INK }), 0, -58);
    }
    root.addChild(legL, legR, torso, armL, horn, armR, face, gorra);
    return { root, armL, armR, horn, kind, seed };
  }
}

/** Las caras: los ojos y la boca de cada uno. */
const featSmile: Draw = (g) => g
  .circle(-4.5, -86, 1.8).fill(INK).circle(4.5, -86, 1.8).fill(INK)
  .moveTo(-4, -79).quadraticCurveTo(0, -76, 4, -79).stroke({ width: 1.4, color: INK });
/** El tinku grita. */
const featShout: Draw = (g) => g.circle(-4.5, -86, 1.8).fill(INK).circle(4.5, -86, 1.8).fill(INK).ellipse(0, -79, 3, 2.2).fill(INK);
/** El llamero silba para que lo sigan sus llamas. */
const featWhistle: Draw = (g) => g.circle(-4.5, -84, 1.8).fill(INK).circle(4.5, -84, 1.8).fill(INK).circle(0, -78, 2.2).fill(0xd52b1e).stroke({ width: 1.1, color: INK });
/** La cara del susto: los ojos grandes y la boca en o. */
const featOhDraw: Draw = (g) => g
  .circle(-4.6, -86, 2.7).fill(WHITE).stroke({ width: 1, color: INK }).circle(4.6, -86, 2.7).fill(WHITE).stroke({ width: 1, color: INK })
  .circle(-4.6, -86, 1.2).fill(INK).circle(4.6, -86, 1.2).fill(INK)
  .moveTo(-7.2, -90.6).lineTo(-2.6, -91.6).moveTo(7.2, -90.6).lineTo(2.6, -91.6).stroke({ width: 1.2, color: INK })
  .ellipse(0, -78.6, 2.3, 2.9).fill(INK);

/** Los músicos de la banda de bronces que abre la entrada. */
export type Instrument = "bombo" | "bajo" | "trompeta" | "platillos";

export interface MusicianParts {
  root: Container;
  armL: Container;
  armR: Container;
  /** El instrumento, que se mueve con el golpe. */
  horn: Container;
  kind: Instrument;
  seed: number;
}

/** El músico toca: el golpe del bombo en cada tiempo, los platillos cada dos, los vientos se mecen. */
export function poseMusician(m: MusicianParts, b: number, e: number, x: number, y: number, s: number): void {
  const sb = Math.sin(b);
  m.root.position.set(x, y - Math.abs(sb) * 3 * e * s);
  m.root.rotation = Math.sin(b * 0.5 + m.seed) * 0.04 * e;
  m.root.scale.set(s, s);
  m.horn.rotation = 0;
  m.horn.scale.x = 1;
  if (m.kind === "bombo") {
    // El mazo cae en el tiempo.
    m.armL.rotation = 0.4;
    m.armR.rotation = -(0.5 + Math.max(0, Math.cos(b)) * 0.9 * e);
  } else if (m.kind === "platillos") {
    const c = Math.abs(Math.sin(b * 0.5));
    m.horn.scale.x = 0.55 + 0.45 * c;
    m.armL.rotation = 0.9 + 0.3 * c * e;
    m.armR.rotation = -(0.9 + 0.3 * c * e);
  } else {
    // Los vientos: el instrumento sube y baja con el soplido.
    m.horn.rotation = sb * 0.05 * e;
    m.armL.rotation = 1.2;
    m.armR.rotation = -1.0;
  }
}

function frac(x: number): number {
  return x - Math.floor(x);
}

/**
 * La pose de un bailarín, con los pies en (x, y) y la escala (sx, sy). Todo
 * sale de la fase, el reloj y lo que le pasa, sin memoria: la misma hora dibuja
 * el mismo cuerpo.
 */
export function pose(p: DancerParts, s: Pose, x: number, y: number, sx: number, sy: number): void {
  const { lift, lean } = body(p, s);
  p.root.position.set(x, y - lift * sy);
  p.root.rotation = lean;
  p.root.scale.set(sx, sy);
  // Lo que lleva en la mano: el tridente queda parado aunque el brazo suba; la
  // matraca y la honda giran solas mientras baila.
  if (p.prop) {
    if (p.dance === "diablada") p.prop.rotation = -p.armR.rotation - lean;
    else p.prop.rotation = s.t * (p.dance === "llamerada" ? 11 : 9) * (s.mode === "fall" ? 0 : 1);
  }
}

/** Mueve las piernas, los brazos y la cabeza, y dice cuánto sube el cuerpo y cuánto se inclina. */
function body(p: DancerParts, s: Pose): { lift: number; lean: number } {
  const { legL, legR, armL, armR, head } = p;
  const e = s.e;
  const b = s.b + p.seed * 0.35;
  const sb = Math.sin(b);
  const up = Math.abs(sb);
  // Lo de siempre, que cada caso pisa.
  legL.y = legR.y = HIP_Y;
  legL.rotation = legR.rotation = 0;
  head.x = 0;
  head.y = HEAD_Y;
  head.rotation = 0;
  if (p.cape) p.cape.skew.x = 0;
  // La cara del susto, en el tropezón y en la caída; la de abajo de la máscara,
  // cuando la máscara se corre.
  const scared = s.mode === "stumble" || s.mode === "fall";
  if (p.feat && p.featOh) {
    p.feat.visible = !scared;
    p.featOh.visible = scared;
  }
  if (p.under) p.under.visible = scared;

  if (s.mode === "salute") {
    // Saludan desde la vereda: los dos brazos arriba, agitándolos.
    armL.rotation = 2.45 + Math.sin(s.t * 7 + p.seed) * 0.35;
    armR.rotation = -(2.45 + Math.sin(s.t * 7 + p.seed + 1.3) * 0.35);
    return { lift: Math.abs(Math.sin(s.t * 5 + p.seed)) * 2.5, lean: 0 };
  }
  if (s.mode === "jump") {
    armL.rotation = 2.1;
    armR.rotation = -2.1;
    legL.rotation = 0.3;
    legR.rotation = -0.3;
    legL.y = legR.y = HIP_Y - Math.min(6, s.f * 0.15);
    return { lift: s.f, lean: 0 };
  }
  if (s.mode === "stumble") {
    // Trastabilla y aguanta: se tambalea, los brazos buscan el equilibrio y lo
    // de la cabeza se le corre. Termina derecho.
    const f = Math.min(1, Math.max(0, s.f));
    const w = Math.sin(f * Math.PI * 3) * (1 - f);
    armL.rotation = 1.3 + Math.sin(f * 21) * 0.7 * (1 - f);
    armR.rotation = -(1.3 + Math.cos(f * 19) * 0.7 * (1 - f));
    legL.rotation = 0.25 * (1 - f);
    head.x = Math.sin(f * Math.PI) * 7 * s.dir;
    head.rotation = Math.sin(f * Math.PI) * 0.45 * s.dir;
    return { lift: 0, lean: w * 0.32 * s.dir };
  }
  if (s.mode === "fall") {
    // El último salto termina en el piso: cae sentado, y lo que tenía en la
    // cabeza sale volando y rueda. Se ríe todo el mundo.
    const f = Math.min(1, Math.max(0, s.f));
    const c = ease(f / 0.6);
    armL.rotation = 1.6 + Math.sin(f * 14) * 0.4 * (1 - f);
    armR.rotation = -(1.6 + Math.cos(f * 14) * 0.4 * (1 - f));
    legL.rotation = c * 1.1;
    legR.rotation = -c * 0.4;
    const v = Math.min(1, f / 0.75);
    head.x = v * 34 * s.dir;
    head.y = HEAD_Y - Math.sin(v * Math.PI) * 34 + v * 70;
    head.rotation = v * 5.5 * s.dir;
    return { lift: -c * 26, lean: -c * 0.5 * s.dir };
  }

  switch (p.dance) {
    case "diablada": {
      // Salta con la rodilla alta, los brazos suben y bajan alternados.
      legL.y = HIP_Y - Math.max(0, sb) * 9 * e;
      legR.y = HIP_Y - Math.max(0, -sb) * 9 * e;
      legL.rotation = Math.max(0, sb) * 0.35 * e;
      legR.rotation = -Math.max(0, -sb) * 0.35 * e;
      armL.rotation = 0.3 + (0.9 + sb * 0.7) * e;
      armR.rotation = -(0.3 + (0.9 - sb * 0.7) * e);
      if (p.cape) p.cape.skew.x = sb * 0.2 * e;
      return { lift: up * 10 * e, lean: Math.sin(b * 0.5) * 0.05 * e };
    }
    case "morenada": {
      // Pesado y cadencioso: se mece de un lado al otro, la matraca girando.
      const half = Math.sin(b * 0.5);
      legL.y = HIP_Y - Math.max(0, half) * 3 * e;
      legR.y = HIP_Y - Math.max(0, -half) * 3 * e;
      armL.rotation = 0.5 + half * 0.25 * e;
      armR.rotation = -(1.05 + sb * 0.18 * e);
      return { lift: up * 3 * e, lean: half * 0.1 * e };
    }
    case "caporales": {
      // Salta y patea: una pierna afuera en cada tiempo, los brazos abiertos.
      legL.rotation = Math.max(0, sb) * 0.95 * e;
      legR.rotation = -Math.max(0, -sb) * 0.95 * e;
      legL.y = HIP_Y - Math.max(0, sb) * 4 * e;
      legR.y = HIP_Y - Math.max(0, -sb) * 4 * e;
      armL.rotation = 0.95 + sb * 0.35 * e;
      armR.rotation = -(0.95 - sb * 0.35 * e);
      return { lift: up * 13 * e, lean: sb * 0.06 * e };
    }
    case "tinkus": {
      // Agachado y zapateando, con los puños arriba, en zigzag.
      legL.rotation = 0.22 * e;
      legR.rotation = -0.22 * e;
      legL.y = HIP_Y - Math.max(0, sb) * 6 * e;
      legR.y = HIP_Y - Math.max(0, -sb) * 6 * e;
      armL.rotation = 2.25 + sb * 0.45 * e;
      armR.rotation = -(2.25 - sb * 0.45 * e);
      return { lift: -up * 6 * e, lean: Math.sin(b * 0.5) * 0.12 * e };
    }
    default: {
      // El paso del llamero, con la honda dando vueltas arriba.
      legL.rotation = sb * 0.3 * e;
      legR.rotation = -sb * 0.3 * e;
      armL.rotation = 0.3 + sb * 0.25 * e;
      armR.rotation = -2.6;
      return { lift: up * 5 * e, lean: sb * 0.04 * e };
    }
  }
}

/** Lo que mide cada baile de alto, de los pies a la punta, en unidades del dibujo. */
export const DANCE_TOP: Record<Dance, number> = { diablada: 130, morenada: 128, caporales: 126, tinkus: 124, llamerada: 108 };

/** Lo que se le cae a cada baile en el susto y en la caída: la palabra para el relator. */
export type Prenda = "mascara" | "sombrero" | "montera";
export const PRENDA: Record<Dance, Prenda> = { diablada: "mascara", morenada: "mascara", caporales: "sombrero", tinkus: "montera", llamerada: "sombrero" };
