import { audio, isMuted } from "./sound";

/**
 * La música del estadio: andina con beat.
 *
 * Charango, zampoña y bombo sobre un beat electrónico, generados en el
 * navegador. Sin archivos de audio, sin licencias, y distinta en cada ronda: el
 * motivo de la zampoña y la vuelta de acordes salen de la semilla.
 *
 * Tres decisiones que no son de gusto:
 *
 * - **La escala es la pentatónica de la menor.** Tiene las mismas cinco notas
 *   que la pentatónica de do mayor de los efectos (`note()` en sound.ts), así
 *   que la música y los golpes de los juegos nunca chocan entre sí.
 * - **La música sigue a la tensión.** Cada línea de la caja del estadio trae
 *   su tensión, de 0 a 1, y la música la usa para prender capas: primero el
 *   bombo, después el charango en ritmo de huayno, el beat, la zampoña y al
 *   final todo doblado. Así sirve para todos los juegos sin que ninguno tenga
 *   que saber de música.
 * - **La sorpresa se escucha como silencio.** Cuando la tensión pega un salto
 *   (la ruleta que se para en otro nombre, el apagón del teleférico), la
 *   música se corta un tiempo entero y vuelve con un platillo. Y cuando sale
 *   el ganador, remata: bombo, platillo y el charango en trémolo.
 *
 * Es música de fondo: arranca prendida, más baja que los efectos, y el botón
 * de la página la apaga (y se acuerda). El sonido apagado también la apaga.
 * Desde que no hay relator con voz (28 de septiembre de 2026), es lo que
 * acompaña el show.
 */

const MUSIC_KEY = "tinkazo.musica";

function load(): boolean {
  try {
    return localStorage.getItem(MUSIC_KEY) !== "0";
  } catch {
    return true;
  }
}

let enabled = load();

export const musicOn = (): boolean => enabled;

export function toggleMusic(): void {
  enabled = !enabled;
  try {
    localStorage.setItem(MUSIC_KEY, enabled ? "1" : "0");
  } catch {
    /* que no se guarde no rompe nada */
  }
  if (!enabled) stopMusic();
}

/**
 * Marca los nodos de la música. El auditor de sonido juzga los efectos de
 * cada juego (afinación, registro, golpes repetidos) y la música tiene otras
 * reglas: un bombo que se repite es un ritmo, no un error. Con la marca, el
 * auditor la cuenta aparte en vez de mezclarla con los efectos.
 */
function tag<T extends AudioScheduledSourceNode>(n: T): T {
  (n as T & { __musica?: boolean }).__musica = true;
  return n;
}

/* --------------------------------------------------------------- la escala */

/** La pentatónica de la menor, en semitonos desde la. */
const PENTA = [0, 3, 5, 7, 10];
/** Semitonos desde el la de 440 Hz a hercios. */
const hz = (s: number): number => 440 * Math.pow(2, s / 12);
/** Un grado de la pentatónica, desde el la de 440, subiendo de a octavas. */
const deg = (d: number): number => (PENTA[((d % 5) + 5) % 5] as number) + 12 * Math.floor(d / 5);

interface Chord {
  /** La nota del bajo. */
  root: number;
  /** Las cinco cuerdas del charango, graves a agudas. */
  strings: number[];
}

/** Los acordes del huayno, voceados en el registro del charango. */
const AM: Chord = { root: -36, strings: [-5, 0, 3, 7, 12] };
const C: Chord = { root: -33, strings: [-5, 0, 3, 7, 10] };
const G: Chord = { root: -38, strings: [-2, 2, 5, 10, 14] };
const EM: Chord = { root: -29, strings: [-5, -2, 2, 7, 10] };

/** Vueltas de ocho compases de dos por cuatro. La semilla elige una. */
const PROGRESSIONS: Chord[][] = [
  [AM, AM, C, G, AM, G, EM, AM],
  [AM, C, G, AM, AM, C, EM, AM],
  [AM, AM, G, C, AM, EM, G, AM],
];

/* ------------------------------------------------------------- el estado */

interface Session {
  ctx: AudioContext;
  bus: GainNode;
  wet: GainNode;
  noise: AudioBuffer;
  rng: () => number;
  prog: Chord[];
  /** El motivo de la zampoña: grado o -1 (silencio) por semicorchea, dos compases. */
  motif: number[];
  /** Cuándo suena la próxima semicorchea, en la hora del contexto de audio. */
  next: number;
  step: number;
  started: number;
  /** La tensión que pide el relator, y la que suena, que la persigue. */
  target: number;
  level: number;
  /** Hasta cuándo dura el corte de una sorpresa. */
  breakUntil: number;
  crashAt: number;
  won: boolean;
  timer: number;
  /** La semilla con que arrancó: pedirla otra vez con la misma no la reinicia. */
  seed: number;
  /** Qué toca: el andino de siempre, o la chovena del juego cruceño. */
  style: MusicStyle;
  /** La música cortada en seco por el juego: el corte de la chovena. */
  hold: boolean;
  /** El pulso, multiplicado: más de 1 acelera. */
  tempo: number;
  /** La chovena entera, escrita al arrancar: la melodía y los acordes de toda la forma. */
  cho: Cho | null;
}

/** El andino de siempre, o la chovena, la música chiquitana del juego de la rueda. */
export type MusicStyle = "andino" | "chovena";

let cur: Session | null = null;

