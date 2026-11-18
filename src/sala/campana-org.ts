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
import { type Dependencias, type Sala, servicioDeSala } from "./cliente";

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

/** La fase, el total de personas y la hora de cierre que tiene la sala. */
export async function estadoConToken(s: Sala, dep: DependenciasOrg = {}): Promise<EstadoDeSala | FallaDeSala> {
  const r = await llamar(dep, rutaDe(s, "/campana/estado"), { headers: auth(s) });
  if (!r) return "red";
  if (!r.ok) return fallaDe(r);
  const x = (await r.json().catch(() => null)) as { fase?: unknown; total?: unknown; cierraMs?: unknown } | null;
  if (!x || !esFase(x.fase) || !Number.isSafeInteger(x.total) || !Number.isSafeInteger(x.cierraMs)) return "red";
  return { fase: x.fase, total: x.total as number, cierraMs: x.cierraMs as number };
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

/* ------------------------------------------------------------ lo que recuerda la compu */

export const CLAVE_ORG = "tinkazo.campana.org";
/** El token de la última sala de cada evento: sin él, el mismo archivo no vuelve a abrir una sala que ya se cerró. */
export const CLAVE_EVENTOS_ORG = "tinkazo.campana.eventos";
/** Cuántos eventos recuerda la compu. */
const MAX_EVENTOS = 5;

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
