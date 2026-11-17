import { getLang } from "./i18n";
import { paceFactor, type Game } from "./state";
import { ambiente, decidir, elegirJuego, ganador as ganadorDeArchivo, type Disparo, type Jugada } from "./sonidos/banco";
import { curvaDeTecho } from "./sonidos/carrera";
import { avisarJuego, festejoPropio, golpePropio, hayCandidatas } from "./sonidos/carrera-eleccion";
import { pistaCallar, pistaDelJuego, pistaRemata, pistasConContexto } from "./sonidos/pistas-enganche";

/* Sonido con WebAudio: osciladores, y archivos cuando el banco (`src/sonidos/banco.ts`) los tiene. */

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

/** Los archivos de viento y de colibrí vienen a la sonoridad de todos: este factor los baja al nivel del ruido y del zumbido de siempre. */
const AMBIENTE_K = 4;

let master: GainNode | null = null;

/**
 * La cadena por la que pasa todo: un techo de volumen y un paso bajo.
 *
 * Una onda cuadrada sin filtrar tiene armónicos hasta donde llegue el aparato,
 * y eso es literalmente lo que suena a aparato en el parlante de un proyector.
 * El paso bajo a 4,5 kHz les saca el filo sin quitarles el carácter, y el techo
 * evita que dos sonidos a la vez saturen.
 *
 * Arma el contexto si no existe, sin reanudarlo: armarlo es lo que cuesta (ver
 * `armarDeAntemano`).
 */
function contexto(): { ctx: AudioContext; out: GainNode } | null {
  const Ctor =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  const ctx = audioCtx ?? new Ctor();
  if (!audioCtx) pistasConContexto(ctx);
  audioCtx = ctx;
  if (!master) master = cadenaDeEfectos(ctx);
  return { ctx, out: master };
}

/**
 * La cadena de los efectos de un contexto: una ganancia y el paso bajo de 4,5 kHz que van antes de la salida.
 * Es la misma que arma `contexto` en la página; el renderizador de las candidatas de la carrera la arma
 * también en un `OfflineAudioContext` para oír, sin la página, lo mismo que sale por el parlante.
 */
export function cadenaDeEfectos(ctx: BaseAudioContext): GainNode {
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 4500;
  lp.Q.value = 0.7;
  const g = ctx.createGain();
  g.gain.value = 0.9;
  g.connect(lp);
  lp.connect(destinoDeMezcla(ctx));
  return g;
}

/** Por dónde sale todo lo que suena en un contexto: una ganancia sin cambio que va derecho a la salida o, en la carrera con candidatas, por un techo. */
const mezclas = new WeakMap<BaseAudioContext, { entrada: GainNode; techo: WaveShaperNode }>();

/**
 * La entrada de la mezcla de un contexto: lo que suena (los efectos, la música, la banda) se conecta acá y no a la salida.
 * Casi siempre va derecho a la salida y no cambia nada. Cuando la carrera suena con candidatas elegidas escuchando
 * (más fuertes que lo de hoy: −18 LUFS) pasa por un techo suave en −1,3 dBFS, que deja pasar igual todo lo que está por
 * debajo de −2,9 dBFS: la música y los efectos suman en el mismo instante y el pico real no tiene que pasar de −1 dBTP.
 */
export function destinoDeMezcla(ctx: BaseAudioContext): AudioNode {
  let m = mezclas.get(ctx);
  if (!m) {
    const entrada = ctx.createGain();
    const techo = ctx.createWaveShaper();
    techo.curve = curvaDeTecho(0.72);
    techo.oversample = "2x";
    techo.connect(ctx.destination);
    entrada.connect(hayCandidatas() ? techo : ctx.destination);
    m = { entrada, techo };
    mezclas.set(ctx, m);
  }
  return m.entrada;
}

/** Prende o apaga el techo de la mezcla según el juego que va a sonar. */
function techoDeLaMezcla(ctx: BaseAudioContext, prendido: boolean): void {
  const m = mezclas.get(ctx);
  if (!m) return;
  m.entrada.disconnect();
  m.entrada.connect(prendido ? m.techo : ctx.destination);
}

