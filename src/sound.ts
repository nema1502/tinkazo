import { getLang } from "./i18n";
import { muteNarrator } from "./narrator";

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

export function beep(f: number, d = 0.09, type: OscillatorType = "square", g = 0.05): void {
  if (muted) return;
  try {
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    audioCtx = audioCtx || new Ctor();
    const o = audioCtx.createOscillator();
    const ga = audioCtx.createGain();
    o.type = type;
    o.frequency.value = f;
    ga.gain.setValueAtTime(g, audioCtx.currentTime);
    ga.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + d);
    o.connect(ga);
    ga.connect(audioCtx.destination);
    o.start();
    o.stop(audioCtx.currentTime + d);
  } catch {
    /* sin audio */
  }
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
  [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => beep(f, 0.22, "triangle", 0.07), i * 140));
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
