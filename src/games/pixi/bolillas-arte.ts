import { hashDe, sembrar } from "./kit/azar";
import { CANICA_R, type Datos, type Pun, type Tiro, unitarioDe } from "./bolillas-plan";

/**
 * Bolillas: el arte, puro.
 *
 * Todo lo que la escena 2D (`bolillas.ts`) dibuja con retazos que no cambian de
 * una ronda a otra: la tiza a mano alzada, la tierra sembrada, el vidrio de cada
 * canica, el polvo del impacto, la mano de la pegadora con el agarre ñati y el
 * vaivén del titileo. Nada aquí toma decisiones: cada número sale de la semilla
 * fija del show o de la geometría del plan (`bolillas-plan.ts`), la misma para
 * la 2D y la 3D. Sin PixiJS y sin `Math.random`: se prueba en Node
 * (`bolillas-arte.test.ts`), como el plan.
 *
 * Todo lo que dibuja (el cómo) vive en la escena; esto dice cuánto y dónde.
 */

/** La semilla fija del show: la misma tierra y la misma tiza en cualquier equipo. */
export const SEMILLA_FIJA = 0xb01a51a5;

/** Lo que tarda el vuelo de la canica de la pegadora antes del impacto (y su resbalón después). */
export const TIRADOR = 0.55;
export const T_DESVIO = 0.45;

/* ------------------------------------------------------- la tiza, a mano */

/** Cuántos puntos tiene el trazo de la tiza (y uno más, para cerrar la vuelta). */
export const TIZA_PUNTOS = 44;
/** Cuánto se descarrila el trazo a mano alzada, en unidades del círculo: visible en la orilla, chico junto a una canica. */
export const TIZA_ONDA = 0.014;

/**
 * El círculo de tiza dibujado a mano: baja y sube con tres ondas sembradas,
 * siempre el mismo trazo para la misma semilla, y nunca tanto que una canica lo
 * confunda con la orilla (el desvío vive debajo de `CANICA_R`). En unidades del
 * círculo, alrededor del centro de la tierra.
 */
export function tizaCirculo(semilla: number): Pun[] {
  const r = sembrar(semilla);
  const fases = [r() * Math.PI, r() * Math.PI, r() * Math.PI];
  const ondas = [0.6, 0.3, 0.1];
  const onda = (a: number, i: number): number => Math.sin(a * (3 + 4 * i) + (fases[i] as number)) * (ondas[i] as number);
  return Array.from({ length: TIZA_PUNTOS + 1 }, (_, i) => {
    const a = (i / TIZA_PUNTOS) * Math.PI * 2;
    const w = 1 + TIZA_ONDA * (onda(a, 0) + onda(a, 1) + onda(a, 2));
    return { x: Math.cos(a) * w, y: Math.sin(a) * w };
  });
}

/* ---------------------------------------------------------- la tierra */

/** Una mancha de la tierra: dónde, cuánto mide, qué tan fuerte, y si oscurece o aclara. */
export interface Mancha {
  x: number;
  y: number;
  r: number;
  a: number;
  oscuro: boolean;
}

/** Cuántas manchas siembra el campo. */
export const MANCHAS_N = 42;

/**
 * La tierra, sembrada: manchas de tono alrededor del círculo (hasta un pelo
 * más lejos que la tiza), deterministas. En unidades del círculo.
 */
export function tierraManchas(semilla: number): Mancha[] {
  const r = sembrar(semilla);
  return Array.from({ length: MANCHAS_N }, () => {
    const a = r() * Math.PI * 2;
    const d = Math.sqrt(r()) * 1.72;
    return {
      x: d * Math.cos(a),
      y: d * Math.sin(a),
      r: 0.06 + r() * 0.24,
      a: 0.05 + r() * 0.13,
      oscuro: r() < 0.5,
    };
  });
}

/* ----------------------------------------------------- el vidrio de las canicas */

/** Cómo se ve el vidrio de una canica: el color de fondo, la llama adentro y el borde. */
export interface ArteCanica {
  base: number;
  llama: number;
  llama2: number;
  oscuro: number;
}

