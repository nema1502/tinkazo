import type { AuthOpenContext, PollarClient, WalletInfo } from "@pollar/core";
import { network } from "./config";
import type { SignedTx, WalletAdapter } from "./wallet";
import { contarEntrada, marcarEntrada, tomarEntrada } from "../contar";

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

/**
 * Lo que Pollar sabe de quien entró. Todo sale de la cuenta de Google.
 *
 * `name` es el nombre de verdad, o vacío si la cuenta no trae uno (una cuenta de correo): hasta el 26 de octubre de
 * 2026 se ponía el correo como nombre y la cabecera lo mostraba entero, también en una pantalla grande. Sin nombre,
 * la cabecera dice por dónde entró (`cuenta-estado.ts`); el correo va aparte, para el panel, y siempre tapado.
 */
export interface Profile {
  name: string;
  mail: string;
  avatar: string;
}

/** Cuánto se espera al SDK a que lea su sesión guardada, que no necesita la red salvo para renovar una vencida. */
export const LISTO_MS = 8_000;

/** Lo que quedó de una entrada que no se completó, para que la pantalla diga qué pasó y se pueda reintentar. */
export const ENTRADA_BLOQUEADA = "popup-blocked";
export const ENTRADA_CERRADA = "popup-closed";
/** Pollar no pudo abrir la entrada (sin red, o la llave no vale en este sitio): no hay a dónde mandar la ventana. */
export const ENTRADA_SIN_SESION = "popup-nosession";

/** Cuánto se espera, con la ventana de Google cerrada, a que llegue la cuenta: el SDK tarda un instante en enterarse. */
export const GRACIA_CIERRE_MS = 6_000;

/**
 * ¿La marca de Pollar sigue valiendo? Con el SDK ya leyó su sesión (`ready()`) y sin cuenta, la marca vale solo si
 * el SDK **sí** guardó una sesión que parece buena (se está renovando, o no hay red): si no hay ninguna, o está rota,
 * la marca es de una sesión que ya no existe, y quedaba para siempre diciendo "Retomando…" en cada carga.
 */
export function marcaViva(e: { listo: boolean; hayCuenta: boolean; guardada: string | null; esValida: (s: unknown) => boolean }): boolean {
  // Con una cuenta, o sin saber (el SDK no terminó de leer), no se toca.
  if (e.hayCuenta || !e.listo) return true;
  if (!e.guardada) return false;
  try {
    return e.esValida(JSON.parse(e.guardada));
  } catch {
    return false;
  }
}

export interface SubmittingWallet extends WalletAdapter {
  readonly submitsItself: true;
  /** Firma y envía en un solo paso. Devuelve el hash de la transacción. */
  signAndSubmit(xdr: string): Promise<string>;
  /**
   * Solo firma, sin pedirle a Pollar que patrocine la comisión: la paga la cuenta de la
   * persona y la transacción la manda quien la pidió. Devuelve el XDR firmado.
   */
  signUnsponsored?(xdr: string): Promise<string>;
}

export const pollarConfigured = (): boolean => !!import.meta.env.VITE_POLLAR_PUBLISHABLE_KEY;

