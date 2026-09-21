import { getLang } from "./i18n";
import { muteNarrator } from "./narrator";
import { paceFactor } from "./state";

/* Sonido con WebAudio, sin assets. */

let audioCtx: AudioContext | null = null;

const MUTE_KEY = "tinkazo.muted";

function initialMute(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

let muted = initialMute();

let master: GainNode | null = null;

/**
 * La cadena por la que pasa todo: un techo de volumen y un paso bajo.
 *
 * Una onda cuadrada sin filtrar tiene armónicos hasta donde llegue el aparato,
 * y eso es literalmente lo que suena a aparato en el parlante de un proyector.
 * El paso bajo a 4,5 kHz les saca el filo sin quitarles el carácter, y el techo
 * evita que dos sonidos a la vez saturen.
 */
function chain(): { ctx: AudioContext; out: GainNode } | null {
  const Ctor =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  const ctx = audioCtx ?? new Ctor();
  audioCtx = ctx;
  // El contexto nace suspendido si el primer sonido no salió de un clic. Sin
  // esto el sorteo entero corre en silencio y nadie entiende por qué.
  if (ctx.state === "suspended") void ctx.resume();
  if (!master) {
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 4500;
    lp.Q.value = 0.7;
    const g = ctx.createGain();
    g.gain.value = 0.9;
    g.connect(lp);
    lp.connect(ctx.destination);
    master = g;
  }
  return { ctx, out: master };
}

export function beep(f: number, d = 0.09, type: OscillatorType = "square", g = 0.05): void {
  if (muted) return;
  try {
    const c = chain();
    if (!c) return;
    const t0 = c.ctx.currentTime;
    const o = c.ctx.createOscillator();
    const ga = c.ctx.createGain();
    o.type = type;
    o.frequency.value = f;
    // Arrancar la ganancia en su máximo es un salto de amplitud, y un salto de
    // amplitud es un clic. Ese clic sonaba delante de cada una de las cincuenta
    // notas del producto: es la mitad de por qué esto suena a aparato y no a
    // música. Doce milésimas de ataque lo borran sin ablandar el golpe.
    const atk = Math.min(0.012, d * 0.3);
    ga.gain.setValueAtTime(0.0001, t0);
    ga.gain.linearRampToValueAtTime(g, t0 + atk);
    ga.gain.exponentialRampToValueAtTime(0.0008, t0 + d);
    // Y el cierre a cero: cortar el oscilador con la señal todavía arriba deja
    // el mismo clic, esta vez al final.
    ga.gain.linearRampToValueAtTime(0, t0 + d + 0.012);
    o.connect(ga);
    ga.connect(c.out);
    o.start(t0);
    o.stop(t0 + d + 0.02);
  } catch {
    /* sin audio */
  }
}

/**
 * Un sonido que tiene que durar lo que dura una fase del juego.
 *
 * El selector de duración divide el `dt` que ve el juego, así que una fase de
 * un segundo tarda 2,2 s reales en modo épico. Pero `beep` mide en segundos
 * reales, y por eso el zumbido de 0,7 s que tapaba un apretón entero del
 * pasanaku dejaba 2,4 s de tela cerrándose en silencio, justo en el momento de
 * más tensión. Acá la duración va en segundos **del juego** y se estira sola.
 */
export function beepFor(
  f: number,
  gameSeconds: number,
  type: OscillatorType = "sawtooth",
  g = 0.03,
): void {
  beep(f, gameSeconds * paceFactor(), type, g);
}

/**
 * Una nota de la escala pentatónica, por grado.
 *
 * Los juegos subían el tono sumando hercios sueltos, y eso suena a aparato,
 * no a música: dos notas consecutivas quedaban desafinadas entre ellas y al
 * superponerse daban un batido feo. La pentatónica no tiene semitonos, así que
 * **cualquier par de notas suena bien junto**. Es el mismo truco de las teclas
 * negras del piano y de casi todo el sonido de videojuego que no molesta.
 *
 * El grado 0 es un do bajo; de ahí para arriba, sin límite.
 */
export function note(degree: number, octaveShift = 0): number {
  const scale = [0, 2, 4, 7, 9];
  const d = Math.max(0, Math.round(degree));
  const semis = (scale[d % 5] ?? 0) + 12 * Math.floor(d / 5) + 12 * octaveShift;
  return 130.81 * Math.pow(2, semis / 12);
}

export function fanfare(): void {
  // Cuatro notas de 0,22 s en triángulo es una flautita: en una sala de
  // cincuenta personas no llega al fondo. Un final se oye por tres cosas que no
  // tenía: cuerpo (una nota grave sostenida), acorde (tres notas a la vez, no
  // una detrás de otra) y remate (el arpegio arriba). La pentatónica garantiza
  // que cualquier par suene bien, así que las tres juntas no pueden desafinar.
  beep(note(0), 1.2, "triangle", 0.075);
  [10, 12, 13].forEach((d) => beep(note(d), 0.95, "triangle", 0.042));
  [13, 15, 17, 18].forEach((d, i) =>
    setTimeout(() => beep(note(d), 0.26, "triangle", 0.05), 90 + i * 110),
  );
}

export function soundLabel(): void {
  const word = getLang() === "es" ? "SONIDO" : "SOUND";
  const el = document.getElementById("st-sound");
  if (el) el.textContent = `${word}: ${muted ? "OFF" : "ON"}`;
  // El mismo estado, en la página, para poder apagarlo antes de empezar.
  const page = document.getElementById("btn-sound");
  if (page) {
    const es = getLang() === "es";
    page.textContent = muted
      ? es ? "Sonido: no" : "Sound: off"
      : es ? "Sonido: sí" : "Sound: on";
  }
}

export function toggleSound(): void {
  muted = !muted;
  try {
    localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
  } catch {
    /* que no se guarde no rompe nada */
  }
  // La voz del narrador es parte del sonido: un solo botón las apaga a las dos.
  muteNarrator(muted);
  soundLabel();
}

/** `true` si el estadio está en silencio. */
export const isMuted = (): boolean => muted;
