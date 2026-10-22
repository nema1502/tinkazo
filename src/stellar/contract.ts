import { Keypair, contract, rpc, xdr } from "@stellar/stellar-sdk";
import { network } from "./config";
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

export const server = new rpc.Server(network.rpcUrl);

let cached: { client: TinkazoClient; publicKey: string | null; wallet: WalletAdapter | null } | null = null;

/**
 * Cliente listo para firmar con la wallet activa. Se recrea si cambia la
 * cuenta o la wallet, porque la firma va atada a la dirección que paga la
 * transacción y a quien la firma. Antes había que olvidarlo a mano al cambiar
 * de wallet, y eso obligaba a bajar el SDK solo para retomar una sesión.
 */
export async function getClient(): Promise<TinkazoClient> {
  if (!network.contractId) throw new Error("no-contract-on-network");
  const wallet = activeWallet();
  const publicKey = wallet?.address ?? null;
  if (cached && cached.publicKey === publicKey && cached.wallet === wallet) return cached.client;

  const client = await contract.Client.from<TinkazoContract>({
    contractId: network.contractId,
    networkPassphrase: network.networkPassphrase,
    rpcUrl: network.rpcUrl,
    ...(publicKey ? { publicKey } : {}),
    ...(wallet
      ? {
          signTransaction: (xdr: string, opts?: { networkPassphrase?: string; address?: string }) =>
            wallet.signTransaction(xdr, opts),
        }
      : {}),
  });
  cached = { client, publicKey, wallet };
  return client;
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