/** La cadena, lista para sonar. */
function chain(): { ctx: AudioContext; out: GainNode } | null {
  const c = contexto();
  // El contexto nace suspendido si el primer sonido no salió de un clic. Sin
  // esto el sorteo entero corre en silencio y nadie entiende por qué.
  if (c?.ctx.state === "suspended") void c.ctx.resume();
  return c;
}

/**
 * Hace sonar un archivo del banco por el mismo bus que los osciladores (el techo, el paso bajo y el silenciador
 * de siempre). Anota en el nodo qué disparo reemplaza, para los auditores. `false` si no pudo.
 */
function sonar(j: Jugada, o: Disparo): boolean {
  try {
    const c = chain();
    if (!c) return false;
    const t0 = c.ctx.currentTime;
    const src = c.ctx.createBufferSource();
    src.buffer = j.buffer;
    src.playbackRate.value = j.rate;
    const ga = c.ctx.createGain();
    ga.gain.setValueAtTime(j.gan, t0);
    let fin = j.buffer.duration / j.rate;
    if (j.corta > 0 && j.corta < fin) {
      ga.gain.setValueAtTime(j.gan, t0 + j.corta);
      ga.gain.linearRampToValueAtTime(0, t0 + j.corta + 0.05);
      fin = j.corta + 0.05;
    }
    src.connect(ga);
    ga.connect(c.out);
    (src as AudioBufferSourceNode & { __beep?: unknown }).__beep = { ...o, id: j.id };
    src.start(t0);
    src.stop(t0 + fin + 0.02);
    return true;
  } catch {
    return false;
  }
}

/**
 * Un sonido de fondo que dura lo que pide el juego (el viento, el colibrí): el archivo se repite hasta cubrir `dur`
 * y el volumen sigue la curva que le pasa el llamador.
 */
function sonarAmbiente(buffer: AudioBuffer, id: string, dur: number, curva: Float32Array, o: Disparo): boolean {
  try {
    const c = chain();
    if (!c) return false;
    const t0 = c.ctx.currentTime;
    const src = c.ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    const ga = c.ctx.createGain();
    ga.gain.setValueCurveAtTime(curva, t0, dur);
    src.connect(ga);
    ga.connect(c.out);
    (src as AudioBufferSourceNode & { __beep?: unknown }).__beep = { ...o, id, amb: true };
    src.start(t0);
    src.stop(t0 + dur + 0.02);
    return true;
  } catch {
    return false;
  }
}

/**
 * Una nota. Si el banco tiene un archivo para este disparo suena el archivo; si el disparo ya va adentro de otro
 * archivo que acaba de sonar, no suena; si no, el oscilador de siempre.
 */
export function beep(f: number, d = 0.09, type: OscillatorType = "square", g = 0.05): void {
  if (muted) return;
  if (type !== "custom") {
    const o: Disparo = { f, d, tipo: type, g };
    const j = decidir(o, performance.now());
    if (j === "silencio") return;
    if (j && sonar(j, o)) return;
  }
  oscilador(f, d, type, g);
}

function oscilador(f: number, d: number, type: OscillatorType, g: number): void {
  if (muted) return;
  try {
    const c = chain();
    if (!c) return;
    notaEn(c.ctx, c.out, c.ctx.currentTime, f, d, type, g);
  } catch {
    /* sin audio */
  }
}

/**
 * Una nota de oscilador con su envolvente, armada en la hora `t0` de cualquier contexto y conectada a `out`.
 * Es lo que hace `beep`, sin el silenciador ni el banco de archivos: así el renderizador de las candidatas de la
 * carrera toca exactamente la misma nota. `cae` (de 0,3 a 1) baja el tono hasta esa fracción de `f` a lo largo de
 * la nota: el golpe sordo de una almohadilla o de un tronco hueco. Sin `cae`, la nota es la de siempre.
 */
