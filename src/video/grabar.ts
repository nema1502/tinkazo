/**
 * La grabación del video del sorteo, con MediaRecorder.
 *
 * La parte de navegador del prototipo del issue nema1502/tinkazo#31: toma el
 * plan (`plan.ts`), dibuja cada cuadro en un lienzo vertical 720x1280 con
 * `dibujar.ts` y lo codifica con `canvas.captureStream(0)` +
 * `MediaRecorder`, empujando un cuadro por golpe de reloj real. MediaRecorder
 * le pone a cada cuadro la hora en que llega: para que el video dure lo que el
 * plan dice, la grabación corre en tiempo real; el dibujo de cada cuadro se
 * mide aparte, que es lo que responde «cuánto cuesta volver a dibujar».
 *
 * La bandera (`videoDescarga` en `src/flags.ts`) gobierna todo: apagada, no
 * graba nada. El prototipo no toca la interfaz: se llama por consola o por el
 * script de medición (`scripts/medir-video.mjs`).
 *
 * El sonido, si se pide, sale de la banda de la página: la música de la ronda
 * que ya existe (`tocarMusicaEn` en `src/music.ts`, el mismo secuenciador que
 * suena en el show) va a un `MediaStreamAudioDestinationNode` y ese track se
 * suma al del lienzo. Así se mide si entra el sonido y cuánto pesa.
 */

import { videoDescarga } from "../flags";
import { dibujarCuadro } from "./dibujar";
import type { PlanVideo } from "./plan";

/**
 * Los formatos que se le piden a MediaRecorder, del que mejor entra en
 * WhatsApp para abajo: MP4 (H.264/AAC) si el navegador lo sabe escribir —
 * Chrome 126+ y Safari lo hacen — y WebM (VP9/VP8 + Opus) si no. Lo que
 * produce WhatsApp aceptando es otra historia: el script de medición reporta
 * cuál salió en el Chrome de esta VPS.
 */
export const MIMES_PREFERIDOS: readonly string[] = [
  "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
  "video/mp4",
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
];

/**
 * El primero de los preferidos que el navegador sabe escribir, o null si no
 * sabe grabar ninguno. `soportados` es lo que responde
 * `MediaRecorder.isTypeSupported` (o una lista fija, en las pruebas).
 */
export function elegirMime(soportados: readonly string[]): string | null {
  const sabe = new Set(soportados);
  return MIMES_PREFERIDOS.find((m) => sabe.has(m)) ?? null;
}

/** Lo que quedó de una grabación, con los números que pide el issue. */
export interface MedicionVideo {
  /** El formato que salió, o null si el navegador no supo grabar. */
  formato: string | null;
  /** El peso del archivo, en bytes. */
  bytes: number;
  /** Cuántos cuadros se dibujaron. */
  cuadros: number;
  /** El tiempo total de grabación (pared), en ms: con el ritmo en tiempo real, ≈ la duración del video. */
  msTotal: number;
  /** La suma del dibujo de todos los cuadros, en ms: el costo puro de volver a dibujar. */
  msDibujo: number;
  /** El cuadro que más tardó en dibujarse, en ms. */
  msDibujoMaximo: number;
  /** Si el video lleva el track de audio. */
  conAudio: boolean;
  /** El pico de la onda de audio decodificada, de 0 a 1. null si no hay audio o no se pudo decodificar. */
  picoAudio: number | null;
}

/** El track de video de un `canvas.captureStream(0)`, con `requestFrame`. */
type TrackDeLienzo = MediaStreamTrack & { requestFrame?: () => void };

/**
 * La onda de un archivo de audio ya grabado: su pico, de 0 a 1. Sirve para
 * comprobar que el video no solo lleva un track de audio, sino sonido de
 * verdad: un track mudo decodifica un pico de 0.
 */
export async function picoDeAudio(blob: Blob): Promise<number | null> {
  const AC = window.AudioContext;
  if (!AC) return null;
  const ctx = new AC();
  try {
    const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
    let pico = 0;
    for (const canal of Array.from({ length: buf.numberOfChannels }, (_, c) => buf.getChannelData(c))) {
      for (let i = 0; i < canal.length; i += 16) {
        const v = Math.abs(canal[i] as number);
        if (v > pico) pico = v;
      }
    }
    return pico;
  } catch {
    return null;
  } finally {
    void ctx.close();
  }
}

