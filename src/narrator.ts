import { getLang } from "./i18n";

/**
 * El narrador, con voz.
 *
 * La Web Speech API existe en todos los navegadores desde 2018, pero "existe" y
 * "suena bien en la sala" son dos cosas distintas. Acá se resuelven las tres que
 * rompen en vivo: elegir una voz en español que de verdad esté instalada,
 * arrancarla dentro del gesto que exige iOS, y no quedarse colgada si el
 * navegador miente sobre lo que tiene.
 *
 * Si no hay voz, este módulo no hace nada. El comentario en pantalla ya cuenta
 * el sorteo solo: la voz es un plus, nunca un requisito.
 */

/**
 * Orden de preferencia de región. Boliviano primero, después los vecinos.
 *
 * Ningún sistema trae una voz boliviana instalada de fábrica, así que en la
 * práctica casi siempre va a caer en mexicano o español. Se pide igual: si
 * alguien la tiene, que la use.
 */
const PREF: Record<"es" | "en", string[]> = {
  es: ["es-bo", "es-pe", "es-cl", "es-ar", "es-419", "es-mx", "es-us", "es-co", "es-es"],
  en: ["en-us", "en-gb", "en-au"],
};

/** Cómo llaman las plataformas a sus voces buenas. */
const GOOD = /natural|neural|premium|enhanced|siri|google/i;

/** Chrome corta las voces de red a los quince segundos. Ninguna línea llega, pero por si acaso. */
const MAX_CHARS = 140;

interface Line {
  text: string;
  rate: number;
  pitch: number;
  /** La tensión del momento, de 0 a 1. Decide quién puede pisar a quién. */
  heat: number;
  /** Cuándo se pidió, para no decir tarde algo que ya no viene al caso. */
  at: number;
}

/** Cuánto aguanta una línea esperando turno antes de dejar de tener sentido. */
const STALE_MS = 2600;

let voice: SpeechSynthesisVoice | null = null;
/** La tensión de la línea que está sonando ahora. */
let liveHeat = 0;
let picked: "es" | "en" | null = null;
let queued: Line | null = null;
let busy = false;
let muted = false;
let guard = 0;
/** La referencia viva: si la recoge el recolector, Chrome nunca dispara `onend`. */
let live: SpeechSynthesisUtterance | null = null;

const available = (): boolean =>
  typeof speechSynthesis !== "undefined" && typeof SpeechSynthesisUtterance === "function";

/**
 * Puntaje de una voz.
 *
 * La región exacta pesa más que todo; después la calidad; al final que sea
 * local, que es lo que importa cuando el wifi del evento no da.
 */
function score(v: SpeechSynthesisVoice, want: string[]): number {
  const tag = v.lang.toLowerCase().replace("_", "-");
  const base = (want[0] ?? "").slice(0, 2);
  if (!tag.startsWith(base)) return -1;
  const exact = want.indexOf(tag);
  const near = want.findIndex((w) => tag.startsWith(w) || w.startsWith(tag));
  let s = exact >= 0 ? (want.length - exact) * 100 : near >= 0 ? (want.length - near) * 60 : 10;
  if (GOOD.test(v.name)) s += 40;
  // Una voz local arranca en decenas de milisegundos, no necesita internet y no
  // sufre el corte a los quince segundos que tienen las voces de red.
  if (v.localService) s += 35;
  return s;
}

function refresh(): void {
  const lang = getLang() === "en" ? "en" : "es";
  if (picked === lang && voice) return;
  picked = lang;
  const want = PREF[lang];
  let best: SpeechSynthesisVoice | null = null;
  let bestScore = 0;
  // La primera llamada puede venir vacía: para eso está `voiceschanged`.
  for (const v of speechSynthesis.getVoices()) {
    const s = score(v, want);
    if (s > bestScore) {
      bestScore = s;
      best = v;
    }
  }
  voice = best;
}

/**
 * Hay que llamarla **dentro** del clic que lanza el sorteo.
 *
 * Por dos motivos. Chrome no deja hablar a una página que nunca recibió un clic,
 * y esa habilitación queda pegada: un clic alcanza para todo lo que venga
 * después. Safari en iPhone es más estricto y quiere la cadena entera sin
 * esperas en el medio, así que acá se ceba con una frase muda.
 */
export function primeNarrator(): void {
  if (!available()) return;
  speechSynthesis.addEventListener("voiceschanged", refresh);
  refresh();
  try {
    const warm = new SpeechSynthesisUtterance(" ");
    warm.volume = 0;
    if (voice) warm.voice = voice;
    speechSynthesis.speak(warm);
  } catch {
    /* sin voz: el sorteo sigue igual */
  }
}

