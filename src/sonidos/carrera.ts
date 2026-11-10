/**
 * El sonido de la carrera de llamas: seis piezas, tres candidatas cada una.
 *
 * Sale de la sección 8 de la dirección de la carrera (6 de noviembre de 2026): una carrera de pueblo en el
 * altiplano con una banda chica (charango rasgueado, bombo, zampoña y la gente). Nada de hipódromo, nada de
 * animales que hablan, nada de campanas (suenan a casino). Nadie elige un sonido sin escucharlo: este archivo
 * define las candidatas para que se escuchen en la página de escucha (`scripts/sonidos/carrera-armar-escucha.mjs`)
 * y se elija con los oídos y el parlante del stand. Mientras no se elija, en el sitio suena lo de hoy.
 *
 * Este módulo es puro: describe cada candidata como datos y sabe juzgar si cumple las metas que se miden sin
 * oídos (escala, registro, volumen, silencio, una sola fanfarria). No toca el audio. Lo que las hace sonar vive
 * en `carrera-voz.ts` (que usa los instrumentos de `src/music.ts` y las notas de `src/sound.ts`, el mismo motor
 * de hoy) y lo que las mide, en `scripts/sonidos/`.
 *
 * Qué elige cada pieza (`carrera-eleccion.ts`):
 * - `hoy`: lo que suena hoy, sin tocar nada.
 * - `a`, `b`, `c`: una candidata.
 * - `base`: lo de hoy con el arreglo de la mezcla (el silencio antes del golpe y el ritmo nuevo), que es lo que
 *   va si se elige "ninguno": la música a 100/112/124 golpes por minuto y el golpe con su silencio.
 */

import { NIVELES } from "./carrera-niveles";

export type Pieza = "musica" | "pasos" | "echarse" | "obstaculos" | "final" | "festejo";

export const PIEZAS: readonly Pieza[] = ["musica", "pasos", "echarse", "obstaculos", "final", "festejo"];

/** Lo que se puede elegir en cada pieza. */
export type Eleccion = "hoy" | "base" | "a" | "b" | "c";

/** Las metas medibles de la sección 8 de la dirección, y las que salen de ellas. */
export const METAS = {
  /** Sonoridad del show, en LUFS, con 2 de margen: un parlante de proyector es débil. */
  sonoridad: -18,
  margenSonoridad: 2,
  /** Lo que se pierde, en LU, si el parlante corta los graves en 150 y en 300 Hz. */
  perdida150: 3,
  perdida300: 6,
  /** Pico real, en dBTP. */
  picoReal: -1,
  /** Música: golpes por minuto en la largada, en el grupo y en la recta. */
  bpm: [100, 112, 124] as const,
  /** El golpe suena de 6 a 10 LU más fuerte que la música de la recta. */
  golpeSobreRecta: [6, 10] as const,
  /** El silencio entre el clic y el golpe: 0,4 s como mínimo, con 0,05 de margen, todo bajo −50 dB. */
  silencioS: 0.4,
  silencioDb: -50,
  /** Lo que hay que oír está entre 250 Hz y 4 kHz. */
  registroMedio: [250, 4000] as const,
  /** Lo que reproduce el parlante de un proyector (las reglas de `audit-sound`). */
  hz: [128, 2150] as const,
  /** Por debajo de esto queda bajo el murmullo de la sala. */
  volumenMin: 0.019,
  volumenMax: 1,
  /** El festejo dura de 2 a 3 s. */
  festejoS: [2, 3] as const,
  /** Efectos por segundo, como mucho. */
  densidad: 4,
} as const;

/**
 * Una curva para el techo suave de la música: deja pasar igual todo lo que está por debajo de k y redondea lo que queda entre k y 1
 * hasta un techo de (1 + k) / 2 (con k = 0,72, 0,86, que son −1,3 dBFS). Lo que pasa de 1 queda en el techo.
 */
export function curvaDeTecho(k: number): Float32Array<ArrayBuffer> {
  const n = 4097;
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    const a = Math.abs(x);
    const u = Math.max(0, (a - k) / (1 - k));
    c[i] = Math.sign(x) * (a <= k ? a : k + (1 - k) * (u - (u * u) / 2));
  }
  return c;
}

/* ------------------------------------------------------------------ las voces */

export type Evento = "pulso" | "clic" | "corte" | "golpe" | "festejo";

interface Base {
  /** Segundos desde el comienzo de la pieza. */
  t: number;
  /** Para qué sirve en la pieza `final` y `festejo`: las pruebas cuentan los golpes. */
  ev?: Evento;
}

/** Una nota de oscilador de la escala de los efectos (`note()` de `src/sound.ts`): grado de 0 a 20. */
export interface Nota extends Base {
  k: "nota";
  grado: number;
  dur: number;
  tipo: "sine" | "triangle" | "square" | "sawtooth";
  g: number;
  /** Baja el tono hasta esta fracción de la nota a lo largo de la nota. */
  cae?: number;
  /** Pasa por el bus de la banda (con su compresor, su limitador y su techo) y no por la cadena de los efectos: para las notas que suenan con la banda en un golpe fuerte. */
  banda?: true;
}

/** Un soplo de ruido filtrado: el crujido de una piedra, el viento, el roce de una almohadilla. Sin altura. */
export interface Ruido extends Base {
  k: "ruido";
  dur: number;
  filtro: "lowpass" | "highpass" | "bandpass";
  hz: number;
  /** Si está, el filtro se corre de `hz` a `hz1` a lo largo del soplo. */
  hz1?: number;
  q?: number;
  g: number;
  /** Segundos que tarda en subir. */
  atk?: number;
}

/** El bombo legüero de la banda (`bombo` de `src/music.ts`). */
export interface Bombo extends Base {
  k: "bombo";
  v: number;
}

