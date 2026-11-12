import type { AuthOpenContext, CosignRequest, PollarClient, WalletInfo } from "@pollar/core";
import { network } from "./config";
import { errorKey, esDeRed } from "./errores";
import { ingresoPlanB } from "./ingreso-bandera";
import { LEGACY_POLLAR_INTENT_KEY, TOPE_TOKEN_MS, leerMarcaPollar, pollarIntentKey, pollarKeyFor } from "./pollar-config";
import type { SignedTx, WalletAdapter } from "./wallet";
import { contarEntrada, marcarEntrada, tomarEntrada } from "../contar";
import { ceremoniaDelNavegador, hayPasskeys } from "./passkey";
import { enNavegadorDeApp } from "../navegador";
import { cargaOpcional } from "../carga-opcional";

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
 * Desde Pollar 0.12 (24 de octubre de 2026) cada firma pide confirmación y, sin la interfaz de Pollar, el SDK devuelve
 * `SDK_CONFIRMATION_UNAVAILABLE` en todas. Acá se atiende en código (`atenderFirmas`): lo único que se confirma es la
 * firma de `signAndSubmit` y de `signUnsponsored`, que solo salen del sello y del sorteo de la persona. El clic en
 * "Sellar la lista" es el consentimiento y cubre también el sorteo de esa lista: con Pollar el sorteo se lanza solo
 * cuando nace la ronda (`espera.ts`, sin otro clic, como pasa con la cuenta de prueba), mientras que con Freighter la
 * persona lo aprueba en su ventana. Cualquier otra firma que llegue se rechaza y se anota. El cliente se
 * arma con `confirmation: "prompt"`: el SDK deja ganar a la política más estricta entre el código y el panel de
 * Pollar, así que fijarla en `"prompt"` hace que la lista blanca corra siempre, también con el panel en "Never ask".
 *
 * Sin verificar de punta a punta: hace falta una sesión real de Google, y la
 * política de transacciones de la app en el panel de Pollar tiene que permitir
 * invocaciones de contrato. Si la rechaza, el error se muestra tal cual en vez
 * de disfrazarse.
 */

/**
 * Guarda por dónde entró la persona ("google" o "email"), para retomar la sesión.
 * Una marca por red: abrir el otro modo sin sesión no borra la de este. La clave
 * vieja sin red solo se lee en Prueba, que es donde quedó escrita.
 */
const intentKey = (): string => pollarIntentKey(network.name);
const readIntent = (): string | null => leerMarcaPollar(localStorage, network.name);
const forgetIntent = (): void => {
  localStorage.removeItem(intentKey());
  if (network.name === "testnet") localStorage.removeItem(LEGACY_POLLAR_INTENT_KEY);
};
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

export const pollarConfigured = (): boolean => pollarKeyFor(network.name) !== "";

/**
 * Una firma que el SDK dejó esperando confirmación (`PendingConfirmation` de `@pollar/core`, lo que usamos).
 * Es lo mismo que mostraría `<ConfirmModal>` de `@pollar/react`.
 */
export interface FirmaPendiente {
  id: string;
  kind: string;
  operation?: string | undefined;
  unsignedXdr?: string | undefined;
  confirm: () => void;
  reject: () => void;
}

/**
 * Decide, una por una, las firmas que esperan confirmación.
 *
 * Se confirma la que cumple las tres: hay una firma pedida por nosotros en curso (`esperadas`: el XDR que se mandó a
 * firmar desde el botón de sellar o de sortear), es de las que firman una transacción (`sign` o `sign_and_send`, no
 * una construida por el SDK como un pago o una línea de confianza), y trae esa transacción y no otra (sin ella, no). Todo lo demás se
 * rechaza: una firma que la persona no pidió no se firma.
 *
 * `atendidas` guarda lo ya resuelto: el SDK repite la lista entera cada vez que cambia, y al resolver una vuelve a avisar.
 * `alRechazar` recibe solo el tipo y la operación, nunca el XDR ni datos de la cuenta.
 */
export function atenderFirmas(
  pendientes: readonly FirmaPendiente[],
  esperadas: ReadonlySet<string>,
  atendidas: Set<string>,
  alRechazar: (motivo: string, que: { kind: string; operation: string }) => void,
): void {
  for (const p of pendientes) {
    if (atendidas.has(p.id)) continue;
    atendidas.add(p.id);
    const que = { kind: p.kind, operation: p.operation ?? "" };
    if (esperadas.size === 0) {
      alRechazar("nadie la pidió", que);
      p.reject();
    } else if (p.kind !== "sign" && p.kind !== "sign_and_send") {
      alRechazar("no es la firma de una transacción armada acá", que);
      p.reject();
    } else if (p.unsignedXdr === undefined || !esperadas.has(p.unsignedXdr)) {
      // Sin la transacción a la vista no se puede saber qué se firma: en 0.12.0 `sign` y `sign_and_send` siempre la traen.
      alRechazar(p.unsignedXdr === undefined ? "no trae la transacción" : "es otra transacción", que);
      p.reject();
    } else {
      p.confirm();
    }
  }
}

/* ------------------------------------------------ activar la cuenta en la red principal */

/**
 * Un pedido de co-firma de Pollar (`CosignRequest` de `@pollar/core` 0.12.0, los campos que se miran). Lo abre Pollar y
 * espera el voto de la persona. En la red principal, al entrar, queda uno: el de crear su cuenta, pagado por la app.
 */
export interface PedidoDeCofirma {
  id: string;
  kind?: string | undefined;
  network?: string | undefined;
  status?: string | undefined;
  intent?: string | undefined;
  operation?: string | undefined;
  account?: string | undefined;
  signWith?: string | undefined;
  /** No está en los tipos del kit, aunque llegó en vivo: la regla no depende de que siga llegando. */
  appPaysFee?: boolean | undefined;
  refreshable?: boolean | undefined;
  unsignedPayload?: string | undefined;
  payloadHash?: string | undefined;
  activityId?: string | null | undefined;
  subOrgId?: string | undefined;
  createdAt?: string | undefined;
  expiresAt?: string | undefined;
  submit?: { status?: string | undefined; hash?: string | undefined } | undefined;
}

/** Una operación de la transacción de un pedido, con lo que la regla compara. */
export interface OperacionLeida {
  type: string;
  source?: string | undefined;
  destination?: string | undefined;
  sponsoredId?: string | undefined;
  startingBalance?: string | undefined;
}

/** Lo que hace falta leer de la transacción de un pedido para saber qué se firma. */
export interface TransaccionLeida {
  /** La cuenta que paga la comisión. */
  fuente: string;
  /** El hash de la transacción, en hexadecimal, calculado con la red de la página. */
  hash: string;
  operaciones: readonly OperacionLeida[];
}

/**
 * ¿Este pedido es la creación de ESTA cuenta, pagada por otro, y nada más? Devuelve el motivo si no lo es, `null` si sí.
 *
 * Es lo único que la activación aprueba (sección 5 del diseño de «Dejá tu cuenta lista»): el pedido es crear la cuenta de
 * quien entró, en Stellar, pendiente, sin voto, de esta organización; la transacción la paga otra cuenta G; y sus
 * operaciones son exactamente abrir el patrocinio de esta cuenta, crearla con saldo 0 y cerrar el patrocinio desde ella,
 * en ese orden, con el hash que el pedido dice. Lo único que la persona firma como dueña es ese cierre, que no mueve
 * nada. El motivo va a la consola: nunca lleva direcciones, la transacción ni el pedido, solo palabras fijas y, si es por
 * las operaciones, la lista de sus tipos.
 */
