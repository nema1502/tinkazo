import { T, getLang, t } from "../i18n";
import { beep, beepFor, fanfare, note } from "../sound";
import { paceFactor, setGameLength, type Beacon } from "../state";
import { INK, WINNER_HOLD, chrome, clamp, ease, mount, drawWinnerPlate, flashScreen, winnerNames, winnersLabel } from "./overlay";

/**
 * La tómbola.
 *
 * El bombo de las kermeses: una bola por persona, con su número en la lista
 * sellada, tres vueltas de manivela, se abre la compuerta y sale una sola. La
 * bola que sale es la ganadora, como en cualquier tómbola, y baja rodando por
 * una canaleta hasta el vaso con el número a la vista.
 *
 * El número de la bola es el puesto de la persona en la lista sellada, el mismo
 * índice que muestra el comprobante (más uno, porque la gente cuenta desde
 * uno). Así la sala puede buscar su número en la lista antes de que salga el
 * nombre.
 *
 * El juego no decide nada. Las bolas golpean de verdad ·física de paso fijo,
 * sembrada con la ronda· pero en la última vuelta la del ganador se acerca a la
 * compuerta, y la compuerta sólo se abre para ella. El protocolo ya había
 * elegido; el bombo lo cuenta.
 *
 * El bombo termina siempre con la compuerta abajo: el ángulo final sale de
 * integrar la velocidad, igual que en la ruleta, y se escala para caer justo.
 */

const TAU = Math.PI * 2;
/** Paso fijo de la física, en segundos de juego. */
const DT = 1 / 120;

/* Los tiempos, en segundos de juego desde el arranque. */
const T_FILL = 1.8;
const T_S1 = 4.2;
const T_S2 = 6.8;
const T_S3 = 10.2;
const T_STOP = 11.0;
const T_OUT = 11.6;
const T_LIP = 14.8;
const T_LAND = 15.4;
const T_CROWN = 16.0;

/** Velocidad del bombo en vueltas por segundo. */
function omega(tt: number): number {
  const bump = (a: number, b: number, top: number): number => {
    const p = (tt - a) / (b - a);
    // Sube rápido, se sostiene y afloja al final de cada vuelta de manivela.
    return top * Math.sin(Math.PI * clamp(p, 0, 1)) ** 0.6;
  };
  if (tt < T_FILL) return 0;
  if (tt < T_S1) return bump(T_FILL, T_S1, 0.55);
  if (tt < T_S2) return bump(T_S1, T_S2, 0.85);
  if (tt < T_S3) return bump(T_S2, T_S3, 1.25);
  return 0;
}

interface Ball {
  idx: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  /** Cuándo entra al bombo, durante el llenado. */
  born: number;
}

