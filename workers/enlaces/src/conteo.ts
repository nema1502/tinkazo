/**
 * El contador anónimo del embudo: la lista cerrada de lo que se cuenta.
 *
 * Lo comparten el Worker, que valida cada conteo con esto antes de sumarlo, y
 * el sitio (`src/contar.ts`), que toma de acá los tipos: un evento, una
 * propiedad o un valor que no está en la lista no compila. Es la tabla de §4.5
 * y §4.8 de la arquitectura de métricas del proyecto,
 * con los agregados del onboarding que aceptó §4.9 el 22 de octubre de 2026.
 *
 * Las reglas (§4.1): nada de nombres, listas, huellas de listas, direcciones de
 * cuenta, IP, cookies, identificadores de equipo o de sesión, ni la hora. El
 * Worker guarda el día (UTC) y cuántas veces. La única referencia que se acepta
 * es la de un sorteo de un contrato oficial (red, contrato y número), que es
 * pública en la cadena, y solo al compartir, abrir o verificar.
 *
 * No importa nada de Cloudflare: sus pruebas corren en Node (`conteo.test.ts`).
 */
import deployments from "../../../src/stellar/deployments.json";

/** Las redes del contrato. Las de testnet se guardan igual y no van al tablero público. */
export const REDES = ["mainnet", "testnet"] as const;

/**
 * Por qué falló un sello o un sorteo: las claves de `errorKey`
 * (`src/stellar/errores.ts`). Una prueba compara esta lista con `errores.ts`.
 */
export const ERRORES = [
  "unconfirmed",
  "notFound",
  "alreadyDrawn",
  "tooFewEntries",
  "badWinnerCount",
  "roundTooSoon",
  "roundTooFar",
  "roundNotReady",
  "invalidSignature",
  "metaTooLong",
  "accountNotReady",
  "busy",
  "noFunds",
  "userRejected",
  "wallet",
  "rpcDown",
  "offline",
  "unknown",
] as const;

/** El tamaño de una lista, en tramos: nunca la cantidad exacta. */
export const TAMANOS = ["2-9", "10-49", "50-199", "200+"] as const;

/**
 * Lo que puede llevar un evento:
 * - `p`: las propiedades que van siempre, con sus valores posibles;
 * - `o`: las que pueden faltar;
 * - `ref`: si lleva la referencia pública del sorteo (`no`, `opcional` o `siempre`).
 */
interface Regla {
  readonly p: Readonly<Record<string, readonly string[]>>;
  readonly o: Readonly<Record<string, readonly string[]>>;
  readonly ref: "no" | "opcional" | "siempre";
}

export const EVENTOS = {
  /** Pide ayuda: se abre "¿Cómo se usa?" en el paso `step`; `from`: la oferta de la primera visita, el botón, el menú o el final del ensayo o de la demo. */
  tutorial_open: { p: { step: ["1", "2", "3", "4"] }, o: { from: ["offer", "button", "menu", "end"] }, ref: "no" },
  /** Prueba: el ensayo (`practice`) o la demo (`demo`) llegaron al ganador. Con `tutorial_open`, lo único que sale de la práctica. */
  practice_done: { p: { kind: ["practice", "demo"] }, o: {}, ref: "no" },
  /** Conecta: la primera cuenta conectada de la pestaña, por la vía. Retomar una sesión no cuenta. */
  account_connected: { p: { kind: ["google", "email", "freighter", "test"] }, o: {}, ref: "no" },
  /** Prepara: la primera lista de dos o más de la pestaña: pegada, escrita a mano, de un archivo o de Luma. */
  list_ready: { p: { source: ["paste", "typed", "csv", "luma"], size: TAMANOS }, o: {}, ref: "no" },
  /** Muestra: "Mostrar la lista a la sala". */
  list_shown: { p: {}, o: {}, ref: "no" },
  /** Sella: se pidió sellar con cuenta, se confirmó o falló. La verdad del sello es la cadena (`sealed`). */
  seal_sent: { p: { network: REDES }, o: {}, ref: "no" },
  seal_confirmed: { p: { network: REDES }, o: {}, ref: "no" },
  seal_failed: { p: { network: REDES, error: ERRORES }, o: {}, ref: "no" },
  /** Sortea: el sorteo anclado quedó grabado o no se pudo grabar. La verdad es la cadena (`drawn`). */
  draw_confirmed: { p: { network: REDES }, o: {}, ref: "no" },
  draw_failed: { p: { network: REDES, error: ERRORES }, o: {}, ref: "no" },
  /** Comparte: se copia o se comparte el mensaje, se avisa al ganador, se muestra el QR en grande o se comparte un evento (sin referencia). */
  share: { p: { channel: ["copy", "native", "whatsapp", "email", "qr_big", "event"] }, o: {}, ref: "opcional" },
  /** Abre un comprobante (con su referencia) o un enlace de evento (sin ella): por el enlace largo, el corto o el QR. */
  proof_open: { p: { via: ["long", "short", "qr"] }, o: {}, ref: "opcional" },
  /** Verifica: cómo terminó la verificación de un sorteo anclado. */
  proof_verdict: { p: { verdict: ["green", "yellow", "red", "error"] }, o: {}, ref: "siempre" },
} as const satisfies Readonly<Record<string, Regla>>;