export function motivoContraLaActivacion(p: PedidoDeCofirma, cuenta: string, tx: TransaccionLeida | null, subOrg: string | null): string | null {
  if (!cuenta.startsWith("G")) return "cuenta";
  if (p.status !== "PENDING") return "estado";
  if (p.kind !== "TX" || p.network !== "STELLAR") return "tipo";
  if (p.intent !== "account_create" || p.operation !== "create_account") return "intención";
  if (p.account === undefined) return "pedido sin cuenta";
  if (p.account !== cuenta || p.signWith !== cuenta) return "otra cuenta";
  if (p.appPaysFee === false) return "no paga la app";
  if (p.activityId) return "ya votado";
  if (!p.unsignedPayload || !p.payloadHash) return "sin transacción";
  if (!subOrg || p.subOrgId !== subOrg) return "otra organización";
  if (!tx) return "no se lee";
  if (!tx.fuente.startsWith("G") || tx.fuente === cuenta) return "quién paga";
  const tipos = `operaciones: ${tx.operaciones.map((o) => o.type).join(",")}`;
  if (tx.operaciones.length !== 3) return tipos;
  const [abre, crea, cierra] = tx.operaciones as readonly [OperacionLeida, OperacionLeida, OperacionLeida];
  const forma =
    abre.type === "beginSponsoringFutureReserves" &&
    abre.sponsoredId === cuenta &&
    esDeOtro(abre.source, cuenta) &&
    crea.type === "createAccount" &&
    crea.destination === cuenta &&
    crea.startingBalance !== undefined &&
    Number(crea.startingBalance) === 0 &&
    esDeOtro(crea.source, cuenta) &&
    cierra.type === "endSponsoringFutureReserves" &&
    cierra.source === cuenta;
  if (!forma) return tipos;
  if (tx.hash !== p.payloadHash.toLowerCase()) return "hash";
  return null;
}

/** Una operación sin cuenta propia la paga quien paga la transacción; si trae una, tiene que ser otra G. */
function esDeOtro(source: string | undefined, cuenta: string): boolean {
  return source === undefined || (source.startsWith("G") && source !== cuenta);
}

/** La propuesta que el kit arma en `verify` y `relay` estampa con la llave de este navegador. */
export interface PropuestaDeVoto {
  path: string;
  body: unknown;
}

/** Lo que se va a estampar es exactamente nuestro hash, para esta cuenta y esta organización, y nada más. */
export function propuestaEsLaNuestra(prop: PropuestaDeVoto, cuenta: string, hashNuestro: string, subOrg: string): boolean {
  const b = (prop.body ?? {}) as { type?: unknown; organizationId?: unknown; parameters?: Record<string, unknown> };
  const p = b.parameters && typeof b.parameters === "object" ? b.parameters : null;
  const claves = p ? Object.keys(p).sort().join(",") : "";
  return (
    prop.path === "/public/v1/submit/sign_raw_payload" &&
    b.type === "ACTIVITY_TYPE_SIGN_RAW_PAYLOAD_V2" &&
    !!subOrg &&
    b.organizationId === subOrg &&
    claves === "encoding,hashFunction,payload,signWith" &&
    p?.signWith === cuenta &&
    p.payload === hashNuestro &&
    p.encoding === "PAYLOAD_ENCODING_HEXADECIMAL" &&
    p.hashFunction === "HASH_FUNCTION_NOT_APPLICABLE"
  );
}

/**
 * Lee la transacción de un pedido con el SDK de Stellar y la red de la página. `null` si no trae, si no se puede leer o
 * si viene envuelta (otra cuenta paga por encima): esa forma no es la de una activación.
 */
export async function leerTransaccion(xdr: string | undefined, passphrase: string): Promise<TransaccionLeida | null> {
  if (!xdr) return null;
  try {
    const { Transaction, TransactionBuilder } = await import("@stellar/stellar-sdk");
    const tx = TransactionBuilder.fromXDR(xdr, passphrase);
    if (!(tx instanceof Transaction)) return null;
    return {
      fuente: tx.source,
      hash: aHex(tx.hash()),
      operaciones: tx.operations.map((o) => {
        const x = o as { type: string; source?: string; destination?: string; sponsoredId?: string; startingBalance?: string };
        return { type: x.type, source: x.source, destination: x.destination, sponsoredId: x.sponsoredId, startingBalance: x.startingBalance };
      }),
    };
  } catch {
    return null;
  }
}

/** Los bytes de un hash, en hexadecimal en minúscula (sin `Buffer`, que en el navegador no está). */
const aHex = (bytes: Uint8Array): string => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

/** Cómo terminó la activación: no había nada que activar, quedó activada, o el voto salió y todavía no se cerró. */
export type ResultadoDeActivar = "no-hay" | "activada" | "pendiente";

/** Los errores de la activación. Nunca el error del kit, que trae el pedido en su cuerpo. */
export const ACTIVACION_SIN_CUENTA = "pollar-sin-cuenta";
export const ACTIVACION_RARA = "pollar-activacion-rara";
export const ACTIVACION_FALLO = "pollar-activacion-fallo";
export const ACTIVACION_TOPE = "pollar-activacion-tope";
/** Cuántos votos fallados se admiten por pestaña antes de pedir que cierre sesión y entre de nuevo: cada voto cuesta. */
export const TOPE_DE_VOTOS_FALLADOS = 2;

/**
 * Lo que la cuenta de la red principal deja en `sessionStorage`, sin datos de la cuenta: los votos fallados de esta
 * pestaña (un número), que este navegador se sumó a la cuenta en esta pestaña, y que se mandó un código. Se borran al
 * cerrar sesión.
 */
export const MARCAS_DE_LA_CUENTA = { votos: "tinkazo.cl.votos", inscrito: "tinkazo.cl.inscrito", codigo: "tinkazo.cl.codigo" } as const;

/** El canal con que una pestaña avisa a las otras que la cuenta cambió. El mensaje es `{ tipo: "cambio" }`, sin la dirección. */
export const CANAL_DE_LA_CUENTA = "tinkazo-cuenta-oficial";

function leerMarca(clave: string): string | null {
  try {
    return sessionStorage.getItem(clave);
  } catch {
    return null;
  }
}
function ponerMarca(clave: string, valor: string): void {
  try {
    sessionStorage.setItem(clave, valor);
  } catch {
    /* sin almacenamiento, la marca vive lo que viva la llamada */
  }
}
function borrarMarca(clave: string): void {
  try {
    sessionStorage.removeItem(clave);
  } catch {
    /* ya no está */
  }
}
const votosFallados = (): number => {
  const n = Number(leerMarca(MARCAS_DE_LA_CUENTA.votos));
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
};
const sumarVotoFallado = (): void => ponerMarca(MARCAS_DE_LA_CUENTA.votos, String(votosFallados() + 1));

