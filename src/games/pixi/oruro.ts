import { Container, Graphics, Sprite, type Texture } from "pixi.js";
import { T, getLang, t } from "../../i18n";
import { musicHold } from "../../music";
import { paceFactor, setGameLength, type Beacon } from "../../state";
import { beep, fanfare, note } from "../../sound";
import { enOrden } from "../drama";
import { generoDe } from "../genero";
import { WINNER_HOLD, clamp, ease, winnersLabel } from "../overlay";
import { CHIP_SCALE, CREAM, INK, MONO, YELLOW, hash, mountPixi, type PixiStage } from "./stage";
import { layoutLabels, type LabelItem, type Rect } from "./pinata-labels";
import { OUT_HOLD, counterText, estimateTagSize, outTreatment, selectTags, tagBudget, tagName, type TagCandidate } from "./oruro-tags";
import { planEntrada, type Arch, type Frat } from "./entrada-plan";
import { DANCE_TOP, Wardrobe, prendaDe, pose, poseMusician, type DancerParts, type Instrument, type MusicianParts, type PoseMode } from "./entrada-bailes";

/**
 * La Entrada (id `oruro`): el Carnaval de Oruro, por fraternidades. Sección
 * 7.8 del plan de juegos.
 *
 * Una banda de bronces abre el desfile y detrás pasan las fraternidades, cada
 * una con su baile: Diablada, Morenada, Caporales, Tinkus y Llamerada. Cada
 * grupo de la lista es una fraternidad (`grupos.ts`: el mismo reparto del
 * teleférico, con el mismo nombre y el mismo color), y mientras pasa frente al
 * palco se leen los nombres de todos sus integrantes. Después, en cada arco se
 * queda una fraternidad entera y saluda desde la vereda; en la última se quedan
 * de a varios hasta que quedan dos, que hacen el contrapunto frente al
 * Socavón. Los dos saltan alternados y en cualquier salto cualquiera de los
 * dos puede trastabillar, hasta que el último salto de uno termina en el piso.
 * El que llega, llega con campanas y cohetillos.
 *
 * La sala aplaude al ritmo de la banda: el golpe del bombo, el zapateo y el
 * bombo de arriba a la derecha van juntos, a 120 golpes por minuto reales con
 * cualquier duración (el tiempo de juego se estira, el golpe no).
 *
 * Todo sale del plan (`entrada-plan.ts`), escrito con la semilla de la ronda
 * antes del primer cuadro: el ganador ya está decidido y el juego lo cuenta.
 * Los arcos del director de emoción tienen cada uno su giro:
 *
 * - **susto**: a uno de la última fraternidad casi se le cae la máscara (o el
 *   sombrero, o la montera), sorteado entre todos los que bailan;
 * - **remontada**: una fraternidad arranca para la vereda como si se quedara,
 *   y vuelve a la comparsa;
 * - **duelo**: el contrapunto dura dos saltos más;
 * - **tapada**: la banda se calla de golpe y la entrada se congela.
 */

const DT = 1 / 120;
/** Qué tan rápido sigue cada bailarín a su lugar: la cámara sigue a los lugares con el mismo ritmo. */
const FOLLOW = 4;
/** El golpe de la banda en segundos reales: 120 por minuto, para aplaudir cómodo con cualquier duración. */
const BEAT_REAL = 0.5;
/**
 * El nombre más largo en un cartel, en caracteres: el nombre entero. Cortado a
 * doce, con nombres repetidos y numerados no se sabía cuál se quedaba.
 */
const TAG_CHARS = 20;
/** Los carteles con nombre miden por lo menos esto de letra en la pantalla. */
const TAG_FONT_PX = 14;
/** Medio ancho de un bailarín, en unidades de su dibujo. */
const BODY_HALF_W = 34;
/** Lugar para los nombres encima de las cabezas, en unidades de pantalla. */
const TAG_ROOM = 30;
/** Cuánto se queda la cámara en los que se quedan, después de que salen a la vereda. */
const CLOSE_UP = 0.95;
/** Lo que se queda arriba el pedido de aplaudir, antes del primer anuncio. */
const CLAP_HOLD = 1.9;
/** La banda: bombo, platillos, dos bajos y dos trompetas, en dos filas. */
const BAND: readonly Instrument[] = ["bombo", "bajo", "trompeta", "platillos", "bajo", "trompeta"];

type Phase = "pres" | "walk" | "duel" | "crown" | "dead";

interface Dancer {
  idx: number;
  f: Frat;
  /** Su lugar en el bloque de su fraternidad: columna = slot / fondo, fila = slot % fondo. */
  slot: number;
  x: number;
  y: number;
  alive: boolean;
  /** Cuándo salió a la vereda (-1 si sigue en la comparsa). */
  left: number;
  wx: number;
  wy: number;
  seed: number;
  /** Con el traje de las mujeres de su baile: sale del nombre (`genero.ts`). */
  woman: boolean;
  parts: DancerParts | null;
  chip?: Container;
  strike?: Graphics;
  prize?: Graphics;
  tagW?: number;
}

interface Musician {
  i: number;
  x: number;
  y: number;
  parts: MusicianParts | null;
}

interface Geo {
  w: number;
  h: number;
  k: number;
  streetTop: number;
  streetBot: number;
  /** La escala de los bailarines: más chicos con más gente, como antes. */
  scale: number;
  /** De una columna de la formación a la siguiente. */
  dx: number;
  /** Cuántas filas tiene el bloque de cada fraternidad, a lo ancho de la calle. */
  depth: number;
  /** El hueco entre dos fraternidades, donde va su cartel. */
  gap: number;
  /** Lo que avanza la cabeza por segundo de juego, cuando camina. */
  speed: number;
}

