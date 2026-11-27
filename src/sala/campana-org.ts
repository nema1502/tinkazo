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
import { seVeDesde } from "../campana/de-quien";
import { type Campana, leerCampana } from "../campana/modelo";
import { generarClave } from "./cifra";
import { esCuentaValida } from "../../workers/sala/src/logica";
import { formaDeLista } from "../campana/forma-de-lista";
import { type Dependencias, type EquipoDeSala, type Sala, servicioDeSala } from "./cliente";
import { horaDeLaSala } from "./hora";

export type { MotivoDeSalida };
export { puedeMoverLaSala, seVeDesde } from "../campana/de-quien";
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
 * Lo que puede salir mal en una llamada con token: la sala ya no está, la sala ya no acepta este token (otra compu tomó la
 * campaña), la sala dijo que no, la hora pedida no vale, o no hubo respuesta a tiempo.
 */
export type FallaDeSala = "no-existe" | "token" | "rechazo" | "forma" | "red";
export type FaseDeSala = "lista" | "abierta" | "cerrada" | "sellada" | "sorteada";
export interface EstadoDeSala {
  fase: FaseDeSala;
  total: number;
  cierraMs: number;
  /** Cuántas personas se quitaron en total (la suma por motivo). Si la sala no lo dice, no está. */
  quitadas?: number;
  /** Si el token con que se preguntó es el vigente de la sala. Solo viene de una sala que lo sabe decir. */
  tuya?: boolean;
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
  // El token no es el vigente: no es un rechazo común ni una caída, y no se arregla reintentando.
  if (estado === 403 && error === "token") return "token";
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

/**
 * Por qué la sala no activó una campaña. Cada motivo es un código que dice la sala (`error`), y `sin-respuesta` es que no
 * hubo respuesta que se entienda (sin red, cortada, pasado el plazo o un estado que la sala no usa para esto).
 */
export type MotivoDeActivar =
  | "forma"
  | "red-principal"
  | "sesion"
  | "no-google"
  | "organizadora"
  | "no-pagada"
  | "sin-fondos"
  | "limite"
  | "red"
  | "acceso"
  | "apagada"
  | "sin-llave"
  | "sin-pollar"
  | "sin-respuesta";

export type ResultadoDeActivar =
  | { ok: true; archivo: { texto: string; firma: string }; evento: string; organizadora: string }
  | { ok: false; motivo: MotivoDeActivar; campo?: string };

/**
 * La sala lee la red de a tres páginas de a 8 segundos antes de contestar: este pedido espera más que los demás. Pasado el
 * plazo se cuenta como sin respuesta, y repetirlo es inofensivo (la firma de un mismo texto es siempre la misma).
 */
export const PLAZO_DE_ACTIVAR_MS = 45_000;

/** Lo que la sala dice con cada estado y cada código: el motivo que el panel sabe contar. */
const DE_ACTIVAR: Record<string, MotivoDeActivar> = {
  "400:forma": "forma",
  "400:red": "red-principal",
  "401:sesion": "sesion",
  "403:no-google": "no-google",
  "403:organizadora": "organizadora",
  "402:no-pagada": "no-pagada",
  "402:sin-fondos": "sin-fondos",
  "502:red": "red",
  "502:acceso": "acceso",
  "503:apagada": "apagada",
  "503:sin-llave": "sin-llave",
  "503:sin-pollar": "sin-pollar",
  "503:sin-portero": "apagada",
  // Una campaña de personas con la sala sin las personas prendidas: no se arregla reintentando enseguida, igual que apagada.
  "503:personas-apagadas": "apagada",
};

/** Cuánto espera la pregunta de si la sala puede activar: la sala le pregunta al portero, de a 8 segundos. */
export const PLAZO_DE_PREGUNTAR_MS = 15_000;

/**
 * Si la sala puede activar campañas ahora, antes de cobrar: se le manda el pedido de activar con el cuerpo vacío, que no mira la
 * red ni gasta nada. Con la sala y el portero listos contesta 400 forma. Apagada, sin sus llaves, sin el portero o la sala de
 * antes (sin la ruta) contestan otra cosa, y sin respuesta tampoco se sabe: en todos esos casos no se cobra.
 */
export async function salaPuedeActivar(dep: DependenciasOrg = {}, servicio = servicioDeSala()): Promise<boolean> {
  const conPlazo: DependenciasOrg = { ...dep, senal: dep.senal ?? ((): AbortSignal => AbortSignal.timeout(PLAZO_DE_PREGUNTAR_MS)) };
  const r = await llamar(conPlazo, `${servicio}/v1/activar`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  if (!r || r.status !== 400) return false;
  const x = (await r.json().catch(() => null)) as Record<string, unknown> | null;
  return x !== null && x.error === "forma";
}
const ES_FIRMA_ACTIVADA = /^(?:[0-9a-f]{128}|[A-Za-z0-9_-]{86})$/u;

/**
 * Le pide a la sala que firme y deje lista la campaña de un borrador, con la sesión de Google de quien organiza. La sala
 * comprueba en la red que la comisión se pagó desde esa cuenta y que hay fondos, y recién entonces firma: el sitio no manda
 * firma ni cuenta de nada. El token de la sesión viaja solo en el cuerpo y de acá no pasa: no se guarda ni se escribe.
 * Con la respuesta buena el archivo es el de siempre: sigue el camino de crear la sala.
 */
export async function activarCampana(
  pedido: { texto: string; sesion: string },
  dep: DependenciasOrg = {},
  servicio = servicioDeSala(),
): Promise<ResultadoDeActivar> {
  const conPlazo: DependenciasOrg = { ...dep, senal: dep.senal ?? ((): AbortSignal => AbortSignal.timeout(PLAZO_DE_ACTIVAR_MS)) };
  const r = await llamar(conPlazo, `${servicio}/v1/activar`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ texto: pedido.texto, sesion: pedido.sesion }),
  });
  if (!r) return { ok: false, motivo: "sin-respuesta" };
  const x = (await r.json().catch(() => null)) as Record<string, unknown> | null;
  if (r.status !== 200) {
    const error = x && typeof x.error === "string" ? x.error : "";
    // El tope por día o por conexión es un 429 con cualquier código: el texto es el mismo.
    const motivo = r.status === 429 ? "limite" : (DE_ACTIVAR[`${r.status}:${error}`] ?? "sin-respuesta");
    const campo = motivo === "forma" && x && typeof x.campo === "string" ? x.campo.slice(0, 40) : undefined;
    return campo === undefined ? { ok: false, motivo } : { ok: false, motivo, campo };
  }
  const { texto, firma, evento, organizadora } = x ?? {};
  if (typeof texto !== "string" || typeof firma !== "string" || !ES_FIRMA_ACTIVADA.test(firma)) return { ok: false, motivo: "sin-respuesta" };
  if (typeof evento !== "string" || !ES_EVENTO.test(evento) || !esCuentaValida(organizadora)) return { ok: false, motivo: "sin-respuesta" };
  return { ok: true, archivo: { texto, firma }, evento, organizadora };
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
  const x = (await r.json().catch(() => null)) as { fase?: unknown; total?: unknown; cierraMs?: unknown; quitadas?: unknown; tuya?: unknown } | null;
  if (!x || !esFase(x.fase) || !Number.isSafeInteger(x.total) || !Number.isSafeInteger(x.cierraMs)) return "red";
  const quitadas = sumaDeQuitadas(x.quitadas);
  return {
    fase: x.fase,
    total: x.total as number,
    cierraMs: x.cierraMs as number,
    ...(quitadas === undefined ? {} : { quitadas }),
    ...(typeof x.tuya === "boolean" ? { tuya: x.tuya } : {}),
  };
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

