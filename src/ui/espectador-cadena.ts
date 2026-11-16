import type { Registro, Resultado, Sello } from "../protocol/verificacion";
import type { ContratoOficial } from "../stellar/oficiales";
import { RPC_LISTAS } from "../stellar/config";
import { reglaDelShow } from "./espectador-regla";

/**
 * La vista de espectador y lo que quedó grabado en Stellar.
 *
 * Con un sorteo sellado, la sala no ve el juego cuando nace el número: lo ve cuando el sorteo quedó grabado, unos
 * segundos después (`draw.ts`: la tarjeta del juego sale enseguida y la cuenta y el juego esperan al registro). Si el
 * celular arrancara el show apenas nace el número, mostraría el ganador antes que la pantalla de la sala. Por eso
 * espera lo mismo que ella: lee el registro del contrato oficial (el mismo camino que la página de comprobar,
 * `stellar/registro.ts`, en la red que dice el enlace y no en la del navegador) hasta que el sorteo aparece grabado.
 *
 * Y de paso comprueba dos cosas, para que un enlace equivocado o armado a mano no muestre otro sorteo: que lo sellado
 * es lo que trae el enlace (la huella de la lista, cuántas personas, cuántos premios y el número de la ronda) y que lo
 * grabado es lo que calculó el celular con el protocolo (la semilla y los ganadores). Si algo no coincide, no hay show.
 */

/** Lo que el celular sabe del sorteo: lo que trae el enlace y lo que calculó cuando nació el número. */
export interface SorteoDelEnlace {
  contrato: ContratoOficial;
  /** El número del sorteo en el contrato. */
  id: string;
  /** La huella de la lista del enlace, en hex. */
  listHash: string;
  count: number;
  numWinners: number;
  round: number;
}

export interface LoCalculado {
  /** La semilla que salió de la firma de la ronda, en hex. */
  randomness: string;
  winners: readonly number[];
}

/** Lee el registro de un sorteo. El de verdad es `leerRegistro` (`stellar/registro.ts`). */
export type Leer = (contrato: ContratoOficial, id: string) => Promise<Registro>;

/** Lo que trae el enlace no es lo que quedó en Stellar: no se muestra nada. */
export class NoCoincide extends Error {
  constructor(que: string) {
    super(`no-coincide: ${que}`);
    this.name = "NoCoincide";
  }
}

/** Lo sellado es lo del enlace. Lanza `NoCoincide` con lo primero que no da. */
export function revisarSello(sello: Sello, s: SorteoDelEnlace): void {
  if (sello.id !== s.id) throw new NoCoincide("número");
  if (sello.listHash.toLowerCase() !== s.listHash.toLowerCase()) throw new NoCoincide("lista");
  if (sello.count !== s.count) throw new NoCoincide("personas");
  if (sello.numWinners !== s.numWinners) throw new NoCoincide("premios");
  if (sello.round !== s.round) throw new NoCoincide("ronda");
}

/** Lo grabado es lo calculado. Lanza `NoCoincide` con lo primero que no da. */
export function revisarResultado(r: Resultado, s: SorteoDelEnlace, calculado: LoCalculado): void {
  if (r.round !== s.round) throw new NoCoincide("ronda grabada");
  if (r.randomness.toLowerCase() !== calculado.randomness.toLowerCase()) throw new NoCoincide("semilla");
  if (r.winners.length !== calculado.winners.length || r.winners.some((w, i) => w !== calculado.winners[i])) throw new NoCoincide("ganadores");
}

/**
 * Lo que dice un registro para este sorteo: `grabado` si ya está el resultado, `sellado` si solo está el sello y
 * `nada` si la cadena todavía no lo muestra. Lanza `NoCoincide` si lo que hay no es lo del enlace.
 *
 * Un sello que todavía no aparece no es motivo para decir que el enlace está mal: un RPC puede ir un ledger atrás del
 * que confirmó el sello. Se sigue mirando, y pasado el tope de la regla el celular juega igual.
 */
export function leerLoQueHay(reg: Registro, s: SorteoDelEnlace, calculado?: LoCalculado): "grabado" | "sellado" | "nada" {
  if (reg.sello) revisarSello(reg.sello, s);
  if (reg.resultado) {
    if (calculado) revisarResultado(reg.resultado, s, calculado);
    return "grabado";
  }
  return reg.sello ? "sellado" : "nada";
}

