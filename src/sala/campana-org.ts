/**
 * El cliente de quien organiza una campaña: crear la sala con el archivo firmado, pedir el pase del QR, poner la fase,
 * quitar con motivo y leer el estado. Cada falla vuelve con su motivo y ninguna escribe el token en ningún lado.
 *
 * Cada llamada tiene tiempo límite: con el wifi colgado pero no caído, un `fetch` sin límite deja al panel esperando
 * minutos con el botón apagado. Pasado el límite se cuenta como falta de conexión.
 *
 * También guarda lo que la compu recuerda para retomar después de una recarga: la sala de cada red y lo que ya se hizo.
 */
import type { MotivoDeSalida } from "../../workers/sala/src/campana";
import { type Campana, leerCampana } from "../campana/modelo";
import { generarClave } from "./cifra";
import { esCuentaValida } from "../../workers/sala/src/logica";
import { type Dependencias, type EquipoDeSala, type Sala, servicioDeSala } from "./cliente";

export type { MotivoDeSalida };
/** Los motivos en el orden de los botones. La sala acepta exactamente estos (`MOTIVOS_DE_SALIDA`). */
export const MOTIVOS = ["repetida", "evento", "pidio", "otro"] as const satisfies readonly MotivoDeSalida[];

/** Cuánto se espera una respuesta de la sala antes de darla por perdida. */
export const PLAZO_MS = 10_000;

export type RedDeCampana = "mainnet" | "testnet";

/** Una sala de campaña tal como la recuerda la compu de quien organiza. */
export interface SalaDeCampana extends Sala {
  evento: string;
  red: RedDeCampana;
}
export type FallaAlCrear = "forma" | "firma" | "ya-existe" | "vencida" | "cupo-campanas" | "origen" | "red";
/**
 * Lo que puede salir mal en una llamada con token: la sala ya no está, la sala dijo que no, la hora pedida no vale, o no
 * hubo respuesta a tiempo.
 */
export type FallaDeSala = "no-existe" | "rechazo" | "forma" | "red";
export type FaseDeSala = "lista" | "abierta" | "cerrada" | "sellada" | "sorteada";
export interface EstadoDeSala {
  fase: FaseDeSala;
  total: number;
  cierraMs: number;
  /** Cuántas personas se quitaron en total (la suma por motivo). Si la sala no lo dice, no está. */
  quitadas?: number;
}
export interface PaseDeSala {
  p: string;
  hasta: number;
}

/** Lo que se le puede cambiar a las llamadas desde afuera: en las pruebas, la señal que corta la espera. */
export interface DependenciasOrg extends Dependencias {
  senal?: () => AbortSignal;
}

const senalPorDefecto = (): AbortSignal => AbortSignal.timeout(PLAZO_MS);

/** Hace la llamada con su límite de tiempo. `null` si no hubo respuesta (sin red, cortada o pasado el plazo). */
async function llamar(dep: DependenciasOrg, url: string, init: RequestInit): Promise<Response | null> {
  try {
    return await (dep.fetch ?? fetch)(url, { ...init, signal: (dep.senal ?? senalPorDefecto)() });
  } catch {
    return null;
  }
}

const auth = (s: Sala): Record<string, string> => ({ Authorization: `Bearer ${s.token}` });
const conCuerpo = (s: Sala): Record<string, string> => ({ ...auth(s), "Content-Type": "application/json" });
const rutaDe = (s: Sala, resto: string): string => `${s.servicio}/v1/sala/${s.id}${resto}`;

/** El motivo que dice la sala, no el estado: 403 y 409 se repiten entre motivos distintos. */
async function motivoDe(r: Response): Promise<string | undefined> {
  const error = ((await r.json().catch(() => ({}))) as { error?: unknown }).error;
  return typeof error === "string" ? error : undefined;
}

/** Qué falla es una respuesta que no fue buena: sala que no está, hora que no vale, otro rechazo, o sin respuesta. */
function fallaConMotivo(estado: number, error: string | undefined): FallaDeSala {
  if (estado === 404 && error === "no-existe") return "no-existe";
  if (estado === 400 && error === "forma") return "forma";
  if (estado >= 400 && estado < 500) return "rechazo";
  return "red";
}

async function fallaDe(r: Response): Promise<FallaDeSala> {
  return fallaConMotivo(r.status, await motivoDe(r));
}