/** Los acordes de la banda: pentatónicos, con solo notas de la escala. */
export type AcordeId = "AM" | "C" | "G" | "EM";

/** Un rasgueo de charango. */
export interface Charango extends Base {
  k: "charango";
  acorde: AcordeId;
  abajo: boolean;
  v: number;
}

/** Una nota de zampoña. `grado` cuenta en la pentatónica de la menor desde el la de 440 Hz (`deg` de la música). */
export interface Zampona extends Base {
  k: "zampona";
  grado: number;
  dur: number;
  pan: number;
  v: number;
}

/** Palmas: una fila de manos. */
export interface Palmas extends Base {
  k: "palmas";
  v: number;
}

/** El bombo seco del beat electrónico (`kick` de `src/music.ts`). */
export interface Kick extends Base {
  k: "kick";
}

/** El platillo del remate (`crash` de `src/music.ts`). */
export interface Crash extends Base {
  k: "crash";
  v: number;
}

/** Corta a la banda en seco (25 ms), como el corte de la chovena: el silencio de antes del golpe. */
export interface Corte extends Base {
  k: "corte";
}

/** Vuelve a abrir a la banda: el golpe. */
export interface Abre extends Base {
  k: "abre";
}

export type Golpe = Nota | Ruido | Bombo | Charango | Zampona | Palmas | Kick | Crash | Corte | Abre;

/** Los instrumentos de la banda pasan por el bus de la música; la nota y el ruido, por la cadena de los efectos. */
export const esDeBanda = (g: Golpe): boolean => g.k !== "nota" && g.k !== "ruido";

/* ----------------------------------------------------------------- la música */

/** Lo que cambia entre una música y otra: el ritmo, qué capas hay y cuánto suena cada una. */
export interface PerfilMusica {
  /** Golpes por minuto en la largada, en el grupo y en la recta. */
  bpm: readonly [number, number, number];
  /** A qué tensión pasa al segundo y al tercer ritmo. */
  umbrales: readonly [number, number];
  /** Cuánto suena cada capa, de 0 (no suena) a 1,5. */
  capas: {
    bombo: number;
    bajo: number;
    charango: number;
    zampona: number;
    caja: number;
    palmas: number;
  };
  /** Cómo rasguea el charango. */
  charango: "huayno" | "pulso" | "esparcido";
  /** Desde qué tensión entra la zampoña. */
  zamponaDesde: number;
  /** Cuánto se sube el bus de la música para llegar a −18 LUFS: sale de medir cada candidata. */
  trim: number;
  /** Las vueltas de acordes (pentatónicas) entre las que elige la semilla. */
  vueltas: readonly (readonly AcordeId[])[];
  /** Es el arreglo de hoy con el ritmo nuevo y el volumen ajustado, no uno propio: lo toca el `playStep` de siempre. */
  legado?: true;
}

/** La vara de la música de la banda: dos compases de ocho semicorcheas, cuatro vueltas de acordes. */
export const VUELTAS_PENTATONICAS: readonly (readonly AcordeId[])[] = [
  ["AM", "AM", "C", "G", "AM", "G", "EM", "AM"],
  ["AM", "C", "G", "AM", "AM", "C", "EM", "AM"],
  ["AM", "AM", "G", "C", "AM", "EM", "G", "AM"],
  ["C", "G", "AM", "AM", "C", "G", "EM", "AM"],
];

/** Los acordes de la banda, en semitonos desde el la de 440 Hz. Todas las cuerdas son de la pentatónica de la menor. */
export const ACORDES: Readonly<Record<AcordeId, { raiz: number; cuerdas: readonly number[] }>> = {
  AM: { raiz: -36, cuerdas: [-5, 0, 3, 7, 12] },
  C: { raiz: -33, cuerdas: [-5, 0, 3, 7, 10] },
  // El sol de la banda es un sol con re y mi, sin el si: así cada cuerda es de la escala de los efectos.
  G: { raiz: -38, cuerdas: [-2, 5, 7, 10, 15] },
  // Y el mi menor, sin el si: mi, sol, re.
  EM: { raiz: -29, cuerdas: [-5, -2, 5, 7, 10] },
};

/** La pentatónica de la menor, en semitonos desde el la. */
export const PENTA_LA = [0, 3, 5, 7, 10] as const;

/** Un grado de la pentatónica de la menor desde el la de 440, subiendo de a octavas (`deg` de `src/music.ts`). */
export const semitonosDeGrado = (d: number): number => (PENTA_LA[((d % 5) + 5) % 5] as number) + 12 * Math.floor(d / 5);

/** La nota de la escala de los efectos (`note` de `src/sound.ts`): do pentatónico desde 130,81 Hz. */
export function hzDeGrado(degree: number): number {
  const escala = [0, 2, 4, 7, 9];
  const d = Math.max(0, Math.round(degree));
  return 130.81 * Math.pow(2, ((escala[d % 5] ?? 0) + 12 * Math.floor(d / 5)) / 12);
}

/** Los hercios de un semitono desde el la de 440. */
export const hzDeSemitono = (s: number): number => 440 * Math.pow(2, s / 12);

/** `true` si el semitono (desde el la) es una nota de la pentatónica de la menor, que es la de do mayor de los efectos. */
export const enLaEscala = (semitonosDesdeLa: number): boolean => (PENTA_LA as readonly number[]).includes((((Math.round(semitonosDesdeLa) % 12) + 12) % 12));

/**
 * Lo que va si se elige "ninguno" en la música: la de hoy, con el ritmo nuevo (100, 112 y 124 golpes por minuto)
 * y el volumen que lleva el show a −18 LUFS. Es el arreglo de siempre (sus acordes y sus capas), no uno nuevo.
 */
