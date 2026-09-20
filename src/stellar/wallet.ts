import { Keypair, contract } from "@stellar/stellar-sdk";
import freighter from "@stellar/freighter-api";
import { network } from "./config";

/**
 * Identidad del organizador.
 *
 * Hay dos formas de firmar y ambas cumplen el mismo contrato, para que la
 * interfaz no sepa cuál está activa:
 *
 * - `external`: Freighter, la wallet de navegador del ecosistema Stellar. Es la
 *   única que existe en mainnet.
 * - `guest`: una cuenta de prueba que el navegador genera y fondea con
 *   friendbot. Solo testnet, solo para probar sin instalar nada.
 *
 * Los participantes de un sorteo nunca pasan por acá: no necesitan cuenta.
 *
 * Agregar más wallets (xBull, Lobstr, Albedo…) es escribir otra clase que
 * cumpla `WalletAdapter`. Se evaluó Stellar Wallets Kit y se descartó por ahora:
 * arrastra WalletConnect y dependencias nativas que rompen la instalación en CI
 * para un sitio estático que no las necesita.
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

const GUEST_KEY = "tinkazo.guest.secret.testnet";

/**
 * Cuenta de prueba: el navegador genera el par de llaves y friendbot la fondea.
 * La llave vive solo en este dispositivo, en localStorage, y solo sirve en
 * testnet, donde el XLM no vale nada. Nunca se usa en mainnet.
 */
class GuestWallet implements WalletAdapter {
  readonly kind = "guest" as const;
  readonly label = "Cuenta de prueba";
  address: string | null = null;
  #keypair: Keypair | null = null;

  /** Hay una cuenta de prueba guardada en este navegador. */
  static stored(): boolean {
    try {
      return !!localStorage.getItem(GUEST_KEY);
    } catch {
      return false;
    }
  }

  async connect(): Promise<string> {
    if (network.name !== "testnet") throw new Error(WALLET_ERRORS.guestTestnetOnly);

    let secret: string | null = null;
    try {
      secret = localStorage.getItem(GUEST_KEY);
    } catch {
      /* almacenamiento bloqueado: la cuenta dura lo que la pestaña */
    }

    let fresh = false;
    if (secret) {
      this.#keypair = Keypair.fromSecret(secret);
    } else {
      this.#keypair = Keypair.random();
      fresh = true;
      try {
        localStorage.setItem(GUEST_KEY, this.#keypair.secret());
      } catch {
        /* sin almacenamiento, la llave se pierde al recargar */
      }
    }
    this.address = this.#keypair.publicKey();
    if (fresh) await fundWithFriendbot(this.address);
    return this.address;
  }

  async disconnect(): Promise<void> {
    this.address = null;
    this.#keypair = null;
  }

  async networkPassphrase(): Promise<string | null> {
    return network.networkPassphrase;
  }

  async signTransaction(xdr: string, opts?: { networkPassphrase?: string }): Promise<SignedTx> {
    if (!this.#keypair) throw new Error(WALLET_ERRORS.guestNotConnected);
    const signer = contract.basicNodeSigner(
      this.#keypair,
      opts?.networkPassphrase ?? network.networkPassphrase,
    );
    return signer.signTransaction(xdr);
  }

  /** Borra la llave de este dispositivo. */
  forget(): void {
    try {
      localStorage.removeItem(GUEST_KEY);
    } catch {
      /* nada que borrar */
    }
    this.address = null;
    this.#keypair = null;
  }

  /** Para que el usuario pueda exportar la llave si quiere conservar la cuenta. */
  secret(): string | null {
    return this.#keypair?.secret() ?? null;
  }
}

/** Crea la cuenta en la red con XLM de prueba. Idempotente: si ya existe, no falla. */
async function fundWithFriendbot(address: string): Promise<void> {
  if (!network.friendbotUrl) return;
  try {
    const res = await fetch(`${network.friendbotUrl}/?addr=${encodeURIComponent(address)}`);
    // Un 400 suele ser "la cuenta ya existe": eso no es un error para nosotros.
    if (!res.ok && res.status !== 400) throw new Error(`friendbot ${res.status}`);
  } catch (e) {
    throw new Error(WALLET_ERRORS.friendbot, { cause: e });
  }
}

/* -------------------------------------------------------------------- sesión */

export const freighterWallet = new FreighterWallet();
export const guestWallet = new GuestWallet();

let active: WalletAdapter | null = null;

export const activeWallet = (): WalletAdapter | null => active;

export function setActiveWallet(w: WalletAdapter | null): void {
  active = w;
}

export const freighterInstalled = (): Promise<boolean> => FreighterWallet.installed();

/** La cuenta de prueba solo se ofrece en testnet. */
export const guestAvailable = (): boolean => network.name === "testnet";

export const guestStored = (): boolean => GuestWallet.stored();