/** Los motivos de la sala que tienen texto propio. Lo demás (sin-llave, ocupado, otro estado) es de conexión. */
const DE_LA_SALA: Record<string, FallaAlCrear> = {
  forma: "forma",
  firma: "firma",
  "ya-existe": "ya-existe",
  vencida: "vencida",
  "cupo-campanas": "cupo-campanas",
  origen: "origen",
};
const ES_ID = /^[0-9A-Za-z]{8}$/u;
const ES_TOKEN = /^[A-Za-z0-9_-]{22}$/u;
const ES_PASE = /^[A-Za-z0-9_-]{12}$/u;
const ES_EVENTO = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/u;

/**
 * Crea la sala de la campaña con el archivo firmado, tal cual. Si la sala anterior de este evento se cerró o venció,
 * `anterior` es el token que tenía: sin él la sala contesta que ya existe, igual que con la sala viva.
 *
 * `intento` es el token que inventa esta compu para este archivo y que se repite en cada reintento: si la sala llegó a
 * crearse pero la respuesta se perdió, el pedido repetido vuelve a recibir esa misma sala en vez de `ya-existe`.
 */
export async function crearCampanaEnSala(
  archivo: { texto: string; firma: string },
  de: { evento: string; red: RedDeCampana; anterior?: string | null; intento?: string },
  dep: DependenciasOrg = {},
  servicio = servicioDeSala(),
): Promise<{ ok: true; sala: SalaDeCampana } | { ok: false; motivo: FallaAlCrear }> {
  const cuerpo = JSON.stringify({ texto: archivo.texto, firma: archivo.firma, ...(de.intento ? { intento: de.intento } : {}) });
  const cabeceras: Record<string, string> = { "Content-Type": "application/json" };
  if (de.anterior) cabeceras.Authorization = `Bearer ${de.anterior}`;
  const r = await llamar(dep, `${servicio}/v1/campana`, { method: "POST", headers: cabeceras, body: cuerpo });
  if (!r) return { ok: false, motivo: "red" };
  if (r.status !== 201) {
    const error = await motivoDe(r);
    return { ok: false, motivo: (error === undefined ? undefined : DE_LA_SALA[error]) ?? "red" };
  }
  const x = (await r.json().catch(() => null)) as { id?: unknown; token?: unknown; vence?: unknown } | null;
  if (!x || typeof x.id !== "string" || !ES_ID.test(x.id) || typeof x.token !== "string" || !ES_TOKEN.test(x.token)) {
    return { ok: false, motivo: "red" };
  }
  if (typeof x.vence !== "number" || !Number.isFinite(x.vence)) return { ok: false, motivo: "red" };
  const sala: SalaDeCampana = {
    id: x.id,
    token: x.token,
    vence: x.vence,
    servicio,
    clave: generarClave(),
    evento: de.evento,
    red: de.red,
  };
  return { ok: true, sala };
}

/** El pase que va en el QR. Vale entre 14 y 16 minutos: se pide otro en el instante `hasta`. */
export async function pedirPase(s: Sala, dep: DependenciasOrg = {}): Promise<PaseDeSala | FallaDeSala> {
  const r = await llamar(dep, rutaDe(s, "/campana/pase"), { headers: auth(s) });
  if (!r) return "red";
  if (!r.ok) return fallaDe(r);
  const x = (await r.json().catch(() => null)) as { p?: unknown; hasta?: unknown } | null;
  if (!x || typeof x.p !== "string" || !ES_PASE.test(x.p) || typeof x.hasta !== "number" || !Number.isSafeInteger(x.hasta)) {
    return "red";
  }
  return { p: x.p, hasta: x.hasta };
}

/** Pone la fase. Sin hora de cierre el campo no se manda: la sala rechaza `null` y conserva el cierre anterior. */
export async function ponerFase(
  s: Sala,
  fase: "abierta" | "cerrada",
  cierraMs: number | null,
  dep: DependenciasOrg = {},
): Promise<true | FallaDeSala> {
  const cuerpo = JSON.stringify(cierraMs === null ? { fase } : { fase, cierraMs });
  const r = await llamar(dep, rutaDe(s, "/campana/fase"), { method: "PUT", headers: conCuerpo(s), body: cuerpo });
  if (!r) return "red";
  return r.status === 204 ? true : fallaDe(r);
}

