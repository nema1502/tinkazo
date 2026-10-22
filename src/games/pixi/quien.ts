import { Container, Graphics, Sprite, Text } from "pixi.js";
import { T, getLang, t } from "../../i18n";
import { paceFactor, setGameLength, type Beacon } from "../../state";
import { beep, fanfare, note } from "../../sound";
import { WINNER_HOLD, clamp, ease, winnersLabel } from "../overlay";
import { writeStory } from "../drama";
import { CREAM, INK, MONO, YELLOW, mountPixi, type PixiStage } from "./stage";
import { planRounds, type Question, type Round } from "./quien-plan";

/**
 * De pie (antes ¿Quién es?).
 *
 * La sala se para. En cada turno aparece la pregunta sobre el nombre ("¿TU
 * NOMBRE TIENE LA R?"), cada uno la revisa en silencio, y después se contesta
 * por quien ganó: "¡SÍ! Se sientan los que no la tienen". La sala se sienta, y
 * recién entonces la pantalla da vuelta las cartas de los que se sentaron, como
 * un árbitro que confirma. Quedan de pie los que siguen; con cuatro o menos,
 * "¡Finalistas, que los vean!"; la última pregunta deja a uno solo, que es el
 * ganador.
 *
 * No decide nada: el ganador sale del protocolo antes, y las preguntas se
 * eligen sabiendo quién es (`quien-plan.ts`, puro y probado). Aguanta de 8 a
 * 200 personas: cada pregunta parte el grupo cerca de la mitad, así que 50
 * nombres son unas seis y 200 unas ocho.
 *
 * Nació del Ahorcado que propuso Guido Salazar (@GuidoSV7) el 1 de octubre de
 * 2026. Las preguntas son de letra, de número, de la mitad del abecedario y del
 * largo; el juego no muestra el nombre escondido ni delata con el foco.
 *
 * Todo sale de la hora del juego (`dt`).
 */

/**
 * La sala se para y se da la regla (primera ronda); en las siguientes, la sala
 * ya sabe el ritmo: el reparto, la revisión y el aplauso son más cortos. Así
 * tres premios no pasan de la ventana de la duración.
 */
const T_DEAL = 2.6;
const T_NEXT = 1.2;
const REVISAR = 2.6;
const REVISAR_NEXT = 2.2;
/** Después de la respuesta, la sala se sienta; recién entonces las cartas se dan vuelta. */
const SIT = 1.0;
const FLIP = 0.55;
const REGROUP = 0.6;
/** Con cuatro o menos de pie: el momento para que los vean, con el aplauso. */
const FIN = 3.2;
const FIN_NEXT = 2.4;
/** El empate de letras: la pantalla lo dice y confirma con las cartas. */
const TIE_SAY = 1.2;
const FINAL_HOLD = 0.5;
const NEXT_GAP = 0.8;
/** Hasta cuántos de pie se hace el encuadre de los finalistas. */
const FINALISTAS = 4;

type Kind = "reparto" | "pregunta" | "finalistas" | "empate";

interface Step {
  kind: Kind;
  round: number;
  /** El número de pregunta dentro de la ronda (0 para los demás pasos). */
  qi: number;
  /** Cuándo empieza el paso, cuándo se contesta, cuándo se sientan las cartas, cuándo se reacomodan y cuándo termina. */
  start: number;
  answer: number;
  flip: number;
  regroup: number;
  end: number;
}

interface Ev {
  t: number;
  run: () => void;
  fired: boolean;
}

/** El pulso de la revisión: el cartel late una vez por segundo, y el sonido, dos veces. */
const TIC = 1.0;
const TIC_SONIDO = 0.5;

