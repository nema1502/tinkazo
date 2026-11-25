import type { AuthOpenContext, CosignRequest, CosignVerification, PollarClient, ProviderRegistration, RegistryCheck, RequirementForm, RequirementFormAnswers, WalletInfo } from "@pollar/core";
import { network } from "./config";
import { compraQrActiva } from "./alta-config";
import type { DepsDelDesenlace, Desenlace, EnvioDelKit, EstadoDelEnvio, IntencionDeFirma } from "./cofirma-regla";
import { PUERTA_DEL_PREMIO_EN, modoDeRampa, pagarConGoogle, votoPorContenido } from "./cuenta-config";
import type { DesenlaceDelPago, FormaDelPago } from "./pago-portero";
import type { NotaDelPago, PagoArmado } from "./pagos-regla";
import { configDelPortero } from "./patrocinio-config";
import { STROOPS_POR_DOLAR, costoDelRetiro, cuentaDelRetiro } from "./retiro-config";
import { entornoDelBuild } from "./venta-piloto";
import { errorKey, esDeRed } from "./errores";
import type { LecturaDeCotizacion, LoQueFalta, PasoDeVerificacion, PrecioDeCarga, QueSeAprueba, RutaDeBolivia } from "./rampa-pollar";
import { ingresoPlanB } from "./ingreso-bandera";
import { LEGACY_POLLAR_INTENT_KEY, TOPE_TOKEN_MS, VENTANA_RETOMA_MS, VENTANA_TOKEN_MS, leerMarcaPollar, pollarIntentKey, pollarKeyFor } from "./pollar-config";
import type { SignedTx, WalletAdapter } from "./wallet";
import { contarVentanaDeGoogle, marcarEntrada, tomarEntrada } from "../contar";
import { contarEntradaConRed, contarPasoOficial } from "../ui/contadores";
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
import { PremioGuardado, type PuertaDelPremio, mirarAntesDeActivar, mirarPuertaDelPremio, usdcDeLaRed } from "./usdc-cuenta";

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
 * La puerta del premio (`#firmando`): en los modos de `PUERTA_DEL_PREMIO_EN` (premios, recibir y apagada), en la red
 * principal y con la cuenta de Google o de correo, antes de cada firma del sello o del sorteo se mira en la red si la
 * cuenta puede guardar dinero (`puertaDelPremio` en `usdc-cuenta.ts`). Si puede, o si la red no deja saberlo, no se firma
 * nada: sale `PremioGuardado`. El voto del kit firma el hash de cualquier transacción de la cuenta, y eso solo se acepta
 * mientras la cuenta no pueda guardar dinero (docs/architecture.md). Con el voto por contenido (issue 180, la variable
 * del build y el kit que de verdad vota a mano, `#aMano`) la puerta no corre: el navegador vota solo lo que armó la
 * página (`#votarLoArmado`). La puerta no tiene salida por parámetro, y `#pagar` se niega en premios: el pago con el saldo
 * firma por la misma vía y no se prende junto con `premios` (el build no lo deja, `premios-build.ts`), así que la negativa
 * está también en la función y no solo en quien la llama. Ante una duda de la lectura (un corte, un 5xx, un 404) la puerta
 * vuelve a leer unas veces antes de cerrar: todavía no se firmó nada. Pedir la línea del dólar digital (`activarUsdc`) es
 * otro voto por hash y mira lo mismo antes: con la línea ya puesta no pide otra, y con otra línea con saldo sin la de
 * Circle, o sin saber, no pide nada. El XLM no cuenta en ninguna de las dos miradas: cualquiera puede mandarlo. Con el
 * voto a mano la línea se vota con su regla por forma (`#votarLaLinea`), y el pedido de la línea que abre solo el
 * proveedor se vota igual, con esa regla y el toque de la persona, con el voto a mano o sin él (`#antesDeLaLinea`).
 *
 * Los pagos de la cuenta (el premio de un sorteo, `pagarPremio`, y el retiro con su costo, `retirar`) existen solo con el
 * voto a mano: cada uno pasa su regla de contenido, entra en la lista de lo permitido solo para su firma, se firma sin el
 * patrocinio del proveedor y lo firmado va al servicio de comisiones de Tinkazo (`pago-portero.ts`), nunca al envío del
 * proveedor. Una marca por pago en `localStorage` y un candado entre pestañas hacen que un mismo pago salga una sola vez.
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

/**
 * Cuánto se espera a la primera mirada de que la sesión de Pollar quedó leída, que no necesita la red salvo para renovar
 * una vencida. Si el proveedor todavía no contestó, el retomo sigue esperando (`VENTANA_RETOMA_MS`): no entrega
 * "no hay cuenta" a la primera.
 */
export const LISTO_MS = 8_000;

/** Cuánto sigue mirando al proveedor la retoma de la cuenta después de la primera mirada: `pollar-config.ts`. */
export { VENTANA_RETOMA_MS };

/** Lo que quedó de una entrada que no se completó, para que la pantalla diga qué pasó y se pueda reintentar. */
export const ENTRADA_BLOQUEADA = "popup-blocked";
export const ENTRADA_CERRADA = "popup-closed";
/** Pollar no pudo abrir la entrada (sin red, o la llave no vale en este sitio): no hay a dónde mandar la ventana. */
export const ENTRADA_SIN_SESION = "popup-nosession";

/**
 * Cuánto se espera, con la ventana de Google cerrada y sin que haya salido el pedido de ingreso, a que la persona haya
 * terminado: el SDK tarda un instante en enterarse de que el servidor tiene la sesión lista. Si no sale en este rato, la
 * persona cerró la ventana sin entrar.
 */
export const GRACIA_CIERRE_MS = 6_000;

/**
 * Cuánto se espera, con la ventana cerrada y el pedido de ingreso ya en camino (`POST /auth/login`): el SDK le da 45
 * segundos (`loginTimeoutMs`) y con una cuenta nueva ese pedido además la crea. Cinco más de margen. Antes se cortaba a
 * los 6 segundos y una cuenta nueva tenía que entrar dos veces (15 de noviembre de 2026).
 */
export const ESPERA_INGRESO_MS = 50_000;

/**
 * Cuánto después del cierre de la ventana se avisa que se está terminando de entrar (`AvisosDeEntrada`). Quien ya tiene
 * cuenta entra en uno o dos segundos y no ve ningún cambio. Con el aviso al instante, todos veían un momento Terminando
 * de entrar con Cancelar, y un toque en ese momento cortaba un ingreso que estaba por llegar (16 de noviembre de 2026).
 */
export const AVISO_TERMINANDO_MS = 2_500;

/** El plazo largo se cumplió sin cuenta: el mismo nombre del plazo vencido de `waitForWallet`, que la pantalla ya sabe decir. */
export const ENTRADA_DEMORADA = "pollar-timeout";

/**
 * La persona tocó Cancelar mientras se terminaba de entrar: no es un error, la puerta vuelve a como estaba, y queda
 * afuera aunque la cuenta llegue justo en ese momento (`connect`).
 */
export const ENTRADA_CANCELADA = "login-cancelled";

/** Los cortes de la entrada con Google que dejan al SDK esperando algo que ya no va a llegar: se le dice que pare. */
const CORTES: readonly string[] = [ENTRADA_BLOQUEADA, ENTRADA_CERRADA, ENTRADA_SIN_SESION, ENTRADA_DEMORADA, ENTRADA_CANCELADA];
/** Los cortes con la entrada en curso, en los que la cuenta pudo llegar justo al cortar y se toma. Cancelar no: es quedar afuera. */
const TARDIAS: readonly string[] = [ENTRADA_CERRADA, ENTRADA_DEMORADA];

/** Lo que la entrada con Google le cuenta a la pantalla mientras pasa. */
export interface AvisosDeEntrada {
  /**
   * La ventana de Google se cerró y el ingreso ya está en camino: puede tardar (una cuenta nueva se crea en ese
   * momento). La pantalla dice que se está terminando de entrar y ofrece `cancelar`, que corta la entrada con
   * `ENTRADA_CANCELADA`. Se llama una vez por entrada, y solo si la espera pasa de `AVISO_TERMINANDO_MS` desde el cierre.
   */
  terminando?: (cancelar: () => void) => void;
  /**
   * Qué hacer apenas la ventana de Google queda abierta: la página de una campaña suelta su marca, que la ventana ya
   * se llevó su copia. Se llama una vez por entrada, adentro de `connect`.
   */
  alAbrirLaVentana?: () => void;
}

/** Lo que el SDK le pasa a quien mira sus pedidos (el cliente de su API, `openapi-fetch`). */
interface PedidoMirado {
  request?: { method?: string };
  schemaPath?: string;
}
interface Mirador {
  onRequest(p: PedidoMirado): undefined;
  /** Solo si quien mira también quiere saber de los rechazos por límite. */
  onResponse?(p: RespuestaMirada): undefined;
}

/**
 * Avisa cuando el SDK manda el pedido de ingreso (`POST /auth/login`). Es la única señal de que la persona terminó en
 * Google: el paso del SDK (`getAuthState().step`) es `authenticating` desde que la ventana va a Google hasta que llega la
 * cuenta, con la persona todavía eligiendo su cuenta o ya con el ingreso en camino, y el SDK no mira la ventana. El
 * pedido sale recién cuando el servidor dice que la sesión está lista (`authenticate` en `@pollar/core`).
 *
 * Mira sin tocar: no cambia el pedido ni lo frena, y si algo falla al mirar, la entrada sigue igual. Si el SDK no deja
 * mirar (otra versión, sin `_api.use`), devuelve `null` y la entrada queda con la regla de siempre: 6 segundos. Con `alLimite`,
 * el mismo mirador avisa también de cada rechazo por límite (un 429) que vea mientras se entra.
 */
export function mirarPedidoDeIngreso(client: unknown, aviso: () => void, alLimite?: (segundos: number | null) => void): (() => void) | null {
  const api = (client as { _api?: { use?: (m: Mirador) => unknown; eject?: (m: Mirador) => unknown } } | null)?._api;
  if (!api || typeof api.use !== "function" || typeof api.eject !== "function") return null;
  const mirador: Mirador = {
    onRequest({ request, schemaPath }) {
      try {
        if (schemaPath === "/auth/login" && String(request?.method ?? "").toUpperCase() === "POST") aviso();
      } catch {
        /* mirar nunca corta la entrada */
      }
      return undefined;
    },
    // Con el mismo mirador, y sin sumar otro: un rechazo por límite durante la entrada queda anotado.
    ...(alLimite ? { onResponse: alRechazoPorLimite(alLimite) } : {}),
  };
  try {
    api.use(mirador);
  } catch {
    return null;
  }
  return () => {
    try {
      api.eject?.(mirador);
    } catch {
      /* ya no estaba */
    }
  };
}

/** Lo que el SDK le pasa a quien mira sus respuestas: la respuesta cruda, con su estado y sus encabezados. */
interface RespuestaMirada {
  response?: { status?: number; headers?: { get?: (nombre: string) => string | null } };
}
interface MiradorDeRespuestas {
  /** Sin nada que hacer con los pedidos: el cliente de la API los recorre a todos con este método. */
  onRequest(): undefined;
  onResponse(p: RespuestaMirada): undefined;
}

/** Cuánto se espera, sin encabezado que lo diga, a que el servicio de cuentas vuelva a aceptar pedidos de ingreso. */
export const ESPERA_POR_LIMITE_MS = 30_000;
/** Lo más que se espera por un límite: un encabezado raro no deja a nadie afuera más que esto. */
export const TOPE_DE_ESPERA_POR_LIMITE_S = 120;

/**
 * Cuántos segundos faltan para que el servicio de cuentas acepte de nuevo, según los encabezados de un rechazo por límite
 * (`Retry-After`, `RateLimit-Reset`, `X-RateLimit-Reset` y `RateLimit`), o null si no dicen nada que sirva. Un número grande
 * se toma como una hora de reloj (segundos desde 1970) y se resta de ahora. Acotado entre 1 y 120 segundos.
 */
export function esperaDelLimite(leer: (nombre: string) => string | null, ahoraMs: number): number | null {
  const comoSegundos = (crudo: string | null): number | null => {
    if (crudo === null) return null;
    const limpio = crudo.trim();
    if (/^\d+(\.\d+)?$/.test(limpio)) {
      const n = Number(limpio);
      return n > 1e9 ? n - ahoraMs / 1000 : n;
    }
    const fecha = Date.parse(limpio);
    return Number.isNaN(fecha) ? null : (fecha - ahoraMs) / 1000;
  };
  const candidatos: Array<number | null> = [
    comoSegundos(leer("retry-after")),
    comoSegundos(leer("ratelimit-reset")),
    comoSegundos(leer("x-ratelimit-reset")),
  ];
  // `RateLimit: limit=20, remaining=0, reset=30`, o la forma con parámetros (`"default";r=0;t=30`).
  const junto = leer("ratelimit");
  const dentro = junto === null ? null : /(?:\breset=|;\s*t=)(\d+)/i.exec(junto)?.[1] ?? null;
  candidatos.push(comoSegundos(dentro));
  const primero = candidatos.find((s): s is number => s !== null && Number.isFinite(s));
  if (primero === undefined) return null;
  return Math.min(TOPE_DE_ESPERA_POR_LIMITE_S, Math.max(1, Math.ceil(primero)));
}

/** Lo que hace quien mira respuestas con un 429: avisa con los segundos que dicen sus encabezados, o null si no los deja leer. */
function alRechazoPorLimite(aviso: (segundos: number | null) => void, ahora: () => number = () => Date.now()): (p: RespuestaMirada) => undefined {
  return ({ response }) => {
    try {
      if (response?.status !== 429) return undefined;
      const get = response.headers?.get;
      aviso(typeof get === "function" ? esperaDelLimite((nombre) => get.call(response.headers, nombre), ahora()) : null);
    } catch {
      /* mirar nunca corta nada */
    }
    return undefined;
  };
}

/**
 * Avisa cada vez que el servicio de cuentas rechaza un pedido por límite (un 429), con los segundos que dicen sus
 * encabezados, o null si no los dejan leer (desde otro origen solo se leen los que el servicio expone). Mira sin tocar: no
 * cambia la respuesta ni la frena. Si el SDK no deja mirar, devuelve `null`.
 */
export function mirarLimites(client: unknown, aviso: (segundos: number | null) => void, ahora: () => number = () => Date.now()): (() => void) | null {
  const api = (client as { _api?: { use?: (m: MiradorDeRespuestas) => unknown; eject?: (m: MiradorDeRespuestas) => unknown } } | null)?._api;
  if (!api || typeof api.use !== "function" || typeof api.eject !== "function") return null;
  const mirador: MiradorDeRespuestas = { onRequest: () => undefined, onResponse: alRechazoPorLimite(aviso, ahora) };
  try {
    api.use(mirador);
  } catch {
    return null;
  }
  return () => {
    try {
      api.eject?.(mirador);
    } catch {
      /* ya no estaba */
    }
  };
}

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
  /**
   * Firma y envía en un solo paso. Devuelve el hash de la transacción. `antesDeFirmar` corre justo antes de firmar, ya
   * pasada la puerta del premio (que puede demorar): si lanza, no se firma.
   */
  signAndSubmit(xdr: string, antesDeFirmar?: () => void): Promise<string>;
  /**
   * Solo firma, sin pedirle a Pollar que patrocine la comisión: la paga la cuenta de la
   * persona y la transacción la manda quien la pidió. Devuelve el XDR firmado.
   */
  signUnsponsored?(xdr: string): Promise<string>;
  /** Paga la orden de un paquete con el saldo de la cuenta (`pagarOrden` de `PollarWallet`). Nunca lanza. */
  pagarOrden?(p: Omit<PagoPedido, "cuenta">): Promise<ResultadoDelPagoConSaldo>;
  /** Si el navegador vota a mano lo que armó la página (`votaPorContenido` de `PollarWallet`, issue 180). */
  votaPorContenido?(): boolean;
  /** Retira dólares digitales con su costo, por el servicio de comisiones (`retirar` de `PollarWallet`). Nunca lanza. */
  retirar?(xdr: string, pedido: PedidoDeRetiro): Promise<ResultadoDelRetiro>;
  /** Paga el premio de un sorteo, por el servicio de comisiones (`pagarPremio` de `PollarWallet`). Nunca lanza. */
  pagarPremio?(xdr: string, pedido: PedidoDelPremioConLaCuenta): Promise<ResultadoDelPagoConLaCuenta>;
}

