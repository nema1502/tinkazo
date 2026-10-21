import { Container, Graphics, Sprite, Text, Texture } from "pixi.js";
import { T, getLang, t } from "../../i18n";
import { musicHold } from "../../music";
import { paceFactor, setGameLength, type Beacon } from "../../state";
import { beep, beepFor, fanfare, note } from "../../sound";
import { WINNER_HOLD, clamp, ease, winnersLabel } from "../overlay";
import { CHIP_SCALE, CREAM, INK, MONO, YELLOW, hash, mountPixi, seeded, type PixiStage } from "./stage";
import { LINES, T_BOARD, T_CROWN, T_DOCK, T_RUN, planCableCar } from "./cablecar-plan";
import { GRUPOS, grupoDe } from "../grupos";

/**
 * El Teleférico, en PixiJS, con el director de cámara.
 *
 * Un convoy sube por el cable con una cabina por grupo (`grupos.ts`, sección
 * 7.7 del plan de juegos): en cada estación se baja un grupo entero, y en la
 * última cabina se baja de a uno hasta que quedan dos, que suben juntos. Cada
 * arco tiene su giro: la puerta, la mordaza, el apagón o la ráfaga. El plan
 * está en `cablecar-plan.ts`. Lo visual: la cámara arranca en el andén de la
 * base, sigue al convoy, se acerca a cada andén cuando se baja gente, se queda
 * quieta sobre el tramo por donde resbala la mordaza, se hamaca con el viento,
 * se mete en el convoy apenas titila la luz del apagón, y sigue a la cabina
 * con los dos hasta la cumbre.
 *
 * Los nombres viven en la pantalla, no en el mundo (18 de octubre de 2026): en
 * un celular, los que iban pegados a las cabinas crecían con el acercamiento de
 * la cámara y quedaban cortados contra el borde. Ahora cada uno busca el costado
 * de su cabina que entra, y los que se bajan en cada estación saltan con su
 * cara hasta su renglón en el andén, con su nombre.
 */

const hexOf = (css: string): number => parseInt(css.replace("#", ""), 16);

