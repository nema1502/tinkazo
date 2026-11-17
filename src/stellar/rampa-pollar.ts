/**
 * La carga con bolivianos por Pollar: lo puro. Bolivianos por QR de banco, Stereum los pasa a dólares digitales en
 * Polygon, una cuenta de paso de la persona los cambia si hace falta y el puente de Circle los deja como USDC en su
 * cuenta de Stellar.
 *
 * Acá no se llama a nadie: se leen las respuestas de `@pollar/core` 0.12 (las rutas, la cotización, la orden) y se
 * dice qué significan para la persona. Las llamadas viven en `wallet-pollar.ts`, y la regla que aprueba los pasos con
 * dinero, en `rampa-regla.ts`. Nada de esto se ve mientras `VITE_RAMPA` esté apagada: la pantalla de hoy usa solo
 * `cotizarCarga`, que sigue igual.
 *
 * Lo que este archivo no conoce, no lo adivina: una ruta, un paso o un estado que no reconoce se lee como «no se
 * puede» o «desconocido», y la pantalla dice dónde está el dinero sin aprobar nada. Tampoco firma nada: un tramo de la
 * carga se aprueba solo desde el toque de Aprobar y solo si pasa la regla.
 */

import type { RampField, RampQuoteRequest } from "@pollar/core";
import { esDeRed } from "./errores";
import { USDC_MAINNET } from "./pagos";

/** Lo que usa `cotizarCarga` del cliente de Pollar. El cliente de verdad (`PollarClient`) lo cumple. */
export interface ClienteDeRampa {
  quoteRamp(body: unknown): Promise<unknown>;
}

/** Bolivia por QR de banco, a USDC en Stellar. */
export const BOLIVIA_QR = { currency: "BOB", rail: "QR", country: "BO" } as const;
export const USDC_EN_STELLAR = { code: "USDC", identifier: null, chain: "STELLAR" } as const;

/** Quien emite el USDC de Circle en la red principal de Stellar: el único que la carga deja en la cuenta. */
export const EMISOR_USDC_CIRCLE = USDC_MAINNET.issuer;

export type Cotizacion =
  | { estado: "ok"; quoteId: string; recibis: number | null; minutos: number | null }
  | { estado: "sin-ruta" }
  | { estado: "error" };

/** Un número que Pollar puede mandar como número, como texto o como `{ value }`. */
function numeroDe(x: unknown): number | null {
  if (typeof x === "number") return Number.isFinite(x) ? x : null;
  if (typeof x === "string") return x.trim() !== "" && Number.isFinite(Number(x)) ? Number(x) : null;
  if (x && typeof x === "object") {
    const o = x as Record<string, unknown>;
    return numeroDe(o.value ?? o.amount);
  }
  return null;
}

/**
 * Cuánto recibiría en dólares digitales quien paga `bolivianos` Bs. No mueve nada: solo pregunta. Es la de la pantalla
 * de hoy; la ventana nueva lee el precio con `leerCotizacion`.
 */
export async function cotizarCarga(cliente: Pick<ClienteDeRampa, "quoteRamp">, bolivianos: number): Promise<Cotizacion> {
  if (!Number.isFinite(bolivianos) || bolivianos <= 0) return { estado: "error" };
  try {
    const r = (await cliente.quoteRamp({
      direction: "ONRAMP",
      fiat: BOLIVIA_QR,
      asset: USDC_EN_STELLAR,
      amount: { value: String(bolivianos), denomination: "in" },
    })) as { quotes?: Record<string, unknown>[] };
    const mejor = r?.quotes?.[0];
    if (!mejor || typeof mejor.quoteId !== "string") return { estado: "sin-ruta" };
    const eta = numeroDe(mejor.etaSeconds);
    return { estado: "ok", quoteId: mejor.quoteId, recibis: numeroDe(mejor.amountOut), minutos: eta === null ? null : Math.max(1, Math.round(eta / 60)) };
  } catch (e) {
    return (e as { code?: unknown } | null)?.code === "SDK_RAMPS_NO_ROUTE" ? { estado: "sin-ruta" } : { estado: "error" };
  }
}

/* ================================================================== lectura de objetos que no son nuestros */

type Objeto = Record<string, unknown>;
const esObjeto = (x: unknown): x is Objeto => typeof x === "object" && x !== null && !Array.isArray(x);
const texto = (x: unknown): string | null => (typeof x === "string" && x !== "" ? x : null);
/** Un entero de verdad, o `null`. */
const entero = (x: unknown): number | null => (typeof x === "number" && Number.isSafeInteger(x) ? x : null);
/** Un monto que el servidor manda como texto decimal (`"24.5"`), o `null` si no lo es. */
function montoDecimal(x: unknown): number | null {
  if (typeof x !== "string" || !/^\d+(\.\d+)?$/.test(x.trim())) return null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}
const codigoDe = (e: unknown): string | null => (esObjeto(e) || e instanceof Error ? texto((e as { code?: unknown }).code) : null);
/** Una fecha que se puede leer, tal como vino; `null` si no se lee. */
const fecha = (x: unknown): string | null => (typeof x === "string" && Number.isFinite(Date.parse(x)) ? x : null);

/* ================================================================== las rutas */

/** La única ruta que la carga usa: QR en bolivianos desde Bolivia, hasta el USDC de Circle en Stellar. */
export interface RutaDeBolivia {
  fiat: { currency: "BOB"; rail: "QR"; country: "BO" };
  asset: { code: "USDC"; identifier: string; chain: "STELLAR" };
  /** Quien emite el USDC que deja la ruta, tal como lo dice la ruta (y tiene que ser el de Circle). */
  emisor: string;
}

const TRAMOS_DE_CARGA = new Set(["PROVIDER_ONRAMP", "SWAP", "BRIDGE"]);

function esBoliviaQr(f: unknown): boolean {
  return esObjeto(f) && f.currency === "BOB" && f.rail === "QR" && f.country === "BO";
}
function esUsdcDeCircleEnStellar(a: unknown): boolean {
  return esObjeto(a) && a.code === "USDC" && a.chain === "STELLAR" && a.identifier === EMISOR_USDC_CIRCLE;
}

/**
 * De la respuesta de `getRampRoutes("ONRAMP")`, la ruta de Bolivia a Stellar, o `null` si no está. Una ruta a Polygon o
 * a Solana, de otro país, otro medio de pago, otra moneda u otro emisor se ignora, y también una con tramos que no son
 * los de una carga (el del proveedor primero, después canje o puente).
 */
export function rutaDeBolivia(respuesta: unknown): RutaDeBolivia | null {
  const rutas = esObjeto(respuesta) && Array.isArray(respuesta.routes) ? respuesta.routes : [];
  for (const r of rutas) {
    if (!esObjeto(r) || !esBoliviaQr(r.fiat) || !esUsdcDeCircleEnStellar(r.asset)) continue;
    const tramos = Array.isArray(r.legs) ? r.legs : [];
    if (tramos[0] !== "PROVIDER_ONRAMP" || !tramos.every((t) => typeof t === "string" && TRAMOS_DE_CARGA.has(t))) continue;
    if (tramos.filter((t) => t === "PROVIDER_ONRAMP").length !== 1) continue;
    return {
      fiat: { currency: "BOB", rail: "QR", country: "BO" },
      asset: { code: "USDC", identifier: EMISOR_USDC_CIRCLE, chain: "STELLAR" },
      emisor: EMISOR_USDC_CIRCLE,
    };
  }
  return null;
}

