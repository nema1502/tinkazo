import { Container, Graphics, Sprite, Text } from "pixi.js";
import { T, getLang, t } from "../../i18n";
import { paceFactor, setGameLength, type Beacon } from "../../state";
import { beep, fanfare, note } from "../../sound";
import { WINNER_HOLD, clamp, ease, winnersLabel } from "../overlay";
import { writeStory } from "../drama";
import { CREAM, INK, MONO, YELLOW, hash, mountPixi, type PixiStage } from "./stage";
import { isDigit, planRounds, type Round } from "./quien-plan";

/**
 * ¿Quién es?
 *
 * Todos los nombres en cartas, con su cara. En cada turno se pregunta por una
 * letra ("¿tiene la R?"), se contesta por quien ganó, y las cartas que no
 * coinciden se dan vuelta. Las que quedan se reacomodan más grandes y la
 * cámara se acerca, hasta que queda una sola carta.
 *
 * No decide nada: el ganador sale del protocolo antes y las preguntas se
 * eligen sabiendo quién es (`quien-plan.ts`, puro y probado). Aguanta
 * cualquier cantidad de gente: cada pregunta parte el grupo cerca de la mitad,
 * así que 50 nombres son unas seis preguntas y 200 unas ocho.
 *
 * Nació del Ahorcado que propuso Guido Salazar (@GuidoSV7) el 1 de octubre
 * de 2026: se quedó la idea de las letras que achican la lista, y se fueron la
 * horca y los casilleros que delataban el largo del nombre.
 *
 * Todo sale de la hora del juego (`dt`).
 */

const T_DEAL = 1.6;
const ASK = 0.75;
const FLIP = 0.55;
const REGROUP = 0.6;
/** Después de la última carta, casi nada: el suspenso va antes de la respuesta. */
const FINAL_HOLD = 0.5;

interface Step {
  round: number;
  /** -1: el reparto de la ronda; si no, el número de pregunta. */
  q: number;
  start: number;
  /** Cuándo llega la respuesta. */
  answer: number;
  /** Cuándo empiezan a darse vuelta las cartas. */
  flip: number;
  /** Cuándo se reacomodan las que quedan. */
  regroup: number;
  end: number;
  fired: boolean;
  answered: boolean;
}

