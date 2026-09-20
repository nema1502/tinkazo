import { contract, rpc } from "@stellar/stellar-sdk";
import { network } from "./config";
import { activeWallet } from "./wallet";

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

/** Códigos de error del contrato. Son ABI pública: nunca se renumeran. */
export const CONTRACT_ERRORS: Record<number, string> = {
  1: "notFound",
  2: "alreadyDrawn",
  3: "tooFewEntries",
  4: "badWinnerCount",
  5: "roundTooSoon",
  6: "roundTooFar",
  7: "roundNotReady",
  8: "invalidSignature",
  9: "metaTooLong",
};

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

let cached: { client: TinkazoClient; publicKey: string | null } | null = null;

/**
 * Cliente listo para firmar con la wallet activa. Se recrea si cambia la
 * cuenta, porque la firma va atada a la dirección que paga la transacción.
 */
export async function getClient(): Promise<TinkazoClient> {
  if (!network.contractId) throw new Error("no-contract-on-network");
  const wallet = activeWallet();
  const publicKey = wallet?.address ?? null;
  if (cached && cached.publicKey === publicKey) return cached.client;

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
  cached = { client, publicKey };
  return client;
}

/** Olvida el cliente en memoria. Se llama al cambiar de wallet. */
export function resetClient(): void {
  cached = null;
}

/**
 * Traduce un error de una invocación a una clave de i18n.
 * Devuelve `errors.<clave>` para que la interfaz muestre algo entendible.
 */
export function errorKey(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  const m = /Error\(Contract,\s*#(\d+)\)/.exec(msg);
  if (m?.[1]) {
    const named = CONTRACT_ERRORS[Number(m[1])];
    if (named) return named;
  }
  if (/insufficient|underfunded|txInsufficientBalance/i.test(msg)) return "noFunds";
  if (/User (declined|rejected)|denied|cancel/i.test(msg)) return "userRejected";
  if (/fetch|network|timeout|ECONN|Failed to/i.test(msg)) return "rpcDown";
  return "unknown";
}
