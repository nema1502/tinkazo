import { normalCarrera, segundosDe } from "./duraciones";

/** `race` y `stellar` son la misma carrera con distinto escenario. */
export type Game = "race" | "stellar" | "wheel" | "ledger" | "rockets" | "pasanaku" | "teleferico" | "tombola" | "trompo" | "totora" | "pinata" | "oruro" | "luz" | "sapo" | "quien" | "chovena" | "trueque";

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

/**
 * La ruleta llega hasta esta cantidad de participantes. Hasta veinticuatro, un
 * gajo por persona; con más, cada gajo reúne a un grupo (`games/wheel-layout.ts`).
 */
export const WHEEL_MAX = 200;

/**
 * El Sapo tiene doce agujeros: con más nombres juega una clasificatoria hasta
 * doce finalistas (`games/pixi/qualifier.ts`). Solo no puede con más de doce
 * ganadores, y ahí el sorteo pasa a la carrera.
 */
export { SAPO_MAX } from "./games/pixi/sapo-plan";
import { SAPO_MAX as SAPO_CAP } from "./games/pixi/sapo-plan";

/**
 * El juego que de verdad se cuenta: si el elegido no aguanta tantos nombres,
 * otro que sí. La ruleta pasados WHEEL_MAX no se juega: el selector ya cambió el
 * juego al sellar (el primero que encaja, `ui/recomendar.ts`), y acá queda la
 * red para quien llegue por otro camino. El Sapo con más de SAPO_MAX ganadores,
 * a la carrera. No altera quién ganó: el juego solo narra.
 *
 * `names` y `winners` son opcionales: el Sapo mira cuántos ganadores hay.
 */
export function playableGame(game: Game, people: number, _names?: readonly string[], winners?: readonly number[]): Game {
  // Si la ruleta llega acá con más gente, va a la tómbola, que muestra a todos
  // con su número: la carrera ponía ocho en pista y dejaba afuera al resto
  // (revisiones del 16 de octubre de 2026).
  if (game === "wheel" && people > WHEEL_MAX) return "tombola";
  if (game === "sapo" && (winners?.length ?? 1) > SAPO_CAP) return "race";
  return game;
}

export const params = new URLSearchParams(location.search);

/** `?instant=1`: salta las animaciones (capturas y pruebas). */
export const instantMode = params.get("instant") === "1";

/**
 * El modo para compartir: más contraste, nombres más grandes y menos partículas
 * en el show, para que se lea en Zoom o en una pantalla compartida. Vive en la
 * pestaña (`sessionStorage`): se prende y apaga desde el sorteo, y dura hasta
 * cerrar la pestaña. `?compartir=1` lo prende al abrir. Sin almacenamiento
 * (una ventana privada, por ejemplo) no se recuerda, y no pasa nada más.
 */
const COMPARTIR_KEY = "tinkazo.compartir";

export function paraCompartir(): boolean {
  try {
    return sessionStorage.getItem(COMPARTIR_KEY) === "1";
  } catch {
    return false;
  }
}

export function setParaCompartir(on: boolean): void {
  try {
    if (on) sessionStorage.setItem(COMPARTIR_KEY, "1");
    else sessionStorage.removeItem(COMPARTIR_KEY);
  } catch {
    /* sin almacenamiento, el modo dura lo que la página */
  }
}

if (params.get("compartir") === "1") setParaCompartir(true);