type Spec = typeof EVENTOS;
export type Evento = keyof Spec;
export type Red = (typeof REDES)[number];
export type ClaveDeError = (typeof ERRORES)[number];
export type Tamano = (typeof TAMANOS)[number];
type ValoresDe<M> = { -readonly [K in keyof M]: M[K] extends readonly (infer V)[] ? V : never };
/** Las propiedades de un evento, con sus valores de la lista cerrada. */
export type PropsDe<E extends Evento> = ValoresDe<Spec[E]["p"]> & Partial<ValoresDe<Spec[E]["o"]>>;

/** La referencia pública de un sorteo sellado: ya está en la cadena. */
export interface Ref {
  net: Red;
  contract: string;
  id: string;
}

/** El contrato vigente de una red en `src/stellar/deployments.json`, si hay. */
function contratosDe(red: Red): string[] {
  const d: unknown = (deployments as Record<string, unknown>)[red];
  const id = d && typeof d === "object" ? (d as { contractId?: unknown }).contractId : undefined;
  return typeof id === "string" && id ? [id] : [];
}

/**
 * Los contratos oficiales de cada red: los de `src/stellar/deployments.json`
 * (§4.8). Un sorteo de otro contrato no se cuenta. Cuando cambia ese archivo
 * (el despliegue en mainnet), el Worker se vuelve a desplegar.
 */
export const OFICIALES: Readonly<Record<Red, readonly string[]>> = {
  mainnet: contratosDe("mainnet"),
  testnet: contratosDe("testnet"),
};

/** Si la referencia es de un contrato oficial de su red. */
export function contratoOficial(ref: Pick<Ref, "net" | "contract">, oficiales: Readonly<Record<Red, readonly string[]>> = OFICIALES): boolean {
  return oficiales[ref.net].includes(ref.contract);
}

/** Lo más que puede medir un conteo, en bytes. */
export const MAX_CUERPO = 512;

const ES_CONTRATO = /^C[A-Z2-7]{55}$/;
const ES_NUMERO = /^[1-9][0-9]{0,19}$/;
const U64_MAX = 18_446_744_073_709_551_615n;

export interface ConteoValido {
  e: Evento;
  p: Record<string, string>;
  ref: Ref | null;
}

export type Validacion = { ok: true; conteo: ConteoValido } | { ok: false; motivo: string };

function esObjeto(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

const no = (motivo: string): Validacion => ({ ok: false, motivo });

/**
 * La referencia de un sorteo, si tiene exactamente red, contrato y número bien
 * formados, y el contrato es uno de los oficiales de esa red.
 */
export function validarRef(x: unknown, oficiales: Readonly<Record<Red, readonly string[]>> = OFICIALES): Ref | null {
  if (!esObjeto(x) || Object.keys(x).length !== 3) return null;
  const { net, contract, id } = x;
  if (typeof net !== "string" || !(REDES as readonly string[]).includes(net)) return null;
  if (typeof contract !== "string" || !ES_CONTRATO.test(contract)) return null;
  if (typeof id !== "string" || !ES_NUMERO.test(id) || BigInt(id) > U64_MAX) return null;
  const ref: Ref = { net: net as Red, contract, id };
  return contratoOficial(ref, oficiales) ? ref : null;
}

/**
 * Valida un conteo ya leído como JSON: `{ e, p?, ref? }`. Rechaza cualquier
 * campo, evento, propiedad o valor que no esté en la lista cerrada, una
 * propiedad que falta, y una referencia donde no va, mal formada o de un
 * contrato que no es oficial.
 */
export function validarConteo(x: unknown, oficiales: Readonly<Record<Red, readonly string[]>> = OFICIALES): Validacion {
  if (!esObjeto(x)) return no("cuerpo");
  for (const k of Object.keys(x)) if (k !== "e" && k !== "p" && k !== "ref") return no("campo");
  const e = x.e;
  if (typeof e !== "string" || !Object.hasOwn(EVENTOS, e)) return no("evento");
  const regla: Regla = EVENTOS[e as Evento];
  const crudo = x.p === undefined ? {} : x.p;
  if (!esObjeto(crudo)) return no("props");
  const p: Record<string, string> = {};
  for (const [k, v] of Object.entries(crudo)) {
    const valores = Object.hasOwn(regla.p, k) ? regla.p[k] : Object.hasOwn(regla.o, k) ? regla.o[k] : undefined;
    if (!valores) return no("prop");
    if (typeof v !== "string" || !valores.includes(v)) return no("valor");
    p[k] = v;
  }
  for (const k of Object.keys(regla.p)) if (!Object.hasOwn(p, k)) return no("falta");
  let ref: Ref | null = null;
  if (x.ref !== undefined) {
    if (regla.ref === "no") return no("ref");
    ref = validarRef(x.ref, oficiales);
    if (!ref) return no("ref");
  } else if (regla.ref === "siempre") return no("ref");
  return { ok: true, conteo: { e: e as Evento, p, ref } };
}

/** Las propiedades como se guardan: JSON con las claves en orden, `{}` si no hay. */
export function claveDeProps(p: Readonly<Record<string, string>>): string {
  return JSON.stringify(Object.fromEntries(Object.entries(p).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))));
}