/** El pedido de precio para pagar `bolivianos` Bs por esa ruta. Solo montos enteros y positivos (se eligen con botones). */
export function cuerpoDeCotizacion(ruta: RutaDeBolivia, bolivianos: number): RampQuoteRequest | null {
  if (!Number.isSafeInteger(bolivianos) || bolivianos <= 0) return null;
  return {
    direction: "ONRAMP",
    fiat: { currency: ruta.fiat.currency, rail: ruta.fiat.rail, country: ruta.fiat.country },
    asset: { code: ruta.asset.code, identifier: ruta.asset.identifier, chain: ruta.asset.chain },
    amount: { value: String(bolivianos), denomination: "in" },
  };
}

/* ================================================================== la cotización */

/** Un paso de verificación que pide la ruta antes de dar un precio. */
export interface PasoDeVerificacion {
  tipo: "KYC" | "FORM" | "REGISTRY_CHECK" | "PROVIDER_REGISTRATION";
  estado: "por-hacer" | "en-curso" | "vencido";
  /** El número de este paso entre todos (desde 1), o `null` si no se sabe. */
  numero: number | null;
  total: number | null;
  /** Con qué se abre el paso (`optionId` y `corridorId` del kit). */
  opcion: string;
  corredor: string;
}

/** Lo que falta antes de poder ver un precio, en el orden en que se hace. */
export type LoQueFalta =
  | { que: "verificacion"; paso: PasoDeVerificacion }
  | { que: "proteger-cuenta" }
  | { que: "linea"; emisor: string }
  | { que: "cuenta-de-paso"; red: "POLYGON" };

/** Un dato que pide la cotización para crear la orden (va en `payee` bajo su `key`). */
export type CampoDeCarga = RampField;

/** El precio de una carga, listo para mostrar. */
export interface PrecioDeCarga {
  quoteId: string;
  /** Hasta cuándo vale el precio, tal como lo dio el servidor; `null` si no se lee. */
  vence: string | null;
  /** Bolivianos que paga la persona. */
  pagas: number;
  /** Dólares digitales que le llegan, según la cotización. */
  recibis: number;
  /** Bolivianos por cada dólar digital, todo incluido. */
  tasa: number;
  minutos: number | null;
  /** Cuántas aprobaciones vienen después de pagar, o `null` si la cotización no lo dice. */
  aprobaciones: number | null;
  campos: CampoDeCarga[];
}

export type LecturaDeCotizacion =
  | { estado: "precio"; precio: PrecioDeCarga }
  | { estado: "falta"; falta: LoQueFalta[] }
  | { estado: "en-revision" }
  | { estado: "rechazada" }
  | { estado: "cambiar-monto" }
  | { estado: "sin-creditos" }
  | { estado: "sin-red" }
  | { estado: "no-se-puede" };

const NO_SE_PUEDE: LecturaDeCotizacion = { estado: "no-se-puede" };
const TIPOS_DE_CAMPO = new Set(["text", "email", "tel", "select"]);

/** Lo que dice una cotización: el precio, o qué falta para tenerlo. */
export function leerCotizacion(respuesta: unknown): LecturaDeCotizacion {
  if (!esObjeto(respuesta) || !Array.isArray(respuesta.quotes)) return NO_SE_PUEDE;
  for (const q of respuesta.quotes) {
    const precio = precioDe(q);
    if (precio) return { estado: "precio", precio };
  }
  return leerRechazos(respuesta.rejected);
}

/** Lo que dice una cotización que falló: sin ruta (con las rutas rechazadas), sin créditos, sin red o lo demás. */
export function leerErrorDeCotizacion(e: unknown): LecturaDeCotizacion {
  const motivo = motivoDelError(e);
  if (motivo === "sin-creditos" || motivo === "sin-red") return { estado: motivo };
  if (motivo === "proteger-cuenta") return { estado: "falta", falta: [{ que: "proteger-cuenta" }] };
  if (codigoDe(e) === "SDK_RAMPS_NO_ROUTE") {
    const cuerpo = (e as { body?: unknown }).body;
    return leerRechazos(esObjeto(cuerpo) ? cuerpo.rejected : undefined);
  }
  return NO_SE_PUEDE;
}

export type MotivoDelError = "sin-creditos" | "sin-red" | "proteger-cuenta" | "cuenta-de-paso-espera" | "precio-vencido" | "otro";

/**
 * El error de una llamada de la carga, en una palabra. Sin créditos es de Tinkazo, no de la persona: un `402` con una
 * orden abierta no es una falla de ella.
 */
export function motivoDelError(e: unknown): MotivoDelError {
  const codigo = codigoDe(e);
  if (codigo === "SDK_CREDITS_INSUFFICIENT" || codigo === "SDK_BILLING_OVERDUE") return "sin-creditos";
  if (codigo === "SDK_WALLET_RECOVERY_REQUIRED") return "proteger-cuenta";
  if (codigo === "SDK_RAMPS_WALLET_NOT_READY") return "cuenta-de-paso-espera";
  if (codigo === "SDK_RAMPS_QUOTE_EXPIRED") return "precio-vencido";
  if (e !== null && e !== undefined && esDeRed(e)) return "sin-red";
  return "otro";
}

/** El precio de una cotización, si de verdad paga bolivianos por QR y deja el USDC de Circle en Stellar. */
function precioDe(q: unknown): PrecioDeCarga | null {
  if (!esObjeto(q)) return null;
  const quoteId = texto(q.quoteId);
  const tramos = Array.isArray(q.legs) ? q.legs : [];
  if (!quoteId || tramos.length === 0 || !tramos.every(esObjeto)) return null;
  const primero = tramos[0] as Objeto;
  const ultimo = tramos[tramos.length - 1] as Objeto;
  if (primero.kind !== "PROVIDER_ONRAMP" || !esObjeto(primero.from) || primero.from.kind !== "fiat" || !esBoliviaQr(primero.from)) return null;
  if (!esObjeto(ultimo.to) || ultimo.to.kind !== "asset" || !esUsdcDeCircleEnStellar(ultimo.to)) return null;
  if (!tramos.every((t) => TRAMOS_DE_CARGA.has(t.kind as string)) || tramos.filter((t) => t.kind === "PROVIDER_ONRAMP").length !== 1) return null;
  const pagas = montoDecimal(q.amountIn);
  const recibis = montoDecimal(q.amountOut);
  if (pagas === null || recibis === null || pagas <= 0 || recibis <= 0) return null;
  const campos = camposDe(tramos as Objeto[]);
  if (!campos) return null;
  const eta = entero(q.etaSeconds);
  return {
    quoteId,
    vence: fecha(q.expiresAt),
    pagas,
    recibis,
    tasa: pagas / recibis,
    minutos: eta === null || eta < 0 ? null : Math.max(1, Math.round(eta / 60)),
    aprobaciones: aprobacionesDeLaCotizacion(tramos as Objeto[]),
    campos,
  };
}

