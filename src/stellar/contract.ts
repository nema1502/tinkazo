import { Keypair, contract, rpc, xdr } from "@stellar/stellar-sdk";
import { network } from "./config";
import { rpcRed } from "./rpc-red";
import { activeWallet, type WalletAdapter } from "./wallet-lite";

/**
 * Cliente del contrato `tinkazo-raffle`.
 *
 * El cliente lee la interfaz del contrato desde la red, así que los tipos de
 * abajo solo describen lo que la app llama. Si el contrato cambia, la llamada
 * falla en tiempo de ejecución con un error claro en vez de compilar mal.
 */

export type RaffleStatus = { tag: "Sealed" } | { tag: "Drawn" };

export interface Raffle {
  id: bigint;
  organizer: string;
  list_hash: Buffer | Uint8Array;
  count: number;
  num_winners: number;
  round: bigint;
  sealed_at: bigint;
  sealed_ledger: number;
  meta: string;
  status: RaffleStatus;
}

export interface Draw {
  raffle_id: bigint;
  round: bigint;
  signature: Buffer | Uint8Array;
  randomness: Buffer | Uint8Array;
  winners: number[];
  drawn_at: bigint;
  drawn_ledger: number;
}

// Qué le pasó a una transacción vive en `errores.ts`, sin el SDK: la pantalla
// lo usa sin bajarlo. Se reexporta para quien lo importaba de acá.
export { CONTRACT_ERRORS, errorKey, esCuentaInexistente, esSinSaldo } from "./errores";

interface TinkazoContract {
  seal: (
    args: {
      organizer: string;
      list_hash: Buffer;
      count: number;
      num_winners: number;
      round: bigint;
      meta: string;
    },
    options?: contract.MethodOptions,
  ) => Promise<contract.AssembledTransaction<contract.Result<bigint>>>;
  draw: (
    args: { raffle_id: bigint; signature: Buffer },
    options?: contract.MethodOptions,
  ) => Promise<contract.AssembledTransaction<contract.Result<Draw>>>;
  get_raffle: (
    args: { raffle_id: bigint },
    options?: contract.MethodOptions,
  ) => Promise<contract.AssembledTransaction<Raffle | undefined>>;
  get_draw: (
    args: { raffle_id: bigint },
    options?: contract.MethodOptions,
  ) => Promise<contract.AssembledTransaction<Draw | undefined>>;
  next_id: (options?: contract.MethodOptions) => Promise<contract.AssembledTransaction<bigint>>;
}

export type TinkazoClient = contract.Client & TinkazoContract;

const servidores = new Map<string, rpc.Server>();
const servidorDe = (url: string): rpc.Server => {
  let s = servidores.get(url);
  if (!s) {
    s = new rpc.Server(url);
    servidores.set(url, s);
  }
  return s;
};

/**
 * El servidor del RPC vigente (`rpc-red.ts`). Cada llamada mira cuál es en ese
 * momento, así que si el primero se cae y la red pasa al segundo, quien usa
 * `server.getTransaction(...)` o `server.sendTransaction(...)` no se entera. Un
 * intento de sellar fija el vigente mientras dura (`rpcRed().fijar()`): no se parte
 * entre dos RPC.
 */
export const server: rpc.Server = new Proxy({} as rpc.Server, {
  get(_destino, propiedad) {
    const s = servidorDe(rpcRed().actual());
    const v = Reflect.get(s, propiedad, s) as unknown;
    return typeof v === "function" ? (v as (...args: unknown[]) => unknown).bind(s) : v;
  },
});

interface ClienteGuardado {
  client: Promise<TinkazoClient>;
  publicKey: string | null;
  wallet: WalletAdapter | null;
  /** El RPC con el que se armó: el cliente lee la interfaz del contrato de ahí y simula contra él. */
  rpc: string;
  /** Cuándo se pidió (ms), y si ya está armado. */
  desde: number;
  listo: boolean;
}

let cached: ClienteGuardado | null = null;

/**
 * Un cliente que se está armando hace más que esto no se espera más: se pide
 * otro. Puede ser un pedido que quedó colgado (se cambió de wifi mientras se
 * preparaba el sello) y esperarlo dejaría el sello en "Preparando…" para siempre.
 * Medido el 21 de octubre de 2026 en la testnet: lo normal es 0,6 a 1,1 s, y la
 * consulta más lenta que se vio contestó a los 13,8 s.
 */
export const CLIENTE_VIEJO_MS = 10_000;

/**
 * Cliente listo para firmar con la wallet activa. Se recrea si cambia la
 * cuenta o la wallet, porque la firma va atada a la dirección que paga la
 * transacción y a quien la firma. Antes había que olvidarlo a mano al cambiar
 * de wallet, y eso obligaba a bajar el SDK solo para retomar una sesión.
 *
 * Armarlo baja la interfaz del contrato de la red: dos consultas al RPC, una
 * detrás de la otra (la instancia del contrato y su código). Por eso se arma de
 * antemano, al abrir la sesión (`precalentarSello` en anchor.ts), y quien lo pide
 * mientras se está armando espera ese mismo pedido en vez de hacer otro. Si falla,
 * no queda guardado: el próximo pedido lo vuelve a intentar.
 */
export function getClient(): Promise<TinkazoClient> {
  if (!network.contractId) return Promise.reject(new Error("no-contract-on-network"));
  const wallet = activeWallet();
  const publicKey = wallet?.address ?? null;
  const rpcUrl = rpcRed().actual();
  const c = cached;
  if (c && c.publicKey === publicKey && c.wallet === wallet && c.rpc === rpcUrl && (c.listo || Date.now() - c.desde < CLIENTE_VIEJO_MS)) return c.client;

  const nuevo: ClienteGuardado = {
    client: contract.Client.from<TinkazoContract>({
      contractId: network.contractId,
      networkPassphrase: network.networkPassphrase,
      rpcUrl,
      ...(publicKey ? { publicKey } : {}),
      ...(wallet
        ? {
            signTransaction: (xdr: string, opts?: { networkPassphrase?: string; address?: string }) =>
              wallet.signTransaction(xdr, opts),
          }
        : {}),
    }),
    publicKey,
    wallet,
    rpc: rpcUrl,
    desde: Date.now(),
    listo: false,
  };
  cached = nuevo;
  nuevo.client.then(
    () => {
      nuevo.listo = true;
    },
    () => {
      if (cached === nuevo) cached = null;
    },
  );
  return nuevo.client;
}

/**
 * Olvida el cliente en memoria. Al cambiar de wallet ya no hace falta
 * (`getClient` lo nota solo); queda para forzarlo.
 */
export function resetClient(): void {
  cached = null;
}

/**
 * La red ya conoce esta cuenta, vista por el RPC: el mismo que simula.
 *
 * No se usa `server.getAccount`: ante cualquier fallo, hasta un corte de red, el
 * SDK contesta "Account not found", y no se podría distinguir una cuenta que
 * todavía no existe de una consulta que no llegó. Acá un corte lanza, y una
 * cuenta que no existe devuelve `false`.
 */
export async function accountOnRpc(address: string): Promise<boolean> {
  const key = xdr.LedgerKey.account(new xdr.LedgerKeyAccount({ accountId: Keypair.fromPublicKey(address).xdrPublicKey() }));
  return (await server.getLedgerEntries(key)).entries.length > 0;
}