/** La referencia como se guarda: `red:contrato:número`, o vacía. */
export function claveDeRef(ref: Ref | null): string {
  return ref ? `${ref.net}:${ref.contract}:${ref.id}` : "";
}

/** Una fila de lo publicado: cuántas veces pasó un evento con esas propiedades (y ese sorteo) ese día. */
export interface Fila {
  dia: string;
  e: Evento;
  p: Record<string, string>;
  ref?: Ref;
  n: number;
}

/**
 * Arma la fila publicada a partir de lo guardado, que el Worker escribió ya
 * validado. La referencia vuelve tal cual se guardó, aunque el contrato ya no
 * sea el vigente: lo contado no se reescribe.
 */
export function filaDe(r: { dia: string; e: string; p: string; ref: string; n: number }): Fila {
  let p: Record<string, string> = {};
  try {
    const leido: unknown = JSON.parse(r.p);
    if (esObjeto(leido)) p = Object.fromEntries(Object.entries(leido).filter((x): x is [string, string] => typeof x[1] === "string"));
  } catch {
    /* no pasa: se guardó con `claveDeProps` */
  }
  const [net = "", contract = "", id = ""] = r.ref ? r.ref.split(":") : [];
  const ref: Ref | null = r.ref && (net === "mainnet" || net === "testnet") ? { net, contract, id } : null;
  return { dia: r.dia, e: r.e as Evento, p, ...(ref ? { ref } : {}), n: r.n };
}

/** El tramo de tamaño de una lista de `n` entradas; null por debajo de dos. */
export function tamanoDe(n: number): Tamano | null {
  if (!(n >= 2)) return null;
  if (n < 10) return "2-9";
  if (n < 50) return "10-49";
  if (n < 200) return "50-199";
  return "200+";
}

/**
 * La parte de una dirección IP que cuenta para el tope: entera en IPv4, y en
 * IPv6 su /64 (los primeros cuatro bloques), que es lo que suele tener una casa
 * o un celular. Con la dirección entera, un solo bloque /64 daba millones de
 * topes distintos (§4.8).
 */
export function grupoDeIp(ip: string): string {
  if (!ip.includes(":")) return ip;
  // Una IPv4 escrita como IPv6 (::ffff:1.2.3.4) es esa IPv4.
  const v4 = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
  if (v4?.[1]) return v4[1];
  const doble = ip.includes("::");
  const [cabeza = "", cola = ""] = ip.toLowerCase().split("::");
  const a = cabeza ? cabeza.split(":") : [];
  const b = doble && cola ? cola.split(":") : [];
  const bloques = doble ? [...a, ...Array<string>(Math.max(0, 8 - a.length - b.length)).fill("0"), ...b] : a;
  return `${bloques
    .slice(0, 4)
    .map((x) => x.replace(/^0+(?=.)/, ""))
    .join(":")}::/64`;
}

/** El día UTC de un instante, `AAAA-MM-DD`: lo único del momento que se guarda. */
export function diaUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

const ES_DIA = /^\d{4}-\d{2}-\d{2}$/;
const DIA_MS = 86_400_000;

/** Si es un día de verdad (`2026-02-30` no lo es). */
function esDia(s: string): boolean {
  if (!ES_DIA.test(s)) return false;
  const ms = Date.parse(`${s}T00:00:00Z`);
  return Number.isFinite(ms) && diaUtc(ms) === s;
}

/** Cuántos días puede pedir una consulta, como mucho. */
export const MAX_DIAS = 92;

/**
 * El rango de días de una consulta. Sin `hasta`, hoy (UTC); sin `desde`, los
 * 30 días que terminan en `hasta`. Null si alguno no es un día, si `desde` va
 * después de `hasta` o si pide más de `MAX_DIAS` días.
 */
export function rangoDeDias(desde: string | null, hasta: string | null, ahora: number): { desde: string; hasta: string } | null {
  const h = hasta ?? diaUtc(ahora);
  if (!esDia(h)) return null;
  const d = desde ?? diaUtc(Date.parse(`${h}T00:00:00Z`) - 29 * DIA_MS);
  if (!esDia(d) || d > h) return null;
  const dias = (Date.parse(`${h}T00:00:00Z`) - Date.parse(`${d}T00:00:00Z`)) / DIA_MS + 1;
  return dias > MAX_DIAS ? null : { desde: d, hasta: h };
}
