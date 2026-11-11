import { network } from "./config";
import { formaDePortero } from "./alta-build";
import { configDelPortero } from "./patrocinio-config";

/**
 * Cómo habla el sitio con las rutas de las altas del portero de la red principal (`/v1/alta/*`): quién tiene acceso al
 * modo Oficial con una cuenta de Google o de correo, y el canje de un cupón. La forma de cada ruta es la de la sección 9
 * del diseño del cobro por uso.
 *
 * - **Con sesión.** El token de Pollar viaja SOLO en la cabecera `Authorization: Bearer`, nunca en la dirección, ni en un
 *   mensaje de error, ni en la consola. Este archivo no escribe nada en la consola.
 * - **Sin colgar la pantalla.** Cada pedido espera 8 segundos como mucho (`ESPERA_MS`).
 * - **Cerrado ante la duda.** Ninguna función lanza: devuelve `{ ok: false, clave }` con la clave del texto para la
 *   persona. Sin red, sin portero, con una respuesta que no se entiende o con un motivo que no se conoce, la clave es
 *   `altaErrServicio` y el sitio no pide ninguna firma.
 * - **Sin nada del navegador.** `credentials: "omit"`, sin `Referer`, sin caché.
 *
 * Lo que hay: `estado`, `canjear`, `precios` y `abrir`. Faltan a propósito `orden`, `pago` y `sortearEnElServidor`: el
 * diseño no dice todavía de qué tipo son sus campos (los montos recibidos, el vencimiento de la orden, el sorteo y su
 * prueba), y entran con el pago y con el sorteo por el servidor.
 */

/** Cuánto se espera cada pedido. */
export const ESPERA_MS = 8_000;

/** Qué acceso tiene la persona al modo Oficial. */
export type Acceso = "ninguno" | "cupon" | "pago" | "admin";
/** Si la cuenta se abre en el momento (`inmediato`) o cuando el servidor lo pide (`diferido`). */
export type Fondeo = "inmediato" | "diferido";
/** Qué falta hacer después de un canje. */
export type Sigue = "crear-billetera" | "abrir" | "activar" | "lista";

export interface SorteosDeAlta {
  quedan: number;
  /** El próximo vencimiento (`fecha` en ms) y cuántos sorteos vencen ese día, o `null` si no hay. */
  proximoVence: { fecha: number; cuantos: number } | null;
}

/** La orden de pago abierta de la persona, si la tiene (la usa el pago, que todavía no está). */
export interface OrdenAbierta {
  id: string;
  producto: string;
  usdc: string;
  nota: string;
  vence: number;
}

export interface EstadoDeAlta {
  acceso: Acceso;
  /** La cuenta que la persona tiene en la red, o `null` si todavía no tiene billetera. */
  cuenta: string | null;
  /** La cuenta ya está abierta (activada) en la red. */
  abierta: boolean;
  /** El pedido de abrirla, si el servidor ya lo hizo. */
  pedido: string | null;
  sorteos: SorteosDeAlta;
  orden: OrdenAbierta | null;
  fondeo: Fondeo;
}

export interface CanjeDeCupon {
  ok: true;
  /** El mismo cupón otra vez: no gastó otro uso. */
  repetido: boolean;
  sorteosSumados: number;
  sorteos: SorteosDeAlta;
  sigue: Sigue;
}

export interface PreciosDeAlta {
  red: string;
  pago: boolean;
  alta: { usdc: string; sorteos: number; dias: number };
  paquetes: { id: string; usdc: string; sorteos: number; dias: number }[];
}

export type EstadoDeApertura = "pedido" | "abierta" | "no-hace-falta";

/** Por qué no salió: la clave del texto para la persona (con lo que se reemplaza en él) y el motivo que dijo el servidor. */
export interface ErrorDeAlta {
  ok: false;
  /** La clave de `src/alta-textos.ts` o de la pantalla de la cuenta. */
  clave: string;
  /** Lo que se reemplaza en el texto: `{fecha}`, `{min}`. */
  vars: Record<string, string>;
  /** El motivo del servidor, o `sin-red`, `sin-portero`, `sin-token`, `respuesta` si no hubo uno que se entienda. */
  motivo: string;
  /** El estado HTTP, o 0 si no hubo respuesta. */
  estado: number;
}

export type ResultadoDeAlta<T> = { ok: true; datos: T } | ErrorDeAlta;

export interface OpcionesDeAlta {
  fetch?: typeof fetch;
  /** La dirección del portero, si no es la del entorno (las pruebas). `null`: no hay portero. */
  url?: string | null;
  /** El reloj, para el `{min}` de un tope de intentos. */
  ahora?: () => number;
  /** Cuánto esperar, si no son los 8 segundos (las pruebas). */
  esperaMs?: number;
  /** El idioma de las fechas: `es` o `en`. */
  idioma?: string;
}

