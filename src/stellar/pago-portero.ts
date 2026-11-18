import { HORIZON_URLS, type NetworkName } from "./config";
import { TOPE_CUPO_MS, TOPE_PAGO_MS } from "./patrocinador";

/**
 * El cliente del servicio de comisiones para los pagos que hace una cuenta de Google: el pago del premio de un sorteo y
 * el retiro con su costo. La cuenta firma sin el patrocinio del proveedor de cuentas y lo firmado se manda acá, al
 * portero, que paga la comisión de la red con su propia cuenta. Nunca vuelve al envío del proveedor.
 *
 * Tres pedidos al portero y uno a la red:
 *
 * - `mirarPagos`: el bloque `pagos` de `GET /v1/patrocinio/cupo`. Se mira antes de pedir una firma, que cuesta: si el
 *   portero no atiende esa forma, si exige otro costo de retiro o si la cuenta ya tiene un pago en el aire, no se firma.
 * - `pedirElPago`: `POST /v1/patrocinio/pago` con la forma y el sobre firmado, una vez.
 * - `mandarElPago`: el pedido entero con sus reintentos. Reenviar el mismo sobre es inofensivo (tiene el mismo hash y la
 *   red aplica una sola transacción por secuencia), así que solo se reenvía ese, nunca otro. Lo que no es un rechazo claro
 *   es duda, y un sobre que estuvo en duda sigue en duda aunque después llegue un rechazo.
 * - `estadoEnLaRed`: cómo terminó una transacción, preguntado a la red por su hash y no al portero.
 *
 * Sin DOM: `fetch`, el reloj y la espera entran inyectados, así se prueba sin red ni reloj de verdad. Nunca lanza.
 */

type Fetch = typeof fetch;

/** Las dos formas de pago que paga el portero. */
export type FormaDelPago = "premio" | "retiro";

/* ------------------------------------------------------------------ lo que dice el cupo */

/** Lo que el portero dice de los pagos de esta cuenta en `/cupo`. */
export interface PagosDelPortero {
  /** Si atendería ahora el pago de un premio. */
  premio: boolean;
  /** Si atendería ahora un retiro. */
  retiro: boolean;
  /** El costo del retiro que exige, en stroops, o `null` si no está configurado. */
  costoRetiro: bigint | null;
  /** El pago de esta cuenta que sigue en el aire, si hay uno: su hash, su forma y hasta cuándo puede entrar (segundos). */
  enCurso: { hash: string; forma: FormaDelPago; vence: number } | null;
}

/** El bloque de los pagos, leído. `sin-pagos`: el portero no trae el bloque o no se entiende. `sin-respuesta`: no contestó. */
export type LecturaDePagos = { tipo: "pagos"; pagos: PagosDelPortero } | { tipo: "sin-pagos" } | { tipo: "sin-respuesta" };

const esObjeto = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const esHash = (x: unknown): x is string => typeof x === "string" && /^[0-9a-f]{64}$/i.test(x);
const esForma = (x: unknown): x is FormaDelPago => x === "premio" || x === "retiro";

/** El costo que dice el portero: `null` si no hay, o un número entero y positivo de stroops. `undefined` si no se entiende. */
function costoDelCupo(x: unknown): bigint | null | undefined {
  if (x === null) return null;
  if (!esObjeto(x)) return undefined;
  const monto = x.monto;
  return typeof monto === "number" && Number.isSafeInteger(monto) && monto > 0 ? BigInt(monto) : undefined;
}

/** El pago en el aire que dice el portero: `null` si no hay. `undefined` si no se entiende. */
function enCursoDelCupo(x: unknown): PagosDelPortero["enCurso"] | undefined {
  if (x === null) return null;
  if (!esObjeto(x) || !esHash(x.hash) || !esForma(x.forma)) return undefined;
  const vence = x.vence;
  if (typeof vence !== "number" || !Number.isFinite(vence)) return undefined;
  return { hash: x.hash.toLowerCase(), forma: x.forma, vence };
}

/**
 * Lee la respuesta de `/cupo`. Sin el bloque `pagos`, o con algo que no se entiende, no hay pagos: ante la duda no se
 * pide ninguna firma. Un portero de otra red tampoco tiene pagos para esta página.
 */
export function leerPagosDelCupo(estado: number, cuerpo: unknown): LecturaDePagos {
  if (estado !== 200 || !esObjeto(cuerpo)) return { tipo: "sin-respuesta" };
  if (cuerpo.red !== undefined && cuerpo.red !== "mainnet") return { tipo: "sin-pagos" };
  const p = cuerpo.pagos;
  if (!esObjeto(p) || typeof p.premio !== "boolean" || typeof p.retiro !== "boolean") return { tipo: "sin-pagos" };
  const costoRetiro = costoDelCupo(p.costoRetiro);
  const enCurso = enCursoDelCupo(p.enCurso);
  if (costoRetiro === undefined || enCurso === undefined) return { tipo: "sin-pagos" };
  return { tipo: "pagos", pagos: { premio: p.premio, retiro: p.retiro, costoRetiro, enCurso } };
}

