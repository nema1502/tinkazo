import { $ } from "../dom";
import { T, getLang, t } from "../i18n";
import { LCOLORS, avatar, instantMode, type Beacon } from "../state";
import { beep, fanfare } from "../sound";

/* Modo estadio: carrera de llamas a pantalla completa, sembrada con la semilla. */

interface Runner {
  i: number;
  name: string;
  color: string;
  x: number;
  v: number;
  n1: number;
  img: HTMLImageElement | null;
}

interface Ridge {
  dx: number;
  h: number;
  w: number;
}

let stApi: { skip: () => void } | null = null;

export function skipRace(): void {
  stApi?.skip();
}

export function stadiumRace(names: string[], winnerIdx: number, beacon: Beacon, done: () => void): void {
  if (instantMode) {
    done();
    return;
  }
  const ov = $("stadium");
  const canvas = $<HTMLCanvasElement>("race-canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    done();
    return;
  }
  const commentEl = $("commentary");
  $("st-round").textContent = `${t("seed")} ${beacon.round}`;
  ov.style.display = "block";
  document.body.style.overflow = "hidden";

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  function resize(): void {
    canvas.width = innerWidth * dpr;
    canvas.height = innerHeight * dpr;
  }
  resize();
  addEventListener("resize", resize);

  // PRNG sembrado con la aleatoriedad de drand: hasta la animación es reproducible.
  let s = parseInt(beacon.randomness.slice(0, 8), 16) | 0;
  const rng = (): number => {
    s = (s + 0x6d2b79f5) | 0;
    let q = Math.imul(s ^ (s >>> 15), 1 | s);
    q = (q + Math.imul(q ^ (q >>> 7), 61 | q)) ^ q;
    return ((q ^ (q >>> 14)) >>> 0) / 4294967296;
  };

  const dark = matchMedia("(prefers-color-scheme: dark)").matches
    ? document.documentElement.dataset.theme !== "light"
    : document.documentElement.dataset.theme === "dark";
  const cs = getComputedStyle(document.documentElement);
  const P = LCOLORS.map((v) => cs.getPropertyValue(v).trim());
  const INK = "#191919";
  const color = (k: number): string => P[k % P.length] ?? INK;

  const laneIdx = [winnerIdx];
  for (const i of names.keys()) {
    if (laneIdx.length >= Math.min(8, names.length)) break;
    if (!laneIdx.includes(i)) laneIdx.push(i);
  }
  laneIdx.sort(() => rng() - 0.5);
  const runners: Runner[] = laneIdx.map((i, k) => ({
    i, name: names[i] ?? "", color: color(k), x: 0, v: 0, n1: rng() * 7, img: null,
  }));
  runners.forEach((r) => {
    const im = new Image();
    im.src = avatar(r.name, 64);
    r.img = im;
  });
  // Arrancan justo después de la línea de salida, no cortadas en el borde
  runners.forEach((r) => { r.x = canvas.width * 0.05; });

  // Escenario sembrado
  const peaks: Ridge[] = Array.from({ length: 24 }, (_, k) => ({ dx: k * 0.09, h: 0.14 + rng() * 0.16, w: 0.07 + rng() * 0.05 }));
  const hills: Ridge[] = Array.from({ length: 18 }, (_, k) => ({ dx: k * 0.13, h: 0.05 + rng() * 0.07, w: 0.11 + rng() * 0.06 }));
  const clouds = Array.from({ length: 6 }, () => ({ x: rng(), y: 0.06 + rng() * 0.16, sc: 0.5 + rng(), sp: 4 + rng() * 8 }));
  const stars = Array.from({ length: 60 }, () => ({ x: rng(), y: rng() * 0.4, r: rng() * 1.4 + 0.4 }));

  const DUR = 15;
  let phase: "count" | "race" | "done" | "dead" = "count";
  let tPhase = 0, tRace = 0, camX = 0, shake = 0, lastLeader = -1, leadCd = 0, saidLast = false, finished = false, tFreeze = 0;
  let lastBeepN = 4;
  const winnerName = names[winnerIdx] ?? "";
  say(t("cReady"));

  function say(msg: string): void {
    commentEl.textContent = msg;
    commentEl.classList.remove("pop");
    void commentEl.offsetWidth;
    commentEl.classList.add("pop");
  }

  const W = () => canvas.width;
  const H = () => canvas.height;
  const L = () => W() * 2.6;
  const winner = (): Runner => runners.find((r) => r.i === winnerIdx) ?? (runners[0] as Runner);

  function skip(): void {
    if (finished) return;
    phase = "race";
    tRace = DUR;
    winner().x = L();
    runners.forEach((r) => {
      if (r.i !== winnerIdx) r.x = Math.min(r.x, L() - W() * 0.12) || L() * 0.9;
    });
    finishNow();
  }
  stApi = { skip };

  function finishNow(): void {
    finished = true;
    phase = "done";
    tFreeze = 0;
    shake = 1;
    say(T[getLang()].cWin(winnerName));
    fanfare();
  }

  function update(dt: number): void {
    if (phase === "count") {
      tPhase += dt;
      const n = 3 - Math.floor(tPhase);
      if (n < lastBeepN && n >= 1) { lastBeepN = n; beep(440, 0.12); }
      if (tPhase >= 3) { phase = "race"; say(t("cStart")); beep(880, 0.25, "square", 0.07); }
      return;
    }
    if (phase === "done") {
      tFreeze += dt;
      shake = Math.max(0, shake - dt * 1.4);
      if (tFreeze > 1.4) cleanup();
      return;
    }
    tRace += dt;
    const baseV = L() / DUR;
    const prog = tRace / DUR;
    const leader = runners.reduce((a, b) => (b.x > a.x ? b : a));
    for (const r of runners) {
      r.n1 += dt * (0.9 + 0.3 * (r.i % 3));
      let mult = 0.92 + 0.22 * (0.5 + 0.5 * Math.sin(r.n1 * 1.7 + r.i));
      if (r.x < leader.x - W() * 0.28) mult *= 1.22; // banda elástica: nadie se queda atrás del plano
      if (r.i === winnerIdx && prog > 0.6) mult = 1.3 + 0.15 * Math.min(1, (prog - 0.6) * 4); // sprint final
      if (r.i !== winnerIdx) {
        const cap = L() - W() * 0.055;
        r.x = Math.min(r.x + baseV * mult * dt, cap);
      } else {
        r.x += baseV * mult * dt;
      }
    }
    if (leader.i !== lastLeader && tRace > 1 && leadCd <= 0 && !saidLast) {
      lastLeader = leader.i;
      leadCd = 1.6;
      say(T[getLang()].cLead(leader.name));
      beep(660, 0.08, "triangle", 0.04);
    }
    leadCd -= dt;
    const wr = winner();
    if (!saidLast && wr.x / L() > 0.78) { saidLast = true; say(t("cLast")); beep(740, 0.1, "triangle", 0.05); }
    const camTarget = leader.x - W() * 0.4;
    camX += (Math.max(0, Math.min(camTarget, L() - W() * 0.86)) - camX) * Math.min(1, dt * 2.6);
    if (wr.x >= L()) finishNow();
  }

  function drawScene(): void {
    const c = ctx as CanvasRenderingContext2D;
    const w = W(), h = H(), u = h / 720;
    const shx = shake ? (rng() - 0.5) * 14 * shake * u : 0;
    const shy = shake ? (rng() - 0.5) * 10 * shake * u : 0;
    c.save();
    c.translate(shx, shy);
    // Cielo
    const sky = c.createLinearGradient(0, 0, 0, h * 0.62);
    if (dark) { sky.addColorStop(0, "#141032"); sky.addColorStop(1, "#3a1d5c"); }
    else { sky.addColorStop(0, "#8fd3ff"); sky.addColorStop(1, "#ffe9c4"); }
    c.fillStyle = sky;
    c.fillRect(-20, -20, w + 40, h * 0.64 + 20);
    if (dark) {
      c.fillStyle = "rgba(255,255,255,0.8)";
      for (const st of stars) { c.beginPath(); c.arc(st.x * w, st.y * h, st.r * u, 0, 7); c.fill(); }
      c.fillStyle = "#f6efe2";
      c.beginPath(); c.arc(w * 0.82, h * 0.14, 34 * u, 0, 7); c.fill();
    } else {
      c.fillStyle = "#ffd24d";
      c.beginPath(); c.arc(w * 0.82, h * 0.15, 44 * u, 0, 7); c.fill();
      c.lineWidth = 3 * u; c.strokeStyle = INK; c.stroke();
    }
    // Nubes
    c.fillStyle = dark ? "rgba(255,255,255,0.14)" : "rgba(255,255,255,0.9)";
    const tNow = performance.now() / 1000;
    for (const cl of clouds) {
      const cx = ((cl.x * w * 3 - camX * 0.12 - tNow * cl.sp * u) % (w + 300 * u)) - 150 * u;
      const cy = cl.y * h;
      c.beginPath();
      c.ellipse(cx, cy, 60 * cl.sc * u, 16 * cl.sc * u, 0, 0, 7);
      c.ellipse(cx + 34 * cl.sc * u, cy - 8 * cl.sc * u, 40 * cl.sc * u, 13 * cl.sc * u, 0, 0, 7);
      c.fill();
    }
    // Montañas (parallax lejano) — terminan en el horizonte, no bajo la pista
    c.fillStyle = dark ? "#241b4a" : "#b98ad1";
    drawRange(peaks, 0.22, 0.425, w, h);
    // Cerros (parallax medio)
    c.fillStyle = dark ? "#1d2a3f" : "#7fc07a";
    drawRange(hills, 0.5, 0.43, w, h);
    // Pista
    const trackTop = h * 0.42, trackH = h * 0.5;
    c.fillStyle = dark ? "#2b2140" : "#e9c797";
    c.fillRect(-20, trackTop, w + 40, trackH + 40);
    // Banderines al borde
    for (let k = 0; k * 260 * u < L() + w; k++) {
      const fx = k * 260 * u - camX;
      if (fx < -40 || fx > w + 40) continue;
      c.fillStyle = INK;
      c.fillRect(fx, trackTop - 58 * u, 4 * u, 58 * u);
      c.fillStyle = color(k);
      c.beginPath();
      c.moveTo(fx + 4 * u, trackTop - 56 * u);
      c.lineTo(fx + 40 * u, trackTop - 46 * u);
      c.lineTo(fx + 4 * u, trackTop - 36 * u);
      c.closePath(); c.fill();
      c.lineWidth = 2 * u; c.strokeStyle = INK; c.stroke();
    }
    // Carriles
    const lanes = runners.length, laneH = trackH / lanes;
    c.strokeStyle = dark ? "rgba(246,239,226,0.25)" : "rgba(25,25,25,0.3)";
    c.lineWidth = 2 * u; c.setLineDash([18 * u, 16 * u]);
    for (let li = 1; li < lanes; li++) {
      c.beginPath();
      c.moveTo(0, trackTop + li * laneH);
      c.lineTo(w, trackTop + li * laneH);
      c.stroke();
    }
    c.setLineDash([]);
    // Línea de salida y arco de meta
    const startX = 40 * u - camX;
    if (startX > -20 && startX < w + 20) { c.fillStyle = dark ? "#f6efe2" : INK; c.fillRect(startX, trackTop, 4 * u, trackH); }
    const finX = L() - camX;
    if (finX > -80 && finX < w + 120) {
      c.fillStyle = INK;
      c.fillRect(finX, trackTop - 70 * u, 8 * u, trackH + 70 * u);
      const sq = 12 * u;
      for (let yy = 0; yy < 3; yy++)
        for (let xx = 0; xx < Math.ceil(trackH / sq) + 1; xx++) {
          c.fillStyle = (xx + yy) % 2 ? "#fff" : INK;
          c.fillRect(finX + 8 * u, trackTop - 70 * u + yy * sq, sq, sq);
        }
      // banda vertical cuadriculada en la meta
      for (let yy = 0; yy < Math.ceil((trackH + 70 * u) / sq); yy++) {
        c.fillStyle = yy % 2 ? "#fff" : INK;
        c.fillRect(finX + 2 * u, trackTop - 70 * u + yy * sq, 4 * u, sq);
      }
    }
    // Llamas
    runners.forEach((r, k) => {
      const ly = trackTop + k * laneH + laneH * 0.5;
      const lx = r.x - camX;
      if (lx < -140 || lx > w + 140) return;
      const sc = (laneH * 0.62) / 26;
      const bob = phase === "race" ? Math.sin(tRace * 16 + k * 2) * 3 * u : 0;
      drawLlama(lx, ly - 8 * sc + bob, sc, r.color, phase === "race" ? tRace * 14 + k : 0);
      // Chip con nombre y avatar
      const label = r.name.length > 16 ? r.name.slice(0, 15) + "…" : r.name;
      c.font = `700 ${Math.max(11, 12 * u)}px system-ui, sans-serif`;
      const tw = c.measureText(label).width;
      const chipY = ly - laneH * 0.52, av = 18 * u;
      c.fillStyle = dark ? "#f6efe2" : "#fff";
      c.fillRect(lx - 4 * u, chipY - 14 * u, tw + av + 18 * u, 22 * u);
      c.lineWidth = 2 * u; c.strokeStyle = INK;
      c.strokeRect(lx - 4 * u, chipY - 14 * u, tw + av + 18 * u, 22 * u);
      if (r.img && r.img.complete && r.img.naturalWidth) c.drawImage(r.img, lx, chipY - 11 * u, av, av);
      c.fillStyle = "#191919";
      c.fillText(label, lx + av + 6 * u, chipY + 3 * u);
    });
    c.restore();
    // Countdown gigante
    if (phase === "count") {
      const n = Math.max(1, 3 - Math.floor(tPhase));
      c.font = `900 ${180 * u}px system-ui, sans-serif`;
      c.textAlign = "center";
      c.fillStyle = INK;
      c.fillText(String(n), w / 2 + 6 * u, h * 0.36 + 6 * u);
      c.fillStyle = color(0);
      c.fillText(String(n), w / 2, h * 0.36);
      c.textAlign = "left";
    }
  }

  function drawRange(arr: Ridge[], parallax: number, baseY: number, w: number, h: number): void {
    const c = ctx as CanvasRenderingContext2D;
    c.beginPath();
    c.moveTo(-40, h * baseY);
    for (const p of arr) {
      const sx = p.dx * L() * 1.15 - camX * parallax;
      if (sx < -w * 0.3 || sx > w * 1.3) continue;
      c.lineTo(sx - p.w * w, h * baseY);
      c.lineTo(sx, h * (baseY - p.h));
      c.lineTo(sx + p.w * w, h * baseY);
    }
    c.lineTo(w + 40, h * baseY);
    c.closePath();
    c.fill();
  }

  function drawLlama(x: number, y: number, sc: number, col: string, phase2: number): void {
    const c = ctx as CanvasRenderingContext2D;
    const r = (rx: number, ry: number, rw: number, rh: number) => c.fillRect(x + rx * sc, y + ry * sc, rw * sc, rh * sc);
    c.fillStyle = col;
    r(2, 11, 16, 7); r(15, 3, 4, 10); r(14, 0, 8, 4); r(20, -2, 2, 3); r(0, 9, 3, 4);
    const legUp = Math.sin(phase2) * 2.6, legUp2 = Math.sin(phase2 + Math.PI) * 2.6;
    r(3, 18 - Math.max(0, legUp), 2.5, 6 + Math.min(0, legUp));
    r(8, 18 - Math.max(0, legUp2), 2.5, 6 + Math.min(0, legUp2));
    r(12.5, 18 - Math.max(0, legUp2), 2.5, 6 + Math.min(0, legUp2));
    r(16, 18 - Math.max(0, legUp), 2.5, 6 + Math.min(0, legUp));
    c.fillStyle = "#191919";
    c.fillRect(x + 19.4 * sc, y + 1.2 * sc, 1.4 * sc, 1.4 * sc);
  }

  let tPrev = performance.now();
  let rafId = 0;
  function loop(now: number): void {
    const dt = Math.min(0.05, (now - tPrev) / 1000);
    tPrev = now;
    update(dt);
    drawScene();
    if (phase !== "dead") rafId = requestAnimationFrame(loop);
  }

  function cleanup(): void {
    phase = "dead";
    cancelAnimationFrame(rafId);
    removeEventListener("resize", resize);
    ov.style.display = "none";
    document.body.style.overflow = "";
    stApi = null;
    $("sec-draw").scrollIntoView({ behavior: "smooth", block: "start" });
    done();
  }

  rafId = requestAnimationFrame((now) => { tPrev = now; loop(now); });
}