export const PERFIL_BASE: PerfilMusica = {
  bpm: METAS.bpm,
  umbrales: [0.3, 0.62],
  capas: { bombo: 1, bajo: 1, charango: 1, zampona: 1, caja: 0, palmas: 0 },
  charango: "huayno",
  zamponaDesde: 0.6,
  trim: NIVELES["musica/base"]?.trim ?? 2.3,
  vueltas: [],
  legado: true,
};

/* ---------------------------------------------------------- las candidatas */

interface CandidataBase {
  pieza: Pieza;
  id: "a" | "b" | "c" | "base";
  /** Cómo se llama en la página de escucha. */
  nombre: string;
  /** Cómo suena, en palabras. */
  caracter: string;
}

export interface CandidataMusica extends CandidataBase {
  pieza: "musica";
  perfil: PerfilMusica;
}

/** Una pieza de efecto: una o varias variantes (los dos pies, los tres obstáculos), cada una una lista de voces. */
export interface CandidataEfecto extends CandidataBase {
  pieza: Exclude<Pieza, "musica">;
  variantes: readonly (readonly Golpe[])[];
  /** Cuánto se sube el bus de la banda (bombo, charango, zampoña, palmas) de esta pieza; 1 si no se dice. Sale de medir cada candidata (`carrera-niveles.ts`). */
  trim?: number;
  /** Por cuánto se multiplica el volumen de las notas y los soplos de la pieza; 1 si no se dice. Sale de medir cada candidata (`carrera-niveles.ts`). */
  nivel?: number;
  /** Nombre de cada variante, si no es solo una. */
  etiquetas?: readonly string[];
}

export type Candidata = CandidataMusica | CandidataEfecto;

const n = (t: number, grado: number, dur: number, tipo: Nota["tipo"], g: number, cae?: number): Nota => ({ k: "nota", t, grado, dur, tipo, g, ...(cae === undefined ? {} : { cae }) });
const r = (t: number, filtro: Ruido["filtro"], hz: number, dur: number, g: number, o: { hz1?: number; q?: number; atk?: number } = {}): Ruido => ({ k: "ruido", t, filtro, hz, dur, g, ...o });
const bombo = (t: number, v: number, ev?: Evento): Bombo => ({ k: "bombo", t, v, ...(ev ? { ev } : {}) });
const charango = (t: number, acorde: AcordeId, abajo: boolean, v: number, ev?: Evento): Charango => ({ k: "charango", t, acorde, abajo, v, ...(ev ? { ev } : {}) });
const zampona = (t: number, grado: number, dur: number, pan: number, v: number, ev?: Evento): Zampona => ({ k: "zampona", t, grado, dur, pan, v, ...(ev ? { ev } : {}) });
const palmas = (t: number, v: number, ev?: Evento): Palmas => ({ k: "palmas", t, v, ...(ev ? { ev } : {}) });

/* 1. La música ------------------------------------------------------------ */

const musica: CandidataMusica[] = [
  {
    pieza: "musica",
    id: "a",
    nombre: "Huayno de charango",
    caracter: "Charango rasgueado al frente, bombo y bajo; la zampoña contesta al final. Cálida, de fiesta de pueblo.",
    perfil: {
      bpm: METAS.bpm,
      umbrales: [0.3, 0.62],
      capas: { bombo: 0.8, bajo: 1, charango: 1, zampona: 0.7, caja: 0, palmas: 0.5 },
      charango: "huayno",
      zamponaDesde: 0.6,
      trim: 2.4,
      vueltas: VUELTAS_PENTATONICAS,
    },
  },
  {
    pieza: "musica",
    id: "b",
    nombre: "Sikuris",
    caracter: "La zampoña lleva la melodía desde el principio, dos filas que se contestan; bombo parejo y el charango apenas.",
    perfil: {
      bpm: METAS.bpm,
      umbrales: [0.3, 0.62],
      capas: { bombo: 0.65, bajo: 0.7, charango: 0.35, zampona: 1, caja: 0, palmas: 0 },
      charango: "esparcido",
      zamponaDesde: 0.2,
      trim: 2.6,
      vueltas: VUELTAS_PENTATONICAS,
    },
  },
  {
    pieza: "musica",
    id: "c",
    nombre: "Bombo y caja de comparsa",
    caracter: "Marcha de percusión: bombo con síncopa, caja y palmas; el charango marca el pulso y la zampoña asoma recién en la recta.",
    perfil: {
      bpm: METAS.bpm,
      umbrales: [0.3, 0.62],
      capas: { bombo: 0.8, bajo: 0.5, charango: 0.8, zampona: 0.5, caja: 1, palmas: 1 },
      charango: "pulso",
      zamponaDesde: 0.75,
      trim: 2.2,
      vueltas: VUELTAS_PENTATONICAS,
    },
  },
];

/* 2. Los pasos ------------------------------------------------------------ */
// Una almohadilla, no un casco: golpes suaves y sordos en la tierra, más sentidos que oídos. Cada candidata trae
// dos variantes (pie izquierdo y derecho) que se alternan, una cada medio segundo.

const pasos: CandidataEfecto[] = [
  {
    pieza: "pasos",
    id: "a",
    nombre: "Almohadilla",
    caracter: "Grave y seco: un golpe sordo y corto, de cuerpo, como una pata acolchada sobre tierra firme.",
    variantes: [
      [n(0, 5, 0.075, "triangle", 0.028, 0.62), r(0, "lowpass", 900, 0.06, 0.07)],
      [n(0, 3, 0.075, "triangle", 0.026, 0.78), r(0, "lowpass", 750, 0.06, 0.06)],
    ],
  },
  {
    pieza: "pasos",
    id: "b",
    nombre: "Madera",
    caracter: "Un toque de madera hueca, claro y breve, como pasos sobre tablas; alterna dos alturas.",
    variantes: [
      [n(0, 10, 0.05, "sine", 0.03), r(0, "bandpass", 1900, 0.03, 0.07, { q: 5 })],
      [n(0, 8, 0.05, "sine", 0.028), r(0, "bandpass", 1500, 0.03, 0.06, { q: 5 })],
    ],
  },
  {
    pieza: "pasos",
    id: "c",
    nombre: "Tierra",
    caracter: "Sordo y esparcido, como pisar tierra seca: casi puro polvo, con una nota de fondo que da el paso.",
    variantes: [
      [r(0, "bandpass", 520, 0.11, 0.1, { hz1: 330, q: 0.9, atk: 0.012 }), n(0, 4, 0.07, "triangle", 0.022)],
      [r(0, "bandpass", 460, 0.11, 0.09, { hz1: 300, q: 0.9, atk: 0.012 }), n(0, 2, 0.07, "triangle", 0.022)],
    ],
  },
];