/** Los datos que pide la cotización, una vez por clave. `null` si alguno es de un tipo que no sabemos pedir. */
function camposDe(tramos: Objeto[]): CampoDeCarga[] | null {
  const porClave = new Map<string, CampoDeCarga>();
  for (const t of tramos) {
    const lista = t.requiredFields === undefined ? [] : t.requiredFields;
    if (!Array.isArray(lista)) return null;
    for (const c of lista) {
      if (!esObjeto(c) || !texto(c.key) || typeof c.label !== "string" || !TIPOS_DE_CAMPO.has(c.type as string)) return null;
      if (!porClave.has(c.key as string)) porClave.set(c.key as string, c as unknown as CampoDeCarga);
    }
  }
  return [...porClave.values()];
}

/**
 * Cuántas aprobaciones pide la carga después de pagar: los pasos que firman de cada tramo que no es del proveedor. Solo
 * si cada uno de esos tramos trae su lista de pasos; si no, no se inventa un número.
 */
function aprobacionesDeLaCotizacion(tramos: Objeto[]): number | null {
  let n = 0;
  for (const t of tramos) {
    if (t.kind === "PROVIDER_ONRAMP") continue;
    if (!Array.isArray(t.steps)) return null;
    for (const p of t.steps) {
      if (!esObjeto(p) || typeof p.signs !== "boolean") return null;
      if (p.signs) n++;
    }
  }
  return n;
}

type Arreglo = { que: "verificacion"; paso: PasoDeVerificacion } | { que: "en-revision" } | { que: "rechazada" } | { que: "proteger-cuenta" } | { que: "linea"; emisor: string } | { que: "cuenta-de-paso"; red: "POLYGON" } | { que: "cambiar-monto" } | { que: "ninguno" };

const TIPOS_DE_VERIFICACION = new Set(["KYC", "FORM", "REGISTRY_CHECK", "PROVIDER_REGISTRATION"]);

/** Qué pide una ruta rechazada para poder seguir. */
function arregloDe(r: unknown): Arreglo {
  if (!esObjeto(r) || !esObjeto(r.failure)) return { que: "ninguno" };
  if (r.requirement !== undefined) return verificacionDe(r.requirement);
  const f = r.failure;
  switch (f.resolutionAction) {
    case "set_up_recovery":
      return { que: "proteger-cuenta" };
    case "set_up_wallet":
      return f.detail === "POLYGON" ? { que: "cuenta-de-paso", red: "POLYGON" } : { que: "ninguno" };
    case "add_trustline": {
      const tramos = Array.isArray(r.legs) ? r.legs.filter(esObjeto) : [];
      const tramo = tramos.find((t) => t.index === f.legIndex) ?? tramos[tramos.length - 1];
      return tramo && esObjeto(tramo.to) && esUsdcDeCircleEnStellar(tramo.to) ? { que: "linea", emisor: EMISOR_USDC_CIRCLE } : { que: "ninguno" };
    }
    case "change_amount":
      return { que: "cambiar-monto" };
    default:
      return { que: "ninguno" };
  }
}

/** Un paso de verificación tal como lo trae una ruta rechazada. Lo que no conocemos no se muestra. */
function verificacionDe(req: unknown): Arreglo {
  if (!esObjeto(req) || !TIPOS_DE_VERIFICACION.has(req.type as string)) return { que: "ninguno" };
  const tipo = req.type as PasoDeVerificacion["tipo"];
  const opcion = texto(req.optionId);
  const corredor = texto(req.corridorId);
  if (!opcion || !corredor) return { que: "ninguno" };
  let estado: PasoDeVerificacion["estado"];
  switch (req.status) {
    case "none":
      estado = "por-hacer";
      break;
    case "expired":
      estado = "vencido";
      break;
    case "rejected":
      return { que: "rechazada" };
    case "pending":
      // Una verificación de identidad con motivo de revisión, o la comprobación de datos mientras espera, la mira
      // alguien: la persona no tiene nada que hacer.
      if ((tipo === "KYC" && req.reviewReason !== undefined) || tipo === "REGISTRY_CHECK") return { que: "en-revision" };
      estado = "en-curso";
      break;
    default:
      return { que: "ninguno" };
  }
  const total = entero(req.total);
  const posicion = entero(req.position);
  const hechos = entero(req.completed);
  const valido = (n: number | null): n is number => n !== null && n >= 1 && (total === null || n <= total);
  const numero = valido(posicion) ? posicion : hechos !== null && valido(hechos + 1) ? hechos + 1 : null;
  return { que: "verificacion", paso: { tipo, estado, numero, total: total !== null && total >= 1 ? total : null, opcion, corredor } };
}

/**
 * Lo que dicen las rutas rechazadas, juntas: una verificación rechazada en cualquiera manda (la carga no está para esta
 * cuenta), después una en revisión, después la lista de lo que falta y, sin nada de eso, cambiar el monto.
 */
function leerRechazos(rechazadas: unknown): LecturaDeCotizacion {
  const arreglos = (Array.isArray(rechazadas) ? rechazadas : []).map(arregloDe);
  if (arreglos.some((a) => a.que === "rechazada")) return { estado: "rechazada" };
  if (arreglos.some((a) => a.que === "en-revision")) return { estado: "en-revision" };
  const falta: LoQueFalta[] = [];
  const verificaciones = arreglos.filter((a): a is Extract<Arreglo, { que: "verificacion" }> => a.que === "verificacion");
  const primera = verificaciones.sort((a, b) => (a.paso.numero ?? Infinity) - (b.paso.numero ?? Infinity))[0];
  if (primera) falta.push(primera);
  if (arreglos.some((a) => a.que === "proteger-cuenta")) falta.push({ que: "proteger-cuenta" });
  if (arreglos.some((a) => a.que === "linea")) falta.push({ que: "linea", emisor: EMISOR_USDC_CIRCLE });
  if (arreglos.some((a) => a.que === "cuenta-de-paso")) falta.push({ que: "cuenta-de-paso", red: "POLYGON" });
  if (falta.length) return { estado: "falta", falta };
  if (arreglos.some((a) => a.que === "cambiar-monto")) return { estado: "cambiar-monto" };
  return NO_SE_PUEDE;
}

/* ================================================================== la orden */

const ESTADOS_DE_ORDEN = new Set(["created", "awaiting_payment", "processing", "settling_onchain", "completed", "failed", "refunded"]);
const FINALES = new Set(["completed", "failed", "refunded"]);
/** Un tramo que dejó de andar. El kit los cuenta a los tres como fallados; acá un tramo retenido es otra cosa. */
const TRAMO_PARADO = new Set(["HELD", "FAILED", "CANCELLED"]);
const TIPOS_DE_PASO = new Set(["approve", "swap", "burn", "attestation", "mint"]);
const ESTADOS_DE_PASO = new Set(["pending", "awaiting_approval", "confirming", "done"]);
const DOS_MINUTOS = 2 * 60_000;
const MEDIA_HORA_S = 30 * 60;