/** Pregunta a `/cupo` por los pagos de esta cuenta, sin guardar nada: cada firma vuelve a preguntar. */
export async function mirarPagos(url: string, cuenta: string, o: { fetch?: Fetch } = {}): Promise<LecturaDePagos> {
  const f = o.fetch ?? fetch;
  try {
    const r = await f(`${url}/v1/patrocinio/cupo?cuenta=${encodeURIComponent(cuenta)}`, {
      method: "GET",
      cache: "no-store",
      signal: AbortSignal.timeout(TOPE_CUPO_MS),
    });
    let cuerpo: unknown = null;
    try {
      cuerpo = await r.json();
    } catch {
      cuerpo = null;
    }
    return leerPagosDelCupo(r.status, cuerpo);
  } catch {
    return { tipo: "sin-respuesta" };
  }
}

/* ------------------------------------------------------------------ lo que contesta el pago */

/**
 * Lo que contestó `POST /v1/patrocinio/pago`. `tomado`: el portero lo tiene, con su hash y cómo va (`en-camino`, `ok`
 * o `fallo`). `no`: no lo pagó, con su motivo y, si vino, `pudoSalir` (si ese sobre todavía puede entrar). `sin-respuesta`:
 * no contestó con algo que se entienda (un corte, el tope de tiempo, un error sin cuerpo): no se sabe nada.
 */
export type RespuestaDelPago =
  | { tipo: "tomado"; hash: string; vence: number; estado: "en-camino" | "ok" | "fallo" }
  | { tipo: "no"; http: number; motivo: string; pudoSalir: boolean | null; hash: string | null; detalle: string | null; reintentarEn: number | null }
  | { tipo: "sin-respuesta" };

const ESTADOS_DEL_PAGO: readonly string[] = ["en-camino", "ok", "fallo"];
const textoCorto = (x: unknown): string | null => (typeof x === "string" && x !== "" ? x.slice(0, 80) : null);

/** Lee la respuesta del pago. Un 200 que no trae el hash y el estado se toma como que no contestó: no se sabe nada. */
export function leerRespuestaDelPago(http: number, cuerpo: unknown): RespuestaDelPago {
  if (!esObjeto(cuerpo)) return { tipo: "sin-respuesta" };
  if (http === 200) {
    const estado = cuerpo.estado;
    if (!esHash(cuerpo.hash) || typeof estado !== "string" || !ESTADOS_DEL_PAGO.includes(estado)) return { tipo: "sin-respuesta" };
    const vence = typeof cuerpo.vence === "number" && Number.isFinite(cuerpo.vence) ? cuerpo.vence : 0;
    return { tipo: "tomado", hash: cuerpo.hash.toLowerCase(), vence, estado: estado as "en-camino" | "ok" | "fallo" };
  }
  const motivo = textoCorto(cuerpo.motivo);
  if (motivo === null) return { tipo: "sin-respuesta" };
  const pudoSalir = typeof cuerpo.pudoSalir === "boolean" ? cuerpo.pudoSalir : null;
  const reintentarEn = typeof cuerpo.reintentarEn === "number" && Number.isFinite(cuerpo.reintentarEn) ? cuerpo.reintentarEn : null;
  const hash = esHash(cuerpo.hash) ? cuerpo.hash.toLowerCase() : null;
  return { tipo: "no", http, motivo, pudoSalir, hash, detalle: textoCorto(cuerpo.detalle), reintentarEn };
}

/** Manda el sobre firmado al portero, una vez. Nunca lanza: lo que no contesta es `sin-respuesta`. */
export async function pedirElPago(url: string, forma: FormaDelPago, xdr: string, o: { fetch?: Fetch } = {}): Promise<RespuestaDelPago> {
  const f = o.fetch ?? fetch;
  try {
    const r = await f(`${url}/v1/patrocinio/pago`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ forma, xdr }),
      signal: AbortSignal.timeout(TOPE_PAGO_MS),
    });
    let cuerpo: unknown = null;
    try {
      cuerpo = await r.json();
    } catch {
      cuerpo = null;
    }
    return leerRespuestaDelPago(r.status, cuerpo);
  } catch {
    return { tipo: "sin-respuesta" };
  }
}