/* 3. Echarse -------------------------------------------------------------- */
// Dos notas que bajan, en madera: se acuesta, no perdió.

const echarse: CandidataEfecto[] = [
  {
    pieza: "echarse",
    id: "a",
    nombre: "Marimba",
    caracter: "Madera cálida: dos notas redondas que bajan, con un toque de madera al empezar cada una.",
    variantes: [
      [
        n(0, 9, 0.3, "sine", 0.05),
        n(0, 14, 0.12, "sine", 0.02),
        r(0, "bandpass", 1800, 0.02, 0.05, { q: 3 }),
        n(0.17, 7, 0.34, "sine", 0.045),
        n(0.17, 12, 0.12, "sine", 0.02),
        r(0.17, "bandpass", 1600, 0.02, 0.045, { q: 3 }),
      ],
    ],
  },
  {
    pieza: "echarse",
    id: "b",
    nombre: "Tronco hueco",
    caracter: "Tambor de madera: dos golpes huecos que caen de tono, secos y sin brillo.",
    variantes: [
      [n(0, 5, 0.22, "triangle", 0.06, 0.78), r(0, "lowpass", 1200, 0.04, 0.06), n(0.2, 3, 0.26, "triangle", 0.05, 0.8), r(0.2, "lowpass", 1100, 0.04, 0.05)],
    ],
  },
  {
    pieza: "echarse",
    id: "c",
    nombre: "Caña",
    caracter: "Dos notas de zampoña suaves que bajan, con aire; la llama se acuesta con un suspiro de caña.",
    variantes: [[zampona(0, 8, 0.32, -0.2, 0.6), zampona(0.2, 6, 0.42, 0.2, 0.55)]],
  },
];

/* 4. Los obstáculos ------------------------------------------------------- */
// Piedras: un golpe grave con un crujido que se oiga en un parlante chico. Viento: un soplido de 1,5 s. Valla: un
// toque de madera. Cada candidata trae las tres, en este orden.

const ETIQUETAS_OBSTACULOS = ["piedras", "viento", "valla"] as const;

const obstaculos: CandidataEfecto[] = [
  {
    pieza: "obstaculos",
    id: "a",
    nombre: "Piedra y madera",
    caracter: "Las piedras caen con un golpe sordo y se desgranan; el viento es un soplo ancho; la valla, un toque de madera clara.",
    etiquetas: ETIQUETAS_OBSTACULOS,
    variantes: [
      [n(0, 5, 0.38, "triangle", 0.07, 0.6), r(0, "bandpass", 1100, 0.22, 0.16, { q: 0.7, atk: 0.004 }), r(0.09, "bandpass", 1700, 0.14, 0.11, { q: 1, atk: 0.004 })],
      [r(0, "bandpass", 350, 1.5, 0.2, { hz1: 1300, q: 0.9, atk: 0.5 })],
      [n(0, 10, 0.09, "sine", 0.06), r(0, "bandpass", 2200, 0.025, 0.09, { q: 4 })],
    ],
  },
  {
    pieza: "obstaculos",
    id: "b",
    nombre: "Tambor y soplo",
    caracter: "Las piedras suenan a bombo con un crujido encima; el viento es un soplo de zampoña; la valla, un toque de cuero.",
    etiquetas: ETIQUETAS_OBSTACULOS,
    variantes: [
      [bombo(0, 0.8), r(0, "bandpass", 1400, 0.2, 0.1, { q: 0.8, atk: 0.004 })],
      [zampona(0, 3, 1.5, 0, 0.5), r(0, "bandpass", 500, 1.5, 0.12, { hz1: 900, q: 1, atk: 0.6 })],
      [bombo(0, 0.35), n(0, 8, 0.07, "sine", 0.05)],
    ],
  },
  {
    pieza: "obstaculos",
    id: "c",
    nombre: "Madera seca",
    caracter: "Todo de madera dura y seca: dos golpes de tronco para las piedras, un soplo corto y angosto, un clac de caña para la valla.",
    etiquetas: ETIQUETAS_OBSTACULOS,
    variantes: [
      [n(0, 6, 0.1, "triangle", 0.09, 0.6), n(0.1, 5, 0.12, "triangle", 0.08, 0.6), r(0, "bandpass", 1300, 0.18, 0.1, { q: 0.9, atk: 0.003 })],
      [r(0, "bandpass", 600, 1.5, 0.16, { hz1: 1100, q: 1.6, atk: 0.4 })],
      [n(0, 12, 0.06, "sine", 0.06), r(0, "bandpass", 2600, 0.02, 0.1, { q: 5 })],
    ],
  },
];

/* 5. El final ------------------------------------------------------------- */
// Desde 3 s antes del cruce: el bombo al pulso de la recta, cada vez más fuerte; el clic de la foto en el cruce
// (T = 3,0 s); el silencio hasta el golpe (T + 1,0 s); y el golpe, una sola vez: un acorde de la banda.

