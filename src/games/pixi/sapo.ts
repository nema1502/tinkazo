import { Container, Graphics, Text } from "pixi.js";
import { T, getLang, t } from "../../i18n";
import { paceFactor, setGameLength, type Beacon } from "../../state";
import { beep, fanfare, note } from "../../sound";
import { writeStory } from "../drama";
import { WINNER_HOLD, clamp, ease, shorten, winnersLabel } from "../overlay";
import { CREAM, INK, MONO, YELLOW, mountPixi, type PixiStage } from "./stage";
import { avatarColor } from "../../avatar";
import { assignSlots } from "./slots";
import { planQualifier } from "./qualifier";
import { HAND, SAPO_MAX, holeLayout, optsForArc, planThrows, throwTime, type Point, type Throw } from "./sapo-plan";

/**
 * El sapo.
 *
 * El juego de las ferias y los patios de Perú, Bolivia y Colombia: un
 * cajón de madera pintado, con una rana de bronce encima y agujeros en la
 * tapa. Desde lejos se tiran argollas: unas pegan en la madera y se
 * van, otras bailan en el borde de un agujero y salen, y la última de cada
 * ganador cae en su agujero. Cada agujero lleva el nombre de alguien.
 *
 * El juego no decide nada. Los ganadores salen del protocolo antes de que
 * empiece, los tiros se planean desde sus agujeros (`sapo-plan.ts`, puro y
 * probado) y este archivo solo los dibuja y los cuenta.
 *
 * Aguanta cualquier cantidad de gente: en la mesa entran 12 agujeros, así que
 * con más nombres empieza con una clasificatoria (`qualifier.ts`). Aparecen
 * todos, se tachan en oleadas hasta que quedan 12 finalistas (siempre con los
 * ganadores adentro) y esos vuelan a sus agujeros. Con 12 o menos, los nombres
 * vuelan directo. Así la pantalla se mueve desde el primer cuadro.
 *
 * Rediseñado el 2 de octubre de 2026 desde el que propuso Guido Salazar: el
 * agente evaluador lo vio como una mesa de póker (óvalo de paño verde y una
 * moneda dorada) y sin un solo nombre en la mesa.
 *
 * Todo sale de la hora del juego (`dt`), nunca del reloj de la pared.
 */

/** Lo que tarda cada parte de la entrada. */
const Q_SHOW = 1.0;
const Q_WAVE = 1.25;
const Q_FLY = 1.1;
const HANG_FIRST = 0.9;
const HANG_FINAL = 1.8;
const HANG_SMALL = 0.5;
/** Después de caer: el rebote y la salida, el baile en el borde, o hundirse en el agujero. */
const AFTER_MISS = 0.8;
const AFTER_NEAR = 1.3;
const AFTER_HIT = 1.0;
const AFTER_FINAL = 2.0;
/** La parte de AFTER_NEAR que la argolla baila en el borde antes de salir. */
const WOBBLE = 0.8;
const SINK = 0.5;
/** Lo que tarda la mano en tomar impulso antes de soltar. */
const WINDUP = 0.35;
/** En el susto, qué parte del último vuelo llega hasta el labio de la rana. */
const LABIO = 0.62;

interface Toss {
  th: Throw;
  i: number;
  /** El participante (índice entre los finalistas) de este turno. */
  name: number;
  slot: number;
  grand: boolean;
  final: boolean;
  start: number;
  land: number;
  end: number;
  flight: number;
  announced: boolean;
  thrown: boolean;
  landed: boolean;
}