export async function quienPixi(names: string[], winners: readonly number[], beacon: Beacon, done: () => void): Promise<void> {
  let skipFn = (): void => {};
  const st = await mountPixi(beacon, done, () => skipFn());
  if (!st) {
    done();
    return;
  }
  const S: PixiStage = st;
  const { rng, cam } = S;
  const n = names.length;
  const prizes = winners.length ? [...winners] : [0];
  const total = prizes.length;
  let rounds: Round[];
  try {
    rounds = planRounds(names, prizes, rng);
  } catch {
    S.cleanup();
    return;
  }
  S.mark("quien", `${n}x${total}`);
  // El arco del director, para el último ganador: en el susto su carta
  // empieza a darse vuelta en la última pregunta y vuelve; en la tapada no se
  // nombra a los dos últimos y la cámara espera al final.
  const story = writeStory(rng, Math.max(2, n), (prizes[total - 1] as number) % Math.max(2, n));
  S.mark("arco", story.arc);
  S.mark("preguntas", rounds.map((r) => r.questions.length).join(","));

  /* ---------------------------------------------------------------- el guion */
  // Cada pregunta dura más cuando son pocas, para que un sorteo de dos personas
  // no sea un parpadeo; la última de la última ronda tiene más suspenso.
  const steps: Step[] = [];
  /** Las rondas en que ya se dijo "quedan dos": con la pregunta de calentamiento se repetía. */
  const dosDichos = new Set<number>();
  let tt = 0;
  rounds.forEach((r, ri) => {
    const grand = ri === total - 1;
    steps.push({ round: ri, q: -1, start: tt, answer: tt, flip: tt, regroup: tt, end: tt + (ri === 0 ? T_DEAL : 1.0), fired: false, answered: false });
    tt += ri === 0 ? T_DEAL : 1.0;
    const Q = Math.max(1, r.questions.length + (r.ties.length ? 1 : 0));
    const dur = clamp((grand ? 15 : 7) / Q, 2.2, grand ? 5.5 : 3);
    for (let qi = 0; qi < Q; qi++) {
      const last = qi === Q - 1;
      // La última pregunta: el foco frena de a poco entre las cartas.
      const suspenso = grand && last ? 2.5 : 0;
      // Con muchas cartas, tiempo para que cada uno revise su nombre.
      const antes = qi === 0 ? r.pool.length : ((r.questions[qi - 1] as { remaining: number[] } | undefined)?.remaining.length ?? 2);
      const revisar = antes > 8 ? 1.6 : 0;
      const answer = tt + Math.max(ASK + Math.min(1.4, dur - 2.2) * 0.5, revisar) + suspenso;
      const flip = answer + 0.35;
      const regroup = flip + FLIP + Math.min(0.5, (dur - 2.2) * 0.3);
      const end = regroup + REGROUP;
      steps.push({ round: ri, q: qi, start: tt, answer, flip, regroup, end, fired: false, answered: false });
      tt = end;
    }
    tt += grand ? FINAL_HOLD : 1.2;
  });
  const T_CROWN = tt;
  setGameLength(T_CROWN, WINNER_HOLD);

  /** En qué momento se va cada carta de la ronda `ri`: el escalonado dentro de su pregunta. */
  const goneAt: Map<number, number>[] = rounds.map((r, ri) => {
    const m = new Map<number, number>();
    const qs = steps.filter((s) => s.round === ri && s.q >= 0);
    r.questions.forEach((q, qi) => {
      const s = qs[qi] as Step;
      q.out.forEach((idx, j) => m.set(idx, s.flip + (j / Math.max(1, q.out.length)) * Math.min(0.45, 0.04 * q.out.length + 0.15)));
    });
    if (r.ties.length) {
      const s = qs[qs.length - 1] as Step;
      r.ties.forEach((idx, j) => m.set(idx, s.flip + j * 0.12));
    }
    return m;
  });
  /** Los que siguen en pie en la ronda `ri` al momento `t`. */
  const alive = (ri: number, t: number): number[] => {
    const r = rounds[ri] as Round;
    const m = goneAt[ri] as Map<number, number>;
    return r.pool.filter((i) => !(m.has(i) && t >= (m.get(i) as number) + FLIP));
  };
  /** Las que siguen para el acomodo: cambian recién cuando la pregunta reacomoda. */
  const layoutSet = (ri: number, t: number): number[] => {
    const qs = steps.filter((s) => s.round === ri && s.q >= 0 && t >= s.regroup);
    const r = rounds[ri] as Round;
    if (!qs.length) return r.pool;
    const last = qs[qs.length - 1] as Step;
    if (last.q >= r.questions.length) return [r.winner];
    return (r.questions[last.q] as { remaining: number[] }).remaining;
  };

  /* ---------------------------------------------------------------- geometría */
  const G = (): { w: number; h: number; k: number; top: number; bottom: number } => {
    const w = S.sw(), h = S.sh(), k = S.u();
    // En el celular la pregunta va debajo del contador, así que las cartas arrancan más abajo.
    return { w, h, k, top: S.top() + (S.portrait() ? 175 : 112) * k, bottom: h - S.bottom() - 12 * k };
  };
  let g = G();
  /** La grilla de `m` cartas que mejor llena el tablero: el tamaño de carta y dónde va cada una. */
  const grid = (m: number): { cw: number; ch: number; at: (i: number) => { x: number; y: number } } => {
    const areaW = g.w * 0.94, areaH = Math.max(60, g.bottom - g.top);
    const ratio = 1.32;
    let best = { cols: 1, cw: 0 };
    for (let cols = 1; cols <= m; cols++) {
      const rows = Math.ceil(m / cols);
      const cw = Math.min(areaW / cols, areaH / rows / ratio) * 0.9;
      if (cw > best.cw) best = { cols, cw };
    }
    const cw = Math.min(best.cw, 170 * g.k), ch = cw * ratio;
    const cols = best.cols, rows = Math.ceil(m / cols);
    const gx = areaW / cols, gy = Math.min(areaH / rows, ch * 1.12);
    const x0 = (g.w - cols * gx) / 2, y0 = g.top + (areaH - rows * gy) / 2;
    return { cw, ch, at: (i) => ({ x: x0 + ((i % cols) + 0.5) * gx, y: y0 + (Math.floor(i / cols) + 0.5) * gy }) };
  };

  /* ------------------------------------------------------------------ capas */
  const bg = new Graphics();
  S.bg.addChild(bg);
  const board = new Graphics();
  const cardLayer = new Container();
  const fx = new Graphics();
  S.scene.addChild(board, cardLayer, fx);
  // La pregunta, grande arriba, y el sello de la respuesta.
  const banner = new Container();
  const bannerBg = new Graphics();
  const bannerText = S.text("", { fontSize: 30, fontWeight: "900", fill: INK });
  bannerText.anchor.set(0.5);
  const stamp = S.text("", { fontSize: 30, fontWeight: "900", fill: INK });
  stamp.anchor.set(0.5);
  const stampBg = new Graphics();
  banner.addChild(bannerBg, bannerText, stampBg, stamp);
  S.hud.addChild(banner);
  const counterBox = new Graphics();
  const counter = S.text("", { fontFamily: MONO, fontSize: 14, fontWeight: "700", fill: CREAM });
  counter.anchor.set(0.5);
  const counterG = new Container();
  counterG.addChild(counterBox, counter);
  S.hud.addChild(counterG);

  interface Card { root: Container; front: Container; back: Container; face: Sprite; label: Container; x: number; y: number; s: number }
  let cards: Card[] = [];
  /** Dónde estaba cada carta cuando empezó el último acomodo, para que viaje suave. */
  const from = new Map<number, { x: number; y: number; s: number }>();
  let lastLayout = "";
  /** Cuándo empezó el acomodo actual, y si es el reparto del principio de una ronda. */
  let layoutT0 = 0;
  let layoutDeal = true;
  /** La última carta que tocó el foco, para que cada salto suene una vez. */
  let focoAntes = -1;
  let latidoAntes = -1;



  const build = (): void => {
    g = G();
    const k = g.k;
    // Un tablero de juego de mesa: fondo liso con un marco de colores.
    bg.clear().rect(0, 0, g.w, g.h).fill(S.dark ? 0x1b2340 : 0xdfe9f7);
    board.clear();
    cardLayer.removeChildren().forEach((c) => c.destroy({ children: true }));
    cards = names.map((nm, i) => {
      const root = new Container();
      const front = new Container();
      const W = 120, H = 158;
      const fondo = new Graphics()
        .roundRect(4, 5, W, H, 10).fill({ color: INK, alpha: 0.5 })
        .roundRect(0, 0, W, H, 10).fill(S.dark ? CREAM : 0xffffff).stroke({ width: 3, color: INK })
        .rect(8, 8, W - 16, 78).fill(S.color(i));
      const face = new Sprite(S.face(nm));
      face.anchor.set(0.5);
      face.width = face.height = 66;
      face.position.set(W / 2, 47);
      // El nombre completo, en dos líneas: las letras se preguntan sobre el
      // nombre entero, así que tienen que estar todas a la vista. Con el nombre
      // abreviado ("Carlos C.") la H de "Choque" no se veía y parecía trampa.
      const partes = nm.trim().split(/\s+/);
      const lineas = partes.length > 1 ? [partes[0] as string, partes.slice(1).join(" ")] : [nm.trim()];
      const label = new Container();
      lineas.forEach((ln, j) => {
        const tx = S.text(ln, { fontSize: 19, fontWeight: "900", fill: INK });
        tx.anchor.set(0.5);
        if (tx.width > W - 10) tx.scale.set((W - 10) / tx.width);
        tx.position.set(W / 2, lineas.length > 1 ? 112 + j * 24 : 124);
        label.addChild(tx);
      });
      front.addChild(fondo, face, label);
      // El dorso: liso, con un signo de pregunta. Los rombos se leían como naipes.
      const back = new Graphics()
        .roundRect(4, 5, W, H, 10).fill({ color: INK, alpha: 0.5 })
        .roundRect(0, 0, W, H, 10).fill(S.dark ? 0x3a2f5a : 0x7a5cc4).stroke({ width: 3, color: INK });
      const signo = S.text("?", { fontSize: 96, fontWeight: "900", fill: CREAM });
      signo.anchor.set(0.5);
      signo.position.set(W / 2, H / 2);
      signo.alpha = 0.85;
      const backC = new Container();
      backC.addChild(back, signo);
      backC.visible = false;
      root.addChild(front, backC);
      root.pivot.set(W / 2, H / 2);
      cardLayer.addChild(root);
      return { root, front, back: backC, face, label, x: g.w / 2, y: (g.top + g.bottom) / 2, s: 0 };
    });
    bannerText.style.fontSize = 30 * k;
    stamp.style.fontSize = 28 * k;
    counter.style.fontSize = 14 * k;
    lastLayout = "";
    from.clear();
    cam.cut(g.w / 2, g.h / 2, 1);
  };
  build();
  S.onResize(build);

  /* ------------------------------------------------------------------ guion hablado */
  let tAll = 0, tHold = 0, crowned = false, dead = false;
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
    for (const s of steps) s.fired = s.answered = true;
    tAll = T_CROWN;
    crown();
  };

  const roundAt = (t: number): number => {
    let ri = 0;
    for (const s of steps) if (t >= s.start) ri = s.round;
    return ri;
  };

  function script(): void {
    for (const s of steps) {
      if (!s.fired && tAll >= s.start) {
        s.fired = true;
        const r = rounds[s.round] as Round;
        const grand = s.round === total - 1;
        if (s.q < 0) {
          if (s.round === 0) S.say(T[getLang()].cQuiStart(n), 0.15);
          else S.say(T[getLang()].cQuiNext(s.round + 1, total), 0.3 + 0.4 * (s.round / Math.max(1, total - 1)));
          for (let i = 0; i < 6; i++) setTimeout(() => beep(note(7 + (i % 3)), 0.04, "square", 0.025), i * 70);
        } else if (s.q < r.questions.length) {
          const q = r.questions[s.q] as { letter: string };
          const quedan = alive(s.round, s.start).length;
          if (quedan === 2 && grand && r.questions.length > 0 && story.arc !== "tapada" && !dosDichos.has(s.round)) {
            dosDichos.add(s.round);
            const [a, b] = alive(s.round, s.start);
            S.say(T[getLang()].cQuiTwo(names[a as number] ?? "", names[b as number] ?? ""), 0.85);
          } else {
            // Cada uno revisa su propio nombre. "¡Revisen su nombre!" se leía como
            // buscar la carta, y con 200 las cartas tienen letra de 6 píxeles.
            const mine = T[getLang()][isDigit(q.letter) ? "cQuiMineN" : "cQuiMine"](q.letter);
            S.say(mine, 0.3 + 0.5 * (1 - quedan / Math.max(2, r.pool.length)));
          }
          beep(note(9), 0.1, "triangle", 0.04);
        } else {
          S.say(t("cQuiTie"), 0.8);
        }
      }
      if (!s.answered && s.q >= 0 && tAll >= s.answer) {
        s.answered = true;
        const r = rounds[s.round] as Round;
        const q = r.questions[s.q];
        if (q) {
          const k = q.out.length;
          if (q.has) {
            beep(note(4), 0.12, "triangle", 0.05);
            beep(note(7), 0.18, "triangle", 0.045);
          } else {
            beep(note(3), 0.12, "triangle", 0.05);
            beep(note(-2), 0.18, "triangle", 0.045);
          }
          const que = isDigit(q.letter) ? `${q.letter}` : q.letter;
          const dic = T[getLang()];
          S.say(k ? dic[q.has ? "cQuiYes" : "cQuiNo"](que, k) : dic.cQuiNone(que, q.has), 0.45 + 0.4 * (s.q / Math.max(1, r.questions.length)));
          for (let i = 0; i < Math.min(8, k); i++) setTimeout(() => beep(note(10 - (i % 4)), 0.03, "square", 0.02), 350 + i * 45);
          cam.shake((2 + Math.min(4, k * 0.2)) * g.k);
        }
        const fin = s.q === r.questions.length - 1 + (r.ties.length ? 1 : 0);
        if (fin && story.arc === "susto" && s.round === total - 1) {
          setTimeout(() => {
            if (!crowned) S.say(t("cQuiAlmost"), 0.95);
          }, 400);
        }
        if (fin) {
          setTimeout(() => {
            if (crowned) return;
            if (s.round !== total - 1) S.say(T[getLang()].cQuiDone(names[r.winner] ?? ""), 0.6);
          }, 900);
        }
      }
    }
  }

  /* -------------------------------------------------------------------- dibujo */
  function aim(): void {
    const ri = roundAt(tAll);
    const set = layoutSet(ri, tAll);
    let z = 1, x = g.w / 2, y = (g.top + g.bottom) / 2;
    // Con pocas cartas la cámara se acerca a ellas.
    if (set.length <= (story.arc === "tapada" ? 1 : 6) && !crowned) {
      const gr = grid(set.length);
      const ps = set.map((_, i) => gr.at(i));
      x = ps.reduce((a, p) => a + p.x, 0) / ps.length;
      y = ps.reduce((a, p) => a + p.y, 0) / ps.length;
      // Nunca más cerca de lo que entra: con seis cartas cortaba las de los bordes.
      const ancho = Math.max(...ps.map((p) => p.x)) - Math.min(...ps.map((p) => p.x)) + gr.cw * 1.2;
      const alto = Math.max(...ps.map((p) => p.y)) - Math.min(...ps.map((p) => p.y)) + gr.ch * 1.2;
      z = Math.max(1, Math.min(set.length <= 2 ? 1.25 : 1.12, (g.w * 0.92) / ancho, ((g.bottom - g.top) * 0.95) / alto));
    }
    x = clamp(x, g.w / 2 / z, g.w - g.w / 2 / z);
    y = clamp(y, g.h / 2 / z, g.h - g.h / 2 / z);
    cam.lookAt(x, y, z, 2.2);
  }

  function draw(): void {
    const k = g.k;
    const ri = roundAt(tAll);
    const r = rounds[ri] as Round;
    const set = layoutSet(ri, tAll);
    const key = `${ri}:${set.length}`;
    // Cuando cambia el acomodo, cada carta sale desde donde estaba y viaja
    // desde ese momento. Antes el viaje se medía contra la próxima pregunta y
    // las cartas volvían a su punto de partida, afuera de la pantalla.
    if (key !== lastLayout) {
      layoutDeal = !lastLayout.startsWith(`${ri}:`);
      lastLayout = key;
      layoutT0 = tAll;
      for (const [i, c] of cards.entries()) from.set(i, { x: c.x, y: c.y, s: c.s });
    }
    const gr = grid(set.length);
    const durLayout = layoutDeal ? (ri === 0 ? T_DEAL : 1) : REGROUP;
    const u = ease.inOutCubic(clamp((tAll - layoutT0) / durLayout, 0, 1));
    const gone = goneAt[ri] as Map<number, number>;
    const winnersBefore = new Set(prizes.slice(0, ri));
    fx.clear();

    cards.forEach((c, i) => {
      const enRonda = r.pool.includes(i);
      const pos = set.indexOf(i);
      // Al coronar queda a la vista la carta del último ganador: si se escondía
      // todo, un instante la pantalla quedaba vacía (lo vio el auditor exigente).
      if ((crowned && !(ri === total - 1 && i === r.winner)) || (!enRonda && !winnersBefore.has(i))) {
        c.root.visible = false;
        return;
      }
      if (winnersBefore.has(i)) {
        // Los ganadores de rondas anteriores esperan arriba a la derecha.
        const slot = prizes.indexOf(i);
        c.root.visible = true;
        c.x = g.w - 40 * k - slot * 46 * k;
        c.y = S.top() + 70 * k;
        c.s = 0.32 * k;
        c.back.visible = false;
        c.front.visible = true;
        c.root.position.set(c.x, c.y);
        c.root.scale.set(c.s, c.s);
        return;
      }
      const at = gone.get(i);
      const flipping = at !== undefined && tAll >= at;
      if (pos >= 0 || flipping) {
        c.root.visible = true;
        let tx = c.x, ts = c.s;
        if (pos >= 0) {
          const p = gr.at(pos);
          const f = from.get(i) ?? { x: g.w / 2, y: (g.top + g.bottom) / 2, s: 0 };
          // En el reparto cada carta llega un poco después que la anterior.
          const dealU = layoutDeal ? ease.outCubic(clamp(((tAll - layoutT0) / durLayout) * 1.6 - (pos / Math.max(1, set.length)) * 0.6, 0, 1)) : u;
          tx = f.x + (p.x - f.x) * dealU;
          const ty = f.y + (p.y - f.y) * dealU;
          ts = f.s + (gr.cw / 120 - f.s) * dealU;
          c.x = tx;
          c.y = ty;
          c.s = ts;
        }
        // El susto: en la última pregunta la carta de quien gana empieza a
        // darse vuelta, duda y vuelve.
        const ult = steps.filter((s) => s.round === ri && s.q >= 0).at(-1);
        if (story.arc === "susto" && ri === total - 1 && i === r.winner && ult && tAll >= ult.flip && tAll < ult.flip + 0.9) {
          const f = (tAll - ult.flip) / 0.9;
          c.root.position.set(c.x, c.y);
          c.root.scale.set(c.s * (1 - 0.8 * Math.sin(Math.PI * f)), c.s);
          c.root.alpha = 1;
          return;
        }
        // Darse vuelta: se achica de canto, aparece el dorso, se apaga.
        let sx = c.s, alpha = 1;
        c.front.visible = true;
        c.back.visible = false;
        if (flipping) {
          const f = clamp((tAll - (at as number)) / FLIP, 0, 1);
          sx = c.s * Math.abs(Math.cos(f * Math.PI));
          if (f > 0.5) {
            c.front.visible = false;
            c.back.visible = true;
          }
          alpha = f < 0.85 ? 1 : clamp((1 - f) / 0.15, 0, 1);
          if (pos < 0 && f >= 1) {
            c.root.visible = false;
            return;
          }
        }
        const vaiven = pos >= 0 && !layoutDeal ? Math.sin(tAll * 2.2 + i * 1.7) * 3 * k : 0;
        c.root.position.set(c.x, c.y + vaiven);
        c.root.rotation = pos >= 0 && !layoutDeal ? Math.sin(tAll * 1.6 + i) * 0.025 : 0;
        c.root.scale.set(sx, c.s);
        c.root.alpha = alpha;
        // Mientras se espera la respuesta, un foco salta de carta en carta:
        // "¿esta? ¿esta?". Más rápido cuantas más cartas quedan.
        const espera = steps.find((s) => s.round === ri && s.q >= 0 && tAll >= s.start + 0.3 && tAll < s.answer);
        if (espera && pos >= 0 && set.length > 1) {
          // En la última pregunta el foco frena de a poco y se
          // queda en la carta de quien gana justo antes de la respuesta.
          const ultima = espera === steps.filter((x) => x.round === ri && x.q >= 0).at(-1) && ri === total - 1;
          let fase: number;
          if (ultima) {
            const T0 = espera.start + 0.3, dur = Math.max(0.5, espera.answer - T0);
            const e = clamp((tAll - T0) / dur, 0, 1);
            const vueltas = set.length * 2 + 3;
            const quien = set.indexOf(r.winner);
            // Más medio paso: la fase se acerca a su lugar desde abajo, y sin eso el piso caía en la carta anterior.
            fase = vueltas * (1 - (1 - e) * (1 - e)) + ((quien - vueltas) % set.length + set.length) % set.length + 0.5;
          } else {
            fase = (tAll - espera.start) * (set.length > 8 ? 7 : 4) + hash(ri, espera.q) * set.length;
          }
          const toca = set[Math.floor(fase) % set.length];
          if (toca === i && toca !== focoAntes) {
            // Cada salto del foco suena, como algo que busca.
            focoAntes = toca;
            beep(note(12 + (i % 3)), 0.03, "square", 0.02);
          }
          if (toca === i) {
            fx.roundRect(c.x - 62 * c.s - 6 * k, c.y + vaiven - 79 * c.s - 6 * k, 124 * c.s + 12 * k, 158 * c.s + 12 * k, 12 * k).stroke({ width: 5 * k, color: YELLOW, alpha: 0.9 });
          }
        }
        // La carta de quien ganó, cuando queda sola, brilla.
        if (set.length === 1 && i === r.winner) {
          const pulse = 0.3 + 0.2 * Math.sin(tAll * 7);
          // Cada latido de la carta sola suena, hasta que se corona.
          const latido = Math.floor(tAll * 7 / (2 * Math.PI));
          if (!crowned && latido !== latidoAntes) {
            latidoAntes = latido;
            beep(note(0), 0.08, "sine", 0.03);
          }
          fx.roundRect(c.x - 62 * c.s - 8 * k, c.y - 79 * c.s - 8 * k, 124 * c.s + 16 * k, 158 * c.s + 16 * k, 14 * k).stroke({ width: 5 * k, color: YELLOW, alpha: 0.6 + pulse });
        }
      } else {
        c.root.visible = false;
      }
    });

    // La pregunta y su respuesta.
    const cur = [...steps].reverse().find((s) => s.q >= 0 && tAll >= s.start && tAll < s.end + 0.6);
    banner.visible = !!cur && !crowned;
    if (cur) {
      const q = (rounds[cur.round] as Round).questions[cur.q];
      bannerText.text = q ? T[getLang()][isDigit(q.letter) ? "cQuiAskShortN" : "cQuiAskShort"](q.letter) : t("cQuiTieShort");
      const appear = ease.outBack(clamp((tAll - cur.start) / 0.3, 0, 1));
      const bw = bannerText.width + 48 * k, bh = 54 * k;
      bannerBg.clear().roundRect(-bw / 2 + 5 * k, -bh / 2 + 5 * k, bw, bh, 8 * k).fill(INK)
        .roundRect(-bw / 2, -bh / 2, bw, bh, 8 * k).fill(YELLOW).stroke({ width: 3 * k, color: INK });
      banner.position.set(g.w / 2, S.top() + (S.portrait() ? 100 : 50) * k);
      banner.scale.set(appear);
      const ans = clamp((tAll - cur.answer) / 0.2, 0, 1);
      stamp.visible = stampBg.visible = !!q && ans > 0;
      if (q && ans > 0) {
        stamp.text = q.has ? t("cQuiSi") : t("cQuiNoStamp");
        const sw = stamp.width + 26 * k, sh = 44 * k;
        // En el celular el sello va debajo de la pregunta: al costado se cortaba.
        const sx = S.portrait() ? 0 : bw / 2 + sw / 2 + 12 * k;
        const sy = S.portrait() ? bh / 2 + sh / 2 + 6 * k : 0;
        stamp.position.set(sx, sy);
        stamp.rotation = -0.12;
        stampBg.clear().roundRect(sx - sw / 2, sy - sh / 2, sw, sh, 6 * k).fill(q.has ? 0x17c3b2 : 0xff5cb3).stroke({ width: 3 * k, color: INK });
        stampBg.rotation = 0;
        stamp.scale.set(1 + 0.6 * (1 - ease.outBack(ans)));
      }
    }

    // El contador: cuántas cartas siguen.
    counter.text = `${t("cQuiLeft")}  ${alive(ri, tAll).length} / ${r.pool.length}`;
    const bw = counter.width + 40 * k, bh = 40 * k;
    counter.position.set(bw / 2, bh / 2);
    counterBox.clear().rect(5 * k, 5 * k, bw, bh).fill(INK).rect(0, 0, bw, bh).fill(0x221a33).stroke({ width: 3 * k, color: INK });
    counterG.position.set(22 * k, S.top() + 10 * k);
    counterG.visible = !crowned;
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
