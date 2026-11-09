import { cadenaDeEfectos, notaEn, vientoEn } from "../sound";
import { armarBanda, rematDeHoyEn, tocarMusicaEn } from "../music";
import {
  candidataDe,
  DATOS_PIEZA,
  hzDeGrado,
  PERFIL_BASE,
  TIEMPOS_FINAL,
  type CandidataEfecto,
  type CandidataMusica,
  type Eleccion,
  type Golpe,
  type PerfilMusica,
  type Pieza,
} from "./carrera";
import { tocarGolpes } from "./carrera-uso";

/**
 * Renderiza cada candidata de la carrera a un audio, sin la página y sin reloj: un `OfflineAudioContext` con la
 * cadena de los efectos de siempre (`cadenaDeEfectos`) y los mismos instrumentos de `src/music.ts`. Lo carga en
 * Chrome `scripts/sonidos/carrera-render.mjs`, que se trae las muestras y escribe los WAV que escucha quien elige el sonido.
 *
 * Cada pieza se renderiza como suena en el show y con el tiempo de su demostración: los pasos cada medio segundo,
 * las echadas dos veces, los tres obstáculos seguidos, los últimos tres segundos hasta el golpe, el festejo. "El de
 * hoy" es lo que suena hoy, con las mismas notas y volúmenes que escriben `carrera-show.ts` y `kit/sonido.ts`.
 */

const SR = 44100;
/** La semilla de la demostración: la música y el ruido suenan siempre igual. */
const SEMILLA = 0x0a110a;

/** Cuándo cae cada cosa en la demostración de cada pieza, en segundos. */
export const MOMENTOS = {
  pasos: { primero: 0.5, cada: 0.5, cuantos: 10 },
  echarse: [0.56, 3.25],
  obstaculos: { piedras: 0.8, valla: 2.4, viento: 3.5 },
  /** La música sube de tensión: la largada, el grupo, la recta y, desde los 27 s, solo el bombo. */
  musica: { grupo: 9, recta: 19, soloBombo: 27 },
} as const;

const nivelDeMusica = (t: number): number => (t < MOMENTOS.musica.grupo ? 0.2 : t < MOMENTOS.musica.recta ? 0.5 : 0.85);

function perfilDe(e: Eleccion): PerfilMusica | null {
  if (e === "hoy") return null;
  if (e === "base") return PERFIL_BASE;
  return (candidataDe("musica", e) as CandidataMusica).perfil;
}

/** Lo que el kit y el sonido de siempre tocan en el golpe y el festejo, con sus notas y volúmenes. */
function golpeDeHoy(ctx: BaseAudioContext, efectos: AudioNode, t: number): void {
  notaEn(ctx, efectos, t, hzDeGrado(0), 0.7, "sine", 0.09);
  notaEn(ctx, efectos, t, hzDeGrado(0), 1.2, "triangle", 0.075);
  for (const d of [10, 12, 13]) notaEn(ctx, efectos, t, hzDeGrado(d), 0.95, "triangle", 0.042);
  [13, 15, 17, 18].forEach((d, i) => notaEn(ctx, efectos, t + 0.09 + i * 0.11, hzDeGrado(d), 0.26, "triangle", 0.05));
  notaEn(ctx, efectos, t + 0.52, hzDeGrado(17), 0.12, "triangle", 0.045);
  rematDeHoyEn(armarBanda(ctx, ctx.destination, SEMILLA, 1), t);
}

/**
 * El par del bombo y del bajo: no es una pieza del show sino una elección aparte (`BOMBO_Y_BAJO` en `carrera-elegidas.ts`).
 * Es la música de hoy de la carrera, catorce segundos (seis con la tensión del grupo y ocho con la de la recta, donde
 * suenan el bombo, el kick y el bajo), tocada con la mezcla de hoy o con la de parlante chico, sin cambiar nada más.
 */
export const PIEZA_BOMBO_Y_BAJO = "bomboBajo";
export type EleccionBomboYBajo = "hoy" | "chico";
export const BOMBO_Y_BAJO_DEMO = { segundos: 14 } as const;

const nivelDelPar = (t: number): number => (t < 6 ? 0.5 : 0.85);

/** Cuánto dura el archivo de cada pieza: la demostración y la cola del último sonido. */
export const duracionDe = (pieza: Pieza | typeof PIEZA_BOMBO_Y_BAJO): number =>
  pieza === PIEZA_BOMBO_Y_BAJO ? BOMBO_Y_BAJO_DEMO.segundos + 0.5 : DATOS_PIEZA[pieza].segundos + (pieza === "musica" ? 0.5 : 0.3);