/** Saca a una persona con su motivo. Quien ya no estaba cuenta como quitada: quitar dos veces es lo mismo que una. */
export async function quitarConMotivo(
  s: Sala,
  n: number,
  motivo: MotivoDeSalida,
  dep: DependenciasOrg = {},
): Promise<true | FallaDeSala> {
  const r = await llamar(dep, rutaDe(s, "/campana/quitar"), {
    method: "POST",
    headers: conCuerpo(s),
    body: JSON.stringify({ n, motivo }),
  });
  if (!r) return "red";
  if (r.status === 204) return true;
  const error = await motivoDe(r);
  // Esa persona ya no estaba: quitar dos veces es lo mismo que una.
  if (r.status === 404 && error === "no-esta") return true;
  return fallaConMotivo(r.status, error);
}

const FASES: readonly string[] = ["lista", "abierta", "cerrada", "sellada", "sorteada"];
const esFase = (x: unknown): x is FaseDeSala => typeof x === "string" && FASES.includes(x);

/** Las quitadas por motivo, sumadas. `undefined` si la sala no las dice. */
function sumaDeQuitadas(x: unknown): number | undefined {
  if (!esObjeto(x) || Object.keys(x).length === 0) return undefined;
  let suma = 0;
  for (const v of Object.values(x)) {
    if (!esEntero(v) || v < 0) return undefined;
    suma += v;
  }
  return suma;
}

/** La fase, el total de personas, la hora de cierre y cuántas se quitaron, que tiene la sala. */
export async function estadoConToken(s: Sala, dep: DependenciasOrg = {}): Promise<EstadoDeSala | FallaDeSala> {
  const r = await llamar(dep, rutaDe(s, "/campana/estado"), { headers: auth(s) });
  if (!r) return "red";
  if (!r.ok) return fallaDe(r);
  const x = (await r.json().catch(() => null)) as { fase?: unknown; total?: unknown; cierraMs?: unknown; quitadas?: unknown } | null;
  if (!x || !esFase(x.fase) || !Number.isSafeInteger(x.total) || !Number.isSafeInteger(x.cierraMs)) return "red";
  const quitadas = sumaDeQuitadas(x.quitadas);
  return { fase: x.fase, total: x.total as number, cierraMs: x.cierraMs as number, ...(quitadas === undefined ? {} : { quitadas }) };
}

/** La campaña tal como la firmó Tinkazo, para retomar sin tener el archivo. */
export async function leerCampanaDeSala(s: Sala, dep: DependenciasOrg = {}): Promise<Campana | FallaDeSala> {
  const r = await llamar(dep, rutaDe(s, "/campana"), {});
  if (!r) return "red";
  if (!r.ok) return fallaDe(r);
  const x = (await r.json().catch(() => null)) as { texto?: unknown } | null;
  if (!x || typeof x.texto !== "string") return "red";
  let datos: unknown;
  try {
    datos = JSON.parse(x.texto);
  } catch {
    return "rechazo";
  }
  const lectura = leerCampana(datos);
  return lectura.ok ? lectura.campana : "rechazo";
}

/** Cierra y borra una sala que no llegó a tener a nadie, para que el evento quede libre. `true` si quedó cerrada. */
export async function borrarSalaVacia(s: Sala, dep: DependenciasOrg = {}): Promise<boolean> {
  const r = await llamar(dep, rutaDe(s, ""), { method: "DELETE", headers: auth(s) });
  return r !== null && (r.status === 204 || r.status === 404);
}

/* ------------------------------------------------------------ la lista completa, el sello y el resultado */

/** Cuántas vueltas de 200 se piden como mucho al leer la lista entera: una campaña admite 300. */
const VUELTAS_DE_LECTURA = 10;

/** Una fila de `GET equipos` tal como la devuelve la sala, o `null` si no tiene la forma: no se descarta en silencio. */
function leerFila(x: unknown): EquipoDeSala | null {
  if (!esObjeto(x)) return null;
  const { n, cuenta, d, estado, v } = x;
  if (!esEntero(n) || n < 1 || !esEntero(v) || v < 0 || typeof d !== "string" || typeof estado !== "string") return null;
  if (!esCuentaValida(cuenta)) return null;
  return { n, cuenta, d, estado, v };
}