const T_FINAL = 3;
const T_GOLPE = 4;
/** El pulso de la recta, 124 golpes por minuto. */
const PULSO = 60 / 124;
const V_PULSOS = [0.45, 0.52, 0.6, 0.7, 0.82, 0.95, 1.1];
const pulsosDeBombo = (extra: (t: number, i: number) => Golpe[] = () => []): Golpe[] =>
  V_PULSOS.flatMap((v, i) => [bombo(i * PULSO, v, "pulso"), ...extra(i * PULSO, i)]);

const final: CandidataEfecto[] = [
  {
    pieza: "final",
    id: "a",
    nombre: "Bombo grave",
    caracter: "Un bombo solo que crece, un clic seco de máquina de fotos, el silencio, y un golpe de bombo con charango y dos cañas largas.",
    variantes: [
      [
        ...pulsosDeBombo(),
        { ...r(T_FINAL, "highpass", 3500, 0.012, 0.22), ev: "clic" },
        { ...r(T_FINAL + 0.014, "highpass", 3200, 0.012, 0.16), ev: "clic" },
        { k: "corte", t: T_FINAL + 0.01, ev: "corte" },
        { k: "abre", t: T_GOLPE, ev: "golpe" },
        bombo(T_GOLPE, 1.35, "golpe"),
        charango(T_GOLPE, "AM", true, 0.9, "golpe"),
        zampona(T_GOLPE, 5, 1.4, -0.2, 1, "golpe"),
        zampona(T_GOLPE, 10, 1.4, 0.2, 0.5, "golpe"),
      ],
    ],
  },
  {
    pieza: "final",
    id: "b",
    nombre: "Bombo y charango",
    caracter: "Bombo con un toque de madera a contratiempo, un clic de madera, el silencio, y el golpe: bombo con dos rasgueos de charango.",
    variantes: [
      [
        ...pulsosDeBombo((t, i) => (i % 2 === 1 ? [r(t + PULSO / 2, "bandpass", 2000, 0.025, 0.1 + 0.015 * i, { q: 4 })] : [])),
        { ...n(T_FINAL, 17, 0.045, "sine", 0.05), ev: "clic" },
        { ...r(T_FINAL, "bandpass", 2400, 0.015, 0.2, { q: 3 }), ev: "clic" },
        { k: "corte", t: T_FINAL + 0.01, ev: "corte" },
        { k: "abre", t: T_GOLPE, ev: "golpe" },
        bombo(T_GOLPE, 1.1, "golpe"),
        charango(T_GOLPE, "AM", true, 1.4, "golpe"),
        charango(T_GOLPE + 0.045, "AM", false, 1.2, "golpe"),
        charango(T_GOLPE + 0.09, "AM", true, 1.2, "golpe"),
      ],
    ],
  },
  {
    pieza: "final",
    id: "c",
    nombre: "Palmas y zampoña",
    caracter: "El bombo con palmas que lo acompañan, un clic suave, el silencio, y el golpe: tres cañas juntas, bombo y palmas.",
    variantes: [
      [
        ...pulsosDeBombo((t, i) => (i % 2 === 1 ? [palmas(t + PULSO / 2, 0.35 + 0.05 * i)] : [])),
        { ...r(T_FINAL, "bandpass", 3000, 0.03, 0.14, { q: 2 }), ev: "clic" },
        { k: "corte", t: T_FINAL + 0.01, ev: "corte" },
        { k: "abre", t: T_GOLPE, ev: "golpe" },
        bombo(T_GOLPE, 1.2, "golpe"),
        palmas(T_GOLPE, 1, "golpe"),
        zampona(T_GOLPE, 5, 1.5, -0.3, 0.9, "golpe"),
        zampona(T_GOLPE, 7, 1.5, 0, 0.7, "golpe"),
        zampona(T_GOLPE, 10, 1.5, 0.3, 0.6, "golpe"),
      ],
    ],
  },
];

/**
 * El golpe de hoy, escrito como datos y con el arreglo del parlante: el cuerpo grave y el acorde del golpe de hoy (bombo, platillo,
 * el beat electrónico), con la nota grave una octava arriba (130 Hz no sale por un proyector). Es el golpe de "ninguno" en el
 * final: el arpegio, el adorno y los rasgueos de hoy siguen siendo el festejo de hoy.
 */
const GOLPE_DE_HOY: Golpe[] = [
  { k: "abre", t: T_GOLPE, ev: "golpe" },
  { ...n(T_GOLPE, 5, 0.7, "sine", 0.09), banda: true, ev: "golpe" },
  { ...n(T_GOLPE, 5, 1.2, "triangle", 0.075), banda: true, ev: "golpe" },
  ...[10, 12, 13].map((d): Golpe => ({ ...n(T_GOLPE, d, 0.95, "triangle", 0.042), banda: true, ev: "golpe" })),
  bombo(T_GOLPE, 1.2, "golpe"),
  { k: "kick", t: T_GOLPE, ev: "golpe" },
  { k: "crash", t: T_GOLPE, v: 1, ev: "golpe" },
];

/** El final de "ninguno": el bombo que crece, el clic y el silencio de la candidata a, y el golpe de hoy con el arreglo del parlante. */
export const FINAL_BASE: CandidataEfecto = (() => {
  const a = final[0] as CandidataEfecto;
  const nv = NIVELES["final/base"];
  return {
    pieza: "final",
    id: "base",
    nombre: "Ninguno, con el silencio",
    caracter: "El bombo que crece, el clic y el silencio de antes del golpe, y después el golpe de hoy con la nota grave una octava arriba. Es lo que va si ninguno convence.",
    variantes: [[...(a.variantes[0] as readonly Golpe[]).filter((g) => g.ev !== "golpe"), ...GOLPE_DE_HOY]],
    ...(nv?.trim !== undefined ? { trim: nv.trim } : {}),
    ...(nv?.nivel !== undefined ? { nivel: nv.nivel } : {}),
  };
})();

/* 6. El festejo ----------------------------------------------------------- */
// Empieza en el golpe (t = 0) y deja pasar un cuarto de segundo para no pisarlo; dura de 2 a 3 s; suena una sola vez.

