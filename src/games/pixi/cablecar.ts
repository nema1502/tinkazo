import { Container, Graphics, Sprite, Text, Texture } from "pixi.js";
import { T, getLang, t } from "../../i18n";
import { paceFactor, setGameLength, type Beacon } from "../../state";
import { beep, beepFor, fanfare, note } from "../../sound";
import { WINNER_HOLD, clamp, ease, winnersLabel } from "../overlay";
import { CREAM, INK, MONO, YELLOW, hash, mountPixi, seeded, type PixiStage } from "./stage";
import { LINES, T_BOARD, T_CROWN, T_DOCK, T_RUN, planCableCar } from "./cablecar-plan";

/**
 * El Teleférico, en PixiJS, con el director de cámara.
 *
 * La misma historia que `cablecar.ts` (el plan es una copia exacta, en
 * `cablecar-plan.ts`): un convoy sube por el cable, en cada estación se baja
 * la mitad, y cada arco tiene su giro: la puerta, la mordaza, el apagón o la
 * ráfaga. Lo nuevo es cómo se mira. La cámara arranca en el andén de la base,
 * sigue al convoy, se acerca a cada andén cuando se baja gente, se mete en la
 * cabina del giro, se hamaca con el viento, se acerca despacio en el apagón, y
 * sigue a la cabina sola hasta la cumbre.
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
  /** La última parada, y quién se baja en ella: el segundo del orden de bajada. */
  const lastStop = stops.find((s) => s.last);
  const loserIdx = n >= 2 ? (rank[1] ?? -1) : -1;
  /** Lo que tarda el salto de la cabina al andén. */
  const HOP = 0.55;
  const lang = getLang();
  S.mark("arco", story.arc);
  const deco = seeded(parseInt(beacon.randomness.slice(24, 32), 16));
  const seedOf = (k: number): number => {
    const v = parseInt(beacon.randomness.slice((k * 2) % 56, ((k * 2) % 56) + 8), 16);
    return (v % 1000) / 1000;
  };

  /**
   * ¿Quién se baja? En la última parada, cuando el arco no tiene ahí su giro
   * (la puerta o la mordaza), un aro salta de una cabina a la otra en cada
   * latido, cada vez más lento, como una moneda en el aire, y se apaga sobre
   * la que pierde justo cuando se abre su puerta. Antes eran dos cabinas
   * quietas sin nada que mirar en el momento que decide. Se arma hacia atrás
   * desde esa hora, y cuántos saltos hay sale de la ronda: de qué cabina
   * arranca no dice nada de cuál pierde. Son horas fijas, sin azar del juego.
   */
  const aro: number[] = [];
  if (lastStop && !puerta && !mordaza && P.loserCab !== winnerCab) {
    const desde = lastStop.t0 + 0.1;
    const W = lastStop.tOff - desde;
    const m = Math.max(2, Math.floor(W / 0.25)) + (seedOf(11) < 0.5 ? 0 : 1);
    // El primero el más corto y el último el más largo.
    const pesos = Array.from({ length: m }, (_, k) => Math.pow(0.72, m - 1 - k));
    const suma = pesos.reduce((a, b) => a + b, 0);
    let at = desde;
    for (const w of pesos) {
      aro.push(at);
      at += (w / suma) * W;
    }
  }
  /** En qué cabina está el aro a la hora `x`, desde cuándo, y qué salto es. */
  function aroAt(x: number): { cab: number; since: number; i: number } | null {
    if (!lastStop || !aro.length || x < (aro[0] as number) || x >= lastStop.tOff + 0.3) return null;
    let i = 0;
    while (i + 1 < aro.length && x >= (aro[i + 1] as number)) i++;
    // El último salto cae siempre en la que pierde: se cuenta desde el final.
    const cab = (aro.length - 1 - i) % 2 === 0 ? P.loserCab : winnerCab;
    return { cab, since: x - (aro[i] as number), i };
  }

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
  interface Station { root: Container; flag: Graphics; bunting: Graphics | null; tag: Container; minus: Text; chips: Container }
  let far!: Container;
  let lightsA!: Graphics;
  let lightsB!: Graphics;
  let cities!: Container;
  let stations: Station[] = [];
  let cabs: Cab[] = [];
  let fx!: Graphics;
  let dark!: Graphics;
  let wind!: Graphics;
  let jumper: Container | null = null;
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
      const chips = new Container();
      root.addChild(tag, minus, chips);
      world.addChild(root);
      stations.push({ root, flag, bunting, tag, minus, chips });
    }

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

    // El que se baja en la última parada, con su cara y su nombre: era un
    // cuadradito de 14 px, y es la bajada que decide el sorteo.
    jumper = null;
    if (lastStop && loserIdx >= 0) {
      const nm = names[loserIdx] ?? "";
      const side = 44 * k;
      const jc = new Container();
      const sp = new Sprite(S.face(nm));
      sp.width = sp.height = side;
      sp.position.set(-side / 2, -side);
      // El nombre al costado: abajo chocaba con el de la cabina que sigue.
      const tag = S.chip(nm, 1.1);
      tag.position.set(side / 2 + 8 * k, -side / 2);
      jc.addChild(new Graphics().rect(-side / 2 + 4 * k, -side + 4 * k, side, side).fill(INK), sp, new Graphics().rect(-side / 2, -side, side, side).stroke({ width: 3 * k, color: INK }), tag);
      jc.visible = false;
      world.addChild(jc);
      jumper = jc;
    }

    // La interfaz: oscuridad del apagón, vetas del viento y los contadores.
    dark = new Graphics().rect(0, 0, sw, sh).fill(0x03030a);
    dark.alpha = 0;
    wind = new Graphics();
    S.hud.addChild(dark, wind);
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
  let lastHum = -1, boardTicks = 0, beat = -1, beatDark = -1, lastSaid = -99;
  const fired = new Set<string>();
  const platform = new Map<number, { off: number; who: number[]; t: number }>();
  const hops: { cab: number; station: number; t0: number; dx: number; hue: number }[] = [];
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
        if (s.last) sayNow(t("cTelLast"), 0.8);
        if (!silent) cam.punch(0.03);
      });
      once(`off${s.station}`, tAll >= s.tOff, () => {
        const who = rank.slice(left[s.round + 1] as number, left[s.round] as number);
        // Los co-ganadores que se bajan acá van primero en el andén, y con
        // premio se los nombra aunque se bajen muchos. Hasta el 7 de octubre
        // de 2026 el tercer premio se bajaba con "se baja uno, quedan 2".
        const prem = who.filter((i) => winners.indexOf(i) > 0);
        const resto = who.filter((i) => winners.indexOf(i) <= 0);
        // En la última parada el nombre va pegado a la cara que salta.
        const onPlatform = s.last && jumper ? [] : (who.length <= 3 ? [...prem, ...resto] : prem).slice(0, 3);
        platform.set(s.station, { off: who.length, who: onPlatform, t: s.tOff });
        const stp = Math.max(1, Math.ceil(who.length / 40));
        for (let i = 0; i < who.length && !(s.last && jumper); i += stp) {
          const idx = who[i] as number;
          hops.push({ cab: cabinOf.get(idx) ?? 0, station: s.station, t0: s.tOff + (i / who.length) * 0.35, dx: seedOf(i) * 2 - 1, hue: S.color(idx) });
        }
        if (s.last) {
          // Con varios premios, el último que se baja también ganó, y el relator
          // decía "¡Hasta acá llegó X!" de un ganador.
          const idx = who[0] as number;
          sayNow((winners.includes(idx) ? T[lang].cTelPrize : T[lang].cTelOff)(names[idx] ?? ""), 0.9);
        } else if (prem.length) {
          sayNow(T[lang].cPrizeOut(prem.slice(0, 3).map((i) => names[i] ?? "")), 0.5 + 0.3 * (s.round / Math.max(1, P.R)));
        } else sayNow(T[lang].cTelStop(s.station, who.length, left[s.round + 1] as number), 0.5 + 0.3 * (s.round / Math.max(1, P.R)));
        // En la última, el golpe suena cuando la cara toca el andén.
        if (!silent && !(s.last && jumper)) {
          const blips = Math.min(6, who.length);
          for (let i = 0; i < blips; i++) setTimeout(() => beep(note(15 - i), 0.07, "sine", 0.032), i * 70);
        }
      });
      if (s.last && jumper) {
        once("landing", tAll >= s.tOff + HOP, () => {
          if (silent) return;
          beep(note(3), 0.1, "square", 0.06);
          beep(note(0), 0.25, "sine", 0.07);
          beep(note(5), 0.12, "triangle", 0.04);
          cam.punch(0.04);
        });
      }
      once(`detach${s.station}`, tAll >= s.tDetach, () => {
        if (!silent && P.detachT.some((d) => d === s.tDetach)) beep(note(3), 0.08, "square", 0.036);
      });
    }
    if (puerta) {
      once("puerta", tAll >= P.puertaA, () => {
        sayNow(T[lang].cTelDoor(names[winnerIdx] ?? ""), 0.85);
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
    if (mordaza) {
      once("suelta", tAll >= P.mA, () => {
        const who = slipCab === winnerCab ? winnerIdx : (rank[1] as number);
        sayNow(T[lang].cTelSlip(names[who] ?? ""), 0.9);
        if (!silent) [14, 12, 10, 8, 6].forEach((d, i) => setTimeout(() => beep(note(d), 0.06, "square", 0.035), i * 45));
      });
      once("agarra", tAll >= P.mB, () => {
        sayNow(t("cTelCaught"), 0.95);
        if (!silent) {
          beep(note(2), 0.12, "square", 0.06);
          beep(note(0), 0.3, "sine", 0.08);
          cam.shake(16 * G.k).punch(0.08);
        }
      });
    }
    if (apagon) {
      once("corte", tAll >= P.corte, () => {
        sayNow(t("cTelDark"), 0.85);
        if (!silent) [12, 9, 6, 3].forEach((d, i) => setTimeout(() => beep(note(d), 0.09, "sawtooth", 0.035), i * 70));
      });
      once("vuelve", tAll >= P.vuelve, () => {
        sayNow(t("cTelLight"), 0.8);
        if (!silent) {
          beep(note(10), 0.05, "square", 0.04);
          setTimeout(() => beep(note(12), 0.05, "square", 0.04), 160);
          setTimeout(() => beep(note(15), 0.1, "triangle", 0.045), 300);
        }
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
    once("climb", tAll >= T_RUN + 0.15, () => sayNow(t("cTelClimb"), 0.9));
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
        beep(note(0), 0.14, "sine", 0.075);
        beep(note(5), 0.09, "triangle", 0.035);
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
      } else if (aro.length && lastStop && tAll < lastStop.tOff + HOP) {
        // Con el aro, cada salto es un latido, y se calla mientras la cara
        // vuela hasta el andén, que tiene su golpe.
        const a = tAll < lastStop.tOff ? aroAt(tAll) : null;
        if (a && 2000 + a.i !== beat) {
          beat = 2000 + a.i;
          beep(note(a.i % 2 ? 2 : 0), 0.14, "sine", 0.06 + 0.005 * a.i);
          beep(note(a.i % 2 ? 7 : 5), 0.09, "triangle", 0.035);
        }
      } else {
        const b = aro.length && lastStop ? 3000 + Math.floor((tAll - lastStop.tOff - HOP) / 0.5) : Math.floor((tAll - from) / 0.5);
        if (b !== beat) {
          // Después del aro, el primero cae con el golpe del andén: ese no suena.
          const pisa = b === 3000;
          beat = b;
          if (!pisa) {
            beep(note(0), 0.14, "sine", 0.07);
            beep(note(5), 0.09, "triangle", 0.035);
          }
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
    hops.length = 0;
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
    const resbala = cab === slipCab ? P.slipAt(x) * G.gap * 0.62 : 0;
    const p = pt(P.headAt(x), P.slotAt(cab, x) * G.gap + back + resbala);
    return { ...p, alpha };
  }

  /* ============================================================== cámara */
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
        cam.lookAt(p.x, p.y + 60 * k, 2.1, 4);
      } else if (mordaza && tAll >= P.mA - 0.1 && tAll <= P.mD + 0.2) {
        const p = cabPoint(slipCab, tAll);
        cam.lookAt(p.x, p.y + 60 * k, 2.0, tAll < P.mB ? 6 : 3);
      } else {
        const a = cabPoint(winnerCab, tAll), b = cabPoint(P.loserCab, tAll);
        cam.lookAt((a.x + b.x) / 2, (a.y + b.y) / 2 + 60 * k, 1.6, 3);
      }
    } else if (apagon && tAll >= P.corte && tAll <= P.vuelve + 0.4) {
      const p = lower(pt(head, G.gap * 0.8));
      cam.lookAt(p.x, p.y, 1.2 + 0.35 * clamp((tAll - P.corte) / 1.5, 0, 1), 1.4);
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
      const pl = platform.get(s);
      if (pl && !top && s !== 0) {
        const since = tAll - pl.t;
        stn.minus.text = `−${pl.off}`;
        stn.minus.scale.set(ease.outBack(clamp(since / 0.4, 0, 1)));
        if (pl.who.length && since < 2.4 && since > 0.3) {
          if (!stn.chips.children.length) {
            pl.who.forEach((idx, i) => {
              const c = S.chip(names[idx] ?? "");
              c.position.set(p.x - bw / 2 - 190 * k, y0 - 34 * k + 34 * k + i * 30 * k);
              stn.chips.addChild(c);
            });
          }
          stn.chips.alpha = clamp(Math.min(since - 0.3, 2.4 - since) / 0.3, 0, 1);
        } else stn.chips.alpha = 0;
      } else stn.minus.text = "";
    });

    // Cabinas.
    const sw = P.swingAt(tAll);
    const few = P.leftAt(tAll) <= C && tAll > T_BOARD;
    const aroNow = aroAt(tAll);
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
      if (cab === slipCab && tAll > P.mB && tAll < P.mB + 3) sacude += 0.3 * Math.exp(-(tAll - P.mB) * 2.4) * Math.sin((tAll - P.mB) * 9);
      cb.hang.rotation = sw * (1 - slot * 0.06) + sacude;
      const who = P.aboard(cab, tAll);
      const empty = !(who.length || tAll < T_BOARD);
      const col = hexOf(LINES[cab % LINES.length] as string);
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
      if (luz < 1) cb.door.rect(wx, wy, ww, wh).fill({ color: 0x04050c, alpha: (1 - luz) * 0.82 });
      cb.doors.clear();
      if (cab === winnerCab && tAll > T_DOCK) {
        const o = ease.outCubic(clamp((tAll - T_DOCK - 0.2) / 0.5, 0, 1));
        cb.doors.rect(wx, wy, (ww / 2) * (1 - o), wh).fill(col).rect(wx + ww / 2 + (ww / 2) * o, wy, (ww / 2) * (1 - o), wh).fill(col);
      }
      cb.flag.clear().moveTo(-cw / 2 + 14 * k, topY).lineTo(-cw / 2 + 14 * k, topY - 38 * k).stroke({ width: 2.5 * k, color: INK });
      drawFlag(cb.flag, -cw / 2 + 14 * k, topY - 37 * k, 48 * k, 26 * k, 0xf6efe2, cab * 2.3, true);
      // El aro del "¿quién se baja?": en cada salto aparece un poco más grande
      // y se cierra sobre la cabina; al abrirse la puerta, se apaga.
      cb.ring.clear();
      if (aroNow && aroNow.cab === cab && lastStop) {
        const alpha = clamp(1 - (tAll - lastStop.tOff) / 0.3, 0, 1);
        const pad = (7 + 10 * Math.exp(-aroNow.since * 14)) * k;
        const rx = -cw / 2 - pad, ry = topY - pad, rw = cw + 2 * pad, rh = ch + 2 * pad;
        cb.ring.roundRect(rx, ry, rw, rh, 16 * k).stroke({ width: 10 * k, color: INK, alpha })
          .roundRect(rx, ry, rw, rh, 16 * k).stroke({ width: 5.5 * k, color: YELLOW, alpha });
      }
    }

    // La cara del que se baja en la última parada: salta como los demás y se
    // aplasta un poco al tocar el andén. Cae en la punta derecha del piso de la
    // estación, que es la única libre: la cabina de adelante cuelga en el
    // medio y las de atrás quedan a la izquierda.
    if (jumper && lastStop) {
      const pr = (tAll - lastStop.tOff) / HOP;
      const hasta = Math.min(T_CROWN, lastStop.tOff + HOP + 2.2);
      jumper.visible = pr >= 0 && tAll < hasta;
      if (jumper.visible) {
        const q = clamp(pr, 0, 1);
        const from = pt(lastStop.at, P.slotAt(P.loserCab, lastStop.tOff) * gap);
        const sp = pt(lastStop.station);
        const tx = sp.x + 78 * k, ty = sp.y - 40 * k + 160 * k - 18 * k;
        const fy = from.y + 24 * k + ch * 0.8;
        // Más alto que los saltos chicos, para pasar por encima de la cabina de adelante.
        jumper.position.set(from.x + (tx - from.x) * q, fy + (ty - fy) * q - Math.sin(q * Math.PI) * 130 * k);
        const land = tAll - lastStop.tOff - HOP;
        const sq = land > 0 ? 0.2 * Math.exp(-land * 9) * Math.cos(land * 28) : 0;
        jumper.scale.set(1 + sq, 1 - sq);
        jumper.alpha = clamp((hasta - tAll) / 0.3, 0, 1);
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

    // Lo que se mueve suelto: pasajeros que saltan, el embarque, chispas, nombres.
    fx.clear();
    for (const hp of hops) {
      const pr = (tAll - hp.t0) / 0.55;
      if (pr < 0 || pr > 1.6) continue;
      const q = clamp(pr, 0, 1);
      const stop = stops.find((s) => s.station === hp.station);
      if (!stop) continue;
      const from = pt(stop.at, P.slotAt(hp.cab, hp.t0) * gap);
      const sp = pt(hp.station);
      const bw = 160 * k;
      const tx = sp.x + hp.dx * (bw / 2 - 12 * k), ty = sp.y - 40 * k + 160 * k - 26 * k;
      const x = from.x + (tx - from.x) * q;
      const y = from.y + 60 * k + (ty - from.y - 60 * k) * q - Math.sin(q * Math.PI) * 80 * k;
      const a = pr > 1 ? clamp(1.6 - pr, 0, 1) / 0.6 : 1;
      fx.rect(x - 7 * k, y - 7 * k, 14 * k, 14 * k).fill({ color: INK, alpha: a }).rect(x - 5 * k, y - 5 * k, 10 * k, 10 * k).fill({ color: hp.hue, alpha: a });
    }
    if (tAll < T_BOARD) {
      const perCab = Math.ceil(n / C);
      const show = Math.min(perCab, Math.ceil(40 / C));
      const b = pt(0);
      for (let cab = 0; cab < C; cab++) {
        const count = Math.min(P.pax[cab]?.length ?? 0, perCab);
        for (let i = 0; i < Math.min(count, show); i++) {
          const slot = Math.floor((i * perCab) / show);
          const tb = 0.25 + ((slot + 1) / perCab) * (T_BOARD - 0.55);
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
    if (mordaza && tAll > P.mB && tAll < P.mB + 0.55) {
      const p = cabPoint(slipCab, tAll);
      const since = tAll - P.mB;
      for (const s of chispas) {
        const d = s.v * since * 260 * k;
        fx.rect(p.x + Math.cos(s.a) * d - 2.5 * k, p.y + Math.sin(s.a) * d + since * since * 900 * k - 2.5 * k, 5 * k, 5 * k).fill({ color: s.v > 1 ? 0xfff3c4 : YELLOW, alpha: clamp(1 - since / 0.55, 0, 1) });
      }
    }

    // Los nombres de los que van solos, al costado de su cabina.
    if (few && tAll < T_CROWN) {
      for (let cab = 0; cab < C; cab++) {
        const who = P.aboard(cab, tAll);
        const p = cabPoint(cab, tAll);
        if (who.length !== 1 || p.alpha < 1) continue;
        const key = `nm${cab}`;
        let chip = fx.parent?.getChildByLabel(key) as Container | null;
        if (!chip) {
          chip = S.chip(names[who[0] as number] ?? "", 1.15);
          chip.label = key;
          fx.parent?.addChild(chip);
        }
        chip.visible = true;
        chip.position.set(G.vertical ? p.x - cw / 2 - 14 * k - chip.width : p.x - 40 * k, G.vertical ? p.y + 24 * k + ch / 2 + 8 * k : p.y + 24 * k + ch + 28 * k);
      }
    }
    for (const c of fx.parent?.children ?? []) {
      if (typeof c.label === "string" && c.label.startsWith("nm")) {
        const cab = Number(c.label.slice(2));
        const who = P.aboard(cab, tAll);
        if (!few || tAll >= T_CROWN || who.length !== 1 || cabPoint(cab, tAll).alpha < 1) c.visible = false;
      }
    }

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
    dark.alpha = (1 - luz) * 0.5;

    // Los contadores.
    const m = tAll < T_BOARD ? P.pax.reduce((a, _, cab) => a + P.aboard(cab, tAll).length, 0) : P.leftAt(tAll);
    hudLabel.text = tAll < T_BOARD ? t("cTelAboard") : t("cTelLeft");
    hudNum.text = String(m);
    const at = Math.min(NS, Math.floor(P.headAt(tAll) + 0.02));
    hudStation.text = tAll >= T_BOARD && tAll < T_RUN ? T[lang].cTelOf(Math.max(1, at), NS) : "";
    if (tAll >= T_CROWN) crown.at(tAll - T_CROWN);
    void hash;
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