/** Avisa a las otras pestañas (y a quien escuche en esta) que la cuenta cambió, para que vuelvan a leer. */
export function avisarCambioDeLaCuenta(): void {
  try {
    if (typeof BroadcastChannel === "undefined") return;
    const canal = new BroadcastChannel(CANAL_DE_LA_CUENTA);
    canal.postMessage({ tipo: "cambio" });
    canal.close();
  } catch {
    /* sin canal, las otras pestañas leen al volver a la vista */
  }
}

/**
 * Lo que importa del estado de la co-firma que avisa el kit, en una cadena: cada pedido pendiente con su estado y su
 * actividad, y el último resuelto. Dos avisos con la misma firma dicen lo mismo.
 */
export function firmaDeLaCofirma(s: unknown): string {
  const de = (r: unknown): string => {
    const x = (r ?? {}) as { id?: unknown; status?: unknown; activityId?: unknown };
    return `${String(x.id ?? "")}:${String(x.status ?? "")}:${String(x.activityId ?? "")}`;
  };
  const e = (s ?? {}) as { pending?: unknown; lastResolved?: unknown };
  const pendientes = Array.isArray(e.pending) ? e.pending.map(de).sort() : [];
  return `${pendientes.join(",")}|${e.lastResolved ? de(e.lastResolved) : ""}`;
}

/** La cuenta ya existe en la red: gana siempre sobre cualquier pedido pendiente. */
const cuentaCreada = (w: { existsOnStellar?: boolean | undefined; provisioning?: string | undefined } | null | undefined): boolean =>
  w?.existsOnStellar === true || w?.provisioning === "READY";

/** El pedido de crear esta cuenta, todavía pendiente. */
const esPedidoDeCrear = (p: PedidoDeCofirma, cuenta: string): boolean => p.intent === "account_create" && p.status === "PENDING" && p.account === cuenta;

/** El más nuevo por `createdAt`; con fechas iguales o ilegibles, el último de la lista. */
function elMasNuevo(lista: readonly PedidoDeCofirma[]): PedidoDeCofirma | null {
  let mejor: PedidoDeCofirma | null = null;
  let cuando = -Infinity;
  for (const p of lista) {
    const t = Date.parse(p.createdAt ?? "");
    const v = Number.isFinite(t) ? t : -Infinity;
    if (mejor === null || v >= cuando) {
      mejor = p;
      cuando = v;
    }
  }
  return mejor;
}

const codigoDelKit = (e: unknown): string | undefined => {
  const c = (e as { code?: unknown } | null)?.code;
  return typeof c === "string" ? c : undefined;
};

/** El error del kit, convertido en uno nuestro que solo trae el código: de créditos, de red o la falla de siempre. */
function errorDeActivar(e: unknown): Error {
  if (errorKey(e) === "sponsorEmpty") return new Error("SDK_CREDITS_INSUFFICIENT");
  const sinInternet = typeof navigator !== "undefined" && navigator.onLine === false;
  if (sinInternet || esDeRed(e)) return new Error("SDK_NETWORK_TIMEOUT");
  return new Error(ACTIVACION_FALLO);
}
async function delKit<T>(p: Promise<T>): Promise<T> {
  try {
    return await p;
  } catch (e) {
    throw errorDeActivar(e);
  }
}

const noAprobada = (motivo: string): Error => {
  console.warn(`[tinkazo] activación no aprobada: ${motivo}`);
  return new Error(ACTIVACION_RARA);
};

/** Corre `f` con el candado entre pestañas de Web Locks; sin Web Locks, sin candado. */
function conCandado<T>(nombre: string, f: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== "undefined" ? (navigator as { locks?: LockManager }).locks : undefined;
  if (!locks || typeof locks.request !== "function") return f();
  return locks.request(nombre, f) as Promise<T>;
}

/**
 * Cómo está la activación de la cuenta de la red principal: lista (existe en la red), falta (hay un pedido de crearla
 * esperando el voto), se está preparando (todavía no hay pedido), no salió (Pollar dice que falló), o no se sabe (no se
 * pudo preguntar y lo local no dice que esté lista).
 */
export type EstadoDeActivacion = "lista" | "falta" | "preparando" | "fallo" | "no-se-sabe";

/**
 * Cómo está la protección: lista; falta (la cuenta nueva, con este navegador adentro y sin forma de recuperarla);
 * `aparato-nuevo` (protegida, pero este navegador no es de la cuenta: hay que confirmar que es la persona); `sin-forma`
 * (sin protección y este navegador no es de la cuenta: desde acá no hay cómo); o no se sabe.
 */
export type EstadoDeProteccionOficial = "lista" | "falta" | "aparato-nuevo" | "sin-forma" | "no-se-sabe";

/** Lo que el paso «Dejá tu cuenta lista» necesita saber de la cuenta. */
export interface EstadoOficial {
  activacion: EstadoDeActivacion;
  proteccion: EstadoDeProteccionOficial;
  /** La cuenta tiene un correo confirmado para recuperarla: a ese va el código de un navegador nuevo. */
  correoConfirmado: boolean;
  /** La cuenta tiene llaves guardadas (el desbloqueo de un celular o de una compu). */
  tieneLlaves: boolean;
  /** Este navegador es el único de la cuenta: si sale sin protegerla, tiene que terminar acá. */
  unicoNavegador: boolean;
  /** El correo confirmado de la cuenta, si tiene: el paso lo muestra tapado en «Mandar un código a…». */
  correoDeLaCuenta: string | null;
}

/** Fuera de la red principal, o con todo en memoria: no hay nada que hacer. */
const TODO_LISTO: EstadoOficial = { activacion: "lista", proteccion: "lista", correoConfirmado: false, tieneLlaves: false, unicoNavegador: false, correoDeLaCuenta: null };
const NADA_SE_SABE: EstadoOficial = { activacion: "no-se-sabe", proteccion: "no-se-sabe", correoConfirmado: false, tieneLlaves: false, unicoNavegador: false, correoDeLaCuenta: null };

/** La llave de este navegador entre las de la cuenta. Las dos son hexadecimal: se comparan sin mayúsculas. */
const mismaLlave = (a: string | null | undefined, b: string | null | undefined): boolean => !!a && !!b && a.toLowerCase() === b.toLowerCase();

/** Lo que haga `p`, o un error a los `ms`. El temporizador se suelta al terminar. */
function conTope<T>(p: Promise<T>, ms: number): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined;
  const tope = new Promise<never>((_, rechazar) => {
    t = setTimeout(() => rechazar(new Error("tope")), ms);
  });
  return Promise.race([p, tope]).finally(() => clearTimeout(t));
}

/** Cuánto se espera, al cerrar sesión, a sacar este navegador de la cuenta, y a una confirmación que esté en curso. */
export const TOPE_SACAR_NAVEGADOR_MS = 10_000;
export const TOPE_CONFIRMACION_EN_CURSO_MS = 20_000;
/** Cuánto se espera a que la sesión de Pollar quede verificada para entregar su token (`tokenDeSesion`): `pollar-config.ts`. */
export { TOPE_TOKEN_MS };