/**
 * Una fila de `GET equipos` tal como la devuelve la sala, o `null` si no tiene la forma: no se descarta en silencio. El campo
 * `cuenta` es una cuenta o una línea de persona, y cuál de las dos lo decide la lista entera (`formaDeLista`), no cada fila.
 */
function leerFila(x: unknown): EquipoDeSala | null {
  if (!esObjeto(x)) return null;
  const { n, cuenta, d, estado, v } = x;
  if (!esEntero(n) || n < 1 || !esEntero(v) || v < 0 || typeof d !== "string" || typeof estado !== "string") return null;
  if (typeof cuenta !== "string") return null;
  return { n, cuenta, d, estado, v };
}

/** Una vuelta de la lista: las filas con versión mayor que `desde`, o `null` si el pedido falló o alguna fila no tiene la forma de una fila. */
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
 *
 * La lista tiene que ser de una sola forma: toda de cuentas o toda de líneas de persona. Una fila que no es ni una ni otra,
 * sin ninguna línea de persona, es lo de siempre: `null` en cuanto se lee, sin pedir más. Una lista con líneas de persona
 * junto a otra cosa no se sortea y reintentar no la cambia. Quien lo sabe tratar pide `{ distinguirMezclada: true }` y recibe
 * `"mezclada"`, y solo si la lectura fue estable de punta a punta. Sin pedirlo, la mezcla es `null`, como cualquier lectura
 * que no sirve: así quien llama sin saber de personas sigue haciendo lo mismo que antes.
 */
