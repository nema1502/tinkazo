import { getLang } from "./i18n";

/* Sonido con WebAudio, sin assets. */

let audioCtx: AudioContext | null = null;
let muted = false;

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

export function fanfare(): void {
  [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => beep(f, 0.22, "triangle", 0.07), i * 140));
}

export function soundLabel(): void {
  const word = getLang() === "es" ? "SONIDO" : "SOUND";
  const el = document.getElementById("st-sound");
  if (el) el.textContent = `${word}: ${muted ? "OFF" : "ON"}`;
}

export function toggleSound(): void {
  muted = !muted;
  soundLabel();
}
