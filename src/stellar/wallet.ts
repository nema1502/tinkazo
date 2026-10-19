import { Keypair, contract } from "@stellar/stellar-sdk";
import { network } from "./config";
import { GUEST_KEY, WALLET_ERRORS, fundWithFriendbot, type SignedTx, type WalletAdapter } from "./wallet-lite";

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

// Freighter, el saldo, el grifo, los errores y la wallet activa no necesitan el
// SDK: viven en `wallet-lite.ts` y se reexportan acá.
export * from "./wallet-lite";

/* ------------------------------------------------------------------ invitada */

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

  /**
   * Retoma la cuenta guardada. Nunca genera una llave ni llama al grifo: si no
   * hay llave o está corrupta devuelve null y la sesión queda cerrada.
   */
  async restore(): Promise<string | null> {
    if (network.name !== "testnet") return null;
    try {
      const secret = localStorage.getItem(GUEST_KEY);
      if (!secret) return null;
      this.#keypair = Keypair.fromSecret(secret);
      this.address = this.#keypair.publicKey();
      return this.address;
    } catch {
      this.#keypair = null;
      this.address = null;
      return null;
    }
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

export const guestWallet = new GuestWallet();
