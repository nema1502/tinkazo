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
}

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
export function startMusic(seed: number): void {
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
 * Lo que dice el relator, con su tensión. Un salto grande es una sorpresa: la
 * música se calla un tiempo. Tensión 1 es el ganador: remate.
 */
export function musicCue(heat: number): void {
  const s = cur;
  if (!s || s.won) return;
  if (heat >= 0.99) {
    s.won = true;
    finale(s, Math.max(s.next, s.ctx.currentTime + 0.03));
    return;
  }
  if (heat - s.level >= 0.3) {
    const beat = beatLength(s);
    s.breakUntil = s.next + beat;
    s.crashAt = s.breakUntil;
  }
  s.target = Math.max(heat, s.target * 0.5);
}

/* ---------------------------------------------------------- el secuenciador */

/** Un tiempo, en segundos. De 96 a 132 golpes por minuto según la tensión. */
const beatLength = (s: Session): number => 60 / (96 + 36 * s.level);

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

  while (s.next < s.ctx.currentTime + 0.22) {
    const sixteenth = beatLength(s) / 4;
    // Durante el corte de una sorpresa no suena nada.
    if (s.next >= s.breakUntil) playStep(s, s.next, s.step);
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
  const g = env(ctx, t, 0.75 * v, 0.004, 0.5);
  o.connect(g).connect(s.bus);
  o.start(t);
  o.stop(t + 0.6);
  noiseHit(s, t, 0.18 * v, 0.05, "lowpass", 900);
}

/** El bombo del beat, más seco y más corto. */
function kick(s: Session, t: number): void {
  const { ctx } = s;
  const o = tag(ctx.createOscillator());
  o.type = "sine";
  o.frequency.setValueAtTime(150, t);
  o.frequency.exponentialRampToValueAtTime(46, t + 0.1);
  const g = env(ctx, t, 0.6, 0.002, 0.28);
  o.connect(g).connect(s.bus);
  o.start(t);
  o.stop(t + 0.35);
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
  const o = tag(ctx.createOscillator());
  o.type = "triangle";
  o.frequency.value = hz(semis);
  const f = ctx.createBiquadFilter();
  f.type = "lowpass";
  f.frequency.value = 700;
  const g = env(ctx, t, 0.32, 0.008, 0.34);
  o.connect(f).connect(g).connect(s.bus);
  o.start(t);
  o.stop(t + 0.4);
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
