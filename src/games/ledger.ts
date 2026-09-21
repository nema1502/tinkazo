import { T, getLang, t } from "../i18n";
import { beep, beepFor, fanfare, note } from "../sound";
import { avatar, paceFactor, type Beacon } from "../state";
import { INK, WINNER_HOLD, clamp, ease, mount, drawWinnerPlate, flashScreen, shorten, winnerNames, winnersLabel } from "./overlay";

/**
 * Cierre de Libro.
 *
 * Stellar cierra un ledger cada cinco segundos, y esa es la frase que repiten
 * en todas las charlas. El juego dura eso: cuatro segundos y medio.
 *
 * Existe porque hay un hueco real. La ruleta se muere a los veinticuatro
 * nombres y la carrera sólo muestra ocho carriles. Acá cada participante es una
 * tarjeta, y con doscientos se ve mejor que con veinte, porque hay más que
 * barrer.
 *
 * El ganador llega dado. Lo sembrado es en qué orden caen los demás.
 */

type Phase = "fall" | "sweep" | "stamp" | "seal" | "dead";

interface Card {
  idx: number;
  /** Posición actual y destino, para el reacomodo. */
  x: number;
  y: number;
  tx: number;
  ty: number;
  w: number;
  h: number;
  tw: number;
  /** 0 mientras cae, 1 cuando está puesta. */
  in: number;
  alive: boolean;
  /** Cuándo la barrió el cierre, para la desintegración. */
  killed: number;
  bits: { x: number; y: number; vx: number; vy: number; r: number }[];
  stamp: number;
}

/**
 * Las pasadas del cierre y cuánto elimina cada una.
 *
 * Eran tres fijas, con cortes 0,62 / 0,74 / resto, y con menos de treinta
 * participantes **la tercera no eliminaba a nadie**: el narrador anunciaba
 * "¡última pasada!", la barra verde cruzaba la pantalla entera y no pasaba
 * nada. Con dieciocho personas la primera mataba once, la segunda cuatro y la
 * tercera cero, o sea que la eliminación más grande iba primero y la pasada más
 * dramática iba vacía. La curva estaba al revés.
 *
 * Ahora el plan depende de cuánta gente hay, los cortes van subiendo y ninguna
 * pasada se anuncia si no tiene a quién sacar.
 */
function sweepPlan(n: number, final: number): { from: "top" | "bottom"; cut: number }[] {
  const room = Math.max(0, n - final);
  const count = room >= 9 ? 4 : room >= 4 ? 3 : room >= 2 ? 2 : 1;
  const cuts = [[1], [0.55, 1], [0.5, 0.6, 1], [0.45, 0.55, 0.6, 1]][count - 1] as number[];
  return cuts.map((cut, i) => ({ from: i % 2 === 0 ? "top" : "bottom", cut } as const));
}

/**
 * Cuánto dura cada pasada, según cuánta gente haya.
 *
 * Con doscientos participantes el juego duraba lo mismo que con dos, así que
 * los nombres estaban en pantalla menos de dos segundos antes de que quedara
 * el podio. La sala no alcanzaba a ver a nadie. Con más gente, más tiempo de
 * barrido: hay más que mirar.
 */
const sweepDur = (n: number): number => clamp(0.8 + n / 120, 0.8, 1.6);
/** Y un respiro antes de sellar, para leer a los tres que quedaron. */
const HOLD = 0.6;

