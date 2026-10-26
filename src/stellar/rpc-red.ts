import { RPC_LISTAS, network, type NetworkName } from "./config";
import { esDeRed, textoDelError } from "./errores";

/**
 * Dos RPC por red, con cambio automático.
 *
 * Hasta el 25 de octubre de 2026 el sitio hablaba con un solo RPC por red, y en
 * mainnet es el de un tercero (la SDF no ofrece uno público): si se caía, nadie
 * podía sellar. Ahora cada red tiene una lista, en orden. El primero es el de
 * siempre; el segundo entra cuando el primero se corta, tarda de más (4 s),
 * contesta 429 o 5xx, trae un ledger viejo o es de otra red. A los 10 minutos se
 * vuelve al primero.
 *
 * Dos reglas:
 *
 * - **Un intento entero usa un solo RPC.** Quien arma, firma, manda y confirma
 *   un sello lo hace con `fijar()`: mientras está fijado, el vigente no cambia,
 *   y un cambio que se pida queda para cuando se suelte. Reenviar la misma
 *   transacción firmada a otro RPC es seguro (mismo hash, la red la aplica una
 *   vez), pero partir un intento en dos hace que las respuestas no se puedan
 *   comparar entre sí (el ledger de uno, el contrato de otro).
 * - **Solo cambian los cortes de RPC**, no lo que la red contesta con sentido
 *   (un error del contrato, una transacción rechazada): eso es igual en los dos.
 *
 * Lógica pura, sin el SDK: la usan `contract.ts` (que sí lo tiene), `seals.ts`
 * y el chequeo de la red.
 */

/** Cuánto se queda en el segundo antes de volver a probar el primero. */
export const VUELTA_AL_PRIMERO_MS = 10 * 60_000;

/** Cuánto se le da a un pedido al RPC antes de darlo por lento. */
export const TOPE_DE_PEDIDO_MS = 4000;

export interface CambioDeRpc {
  de: string;
  a: string;
  motivo: string;
  /** Cuándo (ms). */
  cuando: number;
}

export interface RpcRed {
  readonly red: NetworkName;
  /** El RPC vigente. Vuelve al primero si pasaron `VUELTA_AL_PRIMERO_MS` desde el cambio. */
  actual(): string;
  /** Todos, en orden: el primero es el de siempre. */
  lista(): readonly string[];
  /** Pasa al otro RPC. Fijado, queda pendiente hasta que se suelte. Devuelve el vigente. */
  cambiar(motivo: string): string;
  /**
   * Un error dice que el RPC no sirve (se cortó, tardó, 429, 5xx): cambia al
   * otro. Devuelve si cambió. Un error que no es del RPC no cambia nada.
   */
  fallo(e: unknown): boolean;
  /** Fija el vigente mientras dura un intento. Devuelve cómo soltarlo (varias veces es lo mismo que una). */
  fijar(): () => void;
  /** El último cambio, para el registro. */
  ultimoCambio(): CambioDeRpc | null;
}

/** Este error dice que el RPC no está sirviendo, y no que la red dijo que no. */
export function esFalloDeRpc(e: unknown): boolean {
  return esDeRed(e) || /status code 429|HTTP 429|too many requests/i.test(textoDelError(e));
}

export function crearRpcRed(red: NetworkName, urls: readonly string[], opciones: { ahora?: () => number } = {}): RpcRed {
  const ahora = opciones.ahora ?? Date.now;
  const lista = [...new Set(urls)];
  if (lista.length === 0) throw new Error("rpc-red: la lista de RPC está vacía");
  let i = 0;
  let desde = 0;
  let fijados = 0;
  let pendiente: string | null = null;
  let ultimo: CambioDeRpc | null = null;

  const aplicar = (motivo: string): void => {
    if (lista.length < 2) return;
    const de = lista[i] as string;
    i = (i + 1) % lista.length;
    desde = ahora();
    ultimo = { de, a: lista[i] as string, motivo, cuando: desde };
  };

  const actual = (): string => {
    // Pasado el tiempo, se vuelve al primero (si no hay un intento en curso que lo necesite quieto).
    if (i !== 0 && fijados === 0 && ahora() - desde >= VUELTA_AL_PRIMERO_MS) {
      ultimo = { de: lista[i] as string, a: lista[0] as string, motivo: "vuelta-al-primero", cuando: ahora() };
      i = 0;
    }
    return lista[i] as string;
  };

  const cambiar = (motivo: string): string => {
    if (fijados > 0) {
      pendiente = motivo;
      return actual();
    }
    aplicar(motivo);
    return actual();
  };

  return {
    red,
    actual,
    lista: () => lista,
    cambiar,
    fallo(e) {
      if (!esFalloDeRpc(e) || lista.length < 2) return false;
      // Fijado, el cambio queda pendiente para cuando se suelte; igual cuenta como pedido.
      cambiar(textoDelError(e).slice(0, 80) || "fallo");
      return true;
    },
    fijar() {
      fijados++;
      let suelto = false;
      return () => {
        if (suelto) return;
        suelto = true;
        fijados = Math.max(0, fijados - 1);
        if (fijados === 0 && pendiente !== null) {
          const motivo = pendiente;
          pendiente = null;
          aplicar(motivo);
        }
      };
    },
    ultimoCambio: () => ultimo,
  };
}

const porRed = new Map<NetworkName, RpcRed>();

/**
 * Los RPC de una red (por defecto la de este build). El primero es el de la
 * configuración, que puede venir del registro de contratos (`deployments.json`).
 */
export function rpcRed(red: NetworkName = network.name): RpcRed {
  let r = porRed.get(red);
  if (!r) {
    const primero = red === network.name ? network.rpcUrl : RPC_LISTAS[red][0];
    r = crearRpcRed(red, [primero, ...RPC_LISTAS[red]]);
    porRed.set(red, r);
  }
  return r;
}

/** El RPC vigente de esta red. */
export const rpcActual = (red: NetworkName = network.name): string => rpcRed(red).actual();

/**
 * Para quien tiene una dirección de RPC en la mano (una lectura de la
 * verificación): la red a la que pertenece y el otro de su lista, si lo hay.
 */
export function respaldoDe(url: string): { red: NetworkName; otro: string } | null {
  for (const red of ["testnet", "mainnet"] as const) {
    const lista = rpcRed(red).lista();
    const donde = lista.indexOf(url);
    if (donde >= 0 && lista.length > 1) return { red, otro: lista[(donde + 1) % lista.length] as string };
  }
  return null;
}
