import { T, getLang, t } from "../i18n";
import { beep, fanfare } from "../sound";
import { avatar, type Beacon } from "../state";
import { INK, clamp, ease, mount } from "./overlay";

/**
 * Pasanaku.
 *
 * El *Diccionario de americanismos* lo define, bajo la grafía `pasanacu`, como
 * "juego que consiste en sortear el dinero de las cuotas semanales o mensuales
 * de los participantes". O sea que no hubo que forzar nada: el pasanaku ya es
 * un sorteo, y uno que miles de bolivianos corren todos los meses con la misma
 * promesa que vende Tinkazo, que el orden lo decida algo que nadie pueda
 * arreglar.
 *
 * Un aguayo tendido en el suelo. Cada participante tira su bulto encima y se
 * tejen los hilos entre vecinos: esos hilos son las trustlines, porque a un
 * pasanaku solo entrás con gente de la que aceptarías plata. Después la tela
 * se empieza a cerrar y los bultos que quedan fuera del aro salen por el
 * borde. **El que sale no pierde: ya cobró**, que es exactamente como funciona.
 * Al final queda uno en el nudo, se ata con un cordón tricolor y se levanta.
 *
 * Escala al revés que la ruleta: con doscientos es un hervidero, y con dos son
 * dos atados forcejeando dentro de un nudo que se aprieta, que es todavía más
 * dramático.
 *
 * La física no decide nada. El orden de salida está sembrado con la ronda y el
 * ganador va primero en esa lista, así que nunca lo expulsan.
 */

type Phase = "spread" | "drop" | "weave" | "cinch" | "knot" | "lift" | "dead";

interface Bundle {
  idx: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Giro propio y fase del temblor, sembrados: nada queda nunca quieto. */
  rot: number;
  wob: number;
  ph: number;
  alive: boolean;
  /** Cuándo salió, para la caída y la pila de abajo. */
  out: number;
  /** Posición final en la pila de los que ya cobraron. */
  slot: number;
  /** Los dos vecinos del anillo: sus hilos. */
  a: number;
  b: number;
}

/** Paso fijo de la simulación. Sin esto la misma ronda dibuja distinto en
 *  una máquina de 60 Hz y en una de 144, y todo el proyecto se apoya en que
 *  la misma ronda dé siempre lo mismo. */
const DT = 1 / 120;

const T_DROP = 0.7;
const T_WEAVE = 2.3;
const T_CINCH = 3.1;
const T_KNOT = 7.3;
const T_LIFT = 8.6;
const T_END = 10.3;