/**
 * El retiro que pide la ventana de Mandar: a quién, cuánto sale de la cuenta (en stroops) y la nota que pegó la persona.
 * El costo no viene acá: lo pone la billetera con lo que dice la configuración del build, nunca con lo que diga la pantalla.
 */
export interface PedidoDeRetiro {
  destino: string;
  sale: bigint;
  nota: NotaDelPago;
}

/**
 * El pago de un premio que se pide: la cuenta que paga, el destino releído de la lista sellada, el monto con siete
 * decimales y la nota del premio. Tiene la misma forma que `PedidoDeLaCuenta` de `ui/pagar-premio.ts`.
 */
export interface PedidoDelPremioConLaCuenta {
  cuenta: string;
  destino: string;
  monto: string;
  nota: string;
}

/**
 * Cómo terminó un pago de la cuenta de Google. `salio`: entró, con su hash. `incierto`: no se sabe todavía, y hasta saberlo
 * no se arma otro. `no-salio`: no se pagó nada, con el motivo: la regla del pago no lo dejó (`regla`), lo que había que
 * aprobar no era lo armado (`no-coincide`), la persona lo cortó (`cancelado`), ahora no se puede (`ahora-no`) o no se pudo
 * preguntar antes de firmar (`red`). Tiene la misma forma que `ResultadoDelPremio` de `ui/pagar-premio.ts`.
 */
export type ResultadoDelPagoConLaCuenta =
  | { estado: "salio"; hash: string }
  | { estado: "incierto" }
  | { estado: "no-salio"; motivo: "regla" | "no-coincide" | "cancelado" | "ahora-no" | "red" };

/** Lo mismo para un retiro, que además dice cuándo la pestaña llegó al tope de negativas (`no-coincide-tope`). */
export type ResultadoDelRetiro = ResultadoDelPagoConLaCuenta | { estado: "no-salio"; motivo: "no-coincide-tope" };

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
  /** Lo que firmó la llave de la cuenta, cuando el pedido ya se aprobó: lo leen el testigo y el voto por contenido. */
  signedXdr?: string | undefined;
  /** Por qué se cerró sin aprobarse, cuando Pollar lo dice. */
  failureReason?: string | undefined;
  submit?: { status?: string | undefined; hash?: string | undefined; resultCode?: string | undefined; message?: string | undefined } | undefined;
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
 * pestaña (un número), que este navegador se sumó a la cuenta en esta pestaña, que se mandó un código, y las negativas
 * de esta pestaña de la regla del voto por contenido (un número, `distintas`) y de la regla de la línea del dólar digital
 * (otro número, `distintasLinea`). Se borran al cerrar sesión.
 */
export const MARCAS_DE_LA_CUENTA = {
  votos: "tinkazo.cl.votos",
  inscrito: "tinkazo.cl.inscrito",
  codigo: "tinkazo.cl.codigo",
  distintas: "tinkazo.cl.distintas",
  distintasLinea: "tinkazo.cl.distintas-linea",
} as const;

/** El canal con que una pestaña avisa a las otras que la cuenta cambió. El mensaje es `{ tipo: "cambio" }`, sin la dirección. */
export const CANAL_DE_LA_CUENTA = "tinkazo-cuenta-oficial";

/**
 * De dónde viene un aviso de que la cuenta pudo cambiar (`alCambiarLaCuenta`): del canal entre pestañas (otra pestaña hizo
 * algo), del kit (cambió el estado de la billetera o de la co-firma) o de la vista (volvió la pestaña o volvió la conexión,
 * que casi nunca cambian nada de la cuenta). Quien lee puede espaciar las lecturas por la vista, sin perder lo de las otras.
 */
export type OrigenDelAviso = "canal" | "kit" | "vista";

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
/** Las negativas de una regla que guarda esta pestaña, bajo su marca. Lo que no se lee no cuenta. */
const negativasGuardadas = (clave: string): number => {
  const n = Number(leerMarca(clave));
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
};

/** De qué regla es una negativa: la de lo que armó la página (el sello y el sorteo) o la de la línea del dólar digital. */
type DeLaNegativa = "armada" | "linea";
const MARCA_DE_LA_NEGATIVA: Record<DeLaNegativa, string> = { armada: MARCAS_DE_LA_CUENTA.distintas, linea: MARCAS_DE_LA_CUENTA.distintasLinea };

/** Un pedido de la línea del dólar digital que todavía espera, tal como llega de la lista del kit. */
const esLineaPendiente = (p: unknown): p is PedidoDeCofirma =>
  esObjetoPlano(p) && typeof p.id === "string" && p.status === "PENDING" && p.operation === "change_trust";

/**
 * Lo que trae el servidor nunca se lee como la negativa de la regla, que le dice a la persona que no se hizo nada: esa
 * sale solo de la regla, antes del voto. Un código del servidor con esas palabras queda como una falla del servicio.
 */
function sinLaNegativa<R extends { status?: unknown; code?: unknown }>(r: R): R {
  const pareceLaNegativa = r.status === "error" && typeof r.code === "string" && r.code.includes("tinkazo-cofirma-distinta");
  return pareceLaNegativa ? { ...r, code: "SDK_COSIGN_UPSTREAM_ERROR" } : r;
}
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

/** El detalle de un error del kit, si trae uno en texto: va junto al código, como lo devuelve el kit. */
const detalleDelKit = (e: unknown): { details?: string } => {
  const d = (e as { details?: unknown } | null)?.details;
  return typeof d === "string" && d !== "" ? { details: d } : {};
};

/**
 * Un pedido al servidor que se cortó, y no una respuesta suya: lo que el kit cuenta como reintentable
 * (`isRetryableTransportError`: su error de red, un `AbortError` o un `TypeError`) o, si no es del kit, un error de red.
 * Una respuesta del kit (`PollarApiError`) nunca es un corte, aunque su texto lo parezca.
 */
function esCorteDelVoto(e: unknown): boolean {
  const nombre = (e as { name?: unknown } | null)?.name;
  if (nombre === "PollarApiError") return false;
  return nombre === "PollarNetworkError" || nombre === "AbortError" || e instanceof TypeError || esDeRed(e);
}

/**
 * Lo que devuelve el voto por contenido, con la forma de lo que devuelve el kit: firmada (para el portero), mandada (con el
 * hash de la armada), un error con sus códigos, o pendiente, que quiere decir que no se sabe cómo terminó.
 */
type SalidaDelVoto =
  | { status: "signed"; signedXdr: string }
  | { status: "success"; hash: string }
  | { status: "error"; code?: string; details?: string; resultCode?: string; message?: string; hash?: string }
  | { status: "cosign_pending"; request?: PedidoDeCofirma };

/**
 * Cómo quedó el voto de `#estampar`: votado (con el pedido como quedó), una negativa de antes del `relay` (con o sin
 * rechazo del pedido), cerrado sin firmar nada (con el código del kit) o incierto.
 */
type Estampado =
  | { que: "votado"; pedido: PedidoDeCofirma }
  | { que: "negativa"; motivo: string; rechazar: boolean }
  | { que: "no-salio"; code: string; details?: string }
  | { que: "incierto"; motivo: string };

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

/**
 * Las marcas de los pagos con la cuenta que quizás salieron: el premio por su nota y el retiro, uno por navegador. Guardan
 * hasta cuándo puede entrar el pago, con la vida más larga que acepta la regla, más el margen (segundos Unix) en
 * `localStorage`, para que otra pestaña o una recarga
 * no arme otro mientras tanto. No guardan la cuenta, el monto ni la transacción. Sin almacenamiento, vale lo que vive la
 * pestaña (`#pagandoConLaCuenta` y `#pagosEnDuda`).
 */
export const MARCA_DEL_PREMIO = "tinkazo.pago-premio.";
export const MARCA_DEL_RETIRO = "tinkazo.pago-retiro";

/** Hasta cuándo vale la marca de un pago con la cuenta (segundos Unix), o `null` si no hay. */
export function leerMarcaDeLaCuenta(clave: string): number | null {
  try {
    const n = Number(localStorage.getItem(clave));
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}
function ponerMarcaDeLaCuenta(clave: string, hasta: number): void {
  try {
    localStorage.setItem(clave, String(Math.floor(hasta)));
  } catch {
    /* sin almacenamiento, la marca vive lo que vive la pestaña */
  }
}
function borrarMarcaDeLaCuenta(clave: string): void {
  try {
    localStorage.removeItem(clave);
  } catch {
    /* ya no está */
  }
}

/** La nota de un premio en su forma única: con ella se arma la marca del premio. */
const NOTA_DE_UN_PREMIO = /^tk:premio:[1-9]\d{0,19}:(?:0|[1-9]\d{0,8})$/;

/** Lo que dice cada código del kit sobre un pago de la cuenta que no se llegó a firmar: palabras fijas, código exacto. */
const NO_HAY_CREDITOS: readonly string[] = ["SDK_CREDITS_INSUFFICIENT", "SDK_BILLING_OVERDUE"];
const LO_CORTO_LA_PERSONA: readonly string[] = ["SDK_CONFIRMATION_DECLINED", "SDK_COSIGN_REJECTED", "SDK_COSIGN_TURNKEY_REJECTED"];

/**
 * Un pago de la cuenta que no llegó al voto (ningún `relay` en la llamada): nada se firmó, así que un no es verdad. La
 * negativa de la regla se reconoce solo por su código exacto. Sin red es `red`, y lo demás, `ahora-no`.
 */
function noSeFirmo(codigo: string | undefined, deRed: boolean, regla: { COFIRMA_DISTINTA: string; COFIRMA_TOPE: string }): ResultadoDelRetiro {
  if (codigo === regla.COFIRMA_TOPE) return { estado: "no-salio", motivo: "no-coincide-tope" };
  if (codigo === regla.COFIRMA_DISTINTA) return { estado: "no-salio", motivo: "no-coincide" };
  if (codigo !== undefined && NO_HAY_CREDITOS.includes(codigo)) return { estado: "no-salio", motivo: "ahora-no" };
  if (codigo !== undefined && LO_CORTO_LA_PERSONA.includes(codigo)) return { estado: "no-salio", motivo: "cancelado" };
  return { estado: "no-salio", motivo: deRed ? "red" : "ahora-no" };
}

/**
 * Un error del kit después del voto (hubo un `relay` en la llamada). Solo es un no lo que el servidor cerró sin firmar, con
 * su código exacto: sin créditos, o el pedido rechazado. Todo lo demás es incierto, también un código con las palabras de
 * la negativa de la regla: después del voto nunca se dice que no se hizo nada sin saberlo.
 */
function trasElVoto(codigo: string | undefined): ResultadoDelRetiro {
  if (codigo === "SDK_CREDITS_INSUFFICIENT") return { estado: "no-salio", motivo: "ahora-no" };
  if (codigo === "SDK_COSIGN_REJECTED" || codigo === "SDK_COSIGN_TURNKEY_REJECTED") return { estado: "no-salio", motivo: "cancelado" };
  return { estado: "incierto" };
}

/**
 * Cómo se le dice a la pantalla lo que contestó el servicio de comisiones. Un rechazo de la forma del pago es de la regla,
 * uno de red antes de mandar nada es de red, y los demás (apagado, sin fondo, los topes, un sorteo ajeno) son ahora no.
 */
function motivoDelPortero(motivo: string): "regla" | "red" | "ahora-no" {
  if (motivo === "no-permitida") return "regla";
  return motivo === "red" ? "red" : "ahora-no";
}

/**
 * Cuánto se sigue en la red, dentro de la misma llamada, un pago que el servicio de comisiones ya tomó: lo normal es que
 * aparezca en unos segundos. Pasado esto queda incierto, con la marca viva hasta que el pago ya no pueda entrar, y un
 * toque más vuelve a mirar en la red por el mismo hash sin mandar nada.
 */
export const SEGUIR_EL_PAGO_MS = 45_000;

/** Un pago con la cuenta, con lo armado y lo pedido según su forma. */
type PagoConLaCuenta =
  | { forma: "premio"; xdr: string; pedido: PedidoDelPremioConLaCuenta }
  | { forma: "retiro"; xdr: string; pedido: PedidoDeRetiro };

/** Ahora no se puede pagar desde la cuenta: no se firmó nada. El motivo va a la consola, con palabras fijas. */
function ahoraNo(motivo: string): ResultadoDelRetiro {
  console.warn(`[tinkazo] pago con la cuenta: ahora no (${motivo})`);
  return { estado: "no-salio", motivo: "ahora-no" };
}

/** Lo armado no pasó la regla del pago: no se pidió nada. El motivo va a la consola, con palabras fijas. */
function porLaRegla(motivo: string): ResultadoDelRetiro {
  console.warn(`[tinkazo] pago con la cuenta no aprobado: ${motivo}`);
  return { estado: "no-salio", motivo: "regla" };
}

/** No se sabe cómo quedó: puede haber salido, y hasta saberlo no se arma otro. El motivo va a la consola. */
function incierto(motivo: string): ResultadoDelRetiro {
  console.warn(`[tinkazo] pago con la cuenta en duda: ${motivo}`);
  return { estado: "incierto" };
}

/** El resultado de un premio no distingue el tope de negativas: es la misma negativa de la regla. */
function sinElTope(r: ResultadoDelRetiro): ResultadoDelPagoConLaCuenta {
  if (r.estado !== "no-salio") return r;
  return r.motivo === "no-coincide-tope" ? { estado: "no-salio", motivo: "no-coincide" } : { estado: "no-salio", motivo: r.motivo };
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

/* ------------------------------------------------ la cuenta, vista desde el celular de quien participa */

/**
 * Cómo está la cuenta para la página del celular de un sorteo. `lista`: no hay nada que hacer. `falta`: este navegador es de
 * la cuenta y el correo no está confirmado. `otro-con-correo` y `otro-con-desbloqueo`: este navegador todavía no es de la
 * cuenta, pero hay con qué entrar. `sin-forma`: la cuenta se usó en otro navegador y desde acá no hay cómo. `naciendo`: la
 * billetera recién se está creando. `no-se-sabe`: no hubo respuesta, sesión o llave.
 */
export type CuentaDelCelular = "lista" | "falta" | "otro-con-correo" | "otro-con-desbloqueo" | "sin-forma" | "naciendo" | "no-se-sabe";

export interface LecturaDelCelular {
  estado: CuentaDelCelular;
  /** La cuenta ya tiene alguna protección (`configured`). Solo elige textos. */
  protegida: boolean;
  /** El correo está confirmado y es el mismo de la sesión, sin distinguir mayúsculas. */
  correoDeLaSesionConfirmado: boolean;
  /** Se puede mandar el código: hay billetera, configuración del servicio de cuentas y correo en el perfil. */
  puedeMandar: boolean;
  /** El correo de la sesión, ya tapado para mostrar. Nunca entero. */
  correoTapado: string | null;
  /** El servicio de cuentas frenó el pedido por demasiados: quien lee espera más antes de probar otra vez. */
  limite: boolean;
}

/** Lo que `recovery.status()` del kit le deja saber a esta lectura. Todo opcional: se lee con cuidado. */
export interface RecuperacionLeida {
  required?: boolean;
  configured?: boolean;
  subOrgId?: string | null;
  endUserId?: string | null;
  authProxyConfigId?: string | null;
  email?: { address?: string | null; verified?: boolean } | null;
  passkeys?: unknown[] | null;
  devices?: Array<{ publicKey?: string | null }> | null;
}

const SIN_DATOS_DEL_CELULAR: LecturaDelCelular = { estado: "no-se-sabe", protegida: false, correoDeLaSesionConfirmado: false, puedeMandar: false, correoTapado: null, limite: false };

/** `lucia@example.com` pasa a `l•••@example.com`. Lo que no es un correo da vacío. */
function taparCorreoDelCelular(correo: string): string {
  const c = correo.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c)) return "";
  const arroba = c.indexOf("@");
  return `${[...c.slice(0, arroba)][0] ?? ""}•••${c.slice(arroba)}`;
}

/**
 * Clasifica lo que el kit dice de la cuenta, con la llave de este navegador, cómo va su billetera y el correo de la sesión.
 * Pura: no lee nada ni guarda nada. Las dos reglas que no se rompen: `sin-forma` solo con aparatos en la lista (una cuenta
 * recién creada todavía no muestra el suyo y eso es `naciendo`), y `required` falso no es `lista` mientras la billetera se
 * está creando: con esta custodia quiere decir que todavía no hay billetera.
 */
