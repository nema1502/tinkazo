import { hashDe, sembrar } from "./kit/azar";
import { escalaChipLegible } from "./letra";
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

/* ------------------------------------------- el tamaño del dibujo de una canica (S17) */

/** El aire que la siembra del plan deja como mínimo entre dos canicas vecinas (lo verifica la prueba del S17). */
export const SIEMBRA_AIRE = 0.28;

/**
 * Cuánto se agranda el dibujo de una canica sobre su radio del plan (S17, S20): va al doble de lo que
 * medía hasta ahora — es lo que pidió la sala después de verla en el celular —, y el tope lo pone la
 * siembra: dos canicas vecinas, con sus radios dibujados, jamás se tocan (`2 * CANICA_R * CANICA_ESCALA
 * <= SIEMBRA_AIRE`, y la prueba mide que el plan deja más aire que ese piso; con `SIEMBRA_AIRE = 0.28`
 * el tope de la siembra da 2.8, así el doble no obliga a achicar la siembra visual ni a robarle aire:
 * S20 se cumple entero sin tocar la geometría del plan). La geometría del plan no cambia: solo el
 * dibujo, en las dos escenas.
 */
export const CANICA_ESCALA = Math.min(2, SIEMBRA_AIRE / (2 * CANICA_R));

/* ------------------------------------------------- el chip del nombre */

/** La fracción del diámetro del círculo que como mucho mide de alto la ficha del nombre: una etiqueta, no un cartel. */
export const CHIP_ALTO_FRACCION = 0.12;
/** Con poca gente la ficha puede crecer hasta este cociente de cuántos juegan; debajo de cuatro, manda el piso. */
export const CHIP_GENTE = 3;

/**
 * La escala de la ficha del nombre junto a una canica, para `S.chip(nombre, escala)`.
 *
 * La ficha es la etiqueta de una canica de vidrio, no la figura de una presentación: el kit la pidió
 * al tamaño de la cara y tapaba el círculo entero. Acá manda la regla de la sala —la letra más chica
 * que se lee (`escalaChipLegible`), que ya crece con la pantalla: móvil primero, la ficha más chica
 * que se puede leer—. Por encima solo crece con poca gente, hasta un cuarto más (no tapan cuando son
 * pocas), y nunca desproporcionada con el juego: el alto de la ficha (22 * u * escala * 1.6 px) no
 * pasa de `CHIP_ALTO_FRACCION` del diámetro del círculo `e`. Si ese techo quedara debajo del piso,
 * manda la letra: se lee primero, tapa después. La cantidad entra por `viven` (los que juegan, `n`):
 * a más gente, menos ficha — y en el celular, donde el piso de la letra ya manda, la cantidad se ve
 * en el despeje de la casa (la pasada de `separarEtiquetas` del estadio), no en el tamaño.
 *
 * Pura: mismo argumento, misma escala, en la 2D, en la 3D y en la prueba.
 */