/* ------------------------------------------------------------- los motivos */

/** El motivo de cada error del servidor (sección 9) y la clave de texto que lo cuenta. */
const CLAVE_DEL_MOTIVO: Readonly<Record<string, string>> = {
  // Comunes a las rutas con sesión.
  sesion: "clErrSesion",
  "otra-app": "altaErrServicio",
  pollar: "altaErrServicio",
  apagado: "altaErrServicio",
  "altas-pausadas": "altaErrServicio",
  intentos: "altaErrIntentos",
  "cupo-ip": "altaErrIntentos",
  origen: "altaErrServicio",
  cuerpo: "altaErrServicio",
  // El canje.
  forma: "altaErrForma",
  "cupon-no-existe": "altaErrNoExiste",
  "cupon-vencido": "altaErrVencido",
  "cupon-anulado": "altaErrAnulado",
  "cupon-usado": "altaErrUsado",
  "lote-usado": "altaErrLote",
  // El estado y el canje: la cuenta de la persona no coincide con la que tiene atada su acceso (`cupos.ts`, `atar`). No
  // lo provoca nadie desde el navegador (la cuenta la dice Pollar) y no se arregla probando de nuevo: se revisa a mano.
  "cuenta-de-otro": "altaErrCuentaDeOtro",
  // Abrir la cuenta.
  "sin-acceso": "errAnchor.porteroSinAlta",
  "sin-billetera": "altaErrServicio",
  "sin-creditos": "altaErrServicio",
  espera: "altaErrIntentos",
  // El sello (402 de `/v1/patrocinio`).
  "sin-sorteos": "errAnchor.porteroSinSorteos",
};

/** Los motivos que tienen su clave y la clave de cada uno, para las pruebas. */
export const CLAVES_DE_MOTIVO: Readonly<Record<string, string>> = CLAVE_DEL_MOTIVO;

const SERVICIO = "altaErrServicio";

const error = (motivo: string, estado: number, clave = SERVICIO, vars: Record<string, string> = {}): ErrorDeAlta => ({ ok: false, clave, vars, motivo, estado });

/** Bolivia no cambia de hora: un cupón que vence el 14 de diciembre a las 23:59 se dice "14 de diciembre", no el 15 en UTC. */
export function fechaDeAlta(ms: number, idioma: string): string {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms <= 0) return "";
  try {
    return new Intl.DateTimeFormat(idioma === "en" ? "en-US" : "es", { day: "numeric", month: "long", timeZone: "America/La_Paz" }).format(new Date(ms));
  } catch {
    return "";
  }
}

/**
 * Lo más chico que se acepta como instante de `reintentarEn`: el 9 de septiembre de 2001 en ms. Un número menor no es un
 * instante en milisegundos (serían segundos de espera, o un instante en segundos) y se toma como que no vino.
 */
const INSTANTE_MINIMO_MS = 1e12;

/**
 * Cuántos minutos hay que esperar, de 1 a 60. `reintentarEn` es el instante en ms desde el que se puede volver a probar:
 * es lo que manda el portero en los dos lugares donde lo pone (`429 intentos` de la sesión y del canje, `rutas-altas.ts`,
 * que devuelve el vencimiento de la ventana de una hora). Sin dato, o con algo que no es un instante en ms, la hora entera.
 */
export function minutosDeEspera(reintentarEn: unknown, ahora: number): number {
  if (typeof reintentarEn !== "number" || !Number.isFinite(reintentarEn) || reintentarEn < INSTANTE_MINIMO_MS) return 60;
  return Math.min(60, Math.max(1, Math.ceil((reintentarEn - ahora) / 60_000)));
}

/** El texto de un error, con sus datos puestos. `decir` es `t` (o un diccionario en las pruebas). */
export function textoDelError(e: ErrorDeAlta, decir: (clave: string) => string): string {
  let texto = decir(e.clave);
  for (const [k, v] of Object.entries(e.vars)) texto = texto.replaceAll(`{${k}}`, v);
  return texto;
}

