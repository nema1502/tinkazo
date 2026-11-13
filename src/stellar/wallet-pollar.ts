import type { AuthOpenContext, CosignRequest, CosignVerification, PollarClient, ProviderRegistration, RegistryCheck, RequirementForm, RequirementFormAnswers, WalletInfo } from "@pollar/core";
import { network } from "./config";
import { compraQrActiva } from "./alta-config";
import { modoDeRampa } from "./cuenta-config";
import { errorKey, esDeRed } from "./errores";
import type { LecturaDeCotizacion, LoQueFalta, PasoDeVerificacion, PrecioDeCarga, QueSeAprueba, RutaDeBolivia } from "./rampa-pollar";
import { ingresoPlanB } from "./ingreso-bandera";
import { LEGACY_POLLAR_INTENT_KEY, TOPE_TOKEN_MS, leerMarcaPollar, pollarIntentKey, pollarKeyFor } from "./pollar-config";
import type { SignedTx, WalletAdapter } from "./wallet";
import { contarEntrada, marcarEntrada, tomarEntrada } from "../contar";
import { ceremoniaDelNavegador, hayPasskeys } from "./passkey";
import { enNavegadorDeApp } from "../navegador";
import { cargaOpcional } from "../carga-opcional";
import {
  DOLAR_DIGITAL,
  type PagoPedido,
  type ResultadoDelPagoConSaldo,
  VIDA_DEL_PAGO_S,
  VIDA_MAXIMA_S,
  leerElPago,
  montoExacto,
  motivoContraElPago,
  motivoDelRechazo,
  pedidoValido,
} from "./pago-con-saldo";
import { usdcDeLaRed } from "./usdc-cuenta";

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
 * firma de `signAndSubmit` y de `signUnsponsored` con la transacción que la página acaba de armar (el sello y el sorteo
 * de la persona, o lo que manda desde Tus dólares digitales), la del pago exacto de una orden (`pagarOrden`), que entra
 * recién después de pasar `motivoContraElPago`, y, por una rama angosta, la línea del USDC de Circle que la persona pide
 * activar con su botón (`activarUsdc`). Los pasos de la carga con bolivianos no son confirmaciones: son votos de co-firma
 * que se estampan con `relay` después de la regla (`cargaAprobar`, `cargaPreparar`). El clic en
 * "Sellar la lista" es el consentimiento y cubre también el sorteo de esa lista: con Pollar el sorteo se lanza solo
 * cuando nace la ronda (`espera.ts`, sin otro clic, como pasa con la cuenta de prueba), mientras que con Freighter la
 * persona lo aprueba en su ventana. El pago lo aprueba la persona en la confirmación propia del sitio. Cualquier otra
 * firma que llegue se rechaza y se anota. El cliente se
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
  /** Paga la orden de un paquete con el saldo de la cuenta (`pagarOrden` de `PollarWallet`). Nunca lanza. */
  pagarOrden?(p: Omit<PagoPedido, "cuenta">): Promise<ResultadoDelPagoConSaldo>;
}

export const pollarConfigured = (): boolean => pollarKeyFor(network.name) !== "";

/**
 * Una firma que el SDK dejó esperando confirmación (`PendingConfirmation` de `@pollar/core`, lo que usamos).
 * Es lo mismo que mostraría `<ConfirmModal>` de `@pollar/react`.
 */
export interface FirmaPendiente {
  id: string;
  kind: string;
  network?: string | undefined;
  operation?: string | undefined;
  unsignedXdr?: string | undefined;
  details?: Record<string, unknown> | undefined;
  confirm: () => void;
  reject: () => void;
}

/**
 * La línea del USDC de Circle que la persona acaba de pedir activar con su botón (`activarUsdc`): el código, el emisor de
 * la red, y `tomar`, que dice que sí una sola vez por toque.
 */
export interface LineaPedida {
  code: string;
  issuer: string;
  tomar(): boolean;
}

const soloEstasClaves = (o: unknown, claves: readonly string[]): o is Record<string, unknown> =>
  !!o && typeof o === "object" && !Array.isArray(o) && Object.keys(o).length === claves.length && claves.every((k) => Object.hasOwn(o, k));

/**
 * ¿Es exactamente la línea pedida? La arma el SDK (`setTrustline`): sin transacción a la vista, en Stellar, con
 * `details` = `{ asset: { type, code, issuer } }` y nada más. Un límite no entra (con `"0"` cerraría la línea).
 */
function esLaLineaPedida(p: FirmaPendiente, linea: LineaPedida): boolean {
  if (p.kind !== "build_sign_submit" || p.network !== "STELLAR" || p.operation !== "change_trust" || p.unsignedXdr !== undefined) return false;
  if (!soloEstasClaves(p.details, ["asset"])) return false;
  const a = p.details.asset;
  if (!soloEstasClaves(a, ["type", "code", "issuer"])) return false;
  return a.type === "credit_alphanum4" && a.code === "USDC" && a.code === linea.code && a.issuer === linea.issuer;
}

/**
 * Decide, una por una, las firmas que esperan confirmación.
 *
 * Se confirma la que cumple las tres: hay una firma pedida por nosotros en curso (`esperadas`: el XDR que se mandó a
 * firmar desde el botón de sellar o de sortear, o el pago de una orden ya revisado por `motivoContraElPago`), es de las
 * que firman una transacción (`sign` o `sign_and_send`, no una construida por el SDK como un pago o una línea de
 * confianza), y trae esa transacción y no otra (sin ella, no). Todo lo demás se rechaza: una firma que la persona no
 * pidió no se firma.
 *
 * `atendidas` guarda lo ya resuelto: el SDK repite la lista entera cada vez que cambia, y al resolver una vuelve a avisar.
 * `alRechazar` recibe solo el tipo y la operación, nunca el XDR ni datos de la cuenta.
 *
 * `linea` es la rama angosta: mientras la persona activa los dólares digitales con su botón, se confirma también la
 * línea del USDC de Circle de la red, solo esa y una sola vez (`tomar` va última, así una confirmación que no es la
 * pedida no la gasta). Sin `linea`, todo es como antes.
 */