/**
 * ¿Se puede usar el desbloqueo de este celular o compu (huella, cara o clave) para la cuenta? Hace falta que el navegador
 * sepa crear llaves de acceso, que no sea el navegador de una aplicación (Instagram, TikTok…: ahí no se abre) y que diga
 * que tiene un desbloqueo propio. Si no contesta en `tope` milisegundos, no.
 */
export async function puedeUsarDesbloqueo(tope = 800): Promise<boolean> {
  try {
    if (!hayPasskeys()) return false;
    if (typeof navigator !== "undefined" && enNavegadorDeApp(navigator.userAgent ?? "")) return false;
    const pkc = window.PublicKeyCredential as unknown as { isUserVerifyingPlatformAuthenticatorAvailable?: () => Promise<boolean> } | undefined;
    if (typeof pkc?.isUserVerifyingPlatformAuthenticatorAvailable !== "function") return false;
    return await conTope(pkc.isUserVerifyingPlatformAuthenticatorAvailable().then(Boolean), tope);
  } catch {
    return false;
  }
}

/* ------------------------------------------------ el testigo del sello en la red principal */

/**
 * Compara la transacción que se votó en la co-firma con la que armó Tinkazo: la cuenta de origen y las operaciones, en
 * XDR, una por una, y si la votada vino envuelta. Devuelve la línea para la consola, sin direcciones, o `null` si no se
 * pudo leer alguna de las dos.
 */
export async function compararCofirma(armada: string, votada: string, passphrase: string): Promise<string | null> {
  try {
    const { FeeBumpTransaction, TransactionBuilder } = await import("@stellar/stellar-sdk");
    const a0 = TransactionBuilder.fromXDR(armada, passphrase);
    const v0 = TransactionBuilder.fromXDR(votada, passphrase);
    const envuelta = v0 instanceof FeeBumpTransaction && !(a0 instanceof FeeBumpTransaction);
    const a = a0 instanceof FeeBumpTransaction ? a0.innerTransaction : a0;
    const v = v0 instanceof FeeBumpTransaction ? v0.innerTransaction : v0;
    const opsA = a.tx.operations.map((o) => o.toXDR("base64"));
    const opsV = v.tx.operations.map((o) => o.toXDR("base64"));
    const misma = a.source === v.source && opsA.length === opsV.length && opsA.every((x, i) => x === opsV[i]);
    const cola = envuelta ? ", envuelta" : "";
    return misma ? `[tinkazo] co-firma del sello: misma operación${cola}` : `[tinkazo] co-firma del sello: distinta (${v.operations.map((o) => o.type).join(",")})${cola}`;
  } catch {
    return null;
  }
}

/**
 * Mientras dura una firma del sello o del sorteo, escucha si el kit quedó esperando una co-firma; al terminar, si el
 * pedido que se resolvió es ese, compara lo votado con lo que se mandó (`compararCofirma`) y lo anota. Lo que el kit
 * repite al suscribirse no cuenta: es de una firma anterior. Todo dentro de `try`: nunca lanza ni cambia el resultado.
 */
function armarTestigo(client: PollarClient): ((xdr: string) => void) | null {
  try {
    if (typeof client.onTransactionStateChange !== "function") return null;
    let armado = false;
    let pedido: string | null = null;
    const soltar = client.onTransactionStateChange((s) => {
      if (armado && s.step === "awaiting_cosign") pedido = s.request.id;
    });
    armado = true;
    return (xdr) => {
      try {
        soltar();
        if (!pedido) return;
        const r = client.getCosignState().lastResolved;
        if (!r || r.id !== pedido || !r.unsignedPayload) return;
        void compararCofirma(xdr, r.unsignedPayload, network.networkPassphrase).then(
          (linea) => {
            if (!linea) return;
            if (linea.includes(": misma")) console.info(linea);
            else console.warn(linea);
          },
          () => undefined,
        );
      } catch {
        /* el testigo nunca frena nada */
      }
    };
  } catch {
    return null;
  }
}

/** Cómo está la protección de la cuenta (la recuperación de Turnkey): lo que la pantalla necesita saber. */
export interface EstadoDeProteccion {
  /** La cuenta pide una forma de recuperarla para poder firmar. */
  requerida: boolean;
  /** Ya tiene al menos una. */
  lista: boolean;
}

class PollarWallet implements SubmittingWallet {
  readonly kind = "external" as const;
  readonly submitsItself = true as const;
  address: string | null = null;
  #client: PollarClient | null = null;
  /** El armado del cliente en curso: dos llamadas a la vez comparten uno solo (y una sola suscripción a las firmas). */
  #listo: Promise<PollarClient> | null = null;
  #via: Via = "google";
  /** Cómo avisar que la ventana de Google no se abrió o se cerró antes de entrar (lo arma `connect`). */
  #falla: ((e: Error) => void) | null = null;
  /** La ventana de Google, para saber si la persona la cerró sin entrar. */
  #ventana: Window | null = null;
  /** Las transacciones que la persona acaba de pedir firmar (el XDR, y cuántas veces): lo único que se confirma. */
  readonly #esperadas = new Map<string, number>();
  /** Las confirmaciones ya resueltas (`atenderFirmas`). */
  readonly #atendidas = new Set<string>();
  #dejarDeAtender: (() => void) | null = null;
  /**
   * Lo que ya se sabe que está listo de la cuenta de la red principal, para esa dirección y mientras dure la página: una
   * cuenta activada no se desactiva y una protegida no se desprotege. Se borra al cerrar sesión o si cambia la dirección.
   */
  #memoria: { dir: string; activacion: boolean; proteccion: boolean } | null = null;
  /** La activación en curso en esta pestaña: dos toques comparten una sola. */
  #activando: Promise<ResultadoDeActivar> | null = null;
  /** Una confirmación de este navegador en curso: cerrar sesión la espera antes de sacarlo de la cuenta. */
  #confirmacion: Promise<unknown> | null = null;
  /** El último cierre de sesión no pudo sacar este navegador de la cuenta: la página lo avisa. */
  ultimoCierreDejoNavegador = false;

  /** Lo que muestra el panel de la cuenta: por dónde entró, no un nombre fijo. */
  get label(): string {
    return this.#via === "email" ? "Email" : "Google";
  }