export function ledgerClose(
  names: string[],
  winners: readonly number[],
  beacon: Beacon,
  done: () => void,
): void {
  // La animación se centra en el primero; el cartel y el narrador cantan
  // a todos. Con tres premios sorteados, la sala tiene que oír tres nombres.
  const winnerIdx = winners[0] ?? 0;
  const st = mount(beacon, done, () => skip());
  if (!st) {
    done();
    return;
  }
  const { c, W, H, u, rng, color, say, dark, cleanup, run } = st;

  const n = names.length;
  /** Cuántas quedan en la mesa final. Con dos participantes, dos. */
  // Nunca tantos finalistas como participantes: con tres personas y tres
  // finalistas la única pasada del juego no elimina a nadie, que es justo el
  // problema que `sweepPlan` viene a arreglar.
  const FINAL = Math.min(3, Math.max(1, n - 1));
  const SWEEPS = sweepPlan(n, FINAL);

  const faces = new Map<number, HTMLImageElement>();
  /** El avatar de una persona, cargado una sola vez. */
  function face(idx: number): HTMLImageElement {
    let im = faces.get(idx);
    if (!im) {
      im = new Image();
      im.src = avatar(names[idx] ?? "", 64);
      faces.set(idx, im);
    }
    return im;
  }

  /**
   * Recorta el nombre a lo que entra.
   *
   * Por el medio, no por el final: dos personas con el mismo nombre de pila y
   * distinto apellido tienen que seguir viéndose distintas.
   */
  function fit(name: string, room: number): string {
    if (c.measureText(name).width <= room) return name;
    let cut = name.length;
    while (cut > 4 && c.measureText(shorten(name, cut)).width > room) cut--;
    return shorten(name, cut);
  }

  let phase: Phase = "fall";
  let tPhase = 0;
  let sweepI = 0;
  let sweepY = 0;
  let stampI = 0;
  let sealK = 0;
  let fallTicks = 0;
  let killTicks = 0;
  let ledgerBump = false;
  let tHold = 0;
  let flashK = 0;

  const cards: Card[] = names.map((_, i) => ({
    idx: i, x: 0, y: 0, tx: 0, ty: 0, w: 0, h: 0, tw: 0,
    in: 0, alive: true, killed: 0, bits: [], stamp: 0,
  }));

  /**
   * El orden en que caen las tarjetas.
   *
   * Cada pasada elimina a las que están más abajo de esta lista, así que acá
   * se decide quién sobrevive a la segunda ronda. El ganador se pone primero
   * para que nunca lo barran: el resultado no lo decide este archivo.
   */
  const rank = cards.map((q) => q.idx).filter((i) => i !== winnerIdx);
  for (let i = rank.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [rank[i], rank[j]] = [rank[j] as number, rank[i] as number];
  }
  rank.unshift(winnerIdx);
  const rankOf = new Map(rank.map((idx, pos) => [idx, pos]));

  layout(n);

  /** Acomoda las `m` tarjetas vivas en una grilla centrada. */
  function layout(m: number): void {
    const k = u();
    const w = W();
    const h = H();
    const alive = cards.filter((q) => q.alive);
    const cols = Math.max(1, Math.ceil(Math.sqrt(m * 1.7)));
    const rows = Math.ceil(m / cols);
    const gap = 8 * k;
    const cw = clamp((w * 0.86) / cols - gap, 34 * k, 260 * k);
    const ch = cw * 0.36;
    const gw = cols * (cw + gap) - gap;
    const gh = rows * (ch + gap) - gap;
    const x0 = w / 2 - gw / 2;
    const y0 = h / 2 - gh / 2;
    alive.forEach((q, i) => {
      q.tx = x0 + (i % cols) * (cw + gap);
      q.ty = y0 + Math.floor(i / cols) * (ch + gap);
      q.tw = cw;
      q.h = ch;
      if (q.w === 0) {
        q.w = cw;
        // Caen desde arriba, escalonadas por su puesto en el orden sembrado.
        q.x = q.tx;
        q.y = -ch - rng() * h * 0.5;
      }
    });
  }

  function kill(q: Card): void {
    q.alive = false;
    q.killed = 0;
    const k = u();
    // Se desintegra en cuatro cuadraditos que caen rotando.
    for (let i = 0; i < 4; i++) {
      q.bits.push({
        x: q.x + (i % 2) * (q.w / 2),
        y: q.y + Math.floor(i / 2) * (q.h / 2),
        vx: (rng() - 0.5) * 220 * k,
        vy: -rng() * 120 * k,
        r: (rng() - 0.5) * 6,
      });
    }
    killTicks++;
    // Cada ocho bajas: con dieciocho participantes se oía **una sola vez** en
    // todo el juego. Cada tres, y en dos notas que alternan.
    if (killTicks % 3 === 0) beep(note(killTicks % 6 === 0 ? 10 : 12), 0.03, "square", 0.022);
  }

  function startSweep(): void {
    phase = "sweep";
    tPhase = 0;
    // 180, 270 y 400 Hz son tres alturas sin relación entre ellas ni con la
    // escala, y duraban 0,8 s reales para tapar una pasada de 1,33 s: medio
    // segundo de barra avanzando en silencio, y 1,29 s en épico. Ahora sube un
    // grado por pasada y dura lo que dura la barra, en cualquier ritmo.
    setTimeout(() => beepFor(note(sweepI), sweepDur(n) + 0.15, "sawtooth", 0.03), 90);
    const last = sweepI === SWEEPS.length - 1;
    const key = last ? "cLedgerSweep3" : sweepI === 0 ? "cLedgerSweep" : "cLedgerSweep2";
    say(t(key), 0.2 + (sweepI / Math.max(1, SWEEPS.length - 1)) * 0.6);
  }

  /** Cuántas sobreviven a la pasada `i`. */
  function survivors(i: number): number {
    const alive = cards.filter((q) => q.alive).length;
    if (i >= SWEEPS.length - 1) return FINAL;
    const cut = SWEEPS[i]?.cut ?? 0.6;
    // Piso: hay que dejarle gente a las pasadas que faltan, una por cabeza.
    // Techo: ésta también tiene que sacar a alguien. Entre los dos, el corte.
    const left = SWEEPS.length - 1 - i;
    const ceilK = Math.max(FINAL, alive - 1);
    const floorK = Math.min(FINAL + left, ceilK);
    return clamp(Math.round(alive * (1 - cut)), floorK, ceilK);
  }

  function endSweep(): void {
    const keep = survivors(sweepI);
    const alive = cards.filter((q) => q.alive).sort((a, b) => (rankOf.get(a.idx) ?? 0) - (rankOf.get(b.idx) ?? 0));
    alive.slice(keep).forEach(kill);
    layout(keep);
    beep(note(12), 0.12, "triangle", 0.05);
    sweepI++;
    if (sweepI >= SWEEPS.length) {
      phase = "stamp";
      tPhase = 0;
      stampI = 0;
      say(t("cLedgerFinal"), 0.8);
    } else {
      startSweep();
    }
  }

  function toSeal(): void {
    phase = "seal";
    tPhase = 0;
    sealK = 0;
    flashK = 1;
    say(T[getLang()].cWin(winnersLabel(names, winners)), 1);
    fanfare();
    // Después del acorde, no dentro: a 0 ms quedaba enmascarado por la fanfarria.
    setTimeout(() => beep(note(18), 0.12, "triangle", 0.045), 520);
  }

  /** Saltar deja la misma imagen final: la ganadora sellada, sola. */
  function skip(): void {
    if (phase === "seal" || phase === "dead") return;
    cards.forEach((q) => {
      if (q.idx !== winnerIdx && q.alive) kill(q);
    });
    layout(1);
    const win = cards[winnerIdx] as Card;
    win.in = 1;
    win.x = win.tx;
    win.y = win.ty;
    win.w = win.tw;
    sweepI = SWEEPS.length;
    toSeal();
  }

  function update(dt: number): void {
    tPhase += dt;

    for (const q of cards) {
      if (q.alive) {
        // Overshoot al caer, y un snap corto al reacomodarse.
        q.in = Math.min(1, q.in + dt * 2.2);
        const sp = Math.min(1, dt * 12);
        q.x += (q.tx - q.x) * sp;
        q.y += (q.ty - q.y) * sp;
        q.w += (q.tw - q.w) * sp;
      } else {
        q.killed += dt;
        const k = u();
        for (const b of q.bits) {
          b.vy += 900 * k * dt;
          b.x += b.vx * dt;
          b.y += b.vy * dt;
          b.r += dt * 4;
        }
      }
      if (q.stamp > 0) q.stamp = Math.min(1, q.stamp + dt * 8);
    }

    if (phase === "fall") {
      const want = Math.floor(clamp(tPhase / 0.8, 0, 1) * Math.min(24, n));
      while (fallTicks < want) {
        // Sumar siete hercios por tarjeta es una máquina contando, y a 0,012 de
        // volumen no se oía: eran dieciocho de los treinta y tres sonidos del
        // juego, todos inaudibles.
        beep(note(fallTicks % 2 === 0 ? 3 : 4), 0.045, "square", 0.028);
        fallTicks++;
      }
      if (tPhase >= 0.8) startSweep();
      return;
    }

    if (phase === "sweep") {
      const p = clamp(tPhase / sweepDur(n), 0, 1);
      const dir = SWEEPS[sweepI]?.from ?? "top";
      sweepY = dir === "top" ? p * H() : (1 - p) * H();
      if (p >= 1) endSweep();
      return;
    }

    if (phase === "stamp") {
      // Un respiro para leer a los que quedaron, y recién ahí los sellos, de a
      // uno cada 0,33 s. La ganadora queda última.
      if (tPhase < HOLD) return;
      const losers = cards.filter((q) => q.alive && q.idx !== winnerIdx);
      const want = Math.floor((tPhase - HOLD) / 0.33);
      while (stampI < want && stampI < losers.length) {
        const q = losers[stampI] as Card;
        q.stamp = 0.001;
        // 140 Hz es un do sostenido fuera de escala, y además era el golpe más
        // fuerte de media partida. El cuerpo abajo y lo que se oye arriba.
        beep(note(0), 0.1, "square", 0.07);
        beep(note(5), 0.18, "sine", 0.05);
        stampI++;
      }
      if (stampI >= losers.length && tPhase >= HOLD + losers.length * 0.33 + 0.35) toSeal();
      return;
    }

    if (phase === "seal") {
      sealK = Math.min(1, sealK + dt * 2.2);
      if (!ledgerBump && sealK >= 0.5) {
        ledgerBump = true;
        // Sonaba fuerte para un número de trece píxeles que nadie mira, encima
        // del sello final. Queda apenas como un roce.
        beep(note(14), 0.06, "triangle", 0.025);
      }
      // En segundos reales: eran 1,5 s de juego, o sea 1,2 s en modo rápido.
      tHold += dt * paceFactor();
      flashK = Math.max(0, flashK - dt * paceFactor() * 4);
      if (tHold >= WINNER_HOLD) {
        phase = "dead";
        cleanup();
      }
    }
  }

  // -------------------------------------------------------------------- dibujo
  function drawPaper(now: number): void {
    const k = u();
    c.fillStyle = dark ? "#221a33" : "#fff6e9";
    c.fillRect(0, 0, W(), H());
    // Trama de puntos que baja: papel de contador, en movimiento.
    const step = 22 * k;
    const off = (now * 6 * k) % step;
    c.fillStyle = dark ? "rgba(246,239,226,0.06)" : "rgba(25,25,25,0.06)";
    for (let y = -step + off; y < H(); y += step) {
      for (let x = 0; x < W(); x += step) c.fillRect(x, y, 2 * k, 2 * k);
    }
  }

  function drawCard(q: Card): void {
    const k = u();
    if (!q.alive) {
      // Se van rápido y en su propio color: grises y grandes tapaban la mesa.
      const a = Math.max(0, 1 - q.killed * 2.6);
      if (a <= 0) return;
      c.globalAlpha = a * 0.7;
      c.fillStyle = color(q.idx);
      const s = a;
      for (const b of q.bits) {
        c.save();
        c.translate(b.x, b.y);
        c.rotate(b.r);
        c.fillRect(0, 0, (q.w / 2) * s, (q.h / 2) * s);
        c.restore();
      }
      c.globalAlpha = 1;
      return;
    }
    const e = ease.outBack(clamp(q.in, 0, 1));
    const w = q.w * (0.94 + 0.06 * e);
    const h = q.h * (0.94 + 0.06 * e);
    c.fillStyle = INK;
    c.fillRect(q.x + 4 * k, q.y + 4 * k, w, h);
    c.fillStyle = dark ? "#2d2342" : "#ffffff";
    c.fillRect(q.x, q.y, w, h);
    c.lineWidth = 3 * k;
    c.strokeStyle = INK;
    c.strokeRect(q.x, q.y, w, h);

    const col = color(q.idx);
    // La barra de color a la izquierda es la firma de la transacción: está
    // siempre, con la tarjeta grande y con la chica.
    c.fillStyle = col;
    c.fillRect(q.x + 5 * k, q.y + 5 * k, 6 * k, h - 10 * k);

    // Con la tarjeta chica el nombre no entra. Quedan dos rayitas que se leen
    // como texto sin serlo, y la tarjeta sigue pareciendo una transacción.
    if (w > 110 * k) {
      const av = Math.min(h * 0.62, 24 * k);
      const im = face(q.idx);
      if (im.complete && im.naturalWidth) c.drawImage(im, q.x + 16 * k, q.y + (h - av) / 2, av, av);
      const name = names[q.idx] ?? "";
      const tx = q.x + 16 * k + av + 8 * k;
      const room = q.x + w - 12 * k - tx;
      c.font = `700 ${Math.min(22 * k, h * 0.34)}px system-ui, sans-serif`;
      c.textAlign = "left";
      c.textBaseline = "middle";
      c.fillStyle = dark ? "#f6efe2" : INK;
      c.fillText(fit(name, room), tx, q.y + h / 2);
      c.textBaseline = "alphabetic";
    } else {
      c.fillStyle = dark ? "rgba(246,239,226,0.32)" : "rgba(25,25,25,0.22)";
      c.fillRect(q.x + 16 * k, q.y + h * 0.33, w - 26 * k, 3 * k);
      c.fillRect(q.x + 16 * k, q.y + h * 0.58, (w - 26 * k) * 0.55, 3 * k);
    }

    if (q.stamp > 0) drawStamp(q, false);
  }

  function drawStamp(q: Card, ok: boolean): void {
    const k = u();
    const e = 2.4 - 1.4 * ease.outCubic(Math.min(1, q.stamp));
    const s = Math.min(q.w * 0.5, q.h * 0.78) * e;
    // Pegado al borde derecho: centrado tapaba el nombre justo cuando la sala
    // lo está leyendo.
    const cx = q.x + q.w - Math.min(q.w * 0.28, q.h * 0.5);
    const cy = q.y + q.h / 2;
    c.save();
    c.translate(cx, cy);
    c.rotate(-0.14);
    c.lineWidth = 4 * k;
    c.strokeStyle = ok ? "#00a896" : "#e93d9c";
    c.strokeRect(-s / 2, -s / 2, s, s);
    c.beginPath();
    if (ok) {
      c.moveTo(-s * 0.25, 0);
      c.lineTo(-s * 0.05, s * 0.22);
      c.lineTo(s * 0.28, -s * 0.22);
    } else {
      c.moveTo(-s * 0.25, -s * 0.25);
      c.lineTo(s * 0.25, s * 0.25);
      c.moveTo(s * 0.25, -s * 0.25);
      c.lineTo(-s * 0.25, s * 0.25);
    }
    c.stroke();
    c.restore();
  }

  function drawSweep(): void {
    const k = u();
    const dir = SWEEPS[sweepI]?.from ?? "top";
    const grad = 60 * k;
    const g = c.createLinearGradient(0, sweepY - (dir === "top" ? grad : -grad), 0, sweepY);
    g.addColorStop(0, "rgba(0,168,150,0)");
    g.addColorStop(1, "rgba(0,168,150,0.45)");
    c.fillStyle = g;
    c.fillRect(0, Math.min(sweepY, sweepY - (dir === "top" ? grad : -grad)), W(), grad);
    c.fillStyle = "#00a896";
    c.fillRect(0, sweepY - 7 * k, W(), 14 * k);
    c.fillStyle = INK;
    c.fillRect(0, sweepY - 9 * k, W(), 3 * k);
    c.fillRect(0, sweepY + 7 * k, W(), 3 * k);
  }

  function drawHud(): void {
    const k = u();
    c.font = `700 ${13 * k}px ui-monospace, Consolas, monospace`;
    c.textAlign = "left";
    c.fillStyle = dark ? "rgba(246,239,226,0.6)" : "rgba(25,25,25,0.55)";
    const round = beacon.round + (ledgerBump ? 1 : 0);
    c.fillText(`${t("cLedgerNo")} #${round}`, 22 * k, H() - 26 * k);
  }

  function drawSeal(): void {
    const k = u();
    const win = cards[winnerIdx] as Card;
    const e = ease.outBack(Math.min(1, sealK));
    // La tarjeta ganadora no es "la misma un poco más grande": cambia de color
    // y de tamaño, porque es lo único que la sala tiene que mirar.
    const cw = win.w * (1 + 1.4 * e);
    const ch = win.h * (1 + 1.4 * e);
    const cx = W() / 2 - cw / 2;
    const cy = win.y + win.h / 2 - ch / 2;
    c.fillStyle = "#e93d9c";
    c.fillRect(cx + 10 * k, cy + 10 * k, cw, ch);
    c.fillStyle = "#ffc629";
    c.fillRect(cx, cy, cw, ch);
    c.lineWidth = 6 * k;
    c.strokeStyle = INK;
    c.strokeRect(cx, cy, cw, ch);

    const name = names[winnerIdx] ?? "";
    const av = ch * 0.62;
    const im = face(winnerIdx);
    if (im.complete && im.naturalWidth) c.drawImage(im, cx + 20 * k, cy + (ch - av) / 2, av, av);
    c.font = `900 ${Math.min(52 * k, ch * 0.5)}px system-ui, sans-serif`;
    c.textAlign = "left";
    c.textBaseline = "middle";
    c.fillStyle = INK;
    const tx = cx + 20 * k + av + 14 * k;
    c.fillText(fit(name, cx + cw - 20 * k - tx), tx, cy + ch / 2);
    c.textBaseline = "alphabetic";

    const label = t("cLedgerOk");
    c.font = `900 ${34 * k}px system-ui, sans-serif`;
    c.textAlign = "center";
    const bw = c.measureText(label).width + 48 * k;
    const bh = 62 * k;
    const bx = W() / 2 - bw / 2;
    const by = cy + ch + 34 * k;
    c.globalAlpha = Math.min(1, sealK * 1.6);
    c.fillStyle = INK;
    c.fillRect(bx + 7 * k, by + 7 * k, bw, bh);
    c.fillStyle = "#00a896";
    c.fillRect(bx, by, bw, bh);
    c.lineWidth = 5 * k;
    c.strokeStyle = INK;
    c.strokeRect(bx, by, bw, bh);
    c.fillStyle = INK;
    c.textBaseline = "middle";
    c.fillText(label, W() / 2, by + bh / 2);
    c.textBaseline = "alphabetic";
    c.globalAlpha = 1;
  }

  run((dt, now) => {
    update(dt);
    drawPaper(now);
    for (const q of cards) if (!q.alive) drawCard(q);
    // En el sello las perdedoras se apagan: si no, asoman por detrás de la
    // tarjeta amarilla y le roban la foto.
    if (phase === "seal") c.globalAlpha = Math.max(0, 1 - sealK * 1.6);
    for (const q of cards) {
      if (!q.alive) continue;
      if (phase === "seal" && q.idx === winnerIdx) continue;
      drawCard(q);
    }
    c.globalAlpha = 1;
    if (phase === "sweep") drawSweep();
      // El fogonazo del revelado: el golpe visual que separa "apareció un
      // nombre" de "pasó algo". Va debajo del cartel, no encima.
    flashScreen(c, W(), H(), flashK);
    if (phase === "seal") drawSeal();
    drawHud();
  });
}
