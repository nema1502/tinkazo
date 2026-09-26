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
 * Orden de preferencia de región: boliviano primero, después los vecinos y el
 * resto de Latinoamérica, y España al final. El texto está escrito en español
 * boliviano con voseo, y leído con acento de Madrid no se entiende igual.
 *
 * Ningún sistema trae una voz boliviana instalada de fábrica. Edge sí la trae
 * por red: Marcelo y Sofía, neurales, entre las voces "Online (Natural)" de
 * toda Latinoamérica.
 */
const PREF: Record<"es" | "en", string[]> = {
  es: [
    "es-bo", "es-pe", "es-cl", "es-ar", "es-py", "es-uy", "es-ec", "es-co", "es-419", "es-mx", "es-us",
    "es-ve", "es-cr", "es-gt", "es-hn", "es-ni", "es-pa", "es-sv", "es-do", "es-pr", "es-cu", "es-es",
  ],
  en: ["en-us", "en-gb", "en-au"],
};

/**
 * La calidad de una voz, que manda sobre la región.
 *
 * Antes mandaba la región y una voz instalada sumaba puntos, así que en
 * Windows ganaba una voz de escritorio de las viejas: robótica y, en Chrome,
 * de España. Una voz neural de otro país se entiende mejor que una robótica
 * del país justo. 3 es neural (Edge la llama "Online (Natural)"), 2 son las
 * buenas de Google y de Apple, 1 todas las demás.
 */
function tier(v: SpeechSynthesisVoice | null): number {
  if (!v) return 0;
  if (/natural|neural/i.test(v.name)) return 3;
  if (/google|siri|premium|enhanced/i.test(v.name)) return 2;
  return 1;
}

/** Entre dos voces bolivianas igual de buenas, el relator de la casa. */
const HOUSE = /marcelo/i;

const VOICE_KEY = "tinkazo.voz.";

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
/** Voces de red que ya fallaron en esta sesión: el wifi del evento no dio. */
const failed = new Set<string>();
/** La tensión de la línea que está sonando ahora. */
let liveHeat = 0;
/** Cuándo empezó a sonar la línea actual. */
let liveAt = 0;
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
 * Puntaje de una voz: primero la calidad, después la región y al final que
 * sea local, que desempata a favor de la que no necesita internet.
 */
function score(v: SpeechSynthesisVoice, want: string[]): number {
  const tag = v.lang.toLowerCase().replace("_", "-");
  const base = (want[0] ?? "").slice(0, 2);
  if (!tag.startsWith(base) || failed.has(v.name)) return -1;
  const exact = want.indexOf(tag);
  const near = want.findIndex((w) => tag.startsWith(w) || w.startsWith(tag));
  const region = exact >= 0 ? want.length - exact : near >= 0 ? (want.length - near) / 2 : 0;
  return tier(v) * 1000 + region * 10 + (HOUSE.test(v.name) ? 5 : 0) + (v.localService ? 1 : 0);
}

const pageLang = (): "es" | "en" => (getLang() === "en" ? "en" : "es");

/** Las voces del idioma de la página, de la mejor a la peor. */
function ranked(): SpeechSynthesisVoice[] {
  const want = PREF[pageLang()];
  return speechSynthesis
    .getVoices()
    .map((v) => ({ v, s: score(v, want) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .map((x) => x.v);
}

function saved(): string | null {
  try {
    return localStorage.getItem(VOICE_KEY + pageLang());
  } catch {
    return null;
  }
}

function refresh(force = false): void {
  const lang = pageLang();
  if (!force && picked === lang && voice) return;
  picked = lang;
  // La primera llamada puede venir vacía: para eso está `voiceschanged`.
  const list = ranked();
  const mine = saved();
  voice = (mine ? list.find((v) => v.name === mine) : undefined) ?? list[0] ?? null;
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
  speechSynthesis.addEventListener("voiceschanged", () => refresh(true));
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
  const spoken = forSpeech(text);
  const line: Line = {
    text: spoken.length > MAX_CHARS ? spoken.slice(0, MAX_CHARS - 1) + "…" : spoken,
    // La tensión se oye en el apuro, no en el tono. Subir el tono hasta 1,4
    // convertía al relator en una ardilla, y a una voz neural cualquier
    // cambio de tono la deja rara: esa se queda en su tono de siempre.
    // Un relator habla rápido siempre, y más rápido cuando se pone bueno.
    rate: 1.08 + 0.2 * h,
    pitch: tier(voice) === 3 ? 1 : 1 + 0.08 * h,
    heat: h,
    at: Date.now(),
  };
  if (busy) {
    // Un escalón de tres décimos: lo bastante para que la corona pise al
    // relato, no tanto como para que dos frases del mismo momento se peleen.
    // Y un relator de verdad se corta a sí mismo cuando pasa algo más grande:
    // si la línea que suena ya dijo lo suyo (más de un segundo) y la nueva trae
    // más tensión, la nueva entra. Sin esto, "¡Estación 2! Se bajan 4,
    // quedan 5" tardaba cuatro segundos en decirse y "¡SE CORTÓ LA LUZ!", que
    // llegaba en el medio, esperaba su turno y se caía por vieja.
    const said = Date.now() - liveAt;
    if (h >= liveHeat + 0.3 || (h > liveHeat + 0.05 && said > 1000)) {
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
  liveAt = Date.now();
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
    u.onerror = (ev) => {
      // Una voz de red que falla (sin internet, o el servicio no responde) se
      // descarta por el resto de la sesión y se pasa a la mejor que quede.
      // Cancelar o interrumpir no es una falla de la voz.
      const err = (ev as SpeechSynthesisErrorEvent).error;
      if (voice && !voice.localService && err !== "interrupted" && err !== "canceled") {
        failed.add(voice.name);
        refresh(true);
      }
      onDone();
    };
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

/** El nombre de una voz sin la marca ni los apellidos técnicos. */
export function shortVoiceName(name: string): string {
  return name.replace(/^Microsoft\s+/, "").replace(/\s+Online \(Natural\)/, "").replace(/\s+Multilingual/, "");
}

/** Las voces que se pueden elegir, de la mejor a la peor. */
export function voiceChoices(): { name: string; natural: boolean }[] {
  if (!available()) return [];
  return ranked().map((v) => ({ name: v.name, natural: tier(v) === 3 }));
}

/** Qué tan buena es la voz elegida: 3 neural, 2 buena, 1 robótica, 0 ninguna. */
export function voiceTier(): number {
  return tier(voice);
}

/** Elige una voz a mano. Se recuerda en este equipo, por idioma. */
export function chooseVoice(name: string): void {
  try {
    localStorage.setItem(VOICE_KEY + pageLang(), name);
  } catch {
    /* sin almacenamiento: vale para esta sesión */
  }
  refresh(true);
}

/**
 * El texto como se dice. Las líneas del relator van en mayúsculas en pantalla
 * ("¡QUEDAN DOS!"), y algunas voces leen una palabra en mayúsculas como una
 * sigla, letra por letra. Para la voz van en minúsculas.
 */
export function forSpeech(text: string): string {
  return text.replace(/\p{Lu}{2,}/gu, (w) => w.toLowerCase());
}