const festejo: CandidataEfecto[] = [
  {
    pieza: "festejo",
    id: "a",
    nombre: "Charango en trémolo",
    caracter: "Catorce rasgueos que van y vienen cada vez más suaves, con una caña larga arriba. Alegre y cálido.",
    variantes: [
      [
        ...Array.from({ length: 14 }, (_, i) => charango(0.3 + i * 0.11, "AM", i % 2 === 0, Math.max(0.2, 0.7 - i * 0.035), "festejo")),
        zampona(0.35, 10, 2.3, 0, 0.6, "festejo"),
      ],
    ],
  },
  {
    pieza: "festejo",
    id: "b",
    nombre: "Comparsa",
    caracter: "Palmas y bombo en el compás del huayno, tres vueltas: larga, corta, corta. Suena a gente.",
    variantes: [
      [
        ...[0, 1, 2].flatMap((v) => [
          palmas(0.3 + v * 0.62, 0.9, "festejo"),
          palmas(0.3 + v * 0.62 + 0.31, 0.6, "festejo"),
          palmas(0.3 + v * 0.62 + 0.465, 0.6, "festejo"),
          bombo(0.3 + v * 0.62, 0.9 - v * 0.1, "festejo"),
        ]),
        zampona(1.5, 8, 0.9, 0, 0.5, "festejo"),
      ],
    ],
  },
  {
    pieza: "festejo",
    id: "c",
    nombre: "Cañas en cascada",
    caracter: "Una subida de zampoña, nota por nota, que termina sostenida arriba, con un bombo al empezar.",
    variantes: [
      [
        bombo(0.3, 0.8, "festejo"),
        ...[5, 7, 8, 10, 11].map((g, i) => zampona(0.3 + i * 0.1, g, 0.35, i % 2 === 0 ? -0.4 : 0.4, 0.75, "festejo")),
        zampona(0.8, 10, 1.6, 0, 0.9, "festejo"),
        zampona(0.8, 7, 1.6, 0.2, 0.5, "festejo"),
      ],
    ],
  },
];

/** Les pone a las candidatas el volumen que salió de medirlas (`carrera-niveles.ts`). */
function conNiveles<T extends Candidata>(cs: readonly T[]): T[] {
  return cs.map((c) => {
    const n = NIVELES[`${c.pieza}/${c.id}`];
    if (!n) return c;
    if (c.pieza === "musica") return { ...c, perfil: { ...c.perfil, trim: n.trim ?? c.perfil.trim } };
    return { ...c, ...(n.trim !== undefined ? { trim: n.trim } : {}), ...(n.nivel !== undefined ? { nivel: n.nivel } : {}) };
  });
}

export const CANDIDATAS: Readonly<Record<Pieza, readonly Candidata[]>> = {
  musica: conNiveles(musica),
  pasos: conNiveles(pasos),
  echarse: conNiveles(echarse),
  obstaculos: conNiveles(obstaculos),
  final: conNiveles(final),
  festejo: conNiveles(festejo),
};

/** Lo que dice la página de escucha de cada pieza, y cuánto dura la demostración. */
export const DATOS_PIEZA: Readonly<Record<Pieza, { titulo: string; cuando: string; segundos: number }>> = {
  musica: { titulo: "La música", cuando: "Treinta segundos con los tres ritmos (100, 112 y 124 golpes por minuto) y, al final, el bombo solo.", segundos: 30 },
  pasos: { titulo: "Los pasos", cuando: "Mientras las llamas corren: un golpe suave cada medio segundo, que alterna los dos pies.", segundos: 6 },
  echarse: { titulo: "Echarse", cuando: "Cuando una llama se echa a descansar: dos notas que bajan. Se acuesta, no perdió. Se oye dos veces.", segundos: 4.5 },
  obstaculos: { titulo: "Los obstáculos", cuando: "Caen las piedras, sopla el viento, hay que saltar la valla (los tres seguidos).", segundos: 6 },
  final: { titulo: "El final", cuando: "Los últimos tres segundos: el bombo que crece, el clic de la foto, el silencio y el golpe del ganador.", segundos: 6 },
  festejo: { titulo: "El festejo", cuando: "Después del golpe, mientras la ganadora salta: de dos a tres segundos, una sola vez.", segundos: 3.2 },
};

/** Las variantes de `final`: el segundo en que cae cada cosa, para armar el video y las pruebas. */
export const TIEMPOS_FINAL = { inicio: 0, cruce: T_FINAL, golpe: T_GOLPE, pulso: PULSO } as const;

/** El instante de cada voz hasta el que se la oye, para saber cuándo termina la pieza. */
export function finDeVoz(g: Golpe): number {
  switch (g.k) {
    case "nota":
    case "ruido":
      return g.t + g.dur;
    case "zampona":
      return g.t + g.dur;
    case "bombo":
      return g.t + 0.4;
    case "charango":
      return g.t + 0.45;
    case "palmas":
      return g.t + 0.2;
    default:
      return g.t;
  }
}

const sonidos = (v: readonly Golpe[]): Golpe[] => v.filter((g) => g.k !== "corte" && g.k !== "abre");

