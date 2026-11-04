import type { Game } from "../state";
import { ARCHIVOS, type Archivo } from "./archivos";
import { urlMusica } from "./musica-remota";

/**
 * El banco de sonidos de archivo.
 *
 * Los juegos suenan con osciladores (`src/sound.ts`) y ninguno dice qué está
 * pasando: dispara `beep(frecuencia, duración, onda, volumen)`. Este banco mira
 * esos cuatro datos (más el grado de la escala) y, si el disparo se parece a uno
 * que tiene un archivo, hace sonar el archivo en su lugar. Así los juegos no se
 * tocan: lo que cambia es lo que sale por el parlante.
 *
 * Tres capas, de lo más preciso a lo más general:
 *
 * 1. **Reglas del juego** (`JUEGOS_CON_BANCO`): un disparo con la firma de "el palo
 *    contra la piñata" suena como un palo contra una piñata. Una regla puede apagar
 *    los disparos vecinos que ya van dentro del archivo (la rotura de la piñata trae
 *    adentro la lluvia de caramelos).
 * 2. **El golpe** (`GOLPE`): todo remate grave y fuerte suena a impacto.
 * 3. **Las voces**: el resto de las notas suenan con un instrumento de verdad en vez
 *    de la onda de siempre (kalimba por el triángulo, madera por el cuadrado, campana
 *    por el seno, zampoña por el diente de sierra), afinado con la velocidad de
 *    reproducción para que la nota siga siendo la de la escala.
 *
 * Nada de esto usa el azar: la variante de un efecto sale de un contador que se
 * reinicia con cada sorteo, así que la misma ronda suena igual. Si el archivo no
 * llegó (sin red, ahorro de datos, aún bajando), `decidir` devuelve `null` y suena
 * el oscilador de siempre.
 */

export type Onda = "sine" | "square" | "sawtooth" | "triangle";

/** Lo que pidió el disparo. */
export interface Disparo {
  /** Frecuencia en hercios. */
  f: number;
  /** Duración pedida, en segundos reales. */
  d: number;
  tipo: Onda;
  /** Volumen del oscilador. */
  g: number;
}

/** Un rango cerrado. */
type Rango = readonly [number, number];

/** Cuándo un disparo se parece a otro. Lo que no se nombra, no se mira. */
export interface Firma {
  t?: readonly Onda[];
  g?: Rango;
  d?: Rango;
  /** Grado de la escala pentatónica de `note()`. */
  n?: Rango;
}

export interface Regla {
  /** Id del efecto: `juego/nombre` o `comun/nombre`. */
  usa: string;
  cuando: Firma;
  /** Volumen del archivo. */
  gan: number;
  /**
   * Si sigue el tono del disparo: la nota de referencia del archivo en hercios, o `true`
   * si el archivo tiene versiones grave y aguda (`-lo` y `-hi`) con su nota medida.
   */
  sigue?: number | true;
  /** Si el volumen sigue al del disparo: el volumen de referencia. */
  escala?: number;
  /** Disparos que ya van adentro del archivo, y durante cuánto no suenan. */
  apaga?: readonly { cuando: Firma; ms: number }[];
}

export interface Juego {
  /** Qué instrumento suena en lugar de cada onda cuando ninguna regla lo agarra. */
  voces?: Partial<Record<Onda, string>>;
  reglas: readonly Regla[];
  /** El efecto del ganador (`fanfare()`). */
  ganador: string;
  /** Viento y colibrí, para `wind()` y `hum()`. */
  viento?: string;
  colibri?: string;
}

/** Las voces de siempre: onda a instrumento. Cada una tiene un archivo grave (`-lo`) y uno agudo (`-hi`). */
export const VOCES: Record<Onda, { id: string; k: number; corta: number }> = {
  triangle: { id: "comun/kalimba", k: 5, corta: 0.14 },
  square: { id: "comun/madera", k: 7, corta: 0.09 },
  sine: { id: "comun/campana", k: 6, corta: 0.18 },
  sawtooth: { id: "comun/zampona", k: 5, corta: 0 },
};

