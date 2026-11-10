import { destinoDeMezcla, notaEn, registrarFanfarriaDeLaCarrera, salidaDeEfectos } from "../sound";
import { armarBanda, musicBreath, tocarEnBanda, type Banda } from "../music";
import { candidataDe, esDeBanda, hzDeGrado, TIEMPOS_FINAL, type CandidataEfecto, type Golpe, type Pieza, type Ruido } from "./carrera";
import { eleccionDe } from "./carrera-eleccion";
import { registrarGanchos, type ObstaculoDeLaCarrera } from "./carrera-ganchos";

/**
 * Cómo suenan, en la carrera de verdad, las candidatas que se eligen escuchando.
 *
 * Cada función devuelve `true` si tocó la candidata elegida (y entonces el juego no toca lo de siempre) y `false`
 * si la elección es `hoy` (o no hay audio): sin elección, ninguna cambia nada. Las voces son las del motor de
 * hoy: `notaEn` de `src/sound.ts` para los osciladores, ruido filtrado para los soplos y los instrumentos de la
 * banda de `src/music.ts` (bombo, charango, zampoña, palmas) en su propio bus, con la mezcla del bombo y del bajo para
 * parlante chico: las candidatas se calibraron con ella.
 */

/** Cuántos segundos de ruido sembrado se reparten entre todos los soplos: alcanza para el viento de 1,5 s. */
const SEGUNDOS_DE_RUIDO = 2;

const ruidos = new WeakMap<BaseAudioContext, AudioBuffer>();
/** Un ruido que es siempre el mismo: la misma ronda suena igual. */
function ruidoDe(ctx: BaseAudioContext): AudioBuffer {
  let b = ruidos.get(ctx);
  if (b) return b;
  b = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * SEGUNDOS_DE_RUIDO), ctx.sampleRate);
  const d = b.getChannelData(0);
  let s = 0x5eed1;
  for (let i = 0; i < d.length; i++) {
    s = (s + 0x6d2b79f5) | 0;
    let q = Math.imul(s ^ (s >>> 15), 1 | s);
    q = (q + Math.imul(q ^ (q >>> 7), 61 | q)) ^ q;
    d[i] = (((q ^ (q >>> 14)) >>> 0) / 4294967296) * 2 - 1;
  }
  ruidos.set(ctx, b);
  return b;
}

/** Un soplo de ruido filtrado en la hora `t`: sube en `atk`, se apaga solo y no tiene altura. */
function ruidoEn(ctx: BaseAudioContext, out: AudioNode, t: number, g: Ruido): void {
  const src = ctx.createBufferSource();
  src.buffer = ruidoDe(ctx);
  src.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = g.filtro;
  f.Q.value = g.q ?? 0.8;
  f.frequency.setValueAtTime(g.hz, t);
  if (g.hz1 !== undefined) f.frequency.exponentialRampToValueAtTime(g.hz1, t + g.dur);
  const ga = ctx.createGain();
  const atk = Math.min(g.atk ?? 0.004, g.dur * 0.6);
  ga.gain.setValueAtTime(0.0001, t);
  ga.gain.linearRampToValueAtTime(g.g, t + atk);
  ga.gain.exponentialRampToValueAtTime(0.0001, t + g.dur);
  src.connect(f);
  f.connect(ga);
  ga.connect(out);
  // Cada soplo arranca en otro punto del ruido, siempre el mismo: no suenan idénticos.
  src.start(t, (Math.round(t * 1000) % 1000) / 1000);
  src.stop(t + g.dur + 0.02);
}

/**
 * Toca una lista de voces a partir de la hora `t0` del contexto: las notas y los soplos por la cadena de los efectos
 * (`efectos`), los instrumentos de la banda por su bus (`banda`). Es lo que usan la carrera y el renderizador.
 */
export function tocarGolpes(ctx: BaseAudioContext, efectos: AudioNode, banda: Banda | null, golpes: readonly Golpe[], t0: number, nivel = 1): void {
  for (const g of golpes) {
    const t = t0 + g.t;
    if (g.k === "nota") notaEn(ctx, g.banda && banda ? banda.bus : efectos, t, hzDeGrado(g.grado), g.dur, g.tipo, g.g * nivel, g.cae ?? 1);
    else if (g.k === "ruido") ruidoEn(ctx, efectos, t, nivel === 1 ? g : { ...g, g: g.g * nivel });
    else if (esDeBanda(g) && banda) tocarEnBanda(banda, g, t);
  }
}

/** Las bandas de la página, una por pieza y candidata: cada una con su volumen. */
const bandas = new Map<string, { ctx: BaseAudioContext; banda: Banda }>();
function bandaDe(ctx: BaseAudioContext, clave: string, trim: number): Banda {
  const hay = bandas.get(clave);
  if (hay && hay.ctx === ctx) return hay.banda;
  const banda = armarBanda(ctx, destinoDeMezcla(ctx), 0xba2d, trim, true);
  bandas.set(clave, { ctx, banda });
  return banda;
}