/**
 * Las respuestas de la puerta del portero, que no leen el sobre y no traen `pudoSalir`, con su código HTTP. Son un rechazo
 * claro solo si el sobre nunca estuvo en duda: la puerta no sabe si un envío anterior del mismo sobre quedó en el aire.
 */
const DE_LA_PUERTA: Readonly<Record<string, number>> = { "no-existe": 404, metodo: 405, origen: 403, "cupo-ip": 429, cuerpo: 400 };

/**
 * ¿Este no del portero es un rechazo claro, que dice que el sobre no salió ni puede salir? Con `pudoSalir` en falso, sí.
 * Sin el campo, solo una respuesta de la puerta con su código, y solo si el sobre nunca estuvo en duda. Lo demás, no.
 */
export function esRechazoClaro(r: Extract<RespuestaDelPago, { tipo: "no" }>, estuvoEnDuda: boolean): boolean {
  if (estuvoEnDuda) return false;
  if (r.pudoSalir === false) return true;
  return r.pudoSalir === null && Object.hasOwn(DE_LA_PUERTA, r.motivo) && DE_LA_PUERTA[r.motivo] === r.http;
}

/* ------------------------------------------------------------------ la red, por el hash */

/** Cómo está una transacción en la red: entró bien, entró y falló, no está (todavía), o no se pudo saber. */
export type EstadoEnLaRed = "entro" | "fallo" | "no-esta" | "no-se-sabe";

/** Cuánto se espera a la red en cada consulta por un hash. */
export const TOPE_DE_LA_CONSULTA_MS = 10_000;

/** Pregunta a la red (Horizon, `/transactions/<hash>`) por una transacción. Nunca lanza. */
export async function estadoEnLaRed(red: NetworkName, hash: string, o: { fetch?: Fetch; horizon?: string } = {}): Promise<EstadoEnLaRed> {
  if (!esHash(hash)) return "no-se-sabe";
  const f = o.fetch ?? fetch;
  const base = (o.horizon ?? HORIZON_URLS[red]).replace(/\/+$/, "");
  try {
    const signal = AbortSignal.timeout(TOPE_DE_LA_CONSULTA_MS);
    const r = await f(`${base}/transactions/${hash.toLowerCase()}`, { method: "GET", cache: "no-store", signal });
    if (r.status === 404) return "no-esta";
    if (r.status !== 200) return "no-se-sabe";
    const j: unknown = await r.json();
    if (!esObjeto(j)) return "no-se-sabe";
    // El portero la manda envuelta y se pregunta por la de adentro: vale el hash de arriba o el de la de adentro, y ningún otro.
    const esEste = (x: unknown): boolean => typeof x === "string" && x.toLowerCase() === hash.toLowerCase();
    const adentro = esObjeto(j.inner_transaction) ? j.inner_transaction.hash : undefined;
    if (j.hash !== undefined && !esEste(j.hash) && !esEste(adentro)) return "no-se-sabe";
    if (j.successful === true) return "entro";
    return j.successful === false ? "fallo" : "no-se-sabe";
  } catch {
    return "no-se-sabe";
  }
}

/* ------------------------------------------------------------------ el pedido entero */

/** Cuánto se espera antes de cada reenvío del mismo sobre cuando el portero no contestó: 8 reenvíos como mucho. */
export const ESPERAS_DEL_REENVIO_MS: readonly number[] = [3_000, 6_000, 12_000, 20_000, 20_000, 20_000, 20_000, 20_000];
/** Lo que se espera, después de que el sobre ya no puede entrar, a que la red muestre si entró. */
export const MARGEN_TRAS_VENCER_S = 60;
/** Lo que tiene que quedarle de vida al sobre para reenviarlo cuando el portero dice que está ocupado. */
export const VIDA_PARA_REENVIAR_MS = 20_000;
/** Lo más que se espera por un portero ocupado antes de reenviar, aunque diga más. */
const ESPERA_MAXIMA_OCUPADO_MS = 60_000;
/** Cada cuánto se pregunta a la red por el hash: cada 3 s los primeros 30 s y después cada 10 s. */
export const CONSULTA_RAPIDA_MS = 3_000;
export const CONSULTA_LENTA_MS = 10_000;
export const TRAMO_RAPIDO_MS = 30_000;

/**
 * Cómo terminó un pago mandado al portero. `salio`: entró y la plata se movió. `fallo`: entró y falló, no se movió
 * ningún dólar. `no-salio`: un rechazo claro, con el motivo del portero: no salió ni puede salir. `duda`: no se sabe,
 * con el hash para volver a mirar en la red sin volver a mandar.
 */
export type DesenlaceDelPago =
  | { que: "salio"; hash: string }
  | { que: "fallo"; hash: string }
  | { que: "no-salio"; motivo: string; detalle: string | null }
  | { que: "duda"; hash: string };