/** Un paso de cadena de un tramo: el permiso, el canje, el envío, la confirmación de Circle o la llegada. */
export interface PasoDeTramo {
  tipo: "approve" | "swap" | "burn" | "attestation" | "mint";
  estado: "pending" | "awaiting_approval" | "confirming" | "done";
  /** Si lo aprueba la persona. */
  firma: boolean;
}

/** Un tramo de una orden de carga, leído. Los montos quedan como texto, tal como los da el servidor. */
export interface TramoDeOrden {
  indice: number;
  tipo: "PROVIDER_ONRAMP" | "SWAP" | "BRIDGE";
  /** Tal como vino: `COMPLETED`, `HELD`, `FAILED`, `CANCELLED`, `PENDING` u otro. */
  estado: string;
  desde: Objeto;
  hasta: Objeto;
  /** Lo que el tramo planea recibir (`amountInPlanned`). */
  entraPlaneado: string;
  /** Lo que registró de verdad al entrar (`amountInActual`): en el tramo de Stereum, el pago que vio. */
  entroDeVerdad: string | null;
  salioDeVerdad: string | null;
  /** Dónde están los fondos del tramo mientras espera. */
  fondos: { red: string; direccion: string } | null;
  pasos: PasoDeTramo[];
  etaSegundos: number | null;
  /** Cuándo empezó, en milisegundos. */
  empezo: number | null;
  modoDeFirma: string | null;
  falla: Objeto | null;
}

/** Una orden de carga leída: de Bolivia por QR, hasta el USDC de Circle en Stellar, y nada más. */
export interface OrdenDeCarga {
  id: string;
  estado: string;
  /** Cuándo la creó el servidor, en milisegundos; `null` si no se lee. */
  creada: number | null;
  tramos: TramoDeOrden[];
  accion: Objeto | null;
  falla: Objeto | null;
  /** `false` cuando el servidor dice que ya no la vuelve a mirar sola (`nextPollAfter: null`). */
  sigueSola: boolean;
}

const milisegundos = (x: unknown): number | null => (fecha(x) === null ? null : Date.parse(x as string));
const textoONulo = (x: unknown): string | null | undefined => (x === null ? null : typeof x === "string" ? x : undefined);

function pasoDe(x: unknown): PasoDeTramo | null {
  if (!esObjeto(x) || !TIPOS_DE_PASO.has(x.kind as string) || !ESTADOS_DE_PASO.has(x.status as string) || typeof x.signs !== "boolean") return null;
  return { tipo: x.kind as PasoDeTramo["tipo"], estado: x.status as PasoDeTramo["estado"], firma: x.signs };
}

function tramoDe(x: unknown): TramoDeOrden | null {
  if (!esObjeto(x) || !TRAMOS_DE_CARGA.has(x.kind as string)) return null;
  const indice = entero(x.index);
  const estado = texto(x.status);
  const entraPlaneado = texto(x.amountInPlanned);
  const entroDeVerdad = textoONulo(x.amountInActual);
  const salioDeVerdad = textoONulo(x.amountOutActual);
  if (indice === null || !estado || !esObjeto(x.from) || !esObjeto(x.to) || !entraPlaneado || entroDeVerdad === undefined || salioDeVerdad === undefined) return null;
  const pasosCrudos = x.steps === undefined ? [] : x.steps;
  if (!Array.isArray(pasosCrudos)) return null;
  const pasos: PasoDeTramo[] = [];
  for (const p of pasosCrudos) {
    const leido = pasoDe(p);
    if (!leido) return null;
    pasos.push(leido);
  }
  const f = x.fundsLocation;
  let fondos: TramoDeOrden["fondos"] = null;
  if (f !== null && f !== undefined) {
    if (!esObjeto(f) || !texto(f.chain) || typeof f.address !== "string") return null;
    fondos = { red: f.chain as string, direccion: f.address };
  }
  const eta = x.etaSeconds === null || x.etaSeconds === undefined ? null : entero(x.etaSeconds);
  return {
    indice,
    tipo: x.kind as TramoDeOrden["tipo"],
    estado,
    desde: x.from,
    hasta: x.to,
    entraPlaneado,
    entroDeVerdad,
    salioDeVerdad,
    fondos,
    pasos,
    etaSegundos: eta !== null && eta >= 0 ? eta : null,
    empezo: milisegundos(x.startedAt),
    modoDeFirma: texto(x.signingMode),
    falla: esObjeto(x.failure) ? x.failure : null,
  };
}

/**
 * Una orden de `getRampOrder`, `pollRampOrder` o `listRampOrders`, leída como una carga, o `null` si no lo es: tiene que
 * ser de cargar, empezar por el tramo de Stereum que cobra bolivianos por QR desde Bolivia, seguir con canjes y después
 * envíos, y terminar en el USDC de Circle en Stellar. Una orden con otra forma no se muestra como si se la conociera.
 */
export function leerOrden(x: unknown): OrdenDeCarga | null {
  if (!esObjeto(x) || x.direction !== "ONRAMP") return null;
  const id = texto(x.id);
  const estado = texto(x.state);
  if (!id || !estado || !Array.isArray(x.legs) || x.legs.length === 0) return null;
  const tramos: TramoDeOrden[] = [];
  for (const l of x.legs) {
    const t = tramoDe(l);
    if (!t) return null;
    tramos.push(t);
  }
  if (new Set(tramos.map((t) => t.indice)).size !== tramos.length) return null;
  const primero = tramos[0] as TramoDeOrden;
  const ultimo = tramos[tramos.length - 1] as TramoDeOrden;
  if (primero.tipo !== "PROVIDER_ONRAMP" || primero.desde.kind !== "fiat" || !esBoliviaQr(primero.desde)) return null;
  if (ultimo.hasta.kind !== "asset" || !esUsdcDeCircleEnStellar(ultimo.hasta)) return null;
  // Después de Stereum, los canjes y recién después los envíos.
  const resto = tramos.slice(1).map((t) => t.tipo);
  const primerEnvio = resto.indexOf("BRIDGE");
  if (resto.includes("PROVIDER_ONRAMP") || (primerEnvio >= 0 && resto.slice(primerEnvio).includes("SWAP"))) return null;
  const accion = x.pendingAction;
  if (accion !== null && accion !== undefined && !esObjeto(accion)) return null;
  return {
    id,
    estado,
    creada: milisegundos(x.createdAt),
    tramos,
    accion: esObjeto(accion) ? accion : null,
    falla: esObjeto(x.failure) ? x.failure : null,
    sigueSola: x.nextPollAfter !== null,
  };
}

/* ------------------------------------------------------------------ las marcas de este navegador */

