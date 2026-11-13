import { network } from "./config";
import { formaDePortero } from "./alta-build";
import { ALFABETO } from "./cupon-codigo";
import { USDC_MAINNET, esDireccionG, stroopsDe } from "./pagos";
import { configDelPortero } from "./patrocinio-config";

/**
 * Cómo habla el sitio con las rutas de las altas del portero de la red principal (`/v1/alta/*`): quién tiene acceso al
 * modo Oficial con una cuenta de Google o de correo, el canje de un cupón, los precios, y la orden y el pago de un
 * paquete de sorteos. La forma de cada ruta es la del portero (`workers/patrocinio/src/rutas-altas.ts`).
 *
 * - **Con sesión.** El token de Pollar viaja SOLO en la cabecera `Authorization: Bearer`, nunca en la dirección, ni en un
 *   mensaje de error, ni en la consola. Este archivo no escribe nada en la consola.
 * - **Sin colgar la pantalla.** Cada pedido espera 8 segundos como mucho (`ESPERA_MS`).
 * - **Cerrado ante la duda.** Ninguna función lanza: devuelve `{ ok: false, clave }` con la clave del texto para la
 *   persona. Sin red, sin portero, con una respuesta que no se entiende o con un motivo que no se conoce, la clave es
 *   `altaErrServicio` y el sitio no pide ninguna firma.
 * - **Un dato de pago que no cuadra no se muestra.** La orden se acepta solo si su cuenta, su monto, su nota, su nota
 *   numérica y su enlace de pago dicen lo mismo (`leerOrdenDePago`): un dato de pago equivocado es plata perdida de
 *   alguien. El sitio nunca arma ninguno de esos datos por su cuenta.
 * - **Sin nada del navegador.** `credentials: "omit"`, sin `Referer`, sin caché.
 *
 * Lo que hay: `estado`, `canjear`, `precios`, `abrir`, `orden` y `pago`, y las de la compra con QR (`/v1/compra/*`):
 * `empezarCompra`, `cargarCompra` y `anularCompra`. Falta a propósito `sortearEnElServidor`: entra con el sorteo por el
 * servidor.
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

/**
 * La orden de pago abierta de la persona, si la tiene, como la cuenta `/v1/alta/estado`: sin la cuenta de cobro ni el
 * enlace (para mostrarla se pide entera con `orden`). `recibido` es lo que ya llegó, si el servidor lo dice y se entiende.
 */
export interface OrdenAbierta {
  id: string;
  producto: string;
  usdc: string;
  nota: string;
  vence: number;
  recibido?: string;
}

/**
 * La orden de pago entera, como la da `POST /v1/alta/orden`: a qué cuenta pagar (`destino`), cuánto (`usdc`, en el
 * texto del servidor, con punto), con qué nota (`nota`, `tk:o:<id>`, y `memoId`, la misma como número), el enlace de
 * pago ya lleno (`enlace`) y hasta cuándo vale (`vence`, en ms). Todo comprobado contra todo.
 */
export interface OrdenDePago {
  id: string;
  producto: string;
  usdc: string;
  sorteos: number;
  destino: string;
  nota: string;
  memoId: string;
  enlace: string;
  vence: number;
  /**
   * Con una compra con QR cargada y sin pagar, la orden lleva su recargo: el precio del paquete y el recargo, que suman
   * `usdc` (el total). Sin recargo no vienen.
   */
  precio?: string;
  recargo?: string;
}

/**
 * Una compra con QR como la muestra el servidor (`ComprasQr.vista`, `workers/patrocinio/src/compras.ts`): el producto,
 * desde cuándo (en ms), el recargo, el total (el precio de hoy más el recargo, o `null` si el paquete dejó de venderse),
 * si el recargo es el de la primera vez y si el sitio ya avisó la carga. Los montos, en el texto del servidor.
 */
export interface PermisoDelServidor {
  producto: string;
  desde: number;
  recargo: string;
  total: string | null;
  primera: boolean;
  cargada: boolean;
}