export async function quienPixi(names: string[], winners: readonly number[], beacon: Beacon, done: () => void): Promise<void> {
  let skipFn = (): void => {};
  const st = await mountPixi(beacon, done, () => skipFn());
  if (!st) {
    done();
    return;
  }
  const S: PixiStage = st;
  const { rng, cam } = S;
  const L = T[getLang()];
  const n = names.length;
  // Una ronda por premio, del último al primero, como en una premiación: la
  // ronda larga, con el suspenso de la última pregunta y el arco del director,
  // es la del primer premio. El cartel y el relator del final siguen con el
  // orden de `winners`. Con un solo premio no cambia nada.
  const prizes = winners.length ? [...winners].reverse() : [0];
  const total = prizes.length;
  let rounds: Round[];
  try {
    rounds = planRounds(names, prizes, rng);
  } catch {
    S.cleanup();
    return;
  }
  S.mark("quien", `${n}x${total}`);
  // El arco del director, para el último ganador: en el susto su carta se
  // medio sienta en la última pregunta y vuelve; en la tapada no se nombra a
  // los dos últimos y la cámara espera al final.
  const story = writeStory(rng, Math.max(2, n), (prizes[total - 1] as number) % Math.max(2, n));
  S.mark("arco", story.arc);
  S.mark("preguntas", rounds.map((r) => r.questions.length).join(","));

  /* ---------------------------------------------------------------- el guion */
  const steps: Step[] = [];
  const evs: Ev[] = [];
  const at = (t: number, run: () => void): void => {
    evs.push({ t, run, fired: false });
  };
  /** Los pasos de preguntas de cada ronda, por número de pregunta. */
  const pasosPregunta: Step[][] = rounds.map(() => []);
  /** Cuándo se contesta la última pregunta de la ronda grande: ahí va el respiro de la música. */
  let tt = 0;

  /** Lo que se dice al contestar una pregunta: las cartas que se sientan, y el sonido. */
  const frase = (q: Question): string =>
    q.tipo === "letra" ? L.cQuiSitL(q.valor, q.has)
      : q.tipo === "numero" ? L.cQuiSitD(q.valor, q.has)
        : q.tipo === "mitad" ? L.cQuiSitM(q.has)
          : q.tipo === "largo" ? L.cQuiSitG(Number(q.valor), q.has)
            : L.cQuiSitO(Number(q.valor), q.has);

  rounds.forEach((r, ri) => {
    const grand = ri === total - 1;
    const Q = r.questions.length;
    const reparto = ri === 0 ? T_DEAL : T_NEXT;
    steps.push({ kind: "reparto", round: ri, qi: 0, start: tt, answer: tt, flip: tt, regroup: tt, end: tt + reparto });
    at(tt, () => {
      if (ri === 0) S.say(L.cQuiStart(n), 0.15);
      else S.say(L.cQuiNext(total - ri, total), 0.3 + 0.4 * (ri / Math.max(1, total - 1)));
      for (let i = 0; i < 6; i++) setTimeout(() => beep(note(7 + (i % 3)), 0.04, "square", 0.025), i * 70);
    });
    if (ri === 0) at(tt + reparto - 1.3, () => S.say(t("cQuiRules"), 0.2));
    // Un ruido bajo a mitad del reparto: las cartas que llegan, y no hay silencio de más hasta la primera pregunta.
    at(tt + reparto * 0.5, () => beep(note(8), 0.05, "triangle", 0.025));
    tt += reparto;

    let antes = r.pool.length;
    let finDicho = false;
    r.questions.forEach((q, qi) => {
      // Cuanto más tarde la ronda, más tiempo para revisar: las primeras van rápido, las últimas, lento.
      const ultimas = qi >= Q - 2;
      const revisar = (ri === 0 ? REVISAR : REVISAR_NEXT) + (ultimas ? 0.4 : 0) + (grand && qi === Q - 1 ? 1.0 : 0);
      const s0 = tt;
      const answer = s0 + revisar;
      const flip = answer + SIT;
      const regroup = flip + FLIP + 0.1;
      const end = regroup + REGROUP;
      const paso: Step = { kind: "pregunta", round: ri, qi, start: s0, answer, flip, regroup, end };
      steps.push(paso);
      pasosPregunta[ri]?.push(paso);
      const esUltimaGrande = grand && qi === Q - 1;
      at(s0, () => {
        // La tensión de la revisión queda apenas debajo de la de la respuesta: un salto
        // grande de tensión suelta el bombo y el platillo de la música, y acá no hace falta.
        S.say(L.cQuiRevisa(ri + qi), 0.35 + 0.4 * (qi / Math.max(1, Q)));
        beep(note(9), 0.1, "triangle", 0.04);
      });
      // El tic de la revisión: como un reloj de cocina, dos por segundo. Da el pulso
      // de la espera sin señalar a nadie (el sonido no depende del nombre). En la última
      // pregunta de la ronda grande se va frenando de a poco, como el foco de antes.
      let tic = s0 + TIC_SONIDO;
      let espacio = TIC_SONIDO;
      for (let k = 1; tic < answer - 0.2; k++) {
        const enEse = tic;
        at(enEse, () => beep(note(k % 2 ? 10 : 12), 0.05, "triangle", 0.05));
        espacio = esUltimaGrande ? espacio * 1.1 : espacio;
        tic += espacio;
      }
      const decisiva = esUltimaGrande;
      at(answer, () => {
        const k = q.out.length;
        const f = frase(q);
        if (decisiva) {
          // La respuesta que decide no suena como las otras: cuerpo grave y
          // dos notas que suben, con la música recién cortada por el respiro.
          // No abre el remate: el remate queda para el cartel (auditor de
          // mezcla, 7 de octubre de 2026: −24 LU).
          beep(note(0), 0.6, "triangle", 0.09);
          beep(note(q.has ? 10 : 8), 0.4, "triangle", 0.06);
          setTimeout(() => beep(note(q.has ? 12 : 10), 0.3, "triangle", 0.05), 110);
        } else if (q.has) {
          beep(note(4), 0.12, "triangle", 0.05);
          beep(note(7), 0.18, "triangle", 0.045);
        } else {
          beep(note(3), 0.12, "triangle", 0.05);
          beep(note(-2), 0.18, "triangle", 0.045);
        }
        S.say(k ? (q.has ? L.cQuiYes(f, ri + qi) : L.cQuiNo(f, ri + qi)) : L.cQuiNone(q.has), 0.45 + 0.4 * (qi / Math.max(1, Q)));
        for (let i = 0; i < Math.min(8, k); i++) setTimeout(() => beep(note(10 - (i % 4)), 0.03, "square", 0.02), 350 + i * 45);
        cam.shake((2 + Math.min(4, k * 0.2)) * g.k);
      });
      // Las cartas que se sientan hacen un ruido corto al darse vuelta, y al reacomodarse otro más bajo: la
      // sala escucha cada paso, también cuando el pace estira el juego.
      // En la respuesta que decide no: el golpe de quien gana tiene que sonar solo (auditor de mezcla).
      if (!esUltimaGrande) {
        if (q.out.length) at(flip, () => beep(note(6), 0.05, "triangle", 0.025));
        at(regroup, () => beep(note(4), 0.05, "triangle", 0.02));
      }
      tt = end;
      // Cuando quedan cuatro o menos de pie, la sala los mira: "¡Finalistas, que los vean!".
      const quedan = q.remaining.length;
      if (!finDicho && quedan <= FINALISTAS && quedan > 1 && antes > FINALISTAS) {
        finDicho = true;
        const idx = [...q.remaining];
        const fin = ri === 0 ? FIN : FIN_NEXT;
        steps.push({ kind: "finalistas", round: ri, qi: 0, start: tt, answer: tt, flip: tt, regroup: tt, end: tt + fin });
        at(tt, () => {
          S.say(L.cQuiFinal(winnersLabel(names, idx, FINALISTAS)), 0.8);
          beep(note(7), 0.12, "triangle", 0.05);
          setTimeout(() => beep(note(10), 0.12, "triangle", 0.05), 120);
          setTimeout(() => beep(note(12), 0.2, "triangle", 0.05), 240);
        });
        // El aplauso: unos clics cada medio segundo, que no suenan a melodía.
        for (let k = 1; k * 0.5 < fin - 0.6; k++) at(tt + k * 0.5, () => beep(note(12), 0.03, "square", 0.02));
        tt += fin;
      }
      antes = quedan;
    });

    if (r.ties.length) {
      const s0 = tt;
      const topes = r.empate === "tope";
      const answer = s0 + TIE_SAY;
      const flip = answer + 0.6;
      const regroup = flip + FLIP + 0.1;
      const end = regroup + REGROUP;
      steps.push({ kind: "empate", round: ri, qi: Q, start: s0, answer, flip, regroup, end });
      at(s0, () => {
        S.say(t(topes ? "cQuiTope" : "cQuiTie"), 0.8);
        beep(note(0), 0.5, "triangle", 0.06);
      });
      tt = end;
    }
    if (!grand) {
      // El que gana un premio que no es el último se sienta con él: se lo dice la pantalla.
      const ultimo = steps[steps.length - 1];
      const cuando = ultimo ? ultimo.end - REGROUP * 0.5 : tt;
      at(cuando, () => S.say(L.cQuiDone(names[r.winner] ?? "", total - ri), 0.6));
    }
    tt += grand ? FINAL_HOLD : NEXT_GAP;
  });
  const T_CROWN = tt;
  setGameLength(T_CROWN, WINNER_HOLD);
  /**
   * La respuesta que decide: la última pregunta de la ronda del último premio.
   * La música se corta 0,4 s antes y queda en silencio hasta el cartel, que la
   * vuelve a abrir con el remate: la carta sola late sin música. Si esa ronda
   * termina en un empate no hay respuesta, y el respiro queda antes del cartel.
   */
  const grandeQ = pasosPregunta[total - 1] ?? [];
  const decisivoPaso = grandeQ.at(-1);
  const T_BREATH = decisivoPaso ? decisivoPaso.answer : T_CROWN;

  /** En qué momento se va cada carta de la ronda `ri`: el escalonado dentro de su pregunta. */
  const goneAt: Map<number, number>[] = rounds.map((r, ri) => {
    const m = new Map<number, number>();
    const qs = pasosPregunta[ri] ?? [];
    r.questions.forEach((q, qi) => {
      const s = qs[qi];
      if (!s) return;
      q.out.forEach((idx, j) => m.set(idx, s.flip + (j / Math.max(1, q.out.length)) * Math.min(0.45, 0.04 * q.out.length + 0.15)));
    });
    const tie = steps.find((s) => s.kind === "empate" && s.round === ri);
    if (tie) r.ties.forEach((idx, j) => m.set(idx, tie.flip + j * 0.12));
    return m;
  });
  /** Los que siguen de pie en la ronda `ri` al momento `t`. */
  const alive = (ri: number, t: number): number[] => {
    const r = rounds[ri] as Round;
    const m = goneAt[ri] as Map<number, number>;
    return r.pool.filter((i) => !(m.has(i) && t >= (m.get(i) as number) + FLIP));
  };
  /** Los que siguen para el acomodo: cambian recién cuando la pregunta reacomoda. */
  const layoutSet = (ri: number, t: number): number[] => {
    const r = rounds[ri] as Round;
    const pasos = steps.filter((s) => s.round === ri && (s.kind === "pregunta" || s.kind === "empate") && t >= s.regroup);
    const last = pasos.at(-1);
    if (!last) return r.pool;
    if (last.kind === "empate") return [r.winner];
    return (r.questions[last.qi] as Question).remaining;
  };
  /** El paso que está corriendo en `t`: el último que empezó. */
  const stepAt = (t: number): Step => {
    let s = steps[0] as Step;
    for (const x of steps) if (x.start <= t) s = x;
    return s;
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
  // La pregunta, grande arriba: una línea chica y otra grande; la cuenta de la revisión, abajo.
  const banner = new Container();
  const bannerBg = new Graphics();
  const bannerBar = new Graphics();
  const bannerA = S.text("", { fontSize: 20, fontWeight: "900", fill: INK });
  bannerA.anchor.set(0.5);
  const bannerB = S.text("", { fontSize: 40, fontWeight: "900", fill: INK });
  bannerB.anchor.set(0.5);
  banner.addChild(bannerBg, bannerBar, bannerA, bannerB);
  S.hud.addChild(banner);
  // El sello de la respuesta que decide, grande y en el medio del tablero.
  const bigStamp = new Container();
  const bigStampBg = new Graphics();
  const bigStampText = S.text("", { fontSize: 72, fontWeight: "900", fill: INK });
  bigStampText.anchor.set(0.5);
  bigStamp.addChild(bigStampBg, bigStampText);
  bigStamp.visible = false;
  S.hud.addChild(bigStamp);
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
  let latidoAntes = -1;

  const build = (): void => {
    g = G();
    const k = g.k;
    // Un tablero liso con un marco de colores.
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
      // El nombre completo, en dos líneas: lo que se pregunta tiene que estar a la vista.
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
      // El dorso: liso, con un signo de pregunta. Es lo que se ve de los que se sentaron.
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
    counter.style.fontSize = 14 * k;
    bigStampText.style.fontSize = 72 * k;
    lastLayout = "";
    from.clear();
    cam.cut(g.w / 2, g.h / 2, 1);
  };
  build();
  S.onResize(build);

  /* ------------------------------------------------------------------ guion hablado */
  let tAll = 0, tHold = 0, crowned = false, dead = false;
  /** "¡Uy, casi se sienta!" va una vez, a mitad del amague de la carta. */
  let casiDicho = false;
  const crownUI = S.crown(names, winners);
  function crown(): void {
    if (crowned) return;
    crowned = true;
    S.say(L.cWin(winnersLabel(names, winners), winners.length > 1), 1);
    beep(note(0), 0.7, "sine", 0.09);
    fanfare();
    setTimeout(() => beep(note(17), 0.12, "triangle", 0.045), 520);
    cam.punch(0.08).shake(10 * S.u());
  }
  skipFn = (): void => {
    if (crowned || dead) return;
    for (const e of evs) e.fired = true;
    tAll = T_CROWN;
    crown();
  };

  function script(): void {
    for (const e of evs) {
      if (!e.fired && tAll >= e.t) {
        e.fired = true;
        e.run();
      }
    }
  }

  /* -------------------------------------------------------------------- dibujo */
  function aim(): void {
    const paso = stepAt(tAll);
    const ri = paso.round;
    const set = layoutSet(ri, tAll);
    let z = 1, x = g.w / 2, y = (g.top + g.bottom) / 2;
    // Con pocas cartas de pie la cámara se acerca a ellas: los finalistas.
    if (set.length <= (story.arc === "tapada" ? 1 : FINALISTAS) && !crowned) {
      const gr = grid(set.length);
      const ps = set.map((_, i) => gr.at(i));
      x = ps.reduce((a, p) => a + p.x, 0) / ps.length;
      y = ps.reduce((a, p) => a + p.y, 0) / ps.length;
      // Nunca más cerca de lo que entra.
      const ancho = Math.max(...ps.map((p) => p.x)) - Math.min(...ps.map((p) => p.x)) + gr.cw * 1.2;
      const alto = Math.max(...ps.map((p) => p.y)) - Math.min(...ps.map((p) => p.y)) + gr.ch * 1.2;
      // La carta que queda sola es la toma del héroe antes del cartel: más cerca.
      z = Math.max(1, Math.min(set.length === 1 ? 1.55 : set.length === 2 ? 1.25 : 1.12, (g.w * 0.92) / ancho, ((g.bottom - g.top) * 0.95) / alto));
    }
    // Mientras la sala revisa su nombre o está en el aplauso, la cámara respira
    // un poco: la pantalla no se queda quieta aunque las cartas no se muevan.
    const respira = !crowned && (paso.kind === "finalistas" || (paso.kind === "pregunta" && tAll < paso.answer));
    if (respira) z += 0.012 * (1 + Math.sin(tAll * 1.2));
    x = clamp(x, g.w / 2 / z, g.w - g.w / 2 / z);
    y = clamp(y, g.h / 2 / z, g.h - g.h / 2 / z);
    cam.lookAt(x, y, z, 2.2);
  }

  /** Los textos del cartel de cada paso: la línea chica, la grande, y la cuenta de la revisión. */
  const cartel = (paso: Step, r: Round, ahora: number): { a: string; b: string; aPx: number; bPx: number; cuenta: number | null } => {
    if (paso.kind === "reparto") return { a: "", b: t("cQuiDealB"), aPx: 20, bPx: 40, cuenta: null };
    if (paso.kind === "finalistas") return { a: t("cQuiFinA"), b: t("cQuiFinB"), aPx: 20, bPx: 40, cuenta: null };
    if (paso.kind === "empate") return { a: "", b: t(r.empate === "tope" ? "cQuiTopeShort" : "cQuiTieShort"), aPx: 20, bPx: 36, cuenta: null };
    const q = r.questions[paso.qi] as Question;
    if (ahora < paso.answer) {
      const a = t(q.tipo === "orden" ? "cQuiAskAN" : "cQuiAskA");
      const b = q.tipo === "letra" ? L.cQuiAskL(q.valor)
        : q.tipo === "numero" ? L.cQuiAskD(q.valor)
          : q.tipo === "mitad" ? L.cQuiAskM()
            : q.tipo === "largo" ? L.cQuiAskG(Number(q.valor))
              : L.cQuiAskO(Number(q.valor));
      return { a, b, aPx: 20, bPx: 40, cuenta: clamp((ahora - paso.start) / Math.max(0.1, paso.answer - paso.start), 0, 1) };
    }
    return { a: t(q.has ? "cQuiSi" : "cQuiNoStamp"), b: L.cQuiSits(frase(q)), aPx: 44, bPx: 22, cuenta: null };
  };

  /**
   * Pone el cartel como lo pide el paso: los textos, el tamaño, y la cuenta de
   * la revisión. Se pinta en cada cuadro: así acompaña el tamaño de la
   * pantalla y la cuenta baja en vivo.
   */
  const pintarCartel = (c: { a: string; b: string; aPx: number; bPx: number; cuenta: number | null }): void => {
    const k = g.k;
    const maxW = g.w * 0.86 - 40 * k;
    bannerA.text = c.a;
    bannerB.text = c.b;
    bannerA.visible = c.a !== "";
    if (bannerA.style.fontSize !== c.aPx * k) bannerA.style.fontSize = c.aPx * k;
    if (bannerB.style.fontSize !== c.bPx * k) bannerB.style.fontSize = c.bPx * k;
    bannerA.scale.set(1);
    bannerB.scale.set(1);
    const fit = (tx: Text): number => (tx.width > maxW ? maxW / tx.width : 1);
    bannerA.scale.set(c.a ? fit(bannerA) : 1);
    bannerB.scale.set(fit(bannerB));
    const hA = c.a ? bannerA.height : 0, gap = c.a ? 4 * k : 0, hB = bannerB.height;
    const inner = Math.max(c.a ? bannerA.width : 0, bannerB.width);
    const padX = 30 * k, padY = 14 * k;
    const barra = c.cuenta !== null ? 16 * k : 0;
    const bw = inner + padX * 2, bh = padY * 2 + hA + gap + hB + barra;
    banner.position.set(g.w / 2, S.top() + (S.portrait() ? 100 : 50) * k);
    bannerBg.clear().roundRect(-bw / 2 + 5 * k, -bh / 2 + 5 * k, bw, bh, 8 * k).fill(INK)
      .roundRect(-bw / 2, -bh / 2, bw, bh, 8 * k).fill(YELLOW).stroke({ width: 3 * k, color: INK });
    bannerBar.clear();
    if (c.cuenta !== null) {
      // La barra de la revisión: se achica en vivo, a la vista desde el fondo de la sala.
      const y = bh / 2 - barra / 2;
      bannerBar.roundRect(-bw / 2 + padX, y - 4 * k, bw - padX * 2, 8 * k, 4 * k).fill({ color: INK, alpha: 0.18 });
      bannerBar.roundRect(-bw / 2 + padX, y - 4 * k, (bw - padX * 2) * (1 - c.cuenta), 8 * k, 4 * k).fill(INK);
    }
    bannerA.position.set(0, -bh / 2 + padY + hA / 2);
    bannerB.position.set(0, -bh / 2 + padY + hA + gap + hB / 2);
  };

  function draw(): void {
    const k = g.k;
    const paso = stepAt(tAll);
    const ri = paso.round;
    const r = rounds[ri] as Round;
    const set = layoutSet(ri, tAll);
    const key = `${ri}:${set.length}`;
    // Cuando cambia el acomodo, cada carta sale desde donde estaba y viaja
    // desde ese momento.
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
      // Al coronar queda a la vista la carta del último ganador.
      if ((crowned && !(ri === total - 1 && i === r.winner)) || (!enRonda && !winnersBefore.has(i))) {
        c.root.visible = false;
        return;
      }
      if (winnersBefore.has(i)) {
        // Los ganadores de rondas anteriores esperan arriba a la derecha, con
        // un marco amarillo: se sentaron con su premio.
        const slot = prizes.indexOf(i);
        const esperan = winnersBefore.size;
        const cel = S.portrait();
        const sep = Math.min((cel ? 54 : 70) * k, (g.w * (cel ? 0.45 : 0.25)) / Math.max(1, esperan - 1));
        // El zoom con el golpe de cámara incluido, el mismo que escala la escena.
        const z = cam.toScreen(1, 0, g.w, g.h).x - cam.toScreen(0, 0, g.w, g.h).x;
        const sx = g.w - (cel ? 34 : 46) * k - slot * sep, sy = S.top() + (cel ? 38 : 72) * k;
        c.root.visible = true;
        c.x = cam.x + (sx - g.w / 2) / z;
        c.y = cam.y + (sy - g.h / 2) / z;
        c.s = ((cel ? 0.4 : 0.5) * k) / z;
        c.back.visible = false;
        c.front.visible = true;
        c.root.position.set(c.x, c.y);
        c.root.scale.set(c.s, c.s);
        c.root.rotation = 0;
        c.root.alpha = 1;
        fx.roundRect(c.x - 60 * c.s - (4 * k) / z, c.y - 79 * c.s - (4 * k) / z, 120 * c.s + (8 * k) / z, 158 * c.s + (8 * k) / z, (8 * k) / z).stroke({ width: (4 * k) / z, color: YELLOW });
        return;
      }
      const volteoEn = gone.get(i);
      const flipping = volteoEn !== undefined && tAll >= volteoEn;
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
        // El susto: en la última pregunta la carta de quien gana se medio
        // sienta, duda y vuelve.
        const ult = pasosPregunta[ri]?.at(-1);
        if (story.arc === "susto" && ri === total - 1 && i === r.winner && ult && tAll >= ult.flip && tAll < ult.flip + 0.9) {
          const f = (tAll - ult.flip) / 0.9;
          // "¡Uy, casi se sienta!" a mitad del amague, en el reloj del juego.
          if (!casiDicho && !crowned && tAll >= ult.flip + 0.45) {
            casiDicho = true;
            S.say(L.cQuiAlmost(ri), 0.95);
          }
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
          const f = clamp((tAll - (volteoEn as number)) / FLIP, 0, 1);
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
        // Los que siguen de pie se mecen, cada uno a su ritmo: están parados, y
        // la sala no se queda quieta mientras se revisa el nombre.
        // La amplitud sigue al tamaño de la carta: con dos cartas grandes, un meneo chico no se ve.
        const vaiven = pos >= 0 && !layoutDeal ? Math.sin(tAll * 2.2 + i * 1.7) * Math.max(3, 0.06 * c.s * 158) * k : 0;
        c.root.position.set(c.x, c.y + vaiven);
        c.root.rotation = pos >= 0 && !layoutDeal ? Math.sin(tAll * 1.6 + i) * 0.025 : 0;
        c.root.scale.set(sx, c.s);
        c.root.alpha = alpha;
        // La carta de quien gana, cuando queda sola, brilla y late.
        if (set.length === 1 && i === r.winner) {
          const pulse = 0.3 + 0.2 * Math.sin(tAll * 7);
          // Cada latido de la carta sola suena, hasta que se corona.
          const latido = Math.floor(tAll * 7 / (2 * Math.PI));
          if (!crowned && latido !== latidoAntes) {
            latidoAntes = latido;
            // En triángulo y con una nota arriba: un seno de 131 Hz no lo
            // reproduce el parlante de un proyector.
            beep(note(5), 0.09, "triangle", 0.045);
            beep(note(0), 0.12, "triangle", 0.035);
          }
          fx.roundRect(c.x - 62 * c.s - 8 * k, c.y - 79 * c.s - 8 * k, 124 * c.s + 16 * k, 158 * c.s + 16 * k, 14 * k).stroke({ width: 5 * k, color: YELLOW, alpha: 0.6 + pulse });
        }
        // Los finalistas, en el aplauso, se mecen más: la pantalla no se queda quieta.
        if (paso.kind === "finalistas" && pos >= 0) {
          const latidoF = 1 + 0.05 * Math.sin(tAll * 6 + i);
          c.root.scale.set(sx * latidoF, c.s * latidoF);
        }
      } else {
        c.root.visible = false;
      }
    });

    // El cartel: la pregunta, la respuesta que sienta, o el aviso de los finalistas.
    banner.visible = !crowned;
    if (!crowned) {
      pintarCartel(cartel(paso, r, tAll));
      // Cada tic de la revisión late un poco: el cartel se mueve cada segundo, como un reloj.
      const enRevision = paso.kind === "pregunta" && tAll < paso.answer;
      const desdeTic = enRevision ? (tAll - paso.start) % TIC : 1;
      const latido = 1 + 0.03 * Math.max(0, 1 - desdeTic / 0.3);
      banner.scale.set(ease.outBack(clamp((tAll - paso.start) / 0.3, 0, 1)) * latido);
    }

    // La respuesta que decide: el sello grande en el medio del tablero, un segundo.
    const decisivo = paso.kind === "pregunta" && paso.round === total - 1 && paso.qi === r.questions.length - 1 && r.questions.length > 0;
    const sello = decisivo ? tAll - paso.answer : -1;
    if (!crowned && sello >= 0 && sello < 1.2) {
      const q = r.questions[paso.qi] as Question;
      bigStamp.visible = true;
      bigStampText.text = t(q.has ? "cQuiSi" : "cQuiNoStamp");
      const bw2 = bigStampText.width + 44 * k, bh2 = bigStampText.height + 18 * k;
      bigStampBg.clear().roundRect(-bw2 / 2 + 6 * k, -bh2 / 2 + 6 * k, bw2, bh2, 10 * k).fill(INK)
        .roundRect(-bw2 / 2, -bh2 / 2, bw2, bh2, 10 * k).fill(q.has ? 0x17c3b2 : 0xff5cb3).stroke({ width: 5 * k, color: INK });
      bigStamp.position.set(g.w / 2, (g.top + g.bottom) / 2);
      bigStamp.rotation = -0.12;
      bigStamp.scale.set(1 + 1.4 * (1 - ease.outBack(clamp(sello / 0.25, 0, 1))));
    } else {
      bigStamp.visible = false;
    }

    // El contador: cuántos siguen de pie.
    counter.text = `${t("cQuiLeft")}  ${alive(ri, tAll).length} / ${r.pool.length}`;
    const bw = counter.width + 40 * k, bh = 40 * k;
    counter.position.set(bw / 2, bh / 2);
    counterBox.clear().rect(5 * k, 5 * k, bw, bh).fill(INK).rect(0, 0, bw, bh).fill(0x221a33).stroke({ width: 3 * k, color: INK });
    counterG.position.set(22 * k, S.top() + 10 * k);
    counterG.visible = !crowned;
  }

  S.run((dt, now) => {
    tAll += dt;
    // El respiro, antes de la respuesta que decide y no antes del cartel: la
    // música se calla ahí y vuelve con el remate en el cartel.
    S.breath(tAll, T_BREATH);
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