export function leerTodasLasAnotadas(s: Sala, dep?: DependenciasOrg): Promise<EquipoDeSala[] | null>;
export function leerTodasLasAnotadas(
  s: Sala,
  dep: DependenciasOrg,
  como: { distinguirMezclada: true },
): Promise<EquipoDeSala[] | "mezclada" | null>;
export async function leerTodasLasAnotadas(
  s: Sala,
  dep: DependenciasOrg = {},
  como: { distinguirMezclada?: boolean } = {},
): Promise<EquipoDeSala[] | "mezclada" | null> {
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
    // Una fila que no es una cuenta, con ninguna línea de persona en la lista, se rechaza al leerla, como siempre.
    if (formaDeLista(leidas.map((f) => f.cuenta)) === "rara") return null;
    desde = Math.max(desde, ...filas.map((f) => f.v));
  }
  if (!terminada) return null;
  const despues = await estadoConToken(s, dep);
  if (typeof despues === "string" || despues.fase !== "cerrada") return null;
  if (despues.total !== antes.total || despues.quitadas !== antes.quitadas) return null;
  if (leidas.length !== despues.total || new Set(leidas.map((f) => f.n)).size !== leidas.length) return null;
  const ultima = await leerVuelta(s, desde, dep);
  if (ultima === null || ultima.length !== 0) return null;
  if (formaDeLista(leidas.map((f) => f.cuenta)) === "mezclada") return como.distinguirMezclada === true ? "mezclada" : null;
  return leidas;
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

/**
 * Lee el resultado que la sala guardó, sin token. En este pedido `sin-resultado` es un 404. Las ganadoras son todas cuentas o
 * todas líneas de persona. Una fila que no es de ninguna de las dos, sin líneas de persona, es `red`, como siempre. Una mezcla
 * tampoco se sortea y reintentar no la cambia: quien lo sabe tratar pide `{ distinguirMezclada: true }` y recibe `"mezclada"`.
 * Sin pedirlo, la mezcla es `red`, como cualquier resultado que no sirve.
 */