/** Una vuelta de la lista: las filas con versión mayor que `desde`, o `null` si el pedido falló o alguna fila no se entiende. */
async function leerVuelta(s: Sala, desde: number, dep: DependenciasOrg): Promise<EquipoDeSala[] | null> {
  const r = await llamar(dep, rutaDe(s, `/equipos?desde=${desde}`), { headers: auth(s) });
  if (!r || !r.ok) return null;
  const x: unknown = await r.json().catch(() => null);
  if (!Array.isArray(x)) return null;
  const filas: EquipoDeSala[] = [];
  for (const crudo of x) {
    const fila = leerFila(crudo);
    if (!fila) return null;
    filas.push(fila);
  }
  return filas;
}

/**
 * Todas las anotadas de la sala con la lista cerrada, de a 200 (lo que trae la sala por vuelta). Mira el estado ANTES y
 * DESPUÉS de las páginas: tiene que estar cerrada las dos veces, con el mismo total y las mismas quitadas, y una última
 * página vacía, pedida después del segundo estado, confirma que nadie entró entre medio. La cantidad leída tiene que ser
 * el total. Si algo no coincide, o cualquier pedido falla, `null` y la lista no se pasa.
 */
export async function leerTodasLasAnotadas(s: Sala, dep: DependenciasOrg = {}): Promise<EquipoDeSala[] | null> {
  const antes = await estadoConToken(s, dep);
  if (typeof antes === "string" || antes.fase !== "cerrada") return null;
  const leidas: EquipoDeSala[] = [];
  let desde = 0;
  let terminada = false;
  for (let vuelta = 0; vuelta < VUELTAS_DE_LECTURA && !terminada; vuelta++) {
    const filas = await leerVuelta(s, desde, dep);
    if (!filas) return null;
    if (filas.length === 0) terminada = true;
    leidas.push(...filas);
    desde = Math.max(desde, ...filas.map((f) => f.v));
  }
  if (!terminada) return null;
  const despues = await estadoConToken(s, dep);
  if (typeof despues === "string" || despues.fase !== "cerrada") return null;
  if (despues.total !== antes.total || despues.quitadas !== antes.quitadas) return null;
  if (leidas.length !== despues.total || new Set(leidas.map((f) => f.n)).size !== leidas.length) return null;
  const ultima = await leerVuelta(s, desde, dep);
  return ultima !== null && ultima.length === 0 ? leidas : null;
}

/** Lo que la sala contesta a un aviso de sellada: su motivo, o `red` si no hubo respuesta que se entienda. */
export type RespuestaDeSellada =
  | "ok"
  | "fase"
  | "sin-sorteo"
  | "ronda-pasada"
  | "ganadores-distintos"
  | "organizador-distinto"
  | "lista-distinta"
  | "no-existe"
  | "token"
  | "forma"
  | "red";
const DE_SELLADA: readonly RespuestaDeSellada[] = [
  "fase",
  "sin-sorteo",
  "ronda-pasada",
  "ganadores-distintos",
  "organizador-distinto",
  "lista-distinta",
  "no-existe",
  "token",
  "forma",
];