class PollarWallet implements SubmittingWallet {
  readonly kind = "external" as const;
  readonly submitsItself = true as const;
  address: string | null = null;
  #client: PollarClient | null = null;
  #via: Via = "google";
  /** Cómo avisar que la ventana de Google no se abrió o se cerró antes de entrar (lo arma `connect`). */
  #falla: ((e: Error) => void) | null = null;
  /** La ventana de Google, para saber si la persona la cerró sin entrar. */
  #ventana: Window | null = null;

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
      // La misma ventana que abre el SDK, pero que avisa si el navegador la bloqueó (`abrirVentana`).
      openAuthUrl: (ctx) => this.#abrirVentana(ctx),
    });
    return this.#client;
  }

  /**
   * Abre la ventana de Google, como lo hace el SDK por su cuenta (una ventana en blanco en el mismo toque, y recién
   * después la dirección, que hay que pedirle a Pollar), y avisa lo que el SDK calla. Si el navegador no la deja
   * abrir, no hay a dónde ir: se corta la entrada y la pantalla lo dice ("Permití las ventanas emergentes"). Antes la
   * herramienta quedaba diciendo "Conectando…" hasta dos minutos, sin ventana (26 de octubre de 2026).
   */
  async #abrirVentana({ getUrl }: AuthOpenContext): Promise<void> {
    const ventana = typeof window !== "undefined" ? window.open("about:blank", "_blank") : null;
    if (!ventana) {
      this.#falla?.(new Error(ENTRADA_BLOQUEADA));
      return;
    }
    this.#ventana = ventana;
    try {
      ventana.opener = null;
    } catch {
      /* ya cortada */
    }
    let url: string | null = null;
    try {
      url = await getUrl();
    } catch {
      url = null;
    }
    if (!url) {
      // Pollar no pudo armar la entrada: la ventana en blanco no sirve de nada y esperar a que "se cierre" diría que la
      // cerró la persona. Se corta ya, con su motivo.
      ventana.close();
      this.#falla?.(new Error(ENTRADA_SIN_SESION));
      return;
    }
    ventana.location.href = url;
    try {
      ventana.opener = null;
    } catch {
      /* ya cortada */
    }
  }

  /**
   * Arranca el login con Google. Se abre una ventana (SDK 0.11.3) y esta promesa resuelve cuando la cuenta está
   * lista. Falla con `popup-blocked` si el navegador no dejó abrir la ventana y con `popup-closed` si la persona la
   * cerró sin entrar: en los dos casos la entrada se corta y se puede volver a intentar. (La versión anterior del SDK
   * se iba a Google y volvía a la página; `restore` sigue sirviendo si la página se recarga.)
   */
  async connect(): Promise<string> {
    const client = await this.#ensureClient();
    this.#remember("google");
    // Al volver, `restore` sabe que es una cuenta recién conectada y no una sesión retomada (el contador, src/contar.ts).
    marcarEntrada();
    const ready = waitForWallet(client, 120_000);
    ready.catch(() => undefined);
    let cierre = 0;
    let vigia = 0;
    const cortada = new Promise<never>((_, rechazar) => {
      this.#falla = rechazar;
      // Si la persona cierra la ventana antes de entrar, no se espera dos minutos: se le da un respiro (el SDK se
      // entera de que terminó un instante después de que la ventana se cierra sola) y se corta.
      vigia = window.setInterval(() => {
        if (!this.#ventana?.closed || cierre) return;
        cierre = window.setTimeout(() => rechazar(new Error(ENTRADA_CERRADA)), GRACIA_CIERRE_MS);
      }, 500);
    });
    cortada.catch(() => undefined);
    try {
      client.login({ provider: "google" });
      const wallet = await Promise.race([ready, cortada]);
      this.address = wallet.address;
      return wallet.address;
    } catch (e) {
      // El SDK sigue esperando una ventana que ya no está: se le dice que deje de hacerlo.
      if (e instanceof Error && (e.message === ENTRADA_BLOQUEADA || e.message === ENTRADA_CERRADA || e.message === ENTRADA_SIN_SESION)) client.cancelLogin();
      throw e;
    } finally {
      window.clearInterval(vigia);
      window.clearTimeout(cierre);
      this.#falla = null;
      this.#ventana = null;
    }
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

  /**
   * Retoma la sesión al recargar la página (o al volver del redirect de Google, en el SDK anterior).
   *
   * Le pregunta al SDK, que lee su propia sesión guardada al armarse (`ready()`): no hay que esperar ocho segundos a ver
   * si aparece una cuenta que no existe. Y si el SDK terminó y no tiene ninguna (la sesión venció, se borró, o la marca
   * de acá era de otra época), la marca se olvida: antes quedaba para siempre y cada carga repetía ocho segundos de
   * "Retomando…" para caer en "Para sellar, entrá con tu cuenta" (diagnóstico del 26 de octubre de 2026).
   */
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
    const listo = await Promise.race([client.ready().then(() => true, () => false), new Promise<boolean>((r) => setTimeout(() => r(false), LISTO_MS))]);
    const wallet = client.getWallet();
    this.address = wallet?.address ?? null;
    if (!this.address) {
      if (!(await this.#marcaViva(client, listo))) this.#olvidarMarca();
      return null;
    }
    // Volvió de Google con la cuenta: para el contador es una cuenta conectada, no una sesión retomada.
    if (tomarEntrada()) contarEntrada(this.#via === "email" ? "email" : "google");
    return this.address;
  }

  /** Mira lo que el SDK guardó (`pollar:<huella>:session`) para saber si la marca de esta app sigue valiendo. */
  async #marcaViva(client: PollarClient, listo: boolean): Promise<boolean> {
    let guardada: string | null = null;
    try {
      guardada = listo ? localStorage.getItem(`pollar:${client.apiKeyHash}:session`) : null;
    } catch {
      /* sin almacenamiento no hay sesión que valga */
    }
    const { isValidSession } = await import("@pollar/core");
    return marcaViva({ listo, hayCuenta: false, guardada, esValida: (s) => isValidSession(s) });
  }

  /** ¿Sigue la marca de que esta app tenía una cuenta de Pollar? `restore` la olvida cuando la sesión ya no existe. */
  hayMarca(): boolean {
    try {
      return localStorage.getItem(KEY) !== null;
    } catch {
      return false;
    }
  }

  #olvidarMarca(): void {
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* ya no está */
    }
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
    // Sin nombre, vacío: el correo no es un nombre (cuenta-estado.ts).
    return { name, mail: p.mail, avatar: p.avatar };
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
    const outcome = (await client.signAndSubmitTx(xdr)) as ResultadoDeEnvio;
    if (outcome.status === "error" || !outcome.hash) {
      throw new Error(mensajeDeRechazo(outcome));
    }
    return outcome.hash;
  }

  async signUnsponsored(xdr: string): Promise<string> {
    const client = await this.#ensureClient();
    const outcome = (await client.signTx(xdr, { skipSponsorship: true })) as { status?: string; signedXdr?: string } & ResultadoDeEnvio;
    if (outcome.status !== "signed" || !outcome.signedXdr) {
      throw new Error(mensajeDeRechazo(outcome));
    }
    return outcome.signedXdr;
  }
}