function armar(ctx: BaseAudioContext, pieza: Pieza, e: Eleccion): void {
  const efectos = cadenaDeEfectos(ctx);
  const c = e === "a" || e === "b" || e === "c" || (pieza === "final" && e === "base") ? candidataDe(pieza, e) : undefined;
  const ef = c && c.pieza !== "musica" ? (c as CandidataEfecto) : undefined;
  const variante = (i: number): readonly Golpe[] => (ef as CandidataEfecto).variantes[i % (ef as CandidataEfecto).variantes.length] as readonly Golpe[];
  // Las candidatas de efecto suenan con la mezcla del bombo y del bajo para parlante chico, como en la carrera.
  const banda = (trim?: number) => armarBanda(ctx, ctx.destination, SEMILLA, trim ?? 1, true);
  switch (pieza) {
    case "musica":
      tocarMusicaEn(ctx, ctx.destination, { seed: SEMILLA, perfil: perfilDe(e), segundos: DATOS_PIEZA.musica.segundos, nivel: nivelDeMusica, soloBomboDesde: MOMENTOS.musica.soloBombo });
      break;
    case "pasos":
      for (let j = 0; j < MOMENTOS.pasos.cuantos; j++) {
        const t = MOMENTOS.pasos.primero + j * MOMENTOS.pasos.cada;
        if (ef) tocarGolpes(ctx, efectos, banda(ef.trim), variante(j), t, ef.nivel);
        else notaEn(ctx, efectos, t, hzDeGrado(j % 2 ? 3 : 0), 0.05, "triangle", 0.022);
      }
      break;
    case "echarse":
      for (const t of MOMENTOS.echarse) {
        if (ef) tocarGolpes(ctx, efectos, banda(ef.trim), variante(0), t, ef.nivel);
        else notaEn(ctx, efectos, t, hzDeGrado(9), 0.08, "triangle", 0.04);
      }
      break;
    case "obstaculos": {
      const m = MOMENTOS.obstaculos;
      if (ef) {
        const b = banda(ef.trim);
        tocarGolpes(ctx, efectos, b, variante(0), m.piedras, ef.nivel);
        tocarGolpes(ctx, efectos, b, variante(2), m.valla, ef.nivel);
        tocarGolpes(ctx, efectos, b, variante(1), m.viento, ef.nivel);
      } else {
        notaEn(ctx, efectos, m.piedras, hzDeGrado(0), 0.5, "sine", 0.085);
        notaEn(ctx, efectos, m.valla, hzDeGrado(9), 0.08, "triangle", 0.05);
        vientoEn(ctx, efectos, m.viento, 1.6, 0.048, 350, 1340, 0x6d2b79f5);
      }
      break;
    }
    case "final": {
      if (e === "hoy") {
        // Lo de hoy: la música sigue hasta unos 0,4 s antes del cruce, los dos latidos graves del silencio y el golpe con todo junto.
        tocarMusicaEn(ctx, ctx.destination, { seed: SEMILLA, perfil: null, segundos: TIEMPOS_FINAL.cruce - 0.4, nivel: () => 0.85 });
        notaEn(ctx, efectos, TIEMPOS_FINAL.golpe - 0.5, hzDeGrado(0), 0.22, "sine", 0.06);
        notaEn(ctx, efectos, TIEMPOS_FINAL.golpe - 0.25, hzDeGrado(0), 0.22, "sine", 0.05);
        golpeDeHoy(ctx, efectos, TIEMPOS_FINAL.golpe);
      } else {
        const a = candidataDe("final", e) as CandidataEfecto;
        tocarGolpes(ctx, efectos, banda(a.trim), a.variantes[0] as readonly Golpe[], 0, a.nivel);
      }
      break;
    }
    case "festejo":
      if (ef) tocarGolpes(ctx, efectos, banda(ef.trim), variante(0), 0, ef.nivel);
      else golpeDeHoy(ctx, efectos, 0);
      break;
  }
}

/** Lo último que se renderizó: las muestras en 16 bits, de a trozos, para traerlas por DevTools sin un mensaje enorme. */
let ultimo: Int16Array = new Int16Array(0);

/**
 * Renderiza una pieza y deja las muestras listas para pedirlas con `trozo`. Devuelve cuántas muestras por canal tiene
 * y el pico que tuvo antes de pasar a 16 bits (para saber si hubo que recortar).
 */
export async function renderizar(pieza: Pieza | typeof PIEZA_BOMBO_Y_BAJO, e: Eleccion | EleccionBomboYBajo): Promise<{ sr: number; n: number; pico: number }> {
  const n = Math.ceil(duracionDe(pieza) * SR);
  const ctx = new OfflineAudioContext(2, n, SR);
  if (pieza === PIEZA_BOMBO_Y_BAJO) {
    // Los dos con el mismo azar y el mismo arreglo de hoy: solo cambia la mezcla del bombo, el kick y el bajo.
    tocarMusicaEn(ctx, ctx.destination, { seed: SEMILLA, perfil: null, segundos: BOMBO_Y_BAJO_DEMO.segundos, nivel: nivelDelPar, parlanteChico: e === "chico" });
  } else armar(ctx, pieza, e as Eleccion);
  const buf = await ctx.startRendering();
  const L = buf.getChannelData(0);
  const R = buf.getChannelData(1);
  let pico = 0;
  ultimo = new Int16Array(n * 2);
  for (let i = 0; i < n; i++) {
    pico = Math.max(pico, Math.abs(L[i] as number), Math.abs(R[i] as number));
    ultimo[2 * i] = Math.max(-32768, Math.min(32767, Math.round((L[i] as number) * 32767)));
    ultimo[2 * i + 1] = Math.max(-32768, Math.min(32767, Math.round((R[i] as number) * 32767)));
  }
  return { sr: SR, n, pico };
}

/** Un trozo de las muestras en 16 bits (intercaladas), en base64. */
export function trozo(desde: number, cuantas: number): string {
  const bytes = new Uint8Array(ultimo.buffer, ultimo.byteOffset + desde * 2, Math.min(cuantas, ultimo.length - desde) * 2);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