export function clasificarParaElCelular(
  s: RecuperacionLeida | null | undefined,
  llave: string | null | undefined,
  provisioning: string | null | undefined,
  mailDeSesion: string | null | undefined,
): LecturaDelCelular {
  if (!s) return { ...SIN_DATOS_DEL_CELULAR };
  const mail = (mailDeSesion ?? "").trim();
  const direccion = (s.email?.address ?? "").trim();
  const correoConfirmado = s.email?.verified === true && direccion !== "";
  const base = {
    protegida: s.configured === true,
    correoDeLaSesionConfirmado: correoConfirmado && mail !== "" && direccion.toLowerCase() === mail.toLowerCase(),
    puedeMandar: s.required === true && !!s.subOrgId && !!s.endUserId && !!s.authProxyConfigId && mail !== "",
    correoTapado: taparCorreoDelCelular(mail) || null,
    limite: false,
  };
  const con = (estado: CuentaDelCelular): LecturaDelCelular => ({ estado, ...base });
  if (s.required !== true) {
    if (provisioning === "READY") return con("lista");
    return con(provisioning === "FAILED" ? "no-se-sabe" : "naciendo");
  }
  const devices = Array.isArray(s.devices) ? s.devices : [];
  if (!s.subOrgId || devices.length === 0) return con("naciendo");
  if (!llave) return con("no-se-sabe");
  if (devices.some((d) => mismaLlave(d.publicKey, llave))) return con(correoConfirmado ? "lista" : "falta");
  if (correoConfirmado) return con("otro-con-correo");
  const conDesbloqueo = s.configured === true && Array.isArray(s.passkeys) && s.passkeys.length > 0;
  return con(conDesbloqueo ? "otro-con-desbloqueo" : "sin-forma");
}

/** Si el servicio de cuentas frenó el pedido por límite: el kit pasa el código y el cuerpo del error, no los encabezados. */
export function esLimiteDelServicio(error: unknown): boolean {
  const e = error as { code?: unknown; status?: unknown; message?: unknown; body?: { code?: unknown; status?: unknown; message?: unknown; turnkeyStatus?: unknown } } | null;
  const campos = [e?.code, e?.message, e?.body?.code, e?.body?.message];
  if (campos.some((c) => typeof c === "string" && /RATE_LIMITED|too many requests/i.test(c))) return true;
  return [e?.status, e?.body?.status, e?.body?.turnkeyStatus].some((n) => n === 429);
}

/** Cuánto espera la lectura del celular a la sesión y, después, a la respuesta del servicio de cuentas. */
export const TOPE_LECTURA_CELULAR_MS = 8_000;

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
/** Cuánto se espera a que la sesión de Pollar quede verificada para entregar su token (`tokenDeSesion`), y hasta cuándo en total: `pollar-config.ts`. */
export { TOPE_TOKEN_MS, VENTANA_TOKEN_MS };

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
 * Mientras dura una firma, escucha si el kit quedó esperando una co-firma. Lo que devuelve se llama al terminar la firma:
 * suelta la escucha y entrega el pedido ya resuelto, solo si es el que esta firma esperó (`null` si no hubo co-firma). Lo
 * que el kit repite al suscribirse no cuenta: es de una firma anterior. Todo dentro de `try`: nunca lanza. La escucha
 * también, porque el kit llama a quienes escuchan sin atajar lo que lanzan: un error ahí cortaría la firma misma.
 */
function vigilarLaCofirma(client: PollarClient): (() => PedidoDeCofirma | null) | null {
  try {
    if (typeof client.onTransactionStateChange !== "function") return null;
    let armado = false;
    let pedido: string | null = null;
    const soltar = client.onTransactionStateChange((s) => {
      try {
        if (armado && s.step === "awaiting_cosign") pedido = s.request.id;
      } catch {
        /* el testigo nunca frena nada */
      }
    });
    armado = true;
    return () => {
      try {
        soltar();
        if (!pedido) return null;
        const r = client.getCosignState().lastResolved;
        return r && r.id === pedido ? (r as unknown as PedidoDeCofirma) : null;
      } catch {
        return null;
      }
    };
  } catch {
    return null;
  }
}

/**
 * La línea del testigo a la consola, en una vía o en otra según lo que dijo: `info` si lo que Pollar pidió votar es la
 * misma transacción que armó la página, `warn` si no. La línea nunca lleva direcciones ni hashes.
 */
const anotarElTestigo = (linea: string): void => {
  if (linea.includes(": misma transacción")) console.info(linea);
  else console.warn(linea);
};

/**
 * El testigo de una firma del sello, del sorteo o de Mandar: mientras dura la firma escucha si el kit quedó esperando
 * una co-firma y, al terminar, si el pedido que se resolvió es ese, lo compara con lo que armó la página y anota en la
 * consola una sola línea (`describirPedido`: qué campos difieren, la intención, si se puede volver a pedir, cómo vino lo
 * firmado y cómo se ata el hash del envío). Solo mira: nunca frena nada ni cambia lo que devuelve la firma, y todo va
 * dentro de `try`.
 */
function armarTestigo(client: PollarClient): ((xdr: string) => void) | null {
  const vigia = vigilarLaCofirma(client);
  if (!vigia) return null;
  return (xdr) => {
    try {
      const r = vigia();
      if (!r) return;
      void import("./cofirma-regla")
        .then(({ describirPedido }) => describirPedido(xdr, r, network.networkPassphrase))
        .then(anotarElTestigo)
        .catch(() => undefined);
    } catch {
      /* el testigo nunca frena nada */
    }
  };
}

/**
 * El testigo del pedido de la línea del dólar digital, que arma Pollar y no una transacción de la página: al terminar el
 * pedido cuenta cómo era lo que el kit votó (`describirLinea`). Es lo que dice la forma real de la línea antes de que
 * ninguna regla la apruebe. Solo mira, y todo va dentro de `try`. Sin cuenta de la sesión no anota, pero suelta la escucha.
 */