/**
 * Lo que devuelve `signAndSubmitTx` de Pollar. El SDK no lanza cuando algo sale
 * mal: devuelve `status: "error"` y deja el motivo en alguno de estos campos.
 */
export interface ResultadoDeEnvio {
  status?: string;
  hash?: string;
  details?: string;
  code?: string;
  resultCode?: string;
  message?: string;
}

/**
 * El mensaje del error de un envío que Pollar no pudo hacer.
 *
 * El motivo no viene siempre en el mismo campo. Si la red rechazó la
 * transacción, el SDK pone el código de resultado en `resultCode` y en
 * `details` (`txInsufficientBalance`, `txFailed`…). Si el servidor contesta con
 * un error de API, pone su código en `code` (`TX_SUBMIT_FAILED`…), un texto en
 * `message` y el diagnóstico en `details`. Antes se lanzaba solo `code` o, si
 * no había, `details`: con un error de API se perdía el motivo, y una cuenta
 * sin saldo se mostraba como "la red rechazó la transacción, probá de nuevo"
 * (probado el 19 de octubre de 2026 contra un servidor que responde así).
 *
 * Se juntan los cuatro, sin repetir y con el código de resultado primero, así
 * quien interpreta el error (`errorKey`) lo encuentra venga por donde venga.
 */
export function mensajeDeRechazo(r: ResultadoDeEnvio): string {
  const partes = [r.resultCode, r.details, r.code, r.message].filter((p): p is string => typeof p === "string" && p.length > 0);
  return [...new Set(partes)].join(" · ") || "pollar-submit-failed";
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

/**
 * Baja el SDK de Pollar con la página quieta, sin armar nada. Entrar abre una ventana, y el navegador solo la deja
 * abrir poco después del toque (Chrome, unos segundos; Safari, casi nada): si bajar el SDK (~250 KB) se come ese
 * margen, la ventana se bloquea y la persona ve "Conectando…" sin que pase nada. Con el SDK ya bajado, el toque lo
 * encuentra listo. Un chunk del que nadie se acuerda no cuesta nada: no crea cuenta ni llama a Pollar.
 */
export function precargarSdk(): void {
  if (!pollarConfigured()) return;
  void import("@pollar/core").catch(() => undefined);
}

/** Una wallet que envía sus propias transacciones. */
export const submitsItself = (w: WalletAdapter | null): w is SubmittingWallet =>
  !!w && (w as SubmittingWallet).submitsItself === true;