/** Grabar el show de un plan, con o sin la música de la ronda. */
export async function grabarShow(p: PlanVideo, op: { conAudio?: boolean } = {}): Promise<{ medicion: MedicionVideo; archivo: Blob | null }> {
  if (!videoDescarga()) throw new Error("el video del sorteo está apagado: prende la bandera videoDescarga (?video=medir) para medir");

  const lienzo = document.createElement("canvas");
  lienzo.width = p.ancho;
  lienzo.height = p.alto;
  const ctx = lienzo.getContext("2d");
  if (!ctx) throw new Error("este navegador no da un contexto 2D");

  // El QR del comprobante, una sola vez: el cierre lo reutiliza en todos sus cuadros.
  let qr: CanvasImageSource | null = null;
  try {
    const { qrLienzo } = await import("../ui/qr");
    const q = await qrLienzo(p.ronda.enlace, 480, 1);
    qr = q?.canvas ?? null;
  } catch {
    qr = null;
  }

  // El formato que sale: el que el Chrome de esta máquina sepa escribir.
  const soportados = typeof MediaRecorder === "undefined" ? [] : MIMES_PREFERIDOS.filter((m) => MediaRecorder.isTypeSupported(m));
  const mime = elegirMime(soportados);
  if (!mime) throw new Error("este navegador no sabe grabar con MediaRecorder");

  const stream = lienzo.captureStream(0) as MediaStream;
  const track = stream.getVideoTracks()[0] as TrackDeLienzo;

  // La música de la ronda: el mismo secuenciador del show, a un destino que se
  // puede grabar. Se arma antes de empezar: el primer compás entra con el
  // primer cuadro, no tres compases después.
  let audioCtx: AudioContext | null = null;
  if (op.conAudio) {
    try {
      const { tocarMusicaEn } = await import("../music");
      audioCtx = new AudioContext();
      const destino = audioCtx.createMediaStreamDestination();
      // La tensión que la música persigue: la que el plan lleva en cada instante.
      const showDesde = (p.escenas.find((e) => e.id === "show")?.desde ?? 0) / p.fps;
      const showHasta = showDesde + (p.escenas.find((e) => e.id === "show")?.segundos ?? 0);
      const nivel = (t: number): number => {
        if (t < showDesde || t > showHasta) return 0.12;
        const i = Math.round((t - showDesde) * p.fps);
        return p.show[Math.max(0, Math.min(p.show.length - 1, i))]!.tension;
      };
      tocarMusicaEn(audioCtx, destino, { seed: p.ronda.seed, perfil: null, segundos: p.segundos, nivel });
      for (const t of destino.stream.getAudioTracks()) stream.addTrack(t);
    } catch {
      // Sin música el video sale mudo: la medición lo dice, no lo esconde.
      audioCtx = null;
    }
  }

  const grabador = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 4_000_000 });
  const partes: Blob[] = [];
  grabador.ondataavailable = (e) => {
    if (e.data.size) partes.push(e.data);
  };
  const parado = new Promise<void>((resolver) => {
    grabador.onstop = () => resolver();
  });

  // El primer cuadro va antes de arrancar el reloj: el video abre con el
  // cartel del sorteo ya en pantalla, no con un lienzo vacío.
  const msDibujoPorCuadro: number[] = [];
  const t0 = performance.now();
  grabador.start(1000);
  for (let i = 0; i < p.cuadros; i++) {
    const objetivo = t0 + (i * 1000) / p.fps;
    const d0 = performance.now();
    dibujarCuadro(ctx, p, i, { qr });
    track.requestFrame?.();
    msDibujoPorCuadro.push(performance.now() - d0);
    // El ritmo es en tiempo real: MediaRecorder le pone a cada cuadro la hora
    // en que llegó, y un cuadro adelantado acortaría el video.
    const falta = objetivo + 1000 / p.fps - performance.now();
    if (falta > 0) await new Promise((r) => setTimeout(r, falta));
  }
  grabador.stop();
  await parado;
  for (const t of stream.getAudioTracks()) t.stop();
  if (audioCtx) void audioCtx.close();
  const msTotal = performance.now() - t0;

  const archivo = partes.length ? new Blob(partes, { type: mime.split(";")[0] ?? mime }) : null;
  const pico = archivo && op.conAudio ? await picoDeAudio(archivo) : null;
  return {
    archivo,
    medicion: {
      formato: mime,
      bytes: archivo?.size ?? 0,
      cuadros: p.cuadros,
      msTotal,
      msDibujo: msDibujoPorCuadro.reduce((a, b) => a + b, 0),
      msDibujoMaximo: msDibujoPorCuadro.reduce((a, b) => Math.max(a, b), 0),
      conAudio: !!audioCtx,
      picoAudio: pico,
    },
  };
}