/** Un generador sembrado, el mismo que usan los juegos. */
function seeded(seed: number): () => number {
  let s = seed | 0;
  return (): number => {
    s = (s + 0x6d2b79f5) | 0;
    let q = Math.imul(s ^ (s >>> 15), 1 | s);
    q = (q + Math.imul(q ^ (q >>> 7), 61 | q)) ^ q;
    return ((q ^ (q >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Arranca la música de un sorteo. `seed` sale de la ronda, así que la misma
 * ronda suena igual. No hace nada si el modo está apagado o no hay audio.
 */
export function startMusic(seed: number, style: MusicStyle = "andino"): void {
  // Con la tarjeta de "cómo se juega" la música ya suena cuando el juego la
  // pide: volver a empezarla desde el primer compás se oía como un corte.
  if (cur && cur.seed === seed && cur.style === style) return;
  stopMusic();
  if (!enabled || isMuted()) return;
  const ctx = audio();
  if (!ctx) return;
  const rng = seeded(seed ^ 0x5eed);

  // El bus de la música va aparte de los efectos: un compresor para que las
  // capas sumadas no saturen, y sin el paso bajo de los efectos, que le
  // quitaría el brillo a los platillos.
  const bus = ctx.createGain();
  bus.gain.value = 0;
  bus.gain.linearRampToValueAtTime(0.3, ctx.currentTime + 0.6);
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -16;
  comp.ratio.value = 4;
  comp.attack.value = 0.006;
  comp.release.value = 0.2;
  bus.connect(comp);
  comp.connect(ctx.destination);

  // Un poco de sala para la zampoña y el charango: un estadio no suena seco.
  const verb = ctx.createConvolver();
  verb.buffer = impulse(ctx, rng);
  const wet = ctx.createGain();
  wet.gain.value = 0.28;
  wet.connect(verb);
  verb.connect(bus);

  cur = {
    ctx,
    bus,
    wet,
    noise: noiseBuffer(ctx, rng),
    rng,
    prog: PROGRESSIONS[Math.floor(rng() * PROGRESSIONS.length)] ?? (PROGRESSIONS[0] as Chord[]),
    motif: writeMotif(rng),
    next: ctx.currentTime + 0.12,
    step: 0,
    started: ctx.currentTime,
    target: 0.1,
    level: 0.1,
    breakUntil: 0,
    crashAt: -1,
    won: false,
    timer: 0,
    seed,
    style,
    hold: false,
    tempo: 1,
    // La melodía sale del mismo azar, después de lo del andino: los otros
    // juegos suenan igual que antes de que existiera la chovena.
    cho: style === "chovena" ? writeChovena(rng) : null,
  };
  cur.timer = window.setInterval(tick, 40);
  tick();
}

/** La corta con un fundido corto. Se llama al desmontar el estadio. */
export function stopMusic(): void {
  const s = cur;
  if (!s) return;
  cur = null;
  clearInterval(s.timer);
  const t = s.ctx.currentTime;
  s.bus.gain.cancelScheduledValues(t);
  s.bus.gain.setValueAtTime(s.bus.gain.value, t);
  s.bus.gain.linearRampToValueAtTime(0, t + 0.35);
  setTimeout(() => s.bus.disconnect(), 600);
}

/**
 * Corta la música en seco, o la vuelve a soltar: el corte de la chovena, que
 * es la mecánica del juego. Corta el bus entero en 25 ms (también el eco de la
 * sala, porque un corte con cola no se oye como corte) y al soltarla retoma en
 * el uno de un compás, como un conjunto que vuelve a entrar.
 */
export function musicHold(on: boolean): void {
  const s = cur;
  if (!s || s.won || s.hold === on) return;
  s.hold = on;
  const t = s.ctx.currentTime;
  s.bus.gain.cancelScheduledValues(t);
  s.bus.gain.setValueAtTime(s.bus.gain.value, t);
  if (on) {
    s.bus.gain.linearRampToValueAtTime(0, t + 0.025);
    return;
  }
  s.bus.gain.linearRampToValueAtTime(0.3, t + 0.03);
  s.next = t + 0.03;
  s.step = Math.ceil(s.step / 8) * 8;
}

/**
 * El silencio de antes del ganador: la música se corta en seco un momento
 * antes del revelado, y el remate la vuelve a abrir. "Un cuarto de segundo sin
 * nada es el efecto más barato que existe" (docs/juegos.md), y lo que más
 * mueve en la música de baile es justamente eso: vaciar y volver con todo
 * (investigación del audio, 4 de octubre de 2026). Cada juego lo llama con su
 * propio reloj, unos 0,4 s reales antes de coronar.
 */
export function musicBreath(): void {
  musicHold(true);
}

/** El pulso de la música, multiplicado: 1 es el normal, más acelera. */
export function musicTempo(mul: number): void {
  if (cur) cur.tempo = Math.max(0.5, Math.min(2, mul));
}

/**
 * Lo que dice el relator, con su tensión. Un salto grande es una sorpresa: la
 * música se calla un tiempo. Tensión 1 es el ganador: remate.
 */
export function musicCue(heat: number): void {
  const s = cur;
  if (!s || s.won) return;
  if (heat >= 0.99) {
    s.won = true;
    const at = Math.max(s.next, s.ctx.currentTime + 0.03);
    // Si el juego la dejó cortada (el silencio de antes del ganador, o el
    // corte de la chovena), el remate la vuelve a abrir.
    if (s.hold) {
      s.hold = false;
      s.bus.gain.cancelScheduledValues(s.ctx.currentTime);
      s.bus.gain.setValueAtTime(0.3, s.ctx.currentTime);
    }
    if (s.style === "chovena") finaleChovena(s, at);
    else finale(s, at);
    return;
  }
  if (s.style === "andino" && heat - s.level >= 0.3) {
    const beat = beatLength(s);
    s.breakUntil = s.next + beat;
    s.crashAt = s.breakUntil;
  }
  s.target = Math.max(heat, s.target * 0.5);
}

/* ---------------------------------------------------------- el secuenciador */

/** Un tiempo, en segundos. De 96 a 132 golpes por minuto según la tensión. */
// La chovena no acelera con la tensión: los bailarines pisan en el tiempo, y
// el juego calcula ese tiempo con el mismo número. Acelera cuando el juego lo pide.
const beatLength = (s: Session): number =>
  s.style === "chovena" ? 60 / (CHO_BPM * s.tempo) : 60 / ((96 + 36 * s.level) * s.tempo);

function tick(): void {
  const s = cur;
  if (!s) return;
  if (isMuted()) {
    stopMusic();
    return;
  }
  // La tensión sube de a poco aunque el relator no diga nada: el piso crece
  // con el tiempo, así que la música siempre va de menos a más.
  const elapsed = s.ctx.currentTime - s.started;
  const floor = Math.min(0.55, 0.12 + elapsed / 50);
  const want = Math.max(s.target, floor);
  s.level += (want - s.level) * 0.06;
  s.target = Math.max(floor, s.target - 0.004);
  if (s.won) return;
  // Cortada por el juego: no se arma nada, y al volver arranca desde ahora.
  if (s.hold) {
    s.next = Math.max(s.next, s.ctx.currentTime);
    return;
  }

  while (s.next < s.ctx.currentTime + 0.22) {
    const sixteenth = beatLength(s) / 4;
    // Durante el corte de una sorpresa no suena nada.
    if (s.style === "chovena") playStepChovena(s, s.next, s.step);
    else if (s.next >= s.breakUntil) playStep(s, s.next, s.step);
    if (s.crashAt > 0 && s.next >= s.crashAt) {
      crash(s, s.next, 0.5);
      bombo(s, s.next, 1);
      s.crashAt = -1;
    }
    s.next += sixteenth;
    s.step++;
  }
}

/** Lo que suena en una semicorchea. Ocho por compás de dos por cuatro. */
function playStep(s: Session, t: number, step: number): void {
  const L = s.level;
  const inBar = step % 8;
  const bar = Math.floor(step / 8);
  const chord = s.prog[bar % s.prog.length] as Chord;

  // El bombo legüero: en el uno siempre, y la síncopa del huayno con tensión.
  if (inBar === 0) bombo(s, t, 0.8);
  if (L > 0.3 && inBar === 6) bombo(s, t, 0.45);

  // El bajo, en el uno y en el "y" del dos; con tensión salta de octava.
  if (L > 0.15 && (inBar === 0 || inBar === 6)) bass(s, t, chord.root + (L > 0.8 && inBar === 6 ? 12 : 0));

  // El charango en ritmo de huayno: larga, corta, corta. Abajo, abajo, arriba.
  if (L > 0.15) {
    const pos = inBar % 4;
    if (pos === 0) strum(s, t, chord, true, 1);
    if (pos === 2) strum(s, t, chord, true, 0.6);
    if (pos === 3) strum(s, t, chord, false, 0.5);
  } else if (inBar === 0) {
    strum(s, t, chord, true, 0.5);
  }

  // El beat: bombo electrónico en cada tiempo, platillo cerrado a contratiempo,
  // palmas en el dos, y con toda la tensión el platillo en semicorcheas.
  if (L > 0.4) {
    if (inBar % 4 === 0) kick(s, t);
    if (inBar % 4 === 2) hat(s, t, 0.9);
    if (L > 0.75 && inBar % 2 === 1) hat(s, t, 0.45);
    if (L > 0.55 && inBar === 4) clap(s, t);
  }

  // La zampoña: el motivo de la ronda, repartido entre dos cañas que se
  // contestan, como tocan los sikuris (una fila empieza, la otra termina).
  if (L > 0.6) {
    const d = s.motif[step % s.motif.length] as number;
    if (d >= 0) {
      const len = holdOf(s.motif, step % s.motif.length) * (beatLength(s) / 4);
      const side = (step >> 1) % 2 === 0 ? -0.45 : 0.45;
      siku(s, t, deg(d), len, side, 0.9);
      if (L > 0.85) siku(s, t, deg(d) + 12, len, -side, 0.35);
    }
  }

  // Cada cuatro compases, con toda la tensión, una subida de ruido.
  if (L > 0.8 && step % 32 === 16) riser(s, t, beatLength(s) * 8);
}

/** Cuántas semicorcheas dura una nota del motivo: hasta la próxima. */
function holdOf(motif: number[], i: number): number {
  let n = 1;
  while (n < 4 && (motif[(i + n) % motif.length] as number) < 0) n++;
  return n;
}

/**
 * El motivo de la zampoña, dos compases. Ritmos del huayno (la corchea con
 * puntillo y la semicorchea), notas de la pentatónica cerca del centro, y el
 * segundo compás contesta al primero y cierra en la tónica.
 */
function writeMotif(rng: () => number): number[] {
  const RHYTHMS = ["x..xx.x.", "x.x.x.x.", "x..xx...", "x.xxx.x."];
  const out: number[] = [];
  let d = 5 + Math.floor(rng() * 3);
  for (let b = 0; b < 2; b++) {
    const r = RHYTHMS[Math.floor(rng() * RHYTHMS.length)] as string;
    for (let i = 0; i < 8; i++) {
      if (r[i] !== "x") {
        out.push(-1);
        continue;
      }
      // Pasos chicos, a veces un salto; dentro de una octava y media.
      const move = rng() < 0.75 ? (rng() < 0.5 ? -1 : 1) : rng() < 0.5 ? -2 : 2;
      d = Math.max(3, Math.min(10, d + move));
      out.push(d);
    }
  }
  // Cierra en la tónica.
  for (let i = out.length - 1; i >= 0; i--) {
    if ((out[i] as number) >= 0) {
      out[i] = 5;
      break;
    }
  }
  return out;
}

/* ---------------------------------------------------------- los instrumentos */

function env(ctx: BaseAudioContext, t: number, peak: number, attack: number, decay: number): GainNode {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  return g;
}

/** El bombo legüero: cuero grave que cae de tono, y un golpe de madera. */
function bombo(s: Session, t: number, v: number): void {
  const { ctx } = s;
  const o = tag(ctx.createOscillator());
  o.type = "sine";
  o.frequency.setValueAtTime(95, t);
  o.frequency.exponentialRampToValueAtTime(48, t + 0.22);
  // Menos cola grave que antes: en un proyector no se oye y en la mezcla se
  // comía todo lo demás. El cuerpo de arriba la reemplaza.
  const g = env(ctx, t, 0.56 * v, 0.004, 0.36);
  o.connect(g).connect(s.bus);
  o.start(t);
  o.stop(t + 0.6);
  noiseHit(s, t, 0.18 * v, 0.05, "lowpass", 900);
  cuerpo(s, t, 190, 0.3 * v);
}

/**
 * El cuerpo de un golpe grave, para los parlantes chicos: una laptop o el
 * parlante de un proyector cortan por debajo de unos 150 Hz, y un bombo que
 * vive entre 50 y 95 Hz ahí no suena. El oído reconstruye la nota grave con
 * sus armónicos, así que se le suma un golpe corto que cae desde `f` hasta su
 * mitad (investigación del audio, 4 de octubre de 2026).
 */
function cuerpo(s: Session, t: number, f: number, v: number): void {
  const { ctx } = s;
  const o = tag(ctx.createOscillator());
  o.type = "triangle";
  o.frequency.setValueAtTime(f, t);
  o.frequency.exponentialRampToValueAtTime(f * 0.55, t + 0.09);
  const g = env(ctx, t, v, 0.003, 0.11);
  o.connect(g).connect(s.bus);
  o.start(t);
  o.stop(t + 0.16);
}

/** El bombo del beat, más seco y más corto. */
function kick(s: Session, t: number): void {
  const { ctx } = s;
  const o = tag(ctx.createOscillator());
  o.type = "sine";
  o.frequency.setValueAtTime(150, t);
  o.frequency.exponentialRampToValueAtTime(46, t + 0.1);
  const g = env(ctx, t, 0.45, 0.002, 0.22);
  o.connect(g).connect(s.bus);
  o.start(t);
  o.stop(t + 0.35);
  cuerpo(s, t, 230, 0.24);
}

function hat(s: Session, t: number, v: number): void {
  noiseHit(s, t, 0.07 * v, 0.045, "highpass", 7500);
}

/** Palmas: tres golpes de ruido casi juntos, como una fila de manos. */
function clap(s: Session, t: number): void {
  for (let i = 0; i < 3; i++) noiseHit(s, t + i * 0.011, i === 2 ? 0.2 : 0.12, i === 2 ? 0.16 : 0.03, "bandpass", 1600);
}

function crash(s: Session, t: number, v: number): void {
  noiseHit(s, t, 0.22 * v, 1.4, "highpass", 5000);
}

/** Ruido que sube de brillo durante `len`: la subida antes de un cambio. */
function riser(s: Session, t: number, len: number): void {
  const { ctx } = s;
  const src = tag(ctx.createBufferSource());
  src.buffer = s.noise;
  src.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = "bandpass";
  f.Q.value = 2;
  f.frequency.setValueAtTime(400, t);
  f.frequency.exponentialRampToValueAtTime(6000, t + len);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.09, t + len * 0.95);
  g.gain.linearRampToValueAtTime(0, t + len);
  src.connect(f).connect(g).connect(s.bus);
  src.start(t);
  src.stop(t + len + 0.05);
}

function noiseHit(s: Session, t: number, peak: number, decay: number, type: BiquadFilterType, freq: number): void {
  const { ctx } = s;
  const src = tag(ctx.createBufferSource());
  src.buffer = s.noise;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  const g = env(ctx, t, peak, 0.002, decay);
  src.connect(f).connect(g).connect(s.bus);
  // Cada golpe arranca en otro punto del ruido, sembrado: no suenan idénticos.
  src.start(t, s.rng() * 0.5);
  src.stop(t + decay + 0.05);
}

/** El bajo: redondo, sin filo, para sostener sin tapar. */
function bass(s: Session, t: number, semis: number): void {
  const { ctx } = s;
  const f = ctx.createBiquadFilter();
  f.type = "lowpass";
  f.frequency.value = 1000;
  const g = env(ctx, t, 0.32, 0.008, 0.34);
  f.connect(g).connect(s.bus);
  // El triángulo es la nota; la sierra, bajita, le da los armónicos que sí
  // salen por un parlante chico (el bajo vive entre 49 y 82 Hz).
  for (const [type, lvl] of [["triangle", 1], ["sawtooth", 0.42]] as const) {
    const o = tag(ctx.createOscillator());
    o.type = type;
    o.frequency.value = hz(semis);
    const lg = ctx.createGain();
    lg.gain.value = lvl;
    o.connect(lg).connect(f);
    o.start(t);
    o.stop(t + 0.4);
  }
}

/**
 * Un rasgueo de charango: cinco cuerdas punteadas una detrás de otra, de la
 * grave a la aguda si baja la mano, al revés si sube. Cada cuerda es una nota
 * brillante que se apaga rápido, con un filtro que se cierra como se cierra el
 * sonido de una cuerda de metal.
 */
function strum(s: Session, t: number, chord: Chord, down: boolean, v: number): void {
  const { ctx } = s;
  const order = down ? chord.strings : [...chord.strings].reverse();
  order.forEach((semis, i) => {
    const at = t + i * 0.011;
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.setValueAtTime(5200, at);
    f.frequency.exponentialRampToValueAtTime(1400, at + 0.25);
    const g = env(ctx, at, 0.05 * v, 0.003, 0.32);
    for (const [type, mul, lvl] of [["triangle", 1, 1], ["sawtooth", 1.003, 0.35]] as const) {
      const o = tag(ctx.createOscillator());
      o.type = type;
      o.frequency.value = hz(semis) * mul;
      const lg = ctx.createGain();
      lg.gain.value = lvl;
      o.connect(lg).connect(f);
      o.start(at);
      o.stop(at + 0.4);
    }
    f.connect(g);
    g.connect(s.bus);
    g.connect(s.wet);
  });
}

/**
 * Una nota de zampoña: una onda casi pura con soplido. El soplido es ruido
 * filtrado en la nota, más fuerte en el ataque ("el chiff" de toda flauta de
 * caña), y un vibrato que entra tarde, como el de quien sostiene el aire.
 */
function siku(s: Session, t: number, semis: number, len: number, pan: number, v: number): void {
  const { ctx } = s;
  const f0 = hz(semis);
  const p = ctx.createStereoPanner();
  p.pan.value = pan;
  p.connect(s.bus);
  p.connect(s.wet);
  const dur = Math.max(0.09, len * 0.92);

  const o = tag(ctx.createOscillator());
  o.type = "sine";
  o.frequency.value = f0;
  const vib = tag(ctx.createOscillator());
  vib.frequency.value = 5.4;
  const vg = ctx.createGain();
  vg.gain.setValueAtTime(0, t);
  vg.gain.linearRampToValueAtTime(f0 * 0.006, t + Math.min(dur, 0.25));
  vib.connect(vg).connect(o.frequency);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(0.16 * v, t + 0.035);
  g.gain.setValueAtTime(0.16 * v, t + dur - 0.05);
  g.gain.linearRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(p);
  o.start(t);
  vib.start(t);
  o.stop(t + dur + 0.02);
  vib.stop(t + dur + 0.02);

  // El soplido.
  const src = tag(ctx.createBufferSource());
  src.buffer = s.noise;
  const bp = ctx.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = f0 * 2;
  bp.Q.value = 6;
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(0.0001, t);
  ng.gain.linearRampToValueAtTime(0.1 * v, t + 0.02);
  ng.gain.exponentialRampToValueAtTime(0.02 * v, t + 0.12);
  ng.gain.linearRampToValueAtTime(0.0001, t + dur);
  src.connect(bp).connect(ng).connect(p);
  src.start(t, s.rng() * 0.5);
  src.stop(t + dur + 0.02);
}

/**
 * El remate del ganador: bombo, platillo, el charango en trémolo sobre la
 * menor y la zampoña sosteniendo la tónica arriba. Después, silencio: el cartel
 * y la fanfarria son del ganador.
 */
function finale(s: Session, t: number): void {
  bombo(s, t, 1.2);
  kick(s, t);
  crash(s, t, 1);
  // Veinte rasgueos son unos 600 nodos de audio: armados todos juntos, el
  // cuadro del ganador duraba más de 100 ms. Cada uno se arma poco antes de
  // sonar. Los tiempos del contexto de audio son los mismos, y el rasgueo no
  // usa el azar sembrado, así que la música de la ronda no cambia.
  for (let i = 0; i < 20; i++) {
    const at = t + i * 0.07;
    const armar = (): void => {
      if (cur === s) strum(s, at, AM, i % 2 === 0, 0.55 * (1 - i / 26));
    };
    const espera = (at - s.ctx.currentTime - 0.15) * 1000;
    if (espera <= 0) armar();
    else setTimeout(armar, espera);
  }
  siku(s, t, deg(10), 1.5, -0.3, 1);
  siku(s, t + 0.02, deg(5), 1.5, 0.3, 0.6);
  s.bus.gain.setValueAtTime(0.34, t + 1.6);
  s.bus.gain.linearRampToValueAtTime(0, t + 3.2);
}

/* -------------------------------------------------------------- la chovena */

/**
 * La chovena, la música chiquitana del juego de la rueda. De dónde sale cada
 * decisión, con sus fuentes, está en docs/juegos/chovena.md:
 *
 * - **2/4 a negra = 90**, la única partitura con metrónomo que se encontró
 *   ("Chobena oriental", Cancionero cruceño, 2023). El juego la acelera en la
 *   final, hasta unos 103.
 * - **En mayor, con I, IV y V** (do, fa y sol). Do mayor tiene las notas de la
 *   pentatónica de los efectos más el fa y el si: la música y los golpes no chocan.
 * - **Semicorcheas parejas** en frases cortas que se repiten, con notas
 *   repetidas y la frase que cierra con una negra en el segundo tiempo. Ni el
 *   galope del huayno ni el puntillo del taquirari.
 * - **La tamborita**: la flauta de caña al frente, aguda y no temperada; la caja
 *   con bordón de cuero, que repiquetea con acento en la "y" de cada tiempo y
 *   redobla al cerrar cada frase; el bombo en el uno y en el dos. El violín
 *   dobla la melodía, como desde la colonia, y la guitarra rasguea a contratiempo.
 * - **Arranca con los tambores solos**, dos compases, y las capas entran con la
 *   tensión: flauta, guitarra, violín, una segunda flauta en terceras, y al
 *   final palmas en la "y" y la maraca.
 *
 * El ritmo exacto de la caja y del bombo no está escrito en ninguna fuente:
 * es una inferencia, y la tiene que escuchar alguien chiquitano o cruceño.
 */
export const CHO_BPM = 90;
/** Do mayor, en semitonos desde do. */
const CHO_MAJOR = [0, 2, 4, 5, 7, 9, 11];
/** Un grado de Do mayor, en semitonos desde el la de 440: el grado 0 es el do central. */
const choDeg = (d: number): number => (CHO_MAJOR[((d % 7) + 7) % 7] as number) + 12 * Math.floor(d / 7) - 9;
/**
 * La flauta de caña no es temperada: cada grado queda corrido siempre lo
 * mismo, en centésimas de semitono. Es lo que la hace sonar a caña y no a
 * teclado (la afinación no temperada tiene fuente; los números son nuestros).
 */
const CHO_CENTS = [0, 12, -16, 20, -10, 15, -18];
const choCents = (d: number): number => (CHO_CENTS[((d % 7) + 7) % 7] as number) / 100;

/** Un acorde de la chovena: el bajo, las cinco cuerdas de la guitarra y sus notas, en grados. */
interface ChoChord extends Chord {
  tones: number[];
}
const CHO_I: ChoChord = { root: -33, strings: [-21, -17, -14, -9, -5], tones: [0, 2, 4] };
const CHO_IV: ChoChord = { root: -28, strings: [-16, -12, -9, -4, 0], tones: [3, 5, 0] };
const CHO_V: ChoChord = { root: -26, strings: [-19, -14, -10, -7, -2], tones: [4, 6, 1] };
/** Las partes: A de ocho compases, el estribillo B de cuatro y C, el contraste, de ocho. */
const CHO_PARTS: Record<"A" | "B" | "C", ChoChord[]> = {
  A: [CHO_I, CHO_I, CHO_V, CHO_I, CHO_I, CHO_IV, CHO_V, CHO_I],
  B: [CHO_IV, CHO_I, CHO_V, CHO_I],
  C: [CHO_IV, CHO_IV, CHO_I, CHO_I, CHO_IV, CHO_I, CHO_V, CHO_I],
};
/** La forma de la partitura: A, B, A, B, C, B. */
const CHO_FORM: ("A" | "B" | "C")[] = ["A", "B", "A", "B", "C", "B"];
/** Los compases de tambores solos con que arranca. */
const CHO_DRUMS = 2;

interface Cho {
  /** La melodía de toda la forma: grado o -1 por semicorchea. */
  notes: number[];
  chords: ChoChord[];
}

/**
 * La melodía de una parte. Cada compás se arma con bloques de la partitura:
 * cuatro semicorcheas y cuatro más, cuatro y una negra, o cuatro y dos
 * corcheas. En los tiempos fuertes, una nota del acorde; en el medio, la
 * misma nota repetida o un paso. La primera frase cierra en una nota del
 * acorde que no es la tónica y la segunda contesta y cierra en do, con una
 * negra en el segundo tiempo.
 */
function writePart(rng: () => number, prog: ChoChord[], lo: number, hi: number): number[] {
  const RITMOS = ["xxxxxxxx", "xxxxxxxx", "xxxxx...", "xxxxx.x."];
  const out: number[] = [];
  let d = 7;
  let run = 1;
  const near = (from: number, tones: number[]): number => {
    let best = from;
    let bestD = 99;
    for (let o = lo - 7; o <= hi + 7; o += 7) {
      for (const tn of tones) {
        const c = tn + Math.floor(o / 7) * 7;
        if (c < lo || c > hi) continue;
        const dd = Math.abs(c - from) + (c === from ? 0.5 : 0);
        if (dd < bestD) {
          bestD = dd;
          best = c;
        }
      }
    }
    return best;
  };
  prog.forEach((chord, bar) => {
    const end = bar === prog.length - 1;
    const half = prog.length === 8 && bar === 3;
    const r = end || half ? "xxxxx..." : (RITMOS[Math.floor(rng() * RITMOS.length)] as string);
    for (let i = 0; i < 8; i++) {
      if (r[i] !== "x") {
        out.push(-1);
        continue;
      }
      const prev = d;
      if (i === 4 && end) d = 7;
      else if (i === 4 && half) d = near(d, [4, 2]);
      else if (i === 0 || i === 4) d = near(d + (rng() < 0.5 ? 1 : -1), chord.tones);
      else if (run < 3 && rng() < 0.45) d = prev;
      else d = Math.max(lo, Math.min(hi, d + (rng() < 0.5 ? 1 : -1) * (rng() < 0.85 ? 1 : 2)));
      run = d === prev ? run + 1 : 1;
      out.push(d);
    }
  });
  return out;
}

function writeChovena(rng: () => number): Cho {
  const mel = {
    A: writePart(rng, CHO_PARTS.A, 4, 11),
    B: writePart(rng, CHO_PARTS.B, 4, 11),
    C: writePart(rng, CHO_PARTS.C, 5, 12),
  };
  return { notes: CHO_FORM.flatMap((p) => mel[p]), chords: CHO_FORM.flatMap((p) => CHO_PARTS[p]) };
}

/** Lo que suena en una semicorchea de chovena. */
function playStepChovena(s: Session, t: number, step: number): void {
  const cho = s.cho;
  if (!cho) return;
  const L = s.level;
  const inBar = step % 8;
  const bar = Math.floor(step / 8);
  const drums = bar < CHO_DRUMS;
  const fb = drums ? 0 : (bar - CHO_DRUMS) % cho.chords.length;
  const chord = cho.chords[fb] as ChoChord;
  const sixteenth = beatLength(s) / 4;
  // El bombo: fuerte en el uno, medio en el dos, y cada cuatro compases un
  // golpe más, corto, con el parche apretado con el codo.
  if (inBar === 0) tampora(s, t, 0.95);
  else if (inBar === 4) tampora(s, t, 0.6);
  else if (inBar === 7 && !drums && fb % 4 === 3) codo(s, t, 0.7);
  // La caja: el repiqueteo parejo con acento en la "y" de cada tiempo, y el
  // redoble que cierra cada frase y cae en el uno.
  const cierre = !drums && fb % 4 === 3 && inBar >= 4;
  if (cierre) {
    const v = 0.4 + 0.12 * (inBar - 4);
    caja(s, t, v);
    caja(s, t + sixteenth / 2, v * 0.85);
  } else if (inBar === 2 || inBar === 6) caja(s, t, 1);
  else caja(s, t, 0.32 + 0.18 * L);
  if (drums) return;
  // El bajo en el uno y en el dos, y la guitarra a contratiempo.
  if (inBar === 0 || inBar === 4) bass(s, t, chord.root + (inBar === 4 ? 7 : 0));
  if (L > 0.22 && (inBar === 2 || inBar === 6)) strum(s, t, chord, inBar === 2, 0.38);
  // La flauta con la melodía, una octava arriba; el violín la dobla, y con
  // tensión una segunda flauta en terceras.
  const i = fb * 8 + inBar;
  const d = cho.notes[i] as number;
  if (d >= 0) {
    const len = holdOf(cho.notes, i) * sixteenth;
    pifano(s, t, choDeg(d + 7) + choCents(d), len, -0.18, 0.9);
    if (L > 0.32) violin(s, t, choDeg(d), len, 0.25, 0.6);
    if (L > 0.6) pifano(s, t, choDeg(d + 5) + choCents(d + 5), len, 0.42, 0.45);
  }
  // Con toda la tensión, las palmas de los hombres en la "y" y la maraca.
  if (L > 0.8) {
    if (inBar === 2 || inBar === 6) clap(s, t);
    noiseHit(s, t, inBar % 2 ? 0.035 : 0.055, 0.03, "highpass", 6500);
  }
}

/** El bombo de la tamborita: cuero grueso tocado con mazo, que cae de ~80 a 50 Hz, y el golpe de la madera. */
function tampora(s: Session, t: number, v: number): void {
  const { ctx } = s;
  const o = tag(ctx.createOscillator());
  o.type = "sine";
  o.frequency.setValueAtTime(82, t);
  o.frequency.exponentialRampToValueAtTime(50, t + 0.2);
  const g = env(ctx, t, 0.66 * v, 0.004, 0.34);
  o.connect(g).connect(s.bus);
  o.start(t);
  o.stop(t + 0.5);
  noiseHit(s, t, 0.16 * v, 0.04, "lowpass", 1100);
  cuerpo(s, t, 170, 0.3 * v);
}

/** El bombo con el parche apretado con el codo: más agudo y más corto. */
function codo(s: Session, t: number, v: number): void {
  const { ctx } = s;
  const o = tag(ctx.createOscillator());
  o.type = "sine";
  o.frequency.setValueAtTime(128, t);
  o.frequency.exponentialRampToValueAtTime(88, t + 0.08);
  const g = env(ctx, t, 0.55 * v, 0.003, 0.12);
  o.connect(g).connect(s.bus);
  o.start(t);
  o.stop(t + 0.18);
}

/**
 * La caja con bordón de cuero: más opaca que la de metal. Ruido entre 1 y 2,5
 * kHz que se apaga en unos 70 ms, y el parche, un golpe corto cerca de 200 Hz.
 */
function caja(s: Session, t: number, v: number): void {
  noiseHit(s, t, 0.13 * v, 0.07, "bandpass", 1700);
  const { ctx } = s;
  const o = tag(ctx.createOscillator());
  o.type = "triangle";
  o.frequency.setValueAtTime(210, t);
  o.frequency.exponentialRampToValueAtTime(170, t + 0.04);
  const g = env(ctx, t, 0.12 * v, 0.002, 0.045);
  o.connect(g).connect(s.bus);
  o.start(t);
  o.stop(t + 0.07);
}

/**
 * La flauta de caña: casi pura, con el soplido fuerte en el ataque (el "chiff"
 * del pico), y casi sin vibrato. `semis` puede traer centésimas: la caña no
 * está temperada.
 */
function pifano(s: Session, t: number, semis: number, len: number, pan: number, v: number): void {
  const { ctx } = s;
  const f0 = hz(semis);
  const dur = Math.max(0.08, len * 0.9);
  const p = ctx.createStereoPanner();
  p.pan.value = pan;
  p.connect(s.bus);
  p.connect(s.wet);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(0.11 * v, t + 0.018);
  g.gain.setValueAtTime(0.1 * v, t + dur - 0.04);
  g.gain.linearRampToValueAtTime(0.0001, t + dur);
  g.connect(p);
  const vib = tag(ctx.createOscillator());
  vib.frequency.value = 5;
  const vg = ctx.createGain();
  vg.gain.setValueAtTime(0, t);
  vg.gain.linearRampToValueAtTime(f0 * 0.0025, t + Math.min(dur, 0.3));
  vib.connect(vg);
  for (const [type, lvl] of [["sine", 1], ["triangle", 0.35]] as const) {
    const o = tag(ctx.createOscillator());
    o.type = type;
    o.frequency.value = f0;
    vg.connect(o.frequency);
    const lg = ctx.createGain();
    lg.gain.value = lvl;
    o.connect(lg).connect(g);
    o.start(t);
    o.stop(t + dur + 0.02);
  }
  vib.start(t);
  vib.stop(t + dur + 0.02);
  // El soplido: ruido en la nota, fuerte al empezar.
  const src = tag(ctx.createBufferSource());
  src.buffer = s.noise;
  const bp = ctx.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = f0 * 1.5;
  bp.Q.value = 4;
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(0.0001, t);
  ng.gain.linearRampToValueAtTime(0.09 * v, t + 0.012);
  ng.gain.exponentialRampToValueAtTime(0.012 * v, t + 0.08);
  ng.gain.linearRampToValueAtTime(0.0001, t + dur);
  src.connect(bp).connect(ng).connect(p);
  src.start(t, s.rng() * 0.5);
  src.stop(t + dur + 0.02);
}

/**
 * Un violín: dos sierras apenas desafinadas, un filtro que deja el brillo del
 * arco, y un vibrato que entra tarde. El ataque es corto pero no seco, como
 * un arco que empieza la nota.
 */
function violin(s: Session, t: number, semis: number, len: number, pan: number, v: number): void {
  const { ctx } = s;
  const f0 = hz(semis);
  const dur = Math.max(0.08, len * 0.95);
  const p = ctx.createStereoPanner();
  p.pan.value = pan;
  p.connect(s.bus);
  p.connect(s.wet);
  const f = ctx.createBiquadFilter();
  f.type = "lowpass";
  f.frequency.value = 3200;
  f.Q.value = 1.2;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(0.06 * v, t + 0.03);
  g.gain.setValueAtTime(0.055 * v, t + dur - 0.05);
  g.gain.linearRampToValueAtTime(0.0001, t + dur);
  f.connect(g).connect(p);
  const vib = tag(ctx.createOscillator());
  vib.frequency.value = 5.8;
  const vg = ctx.createGain();
  vg.gain.setValueAtTime(0, t);
  vg.gain.linearRampToValueAtTime(f0 * 0.006, t + Math.min(dur, 0.22));
  vib.connect(vg);
  for (const mul of [1, 1.004]) {
    const o = tag(ctx.createOscillator());
    o.type = "sawtooth";
    o.frequency.value = f0 * mul;
    vg.connect(o.frequency);
    o.connect(f);
    o.start(t);
    o.stop(t + dur + 0.02);
  }
  vib.start(t);
  vib.stop(t + dur + 0.02);
}

/**
 * El remate de la chovena: un redoble de caja que crece, y en el uno todo el
 * conjunto junto, con la flauta arriba en do. Después, el cartel es del ganador.
 */
function finaleChovena(s: Session, t: number): void {
  const roll = 0.5;
  for (let i = 0; i < 12; i++) caja(s, t + (i * roll) / 12, 0.35 + i * 0.055);
  const at = t + roll;
  tampora(s, at, 1.2);
  crash(s, at, 0.6);
  bass(s, at, CHO_I.root);
  strum(s, at, CHO_I, true, 0.75);
  pifano(s, at, choDeg(14), 1.3, -0.18, 1);
  pifano(s, at + 0.01, choDeg(11) + choCents(11), 1.3, 0.4, 0.55);
  violin(s, at, choDeg(7), 1.3, 0.25, 0.8);
  tampora(s, at + 0.67, 0.8);
  s.bus.gain.setValueAtTime(0.32, at + 1.4);
  s.bus.gain.linearRampToValueAtTime(0, at + 3);
}

/* ------------------------------------------------------------- los buffers */

/** Ruido blanco sembrado: ni un `Math.random`, así la ronda suena igual. */
function noiseBuffer(ctx: BaseAudioContext, rng: () => number): AudioBuffer {
  const b = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = rng() * 2 - 1;
  return b;
}

/** La respuesta de una sala: ruido que se apaga en un segundo y medio, en estéreo. */
function impulse(ctx: BaseAudioContext, rng: () => number): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * 1.5);
  const b = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (rng() * 2 - 1) * Math.pow(1 - i / len, 3);
  }
  return b;
}