  #remember(via: Via): void {
    this.#via = via;
    try {
      localStorage.setItem(intentKey(), via);
    } catch {
      /* sin almacenamiento, al volver no se restaura solo */
    }
  }

  #ensureClient(): Promise<PollarClient> {
    if (this.#client) return Promise.resolve(this.#client);
    this.#listo ??= this.#armarCliente().catch((e: unknown) => {
      this.#listo = null;
      throw e;
    });
    return this.#listo;
  }

  async #armarCliente(): Promise<PollarClient> {
    const apiKey = pollarKeyFor(network.name);
    if (!apiKey) throw new Error("pollar-not-configured");
    const { PollarClient: Ctor } = await import("@pollar/core");
    const client = new Ctor({
      apiKey,
      // El SDK deja ganar a la política más estricta entre esta y la del panel: fijada en "prompt", la firma siempre
      // pasa por `atenderFirmas`, que solo confirma el sello y el sorteo de la lista que la persona selló con su botón.
      confirmation: "prompt",
      stellarNetwork: network.name === "mainnet" ? "mainnet" : "testnet",
      // La misma ventana que abre el SDK, pero que avisa si el navegador la bloqueó (`abrirVentana`).
      openAuthUrl: (ctx) => this.#abrirVentana(ctx),
      // Para la recuperación de la cuenta (`protegerConPasskey`): el navegador sabe hacerlo, `@pollar/core` solo lo pide.
      ...(hayPasskeys() ? { recoveryPasskey: ceremoniaDelNavegador } : {}),
    });
    // Pollar 0.12: sin esto cada firma falla con SDK_CONFIRMATION_UNAVAILABLE. Con `confirmation: "prompt"` toda firma
    // llega acá, sea cual sea el modo del panel de Pollar (`atenderFirmas`).
    if (typeof client.onConfirmationRequest === "function") {
      this.#dejarDeAtender = client.onConfirmationRequest((pendientes) =>
        atenderFirmas(pendientes, new Set(this.#esperadas.keys()), this.#atendidas, (motivo, que) =>
          console.warn(`[tinkazo] firma de Pollar rechazada (${motivo}): ${que.kind} ${que.operation}`.trim()),
        ),
      );
    }
    this.#client = client;
    return client;
  }

  /**
   * Corre una firma que la persona acaba de pedir con su botón: mientras dura, esa transacción (y solo esa) se confirma
   * sola cuando el SDK lo pide. La persona ya dio su consentimiento al apretar "Sellar" o "Sortear".
   */
  async #firmando<T>(xdr: string, firmar: (client: PollarClient) => Promise<T>): Promise<T> {
    const client = await this.#ensureClient();
    // En la red principal el kit vota solo la co-firma: el testigo anota si lo votado fue lo armado (riesgo aceptado,
    // docs/architecture.md). Solo mira, después de firmar.
    const testigo = network.name === "mainnet" ? armarTestigo(client) : null;
    this.#esperadas.set(xdr, (this.#esperadas.get(xdr) ?? 0) + 1);
    try {
      return await firmar(client);
    } finally {
      const quedan = (this.#esperadas.get(xdr) ?? 1) - 1;
      if (quedan > 0) this.#esperadas.set(xdr, quedan);
      else this.#esperadas.delete(xdr);
      testigo?.(xdr);
    }
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
    // Con el plan B del ingreso prendido (`src/ui/ingreso-plan-b.ts`), un error del proveedor al armar la entrada se dice
    // enseguida: sin esto, la persona miraba "Conectando…" hasta el final del plazo, dos minutos. Apagado, como siempre.
    const ready = waitForWallet(client, 120_000, ingresoPlanB());
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
      via = readIntent();
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
      return readIntent() !== null;
    } catch {
      return false;
    }
  }

  #olvidarMarca(): void {
    try {
      forgetIntent();
    } catch {
      /* ya no está */
    }
  }

  /**
   * El nombre y la foto de quien entró.
   *
   * Sale de la cuenta de Google, así que la cabecera puede decir "Mateo" en
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
    this.ultimoCierreDejoNavegador = false;
    // Si este navegador se sumó a la cuenta en esta pestaña (otro celular u otra compu), sale de la cuenta antes de cerrar.
    await this.#sacarEsteNavegador();
    try {
      forgetIntent();
    } catch {
      /* ya no está */
    }
    this.address = null;
    this.#memoria = null;
    this.#activando = null;
    for (const clave of Object.values(MARCAS_DE_LA_CUENTA)) borrarMarca(clave);
    this.#dejarDeAtender?.();
    this.#dejarDeAtender = null;
    this.#esperadas.clear();
    try {
      await this.#client?.logout();
    } catch {
      /* la sesión ya podía estar cerrada */
    }
    this.#client = null;
    this.#listo = null;
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
    const outcome = (await this.#firmando(xdr, (client) => client.signAndSubmitTx(xdr))) as ResultadoDeEnvio;
    // Una co-firma pendiente sigue viva en el SDK: la transacción puede entrar después. No es un fallo ni se reintenta a ciegas.
    if (outcome.status === "cosign_pending") {
      throw new Error("pollar-pending");
    }
    if (outcome.status === "error" || !outcome.hash) {
      throw new Error(mensajeDeRechazo(outcome));
    }
    return outcome.hash;
  }

  async signUnsponsored(xdr: string): Promise<string> {
    const outcome = (await this.#firmando(xdr, (client) => client.signTx(xdr, { skipSponsorship: true }))) as { status?: string; signedXdr?: string } & ResultadoDeEnvio;
    // Con la cuenta de Turnkey en mainnet, firmar sin enviar también puede quedar en co-firma pendiente. Es lo mismo que
    // en `signAndSubmit`: sigue viva en el SDK, no es un fallo cualquiera ni se reintenta a ciegas (cada reintento apilaría
    // otra solicitud sin atender).
    if (outcome.status === "cosign_pending") {
      throw new Error("pollar-pending");
    }
    if (outcome.status !== "signed" || !outcome.signedXdr) {
      throw new Error(mensajeDeRechazo(outcome));
    }
    return outcome.signedXdr;
  }

  /**
   * Cuánto se recibiría al cargar saldo por la rampa de Pollar (`rampa-pollar.ts`). Solo pregunta el precio: no firma, no
   * crea ninguna orden y no pasa por `atenderFirmas`. El cliente no sale de esta clase.
   */
  async cotizarRampa(body: unknown): Promise<unknown> {
    const client = await this.#ensureClient();
    return client.quoteRamp(body as Parameters<PollarClient["quoteRamp"]>[0]);
  }

  /* ------------------------------------------------ activar la cuenta (el pedido que Pollar deja al entrar) */

  /** La memoria de lo que está listo, para esta dirección. Si la dirección cambió, empieza de cero y sin votos fallados. */
  #memoriaDe(dir: string): { dir: string; activacion: boolean; proteccion: boolean } {
    if (this.#memoria?.dir !== dir) {
      if (this.#memoria) borrarMarca(MARCAS_DE_LA_CUENTA.votos);
      this.#memoria = { dir, activacion: false, proteccion: false };
    }
    return this.#memoria;
  }

  /** La cuenta que se puede activar (C1 y C3): la de la sesión, la misma que dice el kit, una G, en la red principal. */
  #cuentaParaActivar(client: PollarClient): string | null {
    const dir = this.address;
    if (!dir || !dir.startsWith("G") || client.getWallet()?.address !== dir) return null;
    if (network.name !== "mainnet" || typeof client.getNetwork !== "function" || client.getNetwork() !== "mainnet") return null;
    return dir;
  }

  /**
   * Termina de crear la cuenta en la red principal: vota que sí, con la llave de este navegador, el pedido de crearla que
   * Pollar dejó al entrar. Solo se llama desde el toque de la persona en el paso «Dejá tu cuenta lista» (una prueba lo
   * fija), porque cada voto cuesta. No recibe un pedido: lo busca ella. Lo que estampa es lo que leyó y revisó: el pedido
   * se pide de nuevo una sola vez, se lee su transacción con el SDK de Stellar y la red de la página, tiene que pasar
   * `motivoContraLaActivacion` y el lector del propio kit, y la propuesta de `verify` tiene que ser nuestro hash para esta
   * cuenta y esta organización (`propuestaEsLaNuestra`). Recién ahí `relay`. Nunca usa `approve` (vuelve a pedir la
   * transacción por dentro), ni `reject` o `cancel` (rechazar es definitivo). No vota sobre una cuenta que ya existe.
   *
   * Falla solo con `pollar-sin-cuenta`, `pollar-activacion-rara`, `pollar-activacion-fallo` y `pollar-activacion-tope`, o
   * con un error que solo trae el código de red o de créditos. Fuera de la red principal no arma nada.
   */
  activarCuenta(): Promise<ResultadoDeActivar> {
    if (network.name !== "mainnet") return Promise.reject(new Error(ACTIVACION_SIN_CUENTA));
    this.#activando ??= conCandado("tinkazo-activar", () => this.#activar()).finally(() => {
      this.#activando = null;
    });
    return this.#activando;
  }

  async #activar(): Promise<ResultadoDeActivar> {
    // 1. La cuenta y la red.
    const client = await this.#ensureClient();
    const cuenta = this.#cuentaParaActivar(client);
    if (!cuenta) throw new Error(ACTIVACION_SIN_CUENTA);
    const memoria = this.#memoriaDe(cuenta);
    // 2. Una cuenta que ya existe no se vota.
    await client.refreshWalletState().catch(() => null);
    if (cuentaCreada(client.getWallet())) {
      memoria.activacion = true;
      return "activada";
    }
    // 3. El tope de votos fallados de esta pestaña.
    if (votosFallados() >= TOPE_DE_VOTOS_FALLADOS) throw new Error(ACTIVACION_TOPE);
    // 4. El pedido de crear esta cuenta, el más nuevo, y la organización de esta sesión.
    const [pendientes, recuperacion] = await delKit(Promise.all([client.cosign.pending(), client.cosign.recovery.status()]));
    const lista = pendientes as unknown as PedidoDeCofirma[];
    const candidato = elMasNuevo(lista.filter((p) => esPedidoDeCrear(p, cuenta)));
    if (!candidato) {
      if (lista.some((p) => p.intent === "account_create" && p.status === "PENDING" && p.account === undefined)) {
        console.warn("[tinkazo] activación no aprobada: pedido sin cuenta");
      }
      return "no-hay";
    }
    // 5. La transacción envejece mientras la persona decide: se pide de nuevo, una sola vez, y se revisa esa versión.
    const pedido = (candidato.refreshable ? await delKit(client.cosign.refresh(candidato.id)) : candidato) as PedidoDeCofirma;
    if (pedido.id !== candidato.id) throw noAprobada("otro pedido");
    // 6. Ya no está pendiente: se lee cómo quedó, sin votar.
    if (pedido.status !== "PENDING") return this.#comoQuedo(client, pedido, memoria, false);
    // 7. Ya tiene un voto: no se vota otra vez, se espera.
    if (pedido.activityId) {
      let leido = (await delKit(client.cosign.get(pedido.id, { sync: true }))) as PedidoDeCofirma;
      if (leido.status === "PENDING") leido = (await delKit(client.cosign.settle(leido as unknown as CosignRequest))) as PedidoDeCofirma;
      return this.#comoQuedo(client, leido, memoria, false);
    }
    // 8. La regla, con nuestra lectura, y el lector del kit como segunda llave.
    const tx = await leerTransaccion(pedido.unsignedPayload, network.networkPassphrase);
    const motivo = motivoContraLaActivacion(pedido, cuenta, tx, recuperacion.subOrgId ?? null);
    if (motivo !== null || !tx) throw noAprobada(motivo ?? "no se lee");
    const { recognizedSetupRequest } = await import("@pollar/core");
    const reconocido = recognizedSetupRequest(pedido as unknown as CosignRequest);
    if (!reconocido.ok || reconocido.kind !== "account_create") throw noAprobada("el lector del kit no la reconoce");
    // 9. Lo que se va a estampar: el hash del kit tiene que ser el nuestro, y la propuesta, exactamente esa.
    const verificacion = await delKit(client.cosign.verify(pedido as unknown as CosignRequest));
    if (!verificacion.ok || verificacion.localHash !== tx.hash) throw noAprobada("la verificación del kit");
    if (!propuestaEsLaNuestra(verificacion.proposal, cuenta, tx.hash, pedido.subOrgId ?? "")) throw noAprobada("la propuesta");
    // 10. La cuenta otra vez, y el voto.
    if (this.#client !== client || this.#cuentaParaActivar(client) !== cuenta) throw new Error(ACTIVACION_SIN_CUENTA);
    let votado: PedidoDeCofirma;
    try {
      const res = await client.cosign.relay(verificacion.proposal.path, verificacion.proposal.body, { requestId: pedido.id });
      votado = (res.request ?? (await client.cosign.get(pedido.id, { sync: true }))) as PedidoDeCofirma;
    } catch (e) {
      if (codigoDelKit(e) !== "SDK_COSIGN_REQUEST_NOT_PENDING") {
        // No se sabe si el voto salió: cuenta como uno fallado.
        sumarVotoFallado();
        throw errorDeActivar(e);
      }
      try {
        votado = (await client.cosign.get(pedido.id, { sync: true })) as PedidoDeCofirma;
      } catch (e2) {
        sumarVotoFallado();
        throw errorDeActivar(e2);
      }
    }
    // 11. Cómo terminó. Si el voto salió y todavía no se cerró, se espera un poco; si sigue, queda pendiente.
    if (votado.status === "PENDING") {
      try {
        votado = (await client.cosign.settle(votado as unknown as CosignRequest)) as PedidoDeCofirma;
      } catch {
        return "pendiente";
      }
    }
    return this.#comoQuedo(client, votado, memoria, true);
  }

  /** Lo que dice un pedido que terminó (o no). `votamos`: si el voto fue de este llamado, una falla cuenta en el tope. */
  async #comoQuedo(client: PollarClient, r: PedidoDeCofirma, memoria: { activacion: boolean }, votamos: boolean): Promise<ResultadoDeActivar> {
    if (r.status === "PENDING") return "pendiente";
    if (r.status === "APPROVED" && r.submit?.status !== "FAILED") {
      if (r.submit?.status !== "SUCCESS") {
        await client.refreshWalletState().catch(() => null);
        if (!cuentaCreada(client.getWallet())) return "pendiente";
      }
      memoria.activacion = true;
      avisarCambioDeLaCuenta();
      return "activada";
    }
    if (votamos) sumarVotoFallado();
    throw new Error(ACTIVACION_FALLO);
  }

  /* ------------------------------------------------ cómo está la cuenta de la red principal */

  /**
   * Sin red: lo que ya se sabe de la cuenta por lo que guarda el kit y la memoria. La activación está lista si el kit
   * dice que la cuenta existe; falta si dice que se está creando; si no hay ninguna, falló, no hay cliente o no dice
   * nada, no se sabe (lo aclara la lectura con red). La protección, solo por la memoria. Fuera de la red principal, todo listo.
   */
  estadoOficialLocal(): { activacion: "lista" | "falta" | "no-se-sabe"; proteccion: "lista" | "no-se-sabe" } {
    if (network.name !== "mainnet") return { activacion: "lista", proteccion: "lista" };
    const dir = this.address;
    const w = this.#client?.getWallet();
    if (!dir || !w || w.address !== dir) return { activacion: "no-se-sabe", proteccion: "no-se-sabe" };
    const memoria = this.#memoriaDe(dir);
    if (!memoria.activacion && cuentaCreada(w)) memoria.activacion = true;
    const p = w.provisioning;
    // Solo «creándose» dice que falta activar: sin billetera (NONE) o con la creación fallada (FAILED) no hay pedido que
    // aprobar, y el paso que se abriera por eso no tendría qué ofrecer. Eso lo dice la lectura con red.
    const activacion = memoria.activacion ? "lista" : p === "CREATING" ? "falta" : "no-se-sabe";
    return { activacion, proteccion: memoria.proteccion ? "lista" : "no-se-sabe" };
  }

  /**
   * Cómo está la cuenta de la red principal, preguntándole a Pollar lo que la memoria no sabe: dónde está la cuenta
   * (`refreshWalletState`, solo con `fresco`), los pedidos pendientes, la protección y la llave de este navegador, en
   * paralelo y cada una con su `catch`. Lo que da «lista» queda en memoria y no se vuelve a preguntar. Solo lee: nunca
   * vota. Fuera de la red principal no arma el cliente y dice que todo está listo.
   */
  async estadoOficial(fresco = true): Promise<EstadoOficial> {
    if (network.name !== "mainnet") return { ...TODO_LISTO };
    let client: PollarClient;
    try {
      client = await this.#ensureClient();
    } catch {
      return { ...NADA_SE_SABE };
    }
    const dir = this.address;
    if (!dir || client.getWallet()?.address !== dir) return { ...NADA_SE_SABE };
    const memoria = this.#memoriaDe(dir);
    const [activacion, proteccion] = await Promise.all([
      memoria.activacion ? Promise.resolve<EstadoDeActivacion>("lista") : this.#leerActivacion(client, dir, fresco),
      memoria.proteccion ? Promise.resolve(null) : this.#leerProteccion(client),
    ]);
    if (this.#memoria !== memoria) return { ...NADA_SE_SABE };
    if (activacion === "lista") memoria.activacion = true;
    const prot = proteccion ?? { proteccion: "lista" as const, correoConfirmado: false, tieneLlaves: false, unicoNavegador: false, correoDeLaCuenta: null };
    if (prot.proteccion === "lista") memoria.proteccion = true;
    return { activacion, ...prot };
  }

  async #leerActivacion(client: PollarClient, dir: string, fresco: boolean): Promise<EstadoDeActivacion> {
    const [, pendientes] = await Promise.all([
      fresco ? client.refreshWalletState().catch(() => null) : Promise.resolve(null),
      client.cosign.pending().then(
        (l) => l as unknown as PedidoDeCofirma[],
        () => null,
      ),
    ]);
    const w = client.getWallet();
    if (cuentaCreada(w)) return "lista";
    if (w?.provisioning === "FAILED") return "fallo";
    if (pendientes === null) return "no-se-sabe";
    return pendientes.some((p) => esPedidoDeCrear(p, dir)) ? "falta" : "preparando";
  }

  async #leerProteccion(client: PollarClient): Promise<Omit<EstadoOficial, "activacion">> {
    const [s, llave] = await Promise.all([client.cosign.recovery.status().catch(() => null), client.cosign.publicKeyHex().catch(() => null)]);
    const nada = { proteccion: "no-se-sabe" as const, correoConfirmado: false, tieneLlaves: false, unicoNavegador: false, correoDeLaCuenta: null };
    if (!s) return nada;
    const devices = Array.isArray(s.devices) ? s.devices : [];
    const correoConfirmado = !!s.email?.verified && !!s.email.address;
    const extra = {
      correoConfirmado,
      tieneLlaves: Array.isArray(s.passkeys) && s.passkeys.length > 0,
      correoDeLaCuenta: correoConfirmado ? (s.email?.address ?? null) : null,
    };
    if (!s.required) return { proteccion: "lista", ...extra, unicoNavegador: false };
    if (!llave) return { ...nada, ...extra };
    const esteEsta = devices.some((d) => mismaLlave(d.publicKey, llave));
    const unicoNavegador = esteEsta && devices.length === 1;
    const proteccion: EstadoDeProteccionOficial = s.configured ? (esteEsta ? "lista" : "aparato-nuevo") : esteEsta ? "falta" : "sin-forma";
    return { proteccion, ...extra, unicoNavegador };
  }

  /**
   * Avisa a `cb` cada vez que algo de la cuenta puede haber cambiado: el estado de la billetera o de la co-firma en el kit,
   * otra pestaña (por `BroadcastChannel`), volver a la pestaña o volver la conexión. Solo llama a `cb`, que vuelve a
   * leer: ningún aviso vota ni pide nada. Devuelve con qué soltar todo. Fuera de la red principal no hace nada.
   */
  alCambiarLaCuenta(cb: () => void): () => void {
    if (network.name !== "mainnet") return () => undefined;
    let suelto = false;
    const sueltas: Array<() => void> = [];
    const avisar = (): void => {
      if (suelto) return;
      try {
        cb();
      } catch {
        /* lo que haga quien escucha no corta los avisos */
      }
    };
    try {
      if (typeof BroadcastChannel !== "undefined") {
        const canal = new BroadcastChannel(CANAL_DE_LA_CUENTA);
        canal.onmessage = (ev: MessageEvent) => {
          if ((ev.data as { tipo?: unknown } | null)?.tipo === "cambio") avisar();
        };
        sueltas.push(() => canal.close());
      }
    } catch {
      /* sin canal, se lee al volver a la pestaña */
    }
    if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
      const alVolver = (): void => {
        if (document.visibilityState === "visible") avisar();
      };
      document.addEventListener("visibilitychange", alVolver);
      sueltas.push(() => document.removeEventListener("visibilitychange", alVolver));
    }
    if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
      window.addEventListener("online", avisar);
      sueltas.push(() => window.removeEventListener("online", avisar));
    }
    void this.#ensureClient().then(
      (client) => {
        if (suelto) return;
        sueltas.push(client.onWalletStateChange(() => avisar()));
        // El kit vuelve a avisar la co-firma cada vez que se leen los pendientes, aunque nada haya cambiado. Como avisar
        // hace leer, eso sería un bucle de lecturas a Pollar mientras el pedido de activar espera: se avisa solo si
        // cambió el conjunto de pedidos (o el último resuelto).
        let ultima: string | null = null;
        sueltas.push(
          client.onCosignStateChange((s) => {
            const f = firmaDeLaCofirma(s);
            if (f === ultima) return;
            ultima = f;
            avisar();
          }),
        );
      },
      () => undefined,
    );
    return () => {
      suelto = true;
      for (const soltar of sueltas.splice(0)) {
        try {
          soltar();
        } catch {
          /* ya suelto */
        }
      }
    };
  }

  /** ¿Sigue abierta la sesión de Pollar? Si el kit la cerró por su cuenta (venció), el paso pide entrar de nuevo. */
  sesionViva(): boolean {
    try {
      return this.#client?.getAuthState().step === "authenticated";
    } catch {
      return false;
    }
  }

  /**
   * El token de la sesión de Pollar, solo con la sesión verificada por Pollar (`verified: true`): una sesión que el kit
   * retomó de lo guardado y todavía no revalidó no sirve. Si no está verificada, espera hasta `tope` a que lo esté; si
   * no, `null`. Es lo que pide el servidor de las altas (`alta-api.ts`) para saber quién es. No se guarda ni se anota:
   * se pide cada vez, y nunca va en una dirección, en la consola ni en un mensaje de error. Sin token no se le pregunta
   * nada al servidor. No toca la firma ni lo que se aprueba: solo lee la sesión.
   */
  tokenDeSesion(tope = TOPE_TOKEN_MS): Promise<string | null> {
    const client = this.#client;
    if (!client) return Promise.resolve(null);
    const deLaSesion = (s: unknown): string | null => {
      const a = s as { step?: unknown; verified?: unknown; session?: { token?: { accessToken?: unknown } } } | null;
      if (!a || a.step !== "authenticated" || a.verified !== true) return null;
      const tk = a.session?.token?.accessToken;
      return typeof tk === "string" && tk.trim() !== "" ? tk : null;
    };
    let ya: string | null = null;
    try {
      ya = deLaSesion(client.getAuthState());
    } catch {
      return Promise.resolve(null);
    }
    if (ya) return Promise.resolve(ya);
    if (typeof client.onAuthStateChange !== "function") return Promise.resolve(null);
    return new Promise<string | null>((resolve) => {
      let listo = false;
      let soltar: (() => void) | null = null;
      const terminar = (v: string | null): void => {
        if (listo) return;
        listo = true;
        clearTimeout(reloj);
        try {
          soltar?.();
        } catch {
          /* ya suelto */
        }
        resolve(v);
      };
      const reloj = setTimeout(() => terminar(null), tope);
      try {
        // El kit repite el estado al suscribirse: puede contestar antes de que `soltar` exista.
        soltar = client.onAuthStateChange((s) => {
          const tk = deLaSesion(s);
          if (tk) terminar(tk);
        });
        if (listo) soltar();
      } catch {
        terminar(null);
      }
    });
  }

  /* ------------------------------------------------ otro celular u otra compu (sumar este navegador a la cuenta) */

  /** Con una llave guardada de la cuenta (el desbloqueo). Devuelve si este navegador quedó en la cuenta. */
  confirmarAparatoConDesbloqueo(): Promise<boolean> {
    return this.#confirmandoEsteNavegador((client) => client.cosign.recovery.recoverWithPasskey());
  }

  /** Con el correo de la cuenta, paso 1: Pollar manda un código al correo que la cuenta ya tiene confirmado. */
  async mandarCodigoParaEsteAparato(): Promise<void> {
    const client = await this.#ensureClient();
    await client.cosign.recovery.startEmailRecovery();
  }

  /** Con el correo de la cuenta, paso 2: el código que llegó. Devuelve si este navegador quedó en la cuenta. */
  confirmarCodigoParaEsteAparato(code: string): Promise<boolean> {
    return this.#confirmandoEsteNavegador((client) => client.cosign.recovery.recoverWithEmailCode(code));
  }

  /**
   * Corre una confirmación de este navegador y mira si su llave quedó entre las de la cuenta. Si quedó, deja la marca de
   * que se sumó en esta pestaña (sin datos de la cuenta), para sacarlo al cerrar sesión, y avisa a las otras pestañas.
   */
  async #confirmandoEsteNavegador(confirmar: (client: PollarClient) => Promise<{ devices?: ReadonlyArray<{ publicKey: string }> }>): Promise<boolean> {
    const client = await this.#ensureClient();
    const corrida = (async () => {
      const s = await confirmar(client);
      const llave = await client.cosign.publicKeyHex();
      const quedo = (s.devices ?? []).some((d) => mismaLlave(d.publicKey, llave));
      if (quedo) {
        ponerMarca(MARCAS_DE_LA_CUENTA.inscrito, "1");
        avisarCambioDeLaCuenta();
      }
      return quedo;
    })();
    const enCurso = corrida.catch(() => undefined);
    this.#confirmacion = enCurso;
    try {
      return await corrida;
    } finally {
      if (this.#confirmacion === enCurso) this.#confirmacion = null;
    }
  }

  /**
   * Antes de cerrar sesión: si este navegador se sumó a la cuenta en esta pestaña, sale. Espera primero una confirmación
   * en curso (con tope), busca entre los navegadores de la cuenta el que tiene la llave de este y lo saca a la fuerza
   * (es el propio), con tope. Si no se puede, la sesión se cierra igual y queda el aviso para la página.
   */
  async #sacarEsteNavegador(): Promise<void> {
    if (this.#confirmacion) await conTope(this.#confirmacion, TOPE_CONFIRMACION_EN_CURSO_MS).catch(() => undefined);
    if (leerMarca(MARCAS_DE_LA_CUENTA.inscrito) === null) return;
    try {
      const client = this.#client ?? (await this.#ensureClient());
      await conTope(
        (async () => {
          const [{ devices }, llave] = await Promise.all([client.cosign.devices(), client.cosign.publicKeyHex()]);
          const este = devices.find((d) => mismaLlave(d.publicKey, llave));
          if (este) await client.cosign.revokeDevice(este.id, { force: true });
        })(),
        TOPE_SACAR_NAVEGADOR_MS,
      );
    } catch {
      this.ultimoCierreDejoNavegador = true;
    }
  }

  /* ------------------------------------------------ proteger la cuenta (la recuperación) */

  /** ¿Se puede usar el desbloqueo del aparato (huella, rostro o PIN) para proteger la cuenta? */
  get puedeUsarPasskey(): boolean {
    return hayPasskeys();
  }

  /** Cómo está la protección de la cuenta. `null` si Pollar no lo dice (sin red, o esta cuenta no usa Turnkey). */
  async proteccion(): Promise<EstadoDeProteccion | null> {
    try {
      const client = await this.#ensureClient();
      const s = await client.cosign.recovery.status();
      return { requerida: s.required, lista: s.configured };
    } catch {
      return null;
    }
  }

  /** Con el desbloqueo del aparato: Pollar guarda la llave. Devuelve si la cuenta ya quedó protegida. */
  async protegerConPasskey(): Promise<boolean> {
    const client = await this.#ensureClient();
    const s = await client.cosign.recovery.addPasskey({ name: "Tinkazo" });
    return s.configured;
  }

  /** Con el correo, paso 1: Pollar manda un código de un solo uso a esa dirección. */
  async mandarCodigoDeProteccion(mail: string): Promise<void> {
    const client = await this.#ensureClient();
    await client.cosign.recovery.startEmail(mail);
  }

  /** Con el correo, paso 2: el código que llegó. Devuelve si la cuenta ya quedó protegida. */
  async confirmarCodigoDeProteccion(code: string): Promise<boolean> {
    const client = await this.#ensureClient();
    const s = await client.cosign.recovery.confirmEmail(code);
    return s.configured;
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
  void cargaOpcional(import("@pollar/core"));
}

/** Una wallet que envía sus propias transacciones. */
export const submitsItself = (w: WalletAdapter | null): w is SubmittingWallet =>
  !!w && (w as SubmittingWallet).submitsItself === true;
