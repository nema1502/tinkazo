import type { PollarClient, WalletInfo } from "@pollar/core";
import { network } from "./config";
import type { SignedTx, WalletAdapter } from "./wallet";

/**
 * Entrar con Google, sin instalar nada.
 *
 * Pollar (pollar.xyz) autentica con Google, GitHub o correo y le da al
 * organizador una cuenta de Stellar cuya llave custodia Pollar en un módulo de
 * seguridad de AWS. Es lo mismo que usa Vaquita.
 *
 * La diferencia con Freighter está en quién envía la transacción. Freighter
 * firma y nos devuelve el XDR firmado, y nosotros lo mandamos a la red. Pollar,
 * en cambio, firma y envía de una sola vez contra su propio servidor, así que
 * esta wallet se marca con `submitsItself` y la capa de anclaje la trata
 * distinto: arma el XDR, se lo entrega, y después lee el resultado de la
 * transacción por RPC.
 *
 * Sin verificar de punta a punta: hace falta una sesión real de Google, y la
 * política de transacciones de la app en el panel de Pollar tiene que permitir
 * invocaciones de contrato. Si la rechaza, el error se muestra tal cual en vez
 * de disfrazarse.
 */

const KEY = "tinkazo.pollar.intent";

/** Lo que Pollar sabe de quien entró. Todo sale de la cuenta de Google. */
export interface Profile {
  name: string;
  mail: string;
  avatar: string;
}

export interface SubmittingWallet extends WalletAdapter {
  readonly submitsItself: true;
  /** Firma y envía en un solo paso. Devuelve el hash de la transacción. */
  signAndSubmit(xdr: string): Promise<string>;
}

export const pollarConfigured = (): boolean => !!import.meta.env.VITE_POLLAR_PUBLISHABLE_KEY;

class PollarWallet implements SubmittingWallet {
  readonly kind = "external" as const;
  readonly submitsItself = true as const;
  readonly label = "Google";
  address: string | null = null;
  #client: PollarClient | null = null;

  async #ensureClient(): Promise<PollarClient> {
    if (this.#client) return this.#client;
    const apiKey = import.meta.env.VITE_POLLAR_PUBLISHABLE_KEY;
    if (!apiKey) throw new Error("pollar-not-configured");
    const { PollarClient: Ctor } = await import("@pollar/core");
    this.#client = new Ctor({
      apiKey,
      stellarNetwork: network.name === "mainnet" ? "mainnet" : "testnet",
    });
    return this.#client;
  }

  /**
   * Arranca el login con Google. El navegador se va a Google y vuelve, así que
   * esta promesa puede no resolver nunca: quien la llama debe estar preparado
   * para que la página se recargue en el medio.
   */
  async connect(): Promise<string> {
    const client = await this.#ensureClient();
    try {
      localStorage.setItem(KEY, "1");
    } catch {
      /* sin almacenamiento, al volver no se restaura solo */
    }
    const ready = waitForWallet(client, 120_000);
    client.login({ provider: "google" });
    const wallet = await ready;
    this.address = wallet.address;
    return wallet.address;
  }

  /** Retoma la sesión al volver del redirect de Google. */
  async restore(): Promise<string | null> {
    let wanted = false;
    try {
      wanted = localStorage.getItem(KEY) === "1";
    } catch {
      /* nada que restaurar */
    }
    if (!wanted) return null;
    const client = await this.#ensureClient();
    const wallet = await waitForWallet(client, 8_000).catch(() => null);
    this.address = wallet?.address ?? null;
    return this.address;
  }

  /**
   * El nombre y la foto de quien entró.
   *
   * Sale de la cuenta de Google, así que la cabecera puede decir "Nicolás" en
   * vez de una dirección de 56 caracteres que no le dice nada a nadie. No se
   * guarda en ningún lado: vive mientras dura la sesión de Pollar.
   */
  profile(): Profile | null {
    const p = this.#client?.getUserProfile?.();
    if (!p) return null;
    const name = [p.first_name, p.last_name].filter(Boolean).join(" ").trim();
    return { name: name || p.mail, mail: p.mail, avatar: p.avatar };
  }

  async disconnect(): Promise<void> {
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* ya no está */
    }
    this.address = null;
    try {
      await this.#client?.logout();
    } catch {
      /* la sesión ya podía estar cerrada */
    }
    this.#client = null;
  }

  async networkPassphrase(): Promise<string | null> {
    // La red la fija la clave publicable de la app, no el usuario: no hay forma
    // de que esté en otra.
    return network.networkPassphrase;
  }

  /** No aplica: esta wallet firma y envía junto. La capa de anclaje usa `signAndSubmit`. */
  async signTransaction(): Promise<SignedTx> {
    throw new Error("pollar-submits-itself");
  }

  async signAndSubmit(xdr: string): Promise<string> {
    const client = await this.#ensureClient();
    const outcome = (await client.signAndSubmitTx(xdr)) as {
      status?: string;
      hash?: string;
      details?: string;
      code?: string;
    };
    if (outcome.status === "error" || !outcome.hash) {
      throw new Error(outcome.code ?? outcome.details ?? "pollar-submit-failed");
    }
    return outcome.hash;
  }
}

/** Espera a que Pollar termine de autenticar y tenga una cuenta lista. */
function waitForWallet(client: PollarClient, timeoutMs: number): Promise<WalletInfo> {
  return new Promise((resolve, reject) => {
    const now = client.getWallet();
    if (now?.address) {
      resolve(now);
      return;
    }
    const timer = setTimeout(() => {
      off();
      reject(new Error("pollar-timeout"));
    }, timeoutMs);
    const off = client.onAuthStateChange(() => {
      const wallet = client.getWallet();
      if (wallet?.address) {
        clearTimeout(timer);
        off();
        resolve(wallet);
      }
    });
  });
}

export const pollarWallet = new PollarWallet();

/** Una wallet que envía sus propias transacciones. */
export const submitsItself = (w: WalletAdapter | null): w is SubmittingWallet =>
  !!w && (w as SubmittingWallet).submitsItself === true;