/**
 * Los archivos se normalizan a la misma sonoridad (RMS de -18 dBFS en lo que suena). Un volumen de 1 en una regla
 * es "tan fuerte como el archivo": `K_EFECTO` lo baja al nivel de los osciladores de siempre.
 */
export const K_EFECTO = 0.4;

/** Todo remate grave y fuerte: un impacto. */
export const GOLPE: Regla = {
  usa: "comun/impacto",
  cuando: { t: ["sine", "triangle", "square"], g: [0.075, 0.12], d: [0.3, 0.8], n: [0, 2] },
  gan: 0.55,
  apaga: [{ cuando: { t: ["triangle", "sawtooth", "square"], g: [0.035, 0.07], d: [0.1, 0.7] }, ms: 150 }],
};

export const JUEGOS_CON_BANCO: Partial<Record<Game, Juego>> = {
  race: {
    ganador: "race/ganador",
    reglas: [
      { usa: "race/casco", cuando: { g: [0.02, 0.024], d: [0.04, 0.06] }, gan: 0.9 },
      { usa: "race/resoplido", cuando: { t: ["triangle"], g: [0.039, 0.046], d: [0.08, 0.105], n: [9, 9] }, gan: 0.8 },
      {
        usa: "race/redoble",
        cuando: { t: ["square"], g: [0.024, 0.026], d: [0.05, 0.07] },
        gan: 0.7,
        apaga: [{ cuando: { t: ["square"], g: [0.024, 0.026], d: [0.05, 0.07] }, ms: 450 }],
      },
      { usa: "race/tropiezo", cuando: { t: ["square"], g: [0.049, 0.051], d: [0.08, 0.1], n: [1, 1] }, gan: 0.8 },
    ],
  },
  sapo: {
    ganador: "sapo/ganador",
    reglas: [
      {
        usa: "sapo/boca",
        cuando: { t: ["triangle"], g: [0.075, 0.085], d: [0.4, 0.5] },
        gan: 0.9,
        apaga: [{ cuando: { g: [0.04, 0.065], d: [0.04, 0.55] }, ms: 120 }],
      },
      { usa: "sapo/ficha", cuando: { t: ["square"], g: [0.024, 0.052], d: [0.05, 0.09] }, gan: 0.7 },
    ],
  },
  trompo: {
    ganador: "trompo/ganador",
    reglas: [
      {
        usa: "trompo/choque",
        cuando: { t: ["square"], g: [0.054, 0.056], d: [0.049, 0.051], n: [14, 16] },
        gan: 0.9,
        apaga: [{ cuando: { t: ["sine", "triangle"], g: [0.04, 0.09], d: [0.1, 0.3] }, ms: 90 }],
      },
      {
        usa: "trompo/roce",
        cuando: { t: ["square"], g: [0.03, 0.045], d: [0.049, 0.051], n: [14, 16] },
        gan: 0.7,
        apaga: [{ cuando: { t: ["sine"], g: [0.04, 0.06], d: [0.1, 0.13] }, ms: 60 }],
      },
      { usa: "trompo/cae", cuando: { t: ["sine"], g: [0.049, 0.051], d: [0.17, 0.19] }, gan: 0.8 },
      { usa: "trompo/zumbido", cuando: { t: ["sawtooth"], g: [0.019, 0.021], d: [0.5, 1.1] }, gan: 0.5, sigue: 392 },
    ],
  },
  chovena: {
    ganador: "chovena/ganador",
    reglas: [
      { usa: "chovena/pisada", cuando: { t: ["sine"], g: [0.021, 0.023], d: [0.05, 0.07] }, gan: 0.8 },
      {
        usa: "chovena/corte",
        cuando: { t: ["square"], g: [0.049, 0.061], d: [0.075, 0.105], n: [14, 15] },
        gan: 0.9,
        apaga: [{ cuando: { t: ["sine"], g: [0.06, 0.08], d: [0.2, 0.3] }, ms: 120 }],
      },
    ],
  },
  pinata: {
    ganador: "pinata/ganador",
    reglas: [
      {
        usa: "pinata/rotura",
        cuando: { t: ["square"], g: [0.088, 0.092], d: [0.44, 0.46], n: [0, 0] },
        gan: 0.95,
        apaga: [{ cuando: { g: [0.025, 0.065], d: [0.025, 0.35] }, ms: 700 }],
      },
      {
        usa: "pinata/palo",
        cuando: { t: ["square"], g: [0.049, 0.075], d: [0.11, 0.13], n: [1, 3] },
        gan: 0.85,
        apaga: [{ cuando: { t: ["triangle"], g: [0.034, 0.04], d: [0.05, 0.07] }, ms: 100 }],
      },
      {
        usa: "pinata/caramelos",
        cuando: { t: ["triangle"], g: [0.027, 0.031], d: [0.025, 0.045] },
        gan: 0.6,
        apaga: [{ cuando: { t: ["triangle"], g: [0.027, 0.031], d: [0.025, 0.045] }, ms: 450 }],
      },
      {
        usa: "pinata/traqueteo",
        cuando: { t: ["square"], g: [0.024, 0.026], d: [0.035, 0.045] },
        gan: 0.6,
        apaga: [{ cuando: { t: ["square"], g: [0.024, 0.026], d: [0.035, 0.045] }, ms: 600 }],
      },
      { usa: "pinata/soga", cuando: { t: ["triangle"], g: [0.029, 0.031], d: [0.065, 0.075], n: [2, 5] }, gan: 0.6 },
    ],
  },
  wheel: {
    ganador: "wheel/ganador",
    reglas: [
      { usa: "wheel/clavija", cuando: { t: ["square"], g: [0.028, 0.065], d: [0.025, 0.065] }, gan: 0.8, escala: 0.045 },
      { usa: "wheel/tum", cuando: { t: ["sine"], g: [0.055, 0.085], d: [0.11, 0.31], n: [0, 0] }, gan: 0.8 },
    ],
  },
  teleferico: {
    ganador: "teleferico/ganador",
    reglas: [
      {
        usa: "teleferico/llegada",
        cuando: { t: ["sine"], g: [0.095, 0.105], d: [0.44, 0.46], n: [0, 0] },
        gan: 0.9,
        apaga: [{ cuando: { g: [0.04, 0.07], d: [0.05, 0.2] }, ms: 150 }],
      },
      { usa: "teleferico/torre", cuando: { t: ["sine"], g: [0.064, 0.081], d: [0.13, 0.17], n: [0, 0] }, gan: 0.8 },
      {
        usa: "teleferico/apagon",
        cuando: { t: ["sawtooth"], g: [0.034, 0.036], d: [0.085, 0.095] },
        gan: 0.8,
        apaga: [{ cuando: { t: ["sawtooth"], g: [0.034, 0.036], d: [0.085, 0.095] }, ms: 450 }],
      },
      { usa: "teleferico/cable", cuando: { t: ["sawtooth"], g: [0.024, 0.03], d: [0.3, 0.4] }, gan: 0.5, sigue: 220 },
    ],
  },
  oruro: {
    ganador: "oruro/ganador",
    reglas: [
      { usa: "oruro/bombo", cuando: { t: ["square"], g: [0.028, 0.032], d: [0.055, 0.065], n: [0, 0] }, gan: 0.9 },
      { usa: "oruro/redoblante", cuando: { t: ["square"], g: [0.019, 0.021], d: [0.045, 0.055], n: [3, 3] }, gan: 0.7 },
      { usa: "oruro/bronce", cuando: { t: ["sawtooth"], g: [0.027, 0.036], d: [0.2, 0.5] }, gan: 0.6, sigue: true },
      {
        usa: "oruro/paso",
        cuando: { t: ["triangle"], g: [0.049, 0.051], d: [0.13, 0.15] },
        gan: 0.8,
        apaga: [{ cuando: { t: ["square"], g: [0.03, 0.04], d: [0.05, 0.07] }, ms: 80 }],
      },
      {
        usa: "oruro/campana",
        cuando: { t: ["triangle"], g: [0.029, 0.061], d: [0.89, 0.93] },
        gan: 0.8,
        apaga: [{ cuando: { t: ["triangle"], g: [0.029, 0.061], d: [0.89, 0.93] }, ms: 200 }],
      },
    ],
  },
  guajojo: {
    ganador: "guajojo/ganador",
    reglas: [{ usa: "guajojo/grillo", cuando: { t: ["triangle"], g: [0.019, 0.023], d: [0.065, 0.085] }, gan: 0.7 }],
  },
  toborochi: {
    ganador: "toborochi/ganador",
    viento: "toborochi/viento",
    colibri: "toborochi/colibri",
    reglas: [],
  },
};

