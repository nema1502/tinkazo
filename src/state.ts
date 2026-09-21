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
 * Cuánto dura el show, **en segundos**.
 *
 * No es un número fijo porque no hay uno bueno para todos los casos. Un sorteo
 * entre amigos en un bar quiere veinte segundos; el cierre de una conferencia
 * con doscientas personas mirando una pantalla gigante aguanta el doble y lo
 * agradece.
 *
 * Era un multiplicador (0,8 / 1,4 / 2,2) y eso tenía un problema de fondo: los
 * seis juegos no duran lo mismo sin estirar, así que el mismo botón entregaba
 * una carrera de 23,5 segundos y un Cierre de Libro de 9,3. No había ninguna
 * posición del selector en la que los seis duraran algo parecido, y el
 * organizador tenía que reaprender el botón cada vez que cambiaba de juego.
 *
 * Ahora el selector dice cuánto tiene que durar el show y cada juego declara
 * cuánto dura sin estirar. "Normal" significa treinta segundos en los seis.
 *
 * El resultado no cambia: el ganador ya estaba decidido antes de que empiece.
 */
export const PACES = { rapido: 20, normal: 30, epico: 42 } as const;
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

/**
 * Hasta dónde se deja estirar un juego.
 *
 * Más que esto no es más emoción, es cámara lenta. La ruleta tenía dos segundos
 * de crucero en los que la imagen es un borrón: multiplicarlos por tres y medio
 * son ocho segundos de nada. Un juego que topa acá necesita más contenido, no
 * ir más despacio.
 */
const MAX_STRETCH = 2.2;
const MIN_STRETCH = 0.55;

/** Segundos de juego del juego en curso, y los que no se estiran nunca. */
let nominal = 0;
let fijo = 0;

/**
 * Cuánto dura el juego en curso sin estirar, para que el selector pueda
 * apuntarle a una duración.
 *
 * `nominalSeconds` son los segundos de juego hasta el revelado, que sí se
 * estiran. `fixedSeconds` son los segundos reales que no se estiran nunca
 * porque le hablan a una persona y no al reloj del juego: el sostén del cartel
 * del ganador, y la cuenta regresiva de la carrera. Lo que tarda alguien en
 * leer un nombre proyectado no cambia porque se elija una duración más larga.
 *
 * Con cero vuelve al factor neutro, que es lo que corresponde cuando no hay
 * ningún juego corriendo.
 */
export function setGameLength(nominalSeconds: number, fixedSeconds = 0): void {
  nominal = Math.max(0, nominalSeconds);
  fijo = Math.max(0, fixedSeconds);
}

/** El factor por el que se multiplica el tiempo del juego en curso. */
export const paceFactor = (): number => {
  if (nominal <= 0) return 1;
  // Un piso de cuatro segundos para que un objetivo chico y un juego con mucho
  // tiempo fijo no den un factor absurdo.
  const util = Math.max(4, PACES[pace] - fijo);
  return Math.max(MIN_STRETCH, Math.min(MAX_STRETCH, util / nominal));
};
export const currentPace = (): Pace => pace;

/**
 * Cómo se llama cada posición del selector, con su duración.
 *
 * El número sale de `PACES` y no de una cadena escrita a mano, así que no se
 * puede despegar del código. Sin el número, "Normal" no le dice nada a alguien
 * que está preparando un evento y quiere saber cuánto va a durar la pantalla.
 */
export const paceSeconds = (p: Pace): number => PACES[p];

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
