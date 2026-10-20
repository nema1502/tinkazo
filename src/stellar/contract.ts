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
 * La cuenta existe y no tiene con qué pagar la comisión. Cada quien lo cuenta a
 * su manera: la red dice `tx_insufficient_balance` (o `txINSUFFICIENT_BALANCE`),
 * Pollar lo guarda como `txInsufficientBalance` y le agrega "Insufficient XLM to
 * cover the network fee…", y un pago que no alcanza dice `underfunded`.
 *
 * Lo que NO entra, aunque se parezca: `tx_insufficient_fee` (ahí la cuenta puede
 * tener de sobra y es la comisión ofrecida la que quedó corta para lo que la red
 * cobra ahora), `tx_bad_seq` y el resto de los códigos de la red.
 */
const SIN_SALDO = /tx_?insufficient_?balance|insufficient\s+(?:xlm|balance|funds)|underfunded/i;
const COMISION_CORTA = /tx_?insufficient_?fee/i;
/**
 * La cuenta ni siquiera existe todavía en la red: simular falla con "Account not
 * found", y al enviar la red dice `tx_no_account`. Para quien trae su cuenta de
 * afuera (Freighter) es lo mismo que no tener saldo. Para una cuenta de Pollar
 * es que todavía no la abrieron, y se espera (ver `conCuentaLista`).
 */
const SIN_CUENTA = /account not found|tx_?no_?account/i;
/** Lo que lanza `conCuentaLista` cuando se esperó y la cuenta sigue sin existir. */
const CUENTA_NO_LISTA = /account-not-ready/;

/**
 * Este error es de falta de saldo, y de nada más: ni una comisión corta, ni una
 * cuenta que todavía no existe. Es lo único que dispara la ayuda de fondos.
 */
export const esSinSaldo = (e: unknown): boolean => errorKey(e) === "noFunds" && !esCuentaInexistente(e);

/** Este error dice que la cuenta no existe todavía en la red. */
export const esCuentaInexistente = (e: unknown): boolean => SIN_CUENTA.test(e instanceof Error ? e.message : String(e));

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
  if (CUENTA_NO_LISTA.test(msg)) return "accountNotReady";
  if (COMISION_CORTA.test(msg)) return "busy";
  if (SIN_SALDO.test(msg) || SIN_CUENTA.test(msg)) return "noFunds";
  if (/User (declined|rejected)|denied|cancel/i.test(msg)) return "userRejected";
  if (/fetch|network|timeout|ECONN|Failed to/i.test(msg)) return "rpcDown";
  // La red no la tomó: ocupada, con la secuencia corrida o vencida. No se
  // reintenta sola, porque si la primera hubiera entrado igual quedarían dos
  // sellos para el mismo evento.
  if (/TRY_AGAIN_LATER|txBadSeq|tx_bad_seq|txTooLate|tx_too_late/i.test(msg)) return "busy";
  // Entró y falló sin decir por qué (el SDK no puede leer el resultado): con
  // la red lenta, casi siempre es la ronda que quedó demasiado cerca.
  if (/Transaction failed!|tx-FAILED|txFailed|tx_failed/.test(msg)) return "busy";
  return "unknown";
}