/* ------------------------------------------------------------------ matemática */

const ESCALA = [0, 2, 4, 7, 9];

/** El grado de la escala de `note()` que más se acerca a `f`, o -1 si la nota no es de la escala. */
export function gradoDe(f: number): number {
  if (!(f > 0)) return -1;
  const semis = 12 * Math.log2(f / 130.81);
  const r = Math.round(semis);
  if (Math.abs(semis - r) > 0.3) return -1;
  const oct = Math.floor(r / 12);
  const i = ESCALA.indexOf(r - 12 * oct);
  return i < 0 ? -1 : oct * 5 + i;
}

/** Los tres tonos de "¡Cuenten conmigo!" de la tarjeta del juego: dejan sonar la nota entera, con su eco. */
const CUENTA: Firma = { t: ["triangle"], g: [0.069, 0.071], d: [0.15, 0.17], n: [12, 15] };

const dentro = (v: number, r: Rango | undefined): boolean => !r || (v >= r[0] && v <= r[1]);

/** `true` si el disparo cumple la firma. */
export function coincide(x: Disparo, n: number, f: Firma): boolean {
  if (f.t && !f.t.includes(x.tipo)) return false;
  return dentro(x.g, f.g) && dentro(x.d, f.d) && (!f.n || dentro(n, f.n));
}