export function tombola(
  names: string[],
  winners: readonly number[],
  beacon: Beacon,
  done: () => void,
): void {
  const winnerIdx = winners[0] ?? 0;
  const st = mount(beacon, done, () => skip());
  if (!st) {
    done();
    return;
  }
  const { c, W, H, u, rng, color, say, chip, dark, cleanup, run } = st;
  setGameLength(T_CROWN, WINNER_HOLD);
  const n = names.length;
  const lang = getLang();

  /* ---------------------------------------------------------- las bolas */
  /** Radio de una bola, en radios del bombo: un tercio del bombo lleno. */
  const rb = clamp(Math.sqrt(0.34 / Math.max(1, n)), 0.035, 0.17);
  // Entran de a una, en un orden sembrado, desde la boca de arriba.
  const order = names.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [order[i], order[j]] = [order[j] as number, order[i] as number];
  }
  const balls: Ball[] = order.map((idx, k) => ({
    idx,
    x: (rng() - 0.5) * 0.3,
    y: -0.9 + rb,
    vx: (rng() - 0.5) * 0.6,
    vy: 0.5,
    rot: rng() * TAU,
    born: 0.15 + (k / Math.max(1, n)) * (T_FILL - 0.55),
  }));
  const winBall = balls.find((b) => b.idx === winnerIdx) as Ball;

  /* ------------------------------------------------ el ángulo del bombo */
  // La compuerta tiene que terminar en la salida. Se integra la velocidad una
  // vez y se escala para que la vuelta total caiga justo ahí.
  const STEPS = 1600;
  const cumT: number[] = [0];
  const h = T_STOP / STEPS;
  for (let i = 1; i <= STEPS; i++) cumT[i] = (cumT[i - 1] as number) + ((omega((i - 1) * h) + omega(i * h)) / 2) * h;
  const turns = cumT[STEPS] as number;
  /**
   * Dónde termina la compuerta: abajo a la derecha, o abajo en vertical. Se
   * fija al arrancar: si alguien gira el celular a mitad del sorteo, el bombo
   * ya tiene calculado dónde frenar y la compuerta tiene que seguir ahí.
   */
  const EXIT = H() > W() * 1.1 ? Math.PI / 2 : Math.PI * 0.2;
  const exitAngle = (): number => EXIT;
  const doorStart = rng() * TAU;
  const want = (((exitAngle() - doorStart) / TAU) % 1 + 1) % 1;
  const full = Math.floor(turns);
  const scale = (full + want) / Math.max(turns, 1e-6);
  /** Ángulo del bombo a la hora `x`. La compuerta está en `doorStart + ángulo`. */
  function drumAngle(x: number): number {
    if (x <= 0) return 0;
    if (x >= T_STOP) return (full + want) * TAU;
    const f = (x / T_STOP) * STEPS;
    const i = Math.floor(f);
    const a = cumT[i] as number;
    const b = cumT[Math.min(STEPS, i + 1)] as number;
    return (a + (b - a) * (f - i)) * scale * TAU;
  }

  /* ------------------------------------------------------------ estado */
  let tAll = 0;
  let tSim = 0;
  let acc = 0;
  let tHold = 0;
  let flashK = 0;
  let shake = 0;
  let didCrown = false;
  let silent = false;
  let lastHum = -1;
  let dropTicks = 0;
  let crank = -1;
  let clatterAt = -9;
  let hits = 0;
  let beat = -1;
  let lastSaid = -99;
  const fired = new Set<string>();

  /* ------------------------------------------------------------- física */
  /** Las paletas de adentro, que levantan las bolas. Giran con el bombo. */
  const VANES = 3;
  function step(dt: number): void {
    tSim += dt;
    const w = omega(tSim) * TAU * scale;
    const ang = drumAngle(tSim);
    const g = 5.2;
    const inside = balls.filter((b) => tSim >= b.born && !(b === winBall && tSim >= T_STOP));
    for (const b of inside) {
      b.vy += g * dt;
      // En la última vuelta la del ganador se va acercando a la compuerta.
      // Es lo único que el bombo hace a propósito, y sólo con esa bola.
      if (b === winBall && tSim > T_S3 - 1.4) {
        const ea = exitAngle();
        const tx = Math.cos(ea) * (1 - rb * 1.2);
        const ty = Math.sin(ea) * (1 - rb * 1.2);
        const pull = tSim > T_S3 ? 26 : 9;
        b.vx += (tx - b.x) * pull * dt;
        b.vy += (ty - b.y) * pull * dt;
        b.vx *= 0.97;
        b.vy *= 0.97;
      }
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.rot += (b.vx - b.vy) * dt * 3;
    }
    // Bola contra bola: se separan y cambian el impulso a lo largo del choque.
    for (let i = 0; i < inside.length; i++) {
      const p = inside[i] as Ball;
      for (let j = i + 1; j < inside.length; j++) {
        const q = inside[j] as Ball;
        const dx = q.x - p.x;
        const dy = q.y - p.y;
        const d2 = dx * dx + dy * dy;
        const min = rb * 2;
        if (d2 >= min * min || d2 === 0) continue;
        const d = Math.sqrt(d2);
        const nx = dx / d;
        const ny = dy / d;
        const push = (min - d) / 2;
        p.x -= nx * push;
        p.y -= ny * push;
        q.x += nx * push;
        q.y += ny * push;
        const rel = (q.vx - p.vx) * nx + (q.vy - p.vy) * ny;
        if (rel < 0) {
          const imp = -rel * 0.8;
          p.vx -= nx * imp * 0.5;
          p.vy -= ny * imp * 0.5;
          q.vx += nx * imp * 0.5;
          q.vy += ny * imp * 0.5;
          if (-rel > 0.9) hits++;
        }
      }
    }
    // La pared del bombo, que arrastra a las que la tocan.
    for (const b of inside) {
      const d = Math.hypot(b.x, b.y);
      const lim = 1 - rb;
      if (d > lim && d > 0) {
        const nx = b.x / d;
        const ny = b.y / d;
        b.x = nx * lim;
        b.y = ny * lim;
        const vn = b.vx * nx + b.vy * ny;
        if (vn > 0) {
          b.vx -= vn * nx * 1.35;
          b.vy -= vn * ny * 1.35;
          if (vn > 1.1) hits++;
        }
        // La pared va a `w * lim` en la tangente; la bola se acerca a eso.
        const tx = -ny;
        const ty = nx;
        const vt = b.vx * tx + b.vy * ty;
        const wall = w * lim;
        b.vx += tx * (wall - vt) * 0.08;
        b.vy += ty * (wall - vt) * 0.08;
      }
      // Las paletas: segmentos del centro hacia afuera, girando.
      for (let v = 0; v < VANES; v++) {
        const a = ang + (v / VANES) * TAU;
        const ax = Math.cos(a);
        const ay = Math.sin(a);
        const along = b.x * ax + b.y * ay;
        if (along < 0.42 || along > 1) continue;
        const across = -b.x * ay + b.y * ax;
        if (Math.abs(across) >= rb + 0.02) continue;
        const side = across >= 0 ? 1 : -1;
        const nx = -ay * side;
        const ny = ax * side;
        const push = rb + 0.02 - Math.abs(across);
        b.x += nx * push;
        b.y += ny * push;
        // La paleta empuja a su velocidad, que es `w` por la distancia al eje.
        const vp = w * along;
        const vn2 = b.vx * nx + b.vy * ny;
        const want2 = vp * side;
        if (vn2 * side < Math.abs(vp)) {
          b.vx += nx * (want2 - vn2) * 0.5;
          b.vy += ny * (want2 - vn2) * 0.5;
        }
      }
      b.vx *= 0.998;
      b.vy *= 0.998;
    }
    // Ya parado el bombo, nadie más que la ganadora frente a la compuerta.
    if (tSim > T_S3) {
      const ea = exitAngle();
      const dx0 = Math.cos(ea) * (1 - rb * 1.2);
      const dy0 = Math.sin(ea) * (1 - rb * 1.2);
      for (const b of inside) {
        if (b === winBall) continue;
        const dx = b.x - dx0;
        const dy = b.y - dy0;
        const d = Math.hypot(dx, dy);
        if (d < rb * 2.4 && d > 0) {
          b.x = dx0 + (dx / d) * rb * 2.4;
          b.y = dy0 + (dy / d) * rb * 2.4;
        }
      }
    }
  }

  /* ---------------------------------------------------------- geometría */
  const geo = () => {
    const vertical = H() > W() * 1.1;
    const k = Math.min(u(), W() / 720);
    const top = chrome(c).arriba;
    const bottom = H() - chrome(c).abajo;
    if (vertical) {
      const R = Math.min(W() * 0.36, (bottom - top) * 0.24);
      const cx = W() / 2;
      const cy = top + R + 40 * k;
      const ea = exitAngle();
      const door = { x: cx + Math.cos(ea) * R, y: cy + Math.sin(ea) * R };
      // La canaleta baja en zigzag hasta el vaso.
      const cup = { x: W() * 0.5, y: bottom - 90 * k };
      const path = [
        door,
        { x: W() * 0.84, y: door.y + (cup.y - door.y) * 0.3 },
        { x: W() * 0.16, y: door.y + (cup.y - door.y) * 0.62 },
        { x: cup.x, y: cup.y - 30 * k },
      ];
      return { k, R, cx, cy, door, cup, path, vertical };
    }
    const R = Math.min((bottom - top) * 0.36, W() * 0.2);
    const cx = W() * 0.3;
    const cy = top + (bottom - top) * 0.46;
    const ea = exitAngle();
    const door = { x: cx + Math.cos(ea) * R, y: cy + Math.sin(ea) * R };
    const cup = { x: W() * 0.8, y: bottom - 80 * k };
    const path = [
      door,
      { x: W() * 0.62, y: door.y + 24 * k },
      { x: W() * 0.5, y: door.y + (cup.y - door.y) * 0.55 },
      { x: cup.x, y: cup.y - 30 * k },
    ];
    return { k, R, cx, cy, door, cup, path, vertical };
  };

  /** Largo de la canaleta y un punto a una fracción de ella. */
  function along(path: { x: number; y: number }[], q: number): { x: number; y: number; seg: number } {
    const lens = path.slice(1).map((p, i) => Math.hypot(p.x - (path[i] as { x: number }).x, p.y - (path[i] as { y: number }).y));
    const total = lens.reduce((a, b) => a + b, 0);
    let d = clamp(q, 0, 1) * total;
    for (let i = 0; i < lens.length; i++) {
      const L = lens[i] as number;
      if (d <= L || i === lens.length - 1) {
        const a = path[i] as { x: number; y: number };
        const b = path[i + 1] as { x: number; y: number };
        const f = L > 0 ? clamp(d / L, 0, 1) : 0;
        return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, seg: i };
      }
      d -= L;
    }
    return { ...(path[path.length - 1] as { x: number; y: number }), seg: lens.length - 1 };
  }

  /**
   * Por dónde va la bola ganadora en la canaleta, de 0 a 1. Rápida al salir,
   * cada vez más lenta, y en el borde del vaso se frena y se tambalea antes de
   * caer: el amague.
   */
  function rollAt(x: number): number {
    if (x < T_OUT) return 0;
    if (x < T_LIP) return 0.94 * ease.outCubic((x - T_OUT) / (T_LIP - T_OUT));
    if (x < T_LAND) return 0.94 + 0.06 * Math.pow((x - T_LIP) / (T_LAND - T_LIP), 3);
    return 1;
  }

  /* ----------------------------------------------------------- eventos */
  function once(key: string, due: boolean, fn: () => void): void {
    if (!due || fired.has(key)) return;
    fired.add(key);
    fn();
  }
  const sayNow = (msg: string, heat: number): void => {
    if (silent) return;
    lastSaid = tAll;
    say(msg, heat);
  };
  const num = String(winnerIdx + 1);

  function events(): void {
    once("drop", tAll >= 0.05, () => sayNow(t("cTomDrop"), 0.1));
    once("count", tAll >= 1.0, () => sayNow(T[lang].cTomCount(n), 0.15));
    once("s1", tAll >= T_FILL + 0.1, () => sayNow(t("cTomSpin1"), 0.35));
    once("s2", tAll >= T_S1 + 0.1, () => sayNow(t("cTomSpin2"), 0.5));
    once("s3", tAll >= T_S2 + 0.1, () => sayNow(t("cTomSpin3"), 0.7));
    once("stop", tAll >= T_S3 - 0.2, () => sayNow(t("cTomStop"), 0.75));
    once("door", tAll >= T_STOP, () => {
      sayNow(t("cTomDoor"), 0.85);
      if (!silent) {
        beep(note(5), 0.08, "square", 0.06);
        setTimeout(() => beep(note(10), 0.14, "triangle", 0.05), 70);
      }
    });
    once("ball", tAll >= T_OUT + 0.5, () => sayNow(T[lang].cTomBall(num), 0.9));
    once("almost", tAll >= T_LIP, () => sayNow(t("cTomAlmost"), 0.95));
    once("land", tAll >= T_LAND, () => {
      flashK = Math.max(flashK, 0.5);
      shake = 1;
      if (!silent) {
        beep(note(0), 0.45, "sine", 0.1);
        setTimeout(() => beep(note(5), 0.07, "square", 0.06), 40);
        setTimeout(() => beep(note(15), 0.12, "triangle", 0.05), 90);
      }
    });
    if (tAll >= T_CROWN) crowned();
    // Mientras rueda, que el relator no se calle más de dos segundos y medio.
    if (tAll > T_OUT + 1 && tAll < T_LIP && tAll - lastSaid > 2.2) sayNow(t("cTomRoll"), 0.85);
  }

  function sounds(): void {
    if (silent) return;
    // El llenado: una nota por bola que entra, con tope.
    if (tAll < T_FILL) {
      const want = Math.min(22, Math.floor((tAll / T_FILL) * Math.min(22, n + 4)));
      while (dropTicks < want) {
        beep(note(8 + (dropTicks % 5)), 0.05, "triangle", 0.03);
        dropTicks++;
      }
    }
    // La manivela: un trinquete cada octavo de vuelta.
    const ang = drumAngle(tAll);
    const cr = Math.floor(ang / (TAU / 8));
    if (tAll >= T_FILL && tAll < T_STOP && cr !== crank) {
      if (crank >= 0) beep(note(3), 0.04, "square", 0.034);
      crank = cr;
    }
    // El bombo zumba mientras gira, y baja con él.
    const w = omega(tAll);
    if (w > 0.05) {
      const hb = Math.floor(tAll / 0.3);
      if (hb !== lastHum) {
        lastHum = hb;
        beepFor(note(2 + Math.round(w * 3)), 0.36, "sawtooth", 0.024);
      }
    }
    // El golpeteo de las bolas: como mucho ocho por segundo, y sólo si chocan.
    if (hits > 3 && tAll - clatterAt > 0.125 && tAll < T_STOP) {
      clatterAt = tAll;
      beep(note(12 + (hits % 4)), 0.035, "triangle", 0.022);
    }
    hits = 0;
    // El latido del borde del vaso.
    if (tAll >= T_LIP - 0.4 && tAll < T_LAND) {
      const b = Math.floor((tAll - (T_LIP - 0.4)) / 0.35);
      if (b !== beat) {
        beat = b;
        beep(note(0), 0.12, "sine", 0.07);
      }
    }
    // La bola rodando: un toque en cada vuelta de la canaleta.
    const { path } = geo();
    const seg = along(path, rollAt(tAll)).seg;
    once(`seg${seg}`, tAll > T_OUT && tAll < T_LIP, () => beep(note(12 - seg * 2), 0.09, "triangle", 0.045));
  }

  function crowned(): void {
    if (didCrown) return;
    didCrown = true;
    flashK = 1;
    say(T[lang].cWin(winnersLabel(names, winners)), 1);
    fanfare();
    setTimeout(() => beep(note(17), 0.12, "triangle", 0.045), 520);
    setTimeout(() => beep(note(19), 0.12, "triangle", 0.035), 700);
  }

  function skip(): void {
    if (tAll >= T_CROWN) return;
    silent = true;
    tAll = T_CROWN;
    tSim = T_STOP + 1;
    settle();
    events();
    silent = false;
  }

  /**
   * Al saltar, las bolas quedan asentadas abajo sin simular. Simular hasta el
   * final eran mil trescientos pasos de física de golpe, y con doscientas
   * bolas eso se nota como un tirón justo cuando alguien apretó "saltar".
   */
  function settle(): void {
    const rest = balls.filter((b) => b !== winBall);
    let i = 0;
    for (let row = 0; i < rest.length && row < 60; row++) {
      const y = 1 - rb - row * rb * 1.75;
      const half = Math.sqrt(Math.max(0, 1 - y * y)) - rb;
      const fit = Math.max(1, Math.floor((half * 2) / (rb * 2)) + 1);
      for (let j = 0; j < fit && i < rest.length; j++, i++) {
        const b = rest[i] as Ball;
        b.x = fit === 1 ? 0 : -half + (j * (half * 2)) / (fit - 1) + (row % 2 ? rb * 0.5 : 0);
        b.y = y;
        b.vx = 0;
        b.vy = 0;
        b.born = 0;
      }
    }
  }

  /* ------------------------------------------------------------- dibujo */
  function drawBack(now: number): void {
    const { k } = geo();
    c.fillStyle = dark ? "#1b1426" : "#2a1d3f";
    c.fillRect(0, 0, W(), H());
    // Las guirnaldas de la kermés, que se mecen: la escena nunca queda quieta.
    const cols = ["#e93d9c", "#ffc629", "#00a896", "#ff7a1a", "#6c4ce0"];
    for (let row = 0; row < 1; row++) {
      const y0 = chrome(c).arriba + 4 * k;
      c.strokeStyle = "rgba(246,239,226,0.25)";
      c.lineWidth = 2 * k;
      c.beginPath();
      for (let x = 0; x <= W(); x += 20 * k) {
        const y = y0 + Math.sin(x / W() * Math.PI * 3 + row) * 14 * k;
        if (x === 0) c.moveTo(x, y);
        else c.lineTo(x, y);
      }
      c.stroke();
      for (let i = 0; i * 46 * k < W(); i++) {
        const x = i * 46 * k + row * 23 * k;
        const y = y0 + Math.sin(x / W() * Math.PI * 3 + row) * 14 * k;
        const sw = Math.sin(now * 1.8 + i * 0.7 + row) * 0.2;
        c.save();
        c.translate(x, y);
        c.rotate(sw);
        c.fillStyle = cols[(i + row * 2) % cols.length] as string;
        c.beginPath();
        c.moveTo(-8 * k, 0);
        c.lineTo(8 * k, 0);
        c.lineTo(0, 15 * k);
        c.closePath();
        c.fill();
        c.restore();
      }
    }
  }

  function drawStand(): void {
    const { cx, cy, R, k } = geo();
    c.strokeStyle = INK;
    c.lineWidth = 10 * k;
    c.lineCap = "round";
    c.beginPath();
    c.moveTo(cx, cy);
    c.lineTo(cx - R * 0.75, cy + R * 1.35);
    c.moveTo(cx, cy);
    c.lineTo(cx + R * 0.75, cy + R * 1.35);
    c.stroke();
    c.strokeStyle = dark ? "#6b6480" : "#8a82a3";
    c.lineWidth = 5 * k;
    c.stroke();
    c.lineCap = "butt";
  }

  function drawDrum(): void {
    const { cx, cy, R, k } = geo();
    const ang = drumAngle(tAll);
    // El vidrio.
    c.fillStyle = dark ? "rgba(246,239,226,0.07)" : "rgba(246,239,226,0.1)";
    c.beginPath();
    c.arc(cx, cy, R, 0, TAU);
    c.fill();
    // Las paletas de adentro.
    c.strokeStyle = "rgba(246,239,226,0.35)";
    c.lineWidth = 4 * k;
    for (let v = 0; v < VANES; v++) {
      const a = ang + (v / VANES) * TAU;
      c.beginPath();
      c.moveTo(cx + Math.cos(a) * R * 0.42, cy + Math.sin(a) * R * 0.42);
      c.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
      c.stroke();
    }
  }

  /** El aro, los barrotes y la compuerta, por delante de las bolas. */
  function drawCage(): void {
    const { cx, cy, R, k } = geo();
    const ang = drumAngle(tAll);
    // Ocho barrotes que giran: es lo que dice que el bombo se mueve.
    for (let i = 0; i < 8; i++) {
      const a = ang + (i / 8) * TAU;
      c.strokeStyle = INK;
      c.lineWidth = 6 * k;
      c.beginPath();
      c.moveTo(cx + Math.cos(a) * R * 0.2, cy + Math.sin(a) * R * 0.2);
      c.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
      c.stroke();
      c.strokeStyle = i % 2 ? "#ffc629" : "#e93d9c";
      c.lineWidth = 2.5 * k;
      c.stroke();
    }
    c.lineWidth = 12 * k;
    c.strokeStyle = INK;
    c.beginPath();
    c.arc(cx, cy, R, 0, TAU);
    c.stroke();
    c.lineWidth = 6 * k;
    c.strokeStyle = "#ff7a1a";
    c.stroke();
    // La compuerta, en amarillo, gira con el bombo. Se abre al pararse.
    const da = doorStart + ang;
    const open = clamp((tAll - T_STOP) / 0.3, 0, 1);
    const span = 0.2;
    c.lineWidth = 14 * k;
    c.strokeStyle = INK;
    c.beginPath();
    c.arc(cx, cy, R, da - span, da + span);
    c.stroke();
    c.lineWidth = 8 * k;
    c.strokeStyle = open > 0 ? "#1b1426" : "#ffc629";
    c.stroke();
    if (open > 0) {
      // La tapa abierta, colgando de la bisagra.
      const hx = cx + Math.cos(da - span) * R;
      const hy = cy + Math.sin(da - span) * R;
      const a2 = da - span + Math.PI / 2 + open * 1.1;
      c.lineWidth = 8 * k;
      c.strokeStyle = "#ffc629";
      c.beginPath();
      c.moveTo(hx, hy);
      c.lineTo(hx + Math.cos(a2) * R * span * 2, hy + Math.sin(a2) * R * span * 2);
      c.stroke();
    }
    // El eje y la manivela, que da vueltas con el bombo.
    c.fillStyle = INK;
    c.beginPath();
    c.arc(cx, cy, 16 * k, 0, TAU);
    c.fill();
    c.fillStyle = "#ffc629";
    c.beginPath();
    c.arc(cx, cy, 9 * k, 0, TAU);
    c.fill();
    const mx = cx + Math.cos(ang) * 40 * k;
    const my = cy + Math.sin(ang) * 40 * k;
    c.strokeStyle = INK;
    c.lineWidth = 7 * k;
    c.beginPath();
    c.moveTo(cx, cy);
    c.lineTo(mx, my);
    c.stroke();
    c.fillStyle = "#e93d9c";
    c.beginPath();
    c.arc(mx, my, 9 * k, 0, TAU);
    c.fill();
    c.lineWidth = 3 * k;
    c.stroke();
  }

  /** Una bola: su color, el contorno, y el número si entra. */
  function drawBall(b: Ball, x: number, y: number, r: number, big = false): void {
    const k = geo().k;
    c.fillStyle = INK;
    c.beginPath();
    c.arc(x + r * 0.12, y + r * 0.12, r, 0, TAU);
    c.fill();
    c.fillStyle = color(b.idx);
    c.beginPath();
    c.arc(x, y, r, 0, TAU);
    c.fill();
    c.lineWidth = Math.max(1.5, r * 0.12);
    c.strokeStyle = INK;
    c.stroke();
    if (r < 10 * k && !big) return;
    // El número en un disco claro, que gira con la bola.
    c.save();
    c.translate(x, y);
    c.rotate(big ? 0 : b.rot);
    c.fillStyle = "#f6efe2";
    c.beginPath();
    c.arc(0, 0, r * 0.62, 0, TAU);
    c.fill();
    c.fillStyle = INK;
    c.font = `900 ${r * (String(b.idx + 1).length > 2 ? 0.52 : 0.7)}px system-ui, sans-serif`;
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.fillText(String(b.idx + 1), 0, r * 0.04);
    c.restore();
    c.textAlign = "left";
    c.textBaseline = "alphabetic";
  }

  function drawBalls(): void {
    const { cx, cy, R } = geo();
    for (const b of balls) {
      if (tAll < b.born) continue;
      if (b === winBall && tAll >= T_STOP) continue;
      const fall = clamp((tAll - b.born) / 0.25, 0, 1);
      drawBall(b, cx + b.x * R, cy + b.y * R - (1 - fall) * R * 0.5, rb * R);
    }
  }

  function drawChute(): void {
    const { path, cup, k } = geo();
    c.lineCap = "round";
    c.lineJoin = "round";
    for (const [w, col] of [[26, INK], [18, dark ? "#4a4160" : "#5c5378"]] as const) {
      c.strokeStyle = col;
      c.lineWidth = w * k;
      c.beginPath();
      path.forEach((p, i) => (i === 0 ? c.moveTo(p.x, p.y) : c.lineTo(p.x, p.y)));
      c.stroke();
    }
    c.lineCap = "butt";
    c.lineJoin = "miter";
    // El fondo del vaso, por detrás de la bola.
    cupShape(true);
  }

  /**
   * El vaso: un trapecio con boca ancha. Se dibuja en dos veces, el fondo antes
   * de la bola y el frente después, para que la bola quede adentro.
   */
  function cupShape(back: boolean): void {
    const { cup, k } = geo();
    const top = 124 * k;
    const bot = 84 * k;
    const hh = 74 * k;
    const y0 = cup.y;
    const path = (): void => {
      c.beginPath();
      c.moveTo(cup.x - top / 2, y0);
      c.lineTo(cup.x + top / 2, y0);
      c.lineTo(cup.x + bot / 2, y0 + hh);
      c.lineTo(cup.x - bot / 2, y0 + hh);
      c.closePath();
    };
    if (back) {
      c.save();
      c.translate(6 * k, 6 * k);
      path();
      c.fillStyle = INK;
      c.fill();
      c.restore();
      path();
      c.fillStyle = "#b8860b";
      c.fill();
      return;
    }
    // El frente: la mitad de abajo tapa la bola que cayó.
    c.save();
    path();
    c.clip();
    c.fillStyle = "#ffc629";
    c.fillRect(cup.x - top / 2, y0 + hh * 0.38, top, hh);
    c.restore();
    path();
    c.lineWidth = 4 * k;
    c.strokeStyle = INK;
    c.stroke();
    c.fillStyle = INK;
    c.fillRect(cup.x - top / 2 - 6 * k, y0 - 4 * k, top + 12 * k, 8 * k);
  }

  /** La bola ganadora afuera: sale por la compuerta, rueda y cae al vaso. */
  function drawWinnerBall(): void {
    if (tAll < T_STOP) return;
    const { cx, cy, R, path, cup, k } = geo();
    const r0 = rb * R;
    let x: number;
    let y: number;
    let r: number;
    if (tAll < T_OUT) {
      // Del lugar frente a la compuerta, hacia afuera.
      const ea = exitAngle();
      const q = ease.inOutCubic((tAll - T_STOP) / (T_OUT - T_STOP));
      const sx = cx + Math.cos(ea) * (1 - rb * 1.2) * R;
      const sy = cy + Math.sin(ea) * (1 - rb * 1.2) * R;
      x = sx + ((path[0] as { x: number }).x - sx) * q;
      y = sy + ((path[0] as { y: number }).y - sy) * q;
      r = r0;
    } else {
      const q = rollAt(tAll);
      const p = along(path, q);
      // En el borde del vaso, se tambalea.
      const wob = tAll > T_LIP && tAll < T_LAND ? Math.sin((tAll - T_LIP) * 30) * 5 * k : 0;
      x = p.x + wob;
      // Crece mientras baja: al llegar se tiene que leer el número desde el fondo.
      r = r0 + (Math.max(r0, 34 * k) - r0) * ease.outCubic(clamp((tAll - T_OUT) / 1.2, 0, 1));
      // Encima de la canaleta: el centro va un radio más arriba del riel.
      y = p.y - r - 8 * k;
      if (tAll >= T_LAND) {
        const q2 = clamp((tAll - T_LAND) / 0.25, 0, 1);
        const from = p.y - r - 8 * k;
        x = x + (cup.x - x) * ease.inOutCubic(q2);
        y = from + (cup.y + 22 * k - r * 0.4 - from) * ease.inOutCubic(q2);
      }
    }
    winBall.rot += 0.1;
    drawBall(winBall, x, y, r, true);
    // El número, grande, al lado mientras rueda.
    if (tAll > T_OUT + 0.3 && tAll < T_CROWN) {
      chip(`${t("cTomNum")} ${num}`, x + r + 10 * k, y - r - 6 * k, 1, 1.4);
    }
    if (tAll >= T_LAND && tAll < T_CROWN) {
      chip(names[winnerIdx] ?? "", cup.x - 60 * k, cup.y - 60 * k, clamp((tAll - T_LAND) / 0.2, 0, 1), 1.5);
    }
  }

  function drawHud(): void {
    const { k } = geo();
    const top = chrome(c).arriba + 40 * k;
    const shown = balls.filter((b) => tAll >= b.born).length;
    c.textAlign = "right";
    c.textBaseline = "top";
    c.font = `800 ${14 * k}px system-ui, sans-serif`;
    c.fillStyle = "rgba(246,239,226,0.8)";
    c.fillText(t("cTomBalls"), W() - 22 * k, top);
    c.font = `900 ${48 * k}px system-ui, sans-serif`;
    c.fillStyle = "#ffc629";
    c.strokeStyle = INK;
    c.lineWidth = 6 * k;
    c.strokeText(String(shown), W() - 22 * k, top + 18 * k);
    c.fillText(String(shown), W() - 22 * k, top + 18 * k);
    c.textAlign = "left";
    c.textBaseline = "alphabetic";
    c.font = `700 ${12 * k}px ui-monospace, monospace`;
    c.fillStyle = "rgba(246,239,226,0.55)";
    c.fillText(`${t("cWheelRound")} #${beacon.round}`, 22 * k, H() - chrome(c).abajo);
  }

  /* ------------------------------------------------------------- bucle */
  run((dt, now) => {
    tAll += dt;
    shake = Math.max(0, shake - dt * 2.2);
    flashK = Math.max(0, flashK - dt * paceFactor() * 4);
    // La física a paso fijo, con acumulador: la misma ronda da el mismo
    // recorrido a 60 cuadros por segundo y a 144.
    acc += dt;
    let guard = 0;
    while (acc >= DT && guard++ < 40 && tSim < T_STOP + 0.5) {
      step(DT);
      acc -= DT;
    }
    if (acc > DT) acc = 0;
    events();
    sounds();

    const tem = shake > 0;
    if (tem) {
      c.save();
      c.translate(Math.sin(shake * 97) * 8 * shake * u(), Math.sin(shake * 131 + 1.7) * 6 * shake * u());
    }
    drawBack(now);
    drawStand();
    drawChute();
    drawDrum();
    drawBalls();
    drawCage();
    drawWinnerBall();
    cupShape(false);
    if (tem) c.restore();
    drawHud();
    if (tAll >= T_CROWN) {
      c.fillStyle = "rgba(20,14,30,0.35)";
      c.fillRect(0, 0, W(), H());
      flashScreen(c, W(), H(), flashK);
      const e = ease.outBack(Math.min(1, (tAll - T_CROWN) * 1.6));
      const g = geo();
      // Al costado del bombo en horizontal, entre el bombo y el vaso en vertical.
      const px = g.vertical ? W() / 2 : Math.min(W() * 0.68, W() - 260 * g.k);
      const py = g.vertical ? (g.cy + g.R + g.cup.y) / 2 : H() * 0.34;
      // Con la unidad de pantalla, como los demás juegos, y no con la de la
      // escena: en un celular la de la escena es la mitad, y con dos premios
      // los nombres salían a quince píxeles. El cartel ya se achica solo si
      // no entra a lo ancho.
      drawWinnerPlate(c, winnerNames(names, winners), px, py, u(), e, 56);
      tHold += dt * paceFactor();
    }
    if (tHold >= WINNER_HOLD) cleanup();
  });
}
