/** `race` y `stellar` son la misma carrera con distinto escenario. */
export type Game = "race" | "stellar" | "wheel" | "ledger" | "rockets" | "pasanaku";

/** Ronda de quicknet ya publicada y verificada. */
export interface Beacon {
  round: number;
  /** `sha256(signature)`, en hex. Igual al `randomness` de drand. */
  randomness: string;
  /** Firma G1 comprimida (48 bytes) en hex. */
  signature: string;
}

export interface Frozen {
  names: string[];
  /** `list_hash` en hex (protocolo §1). */
  listHash: string;
  /** Instante del sello (Unix, segundos). */
  ts: number;
  at: string;
  prize: string;
  /** Ronda objetivo de quicknet (protocolo §3). */
  round: number;
  /** Id del sorteo en el contrato, si quedó anclado en Stellar. */
  raffleId?: bigint;
  /** Hash de la transacción del sello. */
  sealTx?: string;
}

export interface Drawn {
  beacon: Beacon;
  winners: number[];
  /** Hash de la transacción del sorteo, si se registró en el contrato. */
  drawTx?: string;
}

/** Estado de la pantalla principal. Un solo sorteo por carga de página. */
export const app: { game: Game; frozen: Frozen | null; drawn: Drawn | null } = {
  game: "race",
  frozen: null,
  drawn: null,
};

/** Variables CSS de la paleta, en el orden que usan carriles y gajos. */
export const LCOLORS = ["--magenta", "--orange", "--teal", "--purple", "--yellow"] as const;

/** La ruleta se ve bien hasta esta cantidad de participantes. */
export const WHEEL_MAX = 24;

export const params = new URLSearchParams(location.search);

/** `?instant=1`: salta las animaciones (capturas y pruebas). */
export const instantMode = params.get("instant") === "1";

/**
 * Segundos entre el sello y la ronda objetivo, en modo libre.
 *
 * La espera no es un trámite: es todo el truco. La lista se cierra **antes** de
 * que exista el número que va a decidir, y por eso nadie pudo elegirlo. Lo que
 * se necesita es que la ronda objetivo esté en el futuro al momento de sellar,
 * y quicknet publica una cada tres segundos.
 *
 * Diez segundos alcanzan y se sienten mucho mejor en un evento, con la sala
 * mirando. El margen que queda cubre un reloj desfasado unos pocos segundos, y
 * si el reloj de la máquina está peor que eso, el comprobante lo delata: quien
 * verifica recalcula la hora de la ronda desde el génesis de drand, no desde el
 * reloj del organizador.
 *
 * `?lead=N` la acorta todavía más para pruebas.
 */
export const LEAD_SECONDS = Math.max(3, Number(params.get("lead")) || 10);

/**
 * Margen mínimo cuando el sello va a la cadena.
 *
 * Acá no lo elijo yo: el contrato rechaza con `RoundTooSoon` cualquier ronda
 * que nazca antes de treinta segundos, y el contrato es inmutable. Sobre esos
 * treinta hay que dejar lo que tarde la transacción en confirmarse, porque el
 * contrato mide contra la hora de cierre del ledger, no contra la del
 * navegador. Cuarenta y cinco es lo que aguantó sin fallar en testnet.
 */
export const ANCHOR_LEAD_SECONDS = 45;

/**
 * Cuánto dura el show.
 *
 * No es un número fijo porque no hay uno bueno para todos los casos. Un sorteo
 * entre amigos en un bar quiere veinte segundos; el cierre de una conferencia
 * con doscientas personas mirando una pantalla gigante aguanta el doble y lo
 * agradece. El factor multiplica el tiempo de todos los juegos por igual, así
 * que el sonido y la animación siguen yendo juntos.
 *
 * El resultado no cambia: el ganador ya estaba decidido antes de que empiece.
 */
export const PACES = { rapido: 0.8, normal: 1.4, epico: 2.2 } as const;
export type Pace = keyof typeof PACES;

const PACE_KEY = "tinkazo.pace";

function initialPace(): Pace {
  const fromUrl = params.get("pace");
  if (fromUrl && fromUrl in PACES) return fromUrl as Pace;
  try {
    const saved = localStorage.getItem(PACE_KEY);
    if (saved && saved in PACES) return saved as Pace;
  } catch {
    /* sin almacenamiento, se usa el de siempre */
  }
  return "normal";
}

let pace: Pace = initialPace();

/** El factor por el que se multiplica la duración de cualquier juego. */
export const paceFactor = (): number => PACES[pace];
export const currentPace = (): Pace => pace;

export function setPace(p: Pace): void {
  pace = p;
  try {
    localStorage.setItem(PACE_KEY, p);
  } catch {
    /* que no se guarde no rompe nada */
  }
}

export const SAMPLE = [
  "María Quispe", "Jorge Mamani", "Lucía Flores", "Carlos Choque", "Ana Vargas", "Diego Rojas",
  "Elena Condori", "Pablo Gutiérrez", "Sofía Aguilar", "Rodrigo Peña", "Valeria Torrez", "Miguel Arce",
  "Camila Suárez", "Andrés Villca", "Paola Mendoza", "Franco Ibáñez", "Daniela Cruz", "Óscar Limachi",
];

// El avatar se dibuja en el navegador. Antes se le pedía a un servicio
// externo con el nombre de la persona en la dirección, lo que sacaba la lista
// entera del navegador de a un nombre por vez. Ver src/avatar.ts.
export { avatar } from "./avatar";