export async function sapoPixi(names: string[], winners: readonly number[], beacon: Beacon, done: () => void): Promise<void> {
  let skipFn = (): void => {};
  const st = await mountPixi(beacon, done, () => skipFn());
  if (!st) {
    done();
    return;
  }
  const S: PixiStage = st;
  const { rng, cam } = S;
  // El último tiro es un acercamiento lento: con desenfoque, la mesa se veía
  // borrosa justo cuando todos miran la argolla.
  cam.noBlur();
  const all = names.length;
  const prizesAll = winners.length ? [...winners] : [0];

  /* ------------------------------------------------------------ la clasificatoria */
  let Q: ReturnType<typeof planQualifier>;
  try {
    Q = planQualifier(all, prizesAll, SAPO_MAX, rng);
  } catch {
    // Más ganadores que agujeros, o un ganador inválido: nunca dejar el sorteo colgado.
    S.cleanup();
    return;
  }
  const fin = Q.finalists;
  const n = fin.length;
  const prizes = Q.finalWinners;
  const total = prizes.length;
  const last = total - 1;
  const waves = Q.waves;
  const T_FLY = Q_SHOW + waves.length * Q_WAVE;
  const T_SEATED = T_FLY + Q_FLY;

  const L = holeLayout(n);
  const holes = L.holes.length;
  const story = writeStory(rng, Math.max(2, n), (prizes[last] as number) % Math.max(2, n));
  S.mark("arco", story.arc);
  S.mark("sapo", `${holes}/${all}`);
  const plan = assignSlots(n, prizes, rng);
  let throws: Throw[];
  try {
    throws = planThrows(n, plan.winnerSlots, rng, optsForArc(story.arc));
  } catch {
    S.cleanup();
    return;
  }
  /** En el susto la rana deja de ser decoración: el último tiro pega en su labio y rebota al agujero. */
  const labio = story.arc === "susto";
  /**
   * El color de la cara de cada persona, para el aro de su agujero. El
   * amarillo es de la argolla y del ganador: un aro amarillo desde el
   * principio parecía ya elegido, así que esas caras llevan el aro crema.
   */
  const colorDe = (i: number): number => {
    const c = parseInt((avatarColor(names[i] ?? "") || "#ffc629").replace("#", ""), 16);
    return c === YELLOW ? CREAM : c;
  };
  /** El índice original de quien está en el agujero `s`. */
  const whoAt = (s: number): number => fin[plan.nameAt[s] as number] as number;
  const nameOfSlot = (s: number): string => names[whoAt(s)] ?? "";
  /** El agujero de cada participante original que llegó a la final. */
  const slotOfName = new Map<number, number>();
  for (let s = 0; s < holes; s++) slotOfName.set(whoAt(s), s);

  /* ---------------------------------------------------------------- el guion */
  const tosses: Toss[] = [];
  let tt = T_SEATED;
  throws.forEach((th, i) => {
    const final = i === throws.length - 1;
    const grand = th.turn === last;
    tt += i === 0 ? HANG_FIRST : final ? HANG_FINAL : HANG_SMALL;
    const flight = throwTime(th.kind, grand);
    const after = th.kind === "miss" ? AFTER_MISS : th.kind === "near" ? AFTER_NEAR : final ? AFTER_FINAL : AFTER_HIT;
    const start = tt;
    tosses.push({
      th, i, name: prizes[th.turn] as number, slot: plan.winnerSlots[th.turn] as number, grand, final,
      start, land: start + flight, end: start + flight + after, flight,
      announced: false, thrown: false, landed: false,
    });
    tt = start + flight + after;
  });
  const T_CROWN = tt;
  setGameLength(T_CROWN, WINNER_HOLD);

  /* ---------------------------------------------------------------- geometría */
  /**
   * Dónde está la mano que tira, en unidades de la mesa: sobre la esquina de
   * abajo a la derecha en una pantalla ancha, y debajo de la mesa en un
   * celular, donde al costado achicaba la mesa y salía cortada.
   */
  const handPoint = (): Point => (S.portrait() ? { x: 0.9, y: L.tableR + 0.5 } : { x: HAND.x * 0.86, y: HAND.y * 0.82 });
  /** Lo que mide el chip de cada nombre a escala 1, en unidades de `S.u()`. Se mide al armar. */
  let anchoNombre: number[] = [];
  const G = (): { w: number; h: number; k: number; cx: number; cy: number; sc: number; br: number; tilt: number } => {
    const w = S.sw(), h = S.sh(), k = S.u();
    const topY = S.top() + 54 * k, botY = h - S.bottom() - 6 * k;
    const hp = handPoint();
    // En un celular la tapa se ve más de frente, para usar el alto de la pantalla.
    const tilt = S.portrait() ? 0.95 : 0.62;
    let ancho = S.portrait() ? (w * 0.46) / L.tableR : Math.min((w * 0.4) / L.tableR, (w * 0.47) / (hp.x + 0.35));
    if (S.portrait() && anchoNombre.length) {
      // En un celular la mesa ocupaba casi todo el ancho y los nombres de los
      // costados volvían sobre su agujero. Se achica lo justo para que el más
      // largo entre afuera, y no menos de un tercio del ancho.
      for (let s = 0; s < holes; s++) {
        const h = L.holes[s] as Point;
        const ux = h.x / (Math.hypot(h.x, h.y) || 1);
        if (Math.abs(ux) <= 0.35) continue;
        const W = (anchoNombre[whoAt(s)] ?? 0) * k * labelScale();
        ancho = Math.min(ancho, (w / 2 - 6 * k - W) / (Math.abs(h.x) + L.holeR * 1.45 * Math.abs(ux)));
      }
      ancho = Math.max(ancho, (w * 0.4) / L.tableR);
    }
    // Lo que ocupa de alto: desde el borde de arriba del cajón hasta lo más bajo
    // entre su borde de abajo y la mano, más el frente con los cajoncitos.
    const arriba = L.tableR * 1.03, abajo = Math.max(hp.y, L.tableR * 1.03), frente = 46 * k;
    const sc = Math.max(8, Math.min(ancho, (botY - topY - frente) / ((arriba + abajo) * tilt)));
    const sobra = botY - topY - ((arriba + abajo) * tilt * sc + frente);
    const cy = topY + Math.max(0, sobra) / 2 + arriba * tilt * sc;
    // La argolla, grande: con 25 px no se seguía con la vista.
    return { w, h, k, cx: w / 2, cy, sc, br: clamp(sc * 0.13, 8 * k, 20 * k), tilt };
  };
  let g = G();
  const P = (p: Point): Point => ({ x: g.cx + p.x * g.sc, y: g.cy + p.y * g.sc * g.tilt });
  /** Dónde va el nombre de un agujero: afuera, del lado opuesto a la rana, pegado al aro. */
  const labelAt = (s: number): Point => {
    const h = L.holes[s] as Point;
    const d = Math.hypot(h.x, h.y) || 1;
    return { x: h.x + (h.x / d) * L.holeR * 1.45, y: h.y + (h.y / d) * L.holeR * 1.45 };
  };
  /**
   * Cómo se ancla el chip del agujero `s`: por su borde de adentro. A la
   * derecha de la rana el chip crece hacia la derecha, a la izquierda hacia
   * la izquierda, y arriba y abajo se centra. Centrado, un chip ancho volvía
   * sobre su propio agujero.
   */
  const anchorOf = (s: number): { ax: number; ay: number } => {
    const h = L.holes[s] as Point;
    const d = Math.hypot(h.x, h.y) || 1;
    const ux = h.x / d, uy = h.y / d;
    return { ax: ux > 0.35 ? 0 : ux < -0.35 ? 1 : 0.5, ay: uy < -0.6 ? 1 : uy > 0.6 ? 0 : 0.5 };
  };

  /* ------------------------------------------------------------------ capas */
  const floor = new Graphics();
  S.bg.addChild(floor);
  const boxG = new Graphics();
  const frogG = new Graphics();
  const fx = new Graphics();
  const tokG = new Graphics();
  const handG = new Graphics();
  S.scene.addChild(boxG, frogG, fx, tokG, handG);
  const strikeG = new Graphics();
  const chipLayer = new Container();
  S.hud.addChild(chipLayer, strikeG);
  // El contador de la casa, como el de la piñata: arriba a la izquierda.
  const counterBox = new Graphics();
  const counter = S.text("", { fontFamily: MONO, fontSize: 14, fontWeight: "700", fill: CREAM });
  counter.anchor.set(0.5);
  const counterG = new Container();
  counterG.addChild(counterBox, counter);
  S.hud.addChild(counterG);
  // "¡Casi!" como calcomanía amarilla, legible desde el fondo.
  const almostBox = new Graphics();
  const almost = S.text("", { fontSize: 26, fontWeight: "900", fill: INK });
  almost.anchor.set(0.5);
  const almostG = new Container();
  almostG.addChild(almostBox, almost);
  almostG.alpha = 0;
  S.hud.addChild(almostG);
  // Detrás del chip de quien gana, un resplandor amarillo.
  const glowG = new Graphics();
  S.hud.addChildAt(glowG, 0);
  const badgeLayer = new Container();
  const badgeOf = new Map<number, Text>();
  S.hud.addChild(badgeLayer);

  /** Un chip por nombre de la lista original, con su cara. Los finalistas terminan siendo los nombres de los agujeros. */
  let chips: Container[] = [];
  /** Dónde estaba cada chip en la grilla de la clasificatoria (pantalla). */
  let gridAt: Point[] = [];
  let gridScale = 1;
  /** El nombre de un agujero, a una letra de 17 px o más en una pantalla de 720 de alto. */
  const labelScale = (): number => (S.portrait() ? 0.9 : 1.45);
  /** Nombre y `n` letras del apellido: "María Q.", "María Qu.". En la mesa entran doce, y el nombre entero no. */
  const corto = (nm: string, n = 1): string => {
    const p = nm.trim().split(/\s+/);
    if (p.length < 2) return Array.from(nm.trim()).length > 13 ? shorten(nm.trim(), 13) : nm.trim();
    const ap = Array.from(p.slice(1).join(" "));
    // Si el corte cae en el fin de una palabra, "Peña." se leería como el apellido entero.
    if (n >= ap.length || ap[n] === " " || ap[n - 1] === " ") return shorten(nm.trim(), 18);
    return `${p[0]} ${ap.slice(0, n).join("")}.`;
  };

  /**
   * La etiqueta de cada nombre: la más corta que no choque con la de otra
   * persona. "María Q." dos veces pasa a "María Qu." y "María Qs."; si no
   * alcanza, el nombre entero acortado por el medio.
   */
  const etiqueta: string[] = (() => {
    const out = names.map((nm) => corto(nm));
    for (let n = 2; n <= 6; n++) {
      const veces = new Map<string, number>();
      for (const c of out) veces.set(c, (veces.get(c) ?? 0) + 1);
      let quedan = false;
      names.forEach((nm, i) => {
        if ((veces.get(out[i] as string) ?? 0) > 1) {
          out[i] = corto(nm, n);
          quedan = true;
        }
      });
      if (!quedan) break;
    }
    const veces = new Map<string, number>();
    for (const c of out) veces.set(c, (veces.get(c) ?? 0) + 1);
    return names.map((nm, i) => ((veces.get(out[i] as string) ?? 0) > 1 ? shorten(nm, 18) : (out[i] as string)));
  })();

  const build = (): void => {
    g = G();
    const k = g.k;
    // El piso de un patio: baldosas grandes, del color del tema.
    floor.clear().rect(0, 0, g.w, g.h).fill(S.dark ? 0x1e1830 : 0xf3e3c3);
    const tile = 64 * k;
    for (let y = 0; y < g.h + tile; y += tile) {
      for (let x = (Math.floor(y / tile) % 2) * (tile / 2) - tile; x < g.w + tile; x += tile) {
        floor.rect(x + 2, y + 2, tile - 4, tile - 4).fill({ color: S.dark ? 0x2a2140 : 0xe8d3ab, alpha: 0.55 });
      }
    }
    chipLayer.removeChildren().forEach((c) => c.destroy({ children: true }));
    chips = names.map((nm) => {
      // La cara es la del nombre entero: con la etiqueta corta salía la cara de otra persona.
      const c = S.chip(etiqueta[names.indexOf(nm)] ?? corto(nm), 1, nm);
      c.visible = false;
      chipLayer.addChild(c);
      return c;
    });
    anchoNombre = chips.map((c) => c.width / k);
    g = G();
    // La grilla de la clasificatoria: todos los nombres a la vista, del tamaño que entre.
    const top = S.top() + 54 * k, bottom = g.h - S.bottom() - 10 * k;
    const areaW = g.w * 0.94, areaH = Math.max(40, bottom - top);
    const cw = 150 * k, ch = 30 * k;
    let best = { cols: 1, s: 0 };
    for (let cols = 1; cols <= all; cols++) {
      const rows = Math.ceil(all / cols);
      const s = Math.min(1.2, areaW / (cols * cw), areaH / (rows * ch));
      if (s > best.s) best = { cols, s };
    }
    gridScale = best.s;
    const cols = best.cols, rows = Math.ceil(all / cols);
    const x0 = (g.w - cols * cw * gridScale) / 2, y0 = top + (areaH - rows * ch * gridScale) / 2;
    gridAt = names.map((_, i) => ({
      x: x0 + ((i % cols) + 0.5) * cw * gridScale,
      y: y0 + (Math.floor(i / cols) + 0.5) * ch * gridScale,
    }));
    badgeLayer.removeChildren().forEach((c) => c.destroy());
    badgeOf.clear();
    counter.style.fontSize = 14 * k;
    counter.style.fill = CREAM;
    almost.style.fontSize = 26 * k;
    almost.text = t("cSapAlmost");
    const aw = almost.width + 24 * k, ah = 40 * k;
    almostBox.clear().roundRect(-aw / 2 + 4 * k, -ah / 2 + 4 * k, aw, ah, 6 * k).fill(INK)
      .roundRect(-aw / 2, -ah / 2, aw, ah, 6 * k).fill(YELLOW).stroke({ width: 3 * k, color: INK });
    cam.cut(g.w / 2, g.h / 2, 1);
  };
  build();
  S.onResize(build);

  /** Cuándo se va cada nombre de la clasificatoria: su oleada y un escalonado chico dentro de ella. */
  const goneAt = new Map<number, number>();
  waves.forEach((w, wi) => w.forEach((idx, j) => goneAt.set(idx, Q_SHOW + wi * Q_WAVE + 0.1 + (j / Math.max(1, w.length)) * 0.45)));
  /** Cuándo arranca a volar cada finalista hacia su agujero. */
  const flyAt = (s: number): number => T_FLY + (s / Math.max(1, holes)) * 0.35;
  /** El agujero aparece cuando su nombre llega. */
  const holeAt = (s: number): number => flyAt(s) + Q_FLY * 0.75;

  /* ------------------------------------------------------------------ movimiento */
  interface Tok { x: number; y: number; ground: Point; scale: number; alpha: number; height: number }

  const arc = (a: Point, b: Point, f: number, apex: number): Point => ({
    x: a.x + (b.x - a.x) * f,
    y: a.y + (b.y - a.y) * f - 4 * apex * f * (1 - f),
  });

  /** Dónde está la argolla en el momento `t`, en pantalla, con su punto sobre la tapa. */
  const tokenAt = (o: Toss, t: number): Tok => {
    const hp = handPoint();
    const hand = P(hp);
    const land = P(o.th.landing);
    if (t < o.land) {
      const f = clamp((t - o.start) / o.flight, 0, 1);
      const apex = g.sc * (o.final ? 0.95 : 0.7);
      // El susto: el último tiro pega en el labio de la rana y rebota al agujero.
      if (o.final && labio) {
        const lab = { x: 0, y: L.frogR * 0.15 };
        if (f < LABIO) {
          const u = f / LABIO;
          const q = arc(hand, P(lab), u, apex);
          return { x: q.x, y: q.y, ground: { x: hp.x + (lab.x - hp.x) * u, y: hp.y + (lab.y - hp.y) * u }, scale: 1, alpha: 1, height: 4 * apex * u * (1 - u) };
        }
        const u = (f - LABIO) / (1 - LABIO);
        const q = arc(P(lab), land, u, apex * 0.35);
        return { x: q.x, y: q.y, ground: { x: lab.x + (o.th.landing.x - lab.x) * u, y: lab.y + (o.th.landing.y - lab.y) * u }, scale: 1, alpha: 1, height: 4 * apex * 0.35 * u * (1 - u) };
      }
      const q = arc(hand, land, f, apex);
      const ground = { x: hp.x + (o.th.landing.x - hp.x) * f, y: hp.y + (o.th.landing.y - hp.y) * f };
      return { x: q.x, y: q.y, ground, scale: 1, alpha: 1, height: 4 * apex * f * (1 - f) };
    }
    const age = t - o.land;
    if (o.th.kind === "hit") {
      const u = clamp(age / SINK, 0, 1);
      return { x: land.x, y: land.y + g.br * 0.8 * u, ground: o.th.landing, scale: 1 - 0.85 * ease.outCubic(u), alpha: u >= 1 ? 0 : 1, height: 0 };
    }
    let gp: Point;
    let hop: number;
    if (o.th.kind === "near" && age < WOBBLE) {
      const u = age / WOBBLE;
      const w = 0.03 * (1 - u);
      gp = { x: o.th.landing.x + w * Math.sin(age * 26), y: o.th.landing.y + w * Math.cos(age * 19) };
      hop = g.br * 0.9 * (1 - u) * Math.abs(Math.sin(age * 15));
    } else {
      const base = o.th.kind === "near" ? WOBBLE : 0;
      const span = (o.th.kind === "near" ? AFTER_NEAR : AFTER_MISS) - base;
      const u = clamp((age - base) / span, 0, 1);
      const e = ease.outCubic(u);
      gp = { x: o.th.landing.x + (o.th.exit.x - o.th.landing.x) * e, y: o.th.landing.y + (o.th.exit.y - o.th.landing.y) * e };
      hop = g.br * 2.6 * (1 - u) * Math.abs(Math.sin(u * Math.PI * 3));
    }
    const q = P(gp);
    const off = clamp((Math.hypot(gp.x, gp.y) - L.tableR) / 0.15, 0, 1);
    return { x: q.x, y: q.y - hop, ground: gp, scale: 1, alpha: 1 - off, height: hop };
  };

  /* ------------------------------------------------------------------ el guion hablado */
  let tAll = 0, tHold = 0, crowned = false, dead = false, introSaid = 0, labioSonado = false, croo = false, silbido = false;
  const saidWave = new Set<number>();

  const crownUI = S.crown(names, winners);
  function crown(): void {
    if (crowned) return;
    crowned = true;
    S.say(T[getLang()].cWin(winnersLabel(names, winners), winners.length > 1), 1);
    beep(note(0), 0.7, "sine", 0.09);
    fanfare();
    setTimeout(() => beep(note(17), 0.12, "triangle", 0.045), 520);
    cam.punch(0.08).shake(10 * S.u());
  }
  skipFn = (): void => {
    if (crowned || dead) return;
    for (const o of tosses) o.announced = o.thrown = o.landed = true;
    tAll = T_CROWN;
    crown();
  };

  const onLand = (o: Toss): void => {
    o.landed = true;
    const big = o.grand;
    const k = g.k;
    if (o.th.kind === "miss") {
      beep(note(4), 0.08, "square", big ? 0.05 : 0.03);
      cam.punch(big ? 0.04 : 0.02).shake((big ? 4 : 2) * k);
      if (big) S.say(t("cSapMiss"), 0.5);
    } else if (o.th.kind === "near") {
      beep(note(12), 0.09, "triangle", big ? 0.055 : 0.035);
      [0, 1, 2].forEach((d) => setTimeout(() => beep(note(11 - d), 0.05, "square", 0.025), 110 + d * 130));
      cam.punch(big ? 0.06 : 0.03).shake((big ? 6 : 3) * k);
      if (big) {
        if (story.arc === "tapada") S.say(t("cSapRim"), 0.7);
        else S.say(T[getLang()].cSapNear(nameOfSlot(o.th.rimSlot as number)), 0.85);
      }
    } else {
      beep(note(o.final ? 0 : 3), o.final ? 0.4 : 0.2, "triangle", o.final ? 0.07 : 0.05);
      beep(note(o.final ? -5 : -2), 0.16, "sawtooth", 0.035);
      cam.punch(o.final ? 0.1 : 0.05).shake((o.final ? 12 : 6) * k);
      if (o.final) S.say(t("cSapIn"), 1);
      else S.say(T[getLang()].cSapDone(nameOfSlot(o.slot)), 0.55);
    }
  };

  function script(): void {
    const cues: [number, () => void][] = [
      [0.1, () => {
        S.say(all > holes ? T[getLang()].cQualStart(all) : t("cSapHang"), 0.15);
        [5, 7, 9].forEach((d, i) => setTimeout(() => beep(note(d), 0.12, "triangle", 0.04), 120 + i * 140));
      }],
      [T_FLY, () => {
        S.say(T[getLang()].cSapCount(holes), 0.2);
        for (let i = 0; i < 5; i++) setTimeout(() => beep(note(10 + (i % 3)), 0.04, "square", 0.025), 200 + i * 90);
      }],
    ];
    while (introSaid < cues.length && tAll >= (cues[introSaid] as [number, () => void])[0]) (cues[introSaid++] as [number, () => void])[1]();
    // Cada oleada de la clasificatoria: el tachón suena y el relator cuenta cuántos quedan.
    waves.forEach((w, wi) => {
      const at = Q_SHOW + wi * Q_WAVE + 0.6;
      if (saidWave.has(wi) || tAll < at) return;
      saidWave.add(wi);
      const quedan = all - waves.slice(0, wi + 1).reduce((a, x) => a + x.length, 0);
      S.say(T[getLang()].cQualLeft(quedan), 0.25 + 0.15 * wi);
      for (let i = 0; i < Math.min(6, 2 + w.length); i++) setTimeout(() => beep(note(3 - i), 0.05, "square", 0.03), i * 80);
      cam.shake(3 * g.k);
    });
    for (const o of tosses) {
      const firstOfTurn = o.i === 0 || (tosses[o.i - 1] as Toss).th.turn !== o.th.turn;
      if (!o.announced && tAll >= o.start - 0.7) {
        o.announced = true;
        if (firstOfTurn && total > 1) {
          S.say(T[getLang()].cSapNext(o.th.turn + 1, total), 0.3 + 0.5 * (o.th.turn / Math.max(1, last)));
          beep(note(8 + (o.th.turn % 4)), 0.12, "sine", 0.04);
        }
        if (o.final) S.say(t("cSapLast"), 0.9);
      }
      // La rana croa mientras la mano levanta la última argolla. En la tapada,
      // con pocos tiros y el reloj estirado casi al doble, quedaban 5 segundos
      // sin un solo efecto entre el último "casi" y el tiro (auditor de sonido,
      // 4 de octubre de 2026).
      if (o.final && !croo && tAll >= o.start - 1.0) {
        croo = true;
        beep(note(2), 0.16, "triangle", 0.045);
        setTimeout(() => beep(note(0), 0.2, "triangle", 0.04), 170);
      }
      if (!o.thrown && tAll >= o.start) {
        o.thrown = true;
        beep(note(7), 0.1, "triangle", o.grand ? 0.045 : 0.03);
        if (o.i === 0 || (o.grand && o.th.kind === "miss" && firstOfTurn)) S.say(t("cSapThrow"), 0.3);
      }
      // Arriba del último vuelo, un silbido corto que sube. En el susto ahí
      // suena el labio de la rana, así que no hace falta.
      if (o.final && !labio && !silbido && tAll >= o.start + o.flight * 0.5) {
        silbido = true;
        beep(note(9), 0.09, "sine", 0.035);
        setTimeout(() => beep(note(12), 0.12, "sine", 0.035), 110);
      }
      if (o.final && labio && !labioSonado && tAll >= o.start + o.flight * LABIO) {
        labioSonado = true;
        beep(note(12), 0.08, "square", 0.05);
        beep(note(5), 0.12, "triangle", 0.04);
        cam.punch(0.05).shake(5 * g.k);
        S.say(t("cSapLip"), 0.95);
      }
      if (!o.landed && tAll >= o.land) onLand(o);
    }
  }

  /* -------------------------------------------------------------------- dibujo */
  const current = (): Toss | undefined => tosses.find((o) => tAll >= o.start - 0.4 && tAll < o.end);

  function aim(): void {
    const ultimo = tosses[tosses.length - 1] as Toss;
    if (tAll >= ultimo.land) {
      // El agujero ganador queda en el plano también con el cartel, a un 62%
      // del alto: en la fila de arriba el cartel lo tapaba. La cámara puede
      // salir de la escena porque el piso cubre la pantalla entera.
      const q = P(ultimo.th.landing);
      const z = 1.5;
      cam.lookAt(clamp(q.x, g.w / 2 / z, g.w - g.w / 2 / z), q.y - (g.h * 0.12) / z, z, 3);
      return;
    }
    const cur = current();
    let x = g.w / 2, y = g.h / 2, z = 1, rate = 2;
    if (cur && cur.grand && tAll < T_CROWN) {
      const tok = tokenAt(cur, clamp(tAll, cur.start, cur.end));
      const close = story.arc === "remontada";
      if (tAll < cur.start) {
        z = close ? 1.25 : 1;
      } else if (cur.final) {
        if (tAll < cur.land) {
          // Un acercamiento lento durante todo el último vuelo; en la tapada, recién en la segunda mitad.
          const f = clamp((tAll - cur.start) / cur.flight, 0, 1);
          z = story.arc === "tapada" ? 1 + 0.6 * Math.max(0, f - 0.5) * 2 : 1 + 0.6 * f * f;
          x = tok.x;
          y = tok.y;
          rate = 3 + 2 * f;
        } else {
          // El agujero de cerca y en la mitad de abajo: arriba entra el cartel del ganador.
          const q = P(cur.th.landing);
          z = 1.5;
          x = q.x;
          y = q.y - (g.h * 0.12) / z;
          rate = 3;
        }
      } else if (tok.alpha >= 0.5) {
        // Sigue a la argolla mientras está en la mesa; cuando se va, vuelve a la mesa entera.
        z = close ? 1.25 : cur.th.kind === "near" && tAll >= cur.land ? 1.45 : 1.15;
        x = tok.x;
        y = tok.y;
        rate = 2.5;
      }
      // En un celular la mesa se mide para que los nombres de los costados
      // entren justo: cualquier acercamiento los sacaba de cuadro. Ahí la
      // cámara solo se acerca en el último tiro.
      if (S.portrait() && !cur.final) {
        z = 1;
        x = g.w / 2;
        y = g.h / 2;
      }
      // La fila de abajo, por encima de la caja de subtítulos.
      if (z > 1) y += (S.bottom() * 0.5) / z;
    }
    x = clamp(x, g.w / 2 / z, g.w - g.w / 2 / z);
    y = clamp(y, g.h / 2 / z, g.h - g.h / 2 / z);
    cam.lookAt(x, y, z, rate);
  }

  /** La rana respira, parpadea y abre la boca cuando cae una argolla. */
  const croakAt = (): number => {
    let c = 0.1 + 0.06 * Math.max(0, Math.sin(tAll * 2.4));
    const fin = tosses[tosses.length - 1];
    if (labio && fin) {
      const a = tAll - (fin.start + fin.flight * LABIO);
      if (a >= 0 && a < 0.8) c = Math.max(c, 1 - a / 0.8);
    }
    for (const o of tosses) {
      if (o.th.kind !== "hit" || tAll < o.land) continue;
      const age = tAll - o.land;
      c = Math.max(c, o.final ? clamp(1 - age / 2.2, 0, 1) * (0.75 + 0.25 * Math.sin(age * 16)) : clamp(1 - age / 0.9, 0, 1));
    }
    return clamp(c, 0, 1);
  };

  /** El cajón del sapo visto desde arriba y adelante: tapa de madera pintada, guarda de colores y frente. */
  function drawBox(): void {
    const k = g.k;
    const R = L.tableR * g.sc;
    const w = R * 2.1, d = R * 2.05 * g.tilt, front = 46 * k;
    const x0 = g.cx - w / 2, y0 = g.cy - d / 2;
    boxG.clear();
    boxG.roundRect(x0 + 8 * k, y0 + 10 * k, w, d + front, 10 * k).fill({ color: INK, alpha: 0.35 });
    // El frente del cajón, más oscuro, con los cajoncitos numerados del sapo de verdad.
    boxG.rect(x0, y0 + d, w, front).fill(S.dark ? 0x7a2e1c : 0xb4462a).stroke({ width: 3 * k, color: INK });
    const cajones = 5;
    for (let i = 0; i < cajones; i++) {
      const cx = x0 + ((i + 0.5) * w) / cajones;
      boxG.rect(cx - (w / cajones) * 0.36, y0 + d + front * 0.22, (w / cajones) * 0.72, front * 0.56).fill(S.dark ? 0x5a2014 : 0x8f3520).stroke({ width: 2 * k, color: INK });
      boxG.circle(cx, y0 + d + front * 0.5, 3 * k).fill(YELLOW);
    }
    // La tapa: madera clara con vetas, y una guarda del aguayo en el borde.
    boxG.rect(x0, y0, w, d).fill(S.dark ? 0x9a6a3c : 0xd29a5c).stroke({ width: 3 * k, color: INK });
    for (let i = 1; i < 7; i++) {
      const yy = y0 + (i * d) / 7;
      boxG.moveTo(x0 + 6 * k, yy).lineTo(x0 + w - 6 * k, yy).stroke({ width: 1.4 * k, color: INK, alpha: 0.12 });
    }
    const band = 9 * k, paso = band * 1.6;
    for (let x = x0; x < x0 + w - 1; x += paso) {
      const c = S.color(Math.floor((x - x0) / paso));
      boxG.poly([x, y0, x + paso / 2, y0 + band, x + paso, y0]).fill(c);
      boxG.poly([x, y0 + d, x + paso / 2, y0 + d - band, x + paso, y0 + d]).fill(c);
    }
  }

  /** La rana de bronce, sentada, con la boca que se abre. */
  function drawFrog(): void {
    const k = g.k;
    const c0 = P({ x: 0, y: 0 });
    const fr = L.frogR * g.sc;
    const open = croakAt();
    const bronce = 0xb98a3e, oscuro = 0x7d5a22;
    const blink = (Math.floor(tAll * 0.7) % 5 === 0 && (tAll * 0.7) % 1 < 0.12) ? 0.15 : 1;
    const garganta = 1 + 0.06 * Math.max(0, Math.sin(tAll * 5));
    frogG.clear();
    frogG.ellipse(c0.x, c0.y + fr * 0.55, fr * 1.15, fr * 0.45).fill({ color: INK, alpha: 0.35 });
    // Las patas de atrás, el cuerpo y la cabeza.
    for (const sx of [-1, 1]) frogG.ellipse(c0.x + sx * fr * 0.78, c0.y + fr * 0.35, fr * 0.42, fr * 0.3).fill(oscuro).stroke({ width: 2 * k, color: INK });
    frogG.ellipse(c0.x, c0.y + fr * 0.1, fr * 0.95, fr * 0.72).fill(bronce).stroke({ width: 2.5 * k, color: INK });
    frogG.ellipse(c0.x, c0.y + fr * 0.32, fr * 0.6 * garganta, fr * 0.32 * garganta).fill(0xd8b06a);
    for (const sx of [-0.5, 0.5]) {
      frogG.circle(c0.x + sx * fr, c0.y - fr * 0.5, fr * 0.28).fill(bronce).stroke({ width: 2 * k, color: INK });
      frogG.ellipse(c0.x + sx * fr, c0.y - fr * 0.5, fr * 0.13, fr * 0.13 * blink).fill(INK);
    }
    // El brillo del metal.
    frogG.ellipse(c0.x - fr * 0.35, c0.y - fr * 0.05, fr * 0.22, fr * 0.1).fill({ color: 0xfff1c4, alpha: 0.55 });
    const mx = fr * 0.55 * (0.7 + 0.3 * open), my = fr * (0.06 + 0.3 * open);
    frogG.ellipse(c0.x, c0.y + fr * 0.02, mx, my).fill(INK);
    if (open > 0.55) frogG.ellipse(c0.x, c0.y + fr * 0.02 + my * 0.3, mx * 0.5, my * 0.45).fill(0xe0707a);
  }

  /** Dónde está la mano, en la escena. */
  const handAt = (): Point => P(handPoint());

  /** La mano que tira: toma impulso hacia atrás y suelta. */
  function drawHand(): void {
    handG.clear();
    if (crowned) return;
    const k = g.k;
    const h = handAt();
    // Antes del tiro la mano baja (toma impulso); al soltar sube de golpe y vuelve.
    const next = tosses.find((o) => tAll < o.start + 0.3);
    let swing = 0;
    if (next) {
      const u = next.start - tAll;
      if (u >= 0) swing = u < WINDUP ? 1 - u / WINDUP : 0;
      else swing = -0.8 * Math.sin(Math.PI * clamp(-u / 0.3, 0, 1));
    }
    const hx = h.x, hy = h.y + swing * 22 * k;
    // El brazo entra desde fuera de la pantalla, abajo a la derecha.
    const ax = hx + 70 * 8 * k, ay = hy + 96 * 8 * k;
    const mx = hx + 32 * k, my = hy + 44 * k;
    // La manga, de un color de la casa, y la mano con los dedos que sostienen la argolla.
    handG.moveTo(ax, ay).lineTo(mx, my).stroke({ width: 34 * k, color: INK, cap: "round" });
    handG.moveTo(ax, ay).lineTo(mx, my).stroke({ width: 28 * k, color: S.color(2), cap: "round" });
    handG.moveTo(mx, my).lineTo(hx, hy).stroke({ width: 22 * k, color: INK, cap: "round" });
    handG.moveTo(mx, my).lineTo(hx, hy).stroke({ width: 16 * k, color: 0xc68a5c, cap: "round" });
    handG.circle(hx, hy, 15 * k).fill(0xc68a5c).stroke({ width: 2.5 * k, color: INK });
    for (const [dx, dy] of [[-13, -6], [-9, -13], [-1, -16]]) {
      handG.circle(hx + (dx as number) * k, hy + (dy as number) * k, 5 * k).fill(0xc68a5c).stroke({ width: 2 * k, color: INK });
    }
  }

  /** La argolla amarilla: un disco con agujero, para que no se lea como moneda. */
  function drawToken(x: number, y: number, s: number, glow: boolean, alpha = 1): void {
    const r = g.br * s;
    // La argolla del último tiro lleva un aro nítido. Antes era un halo
    // amarillo transparente que sobre la madera se leía como una mancha borrosa.
    if (glow) {
      tokG.ellipse(x, y, r * 1.6, r * 1.28).stroke({ width: 6 * g.k, color: INK, alpha });
      tokG.ellipse(x, y, r * 1.6, r * 1.28).stroke({ width: 3 * g.k, color: YELLOW, alpha });
    }
    tokG.ellipse(x + 2 * g.k, y + 3 * g.k, r, r * 0.8).fill({ color: INK, alpha: 0.45 * alpha });
    tokG.ellipse(x, y, r, r * 0.8).fill({ color: YELLOW, alpha }).stroke({ width: 3 * g.k, color: INK, alpha });
    tokG.ellipse(x, y, r * 0.4, r * 0.32).fill({ color: 0x3a2a14, alpha }).stroke({ width: 2 * g.k, color: INK, alpha });
  }

  function draw(): void {
    const k = g.k;
    drawBox();
    drawFrog();
    drawHand();
    fx.clear();
    tokG.clear();
    strikeG.clear();
    glowG.clear();

    const lit = new Map<number, number>();
    for (const o of tosses) if (o.th.kind === "hit" && tAll >= o.land) lit.set(o.slot, o.final ? 1 : 0.6);
    for (let s = 0; s < holes; s++) {
      const f = clamp((tAll - holeAt(s)) / 0.35, 0, 1);
      if (f <= 0) continue;
      const c = P(L.holes[s] as Point);
      const rx = L.holeR * g.sc * ease.outBack(f), ry = rx * g.tilt;
      const glow = lit.get(s);
      const aro = glow !== undefined ? YELLOW : colorDe(whoAt(s));
      boxG.ellipse(c.x, c.y, Math.max(0.01, rx * 1.2), Math.max(0.01, ry * 1.2)).fill(aro).stroke({ width: (glow !== undefined ? 6 : 2) * k, color: glow !== undefined ? YELLOW : INK });
      boxG.ellipse(c.x, c.y, Math.max(0.01, rx), Math.max(0.01, ry)).fill(0x140f0a);
      if (glow === 1) {
        // El estallido del agujero ganador, como el del trompo.
        const fin = tosses[tosses.length - 1] as Toss;
        const age = tAll - fin.land;
        if (age >= 0 && age < 0.7) {
          const e = ease.outCubic(age / 0.7);
          for (let r = 0; r < 12; r++) {
            const a = (r / 12) * Math.PI * 2;
            const r0 = rx * (1.3 + 0.4 * e), r1 = rx * (1.6 + 1.6 * e);
            fx.moveTo(c.x + Math.cos(a) * r0, c.y + Math.sin(a) * r0 * g.tilt)
              .lineTo(c.x + Math.cos(a) * r1, c.y + Math.sin(a) * r1 * g.tilt)
              .stroke({ width: 5 * k, color: YELLOW, alpha: 1 - age / 0.7, cap: "round" });
          }
        }
      }
    }

    // Los nombres: primero en la grilla de la clasificatoria, después volando a su agujero, y ahí se quedan.
    const ls = labelScale();
    names.forEach((_, i) => {
      const c = chips[i] as Container;
      const slot = slotOfName.get(i);
      const enter = clamp((tAll - (i / Math.max(1, all)) * 0.5) / 0.35, 0, 1);
      const grid = gridAt[i] as Point;
      if (slot === undefined) {
        // Se va en su oleada: se tacha, cae y se apaga.
        const at = goneAt.get(i) ?? 0;
        const age = tAll - at;
        c.visible = enter > 0 && age < 0.7;
        if (!c.visible) return;
        c.scale.set(gridScale * ease.outBack(enter));
        c.alpha = clamp(1 - Math.max(0, age - 0.25) / 0.45, 0, 1);
        const cy = grid.y + Math.max(0, age - 0.2) * 70 * k;
        c.position.set(grid.x - c.width / 2, cy);
        if (age > 0) {
          const f = clamp(age / 0.18, 0, 1);
          strikeG.moveTo(grid.x - c.width / 2, cy).lineTo(grid.x - c.width / 2 + c.width * f, cy).stroke({ width: 3 * k, color: 0xd52b1e, alpha: c.alpha });
        }
        return;
      }
      const ganador = lit.get(slot) === 1;
      if (crowned && !ganador) {
        c.visible = false;
        return;
      }
      c.visible = enter > 0;
      const lp = P(labelAt(slot));
      const q = cam.toScreen(lp.x, lp.y, g.w, g.h);
      const u = ease.inOutCubic(clamp((tAll - flyAt(slot)) / Q_FLY, 0, 1));
      const sc = (gridScale + (ls - gridScale) * u) * (ganador ? 1.3 : 1);
      c.scale.set(sc * (u > 0 ? 1 : ease.outBack(enter)));
      let an = anchorOf(slot);
      let qx = q.x, qy = q.y;
      if (ganador && S.portrait()) {
        // En un celular, al lado del agujero no entra el chip grande del ganador: va debajo.
        const fin = tosses[tosses.length - 1] as Toss;
        const f = ease.outCubic(clamp((tAll - fin.land) / 0.35, 0, 1));
        const h = L.holes[slot] as Point;
        const d = cam.toScreen(P({ x: h.x, y: h.y + L.holeR * 1.35 }).x, P({ x: h.x, y: h.y + L.holeR * 1.35 }).y, g.w, g.h);
        qx = q.x + (d.x - q.x) * f;
        qy = q.y + (d.y - q.y) * f;
        an = { ax: an.ax + (0.5 - an.ax) * f, ay: an.ay + (0 - an.ay) * f };
      }
      // El que no entra entre su punto y el borde se achica, en vez de volver
      // sobre su agujero. Se mide sin zoom: con la cámara cerca se achicaban
      // todos los de los bordes.
      const libre = an.ax <= 0.01 ? g.w - 4 - lp.x : an.ax >= 0.99 ? lp.x - 4 : g.w - 8;
      if (u >= 1 && !ganador && c.width > libre && libre > 0) c.scale.set(c.scale.x * Math.max(0.7, libre / c.width));
      // En la grilla va centrado; al llegar, anclado por su borde de adentro.
      const tx = qx - c.width * an.ax, ty = qy + c.height * (0.5 - an.ay);
      const x = grid.x - c.width / 2 + (tx - (grid.x - c.width / 2)) * u, y = grid.y + (ty - grid.y) * u - Math.sin(Math.PI * u) * 40 * k;
      const xx = clamp(x, 4, Math.max(4, g.w - c.width - 4));
      c.position.set(xx, y);
      // Con la cámara cerca, el nombre que quedaría cortado contra el borde se
      // apaga en vez de arrastrarse encima de los agujeros o de la rana.
      c.alpha = ganador || u < 1 || (Math.abs(xx - x) < 6 * k && qx > 0 && qx < g.w) ? 1 : 0;
      if (ganador) {
        glowG.roundRect(c.x - 7 * k, c.y - c.height / 2 - 7 * k, c.width + 14 * k, c.height + 14 * k, 10 * k).fill({ color: YELLOW, alpha: 0.9 });
      }
    });

    for (const o of tosses) {
      if (tAll < o.start - HANG_FIRST) continue;
      const prevDone = o.i === 0 || (tosses[o.i - 1] as Toss).landed || tAll >= (tosses[o.i - 1] as Toss).end - 0.2;
      if (tAll < o.start) {
        // En la mano, esperando el tiro.
        if (prevDone && o.start - tAll < (o.final ? HANG_FINAL : o.i === 0 ? HANG_FIRST : HANG_SMALL)) {
          const hp = handAt();
          const u = o.start - tAll;
          const sw = u < WINDUP ? 1 - u / WINDUP : 0;
          drawToken(hp.x - 4 * k, hp.y - 8 * k + sw * 22 * k, 1, false);
        }
        continue;
      }
      if (tAll >= o.end && !(o.final && o.th.kind === "hit")) continue;
      const tk = tokenAt(o, Math.min(tAll, o.end));
      if (tAll < o.land) {
        const sh = P(tk.ground);
        const sz = g.br * (1 - clamp(tk.height / (g.sc * 2), 0, 0.5));
        fx.ellipse(sh.x, sh.y + g.br * 0.5, sz, sz * g.tilt).fill({ color: INK, alpha: 0.35 });
        drawToken(tk.x, tk.y, tk.scale, o.final);
      } else {
        const age = tAll - o.land;
        if (o.th.kind !== "hit" && age < 0.4) {
          const lp = P(o.th.landing);
          fx.ellipse(lp.x, lp.y, g.br * (1 + 4 * age), g.br * (1 + 4 * age) * g.tilt).stroke({ width: 2 * k, color: YELLOW, alpha: 1 - age / 0.4 });
        }
        if (tk.alpha > 0.01) {
          const sh = P(tk.ground);
          fx.ellipse(sh.x, sh.y + g.br * 0.5, g.br, g.br * g.tilt).fill({ color: INK, alpha: 0.3 * tk.alpha });
          drawToken(tk.x, tk.y, tk.scale, false, tk.alpha);
        }
      }
    }

    // El contador de la casa: cuántos quedan en la clasificatoria, después los agujeros o el ganador de turno.
    let turn = 0;
    for (const o of tosses) if (tAll >= o.start - 0.7) turn = o.th.turn;
    const started = tAll >= (tosses[0] as Toss).start - 0.7;
    const quedan = all - waves.reduce((a, w, wi) => a + (tAll >= Q_SHOW + wi * Q_WAVE + 0.6 ? w.length : 0), 0);
    counter.text = !started
      ? (tAll < T_FLY && all > holes ? `${t("cQualIn")}  ${quedan}` : `${t("cSapHoles")}  ${holes}`)
      : total > 1 ? T[getLang()].cSapTally(turn + 1, total).toUpperCase() : `${t("cSapHoles")}  ${holes}`;
    const bw = counter.width + 40 * k, bh = 40 * k;
    counter.position.set(bw / 2, bh / 2);
    counterBox.clear().rect(5 * k, 5 * k, bw, bh).fill(INK).rect(0, 0, bw, bh).fill(0x221a33).stroke({ width: 3 * k, color: INK });
    counterG.position.set(22 * k, S.top() + 10 * k);
    counterG.visible = !crowned;
    // Con la cámara cerca tapaba nombres de la fila de arriba.
    counterG.alpha = clamp((1.15 - cam.zoom) / 0.1, 0, 1);

    // Los agujeros ya ocupados: una medalla con el orden (o una tilde con un solo ganador).
    for (const o of tosses) {
      if (o.th.kind !== "hit" || tAll < o.land + SINK || crowned) continue;
      const c = P(L.holes[o.slot] as Point);
      const p = cam.toScreen(c.x + L.holeR * g.sc * 0.95, c.y - L.holeR * g.sc * g.tilt * 1.1, g.w, g.h);
      const br = Math.max(9 * k, 12 * k);
      strikeG.circle(p.x, p.y, br).fill(YELLOW).stroke({ width: 2 * k, color: INK });
      if (total > 1) {
        let b = badgeOf.get(o.th.turn);
        if (!b) {
          b = S.text(`${o.th.turn + 1}`, { fontSize: br * 1.3, fontWeight: "900", fill: INK });
          b.anchor.set(0.5);
          badgeOf.set(o.th.turn, b);
          badgeLayer.addChild(b);
        }
        b.position.set(p.x, p.y);
      } else {
        strikeG.moveTo(p.x - br * 0.45, p.y).lineTo(p.x - br * 0.1, p.y + br * 0.35).lineTo(p.x + br * 0.5, p.y - br * 0.35).stroke({ width: 2.5 * k, color: INK });
      }
    }
    badgeLayer.visible = !crowned;

    // "¡Casi!" al lado de la argolla que bailó en el borde. En la interfaz, para que no se borronee con la cámara.
    almostG.alpha = 0;
    for (const o of tosses) {
      if (o.th.kind !== "near" || tAll < o.land || tAll >= o.land + AFTER_NEAR) continue;
      const age = tAll - o.land;
      // Entre la argolla y la rana: afuera quedaba encima del nombre del vecino.
      const lp = P({ x: o.th.landing.x * 0.55, y: o.th.landing.y * 0.55 });
      const q = cam.toScreen(lp.x, lp.y, g.w, g.h);
      almostG.position.set(q.x, q.y - 6 * k * ease.outCubic(clamp(age / 0.3, 0, 1)));
      almostG.rotation = -0.08;
      almostG.alpha = clamp(age / 0.15, 0, 1) * clamp((AFTER_NEAR - age) / 0.3, 0, 1);
    }
  }

  S.run((dt, now) => {
    tAll += dt;
    S.breath(tAll, T_CROWN);
    script();
    if (tAll >= T_CROWN) {
      crown();
      tHold += dt * paceFactor();
    }
    aim();
    cam.update(dt);
    cam.apply(S.scene, S.sw(), S.sh(), now);
    draw();
    if (crowned) crownUI.at(tAll - T_CROWN);
    if (tHold >= WINNER_HOLD) {
      dead = true;
      S.cleanup();
    }
  });
}