export function notaEn(ctx: BaseAudioContext, out: AudioNode, t0: number, f: number, d: number, type: OscillatorType, g: number, cae = 1): void {
  const o = ctx.createOscillator();
  const ga = ctx.createGain();
  o.type = type;
  o.frequency.value = f;
  if (cae < 1) {
    o.frequency.setValueAtTime(f, t0);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f * cae), t0 + d);
  }
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
  ga.connect(out);
  o.start(t0);
  o.stop(t0 + d + 0.02);
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
 * El viento: ruido filtrado que crece y se corre de `hz0` a `hz1`, lo bastante agudo como para oírse en el parlante
 * de un proyector (de 300 a 1.500 Hz). El ruido se llena con una semilla, no con `Math.random`: la misma ronda suena
 * igual. La duración va en segundos del juego y se estira sola, como `beepFor`.
 *
 * No son osciladores: `audit-sound` no lo ve y lo mide `audit-mezcla`, que graba lo que sale por el parlante.
 */
export function wind(gameSeconds: number, vol: number, hz0: number, hz1: number, seed: number): void {
  if (muted) return;
  try {
    const c = chain();
    if (!c) return;
    const dur = Math.max(0.2, gameSeconds * paceFactor());
    const amb = ambiente("viento");
    if (amb) {
      const pasos = 48;
      const curva = new Float32Array(pasos);
      for (let i = 0; i < pasos; i++) {
        const u = i / (pasos - 1);
        curva[i] = vol * AMBIENTE_K * Math.min(1, u / 0.35) * Math.min(1, (1 - u) / 0.25);
      }
      if (sonarAmbiente(amb.buffer, amb.id, dur, curva, { f: hz0, d: dur, tipo: "sine", g: vol })) return;
    }
    vientoEn(c.ctx, c.out, c.ctx.currentTime, dur, vol, hz0, hz1, seed);
  } catch {
    /* sin audio */
  }
}

/** El viento de `wind`, armado en la hora `t0` de cualquier contexto y conectado a `out`: el renderizador de la carrera toca el mismo. `dur` en segundos reales. */
export function vientoEn(ctx: BaseAudioContext, out: AudioNode, t0: number, dur: number, vol: number, hz0: number, hz1: number, seed: number): void {
  const n = Math.max(1, Math.ceil(ctx.sampleRate * dur));
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const data = buf.getChannelData(0);
  let s = Math.floor(seed) | 0 || 1;
  for (let i = 0; i < n; i++) {
    s = (s + 0x6d2b79f5) | 0;
    let q = Math.imul(s ^ (s >>> 15), 1 | s);
    q = (q + Math.imul(q ^ (q >>> 7), 61 | q)) ^ q;
    data[i] = (((q ^ (q >>> 14)) >>> 0) / 4294967296) * 2 - 1;
  }
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const bp = ctx.createBiquadFilter();
  bp.type = "bandpass";
  bp.Q.value = 0.9;
  bp.frequency.setValueAtTime(Math.max(120, hz0), t0);
  bp.frequency.exponentialRampToValueAtTime(Math.max(120, hz1), t0 + dur);
  const ga = ctx.createGain();
  // La envolvente es una curva (sube el primer tercio y se apaga al final), sin rampas lineales de ganancia.
  const pasos = 48;
  const curva = new Float32Array(pasos);
  for (let i = 0; i < pasos; i++) {
    const u = i / (pasos - 1);
    curva[i] = vol * Math.min(1, u / 0.35) * Math.min(1, (1 - u) / 0.25);
  }
  ga.gain.setValueCurveAtTime(curva, t0, dur);
  src.connect(bp);
  bp.connect(ga);
  ga.connect(out);
  src.start(t0);
  src.stop(t0 + dur + 0.02);
}

/**
 * El zumbido de un colibrí: una nota de la escala con trémolo rápido, que crece de `vol0` a `vol1`. El trémolo es una
 * curva de ganancia (no un segundo oscilador), así el único oscilador es la nota, en la escala. Segundos del juego.
 */