export function atenderFirmas(
  pendientes: readonly FirmaPendiente[],
  esperadas: ReadonlySet<string>,
  atendidas: Set<string>,
  alRechazar: (motivo: string, que: { kind: string; operation: string }) => void,
  linea: LineaPedida | null = null,
): void {
  for (const p of pendientes) {
    if (atendidas.has(p.id)) continue;
    atendidas.add(p.id);
    const que = { kind: p.kind, operation: p.operation ?? "" };
    if (linea !== null && esLaLineaPedida(p, linea) && linea.tomar()) {
      p.confirm();
    } else if (esperadas.size === 0) {
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

/** El pago con el saldo que no se firma (o no se manda) porque no es el de la orden. El motivo es una palabra fija. */
const noAprobado = (motivo: string): ResultadoDelPagoConSaldo => {
  console.warn(`[tinkazo] pago con saldo no aprobado: ${motivo}`);
  return { estado: "no-salio", motivo: "regla" };
};

/**
 * La marca de un pago con el saldo que quizás salió, por orden (su nota) y hasta cuándo puede entrar (segundos Unix). Vive
 * en `localStorage` para que otra pestaña tampoco arme otro pago de la misma orden mientras tanto. No guarda la cuenta, el
 * monto ni la transacción. Sin almacenamiento, vale lo que vive la pestaña (`#pagando`).
 */
const MARCA_DEL_PAGO = "tinkazo.pago-saldo.";
/** Lo que se espera, después de que el pago ya no puede entrar, a que el servidor lo vea si entró. */
export const MARGEN_DEL_PAGO_S = 60;

export function leerMarcaDelPago(nota: string): number | null {
  try {
    const n = Number(localStorage.getItem(MARCA_DEL_PAGO + nota));
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}
function ponerMarcaDelPago(nota: string, hasta: number): void {
  try {
    localStorage.setItem(MARCA_DEL_PAGO + nota, String(Math.floor(hasta)));
  } catch {
    /* sin almacenamiento, la marca vive lo que vive el pago en curso */
  }
}
function borrarMarcaDelPago(nota: string): void {
  try {
    localStorage.removeItem(MARCA_DEL_PAGO + nota);
  } catch {
    /* ya no está */
  }
}

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

/* ------------------------------------------------ la carga con bolivianos: lo que no es de la clase */

/** El candado entre pestañas de la carga: preparar la cuenta, crear la orden, aprobar un paso y reintentar van de a uno. */
export const CANDADO_DE_LA_CARGA = "tinkazo-carga";
/** Ya pagué le pregunta a Pollar por el pago de una orden como mucho una vez cada diez segundos. */
export const YA_PAGUE_CADA_MS = 10_000;
/** Dos aprobaciones falladas en la misma orden y la misma pestaña: no se intenta más y se muestra la ayuda. */
export const TOPE_DE_APROBACIONES_FALLADAS = 2;
/** Las aprobaciones falladas de esta pestaña, por orden, en `sessionStorage`: sobreviven a recargar y se borran al cerrar sesión. */
export const MARCA_DE_APROBACIONES = "tinkazo.carga.fallas";
/** Cada cuánto mira la espera de la verificación de identidad, y hasta cuándo, si nadie la corta antes. */
export const VERIFICACION_CADA_MS = 3_000;
export const VERIFICACION_TOPE_MS = 5 * 60_000;
/** Cuántas cargas cerradas se le piden al kit para buscar la última que no terminó bien. */
const CERRADAS_POR_PAGINA = 20;
/** La carga es de Bolivia: el país de la verificación de identidad. */
const PAIS_DE_LA_CARGA = "BO";
/** Una cuenta que dejó de ser la de la sesión a mitad de camino. */
const SIN_CUENTA_DE_LA_CARGA = "carga-sin-cuenta";

/**
 * La carga con bolivianos se prende con `VITE_RAMPA=pollar` o con la compra con QR (`compraQrActiva`, que pide la compra
 * y el pago con el saldo), y vive solo en la red principal. Apagada, ningún método de la carga arma el cliente ni llama
 * a nada. El permiso del servidor para comprar con QR no se mira acá: lo pide la ventana antes de cada paso.
 */
export const cargaPrendida = (): boolean => (modoDeRampa() === "pollar" || compraQrActiva()) && network.name === "mainnet";

/**
 * Lo que corta cualquier llamada de la carga: la bandera apagada, sin la cuenta de la sesión, sin créditos de Tinkazo (un
 * `402`, que nunca es una falla de la persona), sin red, la cuenta que pide protegerse u otra cosa. Nunca el error del kit.
 */
export type FallaDeCarga =
  | { estado: "apagada" }
  | { estado: "sin-cuenta" }
  | { estado: "sin-creditos" }
  | { estado: "sin-red" }
  | { estado: "proteger-cuenta" }
  | { estado: "no-se-pudo" };

/** El error de una llamada de la carga en una palabra, como `motivoDelError` de `rampa-pollar.ts`. */
export function fallaDeCarga(e: unknown): FallaDeCarga {
  if (e instanceof Error && e.message === SIN_CUENTA_DE_LA_CARGA) return { estado: "sin-cuenta" };
  const codigo = codigoDelKit(e);
  if (codigo === "SDK_CREDITS_INSUFFICIENT" || codigo === "SDK_BILLING_OVERDUE") return { estado: "sin-creditos" };
  if (codigo === "SDK_WALLET_RECOVERY_REQUIRED") return { estado: "proteger-cuenta" };
  const sinInternet = typeof navigator !== "undefined" && navigator.onLine === false;
  if (sinInternet || (e !== null && e !== undefined && esDeRed(e))) return { estado: "sin-red" };
  return { estado: "no-se-pudo" };
}

/** Cómo quedó la verificación de identidad. Nunca dice más de lo que se sabe: una decisión sin cerrar está procesándose. */
export type EstadoDeVerificacion = "aprobada" | "procesando" | "en-revision" | "rechazada" | "vencida" | "en-curso";

/** Lo que dice `getKycStatus`, como lo lee la ventana del kit: aprobada o rechazada solo cuando el estado lo dice. */
export function estadoDeVerificacion(r: unknown): EstadoDeVerificacion {
  const x = esObjetoPlano(r) ? r : {};
  if (x.status === "approved") return "aprobada";
  if (x.status === "rejected") return "rechazada";
  if (x.status === "expired" || x.decisionStatus === "expired") return "vencida";
  if (x.decisionStatus === "manual_review") return "en-revision";
  if (x.decisionStatus === "approved" || x.decisionStatus === "rejected") return "procesando";
  return "en-curso";
}

const esObjetoPlano = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const soloTextos = (x: unknown): string[] => (Array.isArray(x) ? x.filter((v): v is string => typeof v === "string") : []);
const cuerpoDelError = (e: unknown): Record<string, unknown> => {
  const b = (e as { body?: unknown } | null)?.body;
  return esObjetoPlano(b) ? b : {};
};

/** Una página que se puede abrir: solo https y sin usuario ni clave adentro. */
function enlaceHttps(x: unknown): string | null {
  if (typeof x !== "string") return null;
  try {
    const u = new URL(x);
    return u.protocol === "https:" && !u.username && !u.password ? u.href : null;
  } catch {
    return null;
  }
}

/** Una clave para no empezar dos veces la misma verificación (y no pagarla dos veces). */
function claveNueva(): string {
  const c = globalThis.crypto;
  if (typeof c?.randomUUID === "function") return c.randomUUID();
  const b = new Uint8Array(16);
  c?.getRandomValues?.(b);
  return `kyc-${Date.now().toString(36)}-${aHex(b)}`;
}

/** Espera `ms`; `false` si la cortan antes. */
function pausa(ms: number, signal?: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve(false);
      return;
    }
    const fin = (v: boolean): void => {
      clearTimeout(reloj);
      signal?.removeEventListener("abort", alCortar);
      resolve(v);
    };
    const alCortar = (): void => fin(false);
    const reloj = setTimeout(() => fin(true), ms);
    signal?.addEventListener("abort", alCortar, { once: true });
  });
}

/** Las aprobaciones falladas que guarda esta pestaña, por orden. Lo que no se lee, no cuenta. */
function fallasGuardadas(): Record<string, number> {
  try {
    const v: unknown = JSON.parse(leerMarca(MARCA_DE_APROBACIONES) ?? "{}");
    if (!esObjetoPlano(v)) return {};
    const r: Record<string, number> = Object.create(null) as Record<string, number>;
    for (const [orden, n] of Object.entries(v)) if (typeof n === "number" && Number.isFinite(n) && n > 0) r[orden] = Math.floor(n);
    return r;
  } catch {
    return {};
  }
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
  /** La línea del USDC que la persona está activando con su botón: lo único que suma la rama angosta de la puerta. */
  #lineaPedida: LineaPedida | null = null;
  /** La activación de los dólares digitales en curso en esta pestaña. */
  #activandoUsdc: Promise<ResultadoDeActivarUsdc> | null = null;
  /** Las claves de cada verificación de identidad empezada en esta pestaña: tocar otra vez retoma la misma. */
  readonly #clavesDeVerificacion = new Map<string, string>();
  /** Cuándo preguntó Ya pagué por última vez, por orden. */
  readonly #chequeosDePago = new Map<string, number>();
  /** Las aprobaciones falladas por orden, también en memoria por si el almacenamiento falla. */
  readonly #fallasDeAprobar = new Map<string, number>();
  /** Lo de la carga en curso en esta pestaña: dos toques comparten una sola llamada. */
  readonly #aprobando = new Map<string, Promise<ResultadoDeAprobar>>();
  readonly #reintentando = new Map<string, Promise<ResultadoDeReintentar>>();
  #creandoOrden: Promise<ResultadoDeCrearOrden> | null = null;
  #preparando: Promise<ResultadoDePreparar> | null = null;
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
      // pasa por `atenderFirmas`, que solo confirma lo que la persona acaba de pedir con su botón.
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
        atenderFirmas(
          pendientes,
          new Set(this.#esperadas.keys()),
          this.#atendidas,
          (motivo, que) => console.warn(`[tinkazo] firma de Pollar rechazada (${motivo}): ${que.kind} ${que.operation}`.trim()),
          this.#lineaPedida,
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
  async #firmando<T>(xdr: string, firmar: (client: PollarClient) => Promise<T>, o: { testigo?: boolean } = {}): Promise<T> {
    const client = await this.#ensureClient();
    // En la red principal el kit vota solo la co-firma: el testigo anota si lo votado fue lo armado (riesgo aceptado,
    // docs/architecture.md). Solo mira, después de firmar. El pago con el saldo no lo usa: lo firmado se revisa entero
    // antes de mandarlo (`pagarOrden`).
    const testigo = network.name === "mainnet" && o.testigo !== false ? armarTestigo(client) : null;
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
    borrarMarca(MARCA_DE_APROBACIONES);
    this.#fallasDeAprobar.clear();
    this.#clavesDeVerificacion.clear();
    this.#chequeosDePago.clear();
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

  /* ------------------------------------------------ pagar un paquete con el saldo de la cuenta */

  /** El pago con el saldo en curso en esta pestaña: dos toques de la misma orden comparten uno solo. */
  #pagando: { nota: string; promesa: Promise<ResultadoDelPagoConSaldo> } | null = null;

  /**
   * Paga la orden de un paquete con los dólares digitales de esta cuenta. Solo se llama desde la confirmación propia del
   * sitio (Vas a pagar, `pago-saldo.ts`), con los datos de la orden del servidor tal cual. Nunca lanza.
   *
   * 1. La cuenta: la de la sesión, la misma que dice el kit, una G, en la red principal.
   * 2. Si esta orden ya tiene un pago con el saldo que quizás salió (en esta pestaña o en otra), no se arma otro: se
   *    devuelve `incierto` hasta que ese pago ya no pueda entrar (`marcaDelPago`).
   * 3. El proveedor arma el pago (`buildTx`), con la nota de texto de la orden y vida corta.
   * 4. Lo armado tiene que ser exactamente el pago de la orden (`motivoContraElPago`). Si no, no se firma.
   * 5. Recién ahí ese XDR, y solo ese, entra en las esperadas de la puerta (`#firmando`) y se firma, con el patrocinio.
   * 6. Lo firmado se revisa otra vez y tiene que venir envuelto, con la comisión a cargo de otra cuenta. Si no, no se manda.
   * 7. Se manda una vez (`submitTx`). Lo que no diga que la red lo rechazó es `incierto`: no se manda de nuevo.
   *
   * Pagar no da el acceso: eso lo dice el servidor cuando ve el pago (`/v1/alta/pago`).
   */
  pagarOrden(p: Omit<PagoPedido, "cuenta">): Promise<ResultadoDelPagoConSaldo> {
    if (this.#pagando) return this.#pagando.nota === p.nota ? this.#pagando.promesa : Promise.resolve({ estado: "no-salio", motivo: "red" });
    const promesa = conCandado("tinkazo-pagar-con-saldo", () => this.#pagar(p)).finally(() => {
      if (this.#pagando?.promesa === promesa) this.#pagando = null;
    });
    this.#pagando = { nota: p.nota, promesa };
    return promesa;
  }

  async #pagar(p: Omit<PagoPedido, "cuenta">): Promise<ResultadoDelPagoConSaldo> {
    const red = (): ResultadoDelPagoConSaldo => ({ estado: "no-salio", motivo: "red" });
    if (network.name !== "mainnet") return { estado: "no-salio", motivo: "sin-cuenta" };
    let client: PollarClient;
    try {
      client = await this.#ensureClient();
    } catch {
      return red();
    }
    // 1. La cuenta.
    const cuenta = this.#cuentaParaActivar(client);
    if (!cuenta) return { estado: "no-salio", motivo: "sin-cuenta" };
    const pedido: PagoPedido = { cuenta, destino: p.destino, monto: p.monto, nota: p.nota };
    const monto = montoExacto(p.monto);
    if (!monto || !pedidoValido(pedido)) return noAprobado("pedido");
    // 2. Un pago de esta orden que quizás salió.
    const ahora = (): number => Math.floor(Date.now() / 1000);
    const enVuelo = leerMarcaDelPago(p.nota);
    if (enVuelo !== null && enVuelo > ahora()) return { estado: "incierto", vence: enVuelo };
    // 3. El proveedor arma el pago.
    let armadoXdr: string | undefined;
    try {
      const armado = await client.buildTx(
        "payment",
        { destination: p.destino, amount: monto, asset: { type: "credit_alphanum4", code: DOLAR_DIGITAL.code, issuer: DOLAR_DIGITAL.issuer } },
        { memo: { type: "text", value: p.nota }, timeoutSec: VIDA_DEL_PAGO_S },
      );
      armadoXdr = armado.status === "built" ? armado.buildData.unsignedXdr : undefined;
    } catch {
      armadoXdr = undefined;
    }
    if (!armadoXdr) return red();
    const xdr = armadoXdr;
    // 4. La regla, con lo que armó.
    const motivo = motivoContraElPago(await leerElPago(xdr, network.networkPassphrase), pedido, { ahora: ahora(), firmada: false });
    if (motivo !== null) return noAprobado(motivo);
    // 5. La firma. Desde acá hasta saber cómo terminó, la orden queda marcada: otra pestaña no arma otro pago.
    ponerMarcaDelPago(p.nota, ahora() + VIDA_MAXIMA_S + MARGEN_DEL_PAGO_S);
    let firma: { status?: string; signedXdr?: string; submissionToken?: string; code?: string; details?: string; message?: string };
    try {
      firma = (await this.#firmando(xdr, (c) => c.signTx(xdr), { testigo: false })) as typeof firma;
    } catch {
      borrarMarcaDelPago(p.nota);
      return red();
    }
    if (firma.status !== "signed" || !firma.signedXdr) {
      // Sin firma no se mandó nada (una co-firma que quedó pendiente es de firmar solamente: nadie la manda).
      borrarMarcaDelPago(p.nota);
      const codigos = [firma.code, firma.details, firma.message].filter((x): x is string => typeof x === "string").join(" ");
      if (/SDK_CONFIRMATION_DECLINED|SDK_COSIGN_REJECTED|SDK_COSIGN_TURNKEY_REJECTED/.test(codigos)) return { estado: "no-salio", motivo: "cancelado" };
      return red();
    }
    // 6. Lo firmado, otra vez con la regla, y envuelto con la comisión a cargo de otra cuenta.
    const firmada = await leerElPago(firma.signedXdr, network.networkPassphrase);
    const motivoFirmada = motivoContraElPago(firmada, pedido, { ahora: ahora(), firmada: true });
    if (motivoFirmada !== null || !firmada?.vence) {
      borrarMarcaDelPago(p.nota);
      if (motivoFirmada === "sin-patrocinio") {
        console.warn("[tinkazo] pago con saldo no enviado: la comisión no la cubre la app");
        return { estado: "no-salio", motivo: "sin-patrocinio" };
      }
      return noAprobado(motivoFirmada ?? "sin vencimiento");
    }
    const vence = firmada.vence + MARGEN_DEL_PAGO_S;
    ponerMarcaDelPago(p.nota, vence);
    // 7. Se manda una vez.
    let envio: { status?: string; hash?: string; resultCode?: string; details?: string; code?: string; message?: string };
    try {
      envio = (await client.submitTx(firma.signedXdr, firma.submissionToken ? { submissionToken: firma.submissionToken } : undefined)) as typeof envio;
    } catch {
      return { estado: "incierto", vence };
    }
    if (envio.status === "success" && envio.hash) return { estado: "salio", hash: envio.hash };
    if (envio.status === "error") {
      const rechazo = motivoDelRechazo([envio.resultCode, envio.details, envio.code, envio.message].filter((x): x is string => typeof x === "string"), { secuenciaIncierta: compraQrActiva() });
      if (rechazo) {
        // La red dijo que no: esa transacción ya no entra, y se puede volver a intentar.
        borrarMarcaDelPago(p.nota);
        return { estado: "no-salio", motivo: rechazo };
      }
    }
    return { estado: "incierto", vence };
  }

  /* ------------------------------------------------ activar los dólares digitales (la línea del USDC de Circle) */

  /**
   * Activa los dólares digitales de la cuenta de Google o de correo: le pide a Pollar la línea del USDC de Circle de la
   * red, sin límite y sin saltear el patrocinio. Sale solo del toque de la persona en Activar dólares digitales: mientras
   * dura, la puerta confirma esa línea y nada más. Con la bandera apagada no arma el cliente ni llama a nada. Dos toques
   * seguidos piden una sola.
   */
  activarUsdc(): Promise<ResultadoDeActivarUsdc> {
    if (modoDeRampa() === "apagada") return Promise.resolve("apagada");
    return this.#activarUsdcYa();
  }

  /**
   * Pedir la línea, sin mirar `VITE_RAMPA`: lo usa también Preparar mi cuenta de la carga, que tiene su propia bandera
   * (`cargaPrendida`, que vale también con la compra con QR sola). Dos toques piden una sola.
   */
  #activarUsdcYa(): Promise<ResultadoDeActivarUsdc> {
    if (this.#activandoUsdc || this.#lineaPedida) return Promise.resolve("en-curso");
    this.#activandoUsdc = this.#pedirLineaUsdc().finally(() => {
      this.#activandoUsdc = null;
    });
    return this.#activandoUsdc;
  }

  async #pedirLineaUsdc(): Promise<ResultadoDeActivarUsdc> {
    let client: PollarClient;
    try {
      client = await this.#ensureClient();
    } catch {
      return "no-salio";
    }
    const usdc = usdcDeLaRed(network.name);
    let quedan = 1;
    this.#lineaPedida = { code: usdc.code, issuer: usdc.issuer, tomar: () => quedan-- > 0 };
    try {
      const r = (await client.setTrustline({ code: usdc.code, issuer: usdc.issuer })) as { status?: string; code?: string; details?: string };
      return resultadoDeLaLinea(r);
    } catch {
      return "no-salio";
    } finally {
      this.#lineaPedida = null;
    }
  }

  /**
   * Si la app pone la reserva de la línea del USDC de Circle (el catálogo de Pollar, `GET /wallet/assets`): solo lee.
   * `null` si no se pudo leer, o con la bandera apagada.
   */
  async catalogoUsdc(): Promise<"patrocinada" | "no-patrocinada" | null> {
    if (modoDeRampa() === "apagada") return null;
    try {
      const client = await this.#ensureClient();
      await client.refreshAssets();
      const s = client.getEnabledAssetsState();
      if (s.step !== "loaded") return null;
      const usdc = usdcDeLaRed(network.name);
      const a = s.data.assets.find((x) => x.code === usdc.code && x.issuer === usdc.issuer && (x.chain === undefined || x.chain === "STELLAR"));
      return a?.sponsored === true ? "patrocinada" : "no-patrocinada";
    } catch {
      return null;
    }
  }

  /**
   * Si ya espera un pedido de activar la línea (una co-firma `change_trust` pendiente): así Se está activando se ve en
   * cualquier pestaña y después de recargar, y el botón no vuelve mientras el pedido siga vivo. Leer no aprueba nada.
   * `null` si no se pudo leer, o con la bandera apagada.
   */
  async pendienteDeActivacion(): Promise<boolean | null> {
    if (modoDeRampa() === "apagada") return null;
    return this.#pendienteDeLinea();
  }

  /** Lo mismo, sin mirar `VITE_RAMPA`, para Preparar mi cuenta de la carga. */
  async #pendienteDeLinea(): Promise<boolean | null> {
    try {
      const client = await this.#ensureClient();
      let lista = (client.getCosignState().pending ?? []) as PedidoDeCofirma[];
      if (lista.length === 0) lista = (await client.cosign.pending()) as PedidoDeCofirma[];
      return lista.some((p) => p.status === "PENDING" && p.operation === "change_trust");
    } catch {
      return null;
    }
  }

  /* ------------------------------------------------ la carga con bolivianos */

  /**
   * Lo común a cada llamada de la carga: con la bandera apagada no arma el cliente; sin la cuenta de la sesión (la misma
   * que dice el kit, una G, en la red principal) no llama a nada; y cualquier error vuelve como una palabra, nunca con el
   * texto del kit. Las funciones puras de la carga (`rampa-pollar.ts`, `rampa-regla.ts`) se bajan recién acá.
   */
  async #enLaCarga<T>(f: (client: PollarClient, cuenta: string) => Promise<T>): Promise<T | FallaDeCarga> {
    if (!cargaPrendida()) return { estado: "apagada" };
    let client: PollarClient;
    try {
      client = await this.#ensureClient();
    } catch (e) {
      return fallaDeCarga(e);
    }
    const cuenta = this.#cuentaParaActivar(client);
    if (!cuenta) return { estado: "sin-cuenta" };
    try {
      return await f(client, cuenta);
    } catch (e) {
      return fallaDeCarga(e);
    }
  }

  /** Justo antes de votar: el cliente y la cuenta siguen siendo los de la sesión con que se empezó. */
  #sigueLaCuenta(client: PollarClient, cuenta: string): void {
    if (this.#client !== client || this.#cuentaParaActivar(client) !== cuenta) throw new Error(SIN_CUENTA_DE_LA_CARGA);
  }

  /** La ruta de Bolivia por QR hasta el USDC de Circle en Stellar, o que no está. Solo lee. */
  cargaRuta(): Promise<ResultadoDeRuta> {
    return this.#enLaCarga(async (client): Promise<ResultadoDeRuta> => {
      const { rutaDeBolivia } = await import("./rampa-pollar");
      const ruta = rutaDeBolivia(await client.getRampRoutes("ONRAMP"));
      return ruta ? { estado: "ruta", ruta } : { estado: "sin-ruta" };
    });
  }

  /**
   * El precio de pagar `bolivianos` Bs enteros por esa ruta, o lo que falta para tenerlo (la verificación, proteger la
   * cuenta, la línea, la cuenta de paso). Cotizar no mueve dinero.
   */
  cargaCotizar(ruta: RutaDeBolivia, bolivianos: number): Promise<ResultadoDeCotizar> {
    return this.#enLaCarga(async (client): Promise<ResultadoDeCotizar> => {
      const { cuerpoDeCotizacion, leerCotizacion, leerErrorDeCotizacion } = await import("./rampa-pollar");
      const cuerpo = cuerpoDeCotizacion(ruta, bolivianos);
      if (!cuerpo) return { estado: "no-se-puede" };
      try {
        return leerCotizacion(await client.quoteRamp(cuerpo));
      } catch (e) {
        return leerErrorDeCotizacion(e);
      }
    });
  }

  /**
   * Empieza (o retoma) la verificación de identidad del paso y devuelve la página del proveedor para abrir en otra pestaña.
   * La pestaña la abre la pantalla dentro del toque (en blanco, y le pone esta dirección cuando llega), como la ventana de
   * Google. Tocar otra vez retoma la misma verificación; `deNuevo` empieza otra (Empezar de nuevo). Solo una página https.
   */
  cargaAbrirVerificacion(paso: PasoDeVerificacion, opciones: { deNuevo?: boolean } = {}): Promise<ResultadoDeAbrirVerificacion> {
    return this.#enLaCarga(async (client): Promise<ResultadoDeAbrirVerificacion> => {
      if (paso.tipo !== "KYC") return { estado: "desconocido" };
      const llave = `${paso.opcion}\n${paso.corredor}`;
      if (opciones.deNuevo) this.#clavesDeVerificacion.delete(llave);
      const clave = this.#clavesDeVerificacion.get(llave) ?? claveNueva();
      this.#clavesDeVerificacion.set(llave, clave);
      // Como la ventana del kit: el nivel del proveedor si está en la lista del país, y el país solo en ese caso.
      const lista = await client.getKycProviders(PAIS_DE_LA_CARGA, paso.corredor).catch(() => null);
      const listado = (Array.isArray(lista?.providers) ? lista.providers : []).find((p) => p.id === paso.opcion);
      try {
        const r = await client.resolveKyc(paso.opcion, listado?.levels?.[0], listado ? PAIS_DE_LA_CARGA : undefined, paso.corredor, clave);
        if (r.alreadyApproved) return { estado: "lista" };
        const url = enlaceHttps(r.kycUrl);
        return url ? { estado: "abrir", url } : { estado: "desconocido" };
      } catch (e) {
        const codigo = codigoDelKit(e);
        if (codigo === "SDK_KYC_ALREADY_APPROVED") return { estado: "lista" };
        if (codigo === "SDK_KYC_UNDER_REVIEW") return { estado: "en-revision" };
        if (codigo !== "SDK_KYC_SESSION_EXPIRED") throw e;
        this.#clavesDeVerificacion.delete(llave);
        return { estado: "vencida" };
      }
    });
  }

  /** Ya terminé: cómo quedó la verificación del paso, ahora. Solo lee. */
  cargaMirarVerificacion(paso: PasoDeVerificacion): Promise<ResultadoDeMirarVerificacion> {
    return this.#enLaCarga(async (client): Promise<ResultadoDeMirarVerificacion> => {
      if (paso.tipo !== "KYC") return { estado: "desconocido" };
      return { estado: "leida", verificacion: estadoDeVerificacion(await client.getKycStatus(undefined, paso.corredor)) };
    });
  }

  /**
   * Mientras la persona se verifica en la otra pestaña: mira cada `cadaMs` hasta que hay una respuesta, hasta `topeMs`, o
   * hasta que la pantalla la corta (`signal`, al cerrar la ventana). Es la espera de `pollKycDecision` del kit, que no se
   * puede cortar. Solo lee.
   */
  cargaEsperarVerificacion(paso: PasoDeVerificacion, opciones: { signal?: AbortSignal; cadaMs?: number; topeMs?: number } = {}): Promise<ResultadoDeMirarVerificacion> {
    const { signal, cadaMs = VERIFICACION_CADA_MS, topeMs = VERIFICACION_TOPE_MS } = opciones;
    return this.#enLaCarga(async (client): Promise<ResultadoDeMirarVerificacion> => {
      if (paso.tipo !== "KYC") return { estado: "desconocido" };
      const hasta = Date.now() + topeMs;
      for (;;) {
        if (signal?.aborted) return { estado: "cortada" };
        const verificacion = estadoDeVerificacion(await client.getKycStatus(undefined, paso.corredor));
        if (signal?.aborted) return { estado: "cortada" };
        if (verificacion !== "en-curso" || Date.now() + cadaMs > hasta) return { estado: "leida", verificacion };
        if (!(await pausa(cadaMs, signal))) return { estado: "cortada" };
      }
    });
  }

  /** Unos datos tuyos: el formulario del paso, con lo que la persona ya contestó. Solo lee. */
  cargaLeerFormulario(paso: PasoDeVerificacion): Promise<ResultadoDeFormulario> {
    return this.#enLaCarga(async (client): Promise<ResultadoDeFormulario> => {
      if (paso.tipo !== "FORM") return { estado: "desconocido" };
      return { estado: "formulario", formulario: await client.getRequirementForm(paso.opcion) };
    });
  }

  /** Guardar y seguir: las respuestas del formulario del paso. Lo que el servidor no acepta vuelve por campo. */
  cargaGuardarFormulario(paso: PasoDeVerificacion, respuestas: RequirementFormAnswers): Promise<ResultadoDeGuardarFormulario> {
    return this.#enLaCarga(async (client): Promise<ResultadoDeGuardarFormulario> => {
      if (paso.tipo !== "FORM") return { estado: "desconocido" };
      try {
        await client.submitRequirementForm(paso.opcion, respuestas);
        return { estado: "guardado" };
      } catch (e) {
        if (codigoDelKit(e) !== "KYC_FORM_INVALID_ANSWERS") throw e;
        const lista = cuerpoDelError(e).errors;
        const errores = (Array.isArray(lista) ? lista : []).flatMap((x) => (esObjetoPlano(x) && typeof x.key === "string" && typeof x.code === "string" ? [{ key: x.key, code: x.code }] : []));
        return { estado: "respuestas", errores };
      }
    });
  }

  /** Confirmá tus datos: lo que se compara con el SEGIP, o cómo quedó la comprobación. Solo lee. */
  cargaLeerSegip(paso: PasoDeVerificacion): Promise<ResultadoDeSegip> {
    return this.#enLaCarga(async (client): Promise<ResultadoDeSegip> => {
      if (paso.tipo !== "REGISTRY_CHECK") return { estado: "desconocido" };
      let segip: RegistryCheck;
      try {
        segip = await client.getRegistryCheck(paso.opcion);
      } catch (e) {
        if (codigoDelKit(e) === "KYC_REGISTRY_IDENTITY_REQUIRED") return { estado: "falta-identidad" };
        throw e;
      }
      if (segip.status === "approved") return { estado: "aprobada" };
      if (segip.status === "pending") return { estado: "en-revision" };
      return { estado: "datos", segip };
    });
  }

  /** Confirmar mis datos: los apellidos y el complemento, sin espacios de más y sin los campos vacíos. */
  cargaConfirmarSegip(paso: PasoDeVerificacion, edicion: { surname1: string; surname2?: string; complementNumber?: string }): Promise<ResultadoDeSegip> {
    return this.#enLaCarga(async (client): Promise<ResultadoDeSegip> => {
      const surname1 = edicion.surname1.trim();
      const surname2 = (edicion.surname2 ?? "").trim();
      const complementNumber = (edicion.complementNumber ?? "").trim();
      if (paso.tipo !== "REGISTRY_CHECK" || !surname1) return { estado: "desconocido" };
      try {
        const r = await client.submitRegistryCheck(paso.opcion, { surname1, ...(surname2 ? { surname2 } : {}), ...(complementNumber ? { complementNumber } : {}) });
        if (r.status === "approved") return { estado: "aprobada" };
        if (r.status === "rejected") return { estado: "rechazada", campos: soloTextos(r.rejectedFields) };
        return { estado: "en-revision" };
      } catch (e) {
        const codigo = codigoDelKit(e);
        if (codigo === "SDK_KYC_ALREADY_APPROVED") return { estado: "aprobada" };
        if (codigo === "KYC_REGISTRY_NAME_MISMATCH") return { estado: "no-coincide" };
        if (codigo === "SDK_KYC_UNDER_REVIEW") return { estado: "en-revision" };
        throw e;
      }
    });
  }

  /** Tu alta con Stereum: si ya está registrada, o lo que recibe Stereum. Solo lee. */
  cargaLeerAlta(paso: PasoDeVerificacion): Promise<ResultadoDeAlta> {
    return this.#enLaCarga(async (client): Promise<ResultadoDeAlta> => {
      if (paso.tipo !== "PROVIDER_REGISTRATION") return { estado: "desconocido" };
      const alta = await client.getProviderRegistration(paso.corredor);
      return alta.status === "registered" ? { estado: "registrada" } : { estado: "alta", alta };
    });
  }

  /** Darme de alta: con Stereum, por la ruta del paso. Si faltan datos, cuáles y en qué formularios. */
  cargaDarDeAlta(paso: PasoDeVerificacion): Promise<ResultadoDeAlta> {
    return this.#enLaCarga(async (client): Promise<ResultadoDeAlta> => {
      if (paso.tipo !== "PROVIDER_REGISTRATION") return { estado: "desconocido" };
      try {
        const r = await client.submitProviderRegistration(paso.corredor);
        return r.status === "registered" ? { estado: "registrada" } : { estado: "pendiente" };
      } catch (e) {
        if (codigoDelKit(e) !== "KYC_REGISTRATION_MISSING_DATA") throw e;
        const cuerpo = cuerpoDelError(e);
        const formularios = (Array.isArray(cuerpo.forms) ? cuerpo.forms : []).flatMap((f) => (esObjetoPlano(f) && typeof f.formId === "string" ? [f.formId] : []));
        return { estado: "faltan-datos", faltan: soloTextos(cuerpo.missing), invalidos: soloTextos(cuerpo.invalid), formularios };
      }
    });
  }

  /**
   * Preparar mi cuenta: un toque que hace, en orden y sin reintentos solos, lo que la cotización dijo que falta para recibir.
   * Abre la línea del USDC de Circle si falta (`activarUsdc`, por la rama angosta de la puerta, y nunca otra mientras la
   * primera espera) y crea la cuenta de paso en Polygon si la ruta la pide (`runRampWalletStep`), aprobando su pedido con
   * la regla de la cuenta de paso. Ninguna de las dos mueve dinero. Si la cuenta pide protegerse, no hace nada. Dos toques
   * preparan una sola vez, y entre pestañas va con el candado de la carga.
   */
  cargaPreparar(falta: readonly LoQueFalta[]): Promise<ResultadoDePreparar> {
    if (!cargaPrendida()) return Promise.resolve({ estado: "apagada" });
    this.#preparando ??= this.#enLaCarga((client, cuenta) => conCandado(CANDADO_DE_LA_CARGA, () => this.#preparar(client, cuenta, falta))).finally(() => {
      this.#preparando = null;
    });
    return this.#preparando;
  }

  async #preparar(client: PollarClient, cuenta: string, falta: readonly LoQueFalta[]): Promise<ResultadoDePreparar> {
    if (falta.some((f) => f.que === "proteger-cuenta")) return { estado: "proteger-cuenta" };
    if (falta.some((f) => f.que === "linea")) {
      // Con la bandera de la carga (también la de la compra con QR sola), no con la de VITE_RAMPA: si no, quedaría apagada.
      if ((await this.#pendienteDeLinea()) === true) return { estado: "linea", resultado: "en-curso" };
      const r = await this.#activarUsdcYa();
      if (r !== "hecho") return { estado: "linea", resultado: r };
    }
    if (!falta.some((f) => f.que === "cuenta-de-paso")) return { estado: "listo" };
    // Un pedido de la cuenta que ya espera se vota: no se crea otra cuenta.
    const antes = await this.#votarCuentaDePaso(client, cuenta);
    if (antes !== "nada") return comoQuedoLaCuentaDePaso(antes);
    const { rampWalletStep } = await import("@pollar/core");
    const paso = rampWalletStep({ failure: { resolutionAction: "set_up_wallet", detail: "POLYGON" } } as unknown as Parameters<typeof rampWalletStep>[0]);
    if (!paso) return { estado: "no-se-pudo" };
    let quedaElPedido = false;
    try {
      const { recoveryRequired } = await client.runRampWalletStep(paso);
      if (recoveryRequired) return { estado: "proteger-cuenta" };
    } catch (e) {
      // La cuenta nueva deja un pedido que espera el voto de este navegador.
      if (codigoDelKit(e) !== "SDK_RAMPS_WALLET_NOT_READY") throw e;
      quedaElPedido = true;
    }
    const despues = await this.#votarCuentaDePaso(client, cuenta);
    if (despues === "nada") return quedaElPedido ? { estado: "cuenta-de-paso-espera" } : { estado: "listo" };
    return comoQuedoLaCuentaDePaso(despues);
  }

  /**
   * Vota el pedido de la cuenta de paso, si hay uno: el más nuevo, pendiente, de crear cuentas en la billetera de la
   * persona. Se pide de nuevo una sola vez si se puede, se revisa esa versión con `motivoContraLaCuentaDePaso` sobre la
   * propuesta de `verify`, y recién ahí `relay`. Un pedido ya votado no se vota otra vez.
   */
  async #votarCuentaDePaso(client: PollarClient, cuenta: string): Promise<VotoDeLaCuentaDePaso> {
    const [lista, recuperacion] = await Promise.all([client.cosign.pending(), client.cosign.recovery.status()]);
    const candidato = elMasNuevo((lista as unknown as PedidoDeCofirma[]).filter((p) => p.kind === "ACCOUNT" && p.status === "PENDING"));
    if (!candidato) return "nada";
    const pedido = (candidato.refreshable ? await client.cosign.refresh(candidato.id) : candidato) as PedidoDeCofirma;
    if (pedido.id !== candidato.id) return cuentaDePasoRara("otro pedido");
    if (pedido.status !== "PENDING") return pedido.status === "APPROVED" ? "aprobada" : "no-salio";
    if (pedido.activityId) return "pendiente";
    const verificacion = await client.cosign.verify(pedido as unknown as CosignRequest);
    const { motivoContraLaCuentaDePaso } = await import("./rampa-regla");
    const motivo = motivoContraLaCuentaDePaso(pedido, verificacion, recuperacion.subOrgId ?? "");
    if (motivo !== null || !verificacion.ok) return cuentaDePasoRara(motivo ?? "otra propuesta");
    this.#sigueLaCuenta(client, cuenta);
    let votado: PedidoDeCofirma;
    try {
      votado = await this.#votar(client, pedido.id, verificacion);
    } catch (e) {
      if (fallaDeCarga(e).estado === "sin-creditos") throw e;
      return "no-salio";
    }
    return votado.status === "APPROVED" ? "aprobada" : votado.status === "PENDING" ? "pendiente" : "no-salio";
  }

  /** Estampa la propuesta revisada y lee cómo quedó el pedido. Un pedido que ya no espera se lee: no se vota otra vez. */
  async #votar(client: PollarClient, id: string, verificacion: Extract<CosignVerification, { ok: true }>): Promise<PedidoDeCofirma> {
    let votado: PedidoDeCofirma;
    try {
      const res = await client.cosign.relay(verificacion.proposal.path, verificacion.proposal.body, { requestId: id });
      votado = (res.request ?? (await client.cosign.get(id, { sync: true }))) as PedidoDeCofirma;
    } catch (e) {
      if (codigoDelKit(e) !== "SDK_COSIGN_REQUEST_NOT_PENDING") throw e;
      votado = (await client.cosign.get(id, { sync: true })) as PedidoDeCofirma;
    }
    if (votado.status === "PENDING") {
      try {
        votado = (await client.cosign.settle(votado as unknown as CosignRequest)) as PedidoDeCofirma;
      } catch {
        /* el voto salió: queda pendiente y se lee después */
      }
    }
    return votado;
  }

  /**
   * Crea la orden de carga con la cotización que la persona aceptó, desde su toque en Ver el QR. Dentro del candado de la
   * carga relee las abiertas: si ya hay una (otra pestaña, otro aparato, un toque anterior), no crea otra y va a esa; si
   * no se puede saber, no crea nada. Así las pestañas de este navegador nunca tienen dos QR vivos. Entre dos equipos lo
   * cuida el servidor: el aviso de la compra con QR contesta `409 cargando` durante 3 minutos después de otro que dio el
   * sí (`cargaCrearOrdenDeCompra`). Los datos que pide la cotización van solo por su clave.
   * Sin respuesta al crear, mira otra vez antes de decir nada.
   *
   * `avisar` corre dentro del mismo candado, después de releer las abiertas y justo antes de crear: la compra con QR avisa
   * ahí la carga al servidor (`/v1/compra/cargar`), que ata el recargo a la persona. Sin su sí (`false`, o un error) no se
   * crea la orden y no se mueve plata. Con una carga abierta no se avisa.
   */
  cargaCrearOrden(precio: PrecioDeCarga, datos: Readonly<Record<string, string>> = {}, opciones: { avisar?: () => Promise<boolean> } = {}): Promise<ResultadoDeCrearOrden> {
    if (!cargaPrendida()) return Promise.resolve({ estado: "apagada" });
    this.#creandoOrden ??= this.#enLaCarga((client) => conCandado(CANDADO_DE_LA_CARGA, () => this.#crearOrden(client, precio, datos, opciones.avisar))).finally(() => {
      this.#creandoOrden = null;
    });
    return this.#creandoOrden;
  }

  async #crearOrden(client: PollarClient, precio: PrecioDeCarga, datos: Readonly<Record<string, string>>, avisar: (() => Promise<boolean>) | undefined): Promise<ResultadoDeCrearOrden> {
    const { cargaAbierta } = await import("./rampa-pollar");
    const abiertas = cargaAbierta(await client.listRampOrders({ open: "true" }));
    if (abiertas.estado === "abierta") return { estado: "ya-hay", id: abiertas.id };
    if (abiertas.estado === "no-se-sabe") return { estado: "no-se-sabe" };
    if (precio.vence !== null && !(Date.parse(precio.vence) > Date.now())) return { estado: "precio-vencido" };
    const payee: Record<string, string> = {};
    for (const campo of precio.campos) {
      const valor = (Object.hasOwn(datos, campo.key) ? datos[campo.key] : undefined)?.trim() ?? "";
      if (valor) payee[campo.key] = valor;
      else if (!campo.optional) return { estado: "faltan-datos" };
    }
    if (avisar && (await avisar()) !== true) return { estado: "sin-aviso" };
    let orden: unknown;
    try {
      orden = await client.createRampOrder({ quoteId: precio.quoteId, ...(Object.keys(payee).length ? { payee } : {}) });
    } catch (e) {
      const codigo = codigoDelKit(e);
      if (codigo === "SDK_RAMPS_WALLET_NOT_READY") return { estado: "cuenta-de-paso" };
      if (codigo === "SDK_RAMPS_QUOTE_EXPIRED") return { estado: "precio-vencido" };
      if (codigo === "VALIDATION_ERROR") return { estado: "faltan-datos" };
      const falla = fallaDeCarga(e);
      if (falla.estado !== "sin-red") return falla;
      const otra = await client.listRampOrders({ open: "true" }).then(cargaAbierta, () => null);
      return otra?.estado === "abierta" ? { estado: "ya-hay", id: otra.id } : falla;
    }
    const id = esObjetoPlano(orden) && typeof orden.id === "string" && orden.id !== "" ? orden.id : null;
    if (!id) return { estado: "no-se-sabe" };
    return { estado: "creada", id, orden, falloAlCrear: (orden as { state?: unknown }).state === "failed" };
  }

  /**
   * Crear la orden de carga de la compra con QR: como `cargaCrearOrden`, con el aviso al servidor siempre, también con una
   * carga abierta, y la anulación después de una falla definitiva. Dentro del candado de la carga:
   *
   * 1. Relee las abiertas. Si no se puede saber, no hace nada.
   * 2. Con una abierta, avisa una vez y la adopta (`ya-hay`) solo con el sí del aviso. Con un QR vivo nunca se anula.
   * 3. Sin ninguna: el precio vigente y los datos que pide, antes de avisar (sin aviso no hay nada que anular).
   * 4. Avisa. Sin el sí no se crea nada. Si el aviso no tuvo respuesta (`sin-red`, o lanzó), el servidor pudo marcar la
   *    compra igual: relee y, solo si no hay ninguna abierta, anula.
   * 5. Crea. Después del sí, una falla definitiva (cuenta de paso, precio vencido, datos, sin créditos, la orden que nace
   *    fallada) anula. Sin respuesta, relee: si nació va a ella, con ninguna anula, y si no se sabe no anula. Una orden sin
   *    id no se anula: puede haber un QR vivo.
   *
   * Anular suelta la reserva y no el recargo: la compra sigue en curso. La anulación no cambia lo que se devuelve.
   */
  cargaCrearOrdenDeCompra(precio: PrecioDeCarga, datos: Readonly<Record<string, string>>, aviso: AvisoDeLaCompra): Promise<ResultadoDeCrearOrden> {
    if (!cargaPrendida()) return Promise.resolve({ estado: "apagada" });
    this.#creandoOrden ??= this.#enLaCarga((client) => conCandado(CANDADO_DE_LA_CARGA, () => this.#crearOrdenDeCompra(client, precio, datos, aviso))).finally(() => {
      this.#creandoOrden = null;
    });
    return this.#creandoOrden;
  }

  async #crearOrdenDeCompra(client: PollarClient, precio: PrecioDeCarga, datos: Readonly<Record<string, string>>, aviso: AvisoDeLaCompra): Promise<ResultadoDeCrearOrden> {
    const { cargaAbierta } = await import("./rampa-pollar");
    const releer = (): Promise<ReturnType<typeof cargaAbierta> | null> => client.listRampOrders({ open: "true" }).then(cargaAbierta, () => null);
    const avisar = async (): Promise<boolean | "sin-red"> => {
      try {
        return await aviso.avisar();
      } catch {
        return "sin-red";
      }
    };
    const anular = async (): Promise<void> => {
      try {
        await aviso.anular();
      } catch {
        /* la anulación no cambia lo que se devuelve: la compra la puede soltar quien opera */
      }
    };
    const abiertas = cargaAbierta(await client.listRampOrders({ open: "true" }));
    if (abiertas.estado === "no-se-sabe") return { estado: "no-se-sabe" };
    if (abiertas.estado === "abierta") return (await avisar()) === true ? { estado: "ya-hay", id: abiertas.id } : { estado: "sin-aviso" };
    if (precio.vence !== null && !(Date.parse(precio.vence) > Date.now())) return { estado: "precio-vencido" };
    const payee: Record<string, string> = {};
    for (const campo of precio.campos) {
      const valor = (Object.hasOwn(datos, campo.key) ? datos[campo.key] : undefined)?.trim() ?? "";
      if (valor) payee[campo.key] = valor;
      else if (!campo.optional) return { estado: "faltan-datos" };
    }
    const dijo = await avisar();
    if (dijo !== true) {
      if (dijo === "sin-red" && (await releer())?.estado === "ninguna") await anular();
      return { estado: "sin-aviso" };
    }
    let orden: unknown;
    try {
      orden = await client.createRampOrder({ quoteId: precio.quoteId, ...(Object.keys(payee).length ? { payee } : {}) });
    } catch (e) {
      const codigo = codigoDelKit(e);
      const definitiva: ResultadoDeCrearOrden | null =
        codigo === "SDK_RAMPS_WALLET_NOT_READY" ? { estado: "cuenta-de-paso" } : codigo === "SDK_RAMPS_QUOTE_EXPIRED" ? { estado: "precio-vencido" } : codigo === "VALIDATION_ERROR" ? { estado: "faltan-datos" } : null;
      const falla = definitiva ?? fallaDeCarga(e);
      if (definitiva || falla.estado === "sin-creditos") {
        await anular();
        return falla;
      }
      if (falla.estado !== "sin-red") return falla;
      const otra = await releer();
      if (otra?.estado === "abierta") return { estado: "ya-hay", id: otra.id };
      if (otra?.estado === "ninguna") await anular();
      return falla;
    }
    const id = esObjetoPlano(orden) && typeof orden.id === "string" && orden.id !== "" ? orden.id : null;
    if (!id) return { estado: "no-se-sabe" };
    const falloAlCrear = (orden as { state?: unknown }).state === "failed";
    if (falloAlCrear) await anular();
    return { estado: "creada", id, orden, falloAlCrear };
  }

  /** La orden como está ahora, o que ya no existe para esta persona. Solo lee. */
  cargaLeerOrden(id: string): Promise<ResultadoDeOrden> {
    return this.#enLaCarga(async (client): Promise<ResultadoDeOrden> => {
      try {
        return { estado: "orden", orden: await client.getRampOrder(id) };
      } catch (e) {
        if (codigoDelKit(e) === "SDK_RAMPS_TX_NOT_FOUND") return { estado: "no-existe" };
        throw e;
      }
    });
  }

  /**
   * Sigue la orden al ritmo que sugiere el servidor (`pollRampOrder`) hasta que se asienta, hasta que `hasta` dice que sí,
   * o hasta que la pantalla la corta (`signal`, al cerrar la ventana). Cada lectura nueva va a `alCambiar`. Solo lee: nunca
   * aprueba nada, aunque la orden espere una aprobación.
   */
  cargaSeguir(id: string, opciones: { signal?: AbortSignal; alCambiar?: (orden: unknown) => void; hasta?: (orden: unknown) => boolean } = {}): Promise<ResultadoDeSeguir> {
    const { signal, alCambiar, hasta } = opciones;
    return this.#enLaCarga(async (client): Promise<ResultadoDeSeguir> => {
      try {
        const orden = await client.pollRampOrder(id, {
          ...(signal ? { signal } : {}),
          onUpdate: (o) => {
            try {
              alCambiar?.(o);
            } catch {
              /* lo que haga la pantalla no corta el seguimiento */
            }
          },
          onError: () => undefined,
          ...(hasta
            ? {
                until: (o: unknown) => {
                  try {
                    return hasta(o);
                  } catch {
                    return false;
                  }
                },
              }
            : {}),
        });
        return { estado: "orden", orden };
      } catch (e) {
        if (signal?.aborted) return { estado: "cortada" };
        if (codigoDelKit(e) === "SDK_RAMPS_TX_NOT_FOUND") return { estado: "no-existe" };
        throw e;
      }
    });
  }

  /**
   * Ya pagué: le pide a Pollar que mire ahora el pago de la orden (`checkRampOrder`), como mucho una vez cada diez segundos
   * por orden. Antes, `pronto`: la pantalla sigue con la orden que ya tiene. La marca de que dijo que pagó la pone la
   * pantalla (`anotarMarca`). Solo pregunta: no paga ni aprueba nada.
   */
  cargaYaPague(id: string): Promise<ResultadoDeYaPague> {
    return this.#enLaCarga(async (client): Promise<ResultadoDeYaPague> => {
      const ahora = Date.now();
      const antes = this.#chequeosDePago.get(id);
      if (antes !== undefined && ahora >= antes && ahora - antes < YA_PAGUE_CADA_MS) return { estado: "pronto" };
      this.#chequeosDePago.set(id, ahora);
      try {
        return { estado: "orden", orden: await client.checkRampOrder(id) };
      } catch (e) {
        if (codigoDelKit(e) === "SDK_RAMPS_TX_NOT_FOUND") return { estado: "no-existe" };
        throw e;
      }
    });
  }

  /**
   * La carga abierta de la persona, si tiene: lo primero que mira la ventana, antes que las rutas, los créditos o el
   * acceso, para que nada la esconda. Lo que no se lee no dice que no hay ninguna. Solo lee.
   */
  cargaAbiertas(): Promise<ResultadoDeAbiertas> {
    return this.#enLaCarga(async (client): Promise<ResultadoDeAbiertas> => {
      const { cargaAbierta } = await import("./rampa-pollar");
      const pagina = await client.listRampOrders({ open: "true" });
      const abierta = cargaAbierta(pagina);
      if (abierta.estado !== "abierta") return abierta;
      const orden = (pagina.orders as unknown[]).find((o) => esObjetoPlano(o) && o.id === abierta.id) ?? null;
      return { estado: "abierta", id: abierta.id, orden };
    });
  }

  /**
   * Sin una carga abierta, la última cerrada que no terminó bien desde `desde` (en milisegundos): fallida o devuelta, para
   * mostrar su final con el número antes de un precio nuevo (`cargaCerradaSinTerminar`). Si la última cerrada terminó
   * bien, o no se lee, ninguna. Solo lee.
   */
  cargaCerradas(desde: number): Promise<ResultadoDeCerradas> {
    return this.#enLaCarga(async (client): Promise<ResultadoDeCerradas> => {
      const { cargaCerradaSinTerminar } = await import("./rampa-pollar");
      const pagina = await client.listRampOrders({ open: "false", since: new Date(desde).toISOString(), limit: CERRADAS_POR_PAGINA });
      const c = cargaCerradaSinTerminar(pagina, desde);
      return c ? { estado: "cerrada", id: c.id, orden: c.orden } : { estado: "ninguna" };
    });
  }

  /**
   * Lo que se aprueba en el paso que espera, para mostrarlo antes del toque: qué es y cuántos dólares mueve, o el motivo por
   * el que la regla no lo reconoce. Solo lee: no pide el pedido de nuevo ni vota.
   */
  cargaRevisarPaso(ordenId: string, pedidoId: string): Promise<ResultadoDeRevisarPaso> {
    return this.#enLaCarga(async (client, cuenta): Promise<ResultadoDeRevisarPaso> => {
      const [{ leerOrden }, { revisarPaso }] = await Promise.all([import("./rampa-pollar"), import("./rampa-regla")]);
      const crudo = await client.getRampOrder(ordenId);
      const accion = leerOrden(crudo)?.accion;
      if (accion?.kind !== "COSIGN_APPROVAL" || accion.cosignRequestId !== pedidoId) return { estado: "cambio", orden: crudo };
      const [pedido, recuperacion] = await Promise.all([client.cosign.get(pedidoId), client.cosign.recovery.status()]);
      const r = revisarPaso(pedido, crudo, cuenta, recuperacion.subOrgId ?? "");
      return r.motivo === null ? { estado: "revisado", que: r.que, dolares: r.dolares } : { estado: "raro", motivo: r.motivo };
    });
  }

  /**
   * Aprobar: vota que sí un paso de la carga que mueve dinero, desde el toque de la persona y solo ese (`pedidoId`, el que
   * la pantalla mostró: un toque viejo nunca aprueba el paso siguiente). Dentro del candado de la carga lee la orden y el
   * pedido, lo pide de nuevo una vez si se puede y desde ahí usa solo esa versión; tiene que pasar la regla
   * (`revisarPaso`), y la propuesta de `verify`, `motivoContraLaPropuesta`; recién ahí `relay`. Un pedido ya votado o
   * resuelto no se vota otra vez, y dos toques votan una vez. Dos aprobaciones falladas en la misma orden y la misma
   * pestaña cortan; un `402` no cuenta. Nada de esto pasa por `atenderFirmas`: un voto de co-firma no es una confirmación.
   */
  cargaAprobar(ordenId: string, pedidoId: string): Promise<ResultadoDeAprobar> {
    if (!cargaPrendida()) return Promise.resolve({ estado: "apagada" });
    const enCurso = this.#aprobando.get(ordenId);
    if (enCurso) return enCurso;
    const corrida: Promise<ResultadoDeAprobar> = this.#enLaCarga((client, cuenta) => conCandado(CANDADO_DE_LA_CARGA, () => this.#aprobar(client, cuenta, ordenId, pedidoId))).finally(() => {
      if (this.#aprobando.get(ordenId) === corrida) this.#aprobando.delete(ordenId);
    });
    this.#aprobando.set(ordenId, corrida);
    return corrida;
  }

  async #aprobar(client: PollarClient, cuenta: string, ordenId: string, pedidoId: string): Promise<ResultadoDeAprobar> {
    if (this.#fallasDe(ordenId) >= TOPE_DE_APROBACIONES_FALLADAS) return { estado: "tope" };
    const [{ leerOrden }, { revisarPaso, motivoContraLaPropuesta }] = await Promise.all([import("./rampa-pollar"), import("./rampa-regla")]);
    // 1. La orden espera la aprobación de este pedido, y no de otro.
    const crudo = await client.getRampOrder(ordenId);
    const accion = leerOrden(crudo)?.accion;
    if (accion?.kind !== "COSIGN_APPROVAL" || accion.cosignRequestId !== pedidoId) return { estado: "cambio", orden: crudo };
    // 2. El pedido y la organización de esta sesión. Ya votado o resuelto (otra pestaña, otro toque): no se vota otra vez.
    const [leido, recuperacion] = await Promise.all([client.cosign.get(pedidoId), client.cosign.recovery.status()]);
    const subOrg = recuperacion.subOrgId ?? "";
    let pedido = leido as unknown as PedidoDeCofirma;
    if (pedido.status !== "PENDING" || pedido.activityId) return { estado: "cambio", orden: crudo };
    // 3. La transacción envejece mientras la persona decide: se pide de nuevo una sola vez y desde ahí se usa esa versión.
    if (pedido.refreshable) pedido = (await client.cosign.refresh(pedidoId)) as unknown as PedidoDeCofirma;
    if (pedido.id !== pedidoId) return pasoRaro("otro pedido");
    if (pedido.status !== "PENDING" || pedido.activityId) return { estado: "cambio", orden: crudo };
    // 4. La regla, sobre esa versión.
    const revisado = revisarPaso(pedido, crudo, cuenta, subOrg);
    if (revisado.motivo !== null) return pasoRaro(revisado.motivo);
    // 5. Lo que se estampa es firmar exactamente esa transacción, con la cuenta de paso del pedido y en esta organización.
    const verificacion = await client.cosign.verify(pedido as unknown as CosignRequest);
    const contraLaPropuesta = motivoContraLaPropuesta(verificacion, pedido, subOrg);
    if (contraLaPropuesta !== null || !verificacion.ok) return pasoRaro(contraLaPropuesta ?? "otra propuesta");
    // 6. La cuenta otra vez, y el voto.
    this.#sigueLaCuenta(client, cuenta);
    let votado: PedidoDeCofirma;
    try {
      votado = await this.#votar(client, pedidoId, verificacion);
    } catch (e) {
      const falla = fallaDeCarga(e);
      // Sin créditos es de Tinkazo y no cuenta. Cualquier otra cosa pudo haber salido: cuenta como fallada.
      if (falla.estado === "sin-creditos") return falla;
      this.#sumarFallaDeAprobar(ordenId);
      return falla.estado === "sin-red" ? falla : { estado: "no-salio" };
    }
    if (votado.status === "APPROVED") return { estado: "aprobado", que: revisado.que, dolares: revisado.dolares };
    if (votado.status === "PENDING") return { estado: "enviado" };
    this.#sumarFallaDeAprobar(ordenId);
    return { estado: "no-salio" };
  }

  #fallasDe(ordenId: string): number {
    return Math.max(this.#fallasDeAprobar.get(ordenId) ?? 0, fallasGuardadas()[ordenId] ?? 0);
  }

  #sumarFallaDeAprobar(ordenId: string): void {
    const n = this.#fallasDe(ordenId) + 1;
    this.#fallasDeAprobar.set(ordenId, n);
    const todas = fallasGuardadas();
    todas[ordenId] = n;
    ponerMarca(MARCA_DE_APROBACIONES, JSON.stringify(todas));
  }

  /**
   * Probar de nuevo una carga frenada que destraba la persona (o que esperaba que protegiera su cuenta): Pollar la corre otra
   * vez desde donde paró (`retryRampOrder`). Lee la orden antes: si ya no está frenada así, no reintenta. Dos toques
   * reintentan una vez. Reintentar no aprueba nada: el paso que siga espera su toque.
   */
  cargaReintentar(ordenId: string): Promise<ResultadoDeReintentar> {
    if (!cargaPrendida()) return Promise.resolve({ estado: "apagada" });
    const enCurso = this.#reintentando.get(ordenId);
    if (enCurso) return enCurso;
    const corrida: Promise<ResultadoDeReintentar> = this.#enLaCarga((client) => conCandado(CANDADO_DE_LA_CARGA, () => this.#reintentar(client, ordenId))).finally(() => {
      if (this.#reintentando.get(ordenId) === corrida) this.#reintentando.delete(ordenId);
    });
    this.#reintentando.set(ordenId, corrida);
    return corrida;
  }

  async #reintentar(client: PollarClient, ordenId: string): Promise<ResultadoDeReintentar> {
    const { pasoDeOrden, SIN_MARCAS } = await import("./rampa-pollar");
    const crudo = await client.getRampOrder(ordenId);
    const pantalla = pasoDeOrden(crudo, SIN_MARCAS, Date.now());
    const laDestrabaLaPersona = (pantalla.pantalla === "frenada" && pantalla.quien === "vos") || pantalla.pantalla === "proteger-cuenta";
    if (!laDestrabaLaPersona) return { estado: "cambio", orden: crudo };
    return { estado: "orden", orden: await client.retryRampOrder(ordenId) };
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