/** `true` si el sistema pide menos movimiento. Seguro sin `matchMedia`. */
export function motionReduced(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

let motionForced = false;

/** Fuerza el movimiento para una repetición ("Ver la animación igual"). */
export function forceMotion(on: boolean): void {
  motionForced = on;
}

/** El juego se salta por la preferencia del sistema, y no por `?instant=1`. */
export const skippedForReducedMotion = (): boolean => !instantMode && motionReduced() && !motionForced;

/** Si los juegos deben saltarse su animación y entregar el resultado de una. */
export const skipMotion = (): boolean => instantMode || skippedForReducedMotion();

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
 * cuánto dura sin estirar. "Normal" significa treinta y ocho segundos en todos.
 *
 * Era treinta hasta el 17 de octubre de 2026. En el primer evento después de
 * Stellar Elite, Nicolás lo sintió corto: "deberían durar más los juegos para
 * tener más emoción y expectativa". Treinta y ocho y cuarenta y cinco son
 * lo que alcanzan los doce juegos sin pasar de `MAX_STRETCH`, o sea sin
 * volverse cámara lenta: con cincuenta, el teleférico y el aguayo quedaban en
 * 39,5 (auditor exigente, 17 de octubre). La carrera, además, ganó contenido: la clasificatoria y la
 * presentación de los carriles.
 *
 * El resultado no cambia: el ganador ya estaba decidido antes de que empiece.
 */
export const PACES = { rapido: 20, normal: 38, epico: 45 } as const;
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
 * Un ritmo de paso, que no se guarda: el ensayo va en el rápido sin cambiar
 * el que eligió la persona para sus sorteos (`ensayo.ts`). Elegir uno en el
 * selector lo suelta.
 */
let forzado: Pace | null = null;
export function forzarRitmo(p: Pace | null): void {
  forzado = p;
}
const ritmo = (): Pace => forzado ?? pace;

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
 * Cuánto promete "Normal" este juego, si no son los `PACES` de todos. La
 * carrera de hasta 30 dura más cuanta más gente corre (`src/duraciones.ts`):
 * lo declara el propio juego con su cantidad, y los otros siguen en 38.
 */
let normalPropio: number | null = null;

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
export function setGameLength(nominalSeconds: number, fixedSeconds = 0, normalSeconds: number | null = null): void {
  nominal = Math.max(0, nominalSeconds);
  fijo = Math.max(0, fixedSeconds);
  normalPropio = normalSeconds;
}

/**
 * Los segundos de la tarjeta de "cómo se juega" que va antes del juego. Son
 * parte del show, así que salen del mismo total: "normal" sigue siendo
 * treinta segundos, tarjeta incluida. Cero cuando no hay tarjeta (la escena
 * fija de `?pose=` no la muestra).
 */
let tarjeta = 0;
export function setCardSeconds(seconds: number): void {
  tarjeta = Math.max(0, seconds);
}

/**
 * La compuerta del estadio: el motor nuevo arranca mientras la tarjeta está
 * arriba (tarda hasta un segundo y medio en una laptop lenta, y dos en un
 * celular), pero el reloj del juego no corre hasta que la tarjeta termina.
 * Antes arrancaba recién después, y la tarjeta quedaba de dos a cinco segundos
 * de más. El estadio la toma una sola vez.
 */
let compuerta: Promise<void> | null = null;
export function setShowGate(gate: Promise<void> | null): void {
  compuerta = gate;
}
export function takeShowGate(): Promise<void> | null {
  const g = compuerta;
  compuerta = null;
  return g;
}

/** El factor por el que se multiplica el tiempo del juego en curso. */
export const paceFactor = (): number => {
  if (nominal <= 0) return 1;
  // Un piso de cuatro segundos para que un objetivo chico y un juego con mucho
  // tiempo fijo no den un factor absurdo.
  // `ritmo()` y no `pace`: el ensayo va en el rápido sin cambiar el ritmo guardado (`forzarRitmo`).
  const p = ritmo();
  const meta = normalPropio !== null ? segundosDe(p, normalPropio) : PACES[p];
  const util = Math.max(4, meta - fijo - tarjeta);
  return Math.max(MIN_STRETCH, Math.min(MAX_STRETCH, util / nominal));
};
export const currentPace = (): Pace => ritmo();

/**
 * Cómo se llama cada posición del selector, con su duración.
 *
 * El número sale de `PACES` y no de una cadena escrita a mano, así que no se
 * puede despegar del código. Sin el número, "Normal" no le dice nada a alguien
 * que está preparando un evento y quiere saber cuánto va a durar la pantalla.
 */
export const paceSeconds = (p: Pace): number => {
  // La carrera de hasta 30 promete según cuánta gente corre; el resto, lo de siempre.
  // (El motor anterior, con `?motor=clasico`, no tiene pelotón: ahí vale lo de todos.)
  const propio = app.game === "race" && app.frozen && params.get("motor") !== "clasico" ? normalCarrera(app.frozen.names.length) : null;
  return (propio !== null ? segundosDe(p, propio) : PACES[p]) + (conCuenta(p) ? CUENTA_SECONDS : 0);
};

/**
 * "¡Cuenten conmigo!": el 3, 2, 1 que cuenta la sala entera al final de la
 * tarjeta de "cómo se juega" (un ritual de sala, de la auditoría de juegos).
 * Se suma al show en vez de quitarle segundos al juego, y por eso el selector
 * lo cuenta. En la duración rápida no va: es la que se elige para ir al grano.
 */
export const CUENTA_SECONDS = 3;
export const conCuenta = (p: Pace = ritmo()): boolean => p !== "rapido";

/**
 * Si la sala ya contó "3, 2, 1" con la tarjeta: el juego larga directo, sin
 * una segunda cuenta. La carrera tenía la suya y quedaban dos seguidas
 * (revisión del experto en sorteos, 16 de octubre de 2026).
 */
let contaron = false;
export function setYaContaron(v: boolean): void {
  contaron = v;
}
export const yaContaron = (): boolean => contaron;

export function setPace(p: Pace): void {
  pace = p;
  forzado = null;
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
export { avatar, drawAvatar } from "./avatar";