function errorDeRespuesta(estado: number, cuerpo: unknown, o: OpcionesDeAlta): ErrorDeAlta {
  const c = (cuerpo && typeof cuerpo === "object" ? cuerpo : {}) as Record<string, unknown>;
  let motivo = typeof c.motivo === "string" ? c.motivo.slice(0, 60) : "";
  if (!motivo && estado === 401) motivo = "sesion";
  const clave = CLAVE_DEL_MOTIVO[motivo];
  if (!clave) return error(motivo || "respuesta", estado);
  const vars: Record<string, string> = {};
  if (clave === "altaErrVencido") {
    const fecha = fechaDeAlta(typeof c.vence === "number" ? c.vence : 0, o.idioma ?? "es");
    // Sin una fecha que decir, el texto no sale con un hueco: es el del cupón anulado, que no nombra ninguna.
    if (!fecha) return error(motivo, estado, "altaErrAnulado");
    vars.fecha = fecha;
  }
  if (clave === "altaErrIntentos") {
    const min = motivo === "espera" ? 1 : minutosDeEspera(c.reintentarEn, (o.ahora ?? Date.now)());
    vars.min = String(min);
    // Un minuto se dice en singular: «Esperá 1 minuto», no «1 minutos».
    if (min === 1) return error(motivo, estado, "altaErrIntentos1", vars);
  }
  return error(motivo, estado, clave, vars);
}

/* ---------------------------------------------------------------- el pedido */

/** La dirección del portero de la red principal, o `null`. En Prueba no hay altas: no se le manda nada a ningún lado. */
function urlDeAltas(o: OpcionesDeAlta): string | null {
  if (o.url !== undefined) return o.url;
  return network.name === "mainnet" ? configDelPortero().url : null;
}

async function pedir(ruta: string, metodo: "GET" | "POST", token: string | null, cuerpo: unknown, o: OpcionesDeAlta): Promise<{ estado: number; cuerpo: unknown } | ErrorDeAlta> {
  // El token de la sesión solo sale hacia una dirección con forma de portero (https, sin ruta ni consulta, no la de
  // Prueba): una variable mal puesta no lo manda en claro ni a otro lado (el build además exige el host, `alta-build.ts`).
  const cruda = urlDeAltas(o);
  const base = formaDePortero(cruda) ? (cruda ?? "").trim().replace(/\/+$/, "") : null;
  if (!base) return error("sin-portero", 0);
  const f = o.fetch ?? fetch;
  const control = new AbortController();
  const reloj = setTimeout(() => control.abort(), o.esperaMs ?? ESPERA_MS);
  try {
    const cabeceras: Record<string, string> = {};
    if (metodo === "POST") cabeceras["Content-Type"] = "application/json";
    if (token !== null) cabeceras.Authorization = `Bearer ${token}`;
    const r = await f(`${base}${ruta}`, {
      method: metodo,
      headers: cabeceras,
      ...(metodo === "POST" ? { body: JSON.stringify(cuerpo ?? {}) } : {}),
      signal: control.signal,
      cache: "no-store",
      credentials: "omit",
      referrerPolicy: "no-referrer",
    });
    let json: unknown = null;
    try {
      json = await r.json();
    } catch {
      /* sin cuerpo que se entienda */
    }
    return { estado: r.status, cuerpo: json };
  } catch {
    // Un corte, el tiempo que se acabó o cualquier cosa del navegador: no se sabe nada, y se dice que no hay servicio.
    return error("sin-red", 0);
  } finally {
    clearTimeout(reloj);
  }
}

/** Lo que dice el servidor, o el error con su clave. `leer` devuelve `null` si la respuesta buena no tiene la forma que se espera. */
async function llamar<T>(ruta: string, metodo: "GET" | "POST", token: string | null, cuerpo: unknown, o: OpcionesDeAlta, leer: (x: Record<string, unknown>) => T | null): Promise<ResultadoDeAlta<T>> {
  if (token !== null && !token.trim()) return error("sin-token", 0, "clErrSesion");
  const r = await pedir(ruta, metodo, token, cuerpo, o);
  if ("ok" in r) return r;
  if (r.estado !== 200) return errorDeRespuesta(r.estado, r.cuerpo, o);
  const x = r.cuerpo && typeof r.cuerpo === "object" && !Array.isArray(r.cuerpo) ? (r.cuerpo as Record<string, unknown>) : null;
  const datos = x ? leer(x) : null;
  return datos === null ? error("respuesta", r.estado) : { ok: true, datos };
}

/* ------------------------------------------------------------ lo que se lee */

const esNumero = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const esTexto = (x: unknown): x is string => typeof x === "string";
const objeto = (x: unknown): Record<string, unknown> | null => (x && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>) : null);

function leerSorteos(x: unknown): SorteosDeAlta | null {
  const o = objeto(x);
  if (!o || !esNumero(o.quedan) || o.quedan < 0) return null;
  if (o.proximoVence === null || o.proximoVence === undefined) return { quedan: o.quedan, proximoVence: null };
  const p = objeto(o.proximoVence);
  if (!p || !esNumero(p.fecha) || !esNumero(p.cuantos)) return null;
  return { quedan: o.quedan, proximoVence: { fecha: p.fecha, cuantos: p.cuantos } };
}