/**
 * Dice una línea.
 *
 * Antes cortaba la anterior siempre, y eso dejaba frases a medio decir: en una
 * sala se oye como un narrador que se traba, no como uno que va rápido. Ahora
 * **sólo interrumpe lo que de verdad importa más que lo que se está diciendo**:
 * el anuncio del ganador pisa a cualquier cosa, un cambio de líder no pisa a
 * otro cambio de líder.
 *
 * Lo que no alcanza a entrar espera turno, y si para cuando le toca ya pasó el
 * momento se cae. "Va puntero fulano" dicho tres segundos tarde es peor que el
 * silencio, y encolar frases atrasadas suena peor que quedarse mudo.
 *
 * `heat` va de 0 a 1 y es la tensión del momento. A más tensión, más rápido y
 * más agudo. Esa rampa es lo único que separa a un relator de alguien leyendo
 * etiquetas en voz alta.
 */
export function narrate(text: string, heat = 0): void {
  if (!available() || muted || !text) return;
  refresh();
  if (!voice) return;
  const h = Math.min(1, Math.max(0, heat));
  const line: Line = {
    text: text.length > MAX_CHARS ? text.slice(0, MAX_CHARS - 1) + "…" : text,
    rate: 1.05 + 0.45 * h,
    pitch: 1.05 + 0.35 * h,
    heat: h,
    at: Date.now(),
  };
  if (busy) {
    // Un escalón de tres décimos: lo bastante para que la corona pise al
    // relato, no tanto como para que dos frases del mismo momento se peleen.
    if (h >= liveHeat + 0.3) {
      queued = line;
      // `cancel()` dispara el `onend` de la actual, que saca la encolada.
      speechSynthesis.cancel();
      return;
    }
    if (!queued || h >= queued.heat) queued = line;
    return;
  }
  queued = line;
  flush();
}

function flush(): void {
  const line = queued;
  queued = null;
  if (!line || !voice) {
    busy = false;
    return;
  }
  // Si esperó demasiado, ya no viene al caso. El anuncio del ganador queda
  // exento: ese se dice aunque llegue tarde, porque es el único que importa.
  if (line.heat < 0.9 && Date.now() - line.at > STALE_MS) {
    busy = false;
    return;
  }
  busy = true;
  liveHeat = line.heat;
  // Todo el armado adentro del `try`, no sólo `speak`. Asignar `voice` puede
  // tirar si el navegador no acepta ese objeto, y esa excepción subía hasta el
  // bucle del juego y lo mataba: el sorteo entero se caía por el narrador, que
  // es justo lo que este módulo promete que nunca pasa.
  try {
    const u = new SpeechSynthesisUtterance(line.text);
    u.voice = voice;
    // Android a veces ignora `voice` si `lang` no coincide: se fija a mano.
    u.lang = voice.lang.replace("_", "-");
    u.rate = line.rate;
    u.pitch = line.pitch;
    u.volume = 1;
    u.onend = onDone;
    u.onerror = onDone;
    live = u;
    speechSynthesis.speak(u);
  } catch {
    onDone();
    return;
  }
  if (!guard) {
    // Guardia contra el corte de las voces de red de Chrome. Con una voz local
    // nunca hace falta, pero no cuesta nada.
    guard = window.setInterval(() => {
      if (speechSynthesis.speaking && !speechSynthesis.paused) speechSynthesis.resume();
    }, 9000);
  }
}

function onDone(): void {
  live = null;
  busy = false;
  liveHeat = 0;
  if (queued) flush();
  else if (guard) {
    clearInterval(guard);
    guard = 0;
  }
}

/** Corta todo. Se llama al desmontar el estadio y al saltar la animación. */
export function stopNarrator(): void {
  queued = null;
  busy = false;
  liveHeat = 0;
  live = null;
  if (guard) {
    clearInterval(guard);
    guard = 0;
  }
  if (available()) speechSynthesis.cancel();
}

/** El botón de sonido del estadio también manda sobre la voz. */
export function muteNarrator(on: boolean): void {
  muted = on;
  if (on) stopNarrator();
}

/** `true` si hay una voz en el idioma de la página. */
export function hasVoice(): boolean {
  if (!available()) return false;
  refresh();
  return voice !== null;
}

/** El nombre de la voz elegida, para mostrarlo en el estadio. */
export function voiceName(): string | null {
  return voice?.name ?? null;
}