/** Los vidrios de la bolsa: uno por asiento, todos distintos. */
const VIDRIOS = [
  0x8fd0c8, // turquesa
  0xd9a441, // ámbar
  0x7f9fd4, // azul
  0xd47f8f, // rosa
  0x9fbf6a, // verde
  0xbfc8d4, // blanco lechoso
  0xc99ad6, // violeta
  0xd4b06a, // miel
  0x6fbfa8, // jade
  0xcf8f66, // terracota
  0x86b9d6, // cielo
  0xb99fd4, // lavanda
];

/** Las llamas que remolinan adentro del vidrio, de las que sale cada canica. */
const LLAMAS = [0xffd24a, 0xff8a3c, 0xff5f4d, 0x49e0b5, 0x7ab8ff, 0xffe9a3];

/** El vidrio de la canica de la pegadora: cristal casi claro, aparte de los doce. */
const VIDRIO_TIRADOR: ArteCanica = { base: 0xe7d9c4, llama: 0xff8a3c, llama2: 0xffd24a, oscuro: 0x8d7a5e };

/** Vuelve un color de la casa hacia el negro. */
const oscurece = (c: number, f: number): number => {
  const r = (c >> 16) & 0xff, g = (c >> 8) & 0xff, b = c & 0xff;
  return (((r * (1 - f)) | 0) << 16) | (((g * (1 - f)) | 0) << 8) | ((b * (1 - f)) | 0);
};

/**
 * El arte de la canica de un asiento (o `-1`, la de la pegadora): siempre el
 * mismo vidrio para el mismo asiento, y llamas distintas entre sí, para que el
 * nombre de al lado no sea el único modo de reconocerla.
 */
export function coloresCanica(slot: number): ArteCanica {
  if (slot < 0) return VIDRIO_TIRADOR;
  const base = VIDRIOS[slot % VIDRIOS.length] as number;
  const i = Math.floor(hashDe(slot, 11) * LLAMAS.length);
  const llama = LLAMAS[i % LLAMAS.length] as number;
  const llama2 = LLAMAS[(i + 1 + Math.floor(hashDe(slot, 23) * (LLAMAS.length - 1))) % LLAMAS.length] as number;
  return { base, llama, llama2, oscuro: oscurece(base, 0.42) };
}

/* ------------------------------------------------------- el golpe y el polvo */

/** Cuánto sigue vibrando la canica golpeada después del impacto. */
export const COLA_GOLPE = 0.35;

/** Cuántos granos de polvo levanta cada choque. */
export const POLVO_N = 10;

/** Un grano de polvo: cuánto se corre (por segundo, en unidades del círculo), cuánto vive y cuánto mide. */
export interface Grano {
  dx: number;
  dy: number;
  vida: number;
  r: number;
}

/**
 * La nube de polvo de un impacto: corre para donde viaja la canica golpeada,
 * abierta a los costados, determinista por tiro (la misma tirada levanta la
 * misma nube). En unidades del círculo por segundo.
 */
export function polvoDe(i: number, impacto: Pun, dir: Pun): Grano[] {
  const r = sembrar(Math.imul(i + 1, 0x27d4eb2d));
  const perp = { x: -dir.y, y: dir.x };
  return Array.from({ length: POLVO_N }, () => {
    const largo = 0.06 + r() * 0.22;
    const ancho = (r() - 0.5) * 0.24;
    return {
      dx: dir.x * largo + perp.x * ancho,
      dy: dir.y * largo + perp.y * ancho,
      vida: 0.25 + r() * 0.35,
      r: 0.015 + r() * 0.03,
    };
  });
}

/** Lo que pasa en el instante del choque: el tiro en curso, la palpitación de la golpeada, el destello y el retroceso del tiro. */
export interface EfectosDeGolpe {
  tiro: Tiro;
  /** La palpitación de la canica golpeada (0 a 1: sube y baja adentro de la cola). */
  squash: number;
  /** El destello del impacto (1 al instante del golpe, se muere con la cola). */
  flash: number;
  /** Cuánto se corre el tiro hacia atrás del golpe, en unidades del círculo. */
  retro: Pun;
}

