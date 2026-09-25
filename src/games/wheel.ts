import { T, getLang, t } from "../i18n";
import { beep, beepFor, fanfare, note } from "../sound";
import { drawAvatar, paceFactor, setGameLength, type Beacon } from "../state";
import { INK, WINNER_HOLD, chrome, clamp, drawFlag, ease, mount, drawWinnerPlate, flashScreen, shorten, winnerNames, winnersLabel } from "./overlay";

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

/* Los tiempos de cada fase, en segundos de juego desde el arranque.
   La rueda duraba 7,65 segundos hasta la corona y de esos, tres eran tiempo
   muerto: 1,7 con la rueda completamente quieta y 2,2 de crucero en los que la
   imagen es un borrón y no hay nada que mirar. El resto, que es lo bueno (los
   clics separándose, el puntero arrastrándose, el amague), duraba un segundo y
   medio en total.

   Ahora dura 17,2 y el reparto está al revés: menos borrón, mucha más frenada.
   No es el mismo juego más lento; es el mismo juego con más de lo que vale la
   pena mirar. */
const T_WIND = 1.2;
const T_SPIN = 2.6;
const T_BRAKE = 4.2;
const T_CREEP = 12.0;
const T_HOLD = 14.4;
const T_SETTLE = 15.6;
const T_LOCK = 16.8;
const T_CROWN = 17.2;

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
  if (tt < T_WIND) return 0;
  if (tt < T_SPIN) {
    // La carga. Antes la rueda pasaba 1,7 segundos completamente quieta, que
    // en una pantalla grande es una foto: nadie sabe si arrancó o si se colgó.
    // Ahora se ve tomar velocidad.
    const p = (tt - T_WIND) / (T_SPIN - T_WIND);
    return W0 * Math.pow(p, 2.2);
  }
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
  /** Cuántos gajos se lleva cada persona. */
  const rep = n <= 12 ? Math.max(1, Math.round(SEGS / n)) : 1;
  const segs = n * rep;
  const A = TAU / segs;
  /** El gajo k es de la persona k % n: el intercalado sale solo. */
  const personOf = (k: number): number => ((k % n) + n) % n;


  // El selector de duración apunta a una cantidad de segundos, así que la
  // rueda declara los suyos: 17,2 de juego hasta la corona, más los tres reales
  // del sostén del cartel, que no se estiran.
  setGameLength(T_CROWN, WINNER_HOLD);

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
  let didLock = false;
  let saidPeg = false;
  let saidLast = false;
  let tHold = 0;
  let flashK = 0;
  let shake = 0;
  const rimChars = beacon.randomness.slice(0, 64).split("");

  /* -------------------------------------------------------------- geometría */
  const geo = (): { cx: number; cy: number; R: number; k: number; wide: boolean; alto: boolean } => {
    const k = u();
    // En un celular vertical no hay columna a la izquierda, y la placa del
    // nombre terminaba dibujada **encima de la rueda**, tapándola entera. Ahí
    // la disposición es otra: rueda arriba, centrada, y la placa debajo.
    const alto = H() > W() * 1.1;
    if (alto) {
      const R = Math.min(W() * 0.4, H() * 0.28);
      return { cx: W() / 2, cy: H() * 0.38, R, k, wide: false, alto };
    }
    // En 4:3 la rueda tiene que achicarse, si no la columna de nombres queda
    // tan angosta que los corta. Ese es justo el proyector de sala.
    const wide43 = W() / H() < 1.5;
    const R = Math.min(H() * (wide43 ? 0.34 : 0.395), W() * (wide43 ? 0.26 : 0.3));
    const cx = Math.max(W() * 0.56, W() - R - 110 * k);
    const colW = cx - R - 70 * k;
    return { cx, cy: H() * 0.5, R, k, wide: colW > 260 * k, alto };
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
    flashK = 1;
    cur = winnerIdx;
    curSmooth = winnerIdx;
    say(T[getLang()].cWin(winnersLabel(names, winners)), 1);
    fanfare();
    // A 180 y 340 ms los adornos caían dentro de la fanfarria, que suena al
    // doble de volumen: estaban escritos y no se oían. Después del acorde sí.
    setTimeout(() => beep(note(17), 0.12, "triangle", 0.045), 520);
    setTimeout(() => beep(note(19), 0.12, "triangle", 0.035), 700);
  }

  /* ---------------------------------------------------------------- sonido */
  function tickAudio(w: number): void {
    // Nunca más de catorce pitidos por segundo: cada uno crea un oscilador, y
    // cuarenta por segundo es basura y latencia.
    if (tAll >= T_SPIN && tAll < T_BRAKE) {
      const lap = Math.floor(cum(tAll) * scale / segs);
      if (lap !== lastLap) {
        lastLap = lap;
        // Un tono por vuelta, al pasar el perno tricolor: se pueden contar de
        // oído. A 1400 Hz y 0,008 de volumen no se contaba ninguno.
        beep(note(15), 0.05, "sine", 0.03);
      }
    }
    // El motor. Antes eran 90 Hz fijos, que el parlante de un proyector no
    // reproduce, y además callaba en T_BRAKE: quedaban 1,7 s mudos justo
    // cuando empieza a frenar, que es lo único que la sala está mirando. Ahora
    // suena hasta que los clics toman el relevo y **baja de tono con la rueda**,
    // así el oído y el ojo cuentan lo mismo.
    if (tAll >= T_SPIN && w > 16) {
      const hum = Math.floor(tAll / 0.3);
      if (hum !== lastHum) {
        lastHum = hum;
        beepFor(note(Math.round((w / W0) * 4)), 0.36, "sawtooth", 0.026);
      }
      return;
    }
    if (w > 16 || w <= 0) return;
    const s = Math.floor(((-rot / A) % segs + segs) % segs);
    if (s === lastClick) return;
    lastClick = s;
    // Con pocos participantes cada persona tiene su nota, y entonces el clic
    // sobra: eran dos timbres sin relación disparados en el mismo milisegundo,
    // catorce veces por segundo.
    if (n <= 4) {
      const deg = [5, 8, 10, 12];
      beep(note(deg[personOf(s)] ?? 5), 0.05, "triangle", 0.03);
      return;
    }
    // Altura fija: la frenada ya la cuenta el ritmo, que se va espaciando solo.
    // El glissando que subía mientras la rueda frenaba decía lo contrario de lo
    // que se veía.
    beep(note(8), 0.03, "square", 0.034);
  }

  /* -------------------------------------------------------------- narración */
  function sayIfDue(w: number): void {
    const cues: [number, () => void][] = [
      [0.05, () => say(t("cWheelBuild"), 0.1)],
      [0.7, () => say(T[getLang()].cWheelSplit(segs, rep), 0.15)],
      [T_WIND, () => say(t("cWheelCharge"), 0.3)],
      [T_SPIN, () => say(t("cWheelGo"), 0.45)],
      [3.4, () => say(t("cWheelFast"), 0.5)],
      [6.4, () => say(t("cWheelSlow"), 0.65)],
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
    // Con cierre, no con ventana. Una ventana de 0,05 s de juego dura cuatro o
    // cinco cuadros, así que `say` se disparaba cuatro o cinco veces y cada una
    // cancelaba a la anterior: el narrador tartamudeaba, y justo en el clímax.
    if (tAll >= T_HOLD && !saidPeg) {
      saidPeg = true;
      lastSaid = tAll;
      say(t("cWheelPeg"), 0.9);
    }
    if (tAll >= T_SETTLE && !saidLast) {
      saidLast = true;
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
    const { cx, cy, R, k, wide, alto } = geo();
    // Se interpola para que a toda velocidad titile en vez de estrobar.
    curSmooth += (cur - curSmooth) * Math.min(1, dt * 10);
    const colW = cx - R - 90 * k;
    if (alto) {
      // Vertical: una sola placa, ancha, debajo de la rueda.
      // El ancho descuenta la sombra, el empuje y el 6% que crece la placa
      // encendida: sin eso se salía por el borde derecho.
      const w = Math.min(W() / 1.06 - 76 * k, 520 * k);
      plate((W() - w * 1.06) / 2 - 12 * k, cy + R + 56 * k, w, 92 * k, cur, true);
      return;
    }
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
    drawAvatar(c, names[idx] ?? "", 36 * k, (hgt - av) / 2, av);
    const label = names[idx] ?? "";
    const tx = 36 * k + av + 12 * k;
    // El tope por alto de placa existe para que no reviente el renglón; el
    // tope por ancho, para que un nombre entero entre antes de cortarlo. En
    // vertical la placa es ancha y baja, así que manda el primero.
    c.font = `800 ${Math.min(26 * k, hgt * 0.36, (w - tx) * 0.085)}px system-ui, sans-serif`;
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
    const { cx, cy, R, k, alto } = geo();
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

    // El cartel, en la columna libre y no encima de la rueda: la rueda con el
    // gajo encendido es media foto y no se puede tapar.
      // El fogonazo del revelado: el golpe visual que separa "apareció un
      // nombre" de "pasó algo". Va debajo del cartel, no encima.
    flashScreen(c, W(), H(), flashK);
    const colCx = (cx - R) / 2;
    // Vertical: el cartel va debajo de la rueda, no sobre la columna que no
    // existe. La rueda con el gajo encendido es media foto y no se puede tapar.
    const px = alto ? W() / 2 : Math.max(colCx, 240 * k);
    const py = alto ? Math.min(H() - 150 * k, cy + R + 130 * k) : H() * 0.52;
    drawWinnerPlate(c, winnerNames(names, winners), px, py, k, e, 48);
  }

  function drawHud(): void {
    const k = u();
    c.font = `700 ${11 * k}px ui-monospace, Consolas, monospace`;
    c.textAlign = "left";
    c.fillStyle = "rgba(246,239,226,0.55)";
    c.fillText(`${t("cWheelRound")} #${beacon.round}`, 22 * k, H() - chrome(c).abajo);
    if (tAll >= T_CROWN) {
      c.fillStyle = "rgba(255,198,41,0.75)";
      c.fillText(t("cWheelSeed"), 22 * k, H() - chrome(c).abajo - 18 * k);
    }
  }

  /* ------------------------------------------------------------------ bucle */
  let buildTick = 0;
  run((dt, now) => {
    tAll += dt;
    shake = Math.max(0, shake - dt * 2.2);
    const w = omega(tAll);
    rot = -(startSeg + cum(tAll) * scale) * A;
    if (tAll < 1.1) {
      const want = Math.floor((tAll / 1.1) * 24);
      while (buildTick < want) {
        // Sumar hercios iguales da intervalos que se achican al subir: el oído
        // oye una máquina contando. Por grados de la escala sube parejo, y a
        // 0,012 de volumen no se oía nada de esto en una sala.
        beep(note(5 + Math.floor(buildTick / 2)), 0.05, "square", 0.03);
        buildTick++;
      }
    }
    if (tAll >= T_HOLD && tAll < T_SETTLE) {
      // Se van separando: el amague dura 1,2 segundos y un perno cada 0,07
      // serían diecisiete golpes seguidos, que es ruido. Separándose se lee
      // como una rueda que ya casi no puede.
      const hits = Math.floor(Math.pow((tAll - T_HOLD) / (T_SETTLE - T_HOLD), 0.62) * 7);
      while (pegHits < hits) {
        pegHits++;
        // Y cada golpe más bajo y más grave que el anterior. Siete idénticos
        // seguidos no son una paleta trabada contra un perno: son un aparato.
        const q = pegHits / 7;
        beep(note(Math.max(0, 2 - Math.round(q * 2))), 0.06, "square", 0.062 - q * 0.028);
      }
    }
    // Un cierre propio. La condición era `flash === 0`, y `flash` vuelve a cero
    // a los 0,12 s de juego: desde T_LOCK hasta el final el golpe se redisparaba
    // **catorce veces**, al volumen más alto del juego, encima de la fanfarria,
    // y el puntero parpadeaba en blanco las catorce. Eso era "el audio está
    // horrible", con nombre y apellido.
    if (tAll >= T_LOCK && !didLock) {
      didLock = true;
      flash = 0.12;
      // 70 Hz no sale por el parlante de ningún proyector: el golpe de la traba
      // se perdía entero. El grado 0 sí se oye.
      shake = 1;
      beep(note(0), 0.45, "sine", 0.1);
      setTimeout(() => beep(note(5), 0.07, "square", 0.06), 40);
      setTimeout(() => beep(note(15), 0.12, "triangle", 0.05), 90);
    }
    flash = Math.max(0, flash - dt);
    if (tAll >= T_CROWN) crowned();
    else cur = personOf(segUnder());

    tickAudio(w);
    sayIfDue(w);

    // El temblor del golpe. La carrera y la constelación ya lo tenían; acá
    // faltaba, y es lo que hace que el revelado se sienta en el cuerpo y no
    // sólo se vea. Sale del reloj y no del azar, para que la misma ronda se
    // dibuje igual a 60 y a 144 cuadros por segundo.
    const tem = shake > 0;
    if (tem) {
      c.save();
      c.translate(Math.sin(shake * 97) * 9 * shake * u(), Math.sin(shake * 131 + 1.7) * 7 * shake * u());
    }
    drawBackdrop(now);
    drawDisc(w);
    drawRim(w);
    drawPegs();
    drawHub(w);
    drawPointer(flapper(w));
    if (tem) c.restore();
    if (tAll < T_CROWN) drawRoster(dt);
    drawHud();
    if (tAll >= T_CROWN) drawCrown(tAll - T_CROWN);
    // El sostén del cartel, en segundos reales. Eran 1,55 s de juego, que en
    // modo rápido son 1,24 s: menos de lo que tarda una sala en reaccionar.
    if (tAll >= T_CROWN) tHold += dt * paceFactor();
    flashK = Math.max(0, flashK - dt * paceFactor() * 4);
    if (tHold >= WINNER_HOLD) cleanup();
  });
}
