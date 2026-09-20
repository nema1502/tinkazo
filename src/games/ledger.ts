import { T, getLang, t } from "../i18n";
import { beep, fanfare } from "../sound";
import type { Beacon } from "../state";
import { INK, clamp, ease, mount } from "./overlay";

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

/** Las tres pasadas del cierre y cuánto elimina cada una. */
const SWEEPS = [
  { from: "top", cut: 0.62 },
  { from: "bottom", cut: 0.74 },
  { from: "top", cut: 1 },
] as const;

export function ledgerClose(
  names: string[],
  winnerIdx: number,
  beacon: Beacon,
  done: () => void,
): void {
  const st = mount(beacon, done, () => skip());
  if (!st) {
    done();
    return;
  }
  const { c, W, H, u, rng, color, say, chip, dark, cleanup, run } = st;

  const n = names.length;
  /** Cuántas quedan en la mesa final. Con dos participantes, dos. */
  const FINAL = Math.min(3, n);

  let phase: Phase = "fall";
  let tPhase = 0;
  let sweepI = 0;
  let sweepY = 0;
  let stampI = 0;
  let sealK = 0;
  let fallTicks = 0;
  let killTicks = 0;
  let ledgerBump = false;

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
    if (killTicks % 8 === 0) beep(200 + (killTicks % 5) * 40, 0.02, "square", 0.02);
  }

  function startSweep(): void {
    phase = "sweep";
    tPhase = 0;
    const tone = [180, 270, 400][sweepI] ?? 400;
    beep(tone, 0.8, "sawtooth", 0.035);
    say(t(sweepI === 0 ? "cLedgerSweep" : sweepI === 1 ? "cLedgerSweep2" : "cLedgerSweep3"));
  }

  /** Cuántas sobreviven a la pasada `i`. */
  function survivors(i: number): number {
    const alive = cards.filter((q) => q.alive).length;
    if (i >= SWEEPS.length - 1) return FINAL;
    const cut = SWEEPS[i]?.cut ?? 0.6;
    return Math.max(FINAL, Math.round(alive * (1 - cut)));
  }

  function endSweep(): void {
    const keep = survivors(sweepI);
    const alive = cards.filter((q) => q.alive).sort((a, b) => (rankOf.get(a.idx) ?? 0) - (rankOf.get(b.idx) ?? 0));
    alive.slice(keep).forEach(kill);
    layout(keep);
    beep(660, 0.08, "triangle", 0.04);
    sweepI++;
    if (sweepI >= SWEEPS.length) {
      phase = "stamp";
      tPhase = 0;
      stampI = 0;
      say(t("cLedgerFinal"));
    } else {
      startSweep();
    }
  }

  function toSeal(): void {
    phase = "seal";
    tPhase = 0;
    sealK = 0;
    say(T[getLang()].cWin(names[winnerIdx] ?? ""));
    fanfare();
    beep(1568, 0.1, "triangle", 0.04);
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
        beep(300 + fallTicks * 7, 0.02, "square", 0.012);
        fallTicks++;
      }
      if (tPhase >= 0.8) startSweep();
      return;
    }

    if (phase === "sweep") {
      const p = clamp(tPhase / 0.8, 0, 1);
      const dir = SWEEPS[sweepI]?.from ?? "top";
      sweepY = dir === "top" ? p * H() : (1 - p) * H();
      if (p >= 1) endSweep();
      return;
    }

    if (phase === "stamp") {
      // Los sellos de a uno cada 0,33 s. La ganadora queda última.
      const losers = cards.filter((q) => q.alive && q.idx !== winnerIdx);
      const want = Math.floor(tPhase / 0.33);
      while (stampI < want && stampI < losers.length) {
        const q = losers[stampI] as Card;
        q.stamp = 0.001;
        beep(140, 0.14, "square", 0.06);
        stampI++;
      }
      if (stampI >= losers.length && tPhase >= losers.length * 0.33 + 0.35) toSeal();
      return;
    }

    if (phase === "seal") {
      sealK = Math.min(1, sealK + dt * 2.2);
      if (!ledgerBump && sealK >= 0.5) {
        ledgerBump = true;
        beep(880, 0.04, "square", 0.03);
      }
      if (tPhase >= 1.5) {
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
      const a = Math.max(0, 1 - q.killed * 1.6);
      if (a <= 0) return;
      c.globalAlpha = a;
      c.fillStyle = "#8a8378";
      for (const b of q.bits) {
        c.save();
        c.translate(b.x, b.y);
        c.rotate(b.r);
        c.fillRect(0, 0, q.w / 2, q.h / 2);
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
    // Con la tarjeta chica el texto no entra: queda el avatar y la barra de
    // color, que igual se lee como "una transacción".
    const big = w > 90 * k;
    const av = Math.min(h * 0.6, 22 * k);
    const name = names[q.idx] ?? "";
    if (big) {
      chip(name, q.x + 10 * k, q.y + h * 0.5 + 5 * k, 1);
      for (let i = 0; i < 3; i++) {
        c.fillStyle = col;
        c.fillRect(q.x + w - (30 - i * 9) * k, q.y + 8 * k, 4 * k, h - 16 * k);
      }
    } else {
      c.fillStyle = col;
      c.fillRect(q.x + 6 * k, q.y + 6 * k, 5 * k, h - 12 * k);
      c.fillStyle = dark ? "rgba(246,239,226,0.35)" : "rgba(25,25,25,0.25)";
      c.fillRect(q.x + 16 * k, q.y + h * 0.3, w - 24 * k, 3 * k);
      c.fillRect(q.x + 16 * k, q.y + h * 0.55, (w - 24 * k) * 0.6, 3 * k);
      void av;
    }

    if (q.stamp > 0) drawStamp(q, false);
  }

  function drawStamp(q: Card, ok: boolean): void {
    const k = u();
    const e = 2.4 - 1.4 * ease.outCubic(Math.min(1, q.stamp));
    const cx = q.x + q.w / 2;
    const cy = q.y + q.h / 2;
    const s = Math.min(q.w, q.h) * 0.7 * e;
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
    c.fillText(`${t("cLedgerNo")} #${round}`, 22 * k, 34 * k);
  }

  function drawSeal(): void {
    const k = u();
    const win = cards[winnerIdx] as Card;
    const e = ease.outBack(Math.min(1, sealK));
    c.save();
    c.translate(win.x + win.w / 2, win.y + win.h / 2);
    c.scale(1 + 0.18 * e, 1 + 0.18 * e);
    c.translate(-(win.x + win.w / 2), -(win.y + win.h / 2));
    drawCard(win);
    c.restore();
    win.stamp = 1;
    drawStamp(win, true);
    win.stamp = 0;

    const label = t("cLedgerOk");
    c.font = `900 ${34 * k}px system-ui, sans-serif`;
    c.textAlign = "center";
    const bw = c.measureText(label).width + 48 * k;
    const bh = 62 * k;
    const bx = W() / 2 - bw / 2;
    const by = win.y + win.h + 34 * k;
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
    for (const q of cards) {
      if (!q.alive) continue;
      if (phase === "seal" && q.idx === winnerIdx) continue;
      drawCard(q);
    }
    if (phase === "sweep") drawSweep();
    if (phase === "seal") drawSeal();
    drawHud();
  });
}