export async function cableCarPixi(names: string[], winners: readonly number[], beacon: Beacon, done: () => void): Promise<void> {
  const winnerIdx = winners[0] ?? 0;
  let skipFn = (): void => {};
  const st = await mountPixi(beacon, done, () => skipFn());
  if (!st) {
    done();
    return;
  }
  const S: PixiStage = st;
  const { rng, cam } = S;
  setGameLength(T_CROWN, WINNER_HOLD);
  const P = planCableCar(names, winners, rng);
  const { n, C, story, puerta, mordaza, apagon, rafaga, stops, passes, rank, left, cabinOf, winnerCab, slipCab } = P;
  const NS = P.S;
  /** La última parada: ahí se bajan de a uno hasta que quedan dos. */
  const lastStop = stops.find((s) => s.last);
  /**
   * Los dos que llegan juntos a la última cabina: el ganador y otro. El giro de
   * la puerta y el de la mordaza nombran a uno de los dos, sorteado con la
   * semilla de la ronda, para que la sala no aprenda que el nombrado es el
   * ganador.
   */
  const quienDeLosDos = (): number => (seedOf(13) < 0.5 ? winnerIdx : ((rank[1] as number | undefined) ?? winnerIdx));
  /** Lo que tarda una cara en volar de su cabina a su renglón del andén. */
  const FLY = 0.5;
  /**
   * Cuánto resbala la cabina en la mordaza, en distancias entre cabinas. Era
   * 0,62, y con la cámara siguiéndola de cerca el resbalón no se veía: la
   * cabina quedaba quieta en el medio de la pantalla y lo que se movía era el
   * fondo (crítico de juegos, 16 de octubre de 2026). Ahora la cámara queda
   * quieta y la cabina se va casi una cabina entera cable abajo.
   */
  const SLIP = 0.95;
  const lang = getLang();
  S.mark("arco", story.arc);
  const deco = seeded(parseInt(beacon.randomness.slice(24, 32), 16));
  const seedOf = (k: number): number => {
    const v = parseInt(beacon.randomness.slice((k * 2) % 56, ((k * 2) % 56) + 8), 16);
    return (v % 1000) / 1000;
  };

  /* ============================================================ geometría */
  interface Geo { k: number; dir: { x: number; y: number }; span: number; vertical: boolean; cw: number; ch: number; gap: number }
  const geo = (): Geo => {
    const vertical = S.portrait();
    const k = Math.min(S.u(), S.sw() / 720);
    const theta = vertical ? 0.95 : 0.4;
    return {
      k, vertical, dir: { x: Math.cos(theta), y: -Math.sin(theta) },
      span: vertical ? S.sh() * 0.52 : S.sw() * 0.62,
      cw: 104 * k, ch: 78 * k, gap: 132 * k,
    };
  };
  let G = geo();
  /** Un punto del cable: `pos` en unidades de cable, `off` corrido hacia atrás en píxeles. */
  const pt = (pos: number, off = 0): { x: number; y: number } => {
    const d = pos * G.span - off;
    return { x: G.dir.x * d, y: G.dir.y * d };
  };

  /* =============================================================== escena */
  interface Cab {
    root: Container; hang: Container; body: Graphics; win: Graphics; faces: Sprite[]; count: Text;
    door: Graphics; flag: Graphics; doors: Graphics; ring: Graphics; lastKey: string; empty: boolean;
  }
  interface Station { root: Container; flag: Graphics; bunting: Graphics | null; tag: Container; minus: Text }
  let far!: Container;
  let lightsA!: Graphics;
  let lightsB!: Graphics;
  let cities!: Container;
  let stations: Station[] = [];
  let cabs: Cab[] = [];
  let fx!: Graphics;
  /**
   * El apagón, en dos capas: un velo negro sobre el mundo entero menos las
   * cabinas, que quedan colgando con su luz de emergencia, y los bordes de la
   * pantalla más oscuros todavía. Antes era un velo al 50% sobre todo, cabinas
   * incluidas, y la escena casi no cambiaba: la sala no se enteraba del
   * apagón (crítico de juegos, 16 de octubre de 2026).
   */
  let blackout!: Graphics;
  let vignette!: Sprite;
  let wind!: Graphics;
  /** Los nombres, en la pantalla y no en el mundo: los de las cabinas y el andén. */
  let nameLayer!: Container;
  /** Las caras que vuelan al andén: la sombra abajo, las caras y el marco arriba. */
  let flyBack!: Graphics;
  let flyBox!: Container;
  let flyFrame!: Graphics;
  let flyFaces: Sprite[] = [];
  /**
   * El andén de la parada en curso, ya armado: los chips de los que se bajan,
   * dónde va cada uno, y el "+N" cuando no entran todos.
   */
  interface BoardView {
    key: string; chips: Container[]; plus: Container | null; slots: { x: number; y: number }[]; sc: number;
    box: { x0: number; y0: number; x1: number; y1: number };
  }
  let boardView: BoardView | null = null;
  /** Los renglones del andén de cada estación, armados antes de su parada (`prepareBoards`). */
  const prepared = new Map<number, Container[]>();
  /** El nombre de cada cabina que lleva a una sola persona, y de qué costado va. */
  const soloTags = new Map<number, { txt: string; sc: number; chip: Container; side: number }>();
  let hudLabel!: Text;
  let hudNum!: Text;
  let hudStation!: Text;

  function build(): void {
    G = geo();
    const { k, span } = G;
    const sw = S.sw(), sh = S.sh();
    for (const c of [S.bg, S.scene, S.hud]) c.removeChildren().forEach((x) => x.destroy({ children: true }));

    // El cielo del atardecer, quieto.
    const cv = document.createElement("canvas");
    cv.width = 2;
    cv.height = 256;
    const cx = cv.getContext("2d") as CanvasRenderingContext2D;
    const grad = cx.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, S.dark ? "#0b1230" : "#152052");
    grad.addColorStop(0.55, S.dark ? "#2a1b48" : "#3a2560");
    grad.addColorStop(1, S.dark ? "#b3553f" : "#d86f4d");
    cx.fillStyle = grad;
    cx.fillRect(0, 0, 2, 256);
    const sky = new Sprite(Texture.from(cv));
    sky.width = sw;
    sky.height = sh;
    S.bg.addChild(sky);
    const stars = new Graphics();
    for (let i = 0; i < 90; i++) stars.circle(deco() * sw, deco() * sh * 0.5, (0.5 + deco()) * k).fill({ color: 0xffffff, alpha: 0.3 + deco() * 0.5 });
    S.bg.addChild(stars);

    // La cordillera al fondo, casi quieta, genérica como pide la marca.
    const endX = pt(NS + 2).x + sw;
    far = new Container();
    const ridge = new Graphics();
    const baseY = pt(0).y + sh * 0.12;
    const mh = Math.min(sh * 0.3, 240 * k);
    const pts: number[] = [-sw * 2, baseY];
    const peaks: [number, number][] = [];
    for (let x = -sw * 2; x <= endX * 0.5 + sw * 2; x += 120 * k * (0.6 + deco() * 0.8)) {
      const y = baseY - mh * (0.3 + deco() * 0.7);
      pts.push(x, y);
      peaks.push([x, y]);
    }
    pts.push(endX * 0.5 + sw * 2, baseY + sh * 3, -sw * 2, baseY + sh * 3);
    ridge.poly(pts).fill(S.dark ? 0x3b3563 : 0x4a3f78);
    for (const [x, y] of peaks) {
      if (baseY - y < mh * 0.7) continue;
      ridge.poly([x - 26 * k, y + 22 * k, x, y, x + 26 * k, y + 22 * k, x + 9 * k, y + 16 * k, x - 7 * k, y + 20 * k]).fill(0xe8e4f4);
    }
    far.addChild(ridge);
    S.scene.addChild(far);

    // La ciudad en la hoyada: luces cálidas en dos capas que titilan a destiempo.
    cities = new Container();
    lightsA = new Graphics();
    lightsB = new Graphics();
    const x0 = -sw * 1.5, x1 = pt(NS + 1).x + sw * 1.5;
    const yTop = pt(0).y + 40 * k;
    for (let i = 0; i < 520; i++) {
      const x = x0 + deco() * (x1 - x0);
      const y = yTop + deco() * sh * 1.6 + (x - x0) * G.dir.y * 0.4;
      const g = i % 2 ? lightsA : lightsB;
      g.rect(x, y, (1.6 + deco() * 2.6) * k, (1.6 + deco() * 2.6) * k).fill(deco() > 0.5 ? 0xffd38a : 0xffb35c);
    }
    cities.addChild(lightsA, lightsB);
    S.scene.addChild(cities);

    // Torres y cables.
    const world = new Container();
    S.scene.addChild(world);
    const towers = new Graphics();
    for (let i = 0; i <= NS; i++) {
      const p = pt(i + 0.5);
      towers.poly([p.x - 7 * k, p.y + 6 * k, p.x + 7 * k, p.y + 6 * k, p.x + 20 * k, p.y + sh * 1.5, p.x - 20 * k, p.y + sh * 1.5]).fill(S.dark ? 0x1b1830 : 0x231d3d);
      towers.rect(p.x - 26 * k, p.y - 4 * k, 52 * k, 10 * k).fill(INK);
    }
    world.addChild(towers);
    const a = pt(-1.5), b = pt(NS + 2.5);
    world.addChild(new Graphics()
      .moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: 4 * k, color: 0x0d0b16 })
      .moveTo(a.x, a.y + 14 * k).lineTo(b.x, b.y + 14 * k).stroke({ width: 3 * k, color: 0x0d0b16, alpha: 0.7 }));

    // Las estaciones, con su bandera, y los banderines en la cumbre.
    stations = [];
    for (let s = 0; s <= NS + 1; s++) {
      const p = pt(s);
      const top = s === NS + 1, base = s === 0;
      const bw = (top ? 230 : base ? 210 : 160) * k, bh = 160 * k;
      const y0 = p.y - 40 * k;
      const root = new Container();
      const band = top ? YELLOW : hexOf(LINES[(s + 2) % LINES.length] as string);
      const bld = new Graphics()
        .rect(p.x - bw / 2 + 8 * k, y0 + 8 * k, bw, bh).fill(INK)
        .rect(p.x - bw / 2, y0, bw, bh).fill(top ? 0xf6efe2 : S.dark ? 0xd9d2c4 : 0xe8e1d3).stroke({ width: 3 * k, color: INK })
        .rect(p.x - bw / 2 + 14 * k, y0 + 30 * k, bw - 28 * k, bh - 58 * k).fill(S.dark ? 0x2b2640 : 0x3a3450)
        .rect(p.x - bw / 2, y0, bw, 16 * k).fill(band).stroke({ width: 3 * k, color: INK })
        .rect(p.x - bw / 2 - 10 * k, y0 + bh - 18 * k, bw + 20 * k, 10 * k).fill(INK)
        .moveTo(p.x - bw / 2 + 14 * k, y0).lineTo(p.x - bw / 2 + 14 * k, y0 - 136 * k).stroke({ width: 3 * k, color: INK });
      const flag = new Graphics();
      const bunting = top ? new Graphics() : null;
      root.addChild(bld, flag);
      if (bunting) root.addChild(bunting);
      // El rótulo: un disco con el número (o CUMBRE/BASE) por encima del techo.
      const tag = new Container();
      const ty = y0 - 34 * k;
      if (top || base) {
        const label = S.text(t(top ? "cTelTop" : "cTelBase"), { fontSize: 24 * k, fontWeight: "900", fill: INK });
        label.anchor.set(0.5);
        const tw = label.width + 26 * k;
        tag.addChild(new Graphics().rect(-tw / 2 + 4 * k, -14 * k, tw, 36 * k).fill(INK).rect(-tw / 2, -18 * k, tw, 36 * k).fill(top ? YELLOW : 0xf6efe2).stroke({ width: 3 * k, color: INK }), label);
      } else {
        const label = S.text(String(s), { fontSize: 30 * k, fontWeight: "900", fill: INK });
        label.anchor.set(0.5);
        tag.addChild(new Graphics().circle(3 * k, 3 * k, 27 * k).fill(INK).circle(0, 0, 27 * k).fill(P.stopOf.has(s) ? YELLOW : 0xf6efe2).stroke({ width: 3 * k, color: INK }), label);
      }
      tag.position.set(p.x, ty);
      const minus = S.text("", { fontSize: 36 * k, fontWeight: "900", fill: YELLOW, stroke: { color: INK, width: 7 * k } });
      minus.anchor.set(1, 0.5);
      minus.position.set(p.x - 40 * k, ty);
      root.addChild(tag, minus);
      world.addChild(root);
      stations.push({ root, flag, bunting, tag, minus });
    }

    // El velo del apagón tapa el cielo, la cordillera, la ciudad, las torres y
    // las estaciones, y deja afuera a las cabinas, que van encima. Es enorme
    // para que ningún encuadre de la cámara le encuentre el borde.
    const v0 = pt(-3), v1 = pt(NS + 4);
    blackout = new Graphics().rect(v0.x - sw * 3, v1.y - sh * 3, v1.x - v0.x + sw * 6, v0.y - v1.y + sh * 6).fill(0x020208);
    blackout.alpha = 0;
    world.addChild(blackout);

    // Las cabinas.
    cabs = [];
    const cabLayer = new Container();
    world.addChild(cabLayer);
    for (let cab = C - 1; cab >= 0; cab--) {
      const root = new Container();
      root.addChild(new Graphics().rect(-12 * k, -6 * k, 24 * k, 12 * k).fill(INK));
      const hang = new Container();
      root.addChild(hang);
      hang.addChild(new Graphics().moveTo(0, 0).lineTo(0, 24 * k).stroke({ width: 4 * k, color: INK }));
      const body = new Graphics();
      const win = new Graphics().rect(-G.cw / 2 + 8 * k, 24 * k + 10 * k, G.cw - 16 * k, G.ch * 0.58).fill(0x1d2336);
      const faces = [0, 1, 2].map(() => {
        const sp = new Sprite(S.face(""));
        sp.visible = false;
        return sp;
      });
      const doorG = new Graphics();
      const doors = new Graphics();
      const flag = new Graphics();
      const count = S.text("", { fontSize: 17 * k, fontWeight: "900", fill: INK });
      count.anchor.set(1, 1);
      count.position.set(G.cw / 2 + 2 * k, 24 * k + G.ch + 2 * k);
      const ring = new Graphics();
      hang.addChild(body, win, ...faces, doorG, doors, flag, count, ring);
      cabLayer.addChild(root);
      cabs[cab] = { root, hang, body, win, faces, count, door: doorG, flag, doors, ring, lastKey: "", empty: false };
    }
    fx = new Graphics();
    world.addChild(fx);

    // La interfaz: los bordes del apagón, vetas del viento, los nombres y los
    // contadores.
    const vc = document.createElement("canvas");
    vc.width = vc.height = 128;
    const vx = vc.getContext("2d") as CanvasRenderingContext2D;
    const vg = vx.createRadialGradient(64, 64, 20, 64, 64, 92);
    vg.addColorStop(0, "rgba(2,2,8,0)");
    vg.addColorStop(1, "rgba(2,2,8,0.95)");
    vx.fillStyle = vg;
    vx.fillRect(0, 0, 128, 128);
    vignette = new Sprite(Texture.from(vc));
    vignette.width = sw;
    vignette.height = sh;
    vignette.alpha = 0;
    wind = new Graphics();
    nameLayer = new Container();
    flyBack = new Graphics();
    flyBox = new Container();
    flyFrame = new Graphics();
    flyFaces = [];
    S.hud.addChild(vignette, wind, nameLayer, flyBack, flyBox, flyFrame);
    // Lo que estaba armado para el tamaño anterior se rearma en el próximo
    // cuadro (ya se destruyó con el resto de la interfaz).
    boardView = null;
    prepared.clear();
    soloTags.clear();
    const top = S.top() + 18 * k;
    hudLabel = S.text("", { fontSize: 14 * k, fontWeight: "800", fill: CREAM });
    hudLabel.alpha = 0.8;
    hudLabel.position.set(22 * k, top);
    hudNum = S.text("", { fontSize: 52 * k, fontWeight: "900", fill: YELLOW, stroke: { color: INK, width: 6 * k } });
    hudNum.position.set(22 * k, top + 18 * k);
    hudStation = S.text("", { fontSize: 16 * k, fontWeight: "800", fill: CREAM });
    hudStation.alpha = 0.85;
    hudStation.position.set(22 * k, top + 82 * k);
    // La ronda ya está arriba, en la barra del estadio: abajo se encimaba con las cabinas.
    S.hud.addChild(hudLabel, hudNum, hudStation);
    void span;
  }
  build();
  const crown = S.crown(names, winners);
  S.onResize(build);

  /* ================================================================ estado */
  let tAll = 0, tHold = 0, silent = false, didCrown = false, didDock = false;
  let lastHum = -1, boardTicks = 0, beat = -1, beatDark = -1, lastSaid = -99, lastGrind = -1;
  const fired = new Set<string>();
  /** Cuántos se bajaron en cada estación, para el "−N" de su rótulo. */
  const platform = new Map<number, { off: number; t: number }>();
  /**
   * El andén de cada parada menos la última, que tiene su propio salto: quiénes
   * se bajaron (los co-ganadores primero), desde cuándo y hasta cuándo se ven.
   * Hasta el 18 de octubre de 2026 saltaban cuadraditos de color y los nombres
   * salían solo si se bajaban tres o menos: con 27 personas, los trece de la
   * primera estación se iban sin que nadie supiera quiénes eran (crítico de
   * juegos, 16 de octubre de 2026).
   */
  interface Board { station: number; at: number; tOff: number; tEnd: number; who: number[] }
  const boards: Board[] = [];
  const chispas = Array.from({ length: 14 }, () => ({ a: -Math.PI * (0.1 + deco() * 0.8), v: 0.6 + deco() * 0.8 }));
  const vetas = Array.from({ length: 22 }, () => ({ y: deco(), len: 0.08 + deco() * 0.14, v: 1.1 + deco() * 1.2, off: deco() }));

  function once(key: string, due: boolean, fn: () => void): void {
    if (!due || fired.has(key)) return;
    fired.add(key);
    fn();
  }
  const sayNow = (msg: string, heat: number): void => {
    if (silent) return;
    lastSaid = tAll;
    S.say(msg, heat);
  };
  const ding = (hi = 12, lo = 8): void => {
    if (silent) return;
    beep(note(hi), 0.16, "triangle", 0.05);
    setTimeout(() => beep(note(lo), 0.22, "triangle", 0.045), 200);
  };

  function events(): void {
    once("board", tAll >= 0.05, () => sayNow(t("cTelBoard"), 0.1));
    once("count", tAll >= 0.9, () => sayNow(T[lang].cTelCount(n, C), 0.15));
    once("go", tAll >= T_BOARD, () => {
      sayNow(t("cTelGo"), 0.4);
      ding(15, 10);
    });
    for (const p of passes) {
      once(`pass${p.station}`, tAll >= p.t, () => {
        sayNow(T[lang].cTelPass(p.station), 0.35);
        if (!silent) beep(note(12), 0.14, "triangle", 0.04);
      });
    }
    for (const s of stops) {
      once(`arrive${s.station}`, tAll >= s.t0, () => {
        ding();
        // Con los que siguen arriba, que es lo que dice el contador: decía
        // "¡QUEDAN DOS!" con tres o cuatro (evaluador visual, 21 de octubre de 2026).
        if (s.last) sayNow(T[lang].cTelLast(left[s.round] as number), 0.8);
        if (!silent) cam.punch(0.03);
      });
      once(`off${s.station}`, tAll >= s.tOff, () => {
        const who = rank.slice(left[s.round + 1] as number, left[s.round] as number);
        // Los co-ganadores que se bajan acá van primero en el andén, y con
        // premio se los nombra aunque se bajen muchos. Hasta el 7 de octubre
        // de 2026 el tercer premio se bajaba con "se baja uno, quedan 2".
        const prem = who.filter((i) => winners.indexOf(i) > 0);
        platform.set(s.station, { off: who.length, t: s.tOff });
        // Cada uno vuela con su cara a su renglón del andén. El andén se queda
        // hasta que bajan los de la estación siguiente, y se va antes de que
        // llegue la última, que es de ella. Con el apagón titila con la luz y
        // se apaga con ella (`drawBoard`).
        const next = stops.find((x) => x.t0 > s.t0);
        let tEnd = next ? (next.last ? next.t0 - 0.1 : next.tOff - 0.02) : T_RUN - 0.1;
        if (apagon && P.corte > s.tOff) tEnd = Math.min(tEnd, P.corte + 0.08);
        boards.push({ station: s.station, at: s.at, tOff: s.tOff, tEnd, who: offOf(s.round) });
        if (s.last && prem.length) {
          // De a uno, y con premio: los co-ganadores que bajan en la última se
          // nombran con su premio, y no como "¡Hasta acá llegó X!".
          sayNow(T[lang].cPrizeOut(prem.slice(0, 3).map((i) => names[i] ?? "")), 0.9);
        } else if (s.last) {
          // Se nombra a todos los que se bajan, que son los que descuenta el
          // contador en este mismo instante: "¡Se baja X!" nombraba a uno solo
          // mientras el contador bajaba de cuatro a dos. Si no se baja nadie
          // (dos personas en total), no hay nada que decir.
          if (who.length === 1) sayNow(T[lang].cTelOff(names[who[0] as number] ?? ""), 0.9);
          else if (who.length > 1) sayNow(T[lang].cTelOffN(who.slice(0, 3).map((i) => names[i] ?? ""), Math.max(0, who.length - 3)), 0.9);
        } else if (prem.length) {
          sayNow(T[lang].cPrizeOut(prem.slice(0, 3).map((i) => names[i] ?? "")), 0.5 + 0.3 * (s.round / Math.max(1, P.R)));
        } else {
          // Se baja un grupo entero: el relator dice el nombre del grupo.
          const grupo = GRUPOS[grupoDe(who[0] ?? 0, n)] ?? GRUPOS[0] as (typeof GRUPOS)[number];
          sayNow(T[lang].cTelGrupo(s.station, grupo, who.length, left[s.round + 1] as number), 0.5 + 0.3 * (s.round / Math.max(1, P.R)));
        }
        // El golpe suena cuando la cara toca el andén.
        if (!silent) {
          const blips = Math.min(6, who.length);
          for (let i = 0; i < blips; i++) setTimeout(() => beep(note(15 - i), 0.07, "sine", 0.032), i * 70);
        }
      });
      once(`detach${s.station}`, tAll >= s.tDetach, () => {
        if (!silent && P.detachT.some((d) => d === s.tDetach)) beep(note(3), 0.08, "square", 0.036);
      });
    }
    if (puerta) {
      once("puerta", tAll >= P.puertaA, () => {
        sayNow(T[lang].cTelDoor(names[quienDeLosDos()] ?? ""), 0.85);
        if (!silent) {
          beep(note(12), 0.08, "triangle", 0.04);
          setTimeout(() => beep(note(15), 0.1, "triangle", 0.035), 70);
        }
      });
      once("cierra", tAll >= P.puertaB, () => {
        sayNow(t("cTelStays"), 0.9);
        if (!silent) {
          beep(note(5), 0.08, "square", 0.05);
          cam.punch(0.05).shake(6 * G.k);
        }
      });
    }
    // Los dos giros que la sala no notaba (crítico de juegos, 16 de octubre de
    // 2026): los dos callan la banda de golpe. Un velo o un resbalón se pierden
    // si alguien está mirando para otro lado; que se corte la música, no.
    if (mordaza) {
      // Se suelta, y mientras resbala el chirrido del cable baja (en `sounds`).
      once("suelta", tAll >= P.mA, () => {
        sayNow(T[lang].cTelSlip(names[quienDeLosDos()] ?? ""), 0.9);
        if (!silent) {
          musicHold(true);
          [14, 12, 10, 8, 6].forEach((d, i) => setTimeout(() => beep(note(d), 0.06, "square", 0.035), i * 45));
          cam.punch(0.04);
        }
      });
      // La agarra: el golpe de la mordaza, el chasquido del metal y la banda
      // que vuelve en el uno, todo junto.
      once("agarra", tAll >= P.mB, () => {
        musicHold(false);
        sayNow(t("cTelCaught"), 0.95);
        if (!silent) {
          beep(note(2), 0.12, "square", 0.06);
          beep(note(0), 0.3, "sine", 0.08);
          setTimeout(() => beep(note(14), 0.16, "triangle", 0.045), 50);
          cam.shake(18 * G.k).punch(0.1);
        }
      });
    }
    if (apagon) {
      // Titila dos veces antes de cortarse (`luzAt`), con un chasquido en cada
      // parpadeo: el aviso para levantar la vista.
      once("titila1", tAll >= P.corte - 0.24, () => {
        if (!silent) beep(note(9), 0.05, "square", 0.035);
      });
      once("titila2", tAll >= P.corte - 0.13, () => {
        if (!silent) beep(note(7), 0.05, "square", 0.035);
      });
      // Se corta la luz y con ella la banda, y el zumbido del cable se apaga
      // con el frenazo.
      once("corte", tAll >= P.corte, () => {
        sayNow(t("cTelDark"), 0.85);
        if (!silent) {
          musicHold(true);
          [12, 9, 6, 3].forEach((d, i) => setTimeout(() => beep(note(d), 0.09, "sawtooth", 0.035), i * 70));
          cam.punch(0.05);
        }
      });
      // Queda quieto en el aire de un tirón: golpe seco y sacudón.
      once("frena", tAll >= P.quieto, () => {
        if (silent) return;
        beep(note(0), 0.3, "sine", 0.09);
        beep(note(3), 0.1, "square", 0.05);
        cam.shake(12 * G.k).punch(0.05);
      });
      // Vuelve titilando, con un chasquido cada vez que prende. Iban a 160 y
      // 300 ms reales, y en "épico" ya no caían con la luz: ahora van en la
      // hora del juego. La banda vuelve cuando la luz se queda.
      once("vuelve", tAll >= P.vuelve, () => {
        sayNow(t("cTelLight"), 0.8);
        if (!silent) beep(note(10), 0.05, "square", 0.04);
      });
      once("prende", tAll >= P.vuelve + 0.16, () => {
        if (!silent) beep(note(12), 0.05, "square", 0.04);
      });
      once("queda", tAll >= P.vuelve + 0.3, () => {
        musicHold(false);
        if (!silent) beep(note(15), 0.1, "triangle", 0.045);
      });
    }
    if (rafaga) {
      const rt = P.rafagaT();
      once("rafagaSnd", tAll >= rt, () => {
        if (silent) return;
        beepFor(note(1), 1.3, "sawtooth", 0.028);
        beepFor(note(3), 0.9, "triangle", 0.03);
      });
      once("rafaga", tAll >= rt && tAll < rt + 1.4 && tAll - lastSaid > 0.5, () => sayNow(t("cTelWind"), 0.7));
    }
    // Los dos que quedan suben juntos: la duda dura hasta la cumbre.
    once("climb", tAll >= T_RUN + 0.15, () => sayNow(t("cTelWho"), 0.9));
    if (tAll >= T_DOCK && !didDock) {
      didDock = true;
      sayNow(t("cTelDock"), 0.95);
      if (!silent) {
        beep(note(0), 0.45, "sine", 0.1);
        setTimeout(() => beep(note(5), 0.07, "square", 0.06), 40);
        setTimeout(() => beep(note(15), 0.12, "triangle", 0.05), 90);
        cam.punch(0.1).shake(14 * G.k);
      }
    }
    S.breath(tAll, T_CROWN);
    if (tAll >= T_CROWN) crowned();
    const moving = P.headAt(tAll + 0.05) - P.headAt(tAll) > 0.002;
    if (moving && tAll > T_BOARD && tAll < T_RUN && tAll - lastSaid > 2.4) sayNow(t("cTelUp"), 0.4);
  }

  function sounds(): void {
    if (silent) return;
    if (tAll < T_BOARD) {
      const want = Math.min(Math.round((tAll / T_BOARD) * 22), Math.min(22, n + 4));
      while (boardTicks < want) {
        beep(note(5 + (boardTicks % 8)), 0.05, "square", 0.03);
        boardTicks++;
      }
    }
    const v = Math.abs(P.headAt(tAll + 0.05) - P.headAt(tAll)) / 0.05;
    if (tAll >= T_BOARD && tAll < T_DOCK && v > 0.05) {
      const hum = Math.floor(tAll / 0.3);
      if (hum !== lastHum) {
        lastHum = hum;
        beepFor(note(2 + Math.round(clamp(v, 0, 1.2) * 4)), 0.36, "sawtooth", 0.026);
      }
    }
    // Cada latido lleva su octava en triángulo: un seno puro de 131 Hz queda en
    // el borde de lo que da un parlante de proyector, y sin armónicos se pierde.
    if (tAll >= P.quieto && tAll < P.vuelve) {
      const b = Math.floor((tAll - P.quieto) / 0.42);
      if (b !== beatDark) {
        beatDark = b;
        // El primero cae con el golpe del frenazo, que ya suena.
        if (b > 0) {
          beep(note(0), 0.14, "sine", 0.075);
          beep(note(5), 0.09, "triangle", 0.035);
        }
      }
    }
    // La mordaza patina: un chirrido que baja de tono mientras la cabina
    // resbala, y se calla justo antes del golpe que la agarra.
    if (tAll >= P.mA + 0.08 && tAll < P.mB - 0.04) {
      const g = Math.floor((tAll - P.mA) / 0.07);
      if (g !== lastGrind) {
        lastGrind = g;
        const q = clamp((tAll - P.mA) / (P.mB - P.mA), 0, 1);
        beepFor(note(Math.round(13 - q * 9)), 0.09, "sawtooth", 0.03);
      }
    }
    const from = lastStop ? lastStop.t0 : T_RUN;
    if (tAll >= from && tAll < T_DOCK) {
      if (tAll >= T_RUN) {
        // La subida: el latido se acelera de 0,42 a 0,18 s de juego y sube de
        // a un grado. Iba parejo, y la cabina sola era una vuelta olímpica. El
        // número de latido es la integral del ritmo, así sale de la hora sola.
        const D = T_DOCK - T_RUN;
        const p = clamp((tAll - T_RUN) / D, 0, 1);
        const b = 1000 + Math.floor((D / 0.24) * Math.log(0.42 / (0.42 - 0.24 * p)));
        if (b !== beat) {
          beat = b;
          const step = Math.min(2, Math.floor(p * 3));
          beep(note(2 + step), 0.12, "sine", 0.06 + 0.02 * p);
          beep(note(7 + step), 0.08, "triangle", 0.035);
        }
      } else {
        const b = Math.floor((tAll - from) / 0.5);
        if (b !== beat) {
          beat = b;
          beep(note(0), 0.14, "sine", 0.07);
          beep(note(5), 0.09, "triangle", 0.035);
        }
      }
    }
  }

  function crowned(): void {
    if (didCrown) return;
    didCrown = true;
    S.say(T[lang].cWin(winnersLabel(names, winners), winners.length > 1), 1);
    fanfare();
    setTimeout(() => beep(note(17), 0.12, "triangle", 0.045), 520);
    setTimeout(() => beep(note(19), 0.12, "triangle", 0.035), 700);
  }

  skipFn = (): void => {
    if (tAll >= T_CROWN) return;
    silent = true;
    tAll = T_CROWN;
    events();
    silent = false;
    boards.length = 0;
    dropPrepared();
  };

  /** Dónde está una cabina a la hora `x`, en el mundo. */
  function cabPoint(cab: number, x: number): { x: number; y: number; alpha: number } {
    const td = P.detachT[cab] as number;
    let back = 0, alpha = 1;
    if (x > td) {
      const since = x - td;
      back = 0.5 * 2.2 * since * since * 140 * G.k;
      alpha = clamp(1 - since / 0.9, 0, 1);
    }
    const resbala = cab === slipCab ? P.slipAt(x) * G.gap * SLIP : 0;
    const p = pt(P.headAt(x), P.slotAt(cab, x) * G.gap + back + resbala);
    return { ...p, alpha };
  }

  /* ============================================================= nombres */
  // Los nombres van en la pantalla, del tamaño de la pantalla, y cada uno se
  // acomoda donde entra entero. En el mundo crecían con el acercamiento y en un
  // celular quedaban cortados contra el borde (crítico de juegos, 16 de
  // octubre de 2026).
  interface Box { x0: number; y0: number; x1: number; y1: number }
  /** Cuánto se tapan dos rectángulos, en píxeles cuadrados. */
  const overlap = (a: Box, b: Box): number =>
    Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
  /** Cuántos píxeles de pantalla mide una unidad del mundo en este cuadro. */
  const zoomNow = (): number => cam.toScreen(1, 0, S.sw(), S.sh()).x - cam.toScreen(0, 0, S.sw(), S.sh()).x;
  /** Dónde cae en pantalla el cuerpo de una cabina, sin el colgante ni la bandera. */
  function cabBox(cab: number, x: number): Box | null {
    const p = cabPoint(cab, x);
    if (p.alpha <= 0) return null;
    const a = cam.toScreen(p.x - G.cw / 2, p.y + 24 * G.k, S.sw(), S.sh());
    const z = zoomNow();
    return { x0: a.x, y0: a.y, x1: a.x + G.cw * z, y1: a.y + G.ch * z };
  }

  /** La parada cuyo andén se ve a la hora `x`. */
  const boardAt = (x: number): Board | null => boards.find((b) => x >= b.tOff && x < b.tEnd) ?? null;

  /** Un chip sin cara para los que no entran en el andén: "+13". */
  function plusChip(m: number, sc: number): Container {
    const k = S.u() * sc * CHIP_SCALE;
    const c = new Container();
    const label = S.text(`+${m}`, { fontSize: 12 * k, fontWeight: "900", fill: INK });
    label.position.set(9 * k, 3.5 * k);
    const w = label.width + 18 * k;
    c.addChild(new Graphics().roundRect(3 * k, 3 * k, w, 22 * k, 5 * k).fill(INK).roundRect(0, 0, w, 22 * k, 5 * k).fill(YELLOW).stroke({ width: 2 * k, color: INK }), label);
    c.pivot.set(0, 11 * k);
    return c;
  }

  /** El andén en esta pantalla: la escala de los renglones, su paso, dónde entran y cuántos. */
  function boardGrid(): { sc: number; kc: number; pitch: number; lo: number; hi: number; rowsMax: number; colsMax: number } {
    const u = S.u();
    // En escritorio, la base legible (19 px): con 1,3 el andén de doscientas
    // personas ocupaba casi el 70 % del ancho y tapaba las cabinas con gente.
    const sc = G.vertical ? 1.05 : 1;
    // Un chip mide 25 de estas unidades (`CHIP_SCALE` incluido): el renglón
    // sigue con un espacio chico, y el último entra con su chip entero.
    const kc = u * sc * CHIP_SCALE;
    const pitch = 26 * kc + 3 * u;
    const lo = S.top() + 12 * u, hi = S.sh() - S.bottom() - 12 * u;
    return { sc, kc, pitch, lo, hi, rowsMax: clamp(Math.floor((hi - lo + pitch - 25 * kc) / pitch), 2, G.vertical ? 7 : 8), colsMax: G.vertical ? 2 : 3 };
  }

  /** Quiénes se bajan en una parada, en el orden del andén: los co-ganadores primero. */
  function offOf(round: number): number[] {
    const who = rank.slice(left[round + 1] as number, left[round] as number);
    return [...who.filter((i) => winners.indexOf(i) > 0), ...who.filter((i) => winners.indexOf(i) <= 0)];
  }

  /** El renglón de una persona en el andén, todavía sin mostrar. */
  function boardChip(idx: number, sc: number): Container {
    const nm = names[idx] ?? "";
    // El co-ganador que se baja antes lleva su estrella: el relator dice que se va con premio.
    const c = S.chip(winners.indexOf(idx) > 0 ? `★ ${nm}` : nm, sc, nm);
    c.visible = false;
    nameLayer.addChild(c);
    return c;
  }

  /**
   * Los renglones de cada andén se arman antes de su parada, de a dos por
   * cuadro. Cada uno dibuja su cara y mide su nombre: con doscientas personas
   * se bajan cien en la primera estación, y armar los veinticuatro renglones
   * en el cuadro en que empiezan a volar trababa la escena 63 ms. Quedan en
   * `prepared`, por estación.
   */
  function prepareBoards(budget: number): void {
    const s = stops.find((x) => x.tOff > tAll);
    if (!s) return;
    const g = boardGrid();
    const who = offOf(s.round);
    const want = Math.min(who.length, g.rowsMax * g.colsMax);
    const list = prepared.get(s.station) ?? [];
    prepared.set(s.station, list);
    while (budget-- > 0 && list.length < want) list.push(boardChip(who[list.length] as number, g.sc));
  }

  function dropPrepared(): void {
    for (const list of prepared.values()) for (const c of list) c.destroy({ children: true });
    prepared.clear();
  }

  /**
   * Arma el andén de una parada: un chip con cara y nombre por cada uno que se
   * baja, en columnas, al costado de la estación donde menos tapa. Dónde va se
   * decide una vez, con el encuadre al que va la cámara y no con el de este
   * cuadro, que todavía está llegando, y después queda quieto: un nombre que
   * se mueve no se lee. Si no entran todos, el último renglón dice cuántos faltan.
   */
  function makeBoard(b: Board): BoardView {
    const W = S.sw(), H = S.sh(), u = S.u(), k = G.k;
    const { sc, kc, pitch, lo, hi, rowsMax, colsMax } = boardGrid();
    // Los renglones ya vienen armados (`prepareBoards`); si falta alguno,
    // porque la pantalla cambió de tamaño justo antes, se arma acá.
    const want = Math.min(b.who.length, rowsMax * colsMax);
    const chips = prepared.get(b.station) ?? [];
    prepared.delete(b.station);
    while (chips.length < want) chips.push(boardChip(b.who[chips.length] as number, sc));
    const colW = Math.max(0, ...chips.map((c) => c.width)) + 8 * u;
    const cols = clamp(Math.ceil(chips.length / rowsMax), 1, Math.max(1, Math.floor((W - 20 * u) / colW)));
    // Si no entran todos, el último renglón es "+N".
    const cap = rowsMax * cols;
    const shown = b.who.length <= cap ? b.who.length : cap - 1;
    for (const c of chips.splice(shown)) c.destroy({ children: true });
    const plus = shown < b.who.length ? plusChip(b.who.length - shown, sc) : null;
    if (plus) {
      plus.visible = false;
      nameLayer.addChild(plus);
    }
    const count = shown + (plus ? 1 : 0);
    const rows = Math.ceil(count / cols);
    const bw = cols * colW - 8 * u, bh = (rows - 1) * pitch + 25 * kc;

    // Lo que no hay que tapar, en la pantalla del encuadre al que va la cámara.
    const pose = cam.snapshot();
    const toT = (x: number, y: number): { x: number; y: number } => ({ x: W / 2 + (x - pose.tx) * pose.tz, y: H / 2 + (y - pose.ty) * pose.tz });
    const area = (x0: number, y0: number, x1: number, y1: number): Box => {
      const a = toT(x0, y0), c = toT(x1, y1);
      return { x0: Math.min(a.x, c.x), y0: Math.min(a.y, c.y), x1: Math.max(a.x, c.x), y1: Math.max(a.y, c.y) };
    };
    const sp = pt(b.station);
    const st = area(sp.x - 90 * k, sp.y - 70 * k, sp.x + 90 * k, sp.y + 125 * k);
    const obst: { r: Box; w: number }[] = [
      { r: st, w: 1.5 },
      // La bandera, el rótulo y el "−N".
      { r: area(sp.x - 180 * k, sp.y - 185 * k, sp.x + 35 * k, sp.y - 40 * k), w: 1 },
      // Los contadores de arriba a la izquierda.
      { r: { x0: 0, y0: S.top(), x1: 200 * k, y1: S.top() + 140 * k }, w: 2 },
    ];
    // Las cabinas que siguen con gente; las que se vaciaron se van cable abajo.
    for (let cab = 0; cab < C; cab++) {
      const p = cabPoint(cab, b.tOff);
      if (p.alpha > 0 && P.aboard(cab, b.tOff).length) obst.push({ r: area(p.x - G.cw / 2 - 6 * k, p.y - 44 * k, p.x + G.cw / 2 + 8 * k, p.y + 24 * k + G.ch + 8 * k), w: 3 });
    }
    const mid = { x: (st.x0 + st.x1) / 2, y: (st.y0 + st.y1) / 2 };
    const cands = [
      { x: st.x1 + 16 * u, y: mid.y - bh / 2 },
      { x: st.x1 - bw * 0.2, y: st.y1 + 12 * u },
      { x: W - bw - 10 * u, y: lo },
      { x: W - bw - 10 * u, y: hi - bh },
      { x: st.x0 - 16 * u - bw, y: mid.y - bh / 2 },
      { x: (W - bw) / 2, y: lo },
    ];
    let best = { x: 0, y: 0 }, bestS = Infinity;
    for (const c0 of cands) {
      const c = { x: clamp(c0.x, 10 * u, Math.max(10 * u, W - bw - 10 * u)), y: clamp(c0.y, lo, Math.max(lo, hi - bh)) };
      const r = { x0: c.x, y0: c.y, x1: c.x + bw, y1: c.y + bh };
      let s = 0.04 * bh * Math.hypot(c.x + bw / 2 - mid.x, c.y + bh / 2 - mid.y);
      for (const o of obst) s += o.w * overlap(r, o.r);
      if (s < bestS - 1) {
        bestS = s;
        best = c;
      }
    }
    const slots = Array.from({ length: count }, (_, i) => ({ x: best.x + Math.floor(i / rows) * colW, y: best.y + (i % rows) * pitch + 11 * kc }));
    return { key: String(b.station), chips, plus, slots, sc, box: { x0: best.x, y0: best.y, x1: best.x + bw, y1: best.y + bh } };
  }

  function dropBoard(): void {
    if (!boardView) return;
    for (const c of boardView.chips) c.destroy({ children: true });
    boardView.plus?.destroy({ children: true });
    boardView = null;
  }

  /**
   * El andén de la parada en curso. Cada uno sale por la ventana de su cabina
   * con su cara, vuela a su renglón achicándose hasta el tamaño de la cara del
   * chip, y ahí aparece su nombre. Las caras salen de a una, en el orden del
   * andén (los co-ganadores primero), y el andén se va todo junto.
   */
  function drawBoard(b: Board | null): void {
    flyBack.clear();
    flyFrame.clear();
    if (!b) {
      dropBoard();
      for (const f of flyFaces) f.visible = false;
      return;
    }
    if (!boardView || boardView.key !== String(b.station)) {
      dropBoard();
      boardView = makeBoard(b);
    }
    const v = boardView;
    const W = S.sw(), H = S.sh(), u = S.u(), k = G.k;
    const kc = u * v.sc * CHIP_SCALE;
    const shown = v.chips.length;
    const spread = Math.min(0.45, 0.07 * shown);
    // Es parte de lo que se ve iluminado: titila con la luz y se apaga con ella.
    const fade = clamp((b.tEnd - tAll) / 0.3, 0, 1) * P.luzAt(tAll);
    const z = zoomNow();
    while (flyFaces.length < shown) {
      const f = new Sprite(Texture.EMPTY);
      f.visible = false;
      flyBox.addChild(f);
      flyFaces.push(f);
    }
    let last = b.tOff;
    for (let i = 0; i < flyFaces.length; i++) {
      const f = flyFaces[i] as Sprite;
      if (i >= shown) {
        f.visible = false;
        continue;
      }
      const idx = b.who[i] as number;
      const t0 = b.tOff + (shown > 1 ? (i / (shown - 1)) * spread : 0);
      last = Math.max(last, t0 + FLY);
      const q = (tAll - t0) / FLY;
      const chip = v.chips[i] as Container;
      const slot = v.slots[i] as { x: number; y: number };
      chip.position.set(slot.x, slot.y);
      if (q >= 1) {
        const since = tAll - t0 - FLY;
        f.visible = false;
        chip.visible = true;
        chip.alpha = fade * clamp(since / 0.1, 0, 1);
        chip.scale.set(1 + 0.22 * Math.exp(-since * 14));
        continue;
      }
      chip.visible = false;
      if (q < 0) {
        f.visible = false;
        continue;
      }
      const w0 = pt(b.at, P.slotAt(cabinOf.get(idx) ?? 0, t0) * G.gap);
      const a = cam.toScreen(w0.x, w0.y + 24 * k + G.ch * 0.5, W, H);
      const e = ease.inOutCubic(q);
      const tx = slot.x + 13 * kc, ty = slot.y;
      const x = a.x + (tx - a.x) * e, y = a.y + (ty - a.y) * e - Math.sin(q * Math.PI) * 60 * u;
      // Se agranda en el aire, para que la cara se vea mientras vuela.
      const s = (30 * k * z + (16 * kc - 30 * k * z) * e) * (1 + 0.7 * Math.sin(q * Math.PI));
      const tex = S.face(names[idx] ?? "");
      if (f.texture !== tex) f.texture = tex;
      f.visible = true;
      f.alpha = fade;
      f.width = f.height = s;
      f.position.set(x - s / 2, y - s / 2);
      flyBack.rect(x - s / 2 + 3 * u, y - s / 2 + 3 * u, s, s).fill({ color: INK, alpha: fade });
      flyFrame.rect(x - s / 2, y - s / 2, s, s).stroke({ width: 2.5 * u, color: INK, alpha: fade });
    }
    if (v.plus) {
      const since = tAll - last - 0.05;
      const slot = v.slots[shown] as { x: number; y: number };
      v.plus.position.set(slot.x, slot.y);
      v.plus.visible = since >= 0;
      v.plus.alpha = fade;
      v.plus.scale.set(1 + 0.22 * Math.exp(-Math.max(0, since) * 14));
    }
  }

  /** Los rótulos de las estaciones en pantalla (el número y el "−N"): los nombres no los tapan. */
  function stationBoxes(W: number, H: number): Box[] {
    const out: Box[] = [];
    for (const stn of stations) {
      for (const o of [stn.tag, stn.minus]) {
        // El "−N" está vacío hasta que se bajan, y lo que queda fuera de cuadro no cuenta.
        const bb = o.getBounds();
        if (bb.maxX - bb.minX > 1 && bb.maxX > 0 && bb.minX < W && bb.maxY > 0 && bb.minY < H) out.push({ x0: bb.minX, y0: bb.minY, x1: bb.maxX, y1: bb.maxY });
      }
    }
    return out;
  }

  /** Dónde quedaron los nombres de las cabinas en este cuadro: el del que salta no se les encima. */
  let soloPlaced: Box[] = [];

  /**
   * Los nombres de las cabinas que llevan a una sola persona. Cada uno prueba
   * los costados de su cabina (en vertical primero a la izquierda y después a
   * la derecha; en horizontal, abajo) y se queda en el primero donde entra
   * entero sin tapar otra cabina ni otro nombre. Mientras siga entrando no se
   * cambia de costado, para que no salte de un cuadro al otro. El de una
   * cabina que salió de cuadro no va: pegado al borde, engañaba.
   */
  /**
   * Qué dicen los rótulos de cada cabina: el nombre del grupo, mientras la
   * cabina lleva a varios; el nombre de la que queda sola; y, al final, el
   * nombre de cada uno de los dos que llegan juntos (cada uno con su rótulo,
   * porque en uno solo se cortaban).
   */
  function etiquetas(cab: number, who: number[]): string[] {
    if (who.length === 0) return [];
    if (who.length === 1) return [names[who[0] as number] ?? ""];
    if (cab === winnerCab && who.length === 2 && tAll > T_RUN) {
      return [names[who[0] as number] ?? "", names[who[1] as number] ?? ""];
    }
    return [GRUPOS[P.groupOfCab[cab] ?? 0]?.nombre ?? ""];
  }

  function placeSoloTags(few: boolean): void {
    const W = S.sw(), H = S.sh(), u = S.u();
    const lo = S.top() + 6 * u, hi = H - S.bottom() - 6 * u;
    const seen = new Set<number>();
    // El andén, si está, cuenta como un nombre ya puesto: no se le encima nadie.
    const placed: Box[] = boardView ? [boardView.box] : [];
    // Los rótulos de las estaciones también tapan, la de la parada y la siguiente.
    placed.push(...stationBoxes(W, H));
    if (few && tAll < T_CROWN) {
      // Más grandes cuando quedan dos: es el momento que decide.
      const quedan = P.leftAt(tAll);
      // En vertical, la base legible (19 px): agrandados se salían de la pantalla.
      // Con tres a cinco, en escritorio también la base: con 1,3 no entraban a
      // los costados y caían sobre la cabina de al lado.
      const sc = G.vertical ? 1 : quedan <= 2 ? 1.6 : 1;
      // Las cabinas vacías no cuentan: se están yendo cable abajo.
      const boxes = new Map<number, Box>();
      for (let cab = 0; cab < C; cab++) {
        const r = P.aboard(cab, tAll).length ? cabBox(cab, tAll) : null;
        if (r) boxes.set(cab, r);
      }
      // Cada cabina lleva uno o dos rótulos (`etiquetas`): la clave es la cabina y su rótulo.
      for (let key = 0; key < 2 * C; key++) {
        const cab = key >> 1;
        const who = P.aboard(cab, tAll);
        const box = boxes.get(cab);
        const txt = etiquetas(cab, who)[key & 1];
        if (txt === undefined || !box || cabPoint(cab, tAll).alpha < 1) continue;
        const cy = (box.y0 + box.y1) / 2;
        // Una cabina fuera de la pantalla no lleva nombre. Una que queda detrás del
        // cartel del relator o de la barra de arriba sí: su nombre va al borde que
        // le quede libre (si no, en celular horizontal la finalista se quedaba sin nombre).
        if ((box.x0 + box.x1) / 2 < 0 || (box.x0 + box.x1) / 2 > W || cy < 0 || cy > H) continue;
        // En vertical, el rótulo de un grupo va un poco más chico: son diez en una
        // columna, y a escala normal solo dos entraban sin pisarse. El nombre de una
        // persona va a escala normal.
        const porNombre = who.length === 1 || (cab === winnerCab && who.length === 2 && tAll > T_RUN);
        const scEtiqueta = porNombre || !G.vertical ? sc : sc * 0.8;
        let e = soloTags.get(key);
        if (!e || e.txt !== txt || e.sc !== scEtiqueta) {
          e?.chip.destroy({ children: true });
          e = { txt, sc: scEtiqueta, chip: S.chip(txt, scEtiqueta), side: -1 };
          nameLayer.addChild(e.chip);
          soloTags.set(key, e);
        }
        seen.add(key);
        // La caja es del chip de verdad: con 25 * u * sc, que no lleva CHIP_SCALE, era el 62 % del alto.
        const w = e.chip.width, h = e.chip.height, gap = 8 * u;
        const at = (side: number): Box => {
          const x0 = side === 0 ? box.x0 + (box.x1 - box.x0) * 0.1 : side === 1 ? box.x0 - gap - w : side === 2 ? box.x1 + gap : box.x0;
          // Debajo y encima de la cabina el nombre se corre hasta el borde antes de
          // probar si entra: sin eso ningún costado entraba y caía sobre su propia cabina.
          const x = side === 0 || side === 3 ? clamp(x0, 8 * u, Math.max(8 * u, W - w - 8 * u)) : x0;
          // Encima, pegado al techo de la cabina: el colgante se alarga con el zoom,
          // y con 64 * k * zoom el nombre flotaba noventa píxeles arriba de su cabina.
          const y = side === 0 ? box.y1 + gap + h / 2 : side === 3 ? box.y0 - gap - h / 2 : cy;
          return { x0: x, y0: y - h / 2, x1: x + w, y1: y + h / 2 };
        };
        const fits = (r: Box, m = 0): boolean =>
          r.x0 >= 8 * u + m && r.x1 <= W - 8 * u - m && r.y0 >= lo + m && r.y1 <= hi - m &&
          !placed.some((o) => overlap(r, o) > 0) && ![...boxes].some(([c2, o]) => c2 !== cab && overlap(r, o) > 0);
        const order = G.vertical ? [1, 2, 0, 3] : [0, 2, 1, 3];
        // Si ningún costado entra, el que menos tapa: la cabina pesa tres veces
        // más que un nombre. No el primero, que a veces caía encima de otra cabina.
        const tapa = (sd: number): number => {
          const r0 = at(sd);
          const x = clamp(r0.x0, 8 * u, W - w - 8 * u), y = clamp((r0.y0 + r0.y1) / 2, lo + h / 2, hi - h / 2);
          const r = { x0: x, y0: y - h / 2, x1: x + w, y1: y + h / 2 };
          let c2 = 3 * overlap(r, box);
          for (const o of placed) c2 += overlap(r, o);
          for (const [c3, o] of boxes) if (c3 !== cab) c2 += overlap(r, o);
          return c2;
        };
        // Vuelve a un costado mejor solo si entra con holgura: así no salta de
        // un costado al otro cuando la cabina pasa justo por el borde.
        const mejor = order.find((s) => fits(at(s), 18 * u));
        const side = mejor !== undefined && (e.side < 0 || order.indexOf(mejor) < order.indexOf(e.side))
          ? mejor
          : e.side >= 0 && fits(at(e.side)) ? e.side : order.find((s) => fits(at(s))) ?? order.reduce((a, b) => (tapa(b) < tapa(a) ? b : a));
        // Un rótulo de grupo que no encuentra un costado libre no se pisa con
        // otro: se oculta (la cabina ya lleva su color y su cuenta). Los nombres
        // de las personas siempre se ven.
        if (!porNombre && !fits(at(side))) {
          e.chip.visible = false;
          continue;
        }
        e.side = side;
        const r = at(side);
        const x = clamp(r.x0, 8 * u, W - w - 8 * u), y = clamp((r.y0 + r.y1) / 2, lo + h / 2, hi - h / 2);
        e.chip.position.set(x, y);
        e.chip.visible = true;
        placed.push({ x0: x, y0: y - h / 2, x1: x + w, y1: y + h / 2 });
      }
    }
    for (const [key, e] of soloTags) if (!seen.has(key)) e.chip.visible = false;
    soloPlaced = placed;
  }

  /* ============================================================== cámara */
  /**
   * En celular acostado (pantalla baja) la última estación no se acerca tanto:
   * con más zoom, la cara del que se baja quedaba debajo de la barra de arriba.
   */
  const zoomBajo = (z: number, tope: number): number => (!G.vertical && S.sh() < 500 ? Math.min(z, tope) : z);

  function direct(): void {
    const k = G.k;
    const head = P.headAt(tAll);
    const lower = (p: { x: number; y: number }): { x: number; y: number } => ({ x: p.x, y: p.y + 60 * k });
    const ult = stops.find((s) => s.last);
    const inStop = stops.find((s) => !s.last && tAll >= s.t0 - 0.2 && tAll <= s.t1 + 0.1);
    const wind = P.windAt(tAll) - 0.2;
    const rot = wind > 0 ? Math.sin(tAll * 2.6) * 0.035 * wind : 0;
    if (wind > 0.3) cam.shake(1.2 * k * wind);
    if (tAll < T_BOARD) {
      const b = pt(0);
      cam.lookAt(b.x + 40 * k, b.y + 20 * k, 1.55 - 0.3 * (tAll / T_BOARD), 3);
    } else if (tAll >= T_CROWN) {
      const top = pt(P.TOP);
      cam.lookAt(top.x, top.y + 20 * k, 1.1, 1.5);
    } else if (tAll >= T_DOCK) {
      const top = pt(P.TOP);
      cam.lookAt(top.x, top.y + 40 * k, 1.5, 3);
    } else if (tAll >= T_RUN) {
      const p = cabPoint(winnerCab, tAll);
      cam.lookAt(p.x + 60 * k, p.y + 40 * k, 1.35, 3);
    } else if (ult && tAll >= ult.t0 - 0.3 && tAll <= ult.t1) {
      if (puerta && tAll >= P.puertaA - 0.25 && tAll <= P.puertaB + 0.35) {
        const p = cabPoint(winnerCab, tAll);
        cam.lookAt(p.x, p.y + 60 * k, zoomBajo(2.1, 1.6), 4);
      } else if (mordaza && tAll <= P.mD + 0.2) {
        // Quieta sobre el tramo que resbala, desde la cabina en su lugar hasta
        // donde la agarra la mordaza, y desde que llega a la estación. Antes
        // seguía a la cabina de cerca: la cabina quedaba quieta en la pantalla,
        // lo que se movía era el fondo, y el resbalón no se veía.
        const h = P.headAt(P.mA), slot = P.slotAt(slipCab, P.mA);
        const a = pt(h, slot * G.gap), b = pt(h, (slot + SLIP) * G.gap);
        cam.lookAt((a.x + b.x) / 2, (a.y + b.y) / 2 + 60 * k, 1.8, 3);
      } else {
        const a = cabPoint(winnerCab, tAll), b = cabPoint(P.loserCab, tAll);
        cam.lookAt((a.x + b.x) / 2, (a.y + b.y) / 2 + 60 * k, zoomBajo(1.6, 1.3), 3);
      }
    } else if (apagon && tAll >= P.corte - 0.25 && tAll <= P.vuelve + 0.45) {
      // Se va al convoy apenas titila la luz y se sigue metiendo en lo oscuro.
      // Llegaba a 1,55 en un segundo y medio, tan despacio que no se notaba.
      const p = lower(pt(head, G.gap * 0.8));
      const dk = clamp((tAll - P.corte) / 1.2, 0, 1);
      cam.lookAt(p.x, p.y, 1.25 + 0.4 * ease.outCubic(dk), 2.4);
    } else if (inStop) {
      const s = pt(inStop.station);
      cam.lookAt(s.x - 40 * k, s.y + 70 * k, 1.35, 3);
    } else {
      const ahead = (P.headAt(tAll + 0.4) - head) * 1.2;
      const p = lower(pt(head + ahead - 0.05));
      cam.lookAt(p.x, p.y, 1, 2.6, rot);
      return;
    }
    if (rot) cam.tilt(rot);
  }

  /* ============================================================== dibujo */
  function drawFlag(g: Graphics, x: number, y: number, w: number, h: number, col: number, seed: number, pennant: boolean): void {
    const wind = P.windAt(tAll);
    const len = w * (0.82 + 0.22 * wind);
    const amp = h * (0.1 + 0.34 * wind);
    const ph = tAll * (3.4 + wind * 8) + seed;
    const N = 8;
    const wave = (s: number): number => Math.sin(ph - s * 4) * amp * s;
    const pts: number[] = [];
    for (let i = 0; i <= N; i++) {
      const s = i / N;
      pts.push(x - s * len, y + (pennant ? (s * h) / 2 : 0) + wave(s));
    }
    for (let i = N; i >= 0; i--) {
      const s = i / N;
      pts.push(x - s * len, y + (pennant ? h - (s * h) / 2 : h) + wave(s) * 1.05);
    }
    g.poly(pts).fill(col).stroke({ width: 2 * G.k, color: INK });
  }

  function draw(now: number): void {
    const { k, cw, ch, gap } = G;
    const luz = P.luzAt(tAll);
    // Paralaje: la cordillera casi quieta, la ciudad a medio camino.
    far.position.set(cam.x * 0.85, cam.y * 0.85);
    cities.position.set(cam.x * 0.45, cam.y * 0.45);
    lightsA.alpha = (0.55 + 0.35 * Math.sin(now * 2)) * (0.06 + 0.94 * luz);
    lightsB.alpha = (0.55 + 0.35 * Math.sin(now * 2 + 2.2)) * (0.06 + 0.94 * luz);

    // Estaciones: la bandera, los banderines, la cuenta de los que bajaron.
    stations.forEach((stn, s) => {
      const p = pt(s);
      const top = s === NS + 1;
      const bw = (top ? 230 : s === 0 ? 210 : 160) * k;
      const y0 = p.y - 40 * k;
      stn.flag.clear();
      drawFlag(stn.flag, p.x - bw / 2 + 14 * k, y0 - 134 * k, 88 * k, 46 * k, top ? YELLOW : hexOf(LINES[(s + 2) % LINES.length] as string), s * 1.9, false);
      // La banderita de la cumbre no asoma detrás del cartel del ganador.
      stn.flag.visible = !(top && tAll >= T_CROWN);
      if (top) {
        // El rótulo CUMBRE no se mete debajo de la barra de arriba (SONIDO, Saltar):
        // en 4:3 quedaba con las últimas letras tapadas. Baja solo si hace falta.
        const ty = y0 - 34 * k;
        const sy = cam.toScreen(p.x, ty, S.sw(), S.sh()).y;
        stn.tag.position.set(p.x, sy < S.top() ? ty + (S.top() - sy) / zoomNow() : ty);
      }
      if (stn.bunting) {
        const g = stn.bunting;
        g.clear();
        const x0 = p.x - bw / 2, x1 = p.x + bw / 2;
        const sag = 28 * k;
        const fiesta = tAll > T_DOCK ? Math.exp(-(tAll - T_DOCK) * 0.6) : 0;
        const at = (q: number): { x: number; y: number } => ({ x: x0 + (x1 - x0) * q, y: y0 + 4 * k + sag * 4 * q * (1 - q) });
        for (let i = 0; i <= 20; i++) {
          const pp = at(i / 20);
          if (i === 0) g.moveTo(pp.x, pp.y);
          else g.lineTo(pp.x, pp.y);
        }
        g.stroke({ width: 2 * k, color: INK });
        for (let i = 0; i < 11; i++) {
          const pp = at((i + 0.5) / 11);
          const sw = Math.sin(tAll * (3 + P.windAt(tAll) * 6) + i * 1.3) * (0.12 + P.windAt(tAll) * 0.3 + fiesta * 0.5);
          const half = ((x1 - x0) / 11) * 0.42, len = 22 * k;
          const c = Math.cos(sw), sn = Math.sin(sw);
          const r = (px: number, py: number): number[] => [pp.x + px * c - py * sn, pp.y + px * sn + py * c];
          g.poly([...r(-half, 0), ...r(half, 0), ...r(0, len)]).fill(hexOf(LINES[i % LINES.length] as string)).stroke({ width: 2 * k, color: INK });
        }
      }
      // Los nombres de los que se bajaron van en el andén de la pantalla (`drawBoard`).
      const pl = platform.get(s);
      // Sin nadie que se baje (dos personas en total) no va un "−0".
      if (pl && pl.off > 0 && !top && s !== 0) {
        stn.minus.text = `−${pl.off}`;
        stn.minus.scale.set(ease.outBack(clamp((tAll - pl.t) / 0.4, 0, 1)));
      } else stn.minus.text = "";
    });

    // Cabinas.
    const sw = P.swingAt(tAll);
    const few = tAll > T_BOARD;
    for (let cab = 0; cab < C; cab++) {
      const cb = cabs[cab] as Cab;
      const p = cabPoint(cab, tAll);
      cb.root.visible = p.alpha > 0;
      if (!cb.root.visible) continue;
      cb.root.alpha = p.alpha;
      cb.root.position.set(p.x, p.y);
      const slot = P.slotAt(cab, tAll);
      let sacude = cab === winnerCab ? P.puertaAt(tAll) * 0.07 * Math.sin(tAll * 22) : 0;
      sacude += (P.windAt(tAll) - 0.2) * 0.12 * Math.sin(tAll * 6.3 + cab * 1.7);
      if (mordaza && cab === slipCab) {
        // Mientras resbala, la cabina se queda atrás de su mordaza y se inclina
        // cuesta arriba; al agarrarla, el tirón la manda para el otro lado.
        if (tAll > P.mA && tAll <= P.mB) sacude -= 0.26 * Math.sin((Math.PI / 2) * clamp((tAll - P.mA) / (P.mB - P.mA), 0, 1));
        if (tAll > P.mB && tAll < P.mB + 3) sacude += -0.26 * Math.exp(-(tAll - P.mB) * 9) + 0.3 * Math.exp(-(tAll - P.mB) * 2.4) * Math.sin((tAll - P.mB) * 9);
      }
      cb.hang.rotation = sw * (1 - slot * 0.06) + sacude;
      const who = P.aboard(cab, tAll);
      const empty = !(who.length || tAll < T_BOARD);
      const col = hexOf(LINES[P.groupOfCab[cab] ?? 0] as string);
      const topY = 24 * k;
      const glow = cab === winnerCab && tAll > T_DOCK ? 0.6 + 0.4 * Math.sin(tAll * 8) : 0;
      if (cb.lastKey === "" || empty !== cb.empty || glow > 0) {
        cb.empty = empty;
        cb.body.clear().roundRect(-cw / 2 + 6 * k, topY + 6 * k, cw, ch, 12 * k).fill(INK);
        if (glow > 0) cb.body.roundRect(-cw / 2, topY, cw, ch, 12 * k).stroke({ width: 16 * k, color: YELLOW, alpha: glow });
        cb.body.roundRect(-cw / 2, topY, cw, ch, 12 * k).fill(empty ? 0x77727f : col).stroke({ width: 3 * k, color: INK });
      }
      // Las caras de adentro: una grande si va sola, hasta tres chicas si no.
      const key = who.slice(0, 3).join(",");
      const wx = -cw / 2 + 8 * k, wy = topY + 10 * k, ww = cw - 16 * k, wh = ch * 0.58;
      const asoma = cab === winnerCab ? P.puertaAt(tAll) : 0;
      if (key !== cb.lastKey) {
        cb.lastKey = key || "-";
        cb.faces.forEach((f, i) => {
          const idx = who[i];
          f.visible = idx !== undefined && (who.length > 1 || i === 0);
          if (idx !== undefined) f.texture = S.face(names[idx] ?? "");
        });
      }
      const av = wh - 8 * k;
      if (who.length === 1) {
        const f = cb.faces[0] as Sprite;
        f.width = f.height = av;
        f.position.set(-av / 2 + asoma * (ww / 2 - av / 2 - 2 * k), wy + 4 * k);
      } else if (who.length > 1) {
        const small = Math.min(av, (ww - 8 * k) / 3 - 3 * k);
        cb.faces.forEach((f, i) => {
          f.width = f.height = small;
          f.position.set(wx + 4 * k + i * (small + 3 * k), wy + (wh - small) / 2);
        });
      }
      cb.count.text = who.length > 1 ? `×${who.length}` : "";
      cb.door.clear();
      if (asoma > 0) cb.door.rect(cw / 2 - cw * 0.26 * asoma - 2 * k, topY + 6 * k, cw * 0.26 * asoma, ch - 12 * k).fill(INK);
      if (luz < 1) {
        // A oscuras la cabina se apaga hasta la mitad y le queda la luz de
        // emergencia, roja, que parpadea. Las caras se siguen viendo: en lo
        // negro lo único que queda es el convoy colgando, con su gente. Antes
        // la ventana se iba al negro y las caras desaparecían.
        const dim = 1 - luz;
        cb.door.roundRect(-cw / 2, topY, cw, ch, 12 * k).fill({ color: 0x04050c, alpha: dim * 0.42 })
          .rect(wx, wy, ww, wh).fill({ color: 0x04050c, alpha: dim * 0.3 });
        if (Math.sin(tAll * 9 + cab * 1.9) > -0.3) {
          const lx = cw / 2 - 13 * k, ly = topY + 9 * k;
          cb.door.circle(lx, ly, 13 * k).fill({ color: 0xff3b30, alpha: dim * 0.3 }).circle(lx, ly, 4.5 * k).fill({ color: 0xff6a5f, alpha: dim });
        }
      }
      cb.doors.clear();
      if (cab === winnerCab && tAll > T_DOCK) {
        const o = ease.outCubic(clamp((tAll - T_DOCK - 0.2) / 0.5, 0, 1));
        cb.doors.rect(wx, wy, (ww / 2) * (1 - o), wh).fill(col).rect(wx + ww / 2 + (ww / 2) * o, wy, (ww / 2) * (1 - o), wh).fill(col);
      }
      cb.flag.clear().moveTo(-cw / 2 + 14 * k, topY).lineTo(-cw / 2 + 14 * k, topY - 38 * k).stroke({ width: 2.5 * k, color: INK });
      drawFlag(cb.flag, -cw / 2 + 14 * k, topY - 37 * k, 48 * k, 26 * k, 0xf6efe2, cab * 2.3, true);
      cb.flag.alpha = 0.3 + 0.7 * luz;
      cb.ring.clear();
      // La cabina que resbala, en rojo y titilando hasta que la mordaza la agarra.
      if (mordaza && cab === slipCab && tAll > P.mA && tAll < P.mB + 0.25) {
        const on = tAll < P.mB ? (Math.sin((tAll - P.mA) * 30) > -0.2 ? 1 : 0.35) : clamp(1 - (tAll - P.mB) / 0.25, 0, 1);
        const pad = 8 * k;
        cb.ring.roundRect(-cw / 2 - pad, topY - pad, cw + 2 * pad, ch + 2 * pad, 16 * k).stroke({ width: 10 * k, color: INK, alpha: on })
          .roundRect(-cw / 2 - pad, topY - pad, cw + 2 * pad, ch + 2 * pad, 16 * k).stroke({ width: 5.5 * k, color: 0xff3b30, alpha: on });
      }
    }

    // Pasar lista: en el embarque y el primer tramo, los nombres de a tandas
    // encima de su cabina, para que cada uno sepa en cuál va. Los de una misma
    // cabina se apilan.
    const firstStop = stops[0]?.t0 ?? T_RUN;
    const roll = S.batch(n, tAll, 0.3, Math.min(T_BOARD + 1.8, firstStop - 0.3));
    S.tags(names, roll, (i) => {
      const cab = cabinOf.get(i);
      if (cab === undefined) return null;
      const p = cabPoint(cab, tAll);
      if (p.alpha < 0.5) return null;
      return cam.toScreen(p.x, p.y - 22 * G.k, S.sw(), S.sh());
    }, stations.map((s) => s.tag.getBounds()));

    // El andén de la parada, en la pantalla, y lo que se mueve suelto en el
    // mundo: los que saltan sin renglón, el embarque, las chispas.
    fx.clear();
    prepareBoards(2);
    const brd = boardAt(tAll);
    drawBoard(brd);
    // Cuando se bajan más de los que entran en el andén (doscientas personas),
    // los que no tienen renglón saltan como antes, de color, al piso de la estación.
    if (brd && boardView) {
      const resto = brd.who.slice(boardView.chips.length);
      const stp = Math.max(1, Math.ceil(resto.length / 40));
      for (let j = 0; j < resto.length; j += stp) {
        const idx = resto[j] as number;
        const t0 = brd.tOff + 0.05 + (j / resto.length) * 0.35;
        const pr = (tAll - t0) / 0.55;
        if (pr < 0 || pr > 1.6) continue;
        const q = clamp(pr, 0, 1);
        const from = pt(brd.at, P.slotAt(cabinOf.get(idx) ?? 0, t0) * gap);
        const sp = pt(brd.station);
        const bw = 160 * k;
        const tx = sp.x + (seedOf(j) * 2 - 1) * (bw / 2 - 12 * k), ty = sp.y - 40 * k + 160 * k - 26 * k;
        const x = from.x + (tx - from.x) * q;
        const y = from.y + 60 * k + (ty - from.y - 60 * k) * q - Math.sin(q * Math.PI) * 80 * k;
        const a = pr > 1 ? clamp(1.6 - pr, 0, 1) / 0.6 : 1;
        fx.rect(x - 7 * k, y - 7 * k, 14 * k, 14 * k).fill({ color: INK, alpha: a }).rect(x - 5 * k, y - 5 * k, 10 * k, 10 * k).fill({ color: S.color(idx), alpha: a });
      }
    }
    if (tAll < T_BOARD) {
      const b = pt(0);
      for (let cab = 0; cab < C; cab++) {
        // Cada cabina sube a los de su grupo, con sus propias cuentas.
        const size = P.pax[cab]?.length ?? 0;
        const show = Math.min(size, Math.ceil(40 / C));
        for (let i = 0; i < show; i++) {
          const slot = Math.floor((i * size) / show);
          const tb = 0.25 + ((slot + 1) / Math.max(1, size)) * (T_BOARD - 0.55);
          const q = (tAll - (tb - 0.35)) / 0.35;
          if (q < 0 || q > 1) continue;
          const to = pt(P.headAt(tAll), P.slotAt(cab, tAll) * gap);
          const fx0 = b.x - 105 * k + 20 * k + (i % 5) * 16 * k, fy = b.y - 40 * k + 160 * k - 30 * k;
          const x = fx0 + (to.x - fx0) * q;
          const y = fy + (to.y + 60 * k - fy) * q - Math.sin(q * Math.PI) * 90 * k;
          fx.rect(x - 7 * k, y - 7 * k, 14 * k, 14 * k).fill(INK).rect(x - 5 * k, y - 5 * k, 10 * k, 10 * k).fill(S.color(P.pax[cab]?.[slot] ?? 0));
        }
      }
    }
    // La mordaza. Mientras patina, vetas de velocidad detrás de la cabina,
    // cuesta arriba, más largas cuanto más rápido resbala, y chispitas en la
    // mordaza; al agarrarla, un fogonazo y la lluvia de chispas. Antes había
    // solo la lluvia, de cuadraditos de 5 px durante medio segundo.
    if (mordaza && tAll > P.mA && tAll < P.mB + 0.8) {
      const p = cabPoint(slipCab, tAll);
      if (tAll < P.mB) {
        const v = clamp((P.slipAt(tAll + 0.02) - P.slipAt(tAll)) / 0.02, 0, 4);
        const len = v * 45 * k;
        const nx = -G.dir.y, ny = G.dir.x;
        const bx = p.x, by = p.y + 24 * k + ch / 2;
        for (let j = 0; j < 4; j++) {
          const off = (j - 1.5) * 17 * k, a0 = cw / 2 + 8 * k + (j % 2) * 10 * k;
          const sx = bx + G.dir.x * a0 + nx * off, sy = by + G.dir.y * a0 + ny * off;
          fx.moveTo(sx, sy).lineTo(sx + G.dir.x * len, sy + G.dir.y * len);
        }
        if (len > 1) fx.stroke({ width: 3.5 * k, color: CREAM, alpha: 0.8, cap: "round" });
        for (let j = 0; j < 6; j++) {
          const ph = (tAll * 6 + j / 6) % 1;
          const ang = Math.PI * (1.05 + hash(j, 3) * 0.8);
          const d = ph * 42 * k;
          fx.rect(p.x + Math.cos(ang) * d - 2 * k, p.y + Math.sin(ang) * d + ph * ph * 50 * k - 2 * k, 4 * k, 4 * k).fill({ color: YELLOW, alpha: 1 - ph });
        }
      } else {
        const since = tAll - P.mB;
        const f = clamp(since / 0.3, 0, 1);
        if (f < 1) {
          fx.circle(p.x, p.y, (12 + 80 * f) * k).stroke({ width: 7 * k * (1 - f), color: YELLOW, alpha: 1 - f })
            .circle(p.x, p.y, 16 * k * (1 - f)).fill({ color: 0xfff3c4, alpha: 1 - f });
        }
        const fade = clamp(1 - since / 0.8, 0, 1);
        for (let j = 0; j < 26; j++) {
          const s = j < chispas.length ? chispas[j] as { a: number; v: number } : { a: -Math.PI * (0.05 + hash(j, 11) * 0.9), v: 0.6 + hash(j, 12) * 0.9 };
          const d = s.v * since * 300 * k;
          fx.rect(p.x + Math.cos(s.a) * d - 3 * k, p.y + Math.sin(s.a) * d + since * since * 900 * k - 3 * k, 6 * k, 6 * k).fill({ color: s.v > 1.1 ? 0xfff3c4 : YELLOW, alpha: fade });
        }
      }
    }

    // Los rótulos de las cabinas (su grupo, o los dos de la última), en la
    // pantalla. El andén ya se dibujó arriba (`drawBoard`).
    placeSoloTags(few);

    // El viento y la oscuridad, en la pantalla.
    wind.clear();
    const wv = P.windAt(tAll) - 0.2;
    if (wv > 0.02) {
      const W = S.sw(), H = S.sh();
      for (const v of vetas) {
        const spn = W * 1.4;
        const x = W * 1.2 - ((((tAll * v.v * W * 0.9 + v.off * spn) % spn) + spn) % spn);
        const y = H * (0.08 + v.y * 0.84);
        wind.moveTo(x, y).lineTo(x + v.len * W, y + Math.sin(tAll * 3 + v.off * 9) * 6 * k);
      }
      wind.stroke({ width: 2.5 * k, color: CREAM, alpha: Math.min(0.55, wv * 0.6), cap: "round" });
    }
    blackout.alpha = (1 - luz) * 0.86;
    vignette.alpha = 1 - luz;

    // Los contadores.
    const m = tAll < T_BOARD ? P.pax.reduce((a, _, cab) => a + P.aboard(cab, tAll).length, 0) : P.leftAt(tAll);
    hudLabel.text = tAll < T_BOARD ? t("cTelAboard") : t("cTelLeft");
    hudNum.text = String(m);
    const at = Math.min(NS, Math.floor(P.headAt(tAll) + 0.02));
    hudStation.text = tAll >= T_BOARD && tAll < T_RUN ? T[lang].cTelOf(Math.max(1, at), NS) : "";
    if (tAll >= T_CROWN) crown.at(tAll - T_CROWN);
  }

  cam.cut(pt(0).x + 40 * G.k, pt(0).y + 20 * G.k, 1.55);
  S.run((dt, now) => {
    tAll += dt;
    events();
    sounds();
    direct();
    cam.update(dt);
    cam.apply(S.scene, S.sw(), S.sh(), now);
    draw(now);
    if (tAll >= T_CROWN) tHold += dt * paceFactor();
    if (tHold >= WINNER_HOLD) S.cleanup();
  });
}