/** Los RPC de la red del contrato, empezando por el suyo: si uno no contesta, la vuelta siguiente pregunta al otro. */
export function rpcsDe(contrato: ContratoOficial): string[] {
  return [contrato.rpcUrl, ...RPC_LISTAS[contrato.red].filter((u) => u !== contrato.rpcUrl)];
}

/**
 * Cada cuánto se vuelve a mirar, según cuánto se lleva esperando. Al principio seguido: la sala arranca el juego en
 * cuanto queda grabado, y cada segundo que el celular tarda en enterarse es un segundo de atraso. Pasado el primer
 * minuto, más espaciado: decenas de celulares preguntando a un RPC público no tienen que parecer un ataque.
 */
export function pausaTras(ms: number): number {
  if (ms < 60_000) return 1_500;
  return 4_000;
}

export interface Opciones {
  leer?: Leer;
  /** Se llama una vez, si pasa `avisoTardeMs` de la regla sin que aparezca grabado. */
  alTardar?: () => void;
  signal?: AbortSignal;
  ahora?: () => number;
  dormir?: (ms: number) => Promise<void>;
}

const leerDeVerdad: Leer = async (contrato, id) => {
  const { leerRegistro } = await import("../stellar/registro");
  // Sin la espera larga entre reintentos de la verificación: la próxima vuelta ya es el reintento.
  return leerRegistro(contrato, id, fetch, 300);
};

const dormirDeVerdad = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Una lectura, con el RPC de esta vuelta. */
async function leerConRpc(leer: Leer, s: SorteoDelEnlace, vuelta: number): Promise<Registro> {
  const rpcs = rpcsDe(s.contrato);
  const rpcUrl = rpcs[vuelta % rpcs.length] ?? s.contrato.rpcUrl;
  return leer({ ...s.contrato, rpcUrl }, s.id);
}

/**
 * Lo que hay ahora, en una sola lectura: lo usa la vista al abrirse, para avisar enseguida si el enlace no es de este
 * sorteo y para bajar de antemano lo que hace falta para leer la cadena. `null` si la cadena no contestó.
 */
export async function mirarUnaVez(s: SorteoDelEnlace, leer: Leer = leerDeVerdad): Promise<"grabado" | "sellado" | "nada" | null> {
  let reg: Registro;
  try {
    reg = await leerConRpc(leer, s, 0);
  } catch {
    return null;
  }
  return leerLoQueHay(reg, s);
}

/**
 * Espera a que el sorteo quede grabado y comprueba que es el que calculó el celular. Termina con `grabado` cuando lo
 * ve, y con `sin-confirmar` si pasó lo que dice la regla (`largaIgualTrasMs`, en `espectador-regla.ts`) sin verlo: el
 * celular juega igual y no se queda colgado. Lanza `NoCoincide` si lo que hay no es este sorteo. Un RPC que no
 * contesta no corta nada: se pregunta de nuevo en la vuelta siguiente, al otro.
 */
export async function esperarElGrabado(s: SorteoDelEnlace, calculado: LoCalculado, op: Opciones = {}): Promise<"grabado" | "sin-confirmar"> {
  const leer = op.leer ?? leerDeVerdad;
  const ahora = op.ahora ?? (() => Date.now());
  const dormir = op.dormir ?? dormirDeVerdad;
  const regla = reglaDelShow(true);
  const desde = ahora();
  let avisado = false;
  for (let vuelta = 0; ; vuelta++) {
    if (op.signal?.aborted) return "sin-confirmar";
    let reg: Registro | null = null;
    try {
      reg = await leerConRpc(leer, s, vuelta);
    } catch {
      reg = null;
    }
    if (reg && leerLoQueHay(reg, s, calculado) === "grabado") return "grabado";
    const lleva = ahora() - desde;
    if (lleva >= regla.largaIgualTrasMs) return "sin-confirmar";
    if (!avisado && lleva >= regla.avisoTardeMs) {
      avisado = true;
      op.alTardar?.();
    }
    await dormir(Math.min(pausaTras(lleva), Math.max(0, regla.largaIgualTrasMs - lleva)));
  }
}