/* --------------------------------------------------------------------- el estado */

/** Lo que `sound.ts` hace sonar. */
export interface Jugada {
  buffer: AudioBuffer;
  /** Velocidad de reproducción: 1 si no sigue el tono. */
  rate: number;
  /** Volumen. */
  gan: number;
  /** Corta el archivo a estos segundos reales (con un fundido corto), o `0` para dejarlo sonar entero. */
  corta: number;
  /** Para los auditores: de dónde salió. */
  id: string;
}

/** Volumen del archivo del ganador. */
export const GANANCIA_GANADOR = 0.4;

let juego: Game | null = null;
const buffers = new Map<string, AudioBuffer[]>();
const contador = new Map<string, number>();
let apagadas: { f: Firma; hasta: number }[] = [];

const base = (): string => {
  try {
    return (import.meta.env?.BASE_URL as string | undefined) ?? "/";
  } catch {
    return "/";
  }
};

const rutaDe = (clave: string, i: number, a: Archivo): string => `${base()}sonidos/${clave}${a.n > 1 ? `-${i + 1}` : ""}.mp3`;

/** Los efectos que un juego necesita: sus reglas, el ganador, el viento, las voces y el golpe. */
export function archivosDe(g: Game): string[] {
  const j = JUEGOS_CON_BANCO[g];
  if (!j) return [];
  const ids = new Set<string>([j.ganador, GOLPE.usa]);
  for (const r of j.reglas) ids.add(r.usa);
  if (j.viento) ids.add(j.viento);
  if (j.colibri) ids.add(j.colibri);
  for (const o of ["triangle", "square", "sine", "sawtooth"] as const) {
    const v = j.voces?.[o] ?? VOCES[o].id;
    ids.add(`${v}-lo`);
    ids.add(`${v}-hi`);
  }
  // Los que `sigue: true` buscan en `-lo` y `-hi`: se bajan esos.
  for (const r of j.reglas) {
    if (r.sigue === true) {
      ids.delete(r.usa);
      ids.add(`${r.usa}-lo`);
      ids.add(`${r.usa}-hi`);
    }
  }
  return [...ids];
}

