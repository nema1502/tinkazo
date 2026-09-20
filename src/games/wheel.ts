import { T, getLang, t } from "../i18n";
import { beep, fanfare } from "../sound";
import { avatar, type Beacon } from "../state";
import { INK, clamp, drawFlag, ease, mount, shorten } from "./overlay";

/**
 * La ruleta.
 *
 * El problema viejo no era de estilo, era de geometría. Una rueda de `n` gajos
 * se ve igual cada vuelta de `360/n` grados. Con dos participantes, girarla
 * media vuelta deja una imagen idéntica: el ojo no tiene de dónde agarrarse,
 * no percibe velocidad, y sin velocidad percibida no hay tensión. Por eso con
 * dos nombres parecía un gráfico de torta quieto.
 *
 * La solución es la de las ruletas de feria: **cada persona se lleva varios
 * gajos, intercalados.** Con dos son doce y doce alternados, que es justamente
 * lo que hace mirable a una ruleta de casino. Y de paso se lee la probabilidad
 * de un vistazo: doce y doce.
 *
 * Nada de esto toca el resultado. El ganador llega dado; lo único sembrado es
 * dónde arranca la rueda y cuál de sus gajos queda bajo el puntero.
 */

/** A cuántos gajos apunta la rueda, sea cual sea la cantidad de gente. */
const SEGS = 24;
const TAU = Math.PI * 2;

/* Los tiempos de cada fase, en segundos desde el arranque. */
const T_SPIN = 1.7;
const T_BRAKE = 3.9;
const T_CREEP = 6.2;
const T_HOLD = 6.75;
const T_SETTLE = 7.0;
const T_LOCK = 7.4;
const T_CROWN = 7.65;
const T_END = 9.2;

/** Velocidad de crucero y de entrada al arrastre, en gajos por segundo. */
const W0 = 38.4;
const W1 = 5.6;

/**
 * Velocidad angular en gajos por segundo.
 *
 * El error de la versión anterior era interpolar el ángulo con una cúbica.
 * Eso da "rápido, rápido, rápido, se paró": la curva llega a cero pero su
 * último tramo sigue siendo veloz, así que los clics se cortan de golpe. Acá
 * se define la velocidad y el ángulo sale de integrarla, que es como frena una
 * rueda de verdad.
 *
 * El presupuesto está en gajos y no en radianes a propósito: así el ritmo de
 * los clics es el mismo con dos participantes que con veinticuatro, y lo único
 * que cambia es cuántas vueltas da.
 */
function omega(tt: number): number {
  if (tt < T_SPIN) return 0;
  if (tt < T_BRAKE) return W0;
  if (tt < T_CREEP) {
    const p = (tt - T_BRAKE) / (T_CREEP - T_BRAKE);
    // Cuadrática: cae fuerte al principio y se aplana. El oído necesita que los
    // últimos clics se separen de a poco, no de un saque.
    return W1 + (W0 - W1) * Math.pow(1 - p, 2);
  }
  if (tt < T_HOLD) {
    const p = (tt - T_CREEP) / (T_HOLD - T_CREEP);
    return W1 * Math.pow(1 - p, 1.6);
  }
  // El falso: la paleta trabada contra el perno, casi sin avanzar.
  if (tt < T_SETTLE) return 0.64;
  if (tt >= T_LOCK) return 0;
  const p = (tt - T_SETTLE) / (T_LOCK - T_SETTLE);
  return 1.7 * Math.pow(1 - p, 2.2);
}