function armarTestigoDeLaLinea(client: PollarClient, cuenta: string | null, usdc: { code: string; issuer: string }): (() => void) | null {
  const vigia = vigilarLaCofirma(client);
  if (!vigia) return null;
  return () => {
    try {
      const r = vigia();
      if (!r || !cuenta) return;
      void import("./cofirma-regla")
        .then(({ describirLinea }) => describirLinea(r, cuenta, network.networkPassphrase, usdc))
        .then((linea) => console.info(linea))
        .catch(() => undefined);
    } catch {
      /* el testigo nunca frena nada */
    }
  };
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
/** Lo leído es el pedido de co-firma con ese id: el estado de otro pedido no dice nada del votado (voto por contenido). */
const esElPedido = (x: unknown, id: string): x is PedidoDeCofirma => esObjetoPlano(x) && x.id === id;
const soloTextos =(x: unknown): string[] => (Array.isArray(x) ? x.filter((v): v is string => typeof v === "string") : []);
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
  /** La entrada con Google en curso: un segundo toque se suma a ella (`connect`). */
  #entrando: Promise<string> | null = null;
  /** Qué hacer apenas la ventana de Google queda abierta (lo arma `connect`): la página de una campaña suelta su marca. */
  #alAbrirLaVentana: (() => void) | null = null;
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
  /** Hasta cuándo el servicio de cuentas dijo que no acepta pedidos (un 429), en milisegundos de reloj. 0: no dijo nada. */
  #limiteHasta = 0;
  /** Cómo dejar de mirar los rechazos por límite del cliente armado (`restore`). */
  #sinMirarLimites: (() => void) | null = null;
  /**
   * Los clientes que ya terminaron de leer su sesión guardada (`restore`) o que acaban de entrar: antes de eso, que el cliente no
   * tenga ninguna sesión no dice nada (`sesionPerdida`). Solo lo mira la página del celular de una campaña.
   */
  readonly #leidos = new WeakSet<object>();
  /**
   * Por cliente, si la llave de este navegador quedó guardada (IndexedDB): true, false, o null mientras se mira. Se mira una
   * vez al asegurar la sesión, que es lo que usa la página del celular, y lo lee `soltarElCliente`.
   */
  readonly #llaves = new WeakMap<object, boolean | null>();
  /**
   * El cliente armado vota a mano (issue 180): se pidió con la variable del build en la red principal y el kit lo tomó
   * (`_cosignManual`). Todo lo que se levanta con el voto por contenido mira esto, nunca la variable sola.
   */
  #aMano = false;
  /** Las negativas del voto por contenido de esta pestaña, también en memoria por si el almacenamiento falla. */
  #distintasEnMemoria = 0;
  /** Las negativas de la regla de la línea de esta pestaña, también en memoria. */
  #distintasDeLaLineaEnMemoria = 0;
  /** La cuenta de esas negativas, solo en memoria: otra cuenta empieza de cero. */
  #cuentaDeLasDistintas: string | null = null;
  /**
   * Los pedidos de la línea que la regla no votó en esta pestaña, rechazados o no: no dejan la ventana en Se está activando
   * y el toque siguiente no los vuelve a mirar.
   */
  readonly #rechazadosAqui = new Set<string>();
  /**
   * Los pagos que pasaron su regla y que el voto a mano puede firmar, solo mientras dura su llamada: el XDR, con su cuenta
   * y su forma. Es la lista de lo permitido de los pagos (decisión 24), como `#esperadas` lo es de las confirmaciones.
   */
  readonly #pagosRevisados = new Map<string, { cuenta: string; forma: FormaDelPago }>();
  /** Cuántos votos salieron por `relay` desde esta pestaña: si cambia durante una firma, esa firma ya pudo votarse. */
  #votosEstampados = 0;
  /** El pago con la cuenta en curso en esta pestaña, por su marca: dos toques del mismo comparten uno solo. */
  #pagandoConLaCuenta: { marca: string; promesa: Promise<ResultadoDelRetiro> } | null = null;
  /** Los pagos con la cuenta que quedaron en duda en esta pestaña, por su marca: el hash para volver a mirar sin mandar. */
  readonly #pagosEnDuda = new Map<string, string>();

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
    // El voto por contenido (issue 180): solo en la red principal y con la variable del build. Sin ella, el cliente nace
    // con la misma configuración de siempre, sin el campo.
    const votoPedido = network.name === "mainnet" && votoPorContenido();
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
      // Con el voto a mano el kit devuelve el pedido de co-firma sin votarlo (`_settleCosign`): lo vota `#votarLoArmado`.
      ...(votoPedido ? { cosignManual: true } : {}),
    });
    // Lo que se levanta con el voto mira lo que el kit de verdad tomó, no la variable: un kit que ignore el campo deja
    // todo como con la variable apagada (la puerta del premio arriba).
    this.#aMano = votoPedido && (client as unknown as { _cosignManual?: unknown })._cosignManual === true;
    if (this.#aMano) console.info("[tinkazo] voto por contenido: prendido");
    else if (votoPedido) console.warn("[tinkazo] voto por contenido: el kit no lo tomó");
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
   *
   * `intencion` dice qué se le pide al kit (`sign` o `sign_and_send`). Con el voto a mano (`#aMano`) es obligatoria: antes
   * de pedir nada se mira lo permitido y el tope de la pestaña (`#antesDelVoto`), y lo que devuelve el kit pasa por la
   * regla (`#conLaRegla`). Sin el voto a mano, todo es como siempre.
   *
   * `antesDeFirmar` corre solo si la puerta del premio corrió, justo después de ella y antes de firmar: el sello lo usa para
   * no firmar una ronda que la lectura de la red dejó sin margen. Si lanza, no se firma nada.
   * `pago` dice que la firma es de un pago que ya pasó su regla (`#pagarConLaCuenta`): solo así un pago entra en la lista de
   * lo permitido, y solo con el voto a mano. Sin el voto a mano, un pago no se firma nunca por acá.
   */
  async #firmando<T>(
    xdr: string,
    firmar: (client: PollarClient) => Promise<T>,
    o: { testigo?: boolean; intencion?: IntencionDeFirma; antesDeFirmar?: () => void; pago?: FormaDelPago } = {},
  ): Promise<T> {
    const client = await this.#ensureClient();
    const aMano = this.#aMano;
    if (o.pago !== undefined && !aMano) throw new Error("tinkazo-pago-sin-voto");
    // La puerta del premio, pegada a la firma: lo último antes de anotar el XDR y de firmar. Sin caché: cada firma vuelve a
    // mirar. Fuera de la red principal, de los modos que cuida y con el voto a mano, no hace nada ni lee nada.
    if (this.#puertaActiva()) {
      const puerta = await this.#puertaDelPremio(client);
      // Una cuenta que Horizon no conoce no firma: ahí se trata como una lectura que no se pudo hacer.
      if (puerta !== "libre") throw new PremioGuardado(puerta === "puede-guardar" ? "puede-guardar" : "no-se-sabe");
      // La lectura puede haber gastado hasta su presupuesto (unos 7 s): quien llama vuelve a mirar si todavía vale firmar.
      o.antesDeFirmar?.();
    }
    if (aMano) await this.#antesDelVoto(client, xdr, o.intencion, o.pago);
    // Sin el voto a mano, en la red principal el kit vota solo la co-firma: el testigo anota si lo votado fue lo armado
    // (riesgo aceptado, docs/architecture.md). Solo mira, después de firmar. El pago con el saldo no lo usa: lo firmado se
    // revisa entero antes de mandarlo (`pagarOrden`). Con el voto a mano no hace falta: la regla anota antes de votar.
    const testigo = !aMano && network.name === "mainnet" && o.testigo !== false ? armarTestigo(client) : null;
    this.#esperadas.set(xdr, (this.#esperadas.get(xdr) ?? 0) + 1);
    try {
      const r = await firmar(client);
      return aMano ? ((await this.#conLaRegla(client, xdr, r, o.intencion)) as T) : r;
    } finally {
      const quedan = (this.#esperadas.get(xdr) ?? 1) - 1;
      if (quedan > 0) this.#esperadas.set(xdr, quedan);
      else this.#esperadas.delete(xdr);
      testigo?.(xdr);
    }
  }

  /* ------------------------------------------------ el voto por contenido (issue 180) */

  /** Si el navegador vota a mano lo que armó la página: hay cliente y el kit tomó el voto a mano. Sincrónico. */
  votaPorContenido(): boolean {
    return this.#client !== null && this.#aMano;
  }

  /** La puerta del premio corre: en la red principal, en un modo que cuida y sin el voto a mano. */
  #puertaActiva(): boolean {
    return network.name === "mainnet" && PUERTA_DEL_PREMIO_EN.includes(modoDeRampa()) && !this.#aMano;
  }

  /**
   * Con el voto a mano, antes de pedirle nada al servidor: la cuenta de la sesión, el tope de negativas de la pestaña (con
   * el tope no nace otro pedido), la intención (un error nuestro si falta) y la lista de lo permitido (solo el sello y
   * el sorteo del contrato oficial, `motivoContraLoPermitido`, o un pago que pasó su regla en `retirar` o `pagarPremio`
   * para esta misma llamada, solo para firmar sin mandar). Lanza el error que corresponde. Lo que se corta acá no se pidió,
   * así que no cuenta para el tope.
   */
  async #antesDelVoto(client: PollarClient, xdr: string, intencion: IntencionDeFirma | undefined, pago?: FormaDelPago): Promise<void> {
    const regla = await import("./cofirma-regla");
    const cuenta = this.#cuentaParaActivar(client);
    if (!cuenta) throw new Error("account-wait-cancelled");
    if (this.#distintasPara(cuenta) >= regla.TOPE_DE_DISTINTAS) throw new Error(regla.COFIRMA_TOPE);
    if (!intencion) {
      console.warn("[tinkazo] co-firma no votada: sin-intencion");
      throw new Error(regla.COFIRMA_DISTINTA);
    }
    const motivo = await regla.motivoContraLoPermitido(xdr, cuenta, network.contractId, network.networkPassphrase);
    if (motivo !== null && this.#esUnPagoRevisado(xdr, cuenta, intencion, pago)) return;
    if (motivo !== null) {
      console.warn(`[tinkazo] co-firma no votada: fuera de lo permitido (${motivo})`);
      throw new Error(regla.COFIRMA_DISTINTA);
    }
  }

  /**
   * ¿Es un pago que ya pasó su regla para esta misma llamada? Lo puso `#pagarConLaCuenta` en `#pagosRevisados` justo antes
   * de firmar, con su cuenta y su forma, y lo saca al terminar. Solo para firmar sin mandar: un pago nunca se manda por el
   * proveedor de cuentas, siempre por el servicio de comisiones.
   */
  #esUnPagoRevisado(xdr: string, cuenta: string, intencion: IntencionDeFirma, pago: FormaDelPago | undefined): boolean {
    const revisado = this.#pagosRevisados.get(xdr);
    return pago !== undefined && intencion === "sign" && revisado !== undefined && revisado.cuenta === cuenta && revisado.forma === pago;
  }

  /** Las negativas de esta pestaña para esa cuenta y esa regla: si la cuenta cambió, empiezan de cero. */
  #distintasPara(cuenta: string, de: DeLaNegativa = "armada"): number {
    if (this.#cuentaDeLasDistintas !== null && this.#cuentaDeLasDistintas !== cuenta) this.#olvidarDistintas();
    this.#cuentaDeLasDistintas = cuenta;
    const enMemoria = de === "linea" ? this.#distintasDeLaLineaEnMemoria : this.#distintasEnMemoria;
    return Math.max(enMemoria, negativasGuardadas(MARCA_DE_LA_NEGATIVA[de]));
  }

  #olvidarDistintas(): void {
    this.#distintasEnMemoria = 0;
    this.#distintasDeLaLineaEnMemoria = 0;
    this.#rechazadosAqui.clear();
    borrarMarca(MARCAS_DE_LA_CUENTA.distintas);
    borrarMarca(MARCAS_DE_LA_CUENTA.distintasLinea);
  }

  /**
   * Lo que devolvió el kit con el voto a mano. Un pedido de co-firma de esta llamada se vota con la regla
   * (`#votarLoArmado`). Un error es de antes de cualquier co-firma y sale tal cual. Algo firmado sin pedido al pedir solo la
   * firma no pasó por la regla y no se usa (negativa): nadie lo manda. Algo firmado o mandado sin pedido al pedir firmar y
   * mandar, o lo que no se entiende, es incierto: pudo haber salido, así que no se dice que no pasó nada.
   */
  async #conLaRegla(client: PollarClient, armadaXdr: string, r: unknown, intencion: IntencionDeFirma | undefined): Promise<unknown> {
    const x = (r ?? {}) as { status?: unknown; request?: unknown };
    if (x.status === "error") return r;
    if (!intencion) return this.#noVotada(client, "sin-intencion", null);
    const conId = esObjetoPlano(x.request) && typeof x.request.id === "string" && x.request.id !== "";
    const pedido = conId ? (x.request as unknown as PedidoDeCofirma) : null;
    if (x.status === "cosign_pending" && pedido) return this.#votarLoArmado(client, armadaXdr, pedido, intencion);
    if (x.status === "signed" && intencion === "sign") return this.#noVotada(client, "sin-pedido", null);
    return this.#incierto(pedido, "sin pedido");
  }

  /**
   * Vota el pedido que devolvió esta llamada si y solo si su transacción es la armada, byte a byte. En orden: la cuenta
   * de la sesión, la organización y, si se puede, la versión releída (que es la que se vota), lo que ya no espera nuestro
   * voto, la armada de esta cuenta, la forma del pedido y la comparación, el voto (`#estampar`) y cómo terminó
   * (`desenlaceDelVoto`). Antes del voto una negativa es verdad (no se hizo nada) y sale
   * `COFIRMA_DISTINTA` o el tope. Desde el voto, lo que no se sabe es incierto. Nunca vota un pedido de la lista de
   * pendientes: solo el id que devolvió la llamada.
   */
  async #votarLoArmado(client: PollarClient, armadaXdr: string, pedido: PedidoDeCofirma, intencion: IntencionDeFirma): Promise<SalidaDelVoto> {
    const regla = await import("./cofirma-regla");
    // 1. La cuenta de la sesión. Sin ella no se vota ni se rechaza nada.
    const cuenta = this.#cuentaParaActivar(client);
    if (!cuenta) return { status: "error", code: "account-wait-cancelled" };
    const deLaLlamada = { id: pedido.id, intencion, linea: false };
    // 2. La organización y la versión releída. Un corte es de red, como siempre: no se estampó nada.
    let subOrg: string | null;
    let leido: PedidoDeCofirma | null;
    try {
      const [recuperacion, releido] = await Promise.all([
        client.cosign.recovery.status(),
        pedido.refreshable ? client.cosign.refresh(pedido.id) : Promise.resolve(pedido as unknown as CosignRequest),
      ]);
      subOrg = recuperacion.subOrgId ?? null;
      leido = esObjetoPlano(releido) ? (releido as unknown as PedidoDeCofirma) : null;
    } catch (e) {
      if (esCorteDelVoto(e)) return { status: "error", code: "SDK_NETWORK_TIMEOUT" };
      if (regla.esDeEstaLlamada(pedido, deLaLlamada)) await this.#rechazarElNuestro(client, pedido.id);
      return { status: "error", code: codigoDelKit(e) ?? "SDK_COSIGN_UPSTREAM_ERROR", ...detalleDelKit(e) };
    }
    // 3. Lo que ya no espera nuestro voto. Otro id después de releer, o algo que no se lee, no se vota ni se rechaza.
    if (leido === null || leido.id !== pedido.id) return this.#noVotada(client, "otro pedido", null);
    if (typeof leido.status !== "string" || leido.status === "") return this.#noVotada(client, "estado", null);
    if (leido.status === "APPROVED") return this.#incierto(leido, "ya aprobado");
    const porQue = leido.failureReason ? { details: leido.failureReason } : {};
    if (leido.status !== "PENDING") return { status: "error", code: `SDK_COSIGN_${leido.status}`, ...porQue };
    const deEsta = regla.esDeEstaLlamada(leido, deLaLlamada) ? leido.id : null;
    if (leido.activityId) {
      if (deEsta !== null) await this.#rechazarElNuestro(client, deEsta);
      return this.#incierto(leido, "ya votado");
    }
    // 4. La regla: la armada es de esta cuenta, el pedido tiene la forma de la llamada y su transacción es la armada.
    const armada = await regla.leerLaArmada(armadaXdr, network.networkPassphrase);
    if (!armada || armada.cuenta !== cuenta) return this.#noVotada(client, "la armada", deEsta);
    const motivo = regla.motivoContraElPedido(leido, { id: pedido.id, cuenta, intencion, subOrg, hashDeLaArmada: armada.hash });
    // El cuerpo se compara solo: el hash que dice el pedido ya lo mira `motivoContraElPedido`, y `verify` lo vuelve a mirar.
    const comparacion = await regla.compararConLaArmada(armadaXdr, leido.unsignedPayload, network.networkPassphrase);
    if (motivo !== null || !comparacion.igual) return this.#noVotada(client, regla.describirLaNegativa(motivo, comparacion), deEsta);
    // 5. El voto: lo que se estampa es el hash de la armada.
    const estampado = await this.#estampar(client, leido, cuenta, subOrg ?? "", armada.hash);
    if (estampado.que === "negativa") {
      return estampado.rechazar ? this.#noVotada(client, estampado.motivo, deEsta) : { status: "error", code: "account-wait-cancelled" };
    }
    if (estampado.que === "no-salio") return { status: "error", code: estampado.code, ...(estampado.details ? { details: estampado.details } : {}) };
    if (estampado.que === "incierto") return this.#incierto(leido, estampado.motivo);
    console.info(`[tinkazo] co-firma votada: la misma transacción (intención ${intencion}, firmas en el sobre: ${comparacion.firmasEnElSobre})`);
    // 6. Cómo terminó.
    const desenlace = await regla.desenlaceDelVoto(estampado.pedido, this.#depsDelDesenlace(client, cuenta, intencion, armada.hash));
    return this.#salidaDe(desenlace, estampado.pedido);
  }

  /**
   * Estampa con la llave de este navegador el hash de la armada, y nada más. Antes del voto: `verify` tiene que dar ese
   * hash y la propuesta tiene que ser la nuestra (`propuestaEsLaNuestra`), y la sesión tiene que seguir siendo la misma.
   * Si no, negativa (con rechazo, salvo si cambió la sesión). Desde que se llamó a `relay`, una negativa no es verdad
   * nunca: lo que vuelve se lee (`#trasElRelay` si falló) y lo que no se sabe es incierto. No reusa `#votar` de la
   * carga, que propaga un corte como error de red: el sello lo reintentaría con otro voto cuando el primero pudo salir.
   */
  async #estampar(client: PollarClient, pedido: PedidoDeCofirma, cuenta: string, subOrg: string, hash: string): Promise<Estampado> {
    // 1. Lo que se va a estampar. Lo que falle acá, también una propuesta que no se lee, es de antes del voto.
    let propuesta: Extract<CosignVerification, { ok: true }>["proposal"];
    try {
      const verificacion = await client.cosign.verify(pedido as unknown as CosignRequest);
      if (!verificacion.ok || verificacion.localHash !== hash) return { que: "negativa", motivo: "la verificación del kit", rechazar: true };
      if (!propuestaEsLaNuestra(verificacion.proposal, cuenta, hash, subOrg)) return { que: "negativa", motivo: "la propuesta", rechazar: true };
      propuesta = verificacion.proposal;
    } catch {
      return { que: "negativa", motivo: "la verificación del kit", rechazar: true };
    }
    // 2. La sesión otra vez.
    const sigue = this.#client === client && this.#cuentaParaActivar(client) === cuenta;
    if (!sigue) return { que: "negativa", motivo: "sesión cambiada", rechazar: false };
    // 3. El voto. Desde acá, lo que no se entiende es incierto. Se cuenta antes de votar: quien pagó con la cuenta sabe así
    // que su llamada ya llegó al voto y que un error de después no dice que no se hizo nada.
    this.#votosEstampados++;
    let res: unknown;
    try {
      res = await client.cosign.relay(propuesta.path, propuesta.body, { requestId: pedido.id });
    } catch (e) {
      return this.#trasElRelay(client, pedido.id, e);
    }
    let votado: unknown;
    try {
      votado = (esObjetoPlano(res) ? res.request : undefined) ?? (await client.cosign.get(pedido.id, { sync: true }));
    } catch {
      return { que: "incierto", motivo: "sin confirmar" };
    }
    return this.#asentar(client, pedido.id, votado);
  }

  /**
   * El `relay` falló: se lee el pedido una vez. Ya no pendiente, un corte o algo que no es una respuesta del kit: el voto
   * pudo salir, así que no se rechaza y se toma lo leído. Otra respuesta del kit (un 502, un aparato que la cuenta no
   * conoce, sin créditos): aprobado o cerrado se toma lo leído; pendiente se rechaza, y solo sin actividad y con el
   * rechazo hecho quiere decir que nada se llegó a firmar y sale con el código del kit. Lo demás es incierto: un rechazo
   * que no salió (el pedido pudo aprobarse entre la lectura y el rechazo), una actividad, o una lectura que no es la
   * del pedido votado.
   */
  async #trasElRelay(client: PollarClient, id: string, e: unknown): Promise<Estampado> {
    const codigo = codigoDelKit(e);
    const respuestaDelKit = (e as { name?: unknown } | null)?.name === "PollarApiError";
    let leido: unknown;
    try {
      leido = await client.cosign.get(id, { sync: true });
    } catch {
      return { que: "incierto", motivo: respuestaDelKit ? "relay con error" : "relay cortado" };
    }
    if (!respuestaDelKit || codigo === "SDK_COSIGN_REQUEST_NOT_PENDING") return this.#asentar(client, id, leido);
    if (!esElPedido(leido, id)) return { que: "incierto", motivo: "sin confirmar" };
    if (leido.status !== "PENDING") return { que: "votado", pedido: leido };
    const rechazado = await this.#rechazarElNuestro(client, id);
    if (leido.activityId) return { que: "incierto", motivo: "relay con error y actividad" };
    if (!rechazado) return { que: "incierto", motivo: "relay con error y sin rechazo" };
    return { que: "no-salio", code: codigo ?? "SDK_COSIGN_UPSTREAM_ERROR", ...detalleDelKit(e) };
  }

  /**
   * Lo que se leyó después del voto. Si no es el pedido votado (otro id, o algo que no se lee), incierto: su estado no
   * dice nada del nuestro. Si sigue pendiente, espera a que se cierre como el kit (`settle`), y si eso falla, incierto.
   */
  async #asentar(client: PollarClient, id: string, leido: unknown): Promise<Estampado> {
    if (!esElPedido(leido, id)) return { que: "incierto", motivo: "sin confirmar" };
    if (leido.status !== "PENDING") return { que: "votado", pedido: leido };
    let asentado: unknown;
    try {
      asentado = await client.cosign.settle(leido as unknown as CosignRequest);
    } catch {
      return { que: "incierto", motivo: "sin confirmar" };
    }
    return esElPedido(asentado, id) ? { que: "votado", pedido: asentado } : { que: "incierto", motivo: "sin confirmar" };
  }

  /**
   * Rechaza el pedido de esta llamada (el kit lo lee antes y cancela solo si sigue pendiente). Devuelve si quedó rechazado
   * de verdad: el kit contestó con el pedido cerrado, ni pendiente ni aprobado. Si no, se anota y da falso.
   */
  async #rechazarElNuestro(client: PollarClient, id: string): Promise<boolean> {
    let r: unknown = null;
    try {
      r = await client.cosign.reject(id);
    } catch {
      r = null;
    }
    const rechazado = esObjetoPlano(r) && typeof r.status === "string" && r.status !== "PENDING" && r.status !== "APPROVED";
    if (!rechazado) console.warn("[tinkazo] co-firma no rechazada");
    return rechazado;
  }

  /**
   * Una negativa de la regla, antes de estampar: se anota con palabras fijas, suma una a la pestaña en la cuenta de su
   * regla (`de`), rechaza el pedido si es claramente el de esta llamada (`rechazar`, su id) y sale `COFIRMA_DISTINTA`, o
   * `COFIRMA_TOPE` si llegó al tope.
   */
  async #noVotada(client: PollarClient, motivo: string, rechazar: string | null, de: DeLaNegativa = "armada"): Promise<SalidaDelVoto> {
    const { COFIRMA_DISTINTA, COFIRMA_TOPE, TOPE_DE_DISTINTAS } = await import("./cofirma-regla");
    const linea = de === "linea";
    console.warn(linea ? `[tinkazo] línea no votada: ${motivo}` : `[tinkazo] co-firma no votada: ${motivo}`);
    const enMemoria = linea ? this.#distintasDeLaLineaEnMemoria : this.#distintasEnMemoria;
    const n = Math.max(enMemoria, negativasGuardadas(MARCA_DE_LA_NEGATIVA[de])) + 1;
    if (linea) this.#distintasDeLaLineaEnMemoria = n;
    else this.#distintasEnMemoria = n;
    ponerMarca(MARCA_DE_LA_NEGATIVA[de], String(n));
    if (rechazar !== null) await this.#rechazarElNuestro(client, rechazar);
    return { status: "error", code: n >= TOPE_DE_DISTINTAS ? COFIRMA_TOPE : COFIRMA_DISTINTA };
  }

  /** Ya se votó, o pudo votarse, y no se sabe cómo terminó: la firma lo dice como pendiente (`pollar-pending`). */
  #incierto(pedido: PedidoDeCofirma | null, motivo: string): SalidaDelVoto {
    console.warn(`[tinkazo] co-firma incierta: ${motivo}`);
    return { status: "cosign_pending", ...(pedido ? { request: pedido } : {}) };
  }

  /** Lo que el desenlace necesita del cliente: preguntar por un hash, mandar una firmada, esperar y si la sesión sigue. */
  #depsDelDesenlace(client: PollarClient, cuenta: string, intencion: IntencionDeFirma, hash: string): DepsDelDesenlace {
    return {
      intencion,
      hashDeLaArmada: hash,
      passphrase: network.networkPassphrase,
      estado: async (h) => (await client.getTxStatus(h)) as EstadoDelEnvio,
      mandar: async (x) => (await client.submitTx(x)) as unknown as EnvioDelKit,
      dormir: (ms) => new Promise<void>((r) => setTimeout(r, ms)),
      sigue: () => this.#client === client && this.#cuentaParaActivar(client) === cuenta,
    };
  }

  /** El desenlace, con la forma de lo que devuelve el kit, que es lo que leen `signAndSubmit` y `signUnsponsored`. */
  #salidaDe(d: Desenlace, pedido: PedidoDeCofirma): SalidaDelVoto {
    if (d.que === "firmada") return { status: "signed", signedXdr: d.signedXdr };
    if (d.que === "entro") return { status: "success", hash: d.hash };
    if (d.que === "no-salio") return { status: "error", code: d.code, ...(d.details ? { details: d.details } : {}) };
    if (d.que === "incierto") return this.#incierto(pedido, d.motivo);
    const codigos = { ...(d.resultCode ? { resultCode: d.resultCode, details: d.resultCode } : {}), ...(d.code ? { code: d.code } : {}) };
    return { status: "error", hash: d.hash, ...codigos, ...(d.message ? { message: d.message } : {}) };
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
    // El navegador ya copió el almacenamiento de esta pestaña a la ventana nueva: lo que se dejó para ella se puede soltar.
    try {
      this.#alAbrirLaVentana?.();
    } catch {
      /* un aviso que falla no debe cortar la entrada */
    }
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
   * Entra con Google (`#entrarConGoogle`). Un segundo toque mientras se entra se suma a la entrada en curso, sin otra
   * ventana ni otro pedido al SDK: empezar otra le cortaba al SDK la primera, que podía estar creando la cuenta, la
   * primera dejaba de mirar la ventana de la segunda y su corte paraba a la segunda (16 de noviembre de 2026).
   *
   * `avisos.alAbrirLaVentana` corre apenas la ventana queda abierta: la página de una campaña suelta su marca, que la
   * ventana ya se llevó su copia.
   */
  connect(avisos: AvisosDeEntrada = {}): Promise<string> {
    this.#alAbrirLaVentana = avisos.alAbrirLaVentana ?? null;
    if (this.#entrando) return this.#entrando;
    const entrada = this.#entrarConGoogle(avisos).finally(() => {
      if (this.#entrando === entrada) this.#entrando = null;
    });
    this.#entrando = entrada;
    return entrada;
  }

  /**
   * Arranca el login con Google. Se abre una ventana (SDK 0.11.3) y esta promesa resuelve cuando la cuenta está
   * lista. Falla con `popup-blocked` si el navegador no dejó abrir la ventana y con `popup-closed` si la persona la
   * cerró sin entrar: en los dos casos la entrada se corta y se puede volver a intentar. (La versión anterior del SDK
   * se iba a Google y volvía a la página; `restore` sigue sirviendo si la página se recarga.)
   *
   * Con la ventana cerrada, el vigía mira si salió el pedido de ingreso (`mirarPedidoDeIngreso`), en cualquier orden:
   * - sin pedido, la persona cerró sin terminar en Google: a los 6 segundos se corta (`GRACIA_CIERRE_MS`);
   * - con el pedido en camino (antes del cierre, o durante esos 6 segundos), se espera lo que espera el SDK, hasta
   *   `ESPERA_INGRESO_MS`, o hasta que el SDK diga que falló.
   * Cada corte le dice al SDK que pare (`cancelLogin`), y si la cuenta llegó justo en ese instante, se entra igual.
   * Si la espera al SDK pasa de 2,5 segundos desde el cierre, `avisos.terminando` le da a la pantalla cómo cancelar.
   */
  async #entrarConGoogle(avisos: AvisosDeEntrada): Promise<string> {
    const client = await this.#ensureClient();
    // Con una sesión de correo todavía abierta, el SDK devuelve esa misma cuenta apenas se pide entrar: rotularla como de
    // Google le abría el cobro de una campaña que la sala no va a activar. Queda como de correo, y para cambiar de cuenta se
    // cierra antes la sesión (`cambiarDeCuentaReal`, src/ui/campana-comision-real.ts).
    if (!(this.#via === "email" && client.getWallet()?.address)) this.#remember("google");
    // Al volver, `restore` sabe que es una cuenta recién conectada y no una sesión retomada (el contador, src/contar.ts).
    marcarEntrada();
    // Con el plan B del ingreso prendido (`src/ui/ingreso-plan-b.ts`), un error del proveedor al armar la entrada se dice
    // enseguida: sin esto, la persona miraba "Conectando…" hasta el final del plazo, dos minutos. Apagado, como siempre.
    const ready = waitForWallet(client, 120_000, ingresoPlanB());
    ready.catch(() => undefined);
    let rechazar: (e: Error) => void = () => undefined;
    const cortada = new Promise<never>((_, r) => {
      rechazar = r;
    });
    cortada.catch(() => undefined);
    this.#falla = rechazar;
    /** Desde cuándo se ve cerrada la ventana, para el contador (`contarVentanaDeGoogle`). */
    let cerradaDesde = 0;
    const cerrada = (): boolean => {
      const si = this.#ventana?.closed === true;
      if (si && !cerradaDesde) cerradaDesde = Date.now();
      return si;
    };
    // El contador anónimo nunca corta la entrada.
    const contarVentana = (what: Parameters<typeof contarVentanaDeGoogle>[0]): void => {
      try {
        contarVentanaDeGoogle(what);
      } catch {
        /* sin contar */
      }
    };
    /** Entró con la ventana cerrada hace más de 6 segundos: antes eso era un corte, y se cuenta. */
    const entro = (address: string): string => {
      if (cerradaDesde && Date.now() - cerradaDesde > GRACIA_CIERRE_MS) contarVentana("late");
      this.#leidos.add(client);
      this.address = address;
      return address;
    };
    /** Salió el pedido de ingreso: la persona terminó en Google y el servidor está creando o abriendo su cuenta. */
    let enCamino = false;
    let gracia = 0;
    let larga = 0;
    let aviso = 0;
    let soltarPaso = (): void => undefined;
    // Ventana cerrada con el pedido en camino: se desarma el corte de los 6 segundos y se espera al SDK.
    const esperarAlIngreso = (): void => {
      window.clearTimeout(gracia);
      gracia = 0;
      if (larga) return;
      larga = window.setTimeout(() => rechazar(new Error(ENTRADA_DEMORADA)), ESPERA_INGRESO_MS);
      // Si el SDK se da por vencido antes (su plazo, o el servidor dijo que no), no hay nada más que esperar.
      const soltar = client.onAuthStateChange((s) => {
        if (s.step === "error") rechazar(new Error(s.errorCode));
      });
      soltarPaso = () => void soltar();
      // La pantalla no queda muda: si la espera pasa de 2,5 segundos desde el cierre, dice que se está terminando de
      // entrar, con Cancelar. Quien entra antes no ve nada distinto.
      const terminando = avisos.terminando;
      if (!terminando) return;
      aviso = window.setTimeout(
        () => {
          try {
            terminando(() => rechazar(new Error(ENTRADA_CANCELADA)));
          } catch {
            /* lo que pinte la pantalla no corta la entrada */
          }
        },
        Math.max(0, cerradaDesde + AVISO_TERMINANDO_MS - Date.now()),
      );
    };
    const dejarDeMirar = mirarPedidoDeIngreso(client, () => {
      enCamino = true;
      if (cerrada()) esperarAlIngreso();
    }, (segundos) => this.anotarLimite(segundos));
    // Sin poder mirar (otra versión del SDK) vuelve la regla de los 6 segundos: se cuenta, para saberlo sin esperar quejas.
    if (!dejarDeMirar) contarVentana("no_api");
    const vigia = window.setInterval(() => {
      if (!cerrada() || larga) return;
      if (enCamino) {
        esperarAlIngreso();
        return;
      }
      // Sin el pedido, un respiro: el SDK se entera de que la sesión está lista un instante después de que la ventana
      // se cierra sola. Si el pedido sale en este rato, `esperarAlIngreso` desarma el corte.
      if (!gracia) gracia = window.setTimeout(() => (enCamino ? esperarAlIngreso() : rechazar(new Error(ENTRADA_CERRADA))), GRACIA_CIERRE_MS);
    }, 500);
    try {
      client.login({ provider: "google" });
      const wallet = await Promise.race([ready, cortada]);
      return entro(wallet.address);
    } catch (e) {
      if (e instanceof Error && CORTES.includes(e.message)) {
        // El SDK sigue esperando algo que ya no va a llegar: se le dice que pare, y no queda un intento colgado.
        client.cancelLogin();
        if (e.message === ENTRADA_CANCELADA) this.#quedarAfuera(client);
        // Si la cuenta llegó justo en este instante, ya está guardada en el SDK: se entra igual. Solo en los cortes con la
        // entrada en curso: con la ventana bloqueada o sin dirección de Google no hay cuenta que pueda llegar, y quien
        // canceló pidió quedar afuera.
        const ya = TARDIAS.includes(e.message) ? client.getWallet() : null;
        if (ya?.address) return entro(ya.address);
        // La pantalla va a decir que se cerró la ventana antes de entrar: se cuenta cada vez.
        if (e.message === ENTRADA_CERRADA) contarVentana("closed");
        // El plazo largo se cumplió sin cuenta, con el ingreso en camino: se cuenta, para saber si 50 segundos alcanzan.
        if (e.message === ENTRADA_DEMORADA && larga) contarVentana("timeout");
      }
      throw e;
    } finally {
      window.clearInterval(vigia);
      window.clearTimeout(gracia);
      window.clearTimeout(larga);
      window.clearTimeout(aviso);
      soltarPaso();
      dejarDeMirar?.();
      this.#falla = null;
      this.#ventana = null;
      this.#alAbrirLaVentana = null;
    }
  }

  /**
   * Cancelar es quedar afuera (16 de noviembre de 2026). Si la cuenta llegó justo al cancelar, no se toma: se cierra esa
   * sesión del SDK, sin esperar a que el servidor conteste. Y se olvida la marca de Google que puso la entrada, para que la
   * próxima carga no intente retomarla.
   */
  #quedarAfuera(client: PollarClient): void {
    this.#olvidarMarca();
    if (!client.getWallet()?.address) return;
    void Promise.resolve()
      .then(() => client.logout())
      .catch(() => undefined);
  }

  /**
   * Entrar con un correo, paso 1: Pollar manda un código de un solo uso.
   * Resuelve cuando el código salió. Falla con el código de error de Pollar
   * (`EMAIL_SEND_FAILED`, …). Sirve también para pedir otro código: arranca una
   * sesión de correo nueva si la anterior ya avanzó.
   */
  async sendEmailCode(email: string): Promise<void> {
    const client = await this.#ensureClient();
    // La marca del correo se pone recién cuando la cuenta llega (`verifyEmailCode`): pedir un código y no usarlo no cambia
    // por dónde entró la sesión que ya está abierta.
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
    this.#remember("email");
    this.address = wallet.address;
    return wallet.address;
  }

  /**
   * Retoma la sesión al recargar la página (o al volver del redirect de Google, en el SDK anterior).
   *
   * Le pregunta al SDK, que lee su propia sesión guardada al armarse (`ready()`): no hay que esperar ocho segundos a ver
   * si aparece una cuenta que no existe, ni volver a pedir entrar. Con la wifi lenta de un stand, el proveedor puede
   * tardar más de la primera mirada en contestar: entonces el retomo tiene su ventana paciente (`VENTANA_RETOMA_MS`),
   * con espera creciente, y abre la cuenta apenas llega, sin que la persona toque nada. Y si el SDK terminó y no tiene
   * ninguna cuenta (la sesión venció, se borró, o la marca de acá era de otra época), la marca se olvida: antes quedaba
   * para siempre y cada carga repetía ocho segundos de "Retomando…" para caer en "Para sellar, entrá con tu cuenta"
   * (diagnóstico del 26 de octubre de 2026). Si el proveedor sigue afuera después de la ventana, sale con `null` y la
   * marca en pie: salida honesta, y la próxima recarga lo vuelve a intentar.
   *
   * La pantalla no espera la ventana entera: cuando la primera mirada vence sin respuesta se avisa por `cuandoTarda`
   * (una sola vez) y la cabecera se suelta como siempre, a los 8 segundos. La retoma sigue por detrás y, si el proveedor
   * contesta, devuelve la cuenta: quien llama decide si todavía la abre (`restorePollar` de `wallet-ui.ts`).
   *
   * Solo la retoma de la cabecera puede seguir por detrás sin tener a nadie esperando. Quien sí espera la respuesta
   * (`asegurarLaSesion`, la cuenta recordada del registro de equipos, la sala de campaña) pasa `ventanaMs: LISTO_MS`:
   * una sola mirada de 8 segundos, como siempre, sin ventana paciente y sin aviso.
   */
  async restore(opciones: { cuandoTarda?: () => void; ventanaMs?: number } = {}): Promise<string | null> {
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
    // Retomar la sesión son pedidos al servicio de cuentas (validarla, renovarla): un rechazo por límite queda anotado, así la
    // página del celular lo dice con la verdad. El mirador vive lo que vive el cliente.
    this.#sinMirarLimites ??= mirarLimites(client, (segundos) => this.anotarLimite(segundos));
    const listo = await this.#esperarElListo(client, opciones.cuandoTarda, opciones.ventanaMs ?? VENTANA_RETOMA_MS);
    if (listo) this.#leidos.add(client);
    const wallet = client.getWallet();
    this.address = wallet?.address ?? null;
    if (!this.address) {
      // Con una entrada con Google en curso, la marca es de esa entrada: no se olvida aunque la sesión de antes ya no exista.
      if (!(await this.#marcaViva(client, listo)) && !this.#entrando) this.#olvidarMarca();
      return null;
    }
    // Volvió de Google con la cuenta: para el contador es una cuenta conectada, no una sesión retomada. La red va con
    // la entrada (issue #83): Google en la red principal y en prueba se suman por separado.
    if (tomarEntrada()) contarEntradaConRed(this.#via === "email" ? "email" : "google", network.name);
    return this.address;
  }

  /**
   * Espera paciente a que el kit termine de leer su sesión (`restore`): la primera mirada espera `LISTO_MS` y, si el
   * proveedor todavía no contestó, avisa una vez por `cuandoTarda` y sigue con la ventana paciente (`VENTANA_RETOMA_MS`),
   * con espera creciente. Cada vuelta se gana apenas el proveedor contesta, aunque el temporizador siga andando; el
   * temporizador solo acota. Si el kit falla, sale enseguida con falso, como siempre, sin avisar que tarda.
   */
  async #esperarElListo(client: PollarClient, cuandoTarda: (() => void) | undefined, ventana: number): Promise<boolean> {
    const ready = client.ready().then(() => "listo" as const, () => "falla" as const);
    let gastado = 0;
    let pausa = LISTO_MS;
    for (;;) {
      const ancho = Math.min(pausa, ventana - gastado);
      let reloj: ReturnType<typeof setTimeout> | undefined;
      const vence = new Promise<"vence">((r) => {
        reloj = setTimeout(() => r("vence"), ancho);
      });
      const veredicto = await Promise.race([ready, vence]);
      clearTimeout(reloj);
      if (veredicto === "listo") return true;
      if (veredicto === "falla") return false;
      if (gastado === 0 && ventana > ancho) {
        try {
          cuandoTarda?.();
        } catch {
          /* soltar la pantalla no puede romper la retoma */
        }
      }
      gastado += ancho;
      if (gastado >= ventana) return false;
      pausa = Math.min(pausa * 2, ventana - gastado);
    }
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
    this.#distintasEnMemoria = 0;
    this.#distintasDeLaLineaEnMemoria = 0;
    this.#rechazadosAqui.clear();
    this.#cuentaDeLasDistintas = null;
    // La marca de un pago en duda queda (vive en `localStorage` hasta que el pago ya no pueda entrar): solo se olvida el
    // hash para volver a mirar, así otra sesión en esta pestaña no mira el pago de la anterior.
    this.#pagosEnDuda.clear();
    try {
      await this.#client?.logout();
    } catch {
      /* la sesión ya podía estar cerrada */
    }
    this.#sinMirarLimites = null;
    this.#client = null;
    this.#aMano = false;
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

  async signAndSubmit(xdr: string, antesDeFirmar?: () => void): Promise<string> {
    const opciones = { intencion: "sign_and_send" as const, ...(antesDeFirmar ? { antesDeFirmar } : {}) };
    const outcome = (await this.#firmando(xdr, (client) => client.signAndSubmitTx(xdr), opciones)) as ResultadoDeEnvio;
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
    const firmar = (client: PollarClient): Promise<unknown> => client.signTx(xdr, { skipSponsorship: true });
    const outcome = (await this.#firmando(xdr, firmar, { intencion: "sign" })) as { status?: string; signedXdr?: string } & ResultadoDeEnvio;
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
    // En el modo premios la cuenta puede guardar dinero y el pago firma por la misma vía que no se revisa por contenido:
    // no se arma ni se pide nada al proveedor (el build tampoco deja prender los dos, `premios-build.ts`).
    if (network.name !== "mainnet" || modoDeRampa() === "premios") return { estado: "no-salio", motivo: "sin-cuenta" };
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
      firma = (await this.#firmando(xdr, (c) => c.signTx(xdr), { testigo: false, intencion: "sign" })) as typeof firma;
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

  /* ------------------------------------------------ pagar un premio y retirar, por el servicio de comisiones */

  /**
   * Paga el premio de un sorteo desde esta cuenta de Google. `xdr` es el pago que armó la página y `pedido` lo que la
   * persona vio: la cuenta, el destino releído de la lista sellada, el monto y la nota del premio. Solo en la red principal
   * y con la bandera de pagar con Google (que pide el modo premios y el voto por contenido): si no, no arma el cliente ni
   * llama a nada. Un mismo premio se paga una sola vez: la marca por su nota frena otro pago en esta pestaña, en otra o
   * después de recargar, mientras el primero pueda entrar. Nunca lanza.
   */
  pagarPremio(xdr: string, pedido: PedidoDelPremioConLaCuenta): Promise<ResultadoDelPagoConLaCuenta> {
    if (network.name !== "mainnet" || !pagarConGoogle()) return Promise.resolve(sinElTope(ahoraNo("apagado")));
    if (typeof pedido?.nota !== "string" || !NOTA_DE_UN_PREMIO.test(pedido.nota)) return Promise.resolve(sinElTope(porLaRegla("pedido")));
    const marca = MARCA_DEL_PREMIO + pedido.nota;
    return this.#unaVezPorMarca(marca, "tinkazo-pagar-premio", () => this.#pagarConLaCuenta(marca, { forma: "premio", xdr, pedido })).then(sinElTope);
  }

  /**
   * Retira dólares digitales de esta cuenta de Google a otra cuenta, con el costo del retiro. `xdr` es lo que armó Mandar
   * y `pedido` lo que la persona eligió: a quién, cuánto sale y la nota. El costo y su cuenta salen de la configuración
   * del build, nunca de la pantalla: sin ellos no hay retiro, porque el servicio de comisiones solo paga un retiro que
   * trae su costo. Solo en la red principal y con el voto por contenido. Un retiro por vez en este navegador. Nunca lanza.
   */
  retirar(xdr: string, pedido: PedidoDeRetiro): Promise<ResultadoDelRetiro> {
    if (network.name !== "mainnet" || !votoPorContenido()) return Promise.resolve(ahoraNo("apagado"));
    const pago: PagoConLaCuenta = { forma: "retiro", xdr, pedido };
    return this.#unaVezPorMarca(MARCA_DEL_RETIRO, "tinkazo-retirar", () => this.#pagarConLaCuenta(MARCA_DEL_RETIRO, pago));
  }

  /**
   * Un pago con la cuenta por vez en esta pestaña, y de a uno entre pestañas (el candado). Dos toques del mismo pago (la
   * misma marca) comparten uno solo. Otro pago mientras tanto no se arma. Lo que se escape es incierto: no se sabe cómo
   * quedó, así que no se dice que no pasó nada.
   */
  #unaVezPorMarca(marca: string, candado: string, f: () => Promise<ResultadoDelRetiro>): Promise<ResultadoDelRetiro> {
    const enCurso = this.#pagandoConLaCuenta;
    if (enCurso) return enCurso.marca === marca ? enCurso.promesa : Promise.resolve(ahoraNo("otro pago en curso"));
    const promesa = conCandado(candado, f)
      .catch((): ResultadoDelRetiro => incierto("se cortó"))
      .finally(() => {
        if (this.#pagandoConLaCuenta?.promesa === promesa) this.#pagandoConLaCuenta = null;
      });
    this.#pagandoConLaCuenta = { marca, promesa };
    return promesa;
  }

  /**
   * El pago con la cuenta, en orden:
   *
   * 1. El servicio de comisiones de la red principal, el cliente que vota a mano y la cuenta de la sesión. Sin eso, nada.
   * 2. Un pago de esta marca que quizás salió: no se arma otro, se vuelve a mirar en la red sin mandar nada.
   * 3. Lo armado pasa su regla (`motivoContraElPremio` o `motivoContraElRetiro`), con el costo y la cuenta de cobros de la
   *    configuración. Si no la pasa, no se pide nada.
   * 4. Antes de pedir la firma, que cuesta: el servicio atiende esa forma, con el mismo costo, y la cuenta no tiene otro pago
   *    en el aire.
   * 5. La marca, y la firma con el voto por contenido, con lo armado en la lista de lo permitido solo para esta llamada.
   * 6. Lo firmado tiene que ser lo armado, con la misma regla. Si no, ya se votó: no se manda y queda en duda.
   * 7. Lo firmado va al servicio de comisiones, que paga la comisión de la red (`mandarElPago`). Nunca al proveedor.
   *
   * Desde la firma, lo que no sea un rechazo claro es incierto y la marca queda hasta que el pago ya no pueda entrar.
   */
  async #pagarConLaCuenta(marca: string, p: PagoConLaCuenta): Promise<ResultadoDelRetiro> {
    const url = configDelPortero().url;
    if (!url) return ahoraNo("sin el servicio de comisiones");
    let client: PollarClient;
    try {
      client = await this.#ensureClient();
    } catch {
      return { estado: "no-salio", motivo: "red" };
    }
    if (!this.#aMano) return ahoraNo("sin el voto a mano");
    const cuenta = this.#cuentaParaActivar(client);
    if (!cuenta) return ahoraNo("sin la cuenta de la sesión");
    const ahora = (): number => Math.floor(Date.now() / 1000);
    const enVuelo = leerMarcaDeLaCuenta(marca);
    if (enVuelo !== null && enVuelo > ahora()) return this.#volverAMirar(marca);
    const [regla, cofirma, portero] = await Promise.all([import("./pagos-regla"), import("./cofirma-regla"), import("./pago-portero")]);
    const deLaRegla = this.#reglaDelPago(regla, p, cuenta);
    if ("no" in deLaRegla) return deLaRegla.no;
    const passphrase = network.networkPassphrase;
    const leido = await regla.leerPagoArmado(p.xdr, passphrase);
    const motivo = deLaRegla.revisar(leido, ahora());
    if (motivo !== null || !leido?.vence) return porLaRegla(motivo ?? "sin vencimiento");
    const armada = await cofirma.leerLaArmada(p.xdr, passphrase);
    if (!armada || armada.cuenta !== cuenta) return porLaRegla("la armada");
    const antes = await this.#antesDePagar(portero, url, cuenta, p.forma, deLaRegla.costo);
    if (antes) return antes;
    // La marca dura lo más que la regla deja vivir un pago, contado desde ahora, más el margen (decisión 18): así cubre
    // también un reloj adelantado, con el que lo armado puede entrar en la red hasta un minuto más tarde de lo que parece.
    const hastaLaMarca = Math.max(leido.vence, ahora() + regla.VIDA_MAXIMA_DEL_PAGO_S) + portero.MARGEN_TRAS_VENCER_S;
    ponerMarcaDeLaCuenta(marca, hastaLaMarca);
    const firma = await this.#firmarElPago(client, cuenta, p, cofirma);
    if (firma.que === "resultado") {
      if (firma.r.estado !== "incierto") borrarMarcaDeLaCuenta(marca);
      return firma.r;
    }
    const deLaFirma = await cofirma.leerLaArmada(firma.signedXdr, passphrase);
    const otraVez = deLaRegla.revisar(await regla.leerPagoArmado(firma.signedXdr, passphrase), ahora());
    if (!deLaFirma || deLaFirma.hash !== armada.hash || otraVez !== null) return incierto("lo firmado no es lo armado");
    if (this.#client !== client || this.#cuentaParaActivar(client) !== cuenta) return incierto("sesión cambiada");
    const deps = {
      pedir: () => portero.pedirElPago(url, p.forma, firma.signedXdr),
      enLaRed: (h: string) => portero.estadoEnLaRed("mainnet", h),
      dormir: (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
      ahora: () => Date.now(),
    };
    const desenlace = await portero.mandarElPago({ hash: armada.hash, vence: leido.vence }, Date.now() + SEGUIR_EL_PAGO_MS, deps);
    return this.#trasElPortero(marca, desenlace);
  }

  /**
   * La regla de este pago, con lo que rige por configuración. Del premio: la cuenta del pedido es la de la sesión y el
   * destino no es la cuenta de cobros. Del retiro: el costo y su cuenta de la configuración (sin ellos no hay retiro), el
   * destino no es la cuenta de cobros, llega al menos 1 dólar digital y, sin nota pedida, lleva la nota fija del retiro.
   */
  #reglaDelPago(
    regla: typeof import("./pagos-regla"),
    p: PagoConLaCuenta,
    cuenta: string,
  ): { revisar: (leido: PagoArmado | null, ahora: number) => string | null; costo: bigint | null } | { no: ResultadoDelRetiro } {
    const entorno = entornoDelBuild();
    const cobros = cuentaDelRetiro(entorno);
    if (p.forma === "premio") {
      const { destino, monto, nota } = p.pedido;
      if (p.pedido.cuenta !== cuenta) return { no: porLaRegla("otra cuenta") };
      if (cobros !== null && destino === cobros) return { no: porLaRegla("destino de cobros") };
      return { revisar: (leido, ahora) => regla.motivoContraElPremio(leido, { cuenta, destino, monto, nota }, { ahora }), costo: null };
    }
    const stroops = costoDelRetiro(entorno);
    if (stroops === null || cobros === null) return { no: ahoraNo("sin el costo del retiro") };
    const { destino, sale, nota } = p.pedido;
    if (typeof destino !== "string" || typeof sale !== "bigint" || destino === cobros) return { no: porLaRegla("pedido") };
    const llega = sale - stroops;
    if (llega < STROOPS_POR_DOLAR) return { no: porLaRegla("llega poco") };
    const conNota: NotaDelPago = nota.tipo === "ninguna" ? { tipo: "texto", valor: regla.NOTA_DEL_RETIRO } : nota;
    const pedido = { cuenta, destino, llega, nota: conNota, costo: { stroops, destino: cobros } };
    return { revisar: (leido, ahora) => regla.motivoContraElRetiro(leido, pedido, { ahora }), costo: stroops };
  }

  /**
   * Lo que se pregunta al servicio de comisiones antes de pedir la firma (cada firma le cuesta a Tinkazo): que atienda esta
   * forma, que el costo del retiro que exige sea el de la configuración y que la cuenta no tenga otro pago en el aire (uno
   * que la red ya cerró no cuenta). `null` si se puede seguir. Sin respuesta, no se pide nada.
   */
  async #antesDePagar(
    portero: typeof import("./pago-portero"),
    url: string,
    cuenta: string,
    forma: FormaDelPago,
    costo: bigint | null,
  ): Promise<ResultadoDelRetiro | null> {
    const lectura = await portero.mirarPagos(url, cuenta);
    if (lectura.tipo === "sin-respuesta") return { estado: "no-salio", motivo: "red" };
    if (lectura.tipo === "sin-pagos") return ahoraNo("el servicio no atiende pagos");
    const { pagos } = lectura;
    if (!pagos[forma]) return ahoraNo("el servicio no atiende esta forma");
    if (forma === "retiro" && pagos.costoRetiro !== costo) return ahoraNo("otro costo del retiro");
    if (pagos.enCurso !== null) {
      const e = await portero.estadoEnLaRed("mainnet", pagos.enCurso.hash);
      if (e !== "entro" && e !== "fallo") return ahoraNo("otro pago en camino");
    }
    return null;
  }

  /**
   * Firma el pago con el voto por contenido, sin el patrocinio del proveedor (lo manda después el servicio de comisiones).
   * Lo armado entra en la lista de lo permitido solo mientras dura esta firma. Lo que vuelve se lee por su forma y con
   * códigos exactos, nunca por el texto: antes del voto un no es verdad, y después del voto solo es un no lo que el
   * servidor cerró sin firmar. Lo demás es incierto.
   */
  async #firmarElPago(
    client: PollarClient,
    cuenta: string,
    p: PagoConLaCuenta,
    cofirma: typeof import("./cofirma-regla"),
  ): Promise<{ que: "firmada"; signedXdr: string } | { que: "resultado"; r: ResultadoDelRetiro }> {
    const votos = this.#votosEstampados;
    this.#pagosRevisados.set(p.xdr, { cuenta, forma: p.forma });
    let r: unknown;
    try {
      const firmar = (c: PollarClient): Promise<unknown> => c.signTx(p.xdr, { skipSponsorship: true });
      r = await this.#firmando(p.xdr, firmar, { testigo: false, intencion: "sign", pago: p.forma });
    } catch (e) {
      if (this.#votosEstampados !== votos) return { que: "resultado", r: incierto("la firma se cortó tras el voto") };
      const codigo = codigoDelKit(e) ?? (e instanceof Error ? e.message : undefined);
      return { que: "resultado", r: noSeFirmo(codigo, esDeRed(e), cofirma) };
    } finally {
      this.#pagosRevisados.delete(p.xdr);
    }
    const x = (r ?? {}) as { status?: unknown; signedXdr?: unknown; code?: unknown };
    if (x.status === "signed" && typeof x.signedXdr === "string" && x.signedXdr !== "") return { que: "firmada", signedXdr: x.signedXdr };
    const codigo = typeof x.code === "string" ? x.code : undefined;
    const votado = this.#votosEstampados !== votos;
    if (x.status !== "error") return { que: "resultado", r: incierto("sin firma") };
    return { que: "resultado", r: votado ? trasElVoto(codigo) : noSeFirmo(codigo, codigo === "SDK_NETWORK_TIMEOUT", cofirma) };
  }

  /**
   * Lo que dijo el servicio de comisiones. Salió: la marca se borra. Entró y falló, o un rechazo claro: no se movió nada, la
   * marca se borra y se puede volver a intentar. En duda: la marca queda y se guarda el hash para volver a mirar.
   */
  #trasElPortero(marca: string, d: DesenlaceDelPago): ResultadoDelRetiro {
    if (d.que === "duda") {
      this.#pagosEnDuda.set(marca, d.hash);
      return incierto("sin confirmar");
    }
    borrarMarcaDeLaCuenta(marca);
    this.#pagosEnDuda.delete(marca);
    if (d.que === "salio") {
      console.info("[tinkazo] pago con la cuenta: salió");
      return { estado: "salio", hash: d.hash };
    }
    if (d.que === "fallo") return ahoraNo("entró y falló");
    const motivo = motivoDelPortero(d.motivo);
    console.warn(`[tinkazo] pago con la cuenta no pagado por el servicio: ${d.motivo.replace(/[^a-z-]/g, "")}`);
    return { estado: "no-salio", motivo };
  }

  /**
   * Un pago de esta marca que quizás salió: se pregunta a la red por su hash, si esta pestaña lo tiene, sin firmar ni
   * mandar nada. Entró: salió. Entró y falló: se puede volver a intentar. Lo demás, o sin el hash (otra pestaña, una
   * recarga), sigue incierto hasta que la marca venza.
   */
  async #volverAMirar(marca: string): Promise<ResultadoDelRetiro> {
    const hash = this.#pagosEnDuda.get(marca);
    if (!hash) return incierto("otro pago de esta marca en camino");
    const { estadoEnLaRed } = await import("./pago-portero");
    const e = await estadoEnLaRed("mainnet", hash);
    if (e === "no-esta" || e === "no-se-sabe") return incierto("todavía sin confirmar");
    borrarMarcaDeLaCuenta(marca);
    this.#pagosEnDuda.delete(marca);
    return e === "entro" ? { estado: "salio", hash } : ahoraNo("entró y falló");
  }

  /* ------------------------------------------------ activar los dólares digitales (la línea del USDC de Circle) */

  /**
   * Activa los dólares digitales de la cuenta de Google o de correo: le pide a Pollar la línea del USDC de Circle de la
   * red, sin límite y sin saltear el patrocinio. Sale solo del toque de la persona en Activar dólares digitales: mientras
   * dura, la puerta confirma esa línea y nada más. En la red principal, si ya espera el pedido de la línea que abre solo el
   * proveedor, vota ese con la regla de la línea en lugar de pedir otro (`#antesDeLaLinea`). Con el voto a mano, el pedido
   * que devuelve el kit también pasa por esa regla. Con la bandera apagada no arma el cliente ni llama a nada. Dos toques
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
    // En el modo premios, la línea también es un voto por hash: no se pide para una cuenta que ya puede guardar un premio
    // (el XLM no cuenta). Lo que la ventana mostraba (o lo que otra pestaña hizo) puede haber quedado viejo, así que se
    // vuelve a mirar acá.
    if (network.name === "mainnet" && modoDeRampa() === "premios") {
      const cuenta = this.#cuentaParaActivar(client);
      const antes = cuenta === null ? "no-se-sabe" : await mirarAntesDeActivar(network.name, cuenta);
      if (antes === "ya-esta") return "hecho";
      if (antes === "no-se-sabe") return "no-salio";
    }
    const usdc = usdcDeLaRed(network.name);
    const aMano = this.#aMano;
    // En la red principal, antes de pedir otra: un pedido de la línea que ya espera (el que abre solo el proveedor) se vota
    // con la regla y el toque de la persona, o se espera si ya tiene un voto (`#antesDeLaLinea`).
    if (network.name === "mainnet") {
      const antes = await this.#antesDeLaLinea(client, aMano);
      if (antes !== null) return antes;
    }
    let quedan = 1;
    this.#lineaPedida = { code: usdc.code, issuer: usdc.issuer, tomar: () => quedan-- > 0 };
    // Sin el voto a mano, en la red principal el kit vota solo el pedido de la línea: el testigo cuenta cómo era lo que
    // votó. Solo mira. Con el voto a mano no hace falta: la regla anota antes de votar.
    const testigo = !aMano && network.name === "mainnet" ? armarTestigoDeLaLinea(client, this.address, usdc) : null;
    try {
      const r = (await client.setTrustline({ code: usdc.code, issuer: usdc.issuer })) as { status?: string; code?: string; details?: string };
      return resultadoDeLaLinea(aMano ? await this.#laLineaConLaRegla(client, r) : sinLaNegativa(r));
    } catch {
      return "no-salio";
    } finally {
      this.#lineaPedida = null;
      testigo?.();
    }
  }

  /**
   * Lo que se mira antes de pedirle la línea al kit, en la red principal. `null` quiere decir que se pide, como siempre.
   *
   * El proveedor abre solo un pedido de la línea para cada cuenta, sin que nadie toque Recibir un premio. Si hay uno que
   * espera sin voto, el toque de la persona vota ESE pedido con la regla de la línea (`#votarLaLinea`), y no se pide otro.
   * Es la excepción angosta a no votar pedidos de la lista: solo la línea, con su forma exacta y con el toque. Vale con el
   * voto a mano y sin él: sin él, pedir otra línea con uno esperando podría hacer que el servidor devuelva ese mismo y el
   * kit lo vote solo por hash, así que mientras quede un pedido de la línea esperando nunca se llama a `setTrustline`.
   *
   * Uno con un voto en curso se espera (`en-curso`). Los que la regla ya no votó en esta pestaña no se vuelven a mirar, y
   * mientras sigan esperando el toque dice que no se pudo comprobar, sin invitar a probar otra vez. Con el voto a mano, o
   * con un pedido para votar, el tope de negativas de la línea corta antes de leer o votar nada. Sin la cuenta de la
   * sesión, o sin poder leer la lista, no se pide nada.
   */
  async #antesDeLaLinea(client: PollarClient, aMano: boolean): Promise<ResultadoDeActivarUsdc | null> {
    const { TOPE_DE_DISTINTAS } = await import("./cofirma-regla");
    const cuenta = this.#cuentaParaActivar(client);
    if (!cuenta) return "no-salio";
    const enElTope = (): boolean => this.#distintasPara(cuenta, "linea") >= TOPE_DE_DISTINTAS;
    if (aMano && enElTope()) return "no-coincide-tope";
    let lista: unknown;
    try {
      lista = await client.cosign.pending();
    } catch {
      return "no-salio";
    }
    // Una lista que no se lee no dice que no haya ninguno esperando: no se pide otro.
    if (!Array.isArray(lista)) return "no-salio";
    const lineas = lista.filter(esLineaPendiente);
    const nuevas = lineas.filter((p) => !this.#rechazadosAqui.has(p.id));
    if (nuevas.some((p) => !!p.activityId)) return "en-curso";
    const votable = elMasNuevo(nuevas);
    if (votable) return enElTope() ? "no-coincide-tope" : resultadoDeLaLinea(await this.#votarLaLinea(client, votable, false));
    if (lineas.length === 0) return null;
    console.warn("[tinkazo] línea no votada: ya revisada en esta pestaña");
    return "no-coincide-tope";
  }

  /**
   * Lo que devolvió `setTrustline` con el voto a mano. El pedido de esta llamada se vota con la regla de la línea. Un error
   * es de antes de cualquier co-firma y sale tal cual. Cualquier otra cosa no pasó por la regla y pudo haber salido: es
   * incierto, que para la ventana es en curso.
   */
  async #laLineaConLaRegla(client: PollarClient, r: unknown): Promise<SalidaDelVoto> {
    const x = (r ?? {}) as { status?: unknown; code?: unknown; details?: unknown; request?: unknown };
    if (x.status === "error") {
      const codigo = typeof x.code === "string" ? { code: x.code } : {};
      return sinLaNegativa<SalidaDelVoto>({ status: "error", ...codigo, ...(typeof x.details === "string" ? { details: x.details } : {}) });
    }
    const conId = esObjetoPlano(x.request) && typeof x.request.id === "string" && x.request.id !== "";
    const pedido = conId ? (x.request as unknown as PedidoDeCofirma) : null;
    if (x.status === "cosign_pending" && pedido) return this.#votarLaLinea(client, pedido, true);
    return this.#incierto(pedido, "sin pedido");
  }

  /**
   * Vota un pedido de la línea del dólar digital si y solo si tiene la forma exacta de la línea de esta cuenta
   * (`motivoContraLaLinea`, con el lector del kit como segunda llave). `deLaLlamada`: el pedido lo devolvió nuestro
   * `setTrustline` (solo ese se rechaza cuando la regla no lo vota, y solo si es claramente una línea de esta llamada). Si
   * no, es el que abrió el proveedor y esperaba en la lista: la regla nunca lo rechaza. Si el voto ya salió y el servidor
   * contesta con un error, se rechaza como lo haría el kit (`#trasElRelay`). En orden, como `#votarLoArmado`: la cuenta,
   * la organización y la versión releída (que es la que se vota), lo que ya no espera nuestro voto, la regla, el voto
   * (`#estampar` con el hash de la transacción del pedido) y cómo terminó (`desenlaceDelVoto`, firmar y mandar). Lo que
   * contesta el servidor pasa por `sinLaNegativa`: después del voto nunca puede decir que no se hizo nada.
   */
  async #votarLaLinea(client: PollarClient, pedido: PedidoDeCofirma, deLaLlamada: boolean): Promise<SalidaDelVoto> {
    const regla = await import("./cofirma-regla");
    const cuenta = this.#cuentaParaActivar(client);
    if (!cuenta) return { status: "error", code: "account-wait-cancelled" };
    const laLlamada = { id: pedido.id, intencion: "sign_and_send" as const, linea: true };
    const paraRechazar = (p: PedidoDeCofirma): string | null => (deLaLlamada && regla.esDeEstaLlamada(p, laLlamada) ? p.id : null);
    // 1. La organización y la versión releída. Un corte es de red: no se estampó nada.
    let subOrg: string | null;
    let leido: PedidoDeCofirma | null;
    try {
      const [recuperacion, releido] = await Promise.all([
        client.cosign.recovery.status(),
        pedido.refreshable ? client.cosign.refresh(pedido.id) : Promise.resolve(pedido as unknown as CosignRequest),
      ]);
      subOrg = recuperacion.subOrgId ?? null;
      leido = esObjetoPlano(releido) ? (releido as unknown as PedidoDeCofirma) : null;
    } catch (e) {
      if (esCorteDelVoto(e)) return { status: "error", code: "SDK_NETWORK_TIMEOUT" };
      const id = paraRechazar(pedido);
      if (id !== null) await this.#rechazarElNuestro(client, id);
      return sinLaNegativa<SalidaDelVoto>({ status: "error", code: codigoDelKit(e) ?? "SDK_COSIGN_UPSTREAM_ERROR", ...detalleDelKit(e) });
    }
    // 2. Lo que ya no espera nuestro voto.
    if (leido === null || leido.id !== pedido.id) return this.#lineaNoVotada(client, pedido.id, "otro pedido", null);
    if (typeof leido.status !== "string" || leido.status === "") return this.#lineaNoVotada(client, pedido.id, "estado", null);
    if (leido.status === "APPROVED") return this.#incierto(leido, "ya aprobado");
    const porQue = leido.failureReason ? { details: leido.failureReason } : {};
    if (leido.status !== "PENDING") return { status: "error", code: `SDK_COSIGN_${leido.status}`, ...porQue };
    const rechazar = paraRechazar(leido);
    if (leido.activityId) {
      if (rechazar !== null) await this.#rechazarElNuestro(client, rechazar);
      return this.#incierto(leido, "ya votado");
    }
    // 3. La regla de la línea, con nuestra lectura, y el lector del kit como segunda llave.
    const tx = await regla.leerLaLinea(leido.unsignedPayload, network.networkPassphrase);
    const motivo = regla.motivoContraLaLinea(leido, cuenta, tx, subOrg, usdcDeLaRed(network.name));
    if (motivo !== null || !tx) return this.#lineaNoVotada(client, leido.id, motivo ?? "no se lee", rechazar);
    const { recognizedSetupRequest } = await import("@pollar/core");
    const reconocido = recognizedSetupRequest(leido as unknown as CosignRequest);
    if (!reconocido.ok || reconocido.kind !== "change_trust") {
      return this.#lineaNoVotada(client, leido.id, "el lector del kit no la reconoce", rechazar);
    }
    // 4. El voto: lo que se estampa es el hash de la transacción que se revisó.
    const estampado = await this.#estampar(client, leido, cuenta, subOrg ?? "", tx.hash);
    if (estampado.que === "negativa") {
      if (!estampado.rechazar) return { status: "error", code: "account-wait-cancelled" };
      return this.#lineaNoVotada(client, leido.id, estampado.motivo, rechazar);
    }
    if (estampado.que === "no-salio") {
      return sinLaNegativa<SalidaDelVoto>({ status: "error", code: estampado.code, ...(estampado.details ? { details: estampado.details } : {}) });
    }
    if (estampado.que === "incierto") return this.#incierto(leido, estampado.motivo);
    console.info("[tinkazo] línea votada");
    // 5. Cómo terminó.
    const desenlace = await regla.desenlaceDelVoto(estampado.pedido, this.#depsDelDesenlace(client, cuenta, "sign_and_send", tx.hash));
    return sinLaNegativa(this.#salidaDe(desenlace, estampado.pedido));
  }

  /** La regla no votó un pedido de la línea: queda anotado en la pestaña y es una negativa de la línea. */
  #lineaNoVotada(client: PollarClient, id: string, motivo: string, rechazar: string | null): Promise<SalidaDelVoto> {
    this.#rechazadosAqui.add(id);
    return this.#noVotada(client, motivo, rechazar, "linea");
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
   * Si ya espera un pedido de activar la línea con un voto en curso (una co-firma `change_trust` pendiente que ya tiene su
   * actividad): así Se está activando se ve en cualquier pestaña y después de recargar, y el botón no vuelve mientras ese
   * voto siga vivo. Un pedido que espera sin voto (el que abre solo el proveedor) no cuenta: la ventana ofrece Recibir un
   * premio y el toque lo vota con la regla (`#antesDeLaLinea`). Tampoco cuentan los que la regla no votó en esta pestaña.
   * Eso es solo en la red principal, donde corre `#antesDeLaLinea`: en la de prueba cuenta cualquier pedido de la línea
   * que espera, como siempre. Leer no aprueba nada. `null` si no se pudo leer, o con la bandera apagada.
   */
  async pendienteDeActivacion(): Promise<boolean | null> {
    if (modoDeRampa() === "apagada") return null;
    return this.#pendienteDeLinea();
  }

  /** Lo mismo, sin mirar `VITE_RAMPA`, para Preparar mi cuenta de la carga. */
  async #pendienteDeLinea(): Promise<boolean | null> {
    try {
      const client = await this.#ensureClient();
      let lista: unknown[] = client.getCosignState().pending ?? [];
      if (lista.length === 0) lista = await client.cosign.pending();
      // Fuera de la red principal el toque no vota el pedido que ya espera: el botón no vuelve mientras espere uno.
      if (network.name !== "mainnet") return (lista as PedidoDeCofirma[]).some((p) => p.status === "PENDING" && p.operation === "change_trust");
      return lista.some((p) => esLineaPendiente(p) && !!p.activityId && !this.#rechazadosAqui.has(p.id));
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
      if (this.#memoria) {
        borrarMarca(MARCAS_DE_LA_CUENTA.votos);
        this.#olvidarDistintas();
      }
      this.#memoria = { dir, activacion: false, proteccion: false };
    }
    return this.#memoria;
  }

  /**
   * Lee en la red si la cuenta de la sesión puede guardar dinero. Sin la cuenta de la sesión, no se sabe. Ante una duda
   * vuelve a leer unas veces (`mirarPuertaDelPremio`). `sinReintentarNoExiste`: un 404 no se repite (la consulta adelantada).
   */
  async #puertaDelPremio(client: PollarClient, o: { sinReintentarNoExiste?: boolean } = {}): Promise<PuertaDelPremio> {
    const cuenta = this.#cuentaParaActivar(client);
    return cuenta === null ? "no-se-sabe" : mirarPuertaDelPremio(network.name, cuenta, o);
  }

  /**
   * La misma lectura que hace la puerta, sin firmar nada: para que `freeze.ts` avise antes de abrir el cupón o de cerrar
   * la lista. Fuera de la red principal o de los modos que cuida la puerta (`PUERTA_DEL_PREMIO_EN`) da `libre` sin leer.
   * Arma el cliente y, si vota a mano, también da `libre` sin leer: ahí la puerta no corre. No reemplaza a la puerta de
   * `#firmando`.
   */
  async revisarPuertaDelPremio(): Promise<PuertaDelPremio> {
    if (network.name !== "mainnet" || !PUERTA_DEL_PREMIO_EN.includes(modoDeRampa())) return "libre";
    try {
      const client = await this.#ensureClient();
      if (this.#aMano) return "libre";
      return await this.#puertaDelPremio(client, { sinReintentarNoExiste: true });
    } catch {
      return "no-se-sabe";
    }
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
      contarPasoOficial("activada", network.name);
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
      contarPasoOficial("activada", network.name);
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
    // El paso de la cuenta (issue #83): la lectura de verdad dijo que la cuenta quedó lista por todo.
    if (activacion === "lista" && prot.proteccion === "lista") contarPasoOficial("lista", network.name);
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
   * Cómo está la cuenta, para la página del celular de un sorteo: una lectura liviana (un pedido al servicio de cuentas y
   * la llave de este navegador, que es local) sin armar nada ni activar nada. Espera la sesión verificada, porque sin ella
   * el pedido no lleva token. Solo lee: nunca vota ni pide una firma. Fuera de la red principal todo está listo. Cualquier
   * falla o falta de sesión es `no-se-sabe` (con `limite` si el servicio frenó el pedido): nada se inventa. La memoria de
   * que la cuenta está protegida se escribe solo cuando está protegida de verdad en este navegador, y nunca con `naciendo`.
   *
   * Con `esperada` (la cuenta de la página: quien recarga ya anotada vive de lo que recordaba, sin haber retomado la sesión),
   * una sesión de otra cuenta no se lee ni se le atribuye a la esperada: da `no-se-sabe` sin pedir nada. Es lo que pasa en un
   * celular compartido, cuando otra persona entró con su cuenta en este mismo navegador.
   */
  async cuentaDelCelular(tope = TOPE_LECTURA_CELULAR_MS, esperada?: string): Promise<LecturaDelCelular> {
    if (network.name !== "mainnet") return { estado: "lista", protegida: false, correoDeLaSesionConfirmado: false, puedeMandar: false, correoTapado: null, limite: false };
    const dir = this.address;
    if (esperada !== undefined && dir && dir !== esperada) return { ...SIN_DATOS_DEL_CELULAR };
    if (!dir || (await this.tokenDeSesion(tope)) === null) return { ...SIN_DATOS_DEL_CELULAR };
    const client = this.#client;
    if (!client || this.address !== dir) return { ...SIN_DATOS_DEL_CELULAR };
    let s: RecuperacionLeida;
    let llave: string | null;
    try {
      [s, llave] = await conTope(Promise.all([client.cosign.recovery.status() as Promise<RecuperacionLeida>, client.cosign.publicKeyHex().catch(() => null)]), tope);
    } catch (e) {
      const limite = esLimiteDelServicio(e);
      if (limite) this.anotarLimite(null);
      return { ...SIN_DATOS_DEL_CELULAR, limite };
    }
    if (this.address !== dir) return { ...SIN_DATOS_DEL_CELULAR };
    return this.#lecturaDelCelular(client, dir, s, llave);
  }

  /** Clasifica lo que dijo el servicio de cuentas, y recuerda la protección solo cuando está protegida de verdad en este navegador. */
  #lecturaDelCelular(client: PollarClient, dir: string, s: RecuperacionLeida, llave: string | null): LecturaDelCelular {
    const w = client.getWallet();
    const lectura = clasificarParaElCelular(s, llave, cuentaCreada(w) ? "READY" : w?.provisioning, this.profile()?.mail);
    // Protegida en este navegador: la misma condición de «lista» del paso Dejá tu cuenta lista, y nada más.
    if (s.required === true && s.configured === true && !!llave && (s.devices ?? []).some((d) => mismaLlave(d.publicKey, llave))) this.#memoriaDe(dir).proteccion = true;
    return lectura;
  }

  /**
   * Confirma el correo de la sesión con el código que llegó, para la tarjeta del celular, y dice cómo quedó la cuenta con lo
   * que contesta el propio servicio al confirmar (sin otro pedido). No alcanza con `configured`: una cuenta que ya tenía su
   * desbloqueo está protegida aunque el correo no haya quedado, y decir que se confirmó sería falso. Avisa a las otras
   * pestañas solo si el correo quedó confirmado. Un error del servicio sale tal cual, para entender por qué.
   */
  async confirmarCorreoDelCelular(code: string): Promise<LecturaDelCelular> {
    const client = await this.#ensureClient();
    const dir = this.address;
    const s = (await client.cosign.recovery.confirmEmail(code)) as RecuperacionLeida;
    const llave = await client.cosign.publicKeyHex().catch(() => null);
    if (!dir || this.address !== dir) return { ...SIN_DATOS_DEL_CELULAR };
    const lectura = this.#lecturaDelCelular(client, dir, s, llave);
    if (lectura.correoDeLaSesionConfirmado) avisarCambioDeLaCuenta();
    return lectura;
  }

  /**
   * Avisa a `cb` cada vez que algo de la cuenta puede haber cambiado: el estado de la billetera o de la co-firma en el kit,
   * otra pestaña (por `BroadcastChannel`), volver a la pestaña o volver la conexión. Solo llama a `cb`, que vuelve a
   * leer: ningún aviso vota ni pide nada. Devuelve con qué soltar todo. Fuera de la red principal no hace nada.
   *
   * Por defecto arma el cliente del kit para oír también sus avisos. Con `armar: false` (la página del celular de una campaña)
   * no lo arma: solo se oye si ya estaba armado, y si no, quedan el canal entre pestañas y la vuelta a la pestaña. Armar el
   * cliente es retomar la sesión, y eso son pedidos al servicio de cuentas.
   */
  alCambiarLaCuenta(cb: (origen: OrigenDelAviso) => void, o: { armar?: boolean } = {}): () => void {
    if (network.name !== "mainnet") return () => undefined;
    let suelto = false;
    const sueltas: Array<() => void> = [];
    const avisar = (origen: OrigenDelAviso): void => {
      if (suelto) return;
      try {
        cb(origen);
      } catch {
        /* lo que haga quien escucha no corta los avisos */
      }
    };
    try {
      if (typeof BroadcastChannel !== "undefined") {
        const canal = new BroadcastChannel(CANAL_DE_LA_CUENTA);
        canal.onmessage = (ev: MessageEvent) => {
          if ((ev.data as { tipo?: unknown } | null)?.tipo === "cambio") avisar("canal");
        };
        sueltas.push(() => canal.close());
      }
    } catch {
      /* sin canal, se lee al volver a la pestaña */
    }
    if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
      const alVolver = (): void => {
        if (document.visibilityState === "visible") avisar("vista");
      };
      document.addEventListener("visibilitychange", alVolver);
      sueltas.push(() => document.removeEventListener("visibilitychange", alVolver));
    }
    if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
      const alConectar = (): void => avisar("vista");
      window.addEventListener("online", alConectar);
      sueltas.push(() => window.removeEventListener("online", alConectar));
    }
    const oirAlKit = (client: PollarClient): void => {
      if (suelto) return;
      sueltas.push(client.onWalletStateChange(() => avisar("kit")));
      // El kit vuelve a avisar la co-firma cada vez que se leen los pendientes, aunque nada haya cambiado. Como avisar
      // hace leer, eso sería un bucle de lecturas a Pollar mientras el pedido de activar espera: se avisa solo si
      // cambió el conjunto de pedidos (o el último resuelto).
      let ultima: string | null = null;
      sueltas.push(
        client.onCosignStateChange((s) => {
          const f = firmaDeLaCofirma(s);
          if (f === ultima) return;
          ultima = f;
          avisar("kit");
        }),
      );
    };
    if (o.armar === false) {
      if (this.#client) oirAlKit(this.#client);
    } else void this.#ensureClient().then(oirAlKit, () => undefined);
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

  /**
   * El servicio de cuentas rechazó un pedido por límite (un 429): se anota hasta cuándo, con los segundos que dijo o, si no
   * dejó leerlos, una espera corta. Mientras dure, la página del celular no le pide entrar a nadie y lo dice con la verdad.
   */
  anotarLimite(segundos: number | null): void {
    const espera = segundos ?? ESPERA_POR_LIMITE_MS / 1000;
    this.#limiteHasta = Math.max(this.#limiteHasta, Date.now() + espera * 1000);
  }

  /** Cuántos segundos faltan para que el servicio de cuentas acepte pedidos de nuevo, o null si no hay un límite vigente. */
  segundosDeLimite(): number | null {
    const falta = this.#limiteHasta - Date.now();
    return falta > 0 ? Math.ceil(falta / 1000) : null;
  }

  /**
   * Suelta el cliente del kit sin cerrar la sesión: paran sus relojes (la renovación de la sesión, la espera a que la cuenta
   * nazca, la validación al volver a la pestaña) y deja de preguntarle nada al servicio de cuentas. La sesión guardada y la
   * llave del navegador quedan: `asegurarLaSesion` lo vuelve a armar cuando hace falta. No suelta nada si hay una entrada o
   * una confirmación en curso, ni si la sesión o la llave viven solo en este cliente (`#soloEnMemoria`). Dice si lo soltó.
   */
  soltarElCliente(): boolean {
    const client = this.#client;
    if (!client || this.#entrando || this.#confirmacion || this.#soloEnMemoria(client)) return false;
    this.#dejarDeAtender?.();
    this.#dejarDeAtender = null;
    this.#sinMirarLimites?.();
    this.#sinMirarLimites = null;
    this.#client = null;
    this.#listo = null;
    this.#aMano = false;
    try {
      (client as unknown as { destroy?: () => void }).destroy?.();
    } catch {
      /* un cliente que no se deja soltar queda sin dueño: ya nadie lo usa */
    }
    return true;
  }

  /**
   * Con el cliente soltado (o sin armar), lo arma y retoma la sesión guardada. Devuelve la cuenta, o null si no hay sesión
   * que retomar. Con el cliente armado y la sesión verificada no pide nada. Si la retomada de antes falló una vez (un límite,
   * la red lenta), la sesión queda guardada sin verificar y el kit solo vuelve a probar al volver a la pestaña: entonces se
   * suelta el cliente y se arma de nuevo, una vez por pedido, para que repetir sirva de algo (`#volverAProbar`).
   */
  async asegurarLaSesion(): Promise<string | null> {
    if (this.#client && this.address) {
      if (!this.#volverAProbar()) {
        this.#mirarLaLlave();
        return this.address;
      }
      this.soltarElCliente();
    }
    // Quien pide la sesión espera la respuesta: la primera mirada de 8 segundos y nada más. La paciencia es de la cabecera.
    const dir = await this.restore({ ventanaMs: LISTO_MS });
    this.#mirarLaLlave();
    return dir;
  }

  /**
   * Mira una vez por cliente si la llave de este navegador quedó guardada. Si no (IndexedDB bloqueado), la sesión vive solo en
   * este cliente: el kit la borra al retomarla con otro. Un kit sin esa comprobación queda como antes.
   */
  #mirarLaLlave(): void {
    const client = this.#client;
    if (!client || this.#llaves.has(client)) return;
    const llaves = (client as unknown as { _keyManager?: { ensurePersisted?: () => Promise<boolean> } })._keyManager;
    if (typeof llaves?.ensurePersisted !== "function") {
      this.#llaves.set(client, true);
      return;
    }
    this.#llaves.set(client, null);
    llaves.ensurePersisted().then(
      (guardada) => this.#llaves.set(client, guardada !== false),
      () => this.#llaves.set(client, false),
    );
  }

  /**
   * Si la sesión o la llave de este cliente viven solo en memoria: el kit cayó a guardar en memoria (el almacenamiento falló, lo
   * avisa `onStorageDegrade`), o la llave del navegador no quedó guardada, o todavía no se sabe. Soltarlo sería perderlas.
   */
  #soloEnMemoria(client: PollarClient): boolean {
    let degradado = false;
    try {
      // El kit le avisa enseguida a quien se suscribe tarde: suscribirse y soltar alcanza para saberlo.
      const dejar = (client as unknown as { onStorageDegrade?: (cb: () => void) => () => void }).onStorageDegrade?.(() => {
        degradado = true;
      });
      dejar?.();
    } catch {
      /* un kit sin ese aviso no cambia nada */
    }
    return degradado || (this.#llaves.has(client) && this.#llaves.get(client) !== true);
  }

  /**
   * Espera, como mucho `tope`, a que termine lo que la sesión tiene a medias: la lectura de la sesión guardada del cliente (que
   * renueva el token si venció) y una renovación en vuelo. Irse de la página con una renovación a medias deja guardado un token
   * que el servicio ya cambió, y la sesión se pierde. No pide nada: solo espera lo que ya está corriendo. Sin cliente armado no
   * hay nada a medias. Solo lo usa la página del celular de una campaña, antes de ir a recibir.
   */
  esperarLaRetomada(tope: number): Promise<void> {
    const client = this.#client;
    if (!client) return Promise.resolve();
    const renovacion = (): unknown => (client as unknown as { _refreshPromise?: unknown })._refreshPromise;
    const aMedias = Promise.resolve()
      .then(() => client.ready())
      .then(() => renovacion())
      .then(() => undefined, () => undefined);
    return new Promise<void>((resolver) => {
      const reloj = setTimeout(resolver, tope);
      void aMedias.then(() => {
        clearTimeout(reloj);
        resolver();
      });
    });
  }

  /**
   * Si hay que volver a pedir la retomada: el cliente terminó de leer su sesión, la tiene guardada y no quedó verificada, no
   * hay un límite vigente y no tiene una renovación ni una retomada en vuelo. Soltarlo en medio de una renovación pierde el
   * token nuevo, y con un límite vigente volver a pedir solo suma otro rechazo.
   */
  #volverAProbar(): boolean {
    const client = this.#client;
    if (!client || !this.#leidos.has(client) || this.segundosDeLimite() !== null) return false;
    try {
      const a = client.getAuthState() as unknown as { step?: unknown; verified?: unknown };
      if ((a.step === "authenticated" && a.verified === true) || client.getWallet() === null) return false;
      const enVuelo = client as unknown as { _refreshPromise?: unknown; _resumePromise?: unknown };
      return !enVuelo._refreshPromise && !enVuelo._resumePromise;
    } catch {
      return false;
    }
  }

  /**
   * Si el proveedor ya no tiene ninguna sesión que retomar en este navegador: sin cliente y sin la marca de una entrada, o con
   * el cliente que terminó de leer la suya y se quedó sin ninguna (venció, o el kit la cerró al frenar su renovación). Una
   * sesión guardada sin verificar (un límite, la red lenta) no está perdida, y mientras el cliente todavía la lee no se sabe:
   * en los dos casos, no. Solo lee lo que ya sabe el cliente: no pide nada.
   */
  sesionPerdida(): boolean {
    const client = this.#client;
    if (!client) return !this.hayMarca();
    if (!this.#leidos.has(client)) return false;
    try {
      return client.getWallet() === null && client.getAuthState().step !== "authenticated";
    } catch {
      return false;
    }
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
   * retomó de lo guardado y todavía no revalidó no sirve. Si no está verificada, espera: la primera mirada hasta
   * `tope`; si cuando vence el kit dice que la sesión sigue abierta pero sin verificar, y quien pide no puso su propio
   * tope, la ventana paciente (`VENTANA_TOKEN_MS`, issue 88) con espera creciente: una sesión recién creada es justo la que tarda en verificarse,
   * y entregar `null` al primer vencido tiraba al paso «Dejá tu cuenta lista» a ofrecer «Entrar de nuevo» a quien ya
   * entró. Cuando el kit dice que la sesión ya no existe, sí sale con `null` al toque: ahí conviene entrar de nuevo. No
   * borra nunca la marca de la sesión. Es lo que pide el servidor de las altas (`alta-api.ts`) para saber quién es. No
   * se guarda ni se anota: se pide cada vez, y nunca va en una dirección, en la consola ni en un mensaje de error. Sin
   * token no se le pregunta nada al servidor. No toca la firma ni lo que se aprueba: solo lee la sesión.
   */
  tokenDeSesion(topeDeQuienPide?: number): Promise<string | null> {
    const tope = topeDeQuienPide ?? TOPE_TOKEN_MS;
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
      // La ventana paciente es de la espera de siempre (el paso de la cuenta). Quien pide su propio tope, como la lectura
      // del celular o la sala de campaña, tiene exactamente el suyo: ni más corto ni estirado a la ventana.
      const total = topeDeQuienPide === undefined ? Math.max(tope, VENTANA_TOKEN_MS) : tope;
      let gastado = 0;
      let pausa = tope;
      let listo = false;
      let soltar: (() => void) | null = null;
      let reloj: ReturnType<typeof setTimeout> | undefined;
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
      /** Cada vencido vuelve a mirar la sesión de verdad (`getAuthState`), no solo a los avisos: si el kit dice que la
       * sesión ya no existe, no hay token y se sale; si sigue abierta sin verificar y queda ventana paciente, se sigue
       * esperando con espera creciente. */
      const alVencer = (): void => {
        let viva: boolean;
        let tk: string | null = null;
        try {
          const s = client.getAuthState();
          viva = (s as { step?: unknown } | null)?.step === "authenticated";
          if (viva) tk = deLaSesion(s);
        } catch {
          terminar(null);
          return;
        }
        if (!viva) {
          terminar(null);
          return;
        }
        if (tk) {
          terminar(tk);
          return;
        }
        gastado += pausa;
        if (gastado >= total) {
          terminar(null);
          return;
        }
        pausa = Math.min(pausa * 2, total - gastado);
        reloj = setTimeout(alVencer, pausa);
      };
      reloj = setTimeout(alVencer, pausa);
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
    if (s.configured) contarPasoOficial("protegida", network.name);
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
    if (s.configured) contarPasoOficial("protegida", network.name);
    return s.configured;
  }
}

/**
 * Cómo terminó Activar dólares digitales con Google o correo (`activarUsdc`). `no-coincide`: la regla de la línea no votó
 * el pedido y no se hizo nada. `no-coincide-tope`: lo mismo, y en esta pestaña ya no se vuelve a intentar.
 */
export type ResultadoDeActivarUsdc =
  | "apagada"
  | "en-curso"
  | "hecho"
  | "no-patrocina"
  | "ahora-no"
  | "cuenta-creandose"
  | "proteger"
  | "no-coincide"
  | "no-coincide-tope"
  | "no-salio";

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

/**
 * Lo que contestó `setTrustline` (o la regla de la línea, con la misma forma), en lo que la pantalla necesita. La negativa
 * de la regla va antes que los códigos del kit y se reconoce solo por su código exacto, nunca por el detalle. El detalle
 * del error no se muestra nunca.
 */
export function resultadoDeLaLinea(r: { status?: string; code?: string; details?: string }): ResultadoDeActivarUsdc {
  if (r.status === "success" || r.status === "pending") return "hecho";
  if (r.status === "cosign_pending") return "en-curso";
  // La negativa de la regla, solo por su código exacto: el detalle lo escribe el servidor y no puede decir que no se hizo nada.
  if (r.code === "tinkazo-cofirma-distinta-tope") return "no-coincide-tope";
  if (r.code === "tinkazo-cofirma-distinta") return "no-coincide";
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
