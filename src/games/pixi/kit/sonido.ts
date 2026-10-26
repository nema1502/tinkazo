import { acotar } from "./azar";

/**
 * La paleta de sonido del kit, sobre los osciladores de siempre (`src/sound.ts`).
 *
 * Diez juegos escribían sus `beep(note(…))` a mano, entre quince y treinta y
 * siete llamadas cada uno, y el sonido se degradó durante meses sin que nada
 * fallara (golpes a 70 Hz que un proyector no reproduce, notas fuera de la
 * escala, un volumen por debajo del murmullo de la sala). Las reglas de
 * `audit-sound` quedan acá, en la firma:
 *
 * - **Grados de 0 a 20.** La pentatónica de `note()`: de 131 a 2.093 Hz, que es
 *   lo que reproduce el parlante de un proyector; el 21 ya pasa de 2.150.
 * - **Volumen por categoría.** Fondo (los clics, el reparto) de 0,02 a 0,03;
 *   evento (una respuesta, un tic) de 0,04 a 0,06; clímax (el golpe) de 0,08 a
 *   0,12. Nada por debajo de 0,019: queda bajo el murmullo de cincuenta personas.
 * - **Sin redisparos.** `una(clave)` deja pasar solo la primera vez.
 *
 * No sabe de la página: el anfitrión le enchufa una `Voz`. Puro, sin DOM.
 */
export type Categoria = "fondo" | "evento" | "climax";
export type Timbre = "triangle" | "sine" | "square" | "sawtooth";

export const GRADO_MIN = 0;
export const GRADO_MAX = 20;
/** El registro que reproduce el parlante de un proyector o de una sala chica. */
export const HZ_MIN = 128;
export const HZ_MAX = 2150;
/** Por debajo de esto queda bajo el murmullo de cincuenta personas. */
export const VOL_MIN = 0.019;
export const VOL_MAX = 0.12;

export const VOLUMEN: Readonly<Record<Categoria, readonly [number, number]>> = {
  fondo: [0.02, 0.03],
  evento: [0.04, 0.06],
  climax: [0.08, 0.12],
};

/** Cuánto dura una nota de cada categoría si no se pide otra cosa, en segundos reales. */
export const DURACION: Readonly<Record<Categoria, number>> = { fondo: 0.05, evento: 0.12, climax: 0.6 };

/** Lo que el anfitrión enchufa: cómo suena una nota en esta página. */
export interface Voz {
  tono(hz: number, dur: number, timbre: Timbre, vol: number): void;
  /** La frecuencia del grado de la escala. */
  nota(grado: number): number;
  /** El remate de los carteles: cuerpo, acorde y arpegio. */
  fanfarria(): void;
  /** Algo dentro de `ms` milisegundos reales. */
  despues(ms: number, fn: () => void): void;
}

export interface OpcionesTono {
  dur?: number;
  timbre?: Timbre;
  vol?: number;
}

export interface Sonido {
  /** Una nota de la escala, en una categoría de volumen. Nunca suena fuera de la escala ni del registro. */
  tono(grado: number, cat: Categoria, o?: OpcionesTono): void;
  /** Corre `fn` solo la primera vez que se la pide con esa clave. Devuelve si corrió. */
  una(clave: string, fn: () => void): boolean;
  /** El tic de un reloj de cocina: dos notas que se alternan. `k` es el número de tic. */
  tic(k: number): void;
  /** El latido de la carta o del puntero: una nota arriba y una abajo. */
  latido(): void;
  /** Una escalerita de notas chicas, una cada `pasoMs`. */
  escalera(grados: readonly number[], pasoMs?: number): void;
  /** El remate de quien gana: cuerpo grave, fanfarria y un adorno a +520 ms. */
  fanfarria(): void;
  /** Alguien sale: el mismo gesto suave en todos los juegos, sin sonido de fracaso. */
  salida(): void;
  /** Cuánto va de un tramo, de 0 a 1, en segundos de juego. */
  fase(t: number, desde: number, hasta: number): number;
  /** Algo dentro de `ms` milisegundos reales: la segunda nota de un acorde que se arma de a poco. */
  despues(ms: number, fn: () => void): void;
}

/** Lo que está mal en un tono pedido, para las pruebas de cada juego. Vacío si cumple las reglas. */
export function problemasDeTono(grado: number, cat: Categoria, o: OpcionesTono = {}): string[] {
  const p: string[] = [];
  if (!Number.isInteger(grado) || grado < GRADO_MIN || grado > GRADO_MAX) p.push(`el grado ${grado} está fuera de ${GRADO_MIN} a ${GRADO_MAX}`);
  const [lo, hi] = VOLUMEN[cat];
  if (o.vol !== undefined) {
    if (o.vol < lo - 1e-9 || o.vol > hi + 1e-9) p.push(`el volumen ${o.vol} no es de ${cat} (${lo} a ${hi})`);
    if (o.vol < VOL_MIN) p.push(`el volumen ${o.vol} queda bajo el murmullo de la sala`);
  }
  if (o.dur !== undefined && !(o.dur > 0)) p.push("la duración tiene que ser mayor que cero");
  return p;
}

export function crearSonido(voz: Voz): Sonido {
  const usadas = new Set<string>();

  const tono = (grado: number, cat: Categoria, o: OpcionesTono = {}): void => {
    const g = acotar(Math.round(grado), GRADO_MIN, GRADO_MAX);
    const [lo, hi] = VOLUMEN[cat];
    // Sin volumen pedido, el medio de la categoría; con uno, el que pidió, sin salir de lo audible.
    const vol = o.vol !== undefined ? acotar(o.vol, VOL_MIN, VOL_MAX) : (lo + hi) / 2;
    voz.tono(voz.nota(g), o.dur ?? DURACION[cat], o.timbre ?? "triangle", vol);
  };

  return {
    tono,
    una(clave, fn) {
      if (usadas.has(clave)) return false;
      usadas.add(clave);
      fn();
      return true;
    },
    tic: (k) => tono(k % 2 ? 10 : 12, "evento", { dur: 0.05, vol: 0.05 }),
    latido() {
      tono(5, "evento", { dur: 0.09, vol: 0.045 });
      tono(0, "evento", { dur: 0.12, vol: 0.035 });
    },
    escalera(grados, pasoMs = 70) {
      grados.forEach((g, i) => voz.despues(i * pasoMs, () => tono(g, "fondo", { dur: 0.04, timbre: "square", vol: 0.025 })));
    },
    fanfarria() {
      tono(0, "climax", { dur: 0.7, timbre: "sine", vol: 0.09 });
      voz.fanfarria();
      voz.despues(520, () => tono(17, "evento", { dur: 0.12, vol: 0.045 }));
    },
    salida: () => tono(9, "evento", { dur: 0.08, vol: 0.04 }),
    despues: (ms, fn) => voz.despues(ms, fn),
    fase: (t, desde, hasta) => (hasta <= desde ? (t >= desde ? 1 : 0) : acotar((t - desde) / (hasta - desde), 0, 1)),
  };
}