/** Cómo terminó Activar dólares digitales con Google o correo (`activarUsdc`). */
export type ResultadoDeActivarUsdc = "apagada" | "en-curso" | "hecho" | "no-patrocina" | "ahora-no" | "cuenta-creandose" | "proteger" | "no-salio";

/* ------------------------------------------------ lo que devuelve cada método de la carga */

export type ResultadoDeRuta = { estado: "ruta"; ruta: RutaDeBolivia } | { estado: "sin-ruta" } | FallaDeCarga;
export type ResultadoDeCotizar = LecturaDeCotizacion | FallaDeCarga;
export type ResultadoDeAbrirVerificacion = { estado: "abrir"; url: string } | { estado: "lista" } | { estado: "en-revision" } | { estado: "vencida" } | { estado: "desconocido" } | FallaDeCarga;
export type ResultadoDeMirarVerificacion = { estado: "leida"; verificacion: EstadoDeVerificacion } | { estado: "cortada" } | { estado: "desconocido" } | FallaDeCarga;
export type ResultadoDeFormulario = { estado: "formulario"; formulario: RequirementForm } | { estado: "desconocido" } | FallaDeCarga;
export type ResultadoDeGuardarFormulario = { estado: "guardado" } | { estado: "respuestas"; errores: { key: string; code: string }[] } | { estado: "desconocido" } | FallaDeCarga;
export type ResultadoDeSegip =
  | { estado: "datos"; segip: RegistryCheck }
  | { estado: "aprobada" }
  | { estado: "en-revision" }
  | { estado: "rechazada"; campos: string[] }
  | { estado: "no-coincide" }
  | { estado: "falta-identidad" }
  | { estado: "desconocido" }
  | FallaDeCarga;