export function wheelSpin(
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
  const { c, W, H, u, rng, color, say, dark, cleanup, run } = st;

  const n = names.length;
  /** Cuántos gajos se lleva cada persona. */
  const rep = n <= 12 ? Math.max(1, Math.round(SEGS / n)) : 1;
  const segs = n * rep;
  const A = TAU / segs;
  /** El gajo k es de la persona k % n: el intercalado sale solo. */
  const personOf = (k: number): number => ((k % n) + n) % n;

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

  /* --------------------------------------------------------- dónde termina */
  const startSeg = rng() * segs;
  // Cuál de los gajos del ganador queda bajo el puntero. El ganador ya estaba
  // decidido; esto solo elige cuál de sus pedazos se lleva la foto.
  const winSeg = winnerIdx + n * Math.floor(rng() * rep);
  const landing = winSeg + 0.5;

  /* La integral acumulada de la velocidad, tabulada una sola vez. */
  const STEPS = 1200;
  const cumT: number[] = new Array(STEPS + 1);
  cumT[0] = 0;
  const h = T_LOCK / STEPS;
  for (let i = 1; i <= STEPS; i++) {
    const a = omega((i - 1) * h);
    const b = omega(i * h);
    cumT[i] = (cumT[i - 1] as number) + ((a + b) / 2) * h;
  }
  const BUDGET = cumT[STEPS] as number;
  /** Cuánto tiene que girar en total para caer justo donde corresponde. */
  let total = BUDGET - ((((BUDGET - (landing - startSeg)) % segs) + segs) % segs);
  if (total < BUDGET - segs / 2) total += segs;
  const scale = total / BUDGET;

  /** Gajos recorridos hasta el momento `tt`. */
  function cum(tt: number): number {
    if (tt <= 0) return 0;
    if (tt >= T_LOCK) return BUDGET;
    const x = (tt / T_LOCK) * STEPS;
    const i = Math.floor(x);
    const f = x - i;
    const a = cumT[i] as number;
    const b = cumT[Math.min(STEPS, i + 1)] as number;
    return a + (b - a) * f;
  }

  /* ----------------------------------------------------------------- estado */
  let tAll = 0;
  let rot = -startSeg * A;
  let lastClick = Math.floor(startSeg);
  let lastLap = -1;
  let lastHum = -1;
  let lastSaid = -999;
  let saidUpTo = -1;
  let pegHits = 0;
  let cur = personOf(Math.floor(startSeg));
  let curSmooth = cur;
  let flash = 0;
  const built: number[] = [];
  const rimChars = beacon.randomness.slice(0, 64).split("");

  /* -------------------------------------------------------------- geometría */
  const geo = (): { cx: number; cy: number; R: number; k: number; wide: boolean } => {
    const k = u();
    // En 4:3 la rueda tiene que achicarse, si no la columna de nombres queda
    // tan angosta que los corta. Ese es justo el proyector de sala.
    const wide43 = W() / H() < 1.5;
    const R = Math.min(H() * (wide43 ? 0.34 : 0.395), W() * (wide43 ? 0.26 : 0.3));
    const cx = Math.max(W() * 0.56, W() - R - 110 * k);
    const colW = cx - R - 70 * k;
    return { cx, cy: H() * 0.5, R, k, wide: colW > 260 * k };
  };

  /** Qué gajo está bajo el puntero. */
  const segUnder = (): number => {
    const s = ((-rot / A) % segs + segs) % segs;
    return Math.floor(s) % segs;
  };

  /**
   * Cuánto está doblada la paleta contra el perno.
   *
   * Es lo que hace mirable una ruleta de premios y lo que faltaba. Solo dibujo:
   * nunca vuelve a entrar en el ángulo de la rueda, así que el determinismo
   * queda intacto.
   */
  function flapper(w: number): number {
    const s = ((-rot / A) % segs + segs) % segs;
    const frac = s - Math.floor(s);
    const edge = Math.min(frac, 1 - frac) * 2;
    const bend = clamp(1 - edge / 0.22, 0, 1);
    // A alta velocidad la paleta no alcanza a volver y queda levantada.
    return 0.42 * Math.max(bend, clamp(w / 24, 0, 0.75));
  }

  function skip(): void {
    if (tAll >= T_CROWN) return;
    tAll = T_CROWN;
    rot = -(startSeg + BUDGET * scale) * A;
    crowned();
  }

  let didCrown = false;
  function crowned(): void {
    if (didCrown) return;
    didCrown = true;
    cur = winnerIdx;
    curSmooth = winnerIdx;
    say(T[getLang()].cWin(names[winnerIdx] ?? ""), 1);
    fanfare();
    setTimeout(() => beep(1568, 0.09, "triangle", 0.04), 180);
    setTimeout(() => beep(2093, 0.09, "triangle", 0.03), 340);
  }

  /* ---------------------------------------------------------------- sonido */
  function tickAudio(w: number): void {
    // Nunca más de catorce pitidos por segundo: cada uno crea un oscilador, y
    // cuarenta por segundo es basura y latencia.
    if (tAll >= T_SPIN && tAll < T_BRAKE) {
      const lap = Math.floor(cum(tAll) * scale / segs);
      if (lap !== lastLap) {
        lastLap = lap;
        // Un tono por vuelta, al pasar el perno tricolor: se pueden contar de oído.
        beep(1400, 0.02, "sine", 0.008);
      }
      const hum = Math.floor(tAll / 0.45);
      if (hum !== lastHum) {
        lastHum = hum;
        beep(90, 0.5, "sawtooth", 0.03);
      }
      return;
    }
    if (w > 16 || w <= 0) return;
    const s = Math.floor(((-rot / A) % segs + segs) % segs);
    if (s === lastClick) return;
    lastClick = s;
    // El tono sube mientras la rueda frena: es el truco más viejo que hay.
    beep(420 + 560 * (1 - w / 16), 0.03, "square", 0.03);
    // Con pocos participantes cada persona tiene su nota. Con dos se oye de
    // quién es cada gajo sin mirar la pantalla, que es la respuesta sonora al
    // problema que tenía la ruleta.
    if (n <= 4) {
      const notes = [523, 659, 784, 988];
      beep(notes[personOf(s)] ?? 523, 0.03, "triangle", 0.03);
    }
  }

  /* -------------------------------------------------------------- narración */
  function sayIfDue(w: number): void {
    const cues: [number, () => void][] = [
      [0.05, () => say(t("cWheelBuild"), 0.1)],
      [0.55, () => say(T[getLang()].cWheelSplit(segs, rep), 0.15)],
      [0.9, () => say(t("cWheelCharge"), 0.3)],
      [T_SPIN, () => say(t("cWheelGo"), 0.45)],
      [2.6, () => say(t("cWheelFast"), 0.5)],
      [4.6, () => say(t("cWheelSlow"), 0.65)],
    ];
    for (let i = saidUpTo + 1; i < cues.length; i++) {
      const cue = cues[i] as [number, () => void];
      if (tAll < cue[0]) break;
      saidUpTo = i;
      cue[1]();
      lastSaid = tAll;
    }
    if (tAll >= T_CREEP && tAll < T_HOLD && w < 3 && tAll - lastSaid > 0.45) {
      lastSaid = tAll;
      say(T[getLang()].cWheelOn(names[cur] ?? ""), 0.75);
    }
    if (tAll >= T_HOLD && tAll < T_HOLD + 0.05) {
      lastSaid = tAll;
      say(t("cWheelPeg"), 0.9);
    }
    if (tAll >= T_SETTLE && tAll < T_SETTLE + 0.06) {
      lastSaid = tAll;
      say(t("cWheelLast"), 0.95);
    }
  }

  /* ---------------------------------------------------------------- dibujo */
  function drawBackdrop(now: number): void {
    const { cx, cy, k } = geo();
    c.fillStyle = dark ? "#191226" : "#241a3c";
    c.fillRect(0, 0, W(), H());
    // Un sol de doce rayos contra-rotando. Es lo que hace que la escena nunca
    // esté del todo quieta, ni siquiera mientras se arma ni al final.
    c.save();
    c.globalAlpha = 0.06;
    c.translate(cx, cy);
    c.rotate(-now * 0.04);
    c.fillStyle = "#ffc629";
    for (let i = 0; i < 12; i++) {
      c.rotate(TAU / 12);
      c.beginPath();
      c.moveTo(0, 0);
      c.lineTo(Math.cos(-0.1) * 1400 * k, Math.sin(-0.1) * 1400 * k);
      c.lineTo(Math.cos(0.1) * 1400 * k, Math.sin(0.1) * 1400 * k);
      c.closePath();
      c.fill();
    }
    c.restore();
  }

  function drawDisc(w: number): void {
    const { cx, cy, R, k } = geo();
    const Rd = R * 0.86;
    const Rh = R * 0.22;
    // Sombra dura de la casa, sin desenfoque.
    c.fillStyle = INK;
    c.beginPath();
    c.arc(cx + 10 * k, cy + 12 * k, R, 0, 7);
    c.fill();

    const pass = w > 6 ? [0, -w * A * 0.012, -w * A * 0.024] : [0];
    const alpha = [1, 0.35, 0.18];
    pass.forEach((off, pi) => {
      c.save();
      c.globalAlpha = alpha[pi] ?? 1;
      c.translate(cx, cy);
      c.rotate(rot + off);
      for (let j = 0; j < segs; j++) {
        const a0 = j * A - Math.PI / 2;
        c.beginPath();
        c.moveTo(0, 0);
        c.arc(0, 0, Rd, a0, a0 + A);
        c.closePath();
        c.fillStyle = color(personOf(j));
        c.fill();
        c.strokeStyle = INK;
        c.lineWidth = 2.5 * k;
        c.stroke();
      }
      c.restore();
    });
    c.globalAlpha = 1;

    // Sin esto, veinticuatro gajos planos se vuelven papilla en un proyector.
    const g = c.createRadialGradient(cx, cy, Rh, cx, cy, Rd);
    g.addColorStop(0, "rgba(0,0,0,0.20)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    c.fillStyle = g;
    c.beginPath();
    c.arc(cx, cy, Rd, 0, 7);
    c.fill();
  }

  function drawPegs(): void {
    const { cx, cy, R, k } = geo();
    const rr = R * 0.875;
    c.save();
    c.translate(cx, cy);
    c.rotate(rot);
    for (let j = 0; j < segs; j++) {
      const a = j * A - Math.PI / 2;
      const x = Math.cos(a) * rr;
      const y = Math.sin(a) * rr;
      const s = 8 * k;
      c.beginPath();
      c.moveTo(x, y - s);
      c.lineTo(x + s, y);
      c.lineTo(x, y + s);
      c.lineTo(x - s, y);
      c.closePath();
      c.fillStyle = "#ffc629";
      c.fill();
      c.lineWidth = 2 * k;
      c.strokeStyle = INK;
      c.stroke();
    }
    // El detalle boliviano: el perno cero lleva tres barritas. Marca la vuelta,
    // así que es funcional. De lejos es un acento de color; de cerca se ve.
    const a0 = -Math.PI / 2;
    const x = Math.cos(a0) * rr;
    const y = Math.sin(a0) * rr;
    c.save();
    c.translate(x, y);
    c.rotate(a0 + Math.PI / 2);
    c.fillStyle = INK;
    c.fillRect(-9 * k, -22 * k, 18 * k, 16 * k);
    drawFlag(c, -7.5 * k, -20.5 * k, 15 * k, 13 * k);
    c.restore();
    c.restore();
  }

  function drawRim(w: number): void {
    const { cx, cy, R, k } = geo();
    const r0 = R * 0.88;
    c.save();
    c.beginPath();
    c.arc(cx, cy, R, 0, 7);
    c.arc(cx, cy, r0, 0, 7, true);
    c.fillStyle = dark ? "#120d22" : "#2b1f4a";
    c.fill("evenodd");
    c.restore();
    c.lineWidth = 3 * k;
    c.strokeStyle = INK;
    [R, r0].forEach((r) => {
      c.beginPath();
      c.arc(cx, cy, r, 0, 7);
      c.stroke();
    });

    const rm = (R + r0) / 2;
    if (w > 12) {
      // A toda velocidad los dígitos no se leen: se dibujan rayas.
      c.strokeStyle = "rgba(246,239,226,0.30)";
      c.lineWidth = 2 * k;
      for (let i = 0; i < 64; i++) {
        const a = rot + (i / 64) * TAU;
        c.beginPath();
        c.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
        c.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
        c.stroke();
      }
      return;
    }
    // Los 64 dígitos de la semilla, escritos en el borde. Sacá la foto y
    // comprobalos: son los mismos que publicó el faro.
    const shown = Math.min(64, Math.floor(clamp(tAll / 0.7, 0, 1) * 64));
    c.save();
    c.translate(cx, cy);
    c.font = `700 ${15 * k}px ui-monospace, Consolas, monospace`;
    c.textAlign = "center";
    c.textBaseline = "middle";
    for (let i = 0; i < shown; i++) {
      const a = rot + (i / 64) * TAU - Math.PI / 2;
      // En la mitad de abajo del aro el dígito saldría cabeza abajo. Se lo gira
      // media vuelta y se lo pone del otro lado del radio: el comentario del
      // código dice "sacá la foto y comprobalos", y con la mitad ilegible eso
      // era mentira.
      const upsideDown = Math.cos(a) < 0;
      c.save();
      c.rotate(a + Math.PI / 2 + (upsideDown ? Math.PI : 0));
      c.fillStyle = tAll >= T_CROWN ? "#ffc629" : "rgba(246,239,226,0.72)";
      c.fillText(rimChars[i] ?? "", 0, upsideDown ? rm : -rm);
      c.restore();
    }
    c.restore();
  }

  function drawHub(w: number): void {
    const { cx, cy, R, k } = geo();
    const rh = R * 0.2;
    c.beginPath();
    c.arc(cx, cy, rh, 0, 7);
    c.fillStyle = dark ? "#221a33" : "#ffffff";
    c.fill();
    c.lineWidth = 4 * k;
    c.strokeStyle = INK;
    c.stroke();
    // La maza contra-rota despacio: la llama nunca se borronea y nunca queda
    // del todo quieta.
    c.save();
    c.translate(cx, cy);
    c.rotate(clamp(-rot * 0.25, -1.2, 1.2) * (w > 0 ? 1 : 0));
    c.fillStyle = "#e93d9c";
    // La llama mide 22 de ancho por 24 de alto en su propia escala, así que se
    // centra a mano: si no, queda corrida y el cubo la corta.
    const sc = (rh * 1.25) / 26;
    const r = (rx: number, ry: number, rw: number, rh2: number): void =>
      c.fillRect((rx - 11) * sc, (ry - 11) * sc, rw * sc, rh2 * sc);
    r(2, 11, 16, 7); r(15, 3, 4, 10); r(14, 0, 8, 4); r(20, -2, 2, 3); r(0, 9, 3, 4);
    r(3, 18, 2.5, 6); r(8, 18, 2.5, 6); r(12.5, 18, 2.5, 6); r(16, 18, 2.5, 6);
    c.restore();
  }

  function drawPointer(flap: number): void {
    const { cx, cy, R, k } = geo();
    const top = cy - R - 30 * k;
    c.fillStyle = INK;
    c.fillRect(cx - 6 * k, top - 24 * k, 12 * k, 30 * k);
    c.save();
    c.translate(cx, top + 4 * k);
    c.rotate(flap);
    c.beginPath();
    c.moveTo(-17 * k, 0);
    c.lineTo(17 * k, 0);
    c.lineTo(0, 34 * k);
    c.closePath();
    c.fillStyle = flash > 0 ? "#ffffff" : "#ffc629";
    c.fill();
    c.lineWidth = 4 * k;
    c.strokeStyle = INK;
    c.stroke();
    c.restore();
  }

  function drawRoster(dt: number): void {
    const { cx, cy, R, k, wide } = geo();
    // Se interpola para que a toda velocidad titile en vez de estrobar.
    curSmooth += (cur - curSmooth) * Math.min(1, dt * 10);
    const colW = cx - R - 90 * k;
    if (!wide || n > 14) {
      // Una sola placa grande, la del puntero: con muchos nombres el listado no
      // se lee de lejos, y una placa que cambia sí.
      plate(40 * k, cy - 48 * k, Math.max(240 * k, colW), 96 * k, cur, true);
      return;
    }
    const rows = Math.min(n, 9);
    const gap = 10 * k;
    const hgt = Math.min(64 * k, (H() * 0.72 - gap * rows) / rows);
    const y0 = cy - (rows * (hgt + gap) - gap) / 2;
    for (let i = 0; i < rows; i++) {
      plate(40 * k, y0 + i * (hgt + gap), colW, hgt, i, i === cur);
    }
  }

  function plate(x: number, y: number, w: number, hgt: number, idx: number, on: boolean): void {
    const k = u();
    const push = on ? 12 * k : 0;
    const sc = on ? 1.06 : 1;
    // Todas respiran: ninguna queda quieta.
    const br = 1 + 0.01 * Math.sin(tAll * 2 + idx);
    c.save();
    c.translate(x + push, y + hgt / 2);
    c.scale(sc * br, sc * br);
    c.translate(0, -hgt / 2);
    c.fillStyle = INK;
    c.fillRect(5 * k, 5 * k, w, hgt);
    c.fillStyle = dark ? "#221a33" : "#ffffff";
    c.fillRect(0, 0, w, hgt);
    c.lineWidth = on ? 4 * k : 3 * k;
    c.strokeStyle = on ? "#ffc629" : INK;
    c.strokeRect(0, 0, w, hgt);
    c.fillStyle = color(idx);
    c.fillRect(0, 0, on ? 26 * k : 10 * k, hgt);
    const av = Math.min(hgt * 0.62, 44 * k);
    const im = face(idx);
    if (im.complete && im.naturalWidth) c.drawImage(im, 36 * k, (hgt - av) / 2, av, av);
    const label = names[idx] ?? "";
    const tx = 36 * k + av + 12 * k;
    c.font = `800 ${Math.min(26 * k, hgt * 0.4)}px system-ui, sans-serif`;
    c.textAlign = "left";
    c.textBaseline = "middle";
    c.fillStyle = dark ? "#f6efe2" : INK;
    let cut = label.length;
    while (cut > 4 && c.measureText(shorten(label, cut)).width > w - tx - 14 * k) cut--;
    c.fillText(shorten(label, cut), tx, hgt / 2);
    c.textBaseline = "alphabetic";
    c.restore();
  }

  function drawCrown(p: number): void {
    const { cx, cy, R, k } = geo();
    const e = ease.outBack(Math.min(1, p * 1.6));
    c.fillStyle = "rgba(0,0,0,0.45)";
    c.beginPath();
    c.arc(cx, cy, R * 1.02, 0, 7);
    c.fill();
    // Los gajos del ganador salen hacia afuera y quedan encendidos.
    c.save();
    c.translate(cx, cy);
    c.rotate(rot);
    for (let j = 0; j < segs; j++) {
      if (personOf(j) !== winnerIdx) continue;
      const a0 = j * A - Math.PI / 2;
      const mid = a0 + A / 2;
      c.save();
      c.translate(Math.cos(mid) * 16 * k * e, Math.sin(mid) * 16 * k * e);
      c.beginPath();
      c.moveTo(0, 0);
      c.arc(0, 0, R * 0.86, a0, a0 + A);
      c.closePath();
      c.fillStyle = color(winnerIdx);
      c.fill();
      c.lineWidth = 8 * k;
      c.strokeStyle = "#ffc629";
      c.stroke();
      c.restore();
    }
    c.restore();

    const name = names[winnerIdx] ?? "";
    const label = shorten(name, 22);
    // En la columna libre, no encima de la rueda: la rueda con el gajo
    // encendido es media foto y no se puede tapar.
    const colCx = (cx - R) / 2;
    c.save();
    c.translate(Math.max(colCx, 240 * k), H() * 0.52);
    c.scale(e, e);
    c.font = `900 ${48 * k}px system-ui, sans-serif`;
    c.textAlign = "center";
    c.textBaseline = "middle";
    const bw = c.measureText(label).width + 72 * k;
    const bh = 110 * k;
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
    c.fillStyle = "rgba(246,239,226,0.55)";
    c.fillText(`${t("cWheelRound")} #${beacon.round}`, 22 * k, H() - 26 * k);
    if (tAll >= T_CROWN) {
      c.fillStyle = "rgba(255,198,41,0.75)";
      c.fillText(t("cWheelSeed"), 22 * k, H() - 44 * k);
    }
  }

  /* ------------------------------------------------------------------ bucle */
  let buildTick = 0;
  run((dt, now) => {
    tAll += dt;
    const w = omega(tAll);
    rot = -(startSeg + cum(tAll) * scale) * A;
    if (tAll < 0.8) {
      const want = Math.floor((tAll / 0.8) * 24);
      while (buildTick < want) {
        beep(380 + buildTick * 9, 0.02, "square", 0.012);
        buildTick++;
        built.push(buildTick);
      }
    }
    if (tAll >= T_HOLD && tAll < T_SETTLE) {
      const hits = Math.floor((tAll - T_HOLD) / 0.07);
      while (pegHits < hits) {
        pegHits++;
        beep(150, 0.03, "square", 0.035);
      }
    }
    if (tAll >= T_LOCK && flash === 0) {
      flash = 0.12;
      beep(70, 0.35, "sine", 0.09);
      setTimeout(() => beep(1046, 0.06, "square", 0.05), 40);
    }
    flash = Math.max(0, flash - dt);
    if (tAll >= T_CROWN) crowned();
    else cur = personOf(segUnder());

    tickAudio(w);
    sayIfDue(w);

    drawBackdrop(now);
    drawDisc(w);
    drawRim(w);
    drawPegs();
    drawHub(w);
    drawPointer(flapper(w));
    if (tAll < T_CROWN) drawRoster(dt);
    drawHud();
    if (tAll >= T_CROWN) drawCrown(tAll - T_CROWN);
    if (tAll >= T_END) cleanup();
  });
}