/** La hora de la sala según su cabecera `Date` (con un segundo de precisión), si el navegador la deja leer. */
function horaDeLaSala(r: Response | null): number | null {
  const crudo = r?.headers.get("Date");
  const ms = crudo ? Date.parse(crudo) : Number.NaN;
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Le avisa a la sala el número del sorteo sellado. La sala comprueba todo en la red, así que el sitio no manda lista ni
 * huella. `plazoMs` es lo que vive este pedido: no se corta antes, porque el Worker lee la red hasta 10 s por cada RPC y un
 * aviso que tarda igual entra. El número va como texto: es un bigint y JSON no lo escribe.
 */
export async function ponerSellada(
  s: Sala,
  sorteo: string,
  dep: DependenciasOrg = {},
  plazoMs?: number,
): Promise<{ r: RespuestaDeSellada; horaSala: number | null }> {
  const conPlazo: DependenciasOrg = plazoMs === undefined ? dep : { ...dep, senal: () => AbortSignal.timeout(Math.max(1, Math.floor(plazoMs))) };
  const r = await llamar(conPlazo, rutaDe(s, "/campana/fase"), {
    method: "PUT",
    headers: conCuerpo(s),
    body: JSON.stringify({ fase: "sellada", sorteo }),
  });
  const horaSala = horaDeLaSala(r);
  if (!r) return { r: "red", horaSala };
  if (r.status === 204) return { r: "ok", horaSala };
  const motivo = await motivoDe(r);
  return { r: DE_SELLADA.find((m) => m === motivo) ?? "red", horaSala };
}

export type RespuestaDeResultado = "ok" | "sin-resultado" | "fase" | "distinto" | "no-existe" | "token" | "forma" | "red";
const DE_RESULTADO: readonly RespuestaDeResultado[] = ["sin-resultado", "fase", "distinto", "no-existe", "token", "forma"];

/** Le avisa a la sala el comprobante del sorteo: ella lee las ganadoras del contrato, nunca de lo que manda el sitio. */
export async function guardarResultadoEnSala(
  s: Sala,
  sorteo: string,
  comprobante: string,
  dep: DependenciasOrg = {},
): Promise<RespuestaDeResultado> {
  const r = await llamar(dep, rutaDe(s, "/campana/resultado"), {
    method: "PUT",
    headers: conCuerpo(s),
    body: JSON.stringify({ sorteo, comprobante }),
  });
  if (!r) return "red";
  if (r.status === 204) return "ok";
  const motivo = await motivoDe(r);
  return DE_RESULTADO.find((m) => m === motivo) ?? "red";
}

/** El resultado como lo ve un celular: las ganadoras en orden de puesto, sacadas del contrato por la sala. */
export interface ResultadoDeSala {
  sorteo: string;
  ganadoras: string[];
  comprobante: string;
}

/** Lee el resultado que la sala guardó, sin token. En este pedido `sin-resultado` es un 404. */
export async function resultadoDeSala(s: Sala, dep: DependenciasOrg = {}): Promise<ResultadoDeSala | "sin-resultado" | "no-existe" | "red"> {
  const r = await llamar(dep, rutaDe(s, "/campana/resultado"), {});
  if (!r) return "red";
  if (r.status === 404) return (await motivoDe(r)) === "sin-resultado" ? "sin-resultado" : "no-existe";
  if (!r.ok) return "red";
  const x = (await r.json().catch(() => null)) as { sorteo?: unknown; ganadoras?: unknown; comprobante?: unknown } | null;
  if (!x || typeof x.sorteo !== "string" || typeof x.comprobante !== "string" || !Array.isArray(x.ganadoras)) return "red";
  const ganadoras: string[] = [];
  for (const g of x.ganadoras as unknown[]) {
    if (!esCuentaValida(g)) return "red";
    ganadoras.push(g);
  }
  return { sorteo: x.sorteo, ganadoras, comprobante: x.comprobante };
}

export type RespuestaDeAviso = "ok" | "no-gano" | "no-existe" | "token" | "forma" | "red";
const DE_AVISO: readonly RespuestaDeAviso[] = ["no-gano", "no-existe", "token", "forma"];

/** Marca a una ganadora como avisada en su celular. `no-gano` es que la sala no la tiene entre las ganadoras. */
export async function avisarEnSala(s: Sala, cuenta: string, dep: DependenciasOrg = {}): Promise<RespuestaDeAviso> {
  const r = await llamar(dep, rutaDe(s, "/campana/avisar"), { method: "POST", headers: conCuerpo(s), body: JSON.stringify({ cuenta }) });
  if (!r) return "red";
  if (r.status === 204) return "ok";
  const motivo = await motivoDe(r);
  return DE_AVISO.find((m) => m === motivo) ?? "red";
}

/** La cuenta que la campaña nombra para sellar (campo `organizadora` del texto firmado), `null` si no nombra ninguna. */
export async function leerOrganizadora(s: Sala, dep: DependenciasOrg = {}): Promise<string | null | FallaDeSala> {
  const r = await llamar(dep, rutaDe(s, "/campana"), {});
  if (!r) return "red";
  if (!r.ok) return fallaDe(r);
  const x = (await r.json().catch(() => null)) as { texto?: unknown } | null;
  if (!x || typeof x.texto !== "string") return "red";
  try {
    const datos: unknown = JSON.parse(x.texto);
    const org = esObjeto(datos) ? datos.organizadora : undefined;
    if (org === undefined || org === null) return null;
    return esCuentaValida(org) ? org : "rechazo";
  } catch {
    return "rechazo";
  }
}

/* ------------------------------------------------------------ lo que recuerda la compu */

export const CLAVE_ORG = "tinkazo.campana.org";
/** El token de la última sala de cada evento: sin él, el mismo archivo no vuelve a abrir una sala que ya se cerró. */
export const CLAVE_EVENTOS_ORG = "tinkazo.campana.eventos";
/** Cuántos eventos recuerda la compu. */
const MAX_EVENTOS = 5;

/**
 * El intento con que se pidió la sala de cada archivo (evento y firma): si la respuesta de crearla se perdió y la pestaña se
 * recargó, el mismo archivo repite el mismo intento y la sala lo reconoce. Sin esto el evento queda con una sala que nadie
 * puede reclamar.
 */
export const CLAVE_INTENTOS_ORG = "tinkazo.campana.intentos";

interface IntentoGuardado {
  evento: string;
  firma: string;
  intento: string;
}

function leerIntentos(a: Almacen): IntentoGuardado[] {
  try {
    const x: unknown = JSON.parse(a.getItem(CLAVE_INTENTOS_ORG) ?? "[]");
    if (!Array.isArray(x)) return [];
    const lista: IntentoGuardado[] = [];
    for (const e of x) {
      if (!esObjeto(e)) continue;
      const { evento, firma, intento } = e;
      if (typeof evento !== "string" || !ES_EVENTO.test(evento)) continue;
      if (typeof firma !== "string" || firma === "") continue;
      if (typeof intento !== "string" || !ES_TOKEN.test(intento)) continue;
      lista.push({ evento, firma, intento });
    }
    return lista;
  } catch {
    return [];
  }
}

function escribirIntentos(a: Almacen, lista: IntentoGuardado[]): void {
  try {
    if (lista.length === 0) a.removeItem(CLAVE_INTENTOS_ORG);
    else a.setItem(CLAVE_INTENTOS_ORG, JSON.stringify(lista.slice(0, MAX_EVENTOS)));
  } catch {
    /* sin lugar: se pierde solo la recuperación tras recargar */
  }
}

/** El intento guardado para ese archivo (evento y firma), o `null`. */
export function intentoDeArchivo(a: Almacen | null, evento: string, firma: string): string | null {
  if (!a) return null;
  return leerIntentos(a).find((e) => e.evento === evento && e.firma === firma)?.intento ?? null;
}

/** Guarda el intento de ese archivo antes de pedir la sala. Un evento recuerda uno solo, el último. */
export function guardarIntentoDeArchivo(a: Almacen | null, e: IntentoGuardado): void {
  if (!a) return;
  escribirIntentos(a, [e, ...leerIntentos(a).filter((x) => x.evento !== e.evento)]);
}

/** Olvida el intento de ese evento: la sala ya se creó y llegó su token, o no hace falta repetirlo. */
export function olvidarIntentoDeArchivo(a: Almacen | null, evento: string): void {
  if (!a) return;
  const lista = leerIntentos(a);
  const quedan = lista.filter((x) => x.evento !== evento);
  if (quedan.length !== lista.length) escribirIntentos(a, quedan);
}

/** Una persona que se está por quitar: se manda a la sala a los 5 segundos, y hasta entonces se puede deshacer. */
export interface QuitaPendiente {
  n: number;
  motivo: MotivoDeSalida;
}

/** Lo que se guarda para retomar: la sala y lo que ya se hizo. */
export interface MemoriaDeOrg {
  sala: SalaDeCampana;
  fase: FaseDeSala;
  /** Las filas que quien organiza ya miró y dejó mostrar (Mostrar), para no volver a esconderlas al recargar. */
  mostradas?: number[];
  /** Las quitas con Deshacer en curso: si se recarga en esos 5 segundos, igual se mandan al volver. */
  pendientes?: QuitaPendiente[];
}
type Almacen = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type TodasLasSalas = Partial<Record<RedDeCampana, MemoriaDeOrg>>;

const SERVICIOS = /^(?:https:\/\/s\.tinkazo\.app|https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d{1,5})?)$/u;
const esEntero = (x: unknown): x is number => typeof x === "number" && Number.isSafeInteger(x);
const esObjeto = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);