/** Lo que el pedido entero necesita de afuera. `ahora` en milisegundos. */
export interface DepsDelPago {
  /** Manda el mismo sobre firmado al portero (`pedirElPago`). */
  pedir(): Promise<RespuestaDelPago>;
  /** Pregunta a la red por un hash (`estadoEnLaRed`). */
  enLaRed(hash: string): Promise<EstadoEnLaRed>;
  dormir(ms: number): Promise<void>;
  ahora(): number;
}

/**
 * Pregunta a la red por `hash`, cada 3 s los primeros 30 s y después cada 10 s, hasta saberlo o hasta `hastaMs`. Entró
 * bien es `salio`, entró y falló es `fallo`, y si se acaba el tiempo sin saberlo, `duda`: nunca un no sin que la red lo diga.
 */
export async function seguirElPago(hash: string, hastaMs: number, d: Pick<DepsDelPago, "enLaRed" | "dormir" | "ahora">): Promise<DesenlaceDelPago> {
  const desde = d.ahora();
  for (;;) {
    const espera = d.ahora() - desde < TRAMO_RAPIDO_MS ? CONSULTA_RAPIDA_MS : CONSULTA_LENTA_MS;
    if (d.ahora() + espera > hastaMs) return { que: "duda", hash };
    await d.dormir(espera);
    const e = await d.enLaRed(hash);
    if (e === "entro") return { que: "salio", hash };
    if (e === "fallo") return { que: "fallo", hash };
  }
}

/**
 * El pedido entero de un sobre firmado (`sobre`: su hash y hasta cuándo puede entrar, en segundos). `hastaMs` es hasta
 * cuándo se sigue el pago en la red cuando queda en camino o en duda: nunca más allá del vencimiento más un minuto.
 *
 * 1. Se manda. Si el portero no contesta con algo que se entienda, el sobre queda en duda y se reenvía el MISMO, con las
 *    esperas de `ESPERAS_DEL_REENVIO_MS`, mientras le quede vida. Apenas contesta con el hash, no se reenvía más.
 * 2. Tomado: `ok` salió, `fallo` entró y falló, y en camino se sigue en la red por el hash.
 * 3. Un premio con su puesto ya pagado por esta ruta se sigue por el hash de ese pago, sin armar otro.
 * 4. Un rechazo claro (`esRechazoClaro`) dice que no salió. Con el portero ocupado se espera lo que pide y se reenvía el
 *    mismo sobre, si le queda vida. Cualquier otro no, o uno que llega con el sobre ya en duda, se sigue en la red.
 */
export async function mandarElPago(sobre: { hash: string; vence: number }, hastaMs: number, d: DepsDelPago): Promise<DesenlaceDelPago> {
  const fin = Math.min(hastaMs, (sobre.vence + MARGEN_TRAS_VENCER_S) * 1000);
  const venceMs = sobre.vence * 1000;
  let enDuda = false;
  let reenvios = 0;
  for (;;) {
    const r = await d.pedir();
    if (r.tipo === "tomado") {
      // Un hash que no es el del sobre no dice nada de este pago: se sigue el propio.
      if (r.hash !== sobre.hash) return seguirElPago(sobre.hash, fin, d);
      if (r.estado === "ok") return { que: "salio", hash: sobre.hash };
      if (r.estado === "fallo") return { que: "fallo", hash: sobre.hash };
      return seguirElPago(sobre.hash, fin, d);
    }
    if (r.tipo === "sin-respuesta") {
      enDuda = true;
      const espera = ESPERAS_DEL_REENVIO_MS[reenvios];
      if (espera === undefined || d.ahora() + espera >= venceMs) return seguirElPago(sobre.hash, fin, d);
      await d.dormir(espera);
      reenvios++;
      continue;
    }
    if (r.motivo === "puesto-usado" && r.hash !== null) return seguirElPago(r.hash, fin, d);
    if (!esRechazoClaro(r, enDuda)) return seguirElPago(sobre.hash, fin, d);
    if (r.motivo === "fondo" && r.detalle === "ocupado" && r.reintentarEn !== null && reenvios < ESPERAS_DEL_REENVIO_MS.length) {
      const espera = Math.min(Math.max(0, r.reintentarEn - d.ahora()), ESPERA_MAXIMA_OCUPADO_MS);
      if (venceMs - (d.ahora() + espera) > VIDA_PARA_REENVIAR_MS) {
        await d.dormir(espera);
        reenvios++;
        continue;
      }
    }
    return { que: "no-salio", motivo: r.motivo, detalle: r.detalle };
  }
}