/**
 * Lo que este navegador sabe de una orden, con la hora en que pasó por primera vez. Las marcas nunca hacen afirmar algo
 * más fuerte: sin ellas, la pantalla pregunta o usa la frase prudente.
 */
export interface MarcasDeOrden {
  /** Se dibujó el QR de esta orden. */
  mostroQr: number | null;
  /** Se tocó Guardar el QR. */
  guardoQr: number | null;
  /** La persona dijo que pagó (Ya pagué o Sí, ya pagué). */
  dijoPago: number | null;
}
export type Marca = keyof MarcasDeOrden;
export const SIN_MARCAS: MarcasDeOrden = Object.freeze({ mostroQr: null, guardoQr: null, dijoPago: null });

type Almacen = Pick<Storage, "getItem" | "setItem">;
const CLAVE_DE_MARCAS = "tinkazo.carga.marcas";
const CARGAS_CON_MARCAS = 20;
const MARCAS: readonly Marca[] = ["mostroQr", "guardoQr", "dijoPago"];

function almacenDelNavegador(): Almacen | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

const hora = (x: unknown): number | null => (typeof x === "number" && Number.isFinite(x) && x > 0 ? x : null);

function todasLasMarcas(almacen: Almacen | null): Record<string, MarcasDeOrden> {
  if (!almacen) return {};
  try {
    const crudo = almacen.getItem(CLAVE_DE_MARCAS);
    const v: unknown = crudo ? JSON.parse(crudo) : {};
    if (!esObjeto(v)) return {};
    const todas: Record<string, MarcasDeOrden> = {};
    for (const [id, m] of Object.entries(v)) {
      if (esObjeto(m)) todas[id] = { mostroQr: hora(m.mostroQr), guardoQr: hora(m.guardoQr), dijoPago: hora(m.dijoPago) };
    }
    return todas;
  } catch {
    return {};
  }
}

/** Las marcas de una orden en este navegador. Sin almacenamiento, o con uno que falla, ninguna. */
export function leerMarcas(ordenId: string, almacen: Almacen | null = almacenDelNavegador()): MarcasDeOrden {
  return todasLasMarcas(almacen)[ordenId] ?? SIN_MARCAS;
}

/**
 * Anota una marca (si ya estaba, queda la primera hora) y devuelve las marcas de la orden, sumando las que la pantalla ya
 * tiene en memoria: si el almacenamiento falla, siguen valiendo mientras la ventana esté abierta. Guarda las de las
 * últimas veinte cargas.
 */
export function anotarMarca(ordenId: string, marca: Marca, ahora: number, actuales: MarcasDeOrden = SIN_MARCAS, almacen: Almacen | null = almacenDelNavegador()): MarcasDeOrden {
  const todas = todasLasMarcas(almacen);
  const guardadas = todas[ordenId] ?? SIN_MARCAS;
  const juntas = {} as MarcasDeOrden;
  for (const m of MARCAS) juntas[m] = actuales[m] ?? guardadas[m];
  juntas[marca] = juntas[marca] ?? (hora(ahora) ?? null);
  if (!ordenId || !almacen) return juntas;
  todas[ordenId] = juntas;
  const ultima = (m: MarcasDeOrden) => Math.max(...MARCAS.map((k) => m[k] ?? 0));
  const quedan = Object.entries(todas)
    .sort(([, a], [, b]) => ultima(b) - ultima(a))
    .slice(0, CARGAS_CON_MARCAS);
  try {
    almacen.setItem(CLAVE_DE_MARCAS, JSON.stringify(Object.fromEntries(quedan)));
  } catch {
    // Sin lugar o sin permiso: las marcas quedan en memoria.
  }
  return juntas;
}

/**
 * Borra una marca de una orden: Todavía no pagué borra la de haber dicho que pagó, y nada más. Devuelve las marcas sin
 * ella, sumando las que la pantalla ya tiene en memoria. Si el almacenamiento falla, vale lo de memoria.
 */
export function quitarMarca(ordenId: string, marca: Marca, actuales: MarcasDeOrden = SIN_MARCAS, almacen: Almacen | null = almacenDelNavegador()): MarcasDeOrden {
  const todas = todasLasMarcas(almacen);
  const guardadas = todas[ordenId] ?? SIN_MARCAS;
  const juntas = {} as MarcasDeOrden;
  for (const m of MARCAS) juntas[m] = actuales[m] ?? guardadas[m];
  juntas[marca] = null;
  if (!ordenId || !almacen) return juntas;
  todas[ordenId] = juntas;
  try {
    almacen.setItem(CLAVE_DE_MARCAS, JSON.stringify(todas));
  } catch {
    // Sin lugar o sin permiso: las marcas quedan en memoria.
  }
  return juntas;
}

/* ------------------------------------------------------------------ el QR */

const TIPOS_DE_IMAGEN = new Set(["image/svg+xml", "image/png", "image/jpeg", "image/gif", "image/webp"]);

/**
 * La imagen del QR que dibujó el servidor, lista para un `<img>`, o `null` si no se puede usar. Siempre como imagen:
 * un SVG nunca se mete como marcado en la página.
 */