/** Una sala guardada, comprobada campo por campo: lo que no se entiende no se retoma. */
function leerSala(x: unknown, red: RedDeCampana, ahora: number): SalaDeCampana | null {
  if (!esObjeto(x)) return null;
  const { id, token, clave, vence, servicio, evento } = x;
  if (typeof id !== "string" || !ES_ID.test(id)) return null;
  if (typeof token !== "string" || !ES_TOKEN.test(token)) return null;
  if (typeof clave !== "string" || !ES_TOKEN.test(clave)) return null;
  if (typeof vence !== "number" || !Number.isFinite(vence) || vence <= ahora) return null;
  if (typeof servicio !== "string" || !SERVICIOS.test(servicio)) return null;
  if (typeof evento !== "string" || !ES_EVENTO.test(evento)) return null;
  if (x.red !== red) return null;
  return { id, token, clave, vence, servicio, evento, red };
}

function leerMemoria(x: unknown, red: RedDeCampana, ahora: number): MemoriaDeOrg | null {
  if (!esObjeto(x)) return null;
  const sala = leerSala(x.sala, red, ahora);
  if (!sala || !esFase(x.fase)) return null;
  const memoria: MemoriaDeOrg = { sala, fase: x.fase };
  if (Array.isArray(x.mostradas)) memoria.mostradas = x.mostradas.filter((n): n is number => esEntero(n) && n >= 1).slice(0, 400);
  if (Array.isArray(x.pendientes)) {
    const lista: QuitaPendiente[] = [];
    for (const p of x.pendientes) {
      if (!esObjeto(p) || !esEntero(p.n) || p.n < 1) continue;
      const motivo = MOTIVOS.find((m) => m === p.motivo);
      if (motivo) lista.push({ n: p.n, motivo });
    }
    memoria.pendientes = lista.slice(0, 50);
  }
  return memoria;
}

