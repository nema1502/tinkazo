import type { PollarClient, WalletInfo } from "@pollar/core";
import { network } from "./config";
import type { SignedTx, WalletAdapter } from "./wallet";

/**
 * Entrar con Google o con un correo, sin instalar nada.
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

/** Guarda por dónde entró la persona ("google" o "email"), para retomar la sesión. */
const KEY = "tinkazo.pollar.intent";
type Via = "google" | "email";

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
  address: string | null = null;
  #client: PollarClient | null = null;
  #via: Via = "google";

  /** Lo que muestra el panel de la cuenta: por dónde entró, no un nombre fijo. */
  get label(): string {
    return this.#via === "email" ? "Email" : "Google";
  }

  #remember(via: Via): void {
    this.#via = via;
    try {
      localStorage.setItem(KEY, via);
    } catch {
      /* sin almacenamiento, al volver no se restaura solo */
    }
  }

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
    this.#remember("google");
    const ready = waitForWallet(client, 120_000);
    client.login({ provider: "google" });
    const wallet = await ready;
    this.address = wallet.address;
    return wallet.address;
  }

  /**
   * Entrar con un correo, paso 1: Pollar manda un código de un solo uso.
   * Resuelve cuando el código salió. Falla con el código de error de Pollar
   * (`EMAIL_SEND_FAILED`, …). Sirve también para pedir otro código: arranca una
   * sesión de correo nueva si la anterior ya avanzó.
   */
  async sendEmailCode(email: string): Promise<void> {
    const client = await this.#ensureClient();
    this.#remember("email");
    if (client.getAuthState().step !== "entering_email") {
      const lista = waitForStep(client, "entering_email", 20_000);
      client.beginEmailLogin();
      await lista;
    }
    const enviado = waitForStep(client, "entering_code", 30_000);
    client.sendEmailCode(email);
    await enviado;
  }

  /**
   * Paso 2: el código que llegó al correo. Resuelve con la dirección cuando la
   * cuenta está lista. Con un código equivocado o vencido falla con
   * `EMAIL_CODE_INVALID` o `EMAIL_CODE_EXPIRED`, y se puede volver a intentar.
   */
  async verifyEmailCode(code: string): Promise<string> {
    const client = await this.#ensureClient();
    const lista = waitForWallet(client, 60_000, true);
    client.verifyEmailCode(code);
    const wallet = await lista;
    this.address = wallet.address;
    return wallet.address;
  }

  /** Retoma la sesión al volver del redirect de Google. */
  async restore(): Promise<string | null> {
    let via: string | null = null;
    try {
      via = localStorage.getItem(KEY);
    } catch {
      /* nada que restaurar */
    }
    if (!via) return null;
    // "1" es como se guardaba antes del correo: siempre era Google.
    this.#via = via === "email" ? "email" : "google";
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

/**
 * Espera a que Pollar termine de autenticar y tenga una cuenta lista. Con
 * `failOnError`, un error de Pollar la hace fallar con su código en vez de
 * esperar hasta el plazo: el correo lo necesita para decir "ese código no es".
 */
function waitForWallet(client: PollarClient, timeoutMs: number, failOnError = false): Promise<WalletInfo> {
  return new Promise((resolve, reject) => {
    const now = client.getWallet();
    if (now?.address) {
      resolve(now);
      return;
    }
    // Pollar repite el estado actual al suscribirse. Ese no cuenta: puede ser
    // el error del intento anterior.
    let armed = false;
    const timer = setTimeout(() => {
      off();
      reject(new Error("pollar-timeout"));
    }, timeoutMs);
    const off = client.onAuthStateChange((state) => {
      if (!armed) return;
      const wallet = client.getWallet();
      if (wallet?.address) {
        clearTimeout(timer);
        off();
        resolve(wallet);
      } else if (failOnError && state.step === "error") {
        clearTimeout(timer);
        off();
        reject(new Error(state.errorCode));
      }
    });
    armed = true;
  });
}

/** Espera a que el flujo de Pollar llegue a un paso, o falla con su error. */
function waitForStep(client: PollarClient, step: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    let armed = false;
    const timer = setTimeout(() => {
      off();
      reject(new Error("pollar-timeout"));
    }, timeoutMs);
    const off = client.onAuthStateChange((state) => {
      if (!armed) return;
      if (state.step === step) {
        clearTimeout(timer);
        off();
        resolve();
      } else if (state.step === "error") {
        clearTimeout(timer);
        off();
        reject(new Error(state.errorCode));
      }
    });
    armed = true;
  });
}

export const pollarWallet = new PollarWallet();

/** Una wallet que envía sus propias transacciones. */
export const submitsItself = (w: WalletAdapter | null): w is SubmittingWallet =>
  !!w && (w as SubmittingWallet).submitsItself === true;