export function escalaChipDe(u: number, e: number, viven: number): number {
  const piso = escalaChipLegible(u);
  const techoAlto = (2 * e * CHIP_ALTO_FRACCION) / (22 * u * 1.6);
  const porGente = Math.min(piso * 1.25, CHIP_GENTE / Math.max(1, viven));
  return Math.max(piso, Math.min(porGente, techoAlto));
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

/* ---------------------------------------------------- las chispas del vidrio */

/** Cuántas chispas de vidrio saltan por cada choque. */
export const CHISPAS_N = 7;
/** Cuánto vive la chispa más longevo: todas mueren antes (el brillo es un instante). */
export const CHISPA_VIDA = 0.3;

/** Una chispa de vidrio: su rumbo (por segundo, en unidades del círculo), su vida corta y el largo del rayo que deja. */
export interface Chispa {
  dx: number;
  dy: number;
  vida: number;
  largo: number;
}

/**
 * Las chispas de un impacto: el destello del vidrio que se roza, más vivas y
 * más cortas que el polvo. Salen por donde viaja la canica golpeada, abiertas
 * en un cono, cada una con su velocidad; determinista por tiro, con la semilla
 * aparte del polvo (`polvoDe`), así la misma tirada echa las mismas chispas.
 * En unidades del círculo por segundo.
 */
export function chispasDe(i: number, impacto: Pun, dir: Pun): Chispa[] {
  const r = sembrar(Math.imul(i + 1, 0x5bd1e9f5));
  return Array.from({ length: CHISPAS_N }, () => {
    const a = (r() - 0.5) * 1.5;
    const c = Math.cos(a), s = Math.sin(a);
    const v = 0.45 + r() * 0.65;
    return {
      dx: (dir.x * c - dir.y * s) * v,
      dy: (dir.y * c + dir.x * s) * v,
      vida: 0.12 + r() * (CHISPA_VIDA - 0.12),
      largo: 0.018 + r() * 0.03,
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

/* --------------------------------------------------- el trazo punteado (S19) */

/**
 * Un trazo recto en tramos punteados: corta la recta `a`-`b` en tramos de a lo
 * sumo `paso`, con el mismo aire de hueco entre uno y otro, de modo que la
 * mitad del trazo queda pintada y la otra mitad, aire. Pura y sin azar: la
 * escena dibuja cada tramo como una tirada de tiza. En un tramo más corto que
 * `paso` queda un solo tramo: el guión nuevo nunca borra una línea vieja.
 */
export function punteadoDe(a: Pun, b: Pun, paso: number): [Pun, Pun][] {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const largo = Math.hypot(dx, dy);
  if (!(largo > 0)) return [];
  const n = Math.max(1, Math.min(64, Math.ceil(largo / (2 * paso))));
  const tramo = largo / (2 * n);
  return Array.from({ length: n }, (_, i) => {
    const t0 = (2 * i) / (2 * n);
    const t1 = t0 + tramo / largo;
    return [
      { x: a.x + dx * t0, y: a.y + dy * t0 },
      { x: a.x + dx * t1, y: a.y + dy * t1 },
    ];
  }) as [Pun, Pun][];
}

/* ----------------------------------------------- el anuncio de la diana (S19) */

/** Los colores del aguayo que ya usa la casa, para las rayas del anillo. */
export const AGUAYO = [0xe93d9c, 0xffc629, 0x00a896] as const;

/** Cuánto dura el anuncio de la diana antes del impacto: la entrada de la mano del plan (`TIRADOR + MANO_PREPARA`) con un aire más. */
export const ANUNCIO_DIANA = 1.2;

/** Una raya del anillo: su ángulo, el radio donde nace y donde termina, y su color del aguayo (unidades del círculo). */
export interface Rayita {
  a: number;
  de: number;
  hasta: number;
  color: number;
}

/** Lo que se anuncia a la sala antes de un tiro: qué tiro viene, su pulso (0 a 1, muerto antes del golpe) y el anillo de rayas alrededor de la diana. */
export interface AnuncioDiana {
  tiro: Tiro;
  /** El pulso del anuncio: nace en cero, sube y muere antes de que el tiro aterrice. */
  pulso: number;
  /** El radio del anillo, en unidades del círculo: rodea a la canica sin tocarla. */
  anillo: number;
  /** Las rayas del anillo, alrededor de la diana. */
  rayas: Rayita[];
}

/** El tramo del pulso que vive antes del aterrizaje: lo demás de la ventana queda sin pulso, sin salto (el anuncio muere antes del golpe). */
const PULSO_VIDA = 0.8;

/**
 * El anuncio de la canica que le va a tocar a la tirada: el plan ya fijó la diana de cada tiro
 * (`tiros[].diana`, en orden), así que la sala puede ver a cuál le va a pegar la pegadora. En la
 * ventana de la largada de ese tiro (`tiro.t - ANUNCIO_DIANA` a `tiro.t`), alrededor de la canica
 * golpeada se lee un anillo con rayas al aguayo que late con su pulso; al momento del impacto la
 * ventana cierra: la canica ya está siendo golpeada y el anillo sobra. Nunca la canica que gana:
 * su casi es un rodado, no un golpe (queda garantizado por doble llave: el plan jamás la anuncia,
 * y acá la guarda aparte). Toda la geometría sale del plan y del hash del tiro; sin `Math.random`.
 */
export function anuncioDeDiana(d: Pick<Datos, "tiros"> & { ganador: number }, t: number): AnuncioDiana | null {
  for (const tiro of d.tiros) {
    if (t < tiro.t - ANUNCIO_DIANA || t >= tiro.t) continue;
    // El casi es un rodado, no un golpe: la ganadora no se anuncia, también acá.
    if (tiro.diana === d.ganador) return null;
    const u = (t - (tiro.t - ANUNCIO_DIANA)) / ANUNCIO_DIANA;
    const i = d.tiros.indexOf(tiro);
    const fase = hashDe(i, 71) * Math.PI * 2;
    const anillo = CANICA_R * CANICA_ESCALA * 1.5;
    const largo = anillo * 0.3;
    return {
      tiro,
      pulso: u < PULSO_VIDA ? Math.sin((Math.PI * u) / PULSO_VIDA) : 0,
      anillo,
      rayas: Array.from({ length: 12 }, (_, j) => ({
        a: fase + (j * Math.PI * 2) / 12,
        de: anillo,
        hasta: anillo + largo,
        color: AGUAYO[j % AGUAYO.length] as number,
      })),
    };
  }
  return null;
}

/* --------------------------------------------------- el acercamiento a la ganadora */

/** Cuánto tarda la cámara en llegar de cerca: el mismo tramo del rodado del casi (en el 3D es `LLEGADA_TITILA`). */
export const CERCA_ENTRA = 2;
/** Cuánto tarda la cámara en soltar la toma de cerca antes del golpe. */
export const CERCA_VUELVE = 1.1;

/**
 * Cuánto manda el acercamiento a la canica que gana en el segundo `t` (0: la
 * cámara del director; 1: la toma de cerca). Entra con el rodado del casi —
 * la canica va hacia la tiza y la cámara la va a buscar y se queda con ella
 * mientras titila y gira—, y suelta apenas a tiempo para que la coronación
 * caiga sobre el encuadre de siempre. Es la cuenta que comparten la cámara
 * del 3D y el velo de los chips del 2D: una sola, para las dos escenas.
 * Continua en los cuatro bordes, determinista, cosmética.
 */
export function cercaDe(d: Pick<Datos, "casi" | "duracion">, t: number): number {
  const t0 = d.casi.t;
  const t1 = t0 + CERCA_ENTRA;
  const suave = (x: number): number => {
    const k = Math.min(1, Math.max(0, x));
    return k * k * (3 - 2 * k);
  };
  if (t <= t0) return 0;
  if (t < t1) return suave((t - t0) / CERCA_ENTRA);
  const vuelve = Math.max(0.3, CERCA_VUELVE);
  const s1 = Math.max(t1, d.duracion - vuelve);
  if (t < s1) return 1;
  return t >= d.duracion ? 0 : 1 - suave((t - s1) / Math.max(0.001, d.duracion - s1));
}