/** Todo lo guardado, sin mirar si vence. Lo que no es un objeto se descarta. */
function leerTodo(a: Almacen | null): Record<string, unknown> {
  if (!a) return {};
  try {
    const crudo = a.getItem(CLAVE_ORG);
    if (!crudo) return {};
    const x: unknown = JSON.parse(crudo);
    return esObjeto(x) ? x : {};
  } catch {
    return {};
  }
}

function escribirTodo(a: Almacen | null, todo: Record<string, unknown>): void {
  if (!a) return;
  try {
    if (Object.keys(todo).length === 0) a.removeItem(CLAVE_ORG);
    else a.setItem(CLAVE_ORG, JSON.stringify(todo));
  } catch {
    /* sin lugar o bloqueado: el panel anda igual, solo que no retoma */
  }
}

/** Guarda la sala de su red. La de la otra red no se toca: cada red tiene la suya. */
export function guardarOrg(a: Almacen | null, m: MemoriaDeOrg): void {
  const todo = leerTodo(a);
  todo[m.sala.red] = m;
  escribirTodo(a, todo);
}

/** Saca la sala de esa red. La de la otra queda. */
export function borrarOrg(a: Almacen | null, red: RedDeCampana): void {
  const todo = leerTodo(a);
  delete todo[red];
  escribirTodo(a, todo);
}

/**
 * La sala guardada de esa red, o `null`. Si no se entiende o ya venció, la borra. `ahora` entra como parámetro: las
 * pruebas no usan reloj.
 */
export function leerOrg(a: Almacen | null, ahora: number, red: RedDeCampana): MemoriaDeOrg | null {
  const todo = leerTodo(a);
  if (todo[red] === undefined) return null;
  const memoria = leerMemoria(todo[red], red, ahora);
  if (!memoria) borrarOrg(a, red);
  return memoria;
}

/** El token de la última sala creada de cada evento. Hasta cinco eventos, el más nuevo primero. */
export function guardarTokenDeEvento(a: Almacen | null, e: { evento: string; token: string }): void {
  if (!a) return;
  try {
    const otros = leerEventos(a).filter((x) => x.evento !== e.evento);
    a.setItem(CLAVE_EVENTOS_ORG, JSON.stringify([e, ...otros].slice(0, MAX_EVENTOS)));
  } catch {
    /* sin lugar: el evento queda sin su token y habrá que pedir otro archivo */
  }
}

function leerEventos(a: Almacen): { evento: string; token: string }[] {
  try {
    const x: unknown = JSON.parse(a.getItem(CLAVE_EVENTOS_ORG) ?? "[]");
    if (!Array.isArray(x)) return [];
    const lista: { evento: string; token: string }[] = [];
    for (const e of x) {
      if (esObjeto(e) && typeof e.evento === "string" && ES_EVENTO.test(e.evento) && typeof e.token === "string" && ES_TOKEN.test(e.token)) {
        lista.push({ evento: e.evento, token: e.token });
      }
    }
    return lista;
  } catch {
    return [];
  }
}

/** El token de la última sala de ese evento, o `null` si esta compu no la creó. */
export function tokenDeEvento(a: Almacen | null, evento: string): string | null {
  if (!a) return null;
  return leerEventos(a).find((e) => e.evento === evento)?.token ?? null;
}