export function hum(f: number, gameSeconds: number, vol0: number, vol1: number): void {
  if (muted) return;
  try {
    const c = chain();
    if (!c) return;
    const dur = Math.max(0.1, gameSeconds * paceFactor());
    const amb = ambiente("colibri");
    if (amb) {
      const pasos = Math.max(16, Math.ceil(dur * 40));
      const curva = new Float32Array(pasos);
      for (let i = 0; i < pasos; i++) {
        const u = i / (pasos - 1);
        curva[i] = (vol0 + (vol1 - vol0) * u) * AMBIENTE_K * Math.min(1, u / 0.1) * Math.min(1, (1 - u) / 0.1);
      }
      if (sonarAmbiente(amb.buffer, amb.id, dur, curva, { f, d: dur, tipo: "triangle", g: vol1 })) return;
    }
    const t0 = c.ctx.currentTime;
    const o = c.ctx.createOscillator();
    const ga = c.ctx.createGain();
    o.type = "triangle";
    o.frequency.value = f;
    const atk = Math.min(0.06, dur * 0.2);
    ga.gain.setValueAtTime(0.0001, t0);
    ga.gain.linearRampToValueAtTime(vol0, t0 + atk);
    const largo = Math.max(0.02, dur - atk - 0.03);
    const pasos = Math.max(16, Math.ceil(largo * 320));
    const curva = new Float32Array(pasos);
    for (let i = 0; i < pasos; i++) {
      const u = i / (pasos - 1);
      const base = vol0 + (vol1 - vol0) * u;
      curva[i] = base * (0.62 + 0.38 * Math.sin(2 * Math.PI * 30 * u * largo));
    }
    ga.gain.setValueCurveAtTime(curva, t0 + atk, largo);
    ga.gain.setValueAtTime(0, t0 + dur);
    o.connect(ga);
    ga.connect(c.out);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
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
  // Con la pista de música de archivo, el golpe y el festejo son los de la pista: un solo final (`src/sonidos/pistas-enganche.ts`).
  if (pistaRemata()) return;
  // Con archivo, el remate del ganador es uno solo (la tribuna, el golpe): el acorde de osciladores no suena encima.
  if (!muted) {
    const j = ganadorDeArchivo();
    if (j && sonar(j, { f: 130.81, d: 1.2, tipo: "triangle", g: 0.075 })) return;
  }
  // En la carrera, el golpe y el festejo que se eligieron escuchando (`src/sonidos/carrera-uso.ts`) reemplazan al de acá.
  const golpeMio = golpePropio(), festejoMio = festejoPropio();
  if ((golpeMio || festejoMio) && fanfarriaDeLaCarrera) fanfarriaDeLaCarrera();
  // Cuatro notas de 0,22 s en triángulo es una flautita: en una sala de
  // cincuenta personas no llega al fondo. Un final se oye por tres cosas que no
  // tenía: cuerpo (una nota grave sostenida), acorde (tres notas a la vez, no
  // una detrás de otra) y remate (el arpegio arriba). La pentatónica garantiza
  // que cualquier par suene bien, así que las tres juntas no pueden desafinar.
  if (!golpeMio) {
    oscilador(note(0), 1.2, "triangle", 0.075);
    [10, 12, 13].forEach((d) => oscilador(note(d), 0.95, "triangle", 0.042));
  }
  if (!festejoMio)
    [13, 15, 17, 18].forEach((d, i) =>
      setTimeout(() => oscilador(note(d), 0.26, "triangle", 0.05), 90 + i * 110),
    );
}

/** Quién toca el golpe y el festejo elegidos de la carrera: lo registra `carrera-uso.ts` al cargarse (así `sound.ts` no depende de la música). */
let fanfarriaDeLaCarrera: (() => void) | null = null;
export function registrarFanfarriaDeLaCarrera(fn: () => void): void {
  fanfarriaDeLaCarrera = fn;
}

export function soundLabel(): void {
  const word = getLang() === "es" ? "SONIDO" : "SOUND";
  const el = document.getElementById("st-sound");
  if (el) el.textContent = `${word}: ${muted ? (getLang() === "es" ? "NO" : "OFF") : getLang() === "es" ? "SÍ" : "ON"}`;
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
  // La cola del festejo de una pista cuyo show ya terminó sigue sonando unos segundos: al apagar el sonido se calla.
  if (muted) pistaCallar();
  // La voz del narrador es parte del sonido: un solo botón las apaga a las dos.
  soundLabel();
}

/**
 * Avisa qué juego va a sonar, para que el banco baje sus archivos mientras la sala lee la tarjeta de "cómo se
 * juega". Sin audio, con ahorro de datos o sin los archivos, suena lo de siempre. `reinicia` es `false` cuando el
 * juego ya fue elegido por el sorteo y solo se asegura que esté (el motor de los juegos lo llama otra vez al arrancar).
 */
export function sonidoDelJuego(game: Game, reinicia = true): void {
  avisarJuego(game);
  try {
    elegirJuego(game, audioCtx ?? contexto()?.ctx ?? null, reinicia);
    pistaDelJuego(game, audioCtx);
    if (audioCtx) techoDeLaMezcla(audioCtx, hayCandidatas());
  } catch {
    /* sin audio: suenan los osciladores */
  }
}

/** El contexto y la entrada de la cadena de efectos, para tocar desde afuera lo mismo que `beep` (el sonido de la carrera). `null` si no hay audio o está silenciado. */
export function salidaDeEfectos(): { ctx: AudioContext; out: AudioNode } | null {
  return muted ? null : chain();
}

/** `true` si el estadio está en silencio. */
export const isMuted = (): boolean => muted;

/** El contexto de audio compartido, para la música. `null` si no hay audio. */
export function audio(): AudioContext | null {
  return chain()?.ctx ?? null;
}

/**
 * Safari en el iPhone solo deja sonar un contexto de audio que nació o se
 * reanudó dentro de un toque. El primer sonido del sorteo sale después de
 * esperar la ronda, ya fuera del toque, y el sorteo corría mudo. Al primer
 * toque de la página se arma el contexto ahí mismo y se hace sonar un
 * silencio; cuando el contexto queda andando, se deja de escuchar.
 */
export function unlockAudioOnGesture(): void {
  const events = ["pointerdown", "touchend", "keydown"] as const;
  const unlock = (): void => {
    try {
      const c = chain();
      if (!c) return;
      const src = c.ctx.createBufferSource();
      src.buffer = c.ctx.createBuffer(1, 1, 22050);
      src.connect(c.ctx.destination);
      src.start(0);
      if (c.ctx.state === "running") for (const e of events) removeEventListener(e, unlock, true);
    } catch {
      /* sin audio: el sorteo sigue igual */
    }
  };
  for (const e of events) addEventListener(e, unlock, { capture: true, passive: true });
  armarDeAntemano();
}

/**
 * Arma el contexto de audio con la página quieta, antes del primer toque.
 *
 * Crear un AudioContext le pregunta al sistema por la salida de sonido y traba
 * el hilo de la página: unos 170 ms con la CPU de un celular (CPU x4, medición
 * del 17 de octubre de 2026), y eso lo pagaba el primer toque, que tardaba en
 * responder. Armado antes nace suspendido y no suena nada: el toque solo lo
 * reanuda y hace sonar el silencio, que no bloquea. Si alguien toca antes de
 * que esté, se arma en el toque, como siempre. Con el sonido apagado, no.
 *
 * Cuándo: con la primera señal de que hay alguien (mueve el mouse o baja por
 * la página, que casi siempre pasa antes de tocar algo) o a los seis
 * segundos de cargar, lo que llegue antes, y en un momento ocioso. No al
 * cargar, que es cuando la página tiene más que hacer.
 */
function armarDeAntemano(): void {
  const armar = (): void => {
    if (muted || audioCtx) return;
    try {
      contexto();
    } catch {
      /* sin audio: el toque lo vuelve a intentar */
    }
  };
  let pedido = false;
  const pedir = (): void => {
    if (pedido) return;
    pedido = true;
    removeEventListener("scroll", pedir);
    removeEventListener("pointermove", alMover);
    if (typeof requestIdleCallback === "function") requestIdleCallback(armar, { timeout: 2000 });
    else setTimeout(armar, 0);
  };
  const alMover = (e: PointerEvent): void => {
    if (e.pointerType === "mouse") pedir();
  };
  addEventListener("scroll", pedir, { passive: true });
  addEventListener("pointermove", alMover, { passive: true });
  const luego = (): void => void setTimeout(pedir, 6000);
  if (document.readyState === "complete") luego();
  else addEventListener("load", luego, { once: true });
}