export function resultadoDeSala(s: Sala, dep?: DependenciasOrg): Promise<ResultadoDeSala | "sin-resultado" | "no-existe" | "red">;
export function resultadoDeSala(
  s: Sala,
  dep: DependenciasOrg,
  como: { distinguirMezclada: true },
): Promise<ResultadoDeSala | "sin-resultado" | "no-existe" | "red" | "mezclada">;
export async function resultadoDeSala(
  s: Sala,
  dep: DependenciasOrg = {},
  como: { distinguirMezclada?: boolean } = {},
): Promise<ResultadoDeSala | "sin-resultado" | "no-existe" | "red" | "mezclada"> {
  const r = await llamar(dep, rutaDe(s, "/campana/resultado"), {});
  if (!r) return "red";
  if (r.status === 404) return (await motivoDe(r)) === "sin-resultado" ? "sin-resultado" : "no-existe";
  if (!r.ok) return "red";
  const x = (await r.json().catch(() => null)) as { sorteo?: unknown; ganadoras?: unknown; comprobante?: unknown } | null;
  if (!x || typeof x.sorteo !== "string" || typeof x.comprobante !== "string" || !Array.isArray(x.ganadoras)) return "red";
  const ganadoras: string[] = [];
  for (const g of x.ganadoras as unknown[]) {
    if (typeof g !== "string") return "red";
    ganadoras.push(g);
  }
  const forma = formaDeLista(ganadoras);
  if (forma === "rara") return "red";
  if (forma === "mezclada") return como.distinguirMezclada === true ? "mezclada" : "red";
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

/** Por qué la sala no dio los códigos de entrega, además de las fallas de siempre. */
export type FallaDeCodigos = FallaDeSala | "fase" | "no-es-de-personas";

const ES_CODIGO_DE_ENTREGA = /^[0-9]{4}$/u;

/**
 * Los códigos de entrega de las ganadoras de una campaña de personas, en orden de puesto. Solo quien organiza los pide (con
 * el token de la sala) y se leen en cada pedido: la sala los recalcula y no los guarda. `fase` es que todavía no se sorteó y
 * `no-es-de-personas` que la sala es de cuentas. Una respuesta buena exige cuatro cifras en cada código y que ninguno se
 * repita: si no, es `red`, porque no sirve para entregar nada. El código no se escribe en ningún lado.
 */
export async function codigosDeEntrega(s: Sala, dep: DependenciasOrg = {}): Promise<string[] | FallaDeCodigos> {
  // Sin cache del navegador: los códigos salen de la sala cada vez y no se guardan en ningún lado.
  const r = await llamar(dep, rutaDe(s, "/campana/entrega"), { headers: auth(s), cache: "no-store" });
  if (!r) return "red";
  if (r.status === 409) {
    const motivo = await motivoDe(r);
    return motivo === "fase" || motivo === "no-es-de-personas" ? motivo : "rechazo";
  }
  if (!r.ok) return fallaDe(r);
  const x = (await r.json().catch(() => null)) as { codigos?: unknown } | null;
  if (!x || !Array.isArray(x.codigos) || x.codigos.length === 0) return "red";
  const codigos: string[] = [];
  for (const c of x.codigos as unknown[]) {
    if (typeof c !== "string" || !ES_CODIGO_DE_ENTREGA.test(c) || codigos.includes(c)) return "red";
    codigos.push(c);
  }
  return codigos;
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

/**
 * Completa la memoria de antes (la que no guardó de quién es la sala) con la organizadora que nombra el texto firmado, para que la
 * cuenta conectada pueda mover la sala: sin eso el aviso de sellada y el del resultado no salen. Solo con una sesión. Si la lectura
 * falla se prueba de nuevo unas veces, con una espera entre una y otra. Si el texto no nombra a nadie, queda a cargo de quien tenga
 * el token. Si nombra a otra cuenta, se anota de quién es y esta cuenta no la mueve.
 */
export async function completarLaCuentaDeLaMemoria(
  a: Almacen | null,
  ahora: number,
  red: RedDeCampana,
  conectada: string | null,
  dep: DependenciasOrg = {},
  esperar: (ms: number) => Promise<void> = (ms) => new Promise<void>((seguir) => void setTimeout(seguir, ms)),
): Promise<void> {
  if (conectada === null) return;
  for (let intento = 0; intento < 3; intento++) {
    const memoria = leerOrg(a, ahora, red, conectada);
    if (!memoria || memoria.cuenta !== undefined) return;
    const org = await leerOrganizadora(memoria.sala, dep);
    if (org === null || esCuentaValida(org)) {
      // Mientras se leía pudo cambiar la memoria: solo se completa la que sigue sin saber de quién es.
      const actual = leerOrg(a, ahora, red, conectada);
      if (actual && actual.cuenta === undefined) guardarOrg(a, { ...actual, cuenta: org }, ahora);
      return;
    }
    if (intento < 2) await esperar(2_000);
  }
}

/* ------------------------------------------------------------ Tus campañas: la lista de la cuenta y usarla en otra compu */

/**
 * Cuánto espera cada pedido de Tus campañas. La sala verifica la sesión con el proveedor de cuentas antes de contestar: este
 * pedido espera más que los de una sala ya abierta, y repetirlo es inofensivo.
 */
export const PLAZO_DE_TUS_MS = 15_000;

/** En qué punto está una campaña de la cuenta, según la sala: con su sala abierta, activada sin sala, o terminada. */
export type EstadoDeCampanaDeCuenta = "viva" | "activada" | "terminada";

/** Una campaña de la cuenta tal como la lista la sala. Nunca trae el texto firmado, el id de la sala ni su token. */
export interface CampanaDeCuenta {
  evento: string;
  empresa: string;
  /** La zona horaria de la campaña: sus horas se escriben en ella. */
  zona: string;
  abreMs: number;
  cierraMs: number;
  sorteoMs: number;
  estado: EstadoDeCampanaDeCuenta;
  /** Solo con la sala `viva`. */
  fase?: FaseDeSala;
  total?: number;
}

/**
 * Por qué no hubo lista. `sin-funcion` junta todo lo que el sitio no puede distinguir de un servidor que todavía no tiene la
 * ruta: un 404 o un 503 apagada, una falla de red y el 404 sin permisos de origen (que el navegador ve como falla de red). El
 * panel lo trata como que la función no está: no muestra error y sigue con lo de siempre.
 */
export type MotivoDeTus = "sin-funcion" | "sesion" | "no-google" | "sin-billetera" | "limite" | "forma";

export type ResultadoDeMisCampanas = { ok: true; campanas: CampanaDeCuenta[] } | { ok: false; motivo: MotivoDeTus };

/** Como mucho tantas campañas se leen: lo que pase de eso no es de esta lista. */
const MAX_CAMPANAS_DE_CUENTA = 20;
const MAX_EMPRESA = 60;
/** Lo más que pesa el texto firmado que devuelve la sala: lo mismo que acepta el panel de un archivo. */
const MAX_TEXTO_RECUPERADO = 200_000;

function zonaValida(x: unknown): x is string {
  if (typeof x !== "string" || x === "" || x.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: x });
    return true;
  } catch {
    return false;
  }
}

/** Una fila de la lista comprobada campo por campo. Con una zona que el navegador no acepta, o un campo de otra forma, se descarta. */
function leerCampanaDeCuenta(x: unknown): CampanaDeCuenta | null {
  if (!esObjeto(x)) return null;
  const { evento, empresa, zona, abreMs, cierraMs, sorteoMs, estado, fase, total } = x;
  if (typeof evento !== "string" || !ES_EVENTO.test(evento)) return null;
  if (typeof empresa !== "string" || empresa.trim() === "") return null;
  if (!zonaValida(zona)) return null;
  if (!esEntero(abreMs) || abreMs <= 0 || !esEntero(cierraMs) || cierraMs <= 0 || !esEntero(sorteoMs) || sorteoMs <= 0) return null;
  if (estado !== "viva" && estado !== "activada" && estado !== "terminada") return null;
  const fila: CampanaDeCuenta = { evento, empresa: empresa.trim().slice(0, MAX_EMPRESA), zona, abreMs, cierraMs, sorteoMs, estado };
  if (estado === "viva") {
    if (!esFase(fase)) return null;
    fila.fase = fase;
    if (total !== undefined) {
      if (!esEntero(total) || total < 0) return null;
      fila.total = total;
    }
  }
  return fila;
}