export type ResultadoDeAlta =
  | { estado: "alta"; alta: ProviderRegistration }
  | { estado: "registrada" }
  | { estado: "pendiente" }
  | { estado: "faltan-datos"; faltan: string[]; invalidos: string[]; formularios: string[] }
  | { estado: "desconocido" }
  | FallaDeCarga;
/** Preparar mi cuenta: listo para cotizar de nuevo, o dónde se paró. */
export type ResultadoDePreparar =
  | { estado: "listo" }
  | { estado: "linea"; resultado: ResultadoDeActivarUsdc }
  | { estado: "cuenta-de-paso-espera" }
  | { estado: "cuenta-de-paso-rara" }
  | { estado: "cuenta-de-paso-no-salio" }
  | FallaDeCarga;
/**
 * Crear la orden: creada (con si nació fallada, antes de que hubiera QR), la que ya estaba abierta, o por qué no. `sin-aviso`:
 * el aviso al servidor no dijo que sí y no se creó nada.
 */
export type ResultadoDeCrearOrden =
  | { estado: "creada"; id: string; orden: unknown; falloAlCrear: boolean }
  | { estado: "ya-hay"; id: string }
  | { estado: "sin-aviso" }
  | { estado: "no-se-sabe" }
  | { estado: "precio-vencido" }
  | { estado: "faltan-datos" }
  | { estado: "cuenta-de-paso" }
  | FallaDeCarga;