/**
 * Lo que `/v1/alta/estado` dice de la compra con QR (`compraQrDe`): si podría empezar una ahora y por qué no, la compra
 * en curso, si alguna vez tuvo una (el permiso de terminar), lo mínimo en bolivianos de una carga y el recargo que va en
 * toda orden suya mientras tenga una compra cargada sin pagar (también después de anularla).
 */
export interface CompraQrDelEstado {
  puede: boolean;
  motivo: string | null;
  abierta: PermisoDelServidor | null;
  terminar: boolean;
  minimoBs: number;
  recargoPendiente: string | null;
}

/**
 * Un no de las rutas de la compra con QR, con lo que el servidor manda junto: el permiso de la compra en curso, la orden
 * viva que habría que reemplazar (`409 orden-abierta`) y desde cuándo se puede volver a avisar (`409 cargando`).
 */
export interface ErrorDeCompra extends ErrorDeAlta {
  permiso?: PermisoDelServidor;
  orden?: OrdenAbierta;
  reintentarEn?: number;
}

export type ResultadoDeCompra<T> = { ok: true; datos: T } | ErrorDeCompra;

/** Lo que dice `POST /v1/alta/pago`: pagada (con los sorteos y lo que sigue) o lo que llegó hasta ahora. */
export type PagoDeOrden = { pagada: true; sorteos: SorteosDeAlta; sigue: Sigue } | { pagada: false; recibido: string; total: string; minimo: string };

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
  /** Solo cuando el servidor tiene la compra con QR prendida o la persona tuvo una, y se entiende. */
  compraQr?: CompraQrDelEstado;
}

export interface CanjeDeCupon {
  ok: true;
  /** El mismo cupón otra vez: no gastó otro uso. */
  repetido: boolean;
  sorteosSumados: number;
  sorteos: SorteosDeAlta;
  sigue: Sigue;
}

/** Un producto de `GET /v1/alta/precios`. `pausado`: el servidor dice que ahora no se vende (falta el dato: se vende). */
export interface ProductoDeAlta {
  usdc: string;
  sorteos: number;
  dias: number;
  pausado: boolean;
}

/**
 * El recargo por pagar con el QR del banco, como lo anuncia el servidor: la primera vez (con la verificación de la
 * persona) y las siguientes, en el texto del servidor (con punto). Es para decirlo en la página de precios: lo que paga
 * cada persona sale del total de su compra, que el servidor da con el recargo ya sumado.
 */
export interface RecargoQr {
  primera: string;
  siguientes: string;
}