export function pasanaku(
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
  const FINAL = Math.min(3, n);
  /** Cuántos apretones. Suman siempre 4,2 s, así que el total no cambia con n. */
  const PULLS = n <= 4 ? 1 : n <= 12 ? 2 : 3;
  const PULL_DUR = 4.2 / PULLS;

  /**
   * El orden de salida. El ganador va primero y por lo tanto nunca lo
   * expulsan: la tela no decide nada, solo muestra lo que el protocolo decidió.
   */
  const rank = names.map((_, i) => i).filter((i) => i !== winnerIdx);
  for (let i = rank.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [rank[i], rank[j]] = [rank[j] as number, rank[i] as number];
  }
  rank.unshift(winnerIdx);
  /** Puesto de cada persona: 0 es el ganador, el último es el primero en salir. */
  const place = new Map(rank.map((idx, pos) => [idx, pos]));

  const faces = new Map<number, HTMLImageElement>();
  function face(idx: number): HTMLImageElement {
    let im = faces.get(idx);
    if (!im) {
      im = new Image();
      im.src = avatar(names[idx] ?? "", 64);
      faces.set(idx, im);
    }
    return im;
  }

  let phase: Phase = "spread";
  let tAll = 0;
  let acc = 0;
  let cinchTotal = 0;
  let pulls = 0;
  let collected = 0;
  let dropTicks = 0;
  let knotHits = 0;
  let saidUpTo = -1;
  let lastOut = -999;
  let liftK = 0;
  const bundles: Bundle[] = [];

  const C = (): { x: number; y: number; k: number } => ({ x: W() / 2, y: H() * 0.47, k: u() });
  const R0 = (): number => Math.min(H() * 0.46, W() * 0.34);
  const Rc = (): number => R0() * (1 - 0.62 * cinchTotal);
  // Los bultos ocupan como mucho un quinto de la tela: si tapan el aguayo se
  // pierde el tablero, que es justamente lo que cuenta el juego.
  const rad = (): number => clamp(Math.sqrt((Rc() * Rc() * 0.20) / n), 7 * u(), 30 * u());

  /* Los bultos arrancan arriba y caen escalonados. */
  {
    const { x, y } = C();
    const r0 = R0();
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rng() * 0.2;
      const d = 0.3 + rng() * 0.6;
      bundles.push({
        idx: i,
        x: x + Math.cos(a) * r0 * d,
        y: y + Math.sin(a) * r0 * d * 0.62,
        vx: 0,
        vy: 0,
        rot: rng() * Math.PI,
        wob: 1.4 + rng() * 2.2,
        ph: rng() * 7,
        alive: true,
        out: 0,
        slot: 0,
        a: (i + 1) % n,
        b: (i + n - 1) % n,
      });
    }
  }

  const alive = (): Bundle[] => bundles.filter((q) => q.alive);

  /* ----------------------------------------------------------------- física */
  function step(dt: number): void {
    const { x: cx, y: cy, k } = C();
    const list = alive();
    const r = rad();
    for (const q of list) {
      // La tela empuja hacia el centro, más fuerte cuanto más apretado está.
      const dx = cx - q.x;
      const dy = (cy - q.y) * 1.6;
      const d = Math.hypot(dx, dy) || 1;
      const g = 220 * k * (0.25 + cinchTotal);
      q.vx += (dx / d) * g * dt;
      q.vy += (dy / d) * g * dt;
      // Temblor sembrado: nada queda nunca quieto.
      q.vx += Math.sin(tAll * q.wob + q.ph) * 26 * k * dt;
      q.vy += Math.cos(tAll * q.wob * 0.83 + q.ph) * 26 * k * dt;
      q.vx *= 0.965;
      q.vy *= 0.965;
      q.x += q.vx * dt;
      q.y += q.vy * dt;
      q.rot += q.vx * dt * 0.01;
    }
    // Empuje entre pares que se solapan, mitad para cada uno. Con doscientos
    // son veinte mil comprobaciones por paso, menos de un milisegundo. Arriba
    // de cuatrocientos convendría una grilla de celdas.
    for (let i = 0; i < list.length; i++) {
      const p = list[i] as Bundle;
      for (let j = i + 1; j < list.length; j++) {
        const q = list[j] as Bundle;
        const dx = q.x - p.x;
        const dy = (q.y - p.y) / 0.62;
        const d = Math.hypot(dx, dy);
        const min = r * 2;
        if (d >= min || d === 0) continue;
        const push = (min - d) / 2;
        const ux = dx / d;
        const uy = dy / d;
        p.x -= ux * push;
        p.y -= uy * push * 0.62;
        q.x += ux * push;
        q.y += uy * push * 0.62;
      }
    }
    // El aro elíptico contiene a los que siguen adentro.
    const rr = Rc();
    for (const q of list) {
      const dx = q.x - cx;
      const dy = (q.y - cy) / 0.62;
      const d = Math.hypot(dx, dy);
      const lim = rr - r;
      if (d <= lim || d === 0) continue;
      const ux = dx / d;
      const uy = dy / d;
      q.x = cx + ux * lim;
      q.y = cy + uy * lim * 0.62;
      q.vx *= -0.42;
      q.vy *= -0.42;
    }
    // Los que ya cobraron caen a la pila de abajo.
    for (const q of bundles) {
      if (q.alive) continue;
      q.out += dt;
      q.vy += 900 * k * dt;
      q.x += q.vx * dt;
      q.y += q.vy * dt;
      q.rot += dt * 3;
      // Se apilan en una franja abajo: con doscientos, la pila crece y se
      // vuelve una barra de progreso hecha de cuerpos.
      const r = rad();
      const cols = Math.max(1, Math.floor((W() - 120 * u()) / (r * 2.2)));
      const col = q.slot % cols;
      const row = Math.floor(q.slot / cols);
      const tx = 60 * u() + col * r * 2.2 + r;
      const ty = H() - 56 * u() - row * r * 1.5;
      if (q.out > 0.45) {
        const sp = Math.min(1, dt * 6);
        q.x += (tx - q.x) * sp;
        q.y += (ty - q.y) * sp;
        q.vx *= 0.6;
        q.vy *= 0.6;
      } else if (q.y > ty) {
        q.y = ty;
        q.vy *= -0.25;
        q.vx *= 0.8;
      }
    }
  }

  /** Saca a los que toca. Nunca al ganador: su puesto es el 0. */
  function evict(keep: number): void {
    const list = alive().sort((a, b) => (place.get(b.idx) ?? 0) - (place.get(a.idx) ?? 0));
    const { x: cx, y: cy, k } = C();
    for (const q of list) {
      if (alive().length <= keep) break;
      q.alive = false;
      q.out = 0;
      q.slot = collected++;
      const a = Math.atan2(q.y - cy, q.x - cx);
      q.vx = Math.cos(a) * 380 * k;
      q.vy = Math.sin(a) * 380 * k - 160 * k;
      // Con mucha gente no suena cada salida: sería una ametralladora.
      if (n <= 40 || collected % 6 === 0) beep(180 + (collected % 4) * 30, 0.05, "square", 0.025);
      if (tAll - lastOut > 0.5 && alive().length <= 8) {
        lastOut = tAll;
        say(T[getLang()].cPasOut(names[q.idx] ?? ""), 0.5);
      }
    }
  }

  function skip(): void {
    if (phase === "lift" || phase === "dead") return;
    cinchTotal = 1;
    evict(1);
    tAll = T_LIFT;
    phase = "lift";
    crown();
  }

  let crowned = false;
  function crown(): void {
    if (crowned) return;
    crowned = true;
    say(T[getLang()].cWin(names[winnerIdx] ?? ""), 1);
    beep(90, 0.5, "sine", 0.06);
    fanfare();
    setTimeout(() => beep(1318, 0.09, "triangle", 0.04), 150);
    setTimeout(() => beep(1760, 0.09, "triangle", 0.03), 300);
  }

  /* ----------------------------------------------------------------- guion */
  function script(dt: number): void {
    const cues: [number, () => void][] = [
      [0.05, () => say(t("cPasSpread"), 0.1)],
      [T_DROP + 0.1, () => say(t("cPasDrop"), 0.2)],
      // La línea que enseña: en dos segundos la sala ve una red de confianza y
      // oye que no hay contrato. Eso es la trustline sin decir "trustline".
      [T_WEAVE, () => say(t("cPasWeave"), 0.3)],
    ];
    for (let i = saidUpTo + 1; i < cues.length; i++) {
      const cue = cues[i] as [number, () => void];
      if (tAll < cue[0]) break;
      saidUpTo = i;
      cue[1]();
    }

    if (phase === "cinch") {
      const want = Math.min(PULLS, Math.floor((tAll - T_CINCH) / PULL_DUR) + 1);
      while (pulls < want) {
        pulls++;
        say(t(pulls === 1 ? "cPasCinch" : pulls === 2 ? "cPasCinch2" : "cPasCinch3"), 0.3 + pulls * 0.2);
        beep(120 - pulls * 11, 0.7, "sawtooth", 0.035);
      }
      const p = clamp((tAll - T_CINCH) / 4.2, 0, 1);
      cinchTotal = ease.outCubic(p) * 0.86;
      // Cuántos quedan vivos según lo avanzado del apretón.
      const target = Math.max(FINAL, Math.round(n * (1 - p) ** 1.5));
      if (alive().length > target) evict(target);
      return;
    }

    if (phase === "knot") {
      cinchTotal = 0.86 + 0.12 * clamp((tAll - T_KNOT) / (T_LIFT - T_KNOT), 0, 1);
      const hits = Math.floor((tAll - T_KNOT) / 0.14);
      while (knotHits < hits) {
        knotHits++;
        if (knotHits % 2 === 0) beep(520 + Math.floor(rng() * 120), 0.02, "sine", 0.012);
      }
      // El penúltimo sale cerca del final y deja a uno solo.
      if (tAll >= T_LIFT - 0.15 && alive().length > 1) {
        beep(140, 0.35, "sine", 0.06);
        evict(1);
      } else if (alive().length > FINAL) {
        evict(FINAL);
      }
      if (knotHits === 1) say(t("cPasKnot"), 0.9);
      return;
    }

    if (phase === "lift") {
      liftK = Math.min(1, liftK + dt * 0.8);
      crown();
    }
  }

  /* ---------------------------------------------------------------- dibujo */
  function drawRoom(now: number): void {
    // Es el único juego que pide luz: la constelación es de noche y el Cierre
    // de Libro es papel frío.
    c.fillStyle = dark ? "#1b1224" : "#f3e6d2";
    c.fillRect(0, 0, W(), H());
    const { x, y } = C();
    const g = c.createRadialGradient(x, y, 0, x, y, Math.max(W(), H()) * 0.7);
    g.addColorStop(0, "rgba(0,0,0,0)");
    // La viñeta respira: nunca queda del todo quieta.
    g.addColorStop(1, `rgba(0,0,0,${0.22 + 0.03 * Math.sin(now * 0.6)})`);
    c.fillStyle = g;
    c.fillRect(0, 0, W(), H());
  }

  /** El borde de la tela nunca es un círculo: siempre ondula. */
  function clothR(a: number, now: number, rr: number): number {
    return rr * (1 + 0.06 * Math.sin(3 * a + now * 1.4) + liftK * 0.22 * Math.sin(4 * a));
  }

  function clothPath(now: number, rr: number, scale = 1): void {
    const { x, y } = C();
    c.beginPath();
    for (let i = 0; i <= 64; i++) {
      const a = (i / 64) * Math.PI * 2;
      const r = clothR(a, now, rr) * scale;
      const px = x + Math.cos(a) * r;
      const py = y + Math.sin(a) * r * 0.62 - liftK * 70 * u();
      if (i === 0) c.moveTo(px, py);
      else c.lineTo(px, py);
    }
    c.closePath();
  }

  function drawAguayo(now: number): void {
    const { x, y, k } = C();
    const rr = Rc();
    const grow = phase === "spread" ? ease.outBack(clamp(tAll / T_DROP, 0, 1)) : 1;
    // Sombra de la tela en el suelo.
    c.save();
    c.globalAlpha = 0.35;
    c.fillStyle = INK;
    c.beginPath();
    c.ellipse(x, y + 22 * k, rr * 1.12, rr * 0.42, 0, 0, 7);
    c.fill();
    c.restore();

    c.save();
    c.translate(x, y - liftK * 70 * k);
    c.scale(1, grow);
    c.translate(-x, -(y - liftK * 70 * k));
    // Cinco franjas lisas, en la paleta de la casa. En "colores andinos" sería
    // un afiche de turismo; así un extranjero ve una tela a rayas y un
    // boliviano ve un aguayo.
    // El orden va de afuera hacia adentro, así que la franja externa queda
    // amarilla y el centro magenta, que es donde termina el nudo.
    const pal = ["#e93d9c", "#ff7a1a", "#00a896", "#6c4ce0", "#ffc629"];
    for (let b = 5; b >= 1; b--) {
      clothPath(now, rr, b / 5);
      c.fillStyle = pal[(b - 1) % pal.length] ?? "#e93d9c";
      c.fill();
      c.lineWidth = 2 * k;
      c.strokeStyle = INK;
      c.stroke();
    }
    // La banda de pallay: dieciséis rombos, que es el diseño que lleva un
    // aguayo de verdad entre franja y franja.
    c.fillStyle = INK;
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2 + now * 0.05;
      const px = x + Math.cos(a) * rr * 0.62;
      const py = y - liftK * 70 * k + Math.sin(a) * rr * 0.62 * 0.62;
      const s = 9 * k;
      c.beginPath();
      c.moveTo(px, py - s);
      c.lineTo(px + s, py);
      c.lineTo(px, py + s);
      c.lineTo(px - s, py);
      c.closePath();
      c.fill();
    }
    c.restore();
  }

  function drawCorners(now: number): void {
    const { x, y, k } = C();
    const rr = Rc();
    const lift = liftK * 70 * k;
    // Las cuatro puntas se levantan y ondean.
    for (let i = 0; i < 4; i++) {
      const a = Math.PI / 4 + (i * Math.PI) / 2;
      const up = (cinchTotal * 0.6 + liftK) * 130 * k + Math.sin(now * 2 + i) * 6 * k;
      const bx = x + Math.cos(a) * rr;
      const by = y + Math.sin(a) * rr * 0.62 - lift;
      c.beginPath();
      c.moveTo(bx - 26 * k, by);
      c.quadraticCurveTo(bx, by - up * 0.6, x + Math.cos(a) * rr * 0.2, by - up);
      c.quadraticCurveTo(bx, by - up * 0.4, bx + 26 * k, by);
      c.closePath();
      c.fillStyle = ["#e93d9c", "#ff7a1a", "#00a896", "#6c4ce0"][i] ?? "#e93d9c";
      c.fill();
      c.lineWidth = 2 * k;
      c.strokeStyle = INK;
      c.stroke();
    }
  }

  function drawThreads(): void {
    const k = u();
    c.lineWidth = 3 * k;
    const byIdx = new Map(bundles.map((q) => [q.idx, q]));
    for (const q of bundles) {
      if (!q.alive) continue;
      for (const other of [q.a, q.b]) {
        const o = byIdx.get(other);
        if (!o || !o.alive || o.idx < q.idx) continue;
        c.globalAlpha = 0.75;
        c.strokeStyle = color(q.idx);
        c.beginPath();
        c.moveTo(q.x, q.y);
        c.lineTo(o.x, o.y);
        c.stroke();
      }
    }
    c.globalAlpha = 1;
  }

  function drawBundle(q: Bundle, now: number): void {
    const k = u();
    const r = q.alive ? rad() : rad() * 0.8;
    const col = color(q.idx);
    c.save();
    c.translate(q.x, q.y - (q.alive ? liftK * 70 * k : 0));
    c.rotate(q.rot + 0.12 * Math.sin(now * 1.1 + q.ph));
    c.fillStyle = INK;
    c.fillRect(-r + 3 * k, -r + 3 * k, r * 2, r * 2);
    c.fillStyle = col;
    c.fillRect(-r, -r, r * 2, r * 2);
    c.lineWidth = 2.5 * k;
    c.strokeStyle = INK;
    c.strokeRect(-r, -r, r * 2, r * 2);
    // Las dos orejitas del atado, como un bulto de apthapi.
    c.beginPath();
    c.moveTo(-r * 0.5, -r);
    c.lineTo(-r * 0.15, -r * 1.45);
    c.lineTo(r * 0.15, -r);
    c.moveTo(r * 0.15, -r);
    c.lineTo(r * 0.5, -r * 1.4);
    c.lineTo(r * 0.75, -r);
    c.closePath();
    c.fillStyle = col;
    c.fill();
    c.strokeStyle = INK;
    c.stroke();
    c.fillStyle = "rgba(255,255,255,0.35)";
    c.fillRect(-r * 0.6, -r * 0.6, r * 0.3, r * 0.3);
    c.restore();
  }

  function drawPot(): void {
    const k = u();
    const put = phase === "spread" ? 0 : Math.min(n, Math.floor(clamp((tAll - T_DROP) / 1.6, 0, 1) * n));
    const label = `${t("cPasPot")}  ${Math.max(put, collected ? n : put)} / ${n}`;
    c.font = `700 ${14 * k}px ui-monospace, Consolas, monospace`;
    c.textAlign = "center";
    const bw = c.measureText(label).width + 40 * k;
    const bh = 40 * k;
    const bx = 22 * k;
    const by = 92 * k;
    c.fillStyle = INK;
    c.fillRect(bx + 5 * k, by + 5 * k, bw, bh);
    c.fillStyle = dark ? "#221a33" : "#ffffff";
    c.fillRect(bx, by, bw, bh);
    c.lineWidth = 3 * k;
    c.strokeStyle = INK;
    c.strokeRect(bx, by, bw, bh);
    c.fillStyle = dark ? "#f6efe2" : INK;
    c.textBaseline = "middle";
    c.fillText(label, bx + bw / 2, by + bh / 2);
    c.textBaseline = "alphabetic";
    // Los cantos de las monedas apiladas debajo: la pila crece mientras cae
    // la cuota de cada uno.
    const coins = Math.min(put, 14);
    for (let i = 0; i < coins; i++) {
      c.fillStyle = i % 2 ? "#ffc629" : "#ff7a1a";
      c.fillRect(bx + 10 * k, by + bh + 10 * k + i * 6 * k, bw - 20 * k, 3 * k);
      c.fillStyle = INK;
      c.fillRect(bx + 10 * k, by + bh + 13 * k + i * 6 * k, bw - 20 * k, 1 * k);
    }
  }

  function drawKnot(now: number): void {
    const { x, y, k } = C();
    const ky = y - liftK * 70 * k - Rc() * 0.9;
    c.save();
    c.translate(x, ky);
    c.rotate(0.06 * Math.sin(now * 3));
    // El cordón tricolor: es lo que ata el nudo, así que es funcional. Aparece
    // un segundo y medio, al final, cuando ya no hay tensión que robar.
    c.fillStyle = INK;
    c.fillRect(-16 * k, -6 * k, 32 * k, 24 * k);
    ["#c8102e", "#ffc629", "#0f8a5f"].forEach((col, i) => {
      c.fillStyle = col;
      c.fillRect(-13 * k + i * 9 * k, -3 * k, 8 * k, 18 * k);
    });
    c.restore();
  }

  function drawWinnerCard(): void {
    const k = u();
    const e = ease.outBack(Math.min(1, liftK * 1.6));
    const name = names[winnerIdx] ?? "";
    const label = name.length > 24 ? name.slice(0, 23) + "…" : name;
    c.save();
    c.translate(W() / 2, H() * 0.74);
    c.scale(e, e);
    c.font = `900 ${54 * k}px system-ui, sans-serif`;
    c.textAlign = "center";
    c.textBaseline = "middle";
    const bw = c.measureText(label).width + 72 * k;
    const bh = 112 * k;
    c.fillStyle = "#e93d9c";
    c.fillRect(-bw / 2 + 10 * k, -bh / 2 + 10 * k, bw, bh);
    c.fillStyle = "#ffc629";
    c.fillRect(-bw / 2, -bh / 2, bw, bh);
    c.lineWidth = 6 * k;
    c.strokeStyle = INK;
    c.strokeRect(-bw / 2, -bh / 2, bw, bh);
    c.fillStyle = INK;
    c.fillText(label, 0, 0);
    c.restore();
    c.textBaseline = "alphabetic";
  }

  function drawHud(): void {
    const k = u();
    c.font = `700 ${11 * k}px ui-monospace, Consolas, monospace`;
    c.textAlign = "left";
    c.fillStyle = dark ? "rgba(246,239,226,0.55)" : "rgba(25,25,25,0.55)";
    c.textAlign = "right";
    c.fillText(`${t("cWheelRound")} #${beacon.round}`, W() - 22 * k, H() - 26 * k);
    if (phase === "cinch") {
      c.fillText(`${t("cPasCinchLbl")} ${pulls}/${PULLS}`, W() - 22 * k, H() - 44 * k);
    }
    c.textAlign = "left";
  }

  /* ------------------------------------------------------------------ bucle */
  run((dt, now) => {
    tAll += dt;
    phase =
      tAll < T_DROP ? "spread"
        : tAll < T_WEAVE ? "drop"
          : tAll < T_CINCH ? "weave"
            : tAll < T_KNOT ? "cinch"
              : tAll < T_LIFT ? "knot"
                : "lift";

    if (phase === "drop") {
      const want = Math.floor(clamp((tAll - T_DROP) / 1.6, 0, 1) * Math.min(24, n));
      while (dropTicks < want) {
        beep(300 + (dropTicks % 7) * 40, 0.035, "triangle", 0.03);
        dropTicks++;
      }
    }
    script(dt);

    acc += dt;
    let guard = 0;
    while (acc >= DT && guard++ < 12) {
      step(DT);
      acc -= DT;
    }
    if (acc > DT) acc = 0;

    drawRoom(now);
    drawAguayo(now);
    drawCorners(now);
    drawThreads();
    for (const q of bundles) if (!q.alive) drawBundle(q, now);
    for (const q of bundles) if (q.alive) drawBundle(q, now);
    // Con doscientos nombres a la vez no se lee nada: los chips solo cuando
    // quedan pocos, la misma regla que la constelación.
    const live = alive();
    if (live.length <= 8) {
      const r = rad();
      const k = u();
      // Se escalonan para que no se pisen cuando los bultos se juntan.
      live.forEach((q, i) => {
        chip(names[q.idx] ?? "", q.x + r + 6 * k, q.y - r - 8 * k - liftK * 70 * k - (i % 3) * 22 * k, 1);
      });
    }
    drawPot();
    drawHud();
    if (phase === "lift") {
      drawKnot(now);
      drawWinnerCard();
    }
    if (tAll >= T_END) {
      phase = "dead";
      cleanup();
    }
  });
}