/**
 * Lo que la compra con QR le da a `cargaCrearOrdenDeCompra`, los dos obligatorios: el aviso de carga al servidor
 * (`/v1/compra/cargar`: `true` solo con su 200, `"sin-red"` si no hubo respuesta) y la anulación de la compra
 * (`/v1/compra/anular`) después de una falla definitiva.
 */
export interface AvisoDeLaCompra {
  avisar(): Promise<boolean | "sin-red">;
  anular(): Promise<unknown>;
}
export type ResultadoDeOrden = { estado: "orden"; orden: unknown } | { estado: "no-existe" } | FallaDeCarga;
export type ResultadoDeSeguir = ResultadoDeOrden | { estado: "cortada" };
export type ResultadoDeYaPague = ResultadoDeOrden | { estado: "pronto" };
export type ResultadoDeAbiertas = { estado: "abierta"; id: string; orden: unknown } | { estado: "ninguna" } | { estado: "no-se-sabe" } | FallaDeCarga;
export type ResultadoDeCerradas = { estado: "cerrada"; id: string; orden: unknown } | { estado: "ninguna" } | FallaDeCarga;
/** El motivo de `raro` son palabras fijas de la regla: nunca una cuenta de la persona. */
export type ResultadoDeRevisarPaso = { estado: "revisado"; que: QueSeAprueba; dolares: number } | { estado: "raro"; motivo: string } | { estado: "cambio"; orden: unknown } | FallaDeCarga;
/**
 * Aprobar: aprobado; enviado (el voto salió y Pollar todavía no lo cerró); raro (la regla no reconoce el paso y no se votó);
 * cambio (la orden ya no espera ese pedido, o ya está votado: no se votó); no-salio; tope (dos falladas, no se llamó a nada).
 */