/** Lo que dice `GET /v1/alta/precios`. `alta` es el primer paquete (`null` si el servidor no lo vende). */
export interface PreciosDeAlta {
  red: string;
  pago: boolean;
  alta: ProductoDeAlta | null;
  paquetes: (ProductoDeAlta & { id: string })[];
  /** Solo cuando el servidor tiene prendida la compra con QR y el recargo bien escrito. */
  recargoQr?: RecargoQr;
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

/**
 * Los motivos propios de las rutas del pago, que en ellas se cuentan distinto que en el canje. Leídos de `orden` y `pago`
 * en `workers/patrocinio/src/rutas-altas.ts` y de `crearOrden` en `cobros.ts`:
 * - la orden: `503 pago-apagado` (el pago apagado en el servidor), `503 venta-pausada` (pausada a mano o, más adelante,
 *   por costo, con `detalle`), `503 altas-pausadas` (el piso de créditos), `400 producto` (uno que el servidor no vende)
 *   y `409 ya-tiene-acceso` (pidió el primer paquete con acceso). Con la lista del piloto puesta en el servidor, una
 *   orden nueva de una cuenta que no está en ella da `503 fuera-del-piloto`. Esos cinco, menos el del acceso, son lo
 *   mismo para la persona: ese paquete no está a la venta ahora. La venta pausada lleva el texto de la venta frenada
 *   (`pagoPausado`, el mismo que `CLAVES_DE_LA_VENTA` de `venta-oficial.ts`); los otros, `pagoNoALaVenta`.
 * - el pago: `503 pago-apagado` (no se pueden leer los pagos), `400 forma` (un id sin forma: lo mandó mal el sitio, no
 *   la persona), `404 orden` (no existe, o es de otra persona), `410 orden-cerrada` (se cerró para devolverla, o la
 *   reemplazó el aviso de una compra con QR: probar de nuevo no la abre) y `502 red` (Horizon no contestó).
 *   `409 cuenta-de-otro` va con la clave de siempre.
 * El resto de los motivos (la sesión, el origen, los topes) son los de todas las rutas con sesión.
 */
const CLAVE_EN_LA_ORDEN: Readonly<Record<string, string>> = {
  "pago-apagado": "pagoNoALaVenta",
  "venta-pausada": "pagoPausado",
  "altas-pausadas": "pagoNoALaVenta",
  producto: "pagoNoALaVenta",
  "ya-tiene-acceso": "pagoYaTenes",
  "fuera-del-piloto": "pagoNoALaVenta",
};
const CLAVE_EN_EL_PAGO: Readonly<Record<string, string>> = {
  "pago-apagado": "pagoErrRed",
  forma: "altaErrServicio",
  orden: "pagoErrOrden",
  red: "pagoErrRed",
  "orden-cerrada": "pagoErrOrden",
};

/** Las claves propias de cada ruta del pago, para las pruebas. */
export const CLAVES_DEL_PAGO: Readonly<{ orden: Readonly<Record<string, string>>; pago: Readonly<Record<string, string>> }> = { orden: CLAVE_EN_LA_ORDEN, pago: CLAVE_EN_EL_PAGO };

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

function errorDeRespuesta(estado: number, cuerpo: unknown, o: OpcionesDeAlta, propias: Readonly<Record<string, string>> = {}): ErrorDeAlta {
  const c = (cuerpo && typeof cuerpo === "object" ? cuerpo : {}) as Record<string, unknown>;
  let motivo = typeof c.motivo === "string" ? c.motivo.slice(0, 60) : "";
  if (!motivo && estado === 401) motivo = "sesion";
  const clave = (Object.hasOwn(propias, motivo) ? propias[motivo] : undefined) ?? (Object.hasOwn(CLAVE_DEL_MOTIVO, motivo) ? CLAVE_DEL_MOTIVO[motivo] : undefined);
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

/**
 * Lo que dice el servidor, o el error con su clave. `leer` devuelve `null` si la respuesta buena no tiene la forma que se
 * espera. `propias`: las claves de los motivos de esta ruta que se cuentan distinto que en las demás.
 */
async function llamar<T>(
  ruta: string,
  metodo: "GET" | "POST",
  token: string | null,
  cuerpo: unknown,
  o: OpcionesDeAlta,
  leer: (x: Record<string, unknown>) => T | null,
  propias?: Readonly<Record<string, string>>,
): Promise<ResultadoDeAlta<T>> {
  if (token !== null && !token.trim()) return error("sin-token", 0, "clErrSesion");
  const r = await pedir(ruta, metodo, token, cuerpo, o);
  if ("ok" in r) return r;
  if (r.estado !== 200) return errorDeRespuesta(r.estado, r.cuerpo, o, propias);
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

/** Un monto como lo escribe el servidor (`usdcTexto`, `cobros.ts`): con punto y hasta 7 decimales. */
const MONTO = /^\d{1,15}(?:\.\d{1,7})?$/;
const esMonto = (x: unknown): x is string => esTexto(x) && MONTO.test(x);
const esMontoPositivo = (x: unknown): x is string => esMonto(x) && /[1-9]/.test(x);
const esEnteroPositivo = (x: unknown): x is number => esNumero(x) && Number.isInteger(x) && x >= 1;

function leerOrden(x: unknown): OrdenAbierta | null | undefined {
  if (x === null || x === undefined) return null;
  const o = objeto(x);
  if (!o || !esTexto(o.id) || !esTexto(o.producto) || !esTexto(o.usdc) || !esTexto(o.nota) || !esNumero(o.vence)) return undefined;
  // Lo que ya llegó es un dato de más: si no se entiende, se deja de lado y el acceso se lee igual.
  return { id: o.id, producto: o.producto, usdc: o.usdc, nota: o.nota, vence: o.vence, ...(esMonto(o.recibido) ? { recibido: o.recibido } : {}) };
}

/* ------------------------------------------------------------ la orden y el pago */

/** El comienzo de la nota de una orden, como la arma el servidor (`PREFIJO_NOTA`, `cobros.ts`). */
export const PREFIJO_NOTA = "tk:o:";
/** Un id de orden: 8 caracteres del alfabeto de los cupones (`LARGO_ORDEN`, `cobros.ts`). */
const ID_ORDEN = new RegExp(`^[${ALFABETO}]{8}$`);
/** Un producto como lo nombra el servidor (`alta`, `p10`, `p50`): lo que no tiene esta forma ni se pide. */
const PRODUCTO = /^[a-z][a-z0-9]{0,15}$/;
/** El enlace de pago SEP-7 que arma el servidor (`enlaceDePago`, `cobros.ts`), con estos datos y ninguno más. */
const ENLACE = "web+stellar:pay?";

/** La nota numérica de una orden: su id como número de 40 bits, igual que `memoIdDe` del servidor. `null` si el id no tiene forma. */
export function memoIdDe(id: string): string | null {
  if (!ID_ORDEN.test(id)) return null;
  let n = 0n;
  for (const c of id) n = n * 32n + BigInt(ALFABETO.indexOf(c));
  return n.toString();
}

/**
 * El enlace dice exactamente lo que dice la orden: la misma cuenta, el mismo monto, el USDC de Circle, la misma nota de
 * texto, y nada más (un `callback` o un `msg` de más mandarían o mostrarían otra cosa en la app de pagos).
 */
function enlaceCuadra(enlace: string, o: { destino: string; usdc: string; nota: string }): boolean {
  if (!enlace.startsWith(ENLACE)) return false;
  const q = new URLSearchParams(enlace.slice(ENLACE.length));
  const esperado: Record<string, string> = { destination: o.destino, amount: o.usdc, asset_code: USDC_MAINNET.code, asset_issuer: USDC_MAINNET.issuer, memo: o.nota, memo_type: "MEMO_TEXT" };
  const claves = [...q.keys()];
  if (claves.length !== Object.keys(esperado).length || new Set(claves).size !== claves.length) return false;
  return Object.entries(esperado).every(([k, v]) => q.get(k) === v);
}

/** La orden entera, comprobada dato por dato y contra el producto que se pidió. `null` si algo no cuadra. */
function leerOrdenDePago(x: unknown, producto: string): OrdenDePago | null {
  const o = objeto(x);
  if (!o || !esTexto(o.id) || !ID_ORDEN.test(o.id) || o.producto !== producto) return null;
  const id = o.id;
  if (!esMontoPositivo(o.usdc) || !esEnteroPositivo(o.sorteos) || !esDireccionG(o.destino) || !esNumero(o.vence) || o.vence <= 0) return null;
  const nota = `${PREFIJO_NOTA}${id}`;
  const memoId = memoIdDe(id);
  if (o.nota !== nota || memoId === null || o.memoId !== memoId || !esTexto(o.enlace)) return null;
  if (!enlaceCuadra(o.enlace, { destino: o.destino, usdc: o.usdc, nota })) return null;
  // El recargo del QR: el precio y el recargo vienen juntos y suman el total, o no vienen. Uno solo, o que no sumen, no
  // se muestra: la persona vería un precio que no es el que paga.
  let recargo: Pick<OrdenDePago, "precio" | "recargo"> = {};
  if (o.precio !== undefined || o.recargo !== undefined) {
    const precio = esMontoPositivo(o.precio) ? o.precio : null;
    const suma = esMonto(o.recargo) ? o.recargo : null;
    if (precio === null || suma === null || stroopsDe(precio) + stroopsDe(suma) !== stroopsDe(o.usdc)) return null;
    recargo = { precio, recargo: suma };
  }
  return { id, producto, usdc: o.usdc, sorteos: o.sorteos, destino: o.destino, nota, memoId, enlace: o.enlace, vence: o.vence, ...recargo };
}

/** Un permiso de la compra con QR, o `null` si algo no se entiende: el total viene del servidor o no se muestra. */
function leerPermiso(x: unknown): PermisoDelServidor | null {
  const o = objeto(x);
  if (!o || !esTexto(o.producto) || !PRODUCTO.test(o.producto) || !esNumero(o.desde) || o.desde <= 0 || !esMonto(o.recargo)) return null;
  if (typeof o.primera !== "boolean" || typeof o.cargada !== "boolean") return null;
  // El total trae el recargo: nunca menos que él.
  const total = o.total === null ? null : esMontoPositivo(o.total) ? o.total : undefined;
  if (total === undefined || (total !== null && stroopsDe(total) < stroopsDe(o.recargo))) return null;
  return { producto: o.producto, desde: o.desde, recargo: o.recargo, total, primera: o.primera, cargada: o.cargada };
}

/** La compra con QR del estado, o `null` si no se entiende (y se deja de lado: el acceso se lee igual). */
function leerCompraQr(x: unknown): CompraQrDelEstado | null {
  const o = objeto(x);
  if (!o || typeof o.puede !== "boolean" || typeof o.terminar !== "boolean") return null;
  const motivo = o.motivo === null ? null : esTexto(o.motivo) ? o.motivo : undefined;
  const abierta = o.abierta === null ? null : leerPermiso(o.abierta);
  const recargoPendiente = o.recargoPendiente === null ? null : esMontoPositivo(o.recargoPendiente) ? o.recargoPendiente : undefined;
  if (motivo === undefined || (o.abierta !== null && !abierta) || recargoPendiente === undefined) return null;
  if (!esNumero(o.minimoBs) || !Number.isInteger(o.minimoBs) || o.minimoBs < 0) return null;
  return { puede: o.puede, motivo, abierta, terminar: o.terminar, minimoBs: o.minimoBs, recargoPendiente };
}

function leerPago(x: Record<string, unknown>): PagoDeOrden | null {
  if (x.pagada === true) {
    const sorteos = leerSorteos(x.sorteos);
    return sorteos && esTexto(x.sigue) && SIGUE.includes(x.sigue) ? { pagada: true, sorteos, sigue: x.sigue as Sigue } : null;
  }
  if (x.pagada === false) return esMonto(x.recibido) && esMontoPositivo(x.total) && esMonto(x.minimo) ? { pagada: false, recibido: x.recibido, total: x.total, minimo: x.minimo } : null;
  return null;
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
  // La compra con QR es un dato de más: si no viene o no se entiende, el acceso se lee igual.
  const compraQr = x.compraQr === undefined ? null : leerCompraQr(x.compraQr);
  return { acceso: x.acceso as Acceso, cuenta: x.cuenta, abierta: x.abierta, pedido: (x.pedido as string | null | undefined) ?? null, sorteos, orden, fondeo: x.fondeo, ...(compraQr ? { compraQr } : {}) };
}

function leerCanje(x: Record<string, unknown>): CanjeDeCupon | null {
  const sorteos = leerSorteos(x.sorteos);
  if (x.ok !== true || typeof x.repetido !== "boolean" || !esNumero(x.sorteosSumados) || !sorteos || !esTexto(x.sigue) || !SIGUE.includes(x.sigue)) return null;
  return { ok: true, repetido: x.repetido, sorteosSumados: x.sorteosSumados, sorteos, sigue: x.sigue as Sigue };
}

/**
 * Un producto de los precios: un monto positivo con punto, y sorteos y días enteros desde 1. `pausado` es de las reglas
 * de costo que vienen (la venta que se frena sola): si falta, se vende; si viene y no es `false`, no se vende.
 */
function leerProducto(x: unknown): ProductoDeAlta | null {
  const o = objeto(x);
  if (!o || !esMontoPositivo(o.usdc) || !esEnteroPositivo(o.sorteos) || !esEnteroPositivo(o.dias)) return null;
  return { usdc: o.usdc, sorteos: o.sorteos, dias: o.dias, pausado: o.pausado !== undefined && o.pausado !== false };
}

/** Los precios. Cualquier producto mal escrito rechaza todo: un precio a medias no se muestra (como `leerPrecios` del servidor). */
function leerPrecios(x: Record<string, unknown>): PreciosDeAlta | null {
  const alta = x.alta === null ? null : leerProducto(x.alta);
  if ((x.alta !== null && !alta) || !esTexto(x.red) || typeof x.pago !== "boolean" || !Array.isArray(x.paquetes)) return null;
  const paquetes: PreciosDeAlta["paquetes"] = [];
  for (const p of x.paquetes) {
    const pr = leerProducto(p);
    const id = objeto(p)?.id;
    if (!pr || !esTexto(id) || !PRODUCTO.test(id) || id === "alta" || paquetes.some((q) => q.id === id)) return null;
    paquetes.push({ id, ...pr });
  }
  // Un recargo mal escrito no rechaza los precios: no se abre el QR, y lo demás se vende igual.
  const recargo = leerRecargoQr(x.recargoQr);
  return { red: x.red, pago: x.pago, alta, paquetes, ...(recargo ? { recargoQr: recargo } : {}) };
}

/** Un monto del recargo: con punto, de 0 a 50, como lo acepta el servidor. */
const esMontoDeRecargo = (x: unknown): x is string => typeof x === "string" && /^\d{1,2}(?:\.\d{1,7})?$/.test(x) && Number(x) <= 50;

/** El recargo del QR de los precios, o `null` si no viene o está mal escrito (los dos montos, o ninguno). */
export function leerRecargoQr(x: unknown): RecargoQr | null {
  const o = objeto(x);
  if (!o || !esMontoDeRecargo(o.primera) || !esMontoDeRecargo(o.siguientes)) return null;
  return { primera: o.primera, siguientes: o.siguientes };
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

/**
 * `POST /v1/alta/orden`: la orden abierta de la persona para ese producto, o una nueva. El servidor devuelve la misma
 * mientras siga abierta, así que pedirla otra vez (al volver, o con un doble toque) no crea otra. El producto va en el
 * cuerpo; uno sin forma ni se pide.
 */
export async function orden(token: string, producto: string, o: OpcionesDeAlta = {}): Promise<ResultadoDeAlta<OrdenDePago>> {
  if (!PRODUCTO.test(producto)) return error("producto", 0);
  return llamar("/v1/alta/orden", "POST", token, { producto }, o, (x) => leerOrdenDePago(x.orden, producto), CLAVE_EN_LA_ORDEN);
}

/**
 * `POST /v1/alta/pago`: si la orden ya está pagada. El servidor lee los pagos nuevos antes de contestar (como mucho una
 * vez cada 5 segundos para todos). El id va en el cuerpo, nunca en la dirección; uno sin forma ni se pregunta.
 */
export async function pago(token: string, id: string, o: OpcionesDeAlta = {}): Promise<ResultadoDeAlta<PagoDeOrden>> {
  if (!ID_ORDEN.test(id)) return error("forma", 0);
  return llamar("/v1/alta/pago", "POST", token, { orden: id }, o, leerPago, CLAVE_EN_EL_PAGO);
}

/* ------------------------------------------------------------------ la compra con QR */

/**
 * Una ruta de la compra con QR: como `llamar`, y un no trae además lo que el servidor manda junto (el permiso, la orden
 * viva, cuándo reintentar), si se entiende. Lo que no se entiende se deja de lado: el motivo queda.
 */
async function llamarCompra<T>(ruta: string, token: string, cuerpo: unknown, o: OpcionesDeAlta, leer: (x: Record<string, unknown>) => T | null): Promise<ResultadoDeCompra<T>> {
  if (!token.trim()) return error("sin-token", 0, "clErrSesion");
  const r = await pedir(ruta, "POST", token, cuerpo, o);
  if ("ok" in r) return r;
  const x = objeto(r.cuerpo);
  if (r.estado !== 200) {
    const e: ErrorDeCompra = errorDeRespuesta(r.estado, r.cuerpo, o);
    const permiso = x ? leerPermiso(x.permiso) : null;
    const orden = x ? leerOrden(x.orden) : null;
    if (permiso) e.permiso = permiso;
    if (orden) e.orden = orden;
    if (x && esNumero(x.reintentarEn) && x.reintentarEn >= INSTANTE_MINIMO_MS) e.reintentarEn = x.reintentarEn;
    return e;
  }
  const datos = x ? leer(x) : null;
  return datos === null ? error("respuesta", r.estado) : { ok: true, datos };
}

/**
 * `POST /v1/compra/empezar`: el permiso de empezar una compra con QR de ese producto. El servidor devuelve el mismo
 * mientras siga abierto (pedirlo otra vez no reserva de nuevo) y renueva uno cargado que dejó de reservar. Lo que no:
 * `compras-cerradas`, `fondeo-diferido`, `fuera-del-piloto`, `tope-del-dia`, `sin-lugar`, `ya-tiene-acceso`,
 * `compra-en-curso` (con el permiso de la otra) y `producto`.
 */
export async function empezarCompra(token: string, producto: string, o: OpcionesDeAlta = {}): Promise<ResultadoDeCompra<PermisoDelServidor>> {
  if (!PRODUCTO.test(producto)) return error("producto", 0);
  return llamarCompra("/v1/compra/empezar", token, { producto }, o, (x) => leerPermiso(x.permiso));
}

/**
 * `POST /v1/compra/cargar`: el aviso de carga, justo antes de crear la orden de carga. Sin su 200 con el permiso cargado no
 * se crea nada. `reemplazar`: la persona dijo que no pagó su orden viva de antes. Lo que no: `orden-abierta` (con la
 * orden), `cargando` (con cuándo reintentar), `permiso-vencido` (se renueva con `empezarCompra`), `sin-permiso`,
 * `compra-en-curso`, `ya-tiene-acceso`, `orden-con-pago`, `red`, los de la compra cerrada y `producto`.
 */
export async function cargarCompra(token: string, producto: string, o: OpcionesDeAlta & { reemplazar?: boolean } = {}): Promise<ResultadoDeCompra<PermisoDelServidor>> {
  if (!PRODUCTO.test(producto)) return error("producto", 0);
  return llamarCompra("/v1/compra/cargar", token, o.reemplazar === true ? { producto, reemplazar: true } : { producto }, o, (x) => {
    const p = leerPermiso(x.permiso);
    return p && p.cargada ? p : null;
  });
}

/**
 * `POST /v1/compra/anular`: la persona suelta la reserva de su compra cargada cuando la orden de carga falló sin QR. El
 * recargo NO se suelta: la compra sigue en curso y su recargo va en toda orden suya (`compraQr.recargoPendiente` del
 * estado). Lo que no: `sin-compra`, `plazo-vencido`, `compra-en-curso`, `orden-con-pago`, `tope-de-anulaciones`, `red`
 * y `producto`.
 */
export async function anularCompra(token: string, producto: string, o: OpcionesDeAlta = {}): Promise<ResultadoDeCompra<{ anulada: true; repetido: boolean }>> {
  if (!PRODUCTO.test(producto)) return error("producto", 0);
  return llamarCompra("/v1/compra/anular", token, { producto }, o, (x) => (x.anulada === true && typeof x.repetido === "boolean" ? { anulada: true, repetido: x.repetido } : null));
}