/**
 * Los efectos del golpe en el segundo `t`: valen en la ventana de la cola
 * (`COLA_GOLPE`) y solo para el tiro que acaba de pegar. Toda la geometría sale
 * del plan; `null` fuera de la ventana.
 */
export function efectosDe(d: Pick<Datos, "tiros">, t: number): EfectosDeGolpe | null {
  const tiro = d.tiros.find((x) => t >= x.t && t < x.t + COLA_GOLPE);
  if (!tiro) return null;
  const u = (t - tiro.t) / COLA_GOLPE;
  const pulso = Math.sin(Math.PI * u);
  const ida = unitarioDe({ x: tiro.impacto.x - tiro.desde.x, y: tiro.impacto.y - tiro.desde.y });
  const retro = 0.07 * (1 - u);
  return {
    tiro,
    squash: pulso,
    flash: 1 - u,
    retro: { x: -ida.x * retro, y: -ida.y * retro },
  };
}

/* ------------------------------------------------- la pegadora de ñati */

/** Cuánto tarda la mano en llegar y armarse antes de soltar. */
export const MANO_PREPARA = 0.5;
/** Cuánto dura el flick: la pinza abre de golpe y la canica parte en ese mismo instante. */
export const MANO_SUELTA = 0.14;
/** Cuánto tarda la mano en retirarse después del flick. */
export const MANO_COBRA = 0.32;

/** La mano de la pegadora, en el segundo `t`: dónde agarra, para dónde se corre, cuán abierta está la pinza y cuánto se ve. */
export interface Mano {
  /** Dónde está la pinza: la largada del plan (y, retirándose, un poco más lejos). */
  en: Pun;
  /** El rumbo hacia afuera del círculo: por ahí entra el brazo y se retira la mano. */
  radial: Pun;
  /** La pinza: 0 cerrada (con la canica agarrada), 1 abierta de golpe (el flick de ñati). */
  pinza: number;
  /** Cuánto se ve la mano: 1 entrando, 0 ya retirada. */
  velo: number;
}

/**
 * La mano que tira, en la hora del plan. Entra antes de la largada
 * (`tiro.t - TIRADOR`), agarra la canica con la pinza cerrada (el interior del
 * índice y el exterior del pulgar, como se agarra para dar con ñati), suelta
 * con el flick exactamente cuando la canica parte, y se retira. Toda hora y
 * lugar salen del plan: la escena no vuelve a tirar por su cuenta.
 */
export function manoDe(d: Pick<Datos, "tiros">, t: number): Mano | null {
  for (const tiro of d.tiros) {
    const r0 = tiro.t - TIRADOR;
    if (t < r0 - MANO_PREPARA || t >= r0 + MANO_SUELTA + MANO_COBRA) continue;
    const pinza = t < r0 ? 0 : Math.min(1, (t - r0) / MANO_SUELTA);
    const cobra = t < r0 + MANO_SUELTA ? 0 : (t - r0 - MANO_SUELTA) / MANO_COBRA;
    const radial = unitarioDe(tiro.desde);
    const correr = 0.22 * cobra;
    return {
      en: { x: tiro.desde.x + radial.x * correr, y: tiro.desde.y + radial.y * correr },
      radial,
      pinza,
      velo: 1 - cobra,
    };
  }
  return null;
}

/* --------------------------------------------------- el titileo del cierre */

/** Cuántos vaivenes da la canica que gana antes de quedarse quieta sobre la tiza. */
export const TITILA_OLAS = 9;
/** Cuánto mece el vaivén, en radianes, en su primer empujón. */
export const TITILA_AMPLE = 0.3;

/**
 * El vaivén de la canica que casi cruza: empuja fuerte apenas llega a la tiza,
 * cada empujón es más chico, y al final muere en cero exacto — la canica se
 * queda, y la escena no tiembla ni un pelo después. `u` es cuánto va del
 * titileo al golpe (de 0 a 1, con el reloj del plan).
 */
export function titilazo(u: number): number {
  if (u <= 0 || u >= 1) return 0;
  return Math.sin(u * Math.PI * TITILA_OLAS) * (1 - u) * TITILA_AMPLE;
}