export type ResultadoDeAprobar =
  | { estado: "aprobado"; que: QueSeAprueba; dolares: number }
  | { estado: "enviado" }
  | { estado: "raro"; motivo: string }
  | { estado: "cambio"; orden: unknown }
  | { estado: "no-salio" }
  | { estado: "tope" }
  | FallaDeCarga;
export type ResultadoDeReintentar = ResultadoDeOrden | { estado: "cambio"; orden: unknown };

type VotoDeLaCuentaDePaso = "nada" | "aprobada" | "pendiente" | "rara" | "no-salio";

function comoQuedoLaCuentaDePaso(v: Exclude<VotoDeLaCuentaDePaso, "nada">): ResultadoDePreparar {
  if (v === "aprobada") return { estado: "listo" };
  if (v === "pendiente") return { estado: "cuenta-de-paso-espera" };
  return v === "rara" ? { estado: "cuenta-de-paso-rara" } : { estado: "cuenta-de-paso-no-salio" };
}

/** La regla no reconoce el pedido de la cuenta de paso: se anota con palabras fijas y no se vota. */
function cuentaDePasoRara(motivo: string): "rara" {
  console.warn(`[tinkazo] cuenta de paso no aprobada: ${motivo}`);
  return "rara";
}

/** La regla no reconoce el paso: se anota con palabras fijas, no se vota y el dinero queda retenido a salvo. */
function pasoRaro(motivo: string): ResultadoDeAprobar {
  console.warn(`[tinkazo] paso de la carga no aprobado: ${motivo}`);
  return { estado: "raro", motivo };
}

/** Lo que contestó `setTrustline`, en lo que la pantalla necesita. El detalle del error no se muestra nunca. */
export function resultadoDeLaLinea(r: { status?: string; code?: string; details?: string }): ResultadoDeActivarUsdc {
  if (r.status === "success" || r.status === "pending") return "hecho";
  if (r.status === "cosign_pending") return "en-curso";
  const codigo = `${r.code ?? ""} ${r.details ?? ""}`;
  if (codigo.includes("TX_LOW_RESERVE")) {
    console.warn("[tinkazo] la línea del USDC no la paga la app (TX_LOW_RESERVE)");
    return "no-patrocina";
  }
  if (codigo.includes("SDK_CREDITS_INSUFFICIENT")) return "ahora-no";
  if (codigo.includes("SDK_WALLET_NOT_READY")) return "cuenta-creandose";
  if (codigo.includes("SDK_WALLET_RECOVERY_REQUIRED")) return "proteger";
  if (codigo.includes("SDK_CONFIRMATION_DECLINED") || codigo.includes("SDK_CONFIRMATION_UNAVAILABLE")) {
    console.warn("[tinkazo] la puerta no reconoció la línea del USDC pedida");
  }
  return "no-salio";
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
