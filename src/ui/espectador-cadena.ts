import type { Registro, Resultado, Sello } from "../protocol/verificacion";
import type { ContratoOficial } from "../stellar/oficiales";
import { RPC_LISTAS } from "../stellar/config";
// Sin el SDK de Stellar arriba: `leerRegistro` lo pide recién al leer.
import { esLimiteDelRpc, leerRegistro } from "../stellar/registro";
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
 * es lo que trae el enlace (la huella de la lista, cuántas personas, cuántos premios, el número de la ronda y el
 * premio) y que lo grabado es lo que calculó el celular con el protocolo (la semilla y los ganadores). Si algo no
 * coincide, no hay show.
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
  /** El premio que muestra el enlace, si trae uno: el sello lo guarda (`meta`, recortado a 160). */
  premio?: string;
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
  // Sin premio, el sello guarda un texto de siempre y el celular no muestra ninguno: no hay nada que comparar.
  if (s.premio && sello.meta !== s.premio.slice(0, 160)) throw new NoCoincide("premio");
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
 * Cada cuánto se vuelve a mirar, según cuánto se lleva esperando. Todos los celulares de la sala empiezan a la vez
 * (ronda más el margen), salen por el mismo wifi y le preguntan a los mismos RPC públicos con los que la compu de la
 * sala lanza el sorteo: si el RPC le corta a esa dirección por demasiados pedidos, también frena a la sala. Por eso
 * cada celular espera entre 3 y 5 s, al azar para que no pregunten juntos, y pasado el primer minuto entre 6 y 10 s.
 * Enterarse unos segundos más tarde no cuesta nada: el celular va detrás de la sala igual.
 */
export function pausaTras(ms: number, azar: () => number = Math.random): number {
  const [desde, hasta] = ms < 60_000 ? [3_000, 5_000] : [6_000, 10_000];
  return desde + azar() * (hasta - desde);
}

/** El primer vistazo de cada celular sale con un desfase al azar de hasta esto: no todos en el mismo segundo. */
export const DESFASE_MAX_MS = 3_000;

/** Si el RPC contesta que son demasiados pedidos, la pausa se duplica, hasta esta cantidad de veces la de siempre. */
export const FRENO_MAX = 8;

export interface Opciones {
  leer?: Leer;
  /** Se llama una vez, si pasa `avisoTardeMs` de la regla con la cadena mostrándolo sellado y sin resultado. */
  alTardar?: () => void;
  signal?: AbortSignal;
  ahora?: () => number;
  dormir?: (ms: number) => Promise<void>;
  /** El azar del desfase y de las pausas, entre 0 y 1: en las pruebas, fijo. */
  azar?: () => number;
  /**
   * La primera lectura, no antes de esta hora (en el reloj de `ahora`): la cadena no acepta el sorteo grabado antes de
   * su margen (`espectador-regla.ts`), y leer antes es carga de más para el RPC con toda la sala mirando.
   */
  noAntesDe?: number;
  /**
   * Si está, una cadena que no contesta no termina la espera: pasado el tope se avisa una vez con esto y se sigue mirando
   * hasta verlo grabado. Lo usa el celular a la par, que no suelta su final sin ver lo grabado (`espectador.ts`).
   */
  alNoContestar?: () => void;
}

const leerDeVerdad: Leer = async (contrato, id) => {
  // Un solo intento: la próxima vuelta ya es el reintento, y los reintentos seguidos de cien celulares son una ráfaga.
  return leerRegistro(contrato, id, fetch, 0, 1);
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
 * ve. Lanza `NoCoincide` si lo que hay no es este sorteo. Un RPC que no contesta no corta nada: se pregunta de nuevo en
 * la vuelta siguiente, al otro. El tope de la regla (`largaIgualTrasMs`, en `espectador-regla.ts`) vale según lo que
 * contesta la cadena:
 *
 * - Sellado y sin resultado: la sala todavía no lo lanzó (quien organiza tiene que tocar Lanzar el sorteo, o volvió a
 *   la página). Se sigue esperando, sin tope, y pasado `avisoTardeMs` se avisa: jugar ahora sería coronar antes que la
 *   sala.
 * - No contesta: pasado el tope sin ninguna respuesta, termina con `sin-confirmar` y el celular juega igual con lo que
 *   calculó (los mismos ganadores que va a grabar el contrato). No se queda colgado. Con `alNoContestar` (el celular a
 *   la par, que ya jugó hasta su momento decisivo) no termina: avisa una vez y sigue mirando. Un RPC que dice que son
 *   demasiados pedidos (429) sí contestó: la cadena está viva, y con cien celulares en el mismo wifi es lo esperable.
 * - Contesta, pero el sello de este número nunca aparece: pasado el tope, el enlace no es de un sorteo sellado
 *   (`NoCoincide`). Un servicio que va un ledger atrás lo muestra en segundos.
 */
export async function esperarElGrabado(s: SorteoDelEnlace, calculado: LoCalculado, op: Opciones = {}): Promise<"grabado" | "sin-confirmar"> {
  const leer = op.leer ?? leerDeVerdad;
  const ahora = op.ahora ?? (() => Date.now());
  const dormir = op.dormir ?? dormirDeVerdad;
  const azar = op.azar ?? Math.random;
  const regla = reglaDelShow(true);
  // Antes de que la cadena pueda tener el sorteo grabado no hay nada que leer. Los topes cuentan desde la primera lectura.
  const antes = (op.noAntesDe ?? 0) - ahora();
  if (antes > 0) await dormir(antes);
  const desde = ahora();
  /** La última vez que la cadena contestó: el tope de una cadena muda cuenta desde ahí. */
  let contesto = desde;
  let selloVisto = false;
  let avisado = false;
  let mudoAvisado = false;
  let freno = 1;
  // Los celulares de la sala llegan acá en el mismo segundo: cada uno sale con su desfase.
  await dormir(azar() * DESFASE_MAX_MS);
  for (let vuelta = 0; ; vuelta++) {
    if (op.signal?.aborted) return "sin-confirmar";
    let reg: Registro | null = null;
    let limite = false;
    try {
      reg = await leerConRpc(leer, s, vuelta);
      freno = 1;
    } catch (e) {
      reg = null;
      limite = esLimiteDelRpc(e);
      if (limite) freno = Math.min(freno * 2, FRENO_MAX);
    }
    const hay = reg ? leerLoQueHay(reg, s, calculado) : null;
    if (hay === "grabado") return "grabado";
    const t = ahora();
    const lleva = t - desde;
    // Un 429 también es una respuesta: el RPC está vivo y frena a esta dirección.
    if (hay || limite) contesto = t;
    if (hay === "sellado") selloVisto = true;
    if (hay === "nada" && !selloVisto && lleva >= regla.largaIgualTrasMs) throw new NoCoincide("sello");
    if (!hay && t - contesto >= regla.largaIgualTrasMs) {
      if (!op.alNoContestar) return "sin-confirmar";
      if (!mudoAvisado) {
        mudoAvisado = true;
        op.alNoContestar();
      }
    }
    if (!avisado && selloVisto && lleva >= regla.avisoTardeMs) {
      avisado = true;
      op.alTardar?.();
    }
    await dormir(pausaTras(lleva, azar) * freno);
  }
}