export async function oruroPixi(names: string[], winners: readonly number[], beacon: Beacon, done: () => void): Promise<void> {
  let skipFn = (): void => {};
  const st = await mountPixi(beacon, done, () => skipFn());
  if (!st) {
    done();
    return;
  }
  const S: PixiStage = st;
  const { rng, cam } = S;
  // Sin el desenfoque de los acercamientos: la cámara va y viene entre la
  // comparsa y los que se quedan, y los nombres tienen que leerse en el viaje.
  cam.noBlur();
  const n = names.length;
  const P = planEntrada(n, winners, rng);
  S.mark("arco", P.arc);
  setGameLength(P.T_CROWN, WINNER_HOLD);
  /** El golpe de la banda en segundos de juego: los segundos reales no cambian con la duración. */
  const BEAT = BEAT_REAL / paceFactor();
  const winnerIdx = P.winner;
  const rivalIdx = P.rival;
  const winFrat = P.frats[P.winG] as Frat;
  const lastFratExit = P.fratArches > 0 ? (P.arches[P.fratArches - 1] as Arch).tExit : -Infinity;
  const fz = P.twists.freeze;
  const fk = P.twists.fake;
  const sc = P.twists.scare;
  // Las piezas de los trajes se pasan a textura con lugar para el acercamiento
  // más grande (unos 3 píxeles por unidad del dibujo, por la densidad de la pantalla).
  const wardrobe = new Wardrobe(S.app.renderer, Math.min(6, 3 * Math.min(window.devicePixelRatio || 1, 2)));
  S.onCleanup(() => wardrobe.destroy());

  /* ------------------------------------------------------------ el reparto */
  const dancers: Dancer[] = [];
  const byIdx = new Map<number, Dancer>();
  for (const f of P.frats) {
    f.members.forEach((idx, slot) => {
      const woman = generoDe(names[idx] ?? "") === "f";
      const d: Dancer = { idx, f, slot, x: 0, y: 0, alive: true, left: -1, wx: 0, wy: 0, seed: hash(idx, 7) * 6, woman, parts: null };
      dancers.push(d);
      byIdx.set(idx, d);
    });
  }
  const win = byIdx.get(winnerIdx) as Dancer;
  const riv = rivalIdx >= 0 ? (byIdx.get(rivalIdx) as Dancer) : null;
  const band: Musician[] = BAND.map((_, i) => ({ i, x: 0, y: 0, parts: null }));
  /** Las fraternidades que siguen en la comparsa. */
  const inColumn = new Set(P.order);
  /** Cuántos arcos ya pasaron (cuántas salidas a la vereda). */
  let exitsDone = 0;

  /* -------------------------------------------------------------- geometría */
  const maxSize = Math.max(1, ...P.frats.map((f) => f.members.length));
  const G = (): Geo => {
    const w = S.sw(), h = S.sh(), k = S.u();
    const streetTop = h * 0.5, streetBot = h - S.bottom() - 16 * k;
    const scale = clamp(Math.sqrt(40 / Math.max(2, n)), 0.35, 1.25) * k;
    const dx = 58 * scale;
    // El fondo de cada bloque: en la pantalla grande, casi cuadrado; en un
    // celular, más hondo y más angosto, porque la calle no entra a lo ancho.
    const depth = S.portrait() ? clamp(Math.ceil(Math.sqrt(maxSize * 2)), 1, 7) : clamp(Math.ceil(Math.sqrt(maxSize)), 1, 5);
    return { w, h, k, streetTop, streetBot, scale, dx, depth, gap: dx * 1.1, speed: 0.26 * Math.max(w, h * 0.6) };
  };
  const colsOf = (m: number, g: Geo): number => Math.max(1, Math.ceil(m / g.depth));
  const bandCols = 3;
  const widthOf = (cols: number, g: Geo): number => cols * g.dx + (g.depth > 1 ? g.dx * 0.5 : 0);
  /** Los que siguen en el bloque de una fraternidad, en su orden de formación. */
  const aliveOf = (f: Frat): Dancer[] => f.members.map((i) => byIdx.get(i) as Dancer).filter((d) => d.alive);
  /** El y de una fila de la calle: la del fondo arriba, la de adelante abajo. */
  const rowY = (row: number, rows: number, g: Geo): number => {
    const H = g.streetBot - g.streetTop;
    return g.streetTop + H * 0.1 + ((row + 0.5) / rows) * H * 0.8;
  };

  /**
   * El frente de cada bloque, desde la cabeza para atrás: primero la banda,
   * después las fraternidades que siguen, en el orden del desfile. En x del
   * mundo, relativo a la cabeza.
   */
  function frontOffsets(g: Geo, all = false): { band: number; front: Map<number, number>; length: number } {
    const front = new Map<number, number>();
    let x = 0;
    const bandAt = x;
    x -= widthOf(bandCols, g) + g.gap;
    for (const gi of P.order) {
      const f = P.frats[gi] as Frat;
      if (!all && !inColumn.has(gi)) continue;
      front.set(gi, x);
      const m = all ? f.members.length : aliveOf(f).length;
      x -= widthOf(colsOf(m, g), g) + g.gap;
    }
    return { band: bandAt, front, length: -x - g.gap };
  }

  /* ------------------------------------------------- por dónde va la cabeza */
  /**
   * La presentación: la comparsa pasa frente al palco (x = 0) a velocidad
   * pareja, y cada fraternidad queda centrada en el medio de su turno. Después,
   * el recorrido: la cabeza avanza a paso de entrada, frena un poco en cada
   * arco y se queda quieta mientras la banda calla.
   */
  let knots: { t: number; x: number }[] = [];
  let walkKnots: { m: number; x: number }[] = [];
  let X_GO = 0;
  let socX = 0;
  let archX: number[] = [];
  /** El tiempo que corre la comparsa: el reloj menos lo que estuvo congelada. */
  const moving = (tt: number): number => (!fz || tt <= fz.t0 ? tt : tt - (Math.min(tt, fz.t1) - fz.t0));
  function planRoute(g: Geo): void {
    const off = frontOffsets(g, true);
    knots = P.pres.map((p) => {
      const f = P.frats[p.g] as Frat;
      const center = (off.front.get(p.g) ?? 0) - widthOf(colsOf(f.members.length, g), g) / 2;
      return { t: (p.t0 + p.t1) / 2, x: -center };
    });
    if (knots.length === 1) {
      const k0 = knots[0] as { t: number; x: number };
      knots.push({ t: k0.t + 1, x: k0.x + g.speed * 0.5 });
    }
    X_GO = headPres(P.T_GO);
    const m0 = moving(P.T_GO);
    walkKnots = [{ m: m0, x: X_GO }];
    archX = [];
    for (const a of P.arches) {
      const x = X_GO + g.speed * (moving(a.t) - m0);
      walkKnots.push({ m: moving(a.t), x });
      archX.push(x);
    }
    socX = X_GO + g.speed * (moving(P.T_SOCAVON) - m0);
    walkKnots.push({ m: moving(P.T_SOCAVON), x: socX });
  }
  function headPres(tt: number): number {
    const a = knots[0] as { t: number; x: number }, b = knots[1] as { t: number; x: number };
    if (tt <= a.t) return a.x + ((b.x - a.x) / (b.t - a.t)) * (tt - a.t);
    for (let i = 0; i < knots.length - 1; i++) {
      const p = knots[i] as { t: number; x: number }, q = knots[i + 1] as { t: number; x: number };
      if (tt <= q.t) return p.x + ((q.x - p.x) * (tt - p.t)) / (q.t - p.t);
    }
    const p = knots[knots.length - 2] as { t: number; x: number }, q = knots[knots.length - 1] as { t: number; x: number };
    return q.x + ((q.x - p.x) / (q.t - p.t)) * (tt - q.t);
  }
  function headX(tt: number): number {
    if (tt <= P.T_GO) return headPres(tt);
    const m = moving(tt);
    for (let i = 0; i < walkKnots.length - 1; i++) {
      const p = walkKnots[i] as { m: number; x: number }, q = walkKnots[i + 1] as { m: number; x: number };
      if (m <= q.m) {
        const u = clamp((m - p.m) / Math.max(1e-6, q.m - p.m), 0, 1);
        // Frena un poco en cada arco: más lento en las puntas, más rápido en el medio.
        return p.x + (q.x - p.x) * (0.6 * u + 0.4 * (0.5 - 0.5 * Math.cos(Math.PI * u)));
      }
    }
    return socX;
  }

  /* ---------------------------------------------------------- los lugares */
  /** Dónde va un bailarín que sigue en la comparsa, con la cabeza en `hx`. */
  function slotPos(d: Dancer, hx: number, g: Geo, off: ReturnType<typeof frontOffsets>): { x: number; y: number } {
    const front = (off.front.get(d.f.g) ?? 0) + hx;
    const col = Math.floor(d.slot / g.depth), row = d.slot % g.depth;
    return { x: front - g.dx * 0.5 - col * g.dx - (row % 2) * g.dx * 0.5, y: rowY(row, g.depth, g) };
  }
  function bandPos(m: Musician, hx: number, g: Geo): { x: number; y: number } {
    const col = Math.floor(m.i / 2), row = m.i % 2;
    return { x: hx - g.dx * 0.5 - col * g.dx - row * g.dx * 0.5, y: rowY(row === 0 ? 0 : g.depth - 1, g.depth, g) };
  }
  /** El centro del contrapunto, frente a la puerta del Socavón. */
  const duelCenter = (g: Geo): { x: number; y: number } => ({ x: socX, y: g.streetTop + (g.streetBot - g.streetTop) * 0.34 });
  const doorX = (g: Geo): number => socX + 170 * g.k;
  /**
   * Adonde llega el que gana: la plaza frente a la puerta del Socavón, no
   * adentro. El santuario no es el premio: los bailarines de verdad entran de
   * rodillas, y eso no se juega.
   */
  const arriveAt = (g: Geo): { x: number; y: number } => ({ x: doorX(g) - 70 * g.k, y: g.streetTop + 20 * g.k });
  /** De qué lado del contrapunto va cada uno: el que gana, del lado que sorteó el plan. */
  function duelPos(d: Dancer, g: Geo): { x: number; y: number } {
    const c = duelCenter(g);
    const s = d === win ? P.side : -P.side;
    return { x: c.x + s * 52 * g.scale, y: c.y + (d === win ? 0 : 6 * g.scale) };
  }
  /** La vereda de los que se quedan: en dos filas, frente a la gradería, donde estaban. */
  function sidewalk(ids: number[], g: Geo): void {
    const ds = ids.map((i) => byIdx.get(i) as Dancer);
    const cx = ds.reduce((a, d) => a + d.x, 0) / Math.max(1, ds.length);
    const perRow = Math.max(1, Math.ceil(ds.length / 2));
    const sp = g.dx * 0.85;
    ds.forEach((d, i) => {
      const row = i < perRow ? 0 : 1;
      const col = row === 0 ? i : i - perRow;
      const cnt = row === 0 ? perRow : ds.length - perRow;
      d.wx = cx + (col - (cnt - 1) / 2) * sp + (row ? sp * 0.5 : 0);
      d.wy = g.streetTop - (row === 0 ? 13 : 2) * g.k;
    });
  }
  /** Rearma los lugares de la última fraternidad cuando se quedan algunos: los que siguen se juntan. */
  function relayout(f: Frat): void {
    aliveOf(f).forEach((d, i) => {
      d.slot = i;
    });
  }

  /* --------------------------------------------------------------- estado */
  let phase: Phase = "pres";
  let tAll = 0, acc = 0, tHold = 0;
  /** El reloj del paso: corre con la banda y se detiene cuando la banda calla. */
  let beatT = 0;
  let beatsDone = 0;
  let crowned = false;
  const said = new Set<string>();
  const once = (key: string, cond: boolean, fn: () => void): void => {
    if (!cond || said.has(key)) return;
    said.add(key);
    fn();
  };
  let lastSay = -9;
  const say = (msg: string, heat: number): void => {
    S.say(msg, heat);
    lastSay = tAll;
  };

  /* ---------------------------------------------------------- las salidas */
  function applyExit(a: Arch): void {
    const g = G();
    for (const i of a.exit.ids) {
      const d = byIdx.get(i) as Dancer;
      d.alive = false;
      d.left = a.tExit;
    }
    sidewalk(a.exit.ids, g);
    if (a.exit.kind === "frat") inColumn.delete(a.exit.g);
    else relayout(P.frats[a.exit.g] as Frat);
  }

  /* --------------------------------------------------------------- física */
  function step(dt: number): void {
    const g = G();
    const hx = headX(tAll);
    const off = frontOffsets(g);
    const sp = Math.min(1, dt * FOLLOW);
    const fakeOn = fk && tAll >= fk.t0 && tAll < fk.t1 ? Math.sin(Math.PI * ((tAll - fk.t0) / (fk.t1 - fk.t0))) : 0;
    for (const d of dancers) {
      let target: { x: number; y: number };
      if (!d.alive) target = { x: d.wx, y: d.wy };
      else if (tAll >= P.T_SOCAVON && (d === win || d === riv)) {
        target = duelPos(d, g);
        // Llegó: el que gana camina hasta la puerta del Socavón.
        if (d === win && tAll >= P.T_ARRIVE) target = arriveAt(g);
      } else {
        target = slotPos(d, hx, g, off);
        // El amague de la remontada: arrancan para la vereda y vuelven.
        if (fakeOn > 0 && fk && fk.ids.includes(d.idx)) {
          const y0 = g.streetTop - 6 * g.k;
          target = { x: target.x, y: target.y + (y0 - target.y) * 0.6 * fakeOn };
        }
      }
      d.x += (target.x - d.x) * sp;
      d.y += (target.y - d.y) * sp;
    }
    const bsp = Math.min(1, dt * FOLLOW);
    for (const m of band) {
      // En el Socavón la banda se corre a un costado y sigue tocando.
      const p = tAll < P.T_SOCAVON - 0.4 ? bandPos(m, hx, g) : { x: duelCenter(g).x - 1000 * g.k - Math.floor(m.i / 2) * g.dx, y: rowY(m.i % 2, 3, g) };
      m.x += (p.x - m.x) * bsp;
      m.y += (p.y - m.y) * bsp;
    }
  }

  /* ---------------------------------------------------------------- escena */
  let facades!: Graphics;
  let lights!: Container;
  let arches!: Graphics;
  let church!: Graphics;
  let street!: Graphics;
  let crowdLayer!: Container;
  let dancerLayer!: Container;
  let fx!: Graphics;
  let banners!: Graphics;
  /**
   * El público de las graderías y los focos de las guirnaldas: solo los que mira
   * la cámara, de una reserva que se reusa. Con todo el recorrido armado eran
   * casi dos mil sprites por cuadro, y la mayoría fuera de cuadro.
   */
  let people: Texture[] = [];
  let dot!: Texture;
  const crowdPool: Sprite[] = [];
  const lightPool: Sprite[] = [];
  const archLabels: Container[] = [];

  function makeViews(): void {
    for (const d of dancers) {
      d.parts?.root.destroy({ children: true });
      const p = wardrobe.make(d.f.dance, d.f.color, S.face(names[d.idx] ?? ""), hash(d.idx, 11), d.woman);
      d.parts = p;
      dancerLayer.addChild(p.root);
      d.chip?.destroy({ children: true });
      d.chip = undefined;
      d.strike = undefined;
      d.prize = undefined;
    }
    for (const m of band) {
      m.parts?.root.destroy({ children: true });
      const p = wardrobe.musician(BAND[m.i] as Instrument, hash(m.i, 23));
      m.parts = p;
      dancerLayer.addChild(p.root);
    }
  }

  function build(): void {
    const g = G();
    const k = g.k;
    for (const c of [S.bg, S.scene, S.hud]) c.removeChildren().forEach((x) => x.destroy({ children: true }));
    for (const d of dancers) d.parts = null;
    for (const m of band) m.parts = null;
    crowdPool.length = 0;
    lightPool.length = 0;
    archLabels.length = 0;
    planRoute(g);
    const x0 = headPres(0) - frontOffsets(g, true).length - g.w * 1.5;
    const x1 = doorX(g) + g.w * 1.2;
    // El cielo de la noche de carnaval.
    S.bg.addChild(new Graphics().rect(0, 0, g.w, g.h).fill(S.dark ? 0x140e2a : 0x2a2056));
    facades = new Graphics();
    lights = new Container();
    arches = new Graphics();
    church = new Graphics();
    street = new Graphics();
    crowdLayer = new Container();
    dancerLayer = new Container();
    dancerLayer.sortableChildren = true;
    fx = new Graphics();
    banners = new Graphics();
    S.scene.addChild(facades, church, lights, crowdLayer, street, arches, banners, dancerLayer, fx);
    // Las fachadas coloniales, con balcones y ventanas encendidas.
    const pastel = [0xe9b8a5, 0xa9d1c4, 0xf3d37c, 0xb9a6e0, 0xf0a3b6, 0x9ec3e6];
    for (let x = x0, i = 0; x < x1; i++) {
      const fw = (120 + hash(i, 1) * 90) * k, fh = (150 + hash(i, 2) * 90) * k;
      const top = g.streetTop - 58 * k - fh;
      facades.rect(x, top, fw, fh + 58 * k).fill(pastel[i % pastel.length] as number).stroke({ width: 2 * k, color: INK });
      for (let wy = top + 22 * k; wy < g.streetTop - 78 * k; wy += 46 * k) {
        for (let wx = x + 16 * k; wx < x + fw - 30 * k; wx += 36 * k) {
          facades.rect(wx, wy, 18 * k, 26 * k).fill(hash(Math.round(wx), Math.round(wy)) < 0.6 ? 0xffd27a : 0x3a2f55).stroke({ width: 1.5 * k, color: INK });
        }
        facades.rect(x + 8 * k, wy + 28 * k, fw - 16 * k, 4 * k).fill(INK);
      }
      x += fw;
    }
    // Las graderías con la gente, y delante la vereda: ahí saludan los que se quedan.
    facades.rect(x0, g.streetTop - 58 * k, x1 - x0, 40 * k).fill(S.dark ? 0x2b2640 : 0x5b5f79);
    for (let tier = 0; tier < 2; tier++) facades.rect(x0, g.streetTop - 58 * k + (tier + 1) * 14 * k, x1 - x0, 3 * k).fill({ color: 0x000000, alpha: 0.3 });
    facades.rect(x0, g.streetTop - 18 * k, x1 - x0, 18 * k).fill(S.dark ? 0x4d4760 : 0x9a94a8);
    facades.rect(x0, g.streetTop - 3 * k, x1 - x0, 3 * k).fill(S.dark ? 0x2a2438 : 0x6b6478);
    // El palco, donde se presenta cada fraternidad: un toldo de colores sobre la gradería.
    {
      const px = 0, pw = 200 * k, top = g.streetTop - 150 * k;
      facades.rect(px - pw / 2, top + 30 * k, pw, 92 * k).fill(0x6b4423).stroke({ width: 2 * k, color: INK });
      const stripes = [0xe93d9c, 0xffc629, 0x00a896, 0xff7a1a];
      for (let i = 0; i < 8; i++) facades.rect(px - pw / 2 - 8 * k + i * ((pw + 16 * k) / 8), top, (pw + 16 * k) / 8, 30 * k).fill(stripes[i % 4] as number);
      facades.rect(px - pw / 2 - 8 * k, top, pw + 16 * k, 30 * k).stroke({ width: 2 * k, color: INK });
      for (let i = 0; i < 8; i++) {
        const sx = px - pw / 2 - 8 * k + i * ((pw + 16 * k) / 8);
        facades.poly([sx, top + 30 * k, sx + (pw + 16 * k) / 16, top + 42 * k, sx + (pw + 16 * k) / 8, top + 30 * k]).fill(stripes[i % 4] as number).stroke({ width: 1.5 * k, color: INK });
      }
    }
    if (!people.length) {
      // Las ocho personas del público y el foco: se arman una vez por juego.
      const skin = [0xf1c27d, 0xc68642, 0x8d5524, 0xe0ac69];
      const res = 2 * Math.min(window.devicePixelRatio || 1, 2);
      for (let i = 0; i < 8; i++) {
        const pg = new Graphics();
        const shirt = [0xe93d9c, 0xff7a1a, 0x00a896, 0x6c4ce0, 0xffc629, 0xffffff, 0xd52b1e, 0x1c64c8][i] as number;
        pg.roundRect(-4, -8, 8, 9, 2).fill(shirt).circle(0, -11, 3.4).fill(skin[i % skin.length] as number);
        people.push(S.app.renderer.generateTexture({ target: pg, resolution: res }));
        pg.destroy();
      }
      const dg = new Graphics().circle(0, 0, 4).fill(0xffffff);
      dot = S.app.renderer.generateTexture({ target: dg, resolution: res * 2 });
      dg.destroy();
      S.onCleanup(() => {
        people.forEach((tx) => tx.destroy(true));
        dot.destroy(true);
      });
    }
    // La calle, con la vereda de adelante.
    street.rect(x0, g.streetTop, x1 - x0, g.h).fill(S.dark ? 0x3a3346 : 0x6b6478);
    for (let x = x0; x < x1; x += 40 * k) street.rect(x, (g.streetTop + g.streetBot) / 2, 20 * k, 2 * k).fill({ color: 0xffffff, alpha: 0.15 });
    street.rect(x0, g.streetBot, x1 - x0, g.h).fill(S.dark ? 0x241f30 : 0x4a4458);
    // Los arcos de cada cuadra, con discos de plata y banderines, y su número.
    archX.forEach((ax0, j) => {
      const ax = ax0 + 30 * k;
      const ah = g.streetBot - g.streetTop + 150 * k;
      const top = g.streetBot - ah;
      arches.rect(ax - 6 * k, top, 12 * k, ah).fill(0xc9ccd6).stroke({ width: 2 * k, color: INK });
      arches.rect(ax - 70 * k, top - 14 * k, 140 * k, 28 * k).fill(0xd52b1e).stroke({ width: 2.4 * k, color: INK });
      for (let i = 0; i < 7; i++) arches.circle(ax - 60 * k + i * 20 * k, top + 22 * k, 6 * k).fill(0xe6e8ee).stroke({ width: 1.4 * k, color: INK });
      const lab = S.text(`${j + 1}`, { fontFamily: MONO, fontSize: 16 * k, fontWeight: "900", fill: 0xffffff });
      lab.anchor.set(0.5);
      lab.position.set(ax, top);
      S.scene.addChild(lab);
      archLabels.push(lab);
    });
    // El Santuario del Socavón, al final de la entrada.
    const cx = doorX(g), base = g.streetTop;
    church.rect(cx - 110 * k, base - 230 * k, 220 * k, 230 * k).fill(0xf4ecd8).stroke({ width: 3 * k, color: INK });
    church.rect(cx - 150 * k, base - 300 * k, 60 * k, 300 * k).fill(0xf4ecd8).stroke({ width: 3 * k, color: INK });
    church.poly([cx - 160 * k, base - 300 * k, cx - 120 * k, base - 360 * k, cx - 80 * k, base - 300 * k]).fill(0xd52b1e).stroke({ width: 3 * k, color: INK });
    church.rect(cx - 124 * k, base - 400 * k, 8 * k, 40 * k).fill(INK).rect(cx - 134 * k, base - 386 * k, 28 * k, 8 * k).fill(INK);
    church.circle(cx - 120 * k, base - 260 * k, 14 * k).fill(0xffc629).stroke({ width: 2 * k, color: INK });
    church.roundRect(cx - 34 * k, base - 120 * k, 68 * k, 120 * k, 34 * k).fill(0x5b3a29).stroke({ width: 3 * k, color: INK });
    church.poly([cx - 120 * k, base - 230 * k, cx, base - 290 * k, cx + 120 * k, base - 230 * k]).fill(0xf4ecd8).stroke({ width: 3 * k, color: INK });
    church.circle(cx, base - 180 * k, 22 * k).fill(0x9ec3e6).stroke({ width: 3 * k, color: INK });
    makeViews();
    buildHud(g);
  }

  /* ------------------------------------------------------------- la interfaz */
  let counter!: ReturnType<PixiStage["text"]>;
  let counterBox!: Graphics;
  let counterW = 0;
  let blockText!: ReturnType<PixiStage["text"]>;
  let blockPlate!: Graphics;
  let chips!: Container;
  let leaders!: Graphics;
  let moreBox!: Graphics;
  let moreText!: ReturnType<PixiStage["text"]>;
  let drum!: Container;
  let drumG!: Graphics;
  let drumText!: ReturnType<PixiStage["text"]>;
  /** Las fraternidades: una pastilla por cada una, con su color, su nombre y cuántos siguen. */
  interface Pill { g: number; c: Container; bg: Graphics; name: ReturnType<PixiStage["text"]>; count: ReturnType<PixiStage["text"]>; w: number; h: number; x: number; y: number; last: string }
  let pills: Pill[] = [];
  let pillsLayer!: Container;
  /** El cartel con los nombres de la fraternidad que pasa frente al palco. */
  let roster!: Container;
  let rosterFor = -1;
  let rosterRows: { tx: ReturnType<PixiStage["text"]>; av: Sprite }[] = [];
  let rosterBuilt = 0;
  let rosterBox = { x: 0, y: 0, w: 0, h: 0 };
  /** Los carteles de cada fraternidad sobre su bloque, en la pantalla. */
  const fratLabels = new Map<number, { c: Container; w: number; h: number }>();

  function buildHud(g: Geo): void {
    const k = g.k;
    counterBox = new Graphics();
    counter = S.text("", { fontFamily: MONO, fontSize: Math.max(10, 14 * k), fontWeight: "700", fill: S.dark ? CREAM : INK });
    counter.anchor.set(0.5);
    const box = new Container();
    box.addChild(counterBox, counter);
    box.position.set(22 * k, S.top() + 10 * k);
    chips = new Container();
    leaders = new Graphics();
    moreBox = new Graphics();
    moreText = S.text("", { fontFamily: MONO, fontSize: TAG_FONT_PX * k, fontWeight: "800", fill: S.dark ? CREAM : INK });
    moreText.anchor.set(0.5);
    moreBox.visible = moreText.visible = false;
    chips.addChild(leaders);
    blockText = S.text("", { fontFamily: MONO, fontSize: Math.max(10, 12 * k), fontWeight: "800", fill: CREAM });
    blockText.anchor.set(1, 1);
    blockText.position.set(g.w - 22 * k, g.h - S.bottom() - 18 * k);
    blockPlate = new Graphics();
    // El bombo de arriba a la derecha: late con la banda, para que la sala aplauda al ritmo.
    drum = new Container();
    drumG = new Graphics();
    drumText = S.text(t("cOruClapHud"), { fontFamily: MONO, fontSize: Math.max(11, 15 * k), fontWeight: "900", fill: INK });
    drumText.anchor.set(0.5);
    drum.addChild(drumG, drumText);
    pillsLayer = new Container();
    roster = new Container();
    rosterFor = -1;
    rosterRows = [];
    rosterBuilt = 0;
    fratLabels.clear();
    S.hud.addChild(box, pillsLayer, roster, chips, moreBox, moreText, blockPlate, blockText, drum);
    // Las pastillas de las fraternidades, con lo que cada una mide.
    pills = [];
    const fs = Math.max(10, 12 * k);
    for (const gi of P.order) {
      const f = P.frats[gi] as Frat;
      const c = new Container();
      const bg = new Graphics();
      const name = S.text(f.name, { fontSize: fs, fontWeight: "800", fill: S.dark ? CREAM : INK });
      const count = S.text(String(f.members.length), { fontFamily: MONO, fontSize: fs, fontWeight: "800", fill: S.dark ? CREAM : INK });
      name.anchor.set(0, 0.5);
      count.anchor.set(1, 0.5);
      c.addChild(bg, name, count);
      pillsLayer.addChild(c);
      const h = fs * 1.9;
      pills.push({ g: gi, c, bg, name, count, w: h + name.width + count.width + fs * 1.6, h, x: 0, y: 0, last: "" });
    }
    placePills(g);
  }

  /** Dónde van las pastillas: a la derecha del contador, y en tantas filas como hagan falta. */
  function placePills(g: Geo): void {
    const k = g.k;
    const right = g.w - 22 * k - drumWidth(g) - 10 * k;
    const startX = 22 * k + (counterW || 230 * k) + 12 * k;
    let x = S.portrait() ? 22 * k : startX;
    let y = S.portrait() ? S.top() + 10 * k + 50 * k : S.top() + 10 * k;
    for (const p of pills) {
      if (x + p.w > (S.portrait() ? g.w - 12 * k : right) && x > 22 * k + 1) {
        x = 22 * k;
        y += p.h + 5 * k;
        if (!S.portrait() && y < S.top() + 10 * k + 46 * k) x = Math.max(22 * k, startX);
      }
      p.x = x;
      p.y = y;
      x += p.w + 6 * k;
    }
  }
  const drumWidth = (g: Geo): number => 100 * g.k + drumText.width;
  /** Hasta dónde bajan las pastillas: lo que tapan arriba. */
  const pillsBottom = (): number => Math.max(...pills.map((p) => p.y + p.h), S.top() + 50 * G().k);

  /** El cartel de la presentación: dónde va, según la pantalla. */
  /**
   * El cartel de la presentación: con la letra de los chips (19 px en una
   * pantalla de 720), que se lee desde el fondo. Hasta diez nombres en una
   * columna; más, en dos. `top` es dónde empiezan los renglones.
   */
  function rosterGeo(g: Geo, m: number): { x: number; y: number; w: number; cols: number; fs: number; rh: number; top: number; head: number } {
    const k = g.k;
    const cols = m > 10 ? 2 : 1;
    const top0 = S.portrait() ? S.top() + 54 * k : Math.max(S.top() + 56 * k, pillsBottom() + 10 * k);
    const avail = g.h - S.bottom() - 10 * k - top0;
    const rows = Math.ceil(m / cols);
    // La letra más grande que entre: los renglones y la cabecera en el alto libre.
    const fs = clamp(Math.min(19 * k, avail / (rows * 1.4 + 4.5)), 11, 24);
    const rh = fs * 1.4;
    const top = fs * 4.0;
    const colW = Math.min((S.portrait() ? 176 : 232) * Math.max(0.85, k), (g.w - 40 * k) / cols);
    const w = cols * colW + 24 * k;
    const h = top + rows * rh + 12 * k;
    if (S.portrait()) return { x: Math.max(8 * k, (g.w - w) / 2), y: top0, w, cols, fs, rh, top, head: h };
    return { x: g.w - w - 22 * k, y: top0 + Math.max(0, (avail - h) / 2), w, cols, fs, rh, top, head: h };
  }

  /** Arma el cartel de una fraternidad de a pocos renglones por cuadro: armar veinte de una trababa la escena. */
  function prepareRoster(gi: number, budget: number): void {
    const g = G();
    const k = g.k;
    const f = P.frats[gi] as Frat;
    if (rosterFor !== gi) {
      roster.removeChildren().forEach((c) => c.destroy({ children: true }));
      rosterRows = [];
      rosterBuilt = 0;
      rosterFor = gi;
      const geo = rosterGeo(g, f.members.length);
      rosterBox = { x: geo.x, y: geo.y, w: geo.w, h: geo.head };
      const bg = new Graphics()
        .roundRect(6 * k, 6 * k, geo.w, geo.head, 10 * k).fill(INK)
        .roundRect(0, 0, geo.w, geo.head, 10 * k).fill(S.dark ? 0x221a33 : 0xffffff).stroke({ width: 3 * k, color: INK })
        .roundRect(0, 0, 14 * k, geo.head, 10 * k).fill(f.color).rect(7 * k, 0, 7 * k, geo.head).fill(f.color)
        .rect(14 * k, geo.top - geo.fs * 0.28, geo.w - 14 * k, 2 * k).fill({ color: f.color, alpha: 0.9 });
      // Tres renglones: "ENTRAN", el nombre de la fraternidad y su baile con cuántos son.
      const kicker = S.text(t("cOruEnter"), { fontFamily: MONO, fontSize: geo.fs * 0.62, fontWeight: "900", fill: S.dark ? CREAM : INK, letterSpacing: 2 * k });
      kicker.position.set(26 * k, geo.fs * 0.45);
      const L = T[getLang()];
      const title = S.text(L.cOruFratTitle(f.article, f.name).toUpperCase(), { fontSize: geo.fs * 1.2, fontWeight: "900", fill: S.dark ? CREAM : INK });
      title.position.set(26 * k, geo.fs * 1.15);
      const sub = S.text(L.cOruRosterSub(L.cOruDanza(f.dance), f.members.length), { fontSize: geo.fs * 0.74, fontWeight: "700", fill: S.dark ? CREAM : INK });
      sub.alpha = 0.85;
      sub.position.set(26 * k, geo.fs * 2.65);
      roster.addChild(bg, kicker, title, sub);
      roster.position.set(geo.x, geo.y);
      roster.visible = false;
    }
    const geo = rosterGeo(g, f.members.length);
    const per = Math.ceil(f.members.length / geo.cols);
    const colW = (geo.w - 24 * k) / geo.cols;
    while (rosterBuilt < f.members.length && budget-- > 0) {
      const i = rosterBuilt++;
      const idx = f.members[i] as number;
      const col = Math.floor(i / per), row = i % per;
      const x = 26 * k + col * colW, y = geo.top + row * geo.rh;
      const av = new Sprite(S.face(names[idx] ?? ""));
      av.width = av.height = geo.fs * 1.15;
      av.position.set(x - 4 * k, y + (geo.rh - geo.fs * 1.15) / 2);
      const tx = S.text(names[idx] ?? "", { fontSize: geo.fs, fontWeight: "800", fill: S.dark ? CREAM : INK });
      const maxW = colW - geo.fs * 1.5 - 12 * k;
      if (tx.width > maxW) tx.scale.set(Math.max(0.72, maxW / tx.width));
      tx.anchor.set(0, 0.5);
      tx.position.set(x + geo.fs * 1.3, y + geo.rh / 2);
      roster.addChild(av, tx);
      rosterRows.push({ tx, av });
    }
  }

  /* ------------------------------------------------------------- el guion */
  function script(): void {
    const L = T[getLang()];
    once("clap", tAll >= 0.05, () => say(t("cOruClap"), 0.1));
    // La presentación: cada fraternidad con su anuncio y un toque de la banda.
    P.pres.forEach((p, i) => {
      // El toque de la banda, con cada fraternidad que entra.
      once(`toque${i}`, tAll >= p.t0, () => {
        beep(note(7 + (i % 4)), 0.22, "sawtooth", 0.035);
        beep(note(10 + (i % 4)), 0.22, "sawtooth", 0.028);
      });
      // El anuncio, después de que la sala leyó el pedido de aplaudir: si su
      // turno termina antes, la nombra el cartel.
      const at = Math.max(p.t0 + 0.08, CLAP_HOLD);
      if (at < p.t1 - 0.35) {
        once(`pres${i}`, tAll >= at, () => {
          const f = P.frats[p.g] as Frat;
          say(L.cOruFrat(f.article, f.name, L.cOruDanza(f.dance)), 0.15 + 0.1 * (i / Math.max(1, P.pres.length)));
        });
      }
    });
    once("go", tAll >= P.T_GO + 0.1, () => say(L.cOruGo(n, P.frats.length), 0.3));
    // El paso: un golpe en cada tiempo de la banda, con acento en el uno. No
    // suena mientras la banda calla.
    const want = Math.floor(beatT / BEAT);
    while (beatsDone < want) {
      beatsDone++;
      if (phase === "crown") continue;
      if (beatsDone % 4 === 0) beep(note(0), 0.06, "square", 0.03);
      else beep(note(3), 0.05, "square", 0.02);
    }
    // Los arcos.
    while (exitsDone < P.arches.length && tAll >= (P.arches[exitsDone] as Arch).tExit) {
      const a = P.arches[exitsDone] as Arch;
      exitsDone++;
      applyExit(a);
      const up = Math.min(4, a.k - 1);
      const ex = a.exit;
      const f = P.frats[ex.g] as Frat;
      if (ex.kind === "frat") {
        // Los bronces de la banda, cada vez más agudos y más largos.
        beep(note(5 + 2 * up), 0.3 + 0.05 * up, "sawtooth", 0.035);
        beep(note(9 + 2 * up), 0.3 + 0.05 * up, "sawtooth", 0.028);
        if (a.k === P.arches.length) beep(note(12 + 2 * up), 0.35, "triangle", 0.03);
        say(L.cOruFratStay(a.k, f.article, f.name, ex.prizes), 0.4 + 0.3 * (a.k / Math.max(1, P.arches.length)));
      } else {
        // Los de la última fraternidad: una nota que cae por cada uno.
        ex.ids.slice(0, 5).forEach((_, i) => setTimeout(() => beep(note(14 - i), 0.12, "triangle", 0.035), i * 70));
        beep(note(4 + up), 0.25, "sawtooth", 0.03);
        // Un co-ganador no se nombra al salir: se dice que sale con premio.
        const nm = ex.ids.map((i) => names[i] ?? "");
        if (ex.prizes > 0) say(L.cOruMemPrize(a.k, ex.ids.length, ex.prizes), 0.6 + 0.2 * (a.k / P.arches.length));
        else if (ex.ids.length <= 3) say(L.cOruMemStay(a.k, nm), 0.6 + 0.2 * (a.k / P.arches.length));
        else say(L.cOruMemMany(a.k, ex.ids.length, f.article, f.name), 0.55 + 0.2 * (a.k / P.arches.length));
      }
      cam.punch(0.05).shake(5 * S.u());
    }
    // Cuando ya no quedan fraternidades enteras.
    if (P.arches.length > P.fratArches && P.fratArches > 0) once("only", tAll >= lastFratExit + CLOSE_UP + 0.45, () => say(L.cOruOnly(winFrat.article, winFrat.name), 0.6));
    // El amague de la remontada.
    if (fk) {
      once("fake", tAll >= fk.t0, () => {
        const f = P.frats[fk.g] as Frat;
        say(fk.ids.length > 1 ? L.cOruFake(f.article, f.name) : L.cOruFakeOne(names[fk.ids[0] as number] ?? ""), 0.65);
        beep(note(9), 0.14, "triangle", 0.045);
        setTimeout(() => beep(note(4), 0.16, "triangle", 0.04), 120);
      });
      once("fakeNo", tAll >= fk.t1 - 0.12, () => {
        say(L.cOruFakeNo(fk.ids.length > 1), 0.7);
        beep(note(7), 0.12, "triangle", 0.045);
        setTimeout(() => beep(note(12), 0.2, "triangle", 0.045), 90);
      });
    }
    // La banda que se calla.
    if (fz) {
      once("freeze", tAll >= fz.t0, () => {
        musicHold(true);
        say(t("cOruFreeze"), 0.7);
        beep(note(2), 0.08, "square", 0.04);
      });
      // A mitad del silencio, un latido: la sala congelada lo escucha.
      once("freezeMid", tAll >= (fz.t0 + fz.t1) / 2, () => beep(note(0), 0.18, "triangle", 0.04));
      once("freezeBack", tAll >= fz.t1, () => {
        musicHold(false);
        say(t("cOruFreezeBack"), 0.75);
        beep(note(12), 0.25, "triangle", 0.05);
        beep(note(0), 0.2, "square", 0.04);
      });
    }
    // El susto: casi se le cae lo que lleva en la cabeza.
    if (sc) {
      once("scare", tAll >= sc.t, () => {
        const d = byIdx.get(sc.who) as Dancer;
        say(L.cOruScare(names[sc.who] ?? "", prendaDe(d.f.dance, d.woman)), 0.85);
        beep(note(1), 0.1, "square", 0.05);
        setTimeout(() => beep(note(8), 0.12, "triangle", 0.045), 80);
        cam.shake(8 * S.u());
      });
    }
    // Camino al Socavón.
    const lastExit = P.arches.length ? (P.arches[P.arches.length - 1] as Arch).tExit : P.T_GO;
    once("socavonView", tAll >= lastExit + 1.0 && tAll < P.T_SOCAVON - 0.3 && tAll - lastSay > 0.6, () => say(t("cOruLast"), 0.75));
    // El contrapunto.
    if (riv) {
      once("duel", tAll >= P.T_SOCAVON, () => {
        for (const d of [win, riv]) {
          d.chip?.destroy({ children: true });
          d.chip = undefined;
          d.strike = undefined;
          d.prize = undefined;
        }
        say(L.cOruDuel(...enOrden(names[winnerIdx] ?? "", names[rivalIdx] ?? "")), 0.8);
      });
      P.jumps.forEach((j, i) => {
        once(`jump${i}`, tAll >= j.t, () => {
          beep(note(Math.min(20, (i % 2 === 0 ? 7 : 9) + Math.min(i, 9))), 0.14, "triangle", 0.05);
          beep(note(0), 0.06, "square", 0.035);
        });
        if (j.stumble === "small" || j.stumble === "big") {
          once(`trip${i}`, tAll >= j.t + jumpLen(i) * 0.55, () => {
            beep(note(2), 0.16, "triangle", 0.045);
            setTimeout(() => beep(note(1), 0.12, "triangle", 0.04), 90);
            if (j.stumble === "big" && !(sc && sc.who === j.who && Math.abs(sc.t - j.t) < 0.01)) say(L.cOruTrip(names[j.who] ?? ""), 0.85);
            if (j.stumble === "big") cam.shake(7 * S.u());
          });
        }
        if (j.stumble === "fall") {
          once("fall", tAll >= j.t + jumpLen(i) * 0.55, () => {
            const d = byIdx.get(j.who) as Dancer;
            // Si el que se cae tiene premio, no se lo nombra.
            const nombre = winners.includes(j.who) ? "" : names[j.who] ?? "";
            say(L.cOruFall(nombre, prendaDe(d.f.dance, d.woman)), 0.9);
            [9, 6, 2].forEach((dg, k) => setTimeout(() => beep(note(dg), 0.14, "triangle", 0.045), k * 110));
            setTimeout(() => beep(note(0), 0.25, "triangle", 0.06), 330);
            cam.shake(9 * S.u());
          });
        }
      });
      once("arrive", tAll >= P.T_ARRIVE, () => {
        say(t("cOruArrive"), 0.95);
        // La campana de la llegada, con cuerpo: una sola nota sonaba a timbre.
        beep(note(12), 0.9, "triangle", 0.06);
        beep(note(17), 0.9, "triangle", 0.04);
        beep(note(19), 0.9, "triangle", 0.03);
      });
    } else {
      once("arrive", tAll >= P.T_ARRIVE, () => say(t("cOruArrive"), 0.95));
    }
  }
  /** Cuándo cae sentado el que pierde el contrapunto (-1 sin contrapunto). */
  const fellAt = ((): number => {
    const i = P.jumps.findIndex((j) => j.stumble === "fall");
    if (i < 0) return -1;
    const a = P.jumps[i] as { t: number }, b = P.jumps[i + 1];
    return a.t + ((b ? b.t : a.t + 0.8) - a.t) * 0.55;
  })();
  /** Cuánto dura el salto `i` del contrapunto: hasta el siguiente. */
  const jumpLen = (i: number): number => {
    const a = P.jumps[i], b = P.jumps[i + 1];
    return a && b ? b.t - a.t : 0.8;
  };

  function crown(): void {
    if (crowned) return;
    crowned = true;
    S.say(T[getLang()].cWin(winnersLabel(names, winners), winners.length > 1), 1);
    fanfare();
    // Las campanas del Socavón, después de la fanfarria: adentro quedaban
    // tapadas por notas que suenan al doble.
    [520, 700, 880, 1060].forEach((ms, i) => setTimeout(() => beep(note(i % 2 ? 12 : 14), 0.4, "triangle", 0.05), ms));
    cam.punch(0.08).shake(10 * S.u());
  }
  skipFn = (): void => {
    if (phase === "crown" || phase === "dead") return;
    const g = G();
    while (exitsDone < P.arches.length) applyExit(P.arches[exitsDone++] as Arch);
    for (const d of dancers) {
      if (!d.alive) {
        d.x = d.wx;
        d.y = d.wy;
      }
    }
    if (riv) {
      const p = duelPos(riv, g);
      riv.x = p.x;
      riv.y = p.y;
    }
    win.x = arriveAt(g).x;
    win.y = arriveAt(g).y;
    // Lo que ya tenía que sonar no suena todo junto encima de la fanfarria.
    for (const key of ["clap", "go", "only", "fake", "fakeNo", "freeze", "freezeMid", "scare", "socavonView", "duel", "fall", "arrive"]) said.add(key);
    P.pres.forEach((_, i) => {
      said.add(`pres${i}`);
      said.add(`toque${i}`);
    });
    P.jumps.forEach((_, i) => {
      said.add(`jump${i}`);
      said.add(`trip${i}`);
    });
    if (fz && tAll >= fz.t0 && tAll < fz.t1) musicHold(false);
    said.add("freezeBack");
    tAll = P.T_CROWN;
    beatsDone = Math.floor(beatT / BEAT);
    phase = "crown";
    crown();
  };

  build();
  const crownUI = S.crown(names, winners);
  S.onResize(build);

  /* ------------------------------------------------------------- la cámara */
  const box = { x0: 0, x1: 0, y0: 0, y1: 0 };
  const boxReset = (): void => {
    box.x0 = box.y0 = Infinity;
    box.x1 = box.y1 = -Infinity;
  };
  const boxAdd = (x: number, y: number): void => {
    box.x0 = Math.min(box.x0, x);
    box.x1 = Math.max(box.x1, x);
    box.y0 = Math.min(box.y0, y);
    box.y1 = Math.max(box.y1, y);
  };
  interface Shot { x: number; y: number; z: number }
  /**
   * La toma que llena el lugar libre con la caja de los cuerpos: `jump` es
   * cuánto pueden saltar (en unidades del dibujo), `mul` acerca o abre sobre lo
   * que entra, `free` es el rectángulo libre de la pantalla (sin la barra de
   * arriba, el relator ni el cartel de la presentación) y `extra` suma a la
   * caja un rectángulo del mundo (el Socavón).
   */
  function boxShot(zLo: number, zHi: number, jump = 0, mul = 1, free?: Rect, extra?: { x0: number; x1: number; y0: number }): Shot | null {
    if (!(box.x1 >= box.x0)) return null;
    const g = G();
    const s = g.scale;
    let x0 = box.x0 - BODY_HALF_W * s, x1 = box.x1 + BODY_HALF_W * s;
    let y0 = box.y0 - (130 + jump) * s;
    const y1 = box.y1 + 6 * s;
    if (extra) {
      x0 = Math.min(x0, extra.x0);
      x1 = Math.max(x1, extra.x1);
      y0 = Math.min(y0, extra.y0);
    }
    const fr = free ?? freeRect(g);
    const z = clamp(Math.min(fr.w / (x1 - x0), fr.h / (y1 - y0)), zLo, zHi) * mul;
    // El centro de la caja va al centro del lugar libre, no al de la pantalla.
    return { x: (x0 + x1) / 2 - (fr.x + fr.w / 2 - g.w / 2) / z, y: (y0 + y1) / 2 - (fr.y + fr.h / 2 - g.h / 2) / z, z };
  }
  /** Lo libre de la pantalla: entre la barra de arriba (y las pastillas) y el relator, con margen a los costados. */
  function freeRect(g: Geo): Rect {
    // Las pastillas tapan arriba cuando se ven (en el celular, desde que arranca el recorrido).
    const conPastillas = pills.length > 1 && phase !== "crown" && (!S.portrait() || phase !== "pres");
    const top = Math.max(S.top() + TAG_ROOM * g.k, conPastillas ? pillsBottom() + 8 * g.k : S.top() + TAG_ROOM * g.k);
    const bot = g.h - S.bottom() - 10 * g.k;
    const side = 18 * g.k;
    return { x: side, y: top, w: g.w - 2 * side, h: bot - top };
  }
  /**
   * Cuánto más se puede acercar la cámara cuando los bailarines se dibujan
   * chicos: con doscientos miden un tercio, y el contrapunto, con los topes de
   * una comparsa de dieciocho, quedaba de muñequitos en el medio de la calle.
   */
  const zBoost = (g: Geo): number => clamp((1.25 * g.k) / g.scale, 1, 2.6);
  const zRange = (g: Geo): [number, number] => (S.portrait() ? [0.55, 1.8 * zBoost(g)] : [0.6, 2.2 * zBoost(g)]);
  /** El acercamiento de la comparsa, suavizado: cuando se queda una fraternidad, la cámara se arrima sin saltar. */
  let zCol = NaN;
  /** La caja de la comparsa entera, en sus lugares: adonde van los cuerpos. Si no entra, la cabeza y lo que entre. */
  function boxColumn(g: Geo, hx: number, zLo: number): void {
    const off = frontOffsets(g);
    boxReset();
    for (const d of dancers) {
      if (!d.alive) continue;
      if (tAll >= P.T_SOCAVON && (d === win || d === riv)) continue;
      const p = slotPos(d, hx, g, off);
      boxAdd(p.x, p.y);
    }
    // La banda va adelante, pero cuando queda una sola fraternidad la toma es de
    // ella: con tres bailarines, la banda ocupaba media pantalla.
    if (tAll < lastFratExit || P.fratArches === 0 && aliveOf(winFrat).length > 6) {
      for (const m of band) {
        const p = bandPos(m, hx, g);
        boxAdd(p.x, p.y);
      }
    }
    // Los de la última fraternidad que se quedaron hace poco siguen en cuadro
    // mientras la cámara vuelve del primer plano: se quedan al lado. Una
    // fraternidad entera, en cambio, queda atrás mientras la comparsa avanza, y
    // meterla en la caja abría la toma hasta dejar a los que siguen en el borde.
    for (const d of dancers) if (!d.alive && d.f === winFrat && tAll - d.left < 1.6 && tAll - d.left > 0) boxAdd(d.wx, d.wy);
    const fr = freeRect(g);
    const maxW = fr.w / zLo - 2 * BODY_HALF_W * g.scale;
    if (box.x1 - box.x0 > maxW) box.x0 = box.x1 - maxW;
  }

  /** La toma de la presentación: el palco, con la fraternidad que pasa en el lugar libre. */
  function presShot(g: Geo): Shot {
    const gi = P.pres.find((p) => tAll < p.t1)?.g ?? (P.pres[P.pres.length - 1] as { g: number }).g;
    const f = P.frats[gi] as Frat;
    const w = widthOf(colsOf(f.members.length, g), g);
    boxReset();
    boxAdd(-w / 2, rowY(0, g.depth, g));
    boxAdd(w / 2, rowY(g.depth - 1, g.depth, g));
    const fr = freeRect(g);
    const geo = rosterGeo(g, f.members.length);
    // Sin el cartel: a su izquierda en la pantalla grande, debajo en el celular.
    const free: Rect = S.portrait()
      ? { x: fr.x, y: Math.max(fr.y, geo.y + geo.head + 8 * g.k), w: fr.w, h: fr.y + fr.h - Math.max(fr.y, geo.y + geo.head + 8 * g.k) }
      : { x: fr.x, y: fr.y, w: Math.max(fr.w * 0.4, geo.x - 18 * g.k - fr.x), h: fr.h };
    return boxShot(0.8, S.portrait() ? 2.0 : 2.6, 0, 1, free) as Shot;
  }

  {
    const g = G();
    for (const d of dancers) {
      const p = slotPos(d, headX(0), g, frontOffsets(g));
      d.x = p.x;
      d.y = p.y;
    }
    for (const m of band) {
      const p = bandPos(m, headX(0), g);
      m.x = p.x;
      m.y = p.y;
    }
    const s = presShot(g);
    cam.cut(s.x, s.y, s.z);
  }

  /** La cámara: el palco en la presentación, la comparsa en el recorrido, los que se quedan de cerca, el Socavón y el contrapunto. */
  function direct(dt: number): void {
    const g = G();
    const [zLo, zHi] = zRange(g);
    const zb = zBoost(g);
    if (phase === "pres") {
      const s = presShot(g);
      cam.lookAt(s.x, s.y, s.z, 2.6);
      return;
    }
    if (phase === "walk") {
      const hx = headX(tAll);
      boxColumn(g, hx, zLo);
      const want = boxShot(zLo, zHi) as Shot;
      zCol = Number.isFinite(zCol) ? zCol + (want.z - zCol) * Math.min(1, dt * 2) : want.z;
      // Primer plano de los que se quedan, donde se quedan.
      const a = exitsDone > 0 ? (P.arches[exitsDone - 1] as Arch) : null;
      if (a && tAll - a.tExit < CLOSE_UP && tAll >= a.tExit) {
        boxReset();
        for (const i of a.exit.ids) {
          const d = byIdx.get(i) as Dancer;
          boxAdd(d.wx, d.wy);
        }
        // En la última fraternidad, también los que siguen: se ve quién se queda y quién sigue.
        if (a.exit.kind === "members") {
          const off = frontOffsets(g);
          for (const d of aliveOf(winFrat)) {
            const p = slotPos(d, hx, g, off);
            boxAdd(p.x, p.y);
          }
        }
        const f = boxShot(zLo, Math.min(2.4 * zb, Math.max(S.portrait() ? 1.6 : 2.0, zCol * 1.6)));
        if (f) {
          cam.lookAt(f.x, f.y, f.z, 4);
          return;
        }
      }
      if (fk && tAll >= fk.t0 - 0.1 && tAll < fk.t1 + 0.2) {
        boxReset();
        for (const i of fk.ids) {
          const d = byIdx.get(i) as Dancer;
          boxAdd(d.x, d.y);
        }
        const f = boxShot(zLo, Math.min(2.2 * zb, Math.max(1.3, zCol * 1.1)));
        if (f) {
          cam.lookAt(f.x, f.y, f.z, 3);
          return;
        }
      }
      if (sc && tAll >= sc.t - 0.15 && tAll < sc.t + 1.05) {
        const d = byIdx.get(sc.who) as Dancer;
        boxReset();
        boxAdd(d.x, d.y);
        const f = boxShot(Math.max(zLo, zCol * 1.2), 2.0 * zb, 20) as Shot;
        cam.lookAt(f.x, f.y, f.z, FOLLOW);
        return;
      }
      // La banda calla: la cámara también se queda quieta.
      if (fz && tAll >= fz.t0 && tAll < fz.t1) return;
      // Llegando al Socavón se abre un poco para que se vea venir.
      const near = clamp((tAll - (P.T_SOCAVON - 1.2)) / 1.2, 0, 1);
      const z = zCol * (1 - 0.3 * ease.inOutCubic(near));
      const f = boxShot(z, z) as Shot;
      // Al volver de un primer plano, más rápido: en una pantalla apaisada baja la
      // fila de adelante quedaba un instante debajo del relator (revisión de
      // juegos, vistas-4).
      const vuelve = a !== null && tAll - (a.tExit + CLOSE_UP) < 0.5;
      cam.lookAt(f.x + near * near * 110 * g.k, f.y, z, vuelve ? FOLLOW * 1.8 : FOLLOW);
      return;
    }
    if (phase === "duel") {
      const td = tAll - P.T_SOCAVON;
      boxReset();
      for (const d of [win, riv]) {
        if (!d) continue;
        const p = duelPos(d, g);
        boxAdd(p.x, p.y);
      }
      const cx = doorX(g);
      if (td < 0.9) {
        // Primero el Socavón entero con los dos delante.
        const f = boxShot(0.5, 1.2, 0, 1, undefined, { x0: cx - 165 * g.k, x1: cx + 125 * g.k, y0: g.streetTop - 405 * g.k }) as Shot;
        cam.lookAt(f.x, f.y, f.z, 3);
      } else if (tAll < P.T_ARRIVE) {
        const span = Math.max(0.5, P.T_ARRIVE - P.T_SOCAVON);
        const f = boxShot((S.portrait() ? 1.1 : 1.3) * zb, (S.portrait() ? 1.7 : 2.2) * zb, 70, 0.84 + 0.16 * clamp(td / span, 0, 1)) as Shot;
        cam.lookAt(f.x, f.y, f.z, 2.5);
      } else {
        // Llegó: la puerta del Socavón con el que llega, y el otro sentado en el piso.
        boxReset();
        boxAdd(win.x, win.y);
        boxAdd(arriveAt(g).x, arriveAt(g).y);
        if (riv) boxAdd(riv.x, riv.y + 26 * g.scale);
        const f = boxShot(0.8, (S.portrait() ? 1.5 : 1.8) * zb, 30) as Shot;
        cam.lookAt(f.x, f.y, f.z, 2.5);
      }
      return;
    }
    cam.lookAt(...crownShot(g), 1.5);
  }

  /**
   * La toma del final: el que llegó, entero y debajo del cartel de la corona.
   * Con varios premios el cartel es más alto, y en un celular acostado le
   * tapaba la punta de los cuernos (revisión de juegos, vistas-8): la cámara
   * baja y se abre lo justo para que entre entre el cartel y el relator.
   */
  function crownShot(g: Geo): [number, number, number] {
    const top = S.placaBajo(winners.length) + 8 * g.k;
    const bot = g.h - S.bottom() - 8 * g.k;
    // Con el salto del festejo: en lo más alto del salto, los cuernos tampoco tocan el cartel.
    const tall = (DANCE_TOP[win.f.dance] + 26 + 24) * g.scale;
    const zMax = 1.3 * zBoost(g);
    const z = clamp(Math.min(zMax, (bot - top) / Math.max(1, tall)), 0.4, zMax);
    // Los pies en el borde de abajo del lugar libre, la cabeza debajo del cartel.
    const feet = win.y;
    const camY = feet - ((top + bot) / 2 + (tall * z) / 2 - 4 * g.k - g.h / 2) / z;
    return [win.x + 40 * g.k, camY, z];
  }

  /* -------------------------------------------------------------- nombres */
  const pool: TagCandidate[] = dancers.map((d) => ({ id: d.idx, sx: 0, sy: 0, depth: 0, visible: false, out: false }));
  const poolOf = new Map(dancers.map((d, i) => [d.idx, pool[i] as TagCandidate]));
  const inView: TagCandidate[] = [];
  const shownNow = new Set<number>();
  const shownNext = new Set<number>();
  /** El cartel de un bailarín de la última fraternidad: se arma una vez y se reusa. */
  function tagOf(d: Dancer, kc: number, scale: number): Container {
    if (d.chip) return d.chip;
    const c = S.chip(tagName(names[d.idx] ?? "", TAG_CHARS), scale, names[d.idx] ?? "");
    const w = c.width;
    d.tagW = w;
    // La barra del color de su fraternidad, debajo del nombre.
    c.addChild(new Graphics().rect(4 * kc, 17.5 * kc, w - 8 * kc, 4 * kc).fill(d.f.color));
    const x = new Graphics().moveTo(4 * kc, 11.5 * kc).lineTo(w - 6 * kc, 11.5 * kc).stroke({ width: 2.4 * kc, color: 0xd52b1e, cap: "round" });
    x.visible = false;
    c.addChild(x);
    d.strike = x;
    // Un co-ganador que se queda no va tachado: lleva un borde amarillo.
    if (winners.includes(d.idx)) {
      const prize = new Graphics().roundRect(-1.5 * kc, -1.5 * kc, w + 3 * kc, 25 * kc, 6 * kc).stroke({ width: 3 * kc, color: YELLOW });
      prize.visible = false;
      c.addChild(prize);
      d.prize = prize;
    }
    d.chip = c;
    chips.addChild(c);
    return c;
  }
  /** El cartel de una fraternidad sobre su bloque: su nombre y su color. */
  function fratLabel(gi: number, k: number): { c: Container; w: number; h: number } {
    let l = fratLabels.get(gi);
    if (l) return l;
    const f = P.frats[gi] as Frat;
    const fs = Math.max(10, 13 * k);
    const c = new Container();
    const tx = S.text(f.name, { fontSize: fs, fontWeight: "900", fill: INK });
    tx.position.set(fs * 1.3, fs * 0.35);
    const w = tx.width + fs * 1.9, h = fs * 1.9;
    c.addChild(
      new Graphics().roundRect(3 * k, 3 * k, w, h, 5 * k).fill(INK).roundRect(0, 0, w, h, 5 * k).fill(0xffffff).stroke({ width: 2 * k, color: INK }).roundRect(fs * 0.35, fs * 0.45, fs * 0.7, h - fs * 0.9, 2 * k).fill(f.color),
      tx,
    );
    l = { c, w: w + 3 * k, h: h + 3 * k };
    fratLabels.set(gi, l);
    chips.addChild(c);
    return l;
  }

  /**
   * Los nombres en la pantalla. Durante el recorrido, cada fraternidad lleva su
   * cartel sobre su bloque; cuando queda una sola, los nombres de los que
   * siguen (los más cercanos a la cámara y los que recién se quedan); en el
   * contrapunto, los dos enteros.
   */
  function drawTags(g: Geo, cw: number, ch: number): void {
    const k = g.k;
    for (const d of dancers) if (d.chip) d.chip.visible = false;
    for (const l of fratLabels.values()) l.c.visible = false;
    leaders.clear();
    moreBox.visible = moreText.visible = false;
    if (phase === "pres" || phase === "crown" || phase === "dead") return;
    const top = S.top(), bottom = S.bottom();
    const blocked: Rect[] = [
      { x: 22 * k, y: S.top() + 10 * k, w: cw + 5 * k, h: ch + 5 * k },
      ...pills.map((p) => ({ x: p.x, y: p.y, w: p.w, h: p.h })),
    ];
    const bounds = { w: g.w, h: g.h, top, bottom };
    // Mientras haya fraternidades enteras, sus carteles.
    const onlyOne = tAll >= lastFratExit || P.fratArches === 0;
    if (!onlyOne && phase === "walk") {
      const off = frontOffsets(g);
      const hx = headX(tAll);
      const items: LabelItem[] = [];
      for (const gi of P.order) {
        if (!inColumn.has(gi)) continue;
        const l = fratLabel(gi, k);
        const fx0 = (off.front.get(gi) ?? 0) + hx;
        const p = cam.toScreen(fx0 - g.dx * 0.5, g.streetTop + (g.streetBot - g.streetTop) * 0.1 - 120 * g.scale, g.w, g.h);
        items.push({ id: gi, x: p.x - l.w / 2, y: p.y - l.h, w: l.w, h: l.h, priority: 1 });
      }
      for (const pl of layoutLabels(items, bounds, [], blocked)) {
        const l = fratLabels.get(pl.id);
        if (!l) continue;
        l.c.visible = true;
        l.c.position.set(pl.x, pl.y);
      }
      return;
    }
    // La última fraternidad y el contrapunto: los nombres de cada uno.
    const scale = clamp(TAG_FONT_PX / (12 * k * CHIP_SCALE), g.w <= 520 ? 0 : 1, 1.8);
    const kk = k * scale;
    const kc = kk * CHIP_SCALE;
    const sz = estimateTagSize(kc, 16);
    const cap = tagBudget(g.w, g.h, top, bottom, sz.w, sz.h);
    const duel = phase === "duel";
    inView.length = 0;
    for (const d of dancers) {
      const c = poolOf.get(d.idx) as TagCandidate;
      c.visible = false;
      if (d.f !== winFrat) continue;
      if (duel && d !== win && d !== riv) continue;
      const age = d.alive ? -1 : tAll - d.left;
      if (!outTreatment(age).visible) continue;
      const lift = duel ? Math.max(0, jumpHeight(d)) : 0;
      // El que se cayó lleva su nombre cerca del piso, no flotando donde tenía la cabeza.
      const tall = d === riv && fellAt >= 0 && tAll >= fellAt ? 50 : DANCE_TOP[d.f.dance] - 26;
      const p = cam.toScreen(d.x, d.y - (tall + lift) * g.scale, g.w, g.h);
      c.sx = p.x;
      c.sy = p.y;
      c.depth = d.y;
      c.out = !d.alive && age < OUT_HOLD;
      c.visible = p.x > 0 && p.x < g.w && p.y > top && p.y < g.h - bottom;
      if (c.visible) inView.push(c);
    }
    const { shown } = selectTags(inView, cap, shownNow);
    const th = 22 * kc;
    const items: LabelItem[] = [];
    for (const id of shown) {
      const d = byIdx.get(id) as Dancer;
      const c = poolOf.get(id) as TagCandidate;
      tagOf(d, kc, scale);
      const s = outTreatment(d.alive ? -1 : tAll - d.left).scale;
      const w = (d.tagW ?? sz.w) * s + 3 * kc, hh = th * s + 3 * kc;
      items.push({ id, x: c.sx - w / 2, y: c.sy - hh - 10 * kk, w, h: hh, priority: (c.out ? 1000 : 0) + c.depth });
    }
    const placed = layoutLabels(items, bounds, blocked);
    shownNext.clear();
    let aliveTagged = 0;
    for (const pl of placed) {
      const d = byIdx.get(pl.id) as Dancer;
      const c = poolOf.get(pl.id) as TagCandidate;
      const chip = d.chip as Container;
      const look = outTreatment(d.alive ? -1 : tAll - d.left);
      chip.visible = true;
      chip.scale.set(look.scale);
      chip.alpha = look.alpha;
      chip.position.set(pl.x, pl.y + (th * look.scale + 3 * kc) / 2);
      const premiado = winners.includes(d.idx);
      (d.strike as Graphics).visible = look.struck && !premiado;
      if (d.prize) d.prize.visible = look.struck && premiado && !d.alive && tAll - d.left < OUT_HOLD;
      shownNext.add(pl.id);
      if (d.alive) aliveTagged++;
      const w = (d.tagW ?? sz.w) * look.scale, cx = pl.x + w / 2, by = pl.y + (th * look.scale + 3 * kc) / 2 + 11 * kc * look.scale;
      leaders.moveTo(cx, by).lineTo(c.sx, c.sy).stroke({ width: 5 * kk * 0.5, color: INK, alpha: look.alpha })
        .moveTo(cx, by).lineTo(c.sx, c.sy).stroke({ width: 2.4 * kk * 0.5, color: d.f.color, alpha: look.alpha })
        .circle(c.sx, c.sy, 3.2 * kk * 0.6).fill({ color: d.f.color, alpha: look.alpha }).stroke({ width: 1.4, color: INK, alpha: look.alpha });
    }
    shownNow.clear();
    for (const id of shownNext) shownNow.add(id);
    const live = aliveOf(winFrat).filter((d) => !duel || d === win || d === riv).length;
    const more = live - aliveTagged;
    if (more > 0) {
      const label = `+${more}`;
      if (moreText.text !== label) moreText.text = label;
      const moreH = 26 * k, moreY = S.top() + 10 * k + ch + 10 * k;
      const w = moreText.width + 18 * k;
      moreBox.clear().roundRect(22 * k + 2.5 * k, moreY + 2.5 * k, w, moreH, 5 * k).fill(INK)
        .roundRect(22 * k, moreY, w, moreH, 5 * k).fill(S.dark ? 0x221a33 : 0xffffff).stroke({ width: 2 * k, color: INK });
      moreText.position.set(22 * k + w / 2, moreY + moreH / 2);
      moreBox.visible = moreText.visible = true;
    }
  }

  /* -------------------------------------------------- saltos del contrapunto */
  /** El salto que va en el instante, y por dónde va (0 a 1). */
  function jumpAt(tt: number): { i: number; f: number } {
    for (let i = P.jumps.length - 1; i >= 0; i--) {
      const j = P.jumps[i] as { t: number };
      if (tt >= j.t) return { i, f: (tt - j.t) / jumpLen(i) };
    }
    return { i: -1, f: 0 };
  }
  /** Cuánto salta ahora (unidades del dibujo); -1 si no le toca. */
  function jumpHeight(d: Dancer): number {
    if (tAll < P.T_SOCAVON) return -1;
    const { i, f } = jumpAt(tAll);
    if (i < 0 || f >= 1) return -1;
    const j = P.jumps[i] as { who: number; final: boolean };
    if (j.who !== d.idx) return -1;
    const top = j.final ? 70 : Math.min(60, 30 + 5 * i);
    return Math.sin(Math.PI * Math.min(1, f / 0.55)) * top * (f < 0.55 ? 1 : 0);
  }
  /** La pose de cada uno del contrapunto: salta, trastabilla, se cae o espera bailando. */
  function duelPose(d: Dancer): { mode: PoseMode; f: number } {
    let res: { mode: PoseMode; f: number } = { mode: "dance", f: 0 };
    P.jumps.forEach((j, i) => {
      if (j.who !== d.idx || tAll < j.t) return;
      const len = jumpLen(i);
      const u = (tAll - j.t) / len;
      if (u < 0.55) res = { mode: "jump", f: Math.sin(Math.PI * (u / 0.55)) * (j.final ? 70 : Math.min(60, 30 + 5 * i)) };
      else if (j.stumble === "fall") res = { mode: "fall", f: (tAll - j.t - 0.55 * len) / 0.8 };
      else if ((j.stumble === "small" || j.stumble === "big") && tAll - j.t - 0.55 * len < (j.stumble === "big" ? 0.75 : 0.45)) {
        res = { mode: "stumble", f: (tAll - j.t - 0.55 * len) / (j.stumble === "big" ? 0.75 : 0.45) };
      } else if (res.mode !== "fall") res = { mode: "dance", f: 0 };
    });
    return res;
  }

  /* ---------------------------------------------------------------- dibujo */
  /**
   * El público que salta en las graderías y las guirnaldas de focos, solo donde
   * mira la cámara: cada uno sale de su número de lugar (`hash`), así que la
   * misma hora dibuja lo mismo, con la cámara donde esté.
   */
  function drawCrowd(g: Geo, now: number, frozen: boolean): void {
    const k = g.k;
    const half = (g.w / 2) / Math.max(0.05, cam.zoom) * 1.15 + 30 * k;
    const view0 = cam.x - half, view1 = cam.x + half;
    const step = 13 * k;
    let used = 0;
    for (let tier = 0; tier < 2; tier++) {
      const y = g.streetTop - 58 * k + (tier + 1) * 14 * k;
      const sc = k * (1.2 + tier * 0.12);
      for (let i = Math.floor(view0 / step); i <= Math.ceil(view1 / step); i++) {
        let sp = crowdPool[used];
        if (!sp) {
          sp = new Sprite();
          sp.anchor.set(0.5, 1);
          crowdLayer.addChild(sp);
          crowdPool.push(sp);
        }
        used++;
        sp.visible = true;
        sp.texture = people[Math.floor(hash(i, tier + 30) * 8)] as Texture;
        sp.scale.set(sc);
        const bob = frozen ? 0 : Math.abs(Math.sin(now * 5 + hash(i, tier + 40) * 6)) * 3 * k;
        sp.position.set(i * step + (hash(i, tier + 20) - 0.5) * 5 * k, y - bob);
      }
    }
    for (let j = used; j < crowdPool.length; j++) (crowdPool[j] as Sprite).visible = false;
    // Las guirnaldas de focos entre las fachadas.
    const ls = 26 * k;
    let lu = 0;
    for (let i = Math.floor(view0 / ls); i <= Math.ceil(view1 / ls); i++) {
      let sp = lightPool[lu];
      if (!sp) {
        sp = new Sprite(dot);
        sp.anchor.set(0.5);
        lights.addChild(sp);
        lightPool.push(sp);
      }
      lu++;
      const x = i * ls;
      sp.visible = true;
      sp.position.set(x, g.streetTop - 190 * k + Math.sin((x / (160 * k)) * Math.PI) * 18 * k);
      sp.scale.set(k);
      sp.tint = [0xffc629, 0xe93d9c, 0x00a896, 0xff7a1a][((i % 4) + 4) % 4] as number;
      sp.alpha = 0.55 + 0.45 * Math.sin(now * 3 + i);
    }
    for (let j = lu; j < lightPool.length; j++) (lightPool[j] as Sprite).visible = false;
  }

  function draw(now: number): void {
    const g = G();
    const k = g.k;
    const frozen = !!fz && tAll >= fz.t0 && tAll < fz.t1;
    drawCrowd(g, now, frozen);
    // Los bailarines. Lo que mide uno en la pantalla, para saber si se ve.
    const zNow = cam.zoom;
    const halfW = (BODY_HALF_W + 50) * g.scale * zNow + 8;
    const tallW = 150 * g.scale * zNow + 8;
    const bph = (beatT / BEAT) * Math.PI;
    const pt = frozen && fz ? fz.t0 : tAll;
    const sw = g.w, sh = g.h;
    for (const d of dancers) {
      const p = d.parts;
      if (!p) continue;
      const s = cam.toScreen(d.x, d.y, sw, sh);
      // Fuera de cuadro no se dibuja: con doscientos y la vereda llena, ahorra.
      const vis = s.x > -halfW && s.x < sw + halfW && s.y > -halfW * 0.5 && s.y < sh + tallW;
      p.root.visible = vis;
      if (!vis) continue;
      let mode: PoseMode = d.alive ? "dance" : tAll - d.left < 0.5 ? "dance" : "salute";
      let f = 0;
      let e = d.alive ? 1 : 0.6;
      let dir = 1;
      if (tAll >= P.T_SOCAVON && (d === win || d === riv)) {
        const dp = duelPose(d);
        mode = dp.mode;
        f = dp.f;
        dir = d === win ? -P.side : P.side;
        if (d === win && tAll >= P.T_ARRIVE) {
          mode = "dance";
          e = 1;
        }
      }
      if (sc && d.idx === sc.who && tAll >= sc.t && tAll < sc.t + 0.9) {
        mode = "stumble";
        f = (tAll - sc.t) / 0.9;
      }
      if (phase === "crown" && d === win) {
        mode = "jump";
        f = Math.abs(Math.sin(now * 6)) * 24;
      }
      // Una vuelta suave del cuerpo con la música; en el contrapunto se miran.
      let sx = 0.9 + 0.1 * Math.cos(bph * 0.5 + d.seed);
      // El que se cayó sigue mirando al otro: si se diera vuelta, se lo vería girar en el piso.
      if (tAll >= P.T_SOCAVON && ((d === win && tAll < P.T_ARRIVE) || d === riv)) sx = d === win ? -P.side : P.side;
      pose(p, { mode, b: bph + d.seed * 0.2, e: frozen ? 1 : e, t: pt, f, dir }, d.x, d.y, g.scale * sx, g.scale);
      p.root.zIndex = d.y;
      p.root.alpha = d.alive || d === riv ? 1 : 0.9;
    }
    for (const m of band) {
      const p = m.parts;
      if (!p) continue;
      const s = cam.toScreen(m.x, m.y, sw, sh);
      const vis = s.x > -halfW * 1.6 && s.x < sw + halfW * 1.6;
      p.root.visible = vis;
      if (!vis) continue;
      poseMusician(p, bph, frozen || phase === "crown" ? 0 : 1, m.x, m.y, g.scale);
      p.root.zIndex = m.y;
    }
    // Las pancartas de cada fraternidad, adelante de su bloque.
    banners.clear();
    if (phase === "pres" || phase === "walk") {
      const off = frontOffsets(g);
      const hx = headX(tAll);
      for (const gi of P.order) {
        if (!inColumn.has(gi)) continue;
        const f = P.frats[gi] as Frat;
        const bx = (off.front.get(gi) ?? 0) + hx + g.gap * 0.35;
        const by = rowY(0, g.depth, g);
        const s = g.scale;
        banners.moveTo(bx, by).lineTo(bx, by - 150 * s).stroke({ width: 3 * s, color: 0x6b4423 });
        banners.rect(bx - 30 * s, by - 150 * s, 30 * s, 40 * s).fill(f.color).stroke({ width: 2.4 * s, color: INK });
        banners.star(bx - 15 * s, by - 130 * s, 5, 8 * s, 3.5 * s).fill(0xffffff);
      }
    }
    // Los cohetillos, en la coronación.
    fx.clear();
    if (phase === "crown") {
      const cxx = doorX(g);
      for (let b = 0; b < 6; b++) {
        const t0 = P.T_CROWN + b * 0.35, age = tAll - t0;
        if (age < 0 || age > 1.4) continue;
        const bx = cxx + (hash(b, 1) - 0.5) * 420 * k, by = g.streetTop - (260 + hash(b, 2) * 160) * k;
        for (let i = 0; i < 16; i++) {
          const a = (i / 16) * Math.PI * 2;
          const dd = age * 120 * k;
          fx.circle(bx + Math.cos(a) * dd, by + Math.sin(a) * dd + age * age * 40 * k, (3.5 - age * 2) * k).fill({ color: [0xffc629, 0xe93d9c, 0x00a896, 0xffffff][(b + i) % 4] as number, alpha: 1 - age / 1.4 });
        }
      }
    }
    // La interfaz.
    const live = dancers.filter((d) => d.alive).length;
    counter.text = counterText(t("cOruLeft"), live, n);
    const bw = counter.width + 40 * k, bh = 40 * k;
    if (Math.abs(bw - counterW) > 0.5) {
      counterW = bw;
      placePills(g);
    }
    counter.position.set(bw / 2, bh / 2);
    counterBox.clear().rect(5 * k, 5 * k, bw, bh).fill(INK).rect(0, 0, bw, bh).fill(S.dark ? 0x221a33 : 0xffffff).stroke({ width: 3 * k, color: INK });
    drawPills(g);
    drawRoster(g);
    drawDrum(g, bph, frozen);
    drawTags(g, bw, bh);
    const k0 = exitsDone + (phase === "walk" && exitsDone < P.arches.length ? 1 : 0);
    blockText.text = phase === "walk" && P.arches.length ? T[getLang()].cOruBlock(clamp(k0, 1, P.arches.length), P.arches.length) : "";
    blockPlate.clear();
    if (blockText.text) {
      const pw = blockText.width + 16 * k, ph = blockText.height + 8 * k;
      blockPlate.roundRect(blockText.x - pw + 8 * k, blockText.y - ph + 4 * k, pw, ph, 5 * k).fill({ color: 0x221a33, alpha: 0.94 }).stroke({ width: 2 * k, color: INK });
    }
    if (phase === "crown") crownUI.at(tAll - P.T_CROWN);
  }

  /** Las pastillas: las que todavía no pasaron, apagadas; la que pasa, con borde; las que se quedaron, tachadas. */
  function drawPills(g: Geo): void {
    const k = g.k;
    const show = P.frats.length > 1 && phase !== "crown" && phase !== "dead" && (!S.portrait() || phase !== "pres");
    pillsLayer.visible = show;
    if (!show) return;
    const cur = phase === "pres" ? P.pres.find((p) => tAll >= p.t0 && tAll < p.t1)?.g ?? -1 : -1;
    for (const p of pills) {
      const f = P.frats[p.g] as Frat;
      const presented = P.pres.some((x) => x.g === p.g && tAll >= x.t0);
      const gone = !inColumn.has(p.g);
      const alive = aliveOf(f).length;
      const state = `${presented ? 1 : 0}${gone ? 1 : 0}${cur === p.g ? 1 : 0}${alive}`;
      p.c.position.set(p.x, p.y);
      if (state === p.last) continue;
      p.last = state;
      p.count.text = gone ? "✕" : String(alive);
      p.name.position.set(p.h * 0.95, p.h / 2);
      p.count.position.set(p.w - p.h * 0.32, p.h / 2);
      p.bg.clear()
        .roundRect(2.5 * k, 2.5 * k, p.w, p.h, 6 * k).fill(INK)
        .roundRect(0, 0, p.w, p.h, 6 * k).fill(S.dark ? 0x221a33 : 0xffffff).stroke({ width: (cur === p.g ? 3.2 : 2) * k, color: cur === p.g ? YELLOW : INK })
        .roundRect(p.h * 0.18, p.h * 0.18, p.h * 0.6, p.h * 0.64, 3 * k).fill(f.color).stroke({ width: 1.2 * k, color: INK });
      if (gone) p.bg.moveTo(p.h * 0.9, p.h / 2).lineTo(p.w - p.h * 0.75, p.h / 2).stroke({ width: 2 * k, color: 0xd52b1e });
      p.c.alpha = gone ? 0.55 : presented || phase !== "pres" ? 1 : 0.5;
    }
  }

  /** El cartel de la presentación: entra con la fraternidad, se va cuando pasa la siguiente. */
  function drawRoster(g: Geo): void {
    if (phase !== "pres") {
      roster.visible = false;
      return;
    }
    const i = P.pres.findIndex((p) => tAll < p.t1);
    const cur = P.pres[i < 0 ? P.pres.length - 1 : i] as { g: number; t0: number; t1: number };
    if (tAll < cur.t0) {
      // Antes de su turno se arma de a poco, sin mostrarse.
      prepareRoster(cur.g, 4);
      roster.visible = false;
      return;
    }
    prepareRoster(cur.g, 24);
    roster.visible = true;
    const a = clamp((tAll - cur.t0) / 0.16, 0, 1);
    const dx = (1 - ease.outBack(a)) * (S.portrait() ? 0 : 60 * g.k);
    const dy = (1 - ease.outBack(a)) * (S.portrait() ? -30 * g.k : 0);
    roster.position.set(rosterBox.x + dx, rosterBox.y + dy);
    roster.alpha = a;
  }

  /**
   * El bombo de la banda, arriba a la derecha: el mazo pega en cada tiempo y el
   * parche se prende. Es para aplaudir al ritmo, no por nadie: aplaudir por uno
   * de los dos sería votar (sección 7.8).
   */
  function drawDrum(g: Geo, bph: number, frozen: boolean): void {
    const k = g.k;
    const show = (phase === "pres" || phase === "duel" || (phase === "walk" && tAll < P.T_GO + 2.5)) && !frozen;
    drum.visible = show;
    if (!show) return;
    // El golpe: un destello corto en el tiempo, que se apaga antes del siguiente.
    const pulse = Math.pow(Math.max(0, Math.cos(bph)), 8);
    const R = 19 * k * (1 + 0.12 * pulse);
    const x = g.w - 30 * k - 19 * k, y = S.top() + 10 * k + 21 * k;
    const lw = drumText.width + 18 * k, lh = drumText.height + 10 * k;
    const lx = x - 19 * k - 14 * k - lw;
    drumG.clear()
      .roundRect(lx + 3 * k, y - lh / 2 + 3 * k, lw, lh, 5 * k).fill(INK)
      .roundRect(lx, y - lh / 2, lw, lh, 5 * k).fill(pulse > 0.4 ? YELLOW : 0xffffff).stroke({ width: 2 * k, color: INK })
      // El bombo de frente: el aro rojo, el parche y su estrella.
      .circle(x + 3 * k, y + 3 * k, R).fill(INK)
      .circle(x, y, R).fill(0xd52b1e).stroke({ width: 2.4 * k, color: INK })
      .circle(x, y, R * 0.78).fill(pulse > 0.4 ? YELLOW : 0xf6efe2).stroke({ width: 1.6 * k, color: INK })
      .star(x, y, 5, R * 0.42, R * 0.18).fill({ color: 0xd52b1e, alpha: 0.85 });
    // El mazo: arriba entre golpes, sobre el parche en el golpe.
    const a = 0.9 - 0.9 * pulse;
    const hx = x + R * 1.25, hy = y + R * 0.2;
    const ex = hx - Math.cos(a) * R * 0.95, ey = hy - Math.sin(a) * R * 0.95 - R * 0.1;
    drumG.moveTo(hx, hy).lineTo(ex, ey).stroke({ width: 3 * k, color: 0x6b4423, cap: "round" }).circle(ex, ey, 5 * k).fill(0xf6efe2).stroke({ width: 1.6 * k, color: INK });
    drumText.position.set(lx + lw / 2, y);
  }

  S.run((dt, now) => {
    tAll += dt;
    const frozen = !!fz && tAll >= fz.t0 && tAll < fz.t1;
    if (!frozen && phase !== "crown") beatT += dt;
    if (phase !== "crown" && phase !== "dead") phase = tAll < P.T_GO ? "pres" : tAll < P.T_SOCAVON ? "walk" : tAll < P.T_CROWN ? "duel" : "crown";
    script();
    acc += dt;
    let guard = 0;
    while (acc >= DT && guard++ < 12) {
      step(DT);
      acc -= DT;
    }
    if (acc > DT) acc = 0;
    S.breath(tAll, P.T_CROWN);
    if (phase === "crown") {
      crown();
      tHold += dt * paceFactor();
    }
    direct(dt);
    cam.update(dt);
    cam.apply(S.scene, S.sw(), S.sh(), now);
    draw(now);
    if (tHold >= WINNER_HOLD) {
      phase = "dead";
      S.cleanup();
    }
  });
}
