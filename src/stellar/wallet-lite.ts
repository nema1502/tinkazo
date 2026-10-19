import freighter from "@stellar/freighter-api";
import { network } from "./config";

/**
 * Lo de las wallets que no necesita el SDK de Stellar.
 *
 * El SDK pesa casi 700 KB sin comprimir y la ventana de ingreso lo bajaba
 * entero para preguntarle a Freighter si estaba instalada: dos segundos con
 * un celular y 4G lenta antes de ver las opciones (medición del 17 de octubre
 * de 2026). Acá vive todo lo que se puede hacer sin él: Freighter (que habla
 * con su extensión, no con la red), el saldo y el grifo (son un `fetch`), los
 * errores y cuál es la wallet activa. La cuenta de prueba, que sí necesita el
 * SDK para armar su par de llaves, sigue en `wallet.ts`, que además reexporta
 * todo esto: quien importe `wallet.ts` no nota la diferencia.
 */

export type WalletKind = "external" | "guest";

export interface SignedTx {
  signedTxXdr: string;
  signerAddress?: string;
}

export interface WalletAdapter {
  readonly kind: WalletKind;
  /** Nombre para la interfaz: "Freighter", "Cuenta de prueba"… */
  readonly label: string;
  /** Dirección activa, o null si no hay sesión. */
  readonly address: string | null;
  connect(): Promise<string>;
  disconnect(): Promise<void>;
  /**
   * Passphrase de la red donde está la wallet, o null si no se puede saber.
   * Sirve para avisar antes de firmar cuando la wallet está en otra red.
   */
  networkPassphrase(): Promise<string | null>;
  signTransaction(
    xdr: string,
    opts?: { networkPassphrase?: string; address?: string },
  ): Promise<SignedTx>;
}

/** Errores que la interfaz distingue para mostrar el mensaje correcto. */
export const WALLET_ERRORS = {
  notInstalled: "wallet-not-installed",
  rejected: "wallet-rejected",
  guestTestnetOnly: "guest-testnet-only",
  guestNotConnected: "guest-not-connected",
  friendbot: "friendbot-failed",
} as const;

/* ----------------------------------------------------------------- Freighter */

class FreighterWallet implements WalletAdapter {
  readonly kind = "external" as const;
  readonly label = "Freighter";
  address: string | null = null;

  /** ¿Está instalada la extensión? */
  static async installed(): Promise<boolean> {
    try {
      const { isConnected, error } = await freighter.isConnected();
      return !error && isConnected;
    } catch {
      return false;
    }
  }

  /** ¿Ya le diste permiso a este sitio? Pregunta sin abrir ningún popup. */
  static async allowed(): Promise<boolean> {
    try {
      const { isAllowed, error } = await freighter.isAllowed();
      return !error && isAllowed;
    } catch {
      return false;
    }
  }

  /** Retoma la sesión sin pedir permiso: solo si ya estaba concedido. */
  async restore(): Promise<string | null> {
    if (!(await FreighterWallet.allowed())) return null;
    const { address, error } = await freighter.getAddress();
    if (error || !address) return null;
    this.address = address;
    return address;
  }

  async connect(): Promise<string> {
    if (!(await FreighterWallet.installed())) {
      throw new Error(WALLET_ERRORS.notInstalled);
    }
    const { address, error } = await freighter.requestAccess();
    if (error || !address) throw new Error(WALLET_ERRORS.rejected, { cause: error });
    this.address = address;
    return address;
  }

  async disconnect(): Promise<void> {
    // Freighter no expone "cerrar sesión": la app olvida la dirección y la
    // próxima conexión vuelve a pedir permiso si el usuario lo revocó.
    this.address = null;
  }

  async networkPassphrase(): Promise<string | null> {
    try {
      const { networkPassphrase, error } = await freighter.getNetwork();
      return error ? null : (networkPassphrase ?? null);
    } catch {
      return null;
    }
  }

  async signTransaction(
    xdr: string,
    opts?: { networkPassphrase?: string; address?: string },
  ): Promise<SignedTx> {
    const { signedTxXdr, signerAddress, error } = await freighter.signTransaction(xdr, {
      networkPassphrase: opts?.networkPassphrase ?? network.networkPassphrase,
      ...(opts?.address ? { address: opts.address } : {}),
    });
    if (error) throw new Error(WALLET_ERRORS.rejected, { cause: error });
    return { signedTxXdr, signerAddress };
  }
}

/* ------------------------------------------------------------------ invitada */

/** Dónde guarda su llave la cuenta de prueba (ver `GuestWallet` en `wallet.ts`). */
export const GUEST_KEY = "tinkazo.guest.secret.testnet";

/** Hay una cuenta de prueba guardada en este navegador. */
export function guestStored(): boolean {
  try {
    return !!localStorage.getItem(GUEST_KEY);
  } catch {
    return false;
  }
}

/** La cuenta de prueba solo se ofrece en testnet. */
export const guestAvailable = (): boolean => network.name === "testnet";

/* --------------------------------------------------------------- fondos */

/**
 * Crea la cuenta en la red con XLM de prueba. Idempotente: si ya existe, no falla.
 *
 * Sirve para cualquier cuenta, no solo la de prueba que genera el navegador:
 * una cuenta de Google recién creada tampoco tiene con qué pagar la comisión,
 * y este es el grifo oficial de testnet.
 */
export async function fundWithFriendbot(address: string): Promise<void> {
  if (!network.friendbotUrl) return;
  try {
    const res = await fetch(`${network.friendbotUrl}/?addr=${encodeURIComponent(address)}`);
    // Un 400 suele ser "la cuenta ya existe": eso no es un error para nosotros.
    if (!res.ok && res.status !== 400) throw new Error(`friendbot ${res.status}`);
  } catch (e) {
    throw new Error(WALLET_ERRORS.friendbot, { cause: e });
  }
}

/**
 * Cuántos XLM tiene una cuenta. `0` si no existe todavía.
 *
 * Se pregunta a Horizon y no al RPC porque el saldo es un dato de cuenta, no
 * de contrato, y Horizon lo devuelve de una.
 */
export async function xlmBalance(address: string): Promise<number> {
  const base = network.name === "mainnet"
    ? "https://horizon.stellar.org"
    : "https://horizon-testnet.stellar.org";
  try {
    const res = await fetch(`${base}/accounts/${encodeURIComponent(address)}`, {
      signal: AbortSignal.timeout(12_000),
    });
    // 404 es "la cuenta no existe todavía", que para esto es lo mismo que cero.
    if (res.status === 404) return 0;
    if (!res.ok) return -1;
    const body = (await res.json()) as { balances?: { asset_type?: string; balance?: string }[] };
    const native = body.balances?.find((b) => b.asset_type === "native");
    return Number(native?.balance ?? 0);
  } catch {
    // Sin respuesta no se afirma nada: -1 significa "no sé".
    return -1;
  }
}

/* -------------------------------------------------------------------- sesión */

export const freighterWallet = new FreighterWallet();

let active: WalletAdapter | null = null;

export const activeWallet = (): WalletAdapter | null => active;

export function setActiveWallet(w: WalletAdapter | null): void {
  active = w;
}

export const freighterAllowed = (): Promise<boolean> => FreighterWallet.allowed();

export const freighterInstalled = (): Promise<boolean> => FreighterWallet.installed();