/** Lo que está mal en una candidata, sin oídos. Vacío si cumple lo que se puede juzgar con los datos. */
export function problemasDeCandidata(c: Candidata): string[] {
  const p: string[] = [];
  if (c.pieza === "musica") {
    const m = c.perfil;
    if (m.bpm.join() !== METAS.bpm.join()) p.push(`el ritmo es ${m.bpm.join("/")} y tiene que ser ${METAS.bpm.join("/")}`);
    if (!(m.umbrales[0] > 0 && m.umbrales[0] < m.umbrales[1] && m.umbrales[1] < 1)) p.push("los umbrales de tensión no suben");
    for (const [capa, v] of Object.entries(m.capas)) if (!(v >= 0 && v <= 1.5)) p.push(`la capa ${capa} suena a ${v}`);
    if (!(m.capas.bombo > 0)) p.push("sin bombo no hay música de carrera");
    if (!(m.trim > 0.2 && m.trim < 8)) p.push(`el ajuste de volumen ${m.trim} es absurdo`);
    for (const v of m.vueltas) for (const a of v) for (const s of ACORDES[a].cuerdas) if (!enLaEscala(s)) p.push(`el acorde ${a} tiene una cuerda fuera de la escala (${s})`);
    for (const a of Object.values(ACORDES)) if (!enLaEscala(a.raiz)) p.push("la raíz de un acorde está fuera de la escala");
    return [...new Set(p)];
  }
  if (!c.variantes.length) p.push("no tiene ninguna variante");
  if (c.etiquetas && c.etiquetas.length !== c.variantes.length) p.push("las etiquetas no son una por variante");
  for (const [i, v] of c.variantes.entries()) {
    const donde = `${c.pieza}/${c.id}#${i}`;
    for (const g of v) {
      if (g.k === "nota") {
        const hz = hzDeGrado(g.grado);
        if (!Number.isInteger(g.grado) || g.grado < 0 || g.grado > 20) p.push(`${donde}: el grado ${g.grado} está fuera de 0 a 20`);
        else if (hz < METAS.hz[0] || hz > METAS.hz[1]) p.push(`${donde}: ${Math.round(hz)} Hz no sale por el parlante de un proyector`);
        const vol = g.g * (c.nivel ?? 1);
        if (vol < METAS.volumenMin || vol > METAS.volumenMax) p.push(`${donde}: el volumen ${vol.toFixed(3)} no está entre ${METAS.volumenMin} y ${METAS.volumenMax}`);
        if (g.dur < 0.04) p.push(`${donde}: una nota de ${Math.round(g.dur * 1000)} ms no tiene altura audible`);
        if (g.cae !== undefined && !(g.cae >= 0.3 && g.cae < 1)) p.push(`${donde}: la caída ${g.cae} no está entre 0,3 y 1`);
        // El tono que cae no puede irse por debajo de lo que el parlante deja pasar, o la nota se pierde.
        if (g.cae !== undefined && hz * g.cae < 150) p.push(`${donde}: la nota cae a ${Math.round(hz * g.cae)} Hz, por debajo del corte de 150 Hz`);
      } else if (g.k === "ruido") {
        if (g.hz < 250) p.push(`${donde}: un soplo centrado en ${g.hz} Hz se pierde en un parlante chico`);
        if (g.hz1 !== undefined && g.hz1 < 250) p.push(`${donde}: el soplo termina en ${g.hz1} Hz, por debajo de lo que se oye`);
        if (g.dur <= 0 || g.g <= 0) p.push(`${donde}: un soplo sin duración o sin volumen`);
        if (g.g * (c.nivel ?? 1) > 4) p.push(`${donde}: un soplo a ${(g.g * (c.nivel ?? 1)).toFixed(2)} se sale de la señal`);
      } else if (g.k === "zampona") {
        const hz = hzDeSemitono(semitonosDeGrado(g.grado));
        if (hz < 250 || hz > METAS.hz[1]) p.push(`${donde}: la caña de grado ${g.grado} suena a ${Math.round(hz)} Hz, fuera de 250 a 2.150`);
        if (!(g.pan >= -1 && g.pan <= 1)) p.push(`${donde}: panorama ${g.pan}`);
      } else if (g.k === "charango") {
        if (!ACORDES[g.acorde]) p.push(`${donde}: acorde ${g.acorde} desconocido`);
      }
      if ("v" in g && !(g.v > 0 && g.v <= 1.5)) p.push(`${donde}: volumen ${g.v} fuera de 0 a 1,5`);
      if (g.t < 0) p.push(`${donde}: una voz antes de empezar`);
    }
    for (const g of v) if (g.k === "charango") for (const s of ACORDES[g.acorde].cuerdas) if (!enLaEscala(s)) p.push(`${donde}: cuerda fuera de la escala`);
    if (c.pieza === "pasos") {
      // Una almohadilla, no un casco: nada que dure más de un décimo largo.
      const fin = Math.max(...v.map(finDeVoz));
      if (fin > 0.15) p.push(`${donde}: un paso que dura ${fin.toFixed(2)} s se pisa con el siguiente`);
    }
    if (c.pieza === "echarse") {
      const fin = Math.max(...v.map(finDeVoz));
      if (fin < 0.3 || fin > 0.8) p.push(`${donde}: echarse dura ${fin.toFixed(2)} s y tiene que ser de 0,3 a 0,8`);
      const alturas = v
        .flatMap((g) => (g.k === "nota" && g.g >= 0.04 ? [{ t: g.t, hz: hzDeGrado(g.grado) }] : g.k === "zampona" ? [{ t: g.t, hz: hzDeSemitono(semitonosDeGrado(g.grado)) }] : []))
        .sort((a, b) => a.t - b.t);
      for (let j = 1; j < alturas.length; j++) if ((alturas[j] as { hz: number }).hz >= (alturas[0] as { hz: number }).hz) p.push(`${donde}: la segunda nota no baja`);
    }
    if (c.pieza === "obstaculos") {
      const fin = Math.max(...v.map(finDeVoz));
      if (c.etiquetas?.[i] === "viento" && (fin < 1.4 || fin > 1.6)) p.push(`${donde}: el viento dura ${fin.toFixed(2)} s y tiene que ser de 1,5`);
      if (c.etiquetas?.[i] === "valla" && fin > 0.45) p.push(`${donde}: la valla dura ${fin.toFixed(2)} s`);
      if (c.etiquetas?.[i] === "piedras" && !v.some((g) => g.k === "ruido" || (g.k === "nota" && g.g >= 0.06) || g.k === "bombo")) p.push(`${donde}: las piedras no traen golpe ni crujido`);
    }
    if (c.pieza === "final") p.push(...problemasDelFinal(v, donde));
    if (c.pieza === "festejo") p.push(...problemasDelFestejo(v, donde));
  }
  return [...new Set(p)];
}

