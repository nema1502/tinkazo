/**
 * La medición completa del prototipo, para correr en el navegador.
 *
 * Es lo que llama el script de medición (`scripts/medir-video.mjs`) por CDP:
 * arma la ronda de prueba (una lista y una semilla fijas, siempre la misma),
 * planifica el show y lo graba dos veces, sin sonido y con la música de la
 * ronda, y devuelve los números del issue: cuánto tarda volver a dibujar y
 * codificar, cuánto pesa el archivo, qué formato produjo este navegador y si
 * el sonido entró de verdad (un pico de onda decodificada mayor que 0).
 *
 * Requiere la bandera prendida (`?video=medir` en la dirección, o
 * `VITE_VIDEO_DESCARGA=1` al construir): `grabarShow` se niega sin ella.
 */

import { grabarShow, type MedicionVideo } from "./grabar";
import { planDeShow, type PlanVideo, type RondaVideo } from "./plan";

/** La ronda de prueba del prototipo: un solo juego, siempre el mismo. */
export const RONDA_DE_PRUEBA: RondaVideo = {
  nombres: [
    "Ana Mamani", "Beto Quispe", "Carla Rojas", "Diego Flores", "Elena Choque",
    "Franco Vargas", "Gabriela Torres", "Hugo Céspedes", "Ivana Salazar", "Jorge Vilca",
    "Karla Mendoza", "Lucas Huanca", "María Colque", "Nico Paredes", "Olga Supay",
    "Pedro Lara", "Renata Ortiz", "Sergio Blanco", "Tania Álvarez", "Ulises Ramos",
    "Vera Cardozo", "Wálter Peña", "Ximena Durán", "Yola Sariri", "Zuni Marca",
    "Bruno Ayala", "Camila Suárez", "Dario Ichuta", "Elvira Caero", "Fabio Nava",
    "Gladis Ticona", "Héctor Montaño",
  ],
  ganador: "Lucas Huanca",
  seed: 31415926,
  // Un comprobante de la forma y el largo de los de verdad: el QR y el peso del
  // video dependen del largo del enlace, y un enlace corto mediría poco.
  enlace:
    "https://tinkazo.app/verificar#e1.3.ejemplo-de-comprobante-con-la-lista-Completa-de-32-participantes-y-su-cuenta-para-que-entre-al-qr-del-video-de-medicion",
  premio: "Una polera del club",
  titulo: "Sorteo de prueba del video",
};

/** Lo que mide una pasada (una grabación). */
export type Pasada = MedicionVideo;

export interface ReporteVideo {
  /** Qué navegador y máquina midió, lo que se pueda decir desde la página. */
  navegador: { cadena: string; nucleos: number | null; memoriaGB: number | null };
  /** La ronda medida, resumida. */
  ronda: { participantes: number; seed: number; cuadros: number; segundos: number; carriles: number };
  /** Las dos grabaciones: sin sonido y con la música de la ronda. */
  grabaciones: { sinAudio: Pasada; conAudio: Pasada };
  /** Lo que este navegador produce y no se puede saber desde Node. */
  notas: string[];
}

/** La medición completa: dos grabaciones del mismo show. */
export async function medirTodo(): Promise<ReporteVideo> {
  const plan: PlanVideo = planDeShow(RONDA_DE_PRUEBA);
  const sin = await grabarShow(plan, { conAudio: false });
  const con = await grabarShow(plan, { conAudio: true });
  const nav = navigator as Navigator & { deviceMemory?: number };
  return {
    navegador: {
      cadena: navigator.userAgent,
      nucleos: navigator.hardwareConcurrency ?? null,
      memoriaGB: nav.deviceMemory ?? null,
    },
    ronda: {
      participantes: plan.ronda.nombres.length,
      seed: plan.ronda.seed,
      cuadros: plan.cuadros,
      segundos: plan.segundos,
      carriles: plan.carriles,
    },
    grabaciones: { sinAudio: sin.medicion, conAudio: con.medicion },
    notas: [
      "La grabación corre en tiempo real: MediaRecorder le pone a cada cuadro la hora en que llega, así que msTotal ≈ la duración del video. El costo de volver a dibujar es msDibujo (la suma del dibujo de los cuadros), y lo que queda es espera del ritmo y codificación.",
      "El pico de audio se mide decodificando el archivo grabado: mayor que 0 es que el sonido entró de verdad, no solo el track.",
      "El show del prototipo es una reencarnación 2D propia del show del juego, no el motor real (PixiJS): lo que se mide es el costo de re-dibujar y codificar el plan de una ronda, no la fidelidad del juego.",
    ],
  };
}