/** Cuánto pesa en total lo que baja un juego, en KB. */
export function pesoDe(g: Game): number {
  return archivosDe(g).reduce((s, id) => s + (ARCHIVOS[id]?.kb.reduce((x, y) => x + y, 0) ?? 0), 0);
}

/** `true` si el aparato pide gastar poco: no se bajan archivos. */
function ahorraDatos(): boolean {
  try {
    const nav = navigator as Navigator & { connection?: { saveData?: boolean } };
    if (nav.connection?.saveData === true) return true;
    return typeof matchMedia === "function" && matchMedia("(prefers-reduced-data: reduce)").matches;
  } catch {
    return false;
  }
}

/**
 * Elige el juego que va a sonar y baja sus archivos. Se llama cuando se sabe qué
 * juego se juega, antes de la tarjeta de "cómo se juega", así llegan mientras la
 * sala la lee. Sin contexto de audio o con ahorro de datos, no baja nada y suena
 * lo de siempre.
 */
export function elegirJuego(g: Game, ctx: BaseAudioContext | null, reinicia = true): void {
  const nuevo = JUEGOS_CON_BANCO[g] ? g : null;
  // Si el juego ya estaba elegido y solo se asegura, los contadores siguen donde iban: la misma ronda suena igual.
  if (reinicia || juego !== nuevo) {
    contador.clear();
    apagadas = [];
  }
  juego = nuevo;
  if (!juego || !ctx || ahorraDatos()) return;
  for (const id of archivosDe(juego)) {
    const a = ARCHIVOS[id];
    if (!a || buffers.has(id)) continue;
    buffers.set(id, []);
    void Promise.all(
      Array.from({ length: a.n }, async (_, i) => {
        try {
          const r = await fetch(rutaDe(id, i, a));
          if (!r.ok) throw new Error(String(r.status));
          return await ctx.decodeAudioData(await r.arrayBuffer());
        } catch {
          return null;
        }
      }),
    ).then((bs) => {
      const buenos = bs.filter((b): b is AudioBuffer => b !== null);
      // Si falló alguno, no se guarda nada a medias: suena el oscilador.
      if (buenos.length === a.n) buffers.set(id, buenos);
      else buffers.delete(id);
    });
  }
  pedirCama(ctx);
}

/** El juego elegido, o `null`. */
export const juegoElegido = (): Game | null => juego;

/** Para las pruebas: vuelve a empezar. */
export function reiniciar(): void {
  juego = null;
  buffers.clear();
  contador.clear();
  apagadas = [];
}

/** Para las pruebas: pone un buffer ya decodificado. */
export function ponerBuffer(id: string, bs: AudioBuffer[]): void {
  buffers.set(id, bs);
}

/** Para las pruebas: elige el juego sin bajar nada. */
export function ponerJuego(g: Game | null): void {
  juego = g;
  contador.clear();
  apagadas = [];
}

function tomar(id: string): AudioBuffer | null {
  const bs = buffers.get(id);
  if (!bs || bs.length === 0) return null;
  const n = contador.get(id) ?? 0;
  contador.set(id, n + 1);
  return bs[n % bs.length] ?? null;
}

/** El archivo con tono (`-lo` o `-hi`) más cercano en altura a `f`. */
function conTono(id: string, f: number): { b: AudioBuffer; hz: number } | null {
  let mejor: { b: AudioBuffer; hz: number } | null = null;
  let dist = Infinity;
  for (const lado of ["lo", "hi"]) {
    const clave = `${id}-${lado}`;
    const a = ARCHIVOS[clave];
    const b = buffers.get(clave)?.[0];
    if (!a?.hz || !b) continue;
    const d = Math.abs(Math.log2(f / a.hz));
    if (d < dist) {
      dist = d;
      mejor = { b, hz: a.hz };
    }
  }
  return mejor;
}

/**
 * ¿Suena un archivo en lugar de este oscilador?
 *
 * Devuelve la jugada, `"silencio"` si el disparo ya va adentro de otro archivo, o
 * `null` si tiene que sonar el oscilador de siempre. `ahora` en milisegundos.
 */