/** Cuántos grupos de instantes hay si los que están a menos de `hueco` segundos del anterior son el mismo. */
function gruposDeTiempo(ts: readonly number[], hueco: number): number {
  const o = [...ts].sort((a, b) => a - b);
  let grupos = 0;
  for (let i = 0; i < o.length; i++) if (i === 0 || (o[i] as number) - (o[i - 1] as number) > hueco) grupos++;
  return grupos;
}

function problemasDelFinal(v: readonly Golpe[], donde: string): string[] {
  const p: string[] = [];
  const pulsos = v.filter((g) => g.ev === "pulso");
  const clic = v.find((g) => g.ev === "clic");
  const corte = v.find((g) => g.k === "corte");
  const abre = v.find((g) => g.k === "abre");
  const golpes = gruposDeTiempo(v.filter((g) => g.ev === "golpe").map((g) => g.t), 0.3);
  if (pulsos.length < 5) p.push(`${donde}: el bombo del final tiene ${pulsos.length} golpes y tienen que ser 5 o más`);
  for (let i = 1; i < pulsos.length; i++) {
    const a = pulsos[i - 1] as Bombo, b = pulsos[i] as Bombo;
    if (!(b.v > a.v)) p.push(`${donde}: el bombo no crece en el golpe ${i + 1}`);
    if (Math.abs(b.t - a.t - PULSO) > PULSO * 0.03) p.push(`${donde}: el bombo no va al pulso de la recta (124 golpes por minuto)`);
  }
  if (!clic) p.push(`${donde}: falta el clic de la foto`);
  if (!corte) p.push(`${donde}: falta el corte de la banda antes del silencio`);
  if (!abre) p.push(`${donde}: falta la apertura del golpe`);
  if (clic && corte && abre) {
    const t0 = Math.min(...v.filter((g) => g.ev === "clic").map((g) => g.t));
    if (abre.t - t0 < 1 - 1e-9) p.push(`${donde}: del clic al golpe pasa ${(abre.t - t0).toFixed(2)} s y tienen que ser 1,0`);
    if (corte.t - t0 > 0.05 + 1e-9) p.push(`${donde}: la banda se corta a ${(corte.t - t0).toFixed(2)} s del clic y tiene que ser 0,05 o menos`);
    // Nada nuevo empieza entre el clic y el golpe: el silencio es silencio.
    const intruso = sonidos(v).filter((g) => g.ev !== "clic" && g.t > t0 + 0.05 && g.t < abre.t - 1e-9);
    if (intruso.length) p.push(`${donde}: ${intruso.length} voces suenan en el silencio de antes del golpe`);
    // Y lo que empezó antes no puede seguir sonando hasta ahí: la banda se corta, pero la nota y el ruido no.
    const colas = sonidos(v).filter((g) => (g.k === "nota" || g.k === "ruido") && g.t <= t0 + 0.05 && finDeVoz(g) > t0 + 0.05 + 1e-9 && g.ev !== "clic");
    if (colas.length) p.push(`${donde}: ${colas.length} voces siguen sonando después del clic`);
    const antes = pulsos.at(-1) as Bombo;
    if (antes.t > t0 - 0.05) p.push(`${donde}: el último bombo cae sobre el clic`);
  }
  if (golpes !== 1) p.push(`${donde}: hay ${golpes} golpes y tiene que haber uno solo`);
  const lejos = sonidos(v).filter((g) => g.ev === "golpe" && abre && Math.abs(g.t - abre.t) > 0.1);
  if (lejos.length) p.push(`${donde}: ${lejos.length} voces del golpe se separan más de 100 ms`);
  return p;
}

function problemasDelFestejo(v: readonly Golpe[], donde: string): string[] {
  const p: string[] = [];
  const fin = Math.max(...v.map(finDeVoz));
  if (fin < METAS.festejoS[0] || fin > METAS.festejoS[1]) p.push(`${donde}: el festejo dura ${fin.toFixed(2)} s y tiene que ser de ${METAS.festejoS[0]} a ${METAS.festejoS[1]}`);
  const antes = Math.min(...v.map((g) => g.t));
  if (antes < 0.25) p.push(`${donde}: el festejo empieza a ${antes.toFixed(2)} s del golpe y se lo pisa`);
  if (v.some((g) => g.ev !== "festejo")) p.push(`${donde}: una voz del festejo no está marcada`);
  return p;
}

/** Cuántos efectos suenan por segundo en la ventana más cargada de un segundo. */
export function densidadMaxima(v: readonly Golpe[]): number {
  // Las voces que arrancan a menos de 30 ms son un solo efecto: una nota con su soplo de ataque.
  const ts = sonidos(v).map((g) => g.t).sort((a, b) => a - b).filter((t, i, a) => i === 0 || t - (a[i - 1] as number) > 0.03);
  let max = 0;
  for (let i = 0; i < ts.length; i++) {
    let j = i;
    while (j < ts.length && (ts[j] as number) - (ts[i] as number) < 1) j++;
    max = Math.max(max, j - i);
  }
  return max;
}

/** Busca una candidata. */
export function candidataDe(pieza: Pieza, id: string): Candidata | undefined {
  if (pieza === "final" && id === "base") return FINAL_BASE;
  return CANDIDATAS[pieza].find((c) => c.id === id);
}

/** `true` si el texto de la dirección (`?sonido=`) o de la elección es una elección válida. */
export function esEleccion(x: string): x is Eleccion {
  return x === "hoy" || x === "base" || x === "a" || x === "b" || x === "c";
}