function leerOrden(x: unknown): OrdenAbierta | null | undefined {
  if (x === null || x === undefined) return null;
  const o = objeto(x);
  if (!o || !esTexto(o.id) || !esTexto(o.producto) || !esTexto(o.usdc) || !esTexto(o.nota) || !esNumero(o.vence)) return undefined;
  return { id: o.id, producto: o.producto, usdc: o.usdc, nota: o.nota, vence: o.vence };
}

const ACCESOS: readonly string[] = ["ninguno", "cupon", "pago", "admin"];
const SIGUE: readonly string[] = ["crear-billetera", "abrir", "activar", "lista"];

function leerEstado(x: Record<string, unknown>): EstadoDeAlta | null {
  const sorteos = leerSorteos(x.sorteos);
  const orden = leerOrden(x.orden);
  if (!esTexto(x.acceso) || !ACCESOS.includes(x.acceso) || !sorteos || orden === undefined) return null;
  if (x.cuenta !== null && !esTexto(x.cuenta)) return null;
  if (typeof x.abierta !== "boolean") return null;
  if (x.pedido !== null && x.pedido !== undefined && !esTexto(x.pedido)) return null;
  if (x.fondeo !== "inmediato" && x.fondeo !== "diferido") return null;
  return { acceso: x.acceso as Acceso, cuenta: x.cuenta, abierta: x.abierta, pedido: (x.pedido as string | null | undefined) ?? null, sorteos, orden, fondeo: x.fondeo };
}

function leerCanje(x: Record<string, unknown>): CanjeDeCupon | null {
  const sorteos = leerSorteos(x.sorteos);
  if (x.ok !== true || typeof x.repetido !== "boolean" || !esNumero(x.sorteosSumados) || !sorteos || !esTexto(x.sigue) || !SIGUE.includes(x.sigue)) return null;
  return { ok: true, repetido: x.repetido, sorteosSumados: x.sorteosSumados, sorteos, sigue: x.sigue as Sigue };
}

function leerProducto(x: unknown): { usdc: string; sorteos: number; dias: number } | null {
  const o = objeto(x);
  return o && esTexto(o.usdc) && esNumero(o.sorteos) && esNumero(o.dias) ? { usdc: o.usdc, sorteos: o.sorteos, dias: o.dias } : null;
}

function leerPrecios(x: Record<string, unknown>): PreciosDeAlta | null {
  const alta = leerProducto(x.alta);
  if (!alta || !esTexto(x.red) || typeof x.pago !== "boolean" || !Array.isArray(x.paquetes)) return null;
  const paquetes: PreciosDeAlta["paquetes"] = [];
  for (const p of x.paquetes) {
    const pr = leerProducto(p);
    const id = objeto(p)?.id;
    if (!pr || !esTexto(id)) return null;
    paquetes.push({ id, ...pr });
  }
  return { red: x.red, pago: x.pago, alta, paquetes };
}

/* ------------------------------------------------------------------ las rutas */

/** `POST /v1/alta/estado`: qué acceso tiene la persona de la sesión y cuántos sorteos oficiales le quedan. */
export function estado(token: string, o: OpcionesDeAlta = {}): Promise<ResultadoDeAlta<EstadoDeAlta>> {
  return llamar("/v1/alta/estado", "POST", token, {}, o, leerEstado);
}

/** `POST /v1/alta/cupon`: canjea un cupón. El código va en el cuerpo, nunca en la dirección. */
export function canjear(token: string, cupon: string, o: OpcionesDeAlta = {}): Promise<ResultadoDeAlta<CanjeDeCupon>> {
  return llamar("/v1/alta/cupon", "POST", token, { cupon }, o, leerCanje);
}

/** `GET /v1/alta/precios`: abierta, sin sesión. */
export function precios(o: OpcionesDeAlta = {}): Promise<ResultadoDeAlta<PreciosDeAlta>> {
  return llamar("/v1/alta/precios", "GET", null, null, o, leerPrecios);
}

/** `POST /v1/alta/abrir`: le pide al servidor que abra la cuenta (cuando el fondeo es diferido). */
export function abrir(token: string, o: OpcionesDeAlta = {}): Promise<ResultadoDeAlta<{ estado: EstadoDeApertura }>> {
  return llamar("/v1/alta/abrir", "POST", token, {}, o, (x) => (x.estado === "pedido" || x.estado === "abierta" || x.estado === "no-hace-falta" ? { estado: x.estado } : null));
}