export function imagenDelQr(imagen: unknown): string | null {
  if (!esObjeto(imagen) || !TIPOS_DE_IMAGEN.has(imagen.mediaType as string) || typeof imagen.data !== "string") return null;
  const tipo = imagen.mediaType as string;
  if (imagen.encoding === "base64") {
    const datos = imagen.data.replace(/\s+/g, "");
    return datos !== "" && datos.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(datos) ? `data:${tipo};base64,${datos}` : null;
  }
  if (imagen.encoding === "utf8" && tipo === "image/svg+xml" && imagen.data.trim() !== "") return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(imagen.data)}`;
  return null;
}

/** Un enlace que se puede ofrecer: solo https y sin usuario ni clave adentro. */
function enlaceSeguro(x: unknown): string | null {
  if (typeof x !== "string") return null;
  try {
    const u = new URL(x);
    return u.protocol === "https:" && !u.username && !u.password ? u.href : null;
  } catch {
    return null;
  }
}

/** Lo que hace falta para pagar una orden. */
export interface QrParaPagar {
  /** Los bolivianos a pagar, tal como los dice la orden (`instructions.amount`), no el botón que se eligió. */
  bs: string;
  /** La imagen del QR para un `<img>`. */
  imagen: string;
  /** Abrir en la app del banco, si la orden lo trae. */
  enlace: string | null;
  /** Hasta cuándo vale el QR, en milisegundos. */
  vence: number | null;
}

/** El pago por QR en bolivianos que pide la orden, o `null` si es otro (transferencia, página del proveedor) o no se lee. */
function pagoDe(accion: Objeto): (Omit<QrParaPagar, "imagen"> & { imagen: string | null }) | null {
  const i = accion.instructions;
  if (!esObjeto(i) || i.kind !== "qr" || i.currency !== "BOB") return null;
  const monto = montoDecimal(i.amount);
  if (monto === null || monto <= 0) return null;
  return {
    bs: (i.amount as string).trim(),
    imagen: esObjeto(i.scannable) ? imagenDelQr(i.scannable.image) : null,
    enlace: enlaceSeguro(i.link),
    vence: milisegundos(accion.expiresAt),
  };
}

/* ------------------------------------------------------------------ dónde está tu dinero */

/** Lo que va en «Dónde está tu dinero ahora», o la frase entera de una carga que se cerró sin llegar. */
export type DondeEstaTuDinero =
  | { donde: "dondeBanco" | "dondeSaliendo" | "dondeStereum" | "dondePaso" | "dondeViaje" | "dondeCuenta" | "dondeRevision" }
  | { cierre: "cargaFalloSinPago" | "cargaFalloSinVerPago" | "cargaDevueltaSinMonto" };

/** Lo que la pantalla sabe y la orden no dice. */
export interface VistaDeOrden {
  /** En esta ventana el QR ya está a la vista, o la persona contestó Todavía no, mostrame el QR. */
  qrALaVista?: boolean;
  /** Esta pestaña vio la orden fallar al crearla, antes de dibujar el QR. */
  falloAlCrear?: boolean;
  /** En esta ventana ya se vio el aviso de antes de la primera aprobación. */
  vioAntesDeAprobar?: boolean;
  /** En esta ventana se tocó Abrir en la app de mi banco: no hace falta guardar la imagen para decir Ya pagué. */
  abrioBanco?: boolean;
  /** Una llamada con la carga abierta volvió sin créditos: falta algo de Tinkazo. */
  sinCreditos?: boolean;
  /** La cuenta de Stellar de la persona: sin ella, nunca se dice que el dinero está en su cuenta antes de que llegue. */
  cuenta?: string;
}

const sinMarcas = (m: MarcasDeOrden) => m.mostroQr === null && m.guardoQr === null && m.dijoPago === null;
const quemado = (t: TramoDeOrden) => t.pasos.some((p) => p.tipo === "burn" && p.estado === "done");
/** El dinero de este tramo está en Polygon, en la cuenta de paso: lo dice el tramo o, sin ese dato, el tramo sale de ahí. */
const enLaCuentaDePaso = (t: TramoDeOrden) =>
  (t.tipo === "SWAP" || (t.tipo === "BRIDGE" && !quemado(t))) && (t.fondos ? t.fondos.red === "POLYGON" : t.desde.kind === "asset" && t.desde.chain === "POLYGON");

/** Dónde quedó el dinero de un tramo frenado o que no terminó: la cuenta de paso, la cuenta de la persona, o lo revisa Pollar. */
function dondeQuedo(t: TramoDeOrden | undefined, vista: VistaDeOrden): DondeEstaTuDinero {
  if (t?.fondos?.red === "POLYGON" && enLaCuentaDePaso(t)) return { donde: "dondePaso" };
  if (t?.fondos?.red === "STELLAR" && vista.cuenta && t.fondos.direccion === vista.cuenta) return { donde: "dondeCuenta" };
  return { donde: "dondeRevision" };
}

/**
 * Dónde está el dinero de la persona ahora. Nunca afirma lo que no sabe: antes de ver el pago dice «si todavía no
 * pagaste, en tu banco» (jamás que no pagó), la cuenta de paso va sin número, y lo que no se reconoce lo revisa Pollar.
 */
export function dondeEstaTuDinero(orden: unknown, marcas: MarcasDeOrden, _ahora: number, vista: VistaDeOrden = {}): DondeEstaTuDinero {
  const o = leerOrden(orden);
  if (!o) return { donde: "dondeRevision" };
  if (o.estado === "completed") return { donde: "dondeCuenta" };
  if (o.estado === "refunded") return { cierre: "cargaDevueltaSinMonto" };
  if (o.estado === "failed") {
    // Si el pago se vio, el dinero está donde quedó el tramo que no terminó: nunca en el banco ni la frase de no verlo.
    if (pagoVisto(o)) return dondeQuedo(o.tramos.find((t) => t.estado !== "COMPLETED"), vista);
    return vista.falloAlCrear && sinMarcas(marcas) ? { cierre: "cargaFalloSinPago" } : { cierre: "cargaFalloSinVerPago" };
  }
  const antesDelPago = { donde: marcas.dijoPago !== null ? "dondeSaliendo" : "dondeBanco" } as const;
  const frenado = o.tramos.find((t) => t.estado === "HELD");
  if (frenado) return dondeQuedo(frenado, vista);
  if (o.accion?.kind === "FIAT_PAYMENT") return antesDelPago;
  const actual = o.tramos.find((t) => t.estado !== "COMPLETED");
  if (!actual) return { donde: "dondeViaje" };
  if (TRAMO_PARADO.has(actual.estado)) return { donde: "dondeRevision" };
  if (actual.tipo === "PROVIDER_ONRAMP") return o.estado === "created" || o.estado === "awaiting_payment" ? antesDelPago : { donde: "dondeStereum" };
  if (actual.tipo === "BRIDGE" && quemado(actual)) return { donde: "dondeViaje" };
  return enLaCuentaDePaso(actual) ? { donde: "dondePaso" } : { donde: "dondeRevision" };
}

/* ------------------------------------------------------------------ las aprobaciones */

/** Qué se aprueba en un paso, según el tramo: el permiso del canje, el canje, el permiso del envío o el envío. */
export type QueSeAprueba = "permiso-cambio" | "cambio" | "permiso-envio" | "envio";

/** El paso del tramo que espera la aprobación de la persona: uno solo, que firma. Si no, `null`. */
export function pasoQueEspera(t: TramoDeOrden): PasoDeTramo | null {
  const enEspera = t.pasos.filter((p) => p.estado === "awaiting_approval");
  return enEspera.length === 1 && (enEspera[0] as PasoDeTramo).firma ? (enEspera[0] as PasoDeTramo) : null;
}

/** Qué se aprueba en ese tramo, o `null` si el paso no es uno de los que conocemos para ese tipo de tramo. */
export function queSeAprueba(t: TramoDeOrden): QueSeAprueba | null {
  const p = pasoQueEspera(t);
  if (!p) return null;
  if (p.tipo === "approve" && (t.tipo === "SWAP" || t.tipo === "BRIDGE")) return t.tipo === "SWAP" ? "permiso-cambio" : "permiso-envio";
  if (p.tipo === "swap" && t.tipo === "SWAP") return "cambio";
  if (p.tipo === "burn" && t.tipo === "BRIDGE") return "envio";
  return null;
}

function contarAprobaciones(o: OrdenDeCarga): number {
  let n = 0;
  for (const t of o.tramos) {
    if (t.estado === "COMPLETED" || TRAMO_PARADO.has(t.estado)) continue;
    if (t.pasos.length) {
      n += t.pasos.filter((p) => p.firma && (p.estado === "pending" || p.estado === "awaiting_approval")).length;
      continue;
    }
    // Un tramo sin pasos que no es de Stereum y tiene un modo de firma también pide una. Ante la duda, cuenta: es
    // mejor decir que hay que volver que decir que sigue sola.
    if (t.tipo !== "PROVIDER_ONRAMP" && t.modoDeFirma) n += 1;
  }
  return n;
}

/**
 * Cuántas aprobaciones de la persona faltan, contando la que espera ahora: los pasos que firman y no terminaron, en los
 * tramos que no terminaron ni se frenaron, como los recorre `rampNextApproval` del kit. `null` si la orden no se lee.
 */
export function aprobacionesQueFaltan(orden: unknown): number | null {
  const o = leerOrden(orden);
  return o ? contarAprobaciones(o) : null;
}

/* ------------------------------------------------------------------ las etapas y el tiempo */

export type PalabraDeEtapa = "listo" | "ahora" | "despues" | "frenada" | "no-salio";

/**
 * La palabra de una etapa según los estados de sus tramos. No sale de `rampLegStatus` del kit, que cuenta un tramo
 * retenido como fallado: retenido es Frenada; fallado o cancelado, No se pudo; todo terminado, Listo; si no, Ahora para
 * la etapa en curso y Después para las que siguen.
 */
export function palabraDeEtapa(estados: readonly string[], enCurso: boolean): PalabraDeEtapa {
  if (estados.includes("HELD")) return "frenada";
  if (estados.some((e) => e === "FAILED" || e === "CANCELLED")) return "no-salio";
  if (estados.length > 0 && estados.every((e) => e === "COMPLETED")) return "listo";
  return enCurso ? "ahora" : "despues";
}

const empezado = (t: TramoDeOrden) => t.estado === "COMPLETED" || t.empezo !== null || t.pasos.some((p) => p.estado !== "pending");

/** El pago de la persona ya se vio: Stereum registró lo que entró, terminó su tramo, o ya empezó un tramo de después. */
function pagoVisto(o: OrdenDeCarga): boolean {
  const stereum = o.tramos[0] as TramoDeOrden;
  return stereum.entroDeVerdad !== null || stereum.estado === "COMPLETED" || o.tramos.slice(1).some(empezado);
}

/**
 * Las tres etapas de la carga con su palabra: llega tu pago, se pasa a dólares digitales (Stereum y el canje) y llega a
 * tu cuenta (el envío). `null` si la orden no se lee.
 */
export function etapasDeCarga(orden: unknown): readonly [PalabraDeEtapa, PalabraDeEtapa, PalabraDeEtapa] | null {
  const o = leerOrden(orden);
  if (!o) return null;
  if (o.estado === "completed") return ["listo", "listo", "listo"];
  const stereum = o.tramos[0] as TramoDeOrden;
  const canjes = o.tramos.filter((t) => t.tipo === "SWAP");
  const envios = o.tramos.filter((t) => t.tipo === "BRIDGE");
  const pago: PalabraDeEtapa = pagoVisto(o) ? "listo" : TRAMO_PARADO.has(stereum.estado) ? palabraDeEtapa([stereum.estado], true) : "ahora";
  const cambio: PalabraDeEtapa = pago !== "listo" ? "despues" : palabraDeEtapa([stereum, ...canjes].map((t) => t.estado), true);
  const llegada: PalabraDeEtapa = cambio !== "listo" ? "despues" : envios.length ? palabraDeEtapa(envios.map((t) => t.estado), true) : "ahora";
  return [pago, cambio, llegada];
}

/**
 * Cuánto falta: lo que le queda al tramo en curso más lo que tardan los que siguen, en minutos. Pasado el doble de lo
 * que dice el tramo, o media hora, tarda más de lo normal (como `rampLegTimeLeft`). Sin un dato, no se inventa un número.
 */
export function tiempoQueFalta(orden: unknown, ahora: number): { minutos: number } | { tardaMas: true } | null {
  const o = leerOrden(orden);
  if (!o || FINALES.has(o.estado)) return null;
  const i = o.tramos.findIndex((t) => t.estado !== "COMPLETED");
  const actual = o.tramos[i];
  if (!actual || TRAMO_PARADO.has(actual.estado) || actual.empezo === null) return null;
  const pasado = Math.max(0, (ahora - actual.empezo) / 1000);
  if (pasado > MEDIA_HORA_S || (actual.etaSegundos !== null && pasado > 2 * actual.etaSegundos)) return { tardaMas: true };
  if (actual.etaSegundos === null) return null;
  let resto = Math.max(0, actual.etaSegundos - pasado);
  for (const t of o.tramos.slice(i + 1)) {
    if (t.etaSegundos === null) return null;
    resto += t.etaSegundos;
  }
  return { minutos: Math.max(1, Math.ceil(resto / 60)) };
}

/* ------------------------------------------------------------------ qué pantalla toca */

/** El paso que la persona aprueba con un toque: en qué tramo, qué es y qué pedido de aprobación lo lleva. */
export interface PasoParaAprobar {
  tramo: number;
  que: QueSeAprueba;
  pedido: string;
}

/** La pantalla de la carga que corresponde a la orden. */
export type PantallaDeCarga =
  | { pantalla: "pagar"; qr: QrParaPagar }
  | { pantalla: "qr-falta" }
  | { pantalla: "ya-pagaste" }
  | { pantalla: "esperando-pago"; tarda: boolean }
  | { pantalla: "qr-vencido-abierta" }
  | { pantalla: "qr-vencido-cerrada" }
  | { pantalla: "en-camino"; faltan: number }
  | { pantalla: "antes-de-aprobar"; pasos: number }
  | { pantalla: "aprobar"; paso: PasoParaAprobar; despues: number }
  | { pantalla: "llego"; dolares: number | null }
  | { pantalla: "frenada"; quien: "vos" | "pollar" | "tinkazo" }
  | { pantalla: "proteger-cuenta" }
  | { pantalla: "no-se-pudo" }
  | { pantalla: "desconocido" };

const DESCONOCIDO: PantallaDeCarga = { pantalla: "desconocido" };
const NO_SE_PUDO: PantallaDeCarga = { pantalla: "no-se-pudo" };

/** Quién destraba una carga frenada, según su falla. Lo que es de la persona y no se reintenta desde acá, no se adivina. */
function frenadaPor(falla: Objeto | null): PantallaDeCarga {
  if (!falla) return { pantalla: "frenada", quien: "pollar" };
  if (falla.resolutionAction === "set_up_recovery") return { pantalla: "proteger-cuenta" };
  if (falla.resolutionAction === "fund_gas_wallet" || falla.resolutionAction === "enable_signing_mode") return { pantalla: "frenada", quien: "tinkazo" };
  if (falla.resolutionOwner === "END_USER") return falla.retryable === true ? { pantalla: "frenada", quien: "vos" } : DESCONOCIDO;
  return { pantalla: "frenada", quien: "pollar" };
}

const esperandoPago = (marcas: MarcasDeOrden, ahora: number): PantallaDeCarga => ({
  pantalla: "esperando-pago",
  tarda: ahora - (marcas.dijoPago as number) >= DOS_MINUTOS,
});

function pantallaDePago(o: OrdenDeCarga, accion: Objeto, marcas: MarcasDeOrden, ahora: number, vista: VistaDeOrden): PantallaDeCarga {
  const pago = pagoDe(accion);
  if (!pago) return DESCONOCIDO;
  // Dijo que pagó: el QR no vuelve, ni vencido ni a la vista.
  if (marcas.dijoPago !== null) return esperandoPago(marcas, ahora);
  // Vencido con la carga abierta: la orden vieja todavía puede recibir el pago, así que no hay QR nuevo.
  if (pago.vence !== null && pago.vence <= ahora) return { pantalla: "qr-vencido-abierta" };
  // Si el QR ya se vio, se guardó, o la orden no es de recién (otro aparato, la pestaña recargada), primero se pregunta.
  const preguntar = marcas.mostroQr !== null || marcas.guardoQr !== null || o.creada === null || ahora - o.creada >= DOS_MINUTOS;
  if (preguntar && !vista.qrALaVista) return { pantalla: "ya-pagaste" };
  if (!pago.imagen) return { pantalla: "qr-falta" };
  return { pantalla: "pagar", qr: { ...pago, imagen: pago.imagen } };
}

function pantallaDeAprobar(o: OrdenDeCarga, accion: Objeto, vista: VistaDeOrden): PantallaDeCarga {
  const pedido = texto(accion.cosignRequestId);
  const t = o.tramos.find((x) => x.indice === accion.legIndex);
  if (!pedido || !t || (t.tipo !== "SWAP" && t.tipo !== "BRIDGE")) return DESCONOCIDO;
  const que = queSeAprueba(t);
  if (!que) return DESCONOCIDO;
  const faltan = contarAprobaciones(o);
  const primera = !o.tramos.some((x) => x.pasos.some((p) => p.firma && (p.estado === "done" || p.estado === "confirming")));
  if (primera && !vista.vioAntesDeAprobar) return { pantalla: "antes-de-aprobar", pasos: Math.max(1, faltan) };
  return { pantalla: "aprobar", paso: { tramo: t.indice, que, pedido }, despues: Math.max(0, faltan - 1) };
}

/**
 * Qué pantalla toca para esta orden. Nunca aprueba nada: la de aprobar pide el toque. Con marcas o con la orden de más de
 * dos minutos, antes del QR se pregunta si ya pagó; con Ya pagué, el QR no vuelve. Un estado, un tipo de tramo, un paso
 * o una acción que no reconoce (una firma propia, una transferencia de banco, la página del proveedor, una verificación
 * dentro de la orden) va a la pantalla del paso desconocido, que no hace nada y dice dónde está el dinero.
 */
export function pasoDeOrden(orden: unknown, marcas: MarcasDeOrden, ahora: number, vista: VistaDeOrden = {}): PantallaDeCarga {
  const o = leerOrden(orden);
  if (!o || !ESTADOS_DE_ORDEN.has(o.estado)) return DESCONOCIDO;
  const accion = o.accion;
  if (o.estado === "completed") {
    const ultimo = o.tramos[o.tramos.length - 1] as TramoDeOrden;
    return { pantalla: "llego", dolares: montoDecimal(ultimo.salioDeVerdad) };
  }
  if (o.estado === "refunded") return NO_SE_PUDO;
  if (o.estado === "failed") {
    // El QR venció y la carga se cerró: un QR nuevo solo después de preguntar, nunca a quien dijo que pagó y nunca si el
    // pago se vio.
    const pago = accion?.kind === "FIAT_PAYMENT" ? pagoDe(accion) : null;
    if (pago && pago.vence !== null && pago.vence <= ahora && marcas.dijoPago === null && !pagoVisto(o)) return vista.qrALaVista ? { pantalla: "qr-vencido-cerrada" } : { pantalla: "ya-pagaste" };
    return NO_SE_PUDO;
  }
  if (vista.sinCreditos) return { pantalla: "frenada", quien: "tinkazo" };
  const frenado = o.tramos.find((t) => t.estado === "HELD");
  if (frenado) return frenadaPor(o.falla ?? frenado.falla);
  if (accion?.kind === "FIAT_PAYMENT") return pantallaDePago(o, accion, marcas, ahora, vista);
  if (accion?.kind === "COSIGN_APPROVAL") return pantallaDeAprobar(o, accion, vista);
  if (accion !== null && accion.kind !== "NONE") return DESCONOCIDO;
  // Nada que hacer de este lado. Esperando el pago sin un QR, no hay nada que pagar.
  if (o.estado === "created" || o.estado === "awaiting_payment") return marcas.dijoPago !== null ? esperandoPago(marcas, ahora) : { pantalla: "qr-falta" };
  if (!o.sigueSola) return frenadaPor(o.falla);
  if (o.tramos.some((t) => TRAMO_PARADO.has(t.estado))) return DESCONOCIDO;
  return { pantalla: "en-camino", faltan: contarAprobaciones(o) };
}

/* ------------------------------------------------------------------ el número y las cargas abiertas */

/** El número de carga que ve la persona: los últimos 8 caracteres de la orden, en mayúsculas. */
export function numeroDeCarga(ordenId: string): string {
  return ordenId.slice(-8).toUpperCase();
}

export type CargasAbiertas = { estado: "ninguna" } | { estado: "abierta"; id: string } | { estado: "no-se-sabe" };

/**
 * De una página de `listRampOrders`, la carga que todavía no terminó (también con un estado nuevo), para seguirla y no
 * ofrecer otra. Lo que no se lee no dice que no hay ninguna.
 */
export function cargaAbierta(pagina: unknown): CargasAbiertas {
  if (!esObjeto(pagina) || !Array.isArray(pagina.orders)) return { estado: "no-se-sabe" };
  let leida = true;
  for (const o of pagina.orders) {
    const id = esObjeto(o) ? texto(o.id) : null;
    const estado = esObjeto(o) ? texto(o.state) : null;
    if (!id || !estado) {
      leida = false;
      continue;
    }
    if (!FINALES.has(estado)) return { estado: "abierta", id };
  }
  return leida ? { estado: "ninguna" } : { estado: "no-se-sabe" };
}

/**
 * De una página de `listRampOrders` con las cargas cerradas, la última que no terminó bien (fallida o devuelta), creada
 * desde `desde` (en milisegundos), para mostrar su final con el número antes de un precio nuevo. Si la última cerrada
 * terminó bien, ninguna. Lo que no se lee como carga no cuenta. Solo lee.
 */
export function cargaCerradaSinTerminar(pagina: unknown, desde: number): { id: string; orden: unknown } | null {
  if (!esObjeto(pagina) || !Array.isArray(pagina.orders)) return null;
  let ultima: { o: OrdenDeCarga; cruda: unknown } | null = null;
  for (const cruda of pagina.orders) {
    const o = leerOrden(cruda);
    if (!o || !FINALES.has(o.estado) || o.creada === null || o.creada < desde) continue;
    if (!ultima || o.creada > (ultima.o.creada as number)) ultima = { o, cruda };
  }
  return ultima && ultima.o.estado !== "completed" ? { id: ultima.o.id, orden: ultima.cruda } : null;
}