export function decidir(x: Disparo, ahora: number): Jugada | "silencio" | null {
  if (!juego) return null;
  const j = JUEGOS_CON_BANCO[juego];
  if (!j) return null;
  const n = gradoDe(x.f);

  for (const a of apagadas) if (a.hasta > ahora && coincide(x, n, a.f)) return "silencio";
  apagadas = apagadas.filter((a) => a.hasta > ahora);

  for (const r of [...j.reglas, GOLPE]) {
    if (!coincide(x, n, r.cuando)) continue;
    let b: AudioBuffer | null = null;
    let rate = 1;
    if (r.sigue === true) {
      const ref = conTono(r.usa, x.f);
      if (ref) {
        b = ref.b;
        rate = x.f / ref.hz;
      }
    } else if (typeof r.sigue === "number") {
      b = tomar(r.usa);
      rate = x.f / r.sigue;
    } else b = tomar(r.usa);
    if (!b) return null;
    for (const ap of r.apaga ?? []) apagadas.push({ f: ap.cuando, hasta: ahora + ap.ms });
    const gan = r.gan * K_EFECTO * (r.escala ? Math.min(1.6, x.g / r.escala) : 1);
    return { buffer: b, rate, gan, corta: 0, id: r.usa };
  }

  // La voz: el instrumento que reemplaza a la onda.
  const v = VOCES[x.tipo];
  const id = j.voces?.[x.tipo] ?? v.id;
  const ref = conTono(id, x.f);
  if (!ref) return null;
  const rate = Math.max(0.35, Math.min(3, x.f / ref.hz));
  const corta = coincide(x, n, CUENTA) ? 0 : v.corta > 0 ? Math.max(0.07, Math.min(v.corta + x.d * 0.5, x.d + 0.06)) : x.d;
  return { buffer: ref.b, rate, gan: Math.min(0.6, x.g * v.k), corta, id };
}

/** El efecto del ganador, o `null`. */
export function ganador(): Jugada | null {
  if (!juego) return null;
  const j = JUEGOS_CON_BANCO[juego];
  const b = j ? tomar(j.ganador) : null;
  return j && b ? { buffer: b, rate: 1, gan: GANANCIA_GANADOR, corta: 0, id: j.ganador } : null;
}

/** El viento o el colibrí: un archivo que se repite mientras dura el sonido pedido. */
export function ambiente(cual: "viento" | "colibri"): { buffer: AudioBuffer; id: string } | null {
  if (!juego) return null;
  const id = JUEGOS_CON_BANCO[juego]?.[cual];
  const b = id ? tomar(id) : null;
  return id && b ? { buffer: b, id } : null;
}

/**
 * La cama de música de archivo del juego, si existe y está cargada. Es opcional: los
 * archivos de música no viajan con el repo (`public/sonidos/LICENCIA.md`); sin el
 * archivo suena la música de osciladores, sin error ni hueco.
 */
export function camaDeMusica(): AudioBuffer | null {
  return juego ? (buffers.get(`${juego}/musica`)?.[0] ?? null) : null;
}

/**
 * Intenta bajar la cama de música del juego: de nuestro servicio si el sitio es tinkazo.app, o de
 * `public/sonidos/<juego>/musica.mp3` si el archivo está declarado en `ARCHIVOS` o la dirección
 * trae `?musicaarchivo=1` (para escucharla en local).
 */
export function pedirCama(ctx: BaseAudioContext): void {
  if (!juego || ahorraDatos()) return;
  const id = `${juego}/musica`;
  if (buffers.has(id)) return;
  let quiere = !!ARCHIVOS[id];
  try {
    quiere ||= new URLSearchParams(location.search).has("musicaarchivo");
  } catch {
    /* sin dirección */
  }
  // En tinkazo.app la música baja de nuestro servicio (`musica-remota.ts`); en cualquier otro lado, solo si se pide.
  const remota = urlMusica(juego);
  if (!remota && !quiere) return;
  buffers.set(id, []);
  void fetch(remota ?? `${base()}sonidos/${id}.mp3`)
    .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
    .then((ab) => ctx.decodeAudioData(ab))
    .then((b) => void buffers.set(id, [b]))
    .catch(() => void buffers.delete(id));
}