const necesitaBanda = (c: CandidataEfecto, variante: number): boolean => (c.variantes[variante % c.variantes.length] as readonly Golpe[]).some(esDeBanda);

/** La candidata elegida de una pieza de efecto, o `undefined` si suena la de siempre. En el final, "ninguno" es el final de base. */
function elegida(pieza: Exclude<Pieza, "musica">): CandidataEfecto | undefined {
  const e = eleccionDe(pieza);
  if (e !== "a" && e !== "b" && e !== "c" && !(pieza === "final" && e === "base")) return undefined;
  return candidataDe(pieza, e) as CandidataEfecto | undefined;
}

function sonarVariante(pieza: Exclude<Pieza, "musica">, variante: number): boolean {
  const c = elegida(pieza);
  if (!c) return false;
  const sal = salidaDeEfectos();
  if (!sal) return false;
  const banda = necesitaBanda(c, variante) ? bandaDe(sal.ctx, `${pieza}/${c.id}`, c.trim ?? 1) : null;
  tocarGolpes(sal.ctx, sal.out, banda, c.variantes[variante % c.variantes.length] as readonly Golpe[], sal.ctx.currentTime + 0.005, c.nivel ?? 1);
  return true;
}

/** Un paso de la llama (`j` cuenta los pasos: se alternan los dos pies). */
const sonarPaso = (j: number): boolean => sonarVariante("pasos", j);

/** Una llama se echa a descansar. */
const sonarEchada = (): boolean => sonarVariante("echarse", 0);

/** Un obstáculo: las piedras caen, sopla el viento, hay que saltar la valla. */
function sonarObstaculo(tipo: ObstaculoDeLaCarrera): boolean {
  return sonarVariante("obstaculos", ["piedras", "viento", "valla"].indexOf(tipo));
}

/* ------------------------------------------------------------------ el final */

/** La banda del bombo que crece y del silencio, mientras dura: al golpe se la suelta. */
let previa: Banda | null = null;

/**
 * Programa el final de la carrera: desde tres segundos antes del cruce, la música se calla y queda el bombo al
 * pulso de la recta, cada vez más fuerte; en el cruce suena el clic de la foto y la banda se corta; y hasta el golpe
 * no suena nada. `sonar(t, hacer)` agenda algo en el segundo `t` del show. Con `hoy` no hace nada.
 *
 * Si la elección del final es `base` ("ninguno"), se hace lo mismo con el bombo de la candidata a y el golpe es el de hoy
 * con el arreglo del parlante (`FINAL_BASE`).
 */
function programarFinal(sonar: (t: number, hacer: () => void) => void, tCruce: number): void {
  const e = eleccionDe("final");
  if (e === "hoy") return;
  const c = candidataDe("final", e) as CandidataEfecto | undefined;
  if (!c) return;
  const previo = (c.variantes[0] as readonly Golpe[]).filter((g) => g.ev !== "golpe");
  sonar(tCruce - TIEMPOS_FINAL.cruce, () => {
    const sal = salidaDeEfectos();
    if (!sal) return;
    // Se cae la melodía: queda el bombo.
    musicBreath();
    previa = armarBanda(sal.ctx, destinoDeMezcla(sal.ctx), 0xf1a1, c.trim ?? 1, true);
    tocarGolpes(sal.ctx, sal.out, previa, previo, sal.ctx.currentTime + 0.02, c.nivel ?? 1);
  });
}

/** El golpe y el festejo elegidos, a la hora en que el juego corona. Suena una sola vez por sorteo. */
function golpeYFestejo(): void {
  const sal = salidaDeEfectos();
  if (!sal) return;
  const ahora = sal.ctx.currentTime + 0.01;
  // Lo que quedaba del bombo que crece (si se saltó la animación) se calla: el golpe es uno solo.
  if (previa) {
    try {
      previa.bus.disconnect();
    } catch {
      /* ya soltada */
    }
    previa = null;
  }
  const golpe = elegida("final");
  if (golpe) {
    const voces = (golpe.variantes[0] as readonly Golpe[]).filter((g) => g.ev === "golpe");
    tocarGolpes(sal.ctx, sal.out, armarBanda(sal.ctx, destinoDeMezcla(sal.ctx), 0x901e, golpe.trim ?? 1, true), voces, ahora - TIEMPOS_FINAL.golpe, golpe.nivel ?? 1);
  }
  const fiesta = elegida("festejo");
  if (fiesta) tocarGolpes(sal.ctx, sal.out, armarBanda(sal.ctx, destinoDeMezcla(sal.ctx), 0xf1e5, fiesta.trim ?? 1, true), fiesta.variantes[0] as readonly Golpe[], ahora, fiesta.nivel ?? 1);
}

registrarFanfarriaDeLaCarrera(golpeYFestejo);
registrarGanchos({ paso: sonarPaso, echada: sonarEchada, obstaculo: sonarObstaculo, programarFinal });