/** El motivo que dice la sala para una lista o una toma que no salió, o `null` si no es de los que el sitio conoce. */
function motivoComun(estado: number, error: string | undefined): MotivoDeTus | null {
  if (estado === 401 && error === "sesion") return "sesion";
  if (estado === 403 && error === "no-google") return "no-google";
  if (estado === 409 && error === "sin-billetera") return "sin-billetera";
  if (estado === 429) return "limite";
  if (estado === 400 && error === "forma") return "forma";
  return null;
}

/** El pedido de Tus campañas: solo la sesión viaja, y solo en el cuerpo. De acá no pasa: no se guarda ni se escribe. */
const pedidoDeTus = (cuerpo: Record<string, string>): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(cuerpo),
});

const conPlazoDeTus = (dep: DependenciasOrg): DependenciasOrg => ({ ...dep, senal: dep.senal ?? ((): AbortSignal => AbortSignal.timeout(PLAZO_DE_TUS_MS)) });

/**
 * Si la sala tiene Tus campañas, antes de ofrecerla. Se le manda el pedido de la lista con el cuerpo vacío, que no verifica ninguna
 * sesión ni gasta nada: con la función prendida contesta 400 forma, con los permisos de origen. Una sala que todavía no la tiene
 * (404 sin permisos de origen, que el navegador ve como falla de red, o un 503 apagada) no ofrece nada. Vuelve `true` o `false`
 * cuando la sala contestó, y `null` si no hubo respuesta (sin red o pasado el plazo) o si lo que llegó es una caída pasajera (un
 * 5xx que no es el 503 apagada, un 429 o un 403 sin motivo, como los de una publicación en curso o un intermediario): en ese
 * caso se puede volver a preguntar.
 */
export async function salaTieneTusCampanas(dep: DependenciasOrg = {}, servicio = servicioDeSala()): Promise<boolean | null> {
  const r = await llamar(
    { ...dep, senal: dep.senal ?? ((): AbortSignal => AbortSignal.timeout(PLAZO_DE_PREGUNTAR_MS)) },
    `${servicio}/v1/mis-campanas`,
    pedidoDeTus({}),
  );
  if (!r) return null;
  const x: unknown = await r.json().catch(() => null);
  const error = esObjeto(x) && typeof x.error === "string" ? x.error : undefined;
  if (r.status === 400) return error === "forma";
  if (r.status === 503 && error === "apagada") return false;
  if (r.status >= 500 || r.status === 429 || (r.status === 403 && error === undefined)) return null;
  return false;
}

/**
 * Las campañas de la cuenta de la sesión de Google (`POST /v1/mis-campanas`). La cuenta la dice la sala, nunca el pedido. Con una
 * sala que todavía no tiene la ruta (404, 503 apagada, falla de red, 404 sin permisos de origen) vuelve `sin-funcion`: no es un
 * error para nadie, es una función que no está. Las filas que no se entienden se descartan, y no pasan de 20.
 */
export async function misCampanas(sesion: string, dep: DependenciasOrg = {}, servicio = servicioDeSala()): Promise<ResultadoDeMisCampanas> {
  const r = await llamar(conPlazoDeTus(dep), `${servicio}/v1/mis-campanas`, pedidoDeTus({ sesion }));
  if (!r) return { ok: false, motivo: "sin-funcion" };
  const x: unknown = await r.json().catch(() => null);
  if (r.status !== 200) {
    const error = esObjeto(x) && typeof x.error === "string" ? x.error : undefined;
    return { ok: false, motivo: motivoComun(r.status, error) ?? "sin-funcion" };
  }
  if (!esObjeto(x) || !Array.isArray(x.campanas)) return { ok: false, motivo: "sin-funcion" };
  const vistas = new Set<string>();
  const campanas: CampanaDeCuenta[] = [];
  // Se cortan las filas que se miran (la sala manda 20 como mucho) y después las que se aceptan.
  for (const crudo of x.campanas.slice(0, 4 * MAX_CAMPANAS_DE_CUENTA)) {
    const fila = leerCampanaDeCuenta(crudo);
    if (!fila || vistas.has(fila.evento)) continue;
    vistas.add(fila.evento);
    campanas.push(fila);
    if (campanas.length >= MAX_CAMPANAS_DE_CUENTA) break;
  }
  return { ok: true, campanas };
}

/** Por qué una campaña no se pudo usar en esta compu. */
export type MotivoDeRecuperar =
  | MotivoDeTus
  /** La cuenta no tiene esa campaña (o ya venció): la misma respuesta para una ajena, una inexistente y una vencida. */
  | "no-existe"
  | "terminada"
  | "sellada"
  | "ocupado"
  | "red";

/** Lo que trae una campaña tomada: la sala abierta con su token nuevo, o el archivo firmado para crearla acá. */
export type ResultadoDeRecuperar =
  | { ok: true; estado: "viva"; sala: { id: string; token: string; vence: number; servicio: string }; fase: FaseDeSala }
  | { ok: true; estado: "activada"; archivo: { texto: string; firma: string }; anterior: string | null }
  | { ok: false; motivo: MotivoDeRecuperar };

/**
 * Usar una campaña de la cuenta en esta compu (`POST /v1/campana/recuperar`). Con la sala abierta, el token nuevo deja sin efecto
 * el de la otra compu. Con la campaña activada y sin sala vuelve el archivo firmado, y `anterior` si la sala de antes murió sin
 * sellar. Repetirlo es inofensivo, pasada la pausa de 60 segundos de la sala.
 */
export async function recuperarCampana(
  pedido: { sesion: string; evento: string },
  dep: DependenciasOrg = {},
  servicio = servicioDeSala(),
): Promise<ResultadoDeRecuperar> {
  const r = await llamar(conPlazoDeTus(dep), `${servicio}/v1/campana/recuperar`, pedidoDeTus({ sesion: pedido.sesion, evento: pedido.evento }));
  if (!r) return { ok: false, motivo: "red" };
  const x: unknown = await r.json().catch(() => null);
  const dicho = esObjeto(x) ? x : {};
  if (r.status !== 200) {
    const error = typeof dicho.error === "string" ? dicho.error : undefined;
    // Acá se llega solo con la ruta ya confirmada (la pregunta de Tus campañas contestó que sí), y la sala contesta todo 404 de esta
    // ruta con `no-existe`. Un 404 sin eso viene de un intermediario: es una falla pasajera y se puede probar de nuevo. Lo único que
    // apaga la función en la pestaña es el 503 apagada.
    if (r.status === 404) return { ok: false, motivo: error === "no-existe" ? "no-existe" : "red" };
    if (r.status === 409 && (error === "terminada" || error === "sellada" || error === "ocupado")) return { ok: false, motivo: error };
    if (r.status === 503 && error === "apagada") return { ok: false, motivo: "sin-funcion" };
    return { ok: false, motivo: motivoComun(r.status, error) ?? "red" };
  }
  if (dicho.estado === "viva") {
    const { id, token, vence, fase } = dicho;
    if (typeof id !== "string" || !ES_ID.test(id) || typeof token !== "string" || !ES_TOKEN.test(token)) return { ok: false, motivo: "red" };
    if (typeof vence !== "number" || !Number.isFinite(vence) || !esFase(fase)) return { ok: false, motivo: "red" };
    return { ok: true, estado: "viva", sala: { id, token, vence, servicio }, fase };
  }
  if (dicho.estado === "activada") {
    const { texto, firma, anterior } = dicho;
    if (typeof texto !== "string" || texto === "" || texto.length > MAX_TEXTO_RECUPERADO) return { ok: false, motivo: "red" };
    if (typeof firma !== "string" || !ES_FIRMA_ACTIVADA.test(firma)) return { ok: false, motivo: "red" };
    if (anterior !== undefined && (typeof anterior !== "string" || !ES_TOKEN.test(anterior))) return { ok: false, motivo: "red" };
    return { ok: true, estado: "activada", archivo: { texto, firma }, anterior: anterior ?? null };
  }
  return { ok: false, motivo: "red" };
}

/* ------------------------------------------------------------ lo que recuerda la compu */

export const CLAVE_ORG = "tinkazo.campana.org";
/** El token de la última sala de cada evento y cuenta: sin él, el mismo archivo no vuelve a abrir una sala que ya se cerró. */
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
  /** La cuenta que lo guardó: el de otra cuenta no se ve ni se pisa. */
  cuenta?: string;
  evento: string;
  firma: string;
  intento: string;
}

const esCuentaOpcional = (x: unknown): string | undefined => (esCuentaValida(x) ? x : undefined);

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
      const cuenta = esCuentaOpcional(e.cuenta);
      lista.push(cuenta === undefined ? { evento, firma, intento } : { evento, firma, intento, cuenta });
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

/** El intento guardado para ese archivo (evento y firma) y esa cuenta, o `null`. El de otra cuenta no se ve ni se pisa. */
export function intentoDeArchivo(a: Almacen | null, evento: string, firma: string, cuenta: string | null): string | null {
  if (!a) return null;
  return leerIntentos(a).find((e) => e.evento === evento && e.firma === firma && seVeDesde(e.cuenta, cuenta))?.intento ?? null;
}

/** Guarda el intento de ese archivo antes de pedir la sala. Cada evento y cuenta recuerda uno solo, el último. */
export function guardarIntentoDeArchivo(a: Almacen | null, e: IntentoGuardado): void {
  if (!a) return;
  escribirIntentos(a, [e, ...leerIntentos(a).filter((x) => !(x.evento === e.evento && x.cuenta === e.cuenta))]);
}

/** Olvida el intento de ese evento y esa cuenta: la sala ya se creó y llegó su token, o no hace falta repetirlo. */
export function olvidarIntentoDeArchivo(a: Almacen | null, evento: string, cuenta?: string): void {
  if (!a) return;
  const lista = leerIntentos(a);
  const quedan = lista.filter((x) => !(x.evento === evento && x.cuenta === cuenta));
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
  /**
   * Quién organiza esta sala: la cuenta que nombra el texto firmado de la campaña, o `null` si no nombra a nadie (queda a
   * cargo de quien tenga el token). Sin el campo es una memoria de antes de guardarlo: se completa con la sesión.
   */
  cuenta?: string | null;
  /**
   * La campaña se tomó desde otra compu (Usar en esta compu): la clave de los nombres es nueva, y quienes se anotaron antes de la
   * toma salen con su número hasta que vuelven a escanear el QR.
   */
  recuperada?: boolean;
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
  if (x.cuenta === null) memoria.cuenta = null;
  else if (esCuentaValida(x.cuenta)) memoria.cuenta = x.cuenta;
  if (x.recuperada === true) memoria.recuperada = true;
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

/**
 * Las salas de otras cuentas que esta compu recuerda de cada red, a un costado de la sala en curso: una por cuenta, las más
 * nuevas primero. Así crear o tomar una campaña con una cuenta no pisa lo que otra cuenta dejó en esta compu.
 */
export const CLAVE_DE_LAS_OTRAS_SALAS = "otras";
/**
 * Cuántas salas de otras cuentas se recuerdan por red. Las vencidas no cuentan: se sacan antes. Si aun así no entran, sale la
 * que vence primero, nunca una cualquiera en silencio.
 */
const MAX_OTRAS_SALAS = 6;

const cuentaDeLaMemoria = (x: unknown): string | null => (esObjeto(x) && esCuentaValida(x.cuenta) ? x.cuenta : null);

/** Las salas de otras cuentas de esa red, tal como están guardadas (todavía sin comprobar). */
function leerLasOtras(todo: Record<string, unknown>, red: RedDeCampana): unknown[] {
  const todas = todo[CLAVE_DE_LAS_OTRAS_SALAS];
  const lista = esObjeto(todas) ? todas[red] : undefined;
  return Array.isArray(lista) ? lista : [];
}

function ponerLasOtras(todo: Record<string, unknown>, red: RedDeCampana, lista: unknown[]): void {
  const todas = esObjeto(todo[CLAVE_DE_LAS_OTRAS_SALAS]) ? { ...(todo[CLAVE_DE_LAS_OTRAS_SALAS] as Record<string, unknown>) } : {};
  if (lista.length === 0) delete todas[red];
  else todas[red] = lista.slice(0, MAX_OTRAS_SALAS);
  if (Object.keys(todas).length === 0) delete todo[CLAVE_DE_LAS_OTRAS_SALAS];
  else todo[CLAVE_DE_LAS_OTRAS_SALAS] = todas;
}

/**
 * Las de un costado que siguen sirviendo: sin las vencidas ni las que no se entienden, y como mucho `MAX_OTRAS_SALAS`. Si sobran,
 * salen las que vencen primero, y las que quedan siguen en su orden.
 */
function recortarLasOtras(lista: unknown[], red: RedDeCampana, ahora: number): unknown[] {
  const vivas = lista.flatMap((x) => {
    const memoria = leerMemoria(x, red, ahora);
    return memoria ? [{ x, vence: memoria.sala.vence }] : [];
  });
  const quedan = new Set([...vivas].sort((p, q) => q.vence - p.vence).slice(0, MAX_OTRAS_SALAS));
  return vivas.filter((v) => quedan.has(v)).map((v) => v.x);
}

/**
 * Guarda la sala de su red. La de la otra red no se toca: cada red tiene la suya. Si en esa red hay una sala de otra cuenta, no
 * se pisa: pasa a las de un costado y vuelve cuando esa cuenta la retome. `ahora` decide qué ya venció.
 */
export function guardarOrg(a: Almacen | null, m: MemoriaDeOrg, ahora: number = Date.now()): void {
  const todo = leerTodo(a);
  const red = m.sala.red;
  const duenaDeLaActual = cuentaDeLaMemoria(todo[red]);
  const cuenta = typeof m.cuenta === "string" ? m.cuenta : null;
  // Lo de un costado de la misma cuenta ya no vale: esta es la que sigue.
  let otras = leerLasOtras(todo, red).filter((x) => cuenta === null || cuentaDeLaMemoria(x) !== cuenta);
  // La sala en curso es de otra cuenta, se entiende y no venció: se aparta en lugar de pisarse.
  if (duenaDeLaActual !== null && duenaDeLaActual !== cuenta && leerMemoria(todo[red], red, ahora) !== null) {
    otras = [todo[red], ...otras.filter((x) => cuentaDeLaMemoria(x) !== duenaDeLaActual)];
  }
  todo[red] = m;
  ponerLasOtras(todo, red, recortarLasOtras(otras, red, ahora));
  escribirTodo(a, todo);
}

/** El id de la sala de una memoria guardada, sin comprobar nada más. */
const idDeLaMemoria = (x: unknown): string | null => (esObjeto(x) && esObjeto(x.sala) && typeof x.sala.id === "string" ? x.sala.id : null);

/**
 * Saca la sala de esa red. La de la otra queda. Sin `cuenta`, sale la sala en curso. Con `cuenta` (la conectada, o `null` sin
 * sesión), sale la que esa cuenta ve: la sala en curso si es suya y, si no, la suya de las de un costado. Sin sesión las de un
 * costado son todas de otras cuentas: sale solo la de `id` (la que estaba a la vista), y sin `id` no sale ninguna.
 */
export function borrarOrg(a: Almacen | null, red: RedDeCampana, cuenta?: string | null, id?: string): void {
  const todo = leerTodo(a);
  if (cuenta === undefined || (todo[red] !== undefined && seVeDesde(cuentaDeLaMemoria(todo[red]), cuenta))) {
    delete todo[red];
  } else {
    const sale = (x: unknown): boolean => (cuenta === null ? id !== undefined && idDeLaMemoria(x) === id : seVeDesde(cuentaDeLaMemoria(x), cuenta));
    ponerLasOtras(
      todo,
      red,
      leerLasOtras(todo, red).filter((x) => !sale(x)),
    );
  }
  escribirTodo(a, todo);
}

/**
 * La sala guardada de esa red que se ve desde la cuenta conectada, o `null`. Si no se entiende o ya venció, la borra. `cuenta`
 * es la cuenta conectada (`null` si no hay sesión): una sala de otra cuenta no se devuelve, y tampoco se borra. `ahora` entra
 * como parámetro: las pruebas no usan reloj.
 */
export function leerOrg(a: Almacen | null, ahora: number, red: RedDeCampana, cuenta: string | null): MemoriaDeOrg | null {
  const todo = leerTodo(a);
  if (todo[red] !== undefined) {
    const memoria = leerMemoria(todo[red], red, ahora);
    if (!memoria) borrarOrg(a, red);
    else if (seVeDesde(memoria.cuenta, cuenta)) return memoria;
  }
  // La de esta cuenta puede estar a un costado, apartada por otra que creó o tomó una campaña en esta compu.
  for (const x of leerLasOtras(leerTodo(a), red)) {
    const memoria = leerMemoria(x, red, ahora);
    if (memoria && seVeDesde(memoria.cuenta, cuenta)) return memoria;
  }
  return null;
}

/** El token de la última sala creada de cada evento y cuenta. Hasta cinco eventos, el más nuevo primero. */
export function guardarTokenDeEvento(a: Almacen | null, e: { evento: string; token: string; cuenta?: string }): void {
  if (!a) return;
  try {
    const otros = leerEventos(a).filter((x) => !(x.evento === e.evento && x.cuenta === e.cuenta));
    a.setItem(CLAVE_EVENTOS_ORG, JSON.stringify([e, ...otros].slice(0, MAX_EVENTOS)));
  } catch {
    /* sin lugar: el evento queda sin su token y habrá que pedir otro archivo */
  }
}

function leerEventos(a: Almacen): { evento: string; token: string; cuenta?: string }[] {
  try {
    const x: unknown = JSON.parse(a.getItem(CLAVE_EVENTOS_ORG) ?? "[]");
    if (!Array.isArray(x)) return [];
    const lista: { evento: string; token: string; cuenta?: string }[] = [];
    for (const e of x) {
      if (esObjeto(e) && typeof e.evento === "string" && ES_EVENTO.test(e.evento) && typeof e.token === "string" && ES_TOKEN.test(e.token)) {
        const cuenta = esCuentaOpcional(e.cuenta);
        lista.push(cuenta === undefined ? { evento: e.evento, token: e.token } : { evento: e.evento, token: e.token, cuenta });
      }
    }
    return lista;
  } catch {
    return [];
  }
}

/**
 * El token de la última sala de ese evento que esta cuenta creó, o `null` si esta compu no la creó. Es lo que da el control de
 * una sala vieja: sin cuenta conectada, o con otra, el token de una cuenta no se ofrece.
 */
export function tokenDeEvento(a: Almacen | null, evento: string, cuenta: string | null): string | null {
  if (!a) return null;
  const propio = (e: { cuenta?: string }): boolean => e.cuenta === undefined || e.cuenta === cuenta;
  return leerEventos(a).find((e) => e.evento === evento && propio(e))?.token ?? null;
}
