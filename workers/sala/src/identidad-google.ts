/**
 * La identidad de quien se anota con Google directo: la sala verifica sola el token de identidad que el botón de Google
 * entrega al navegador, sin pasar por el proveedor de cuentas. Es una pieza pura: no la llama ninguna ruta todavía.
 *
 * Se comprueba, en este orden: la forma del token, que el algoritmo sea RS256, la firma contra las llaves públicas de
 * Google, el emisor, la audiencia (el identificador de cliente de Tinkazo, que es público), la caducidad y que el correo
 * esté verificado. Con la API de Web Crypto del Worker y sin paquetes.
 *
 * Lo que devuelve es un usuario estable (`google:` y el identificador de la cuenta de Google) y el correo verificado,
 * para que quien llama los use en memoria. Nada del token, del correo ni del identificador va a un registro, y el motivo
 * de un rechazo es siempre uno de una lista corta y fija. Nunca lanza.
 */
import { deB64url } from "./firma";

/** Donde Google publica las llaves públicas con las que firma los tokens de identidad. */
export const URL_DE_LLAVES_DE_GOOGLE = "https://www.googleapis.com/oauth2/v3/certs";

export type MotivoDeRechazo =
  | "mal-formado"
  | "firma"
  | "emisor"
  | "audiencia"
  | "vencido"
  | "correo-sin-verificar"
  | "llaves-no-disponibles";

export type ResultadoDeIdentidad = { ok: true; usuario: string; correo: string } | { ok: false; motivo: MotivoDeRechazo };

/** Lo mínimo que se lee de la respuesta de las llaves: sirve la de `fetch` y la de una prueba. */
export interface RespuestaDeLlaves {
  ok: boolean;
  status: number;
  headers: { get(nombre: string): string | null };
  json(): Promise<unknown>;
}

export type PedirLlaves = (url: string, init: { signal: AbortSignal }) => Promise<RespuestaDeLlaves>;

/** Las llaves recordadas, con la hora hasta la que valen y la hora en que se pidieron. */
export interface MemoriaDeLlaves {
  llaves: Map<string, CryptoKey>;
  vence: number;
  pedidas: number;
  /** La hora del último pedido que falló, o `null` si el último salió bien o todavía no hubo ninguno. */
  fallo: number | null;
  /** El pedido que está en vuelo: varios tokens a la vez comparten uno solo. */
  enCurso: Promise<boolean> | null;
}

export interface OpcionesDeIdentidad {
  /** El identificador de cliente de Google de Tinkazo (variable `GOOGLE_CLIENT_ID` de la sala). Vacío: no entra nadie. */
  clienteId: string;
  /** Cómo se piden las llaves. Por defecto `fetch`. */
  pedir?: PedirLlaves;
  /** La hora en milisegundos. Por defecto la del reloj. */
  ahora?: () => number;
  /** Las llaves recordadas. Por defecto, las de todo el Worker. */
  memoria?: MemoriaDeLlaves;
  /** Cuánto se espera a Google antes de rendirse, en milisegundos. */
  tiempoMaxMs?: number;
}

export function crearMemoriaDeLlaves(): MemoriaDeLlaves {
  return { llaves: new Map(), vence: 0, pedidas: 0, fallo: null, enCurso: null };
}

const memoriaDelWorker = crearMemoriaDeLlaves();

/** Cuánto se espera a Google por las llaves. */
export const TIEMPO_MAX_LLAVES_MS = 4_000;
/** Cuánto se recuerdan las llaves si Google no dice nada, y entre qué límites si lo dice. */
const RECUERDO_POR_DEFECTO_MS = 5 * 60_000;
const RECUERDO_MINIMO_MS = 10_000;
const RECUERDO_MAXIMO_MS = 24 * 3_600_000;
/**
 * Un token con una llave desconocida hace pedir las llaves de nuevo (una vez) por si Google rotó, pero no antes de que
 * pasen estos milisegundos desde el último pedido: quien manda llaves inventadas no hace que la sala le pida a Google
 * en cada intento.
 */
const ESPERA_ENTRE_PEDIDOS_MS = 30_000;
/**
 * Si Google no contesta, tampoco se le pide en cada token. Con llaves vigentes rige la espera larga: quien trae una llave
 * conocida no se entera. Sin llaves se espera poco, porque nadie entra mientras tanto.
 */
const ESPERA_TRAS_FALLO_SIN_LLAVES_MS = 3_000;
const MAX_LARGO_TOKEN = 6_000;

const EMISORES = new Set(["accounts.google.com", "https://accounts.google.com"]);
const ES_SEGMENTO = /^[A-Za-z0-9_-]+$/;
/** El identificador de cuenta de Google: ASCII, hasta 255 caracteres. Sin `:` para que `google:<id>` no sea ambiguo. */
const ES_SUB = /^[0-9A-Za-z_.-]{1,255}$/;

const rechazo = (motivo: MotivoDeRechazo): ResultadoDeIdentidad => ({ ok: false, motivo });

function objetoDe(bytes: Uint8Array): Record<string, unknown> | null {
  try {
    const valor: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    return valor !== null && typeof valor === "object" && !Array.isArray(valor) ? (valor as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Cuánto vale lo que Google acaba de contestar, según su cabecera de caducidad. */
function recuerdoDe(respuesta: RespuestaDeLlaves): number {
  let ms = RECUERDO_POR_DEFECTO_MS;
  try {
    const cabecera = respuesta.headers.get("cache-control") ?? "";
    const m = /(?:^|[\s,])max-age=(\d{1,10})(?:[\s,;]|$)/i.exec(cabecera);
    if (m) {
      ms = Number(m[1]) * 1000;
      const edad = Number(respuesta.headers.get("age") ?? "");
      if (Number.isFinite(edad) && edad > 0) ms -= edad * 1000;
    }
  } catch {
    // Sin cabecera legible se usa el recuerdo por defecto.
  }
  return Math.min(Math.max(ms, RECUERDO_MINIMO_MS), RECUERDO_MAXIMO_MS);
}

async function importarLlave(entrada: unknown): Promise<[string, CryptoKey] | null> {
  if (entrada === null || typeof entrada !== "object") return null;
  const { kid, kty, n, e, alg } = entrada as Record<string, unknown>;
  if (typeof kid !== "string" || kid === "" || kty !== "RSA" || typeof n !== "string" || typeof e !== "string") return null;
  if (alg !== undefined && alg !== "RS256") return null;
  try {
    const llave = await crypto.subtle.importKey(
      "jwk",
      { kty: "RSA", n, e, alg: "RS256", ext: true },
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    return [kid, llave];
  } catch {
    return null;
  }
}

/** Pide las llaves a Google y las guarda en la memoria. Verdadero si quedó al menos una. Nunca lanza. */
async function pedirLlaves(memoria: MemoriaDeLlaves, pedir: PedirLlaves, ahora: () => number, tiempoMaxMs: number): Promise<boolean> {
  const control = new AbortController();
  let reloj: ReturnType<typeof setTimeout> | undefined;
  try {
    const corte = new Promise<null>((resolve) => {
      reloj = setTimeout(() => {
        control.abort();
        resolve(null);
      }, tiempoMaxMs);
    });
    const leer = (async (): Promise<{ llaves: Map<string, CryptoKey>; recuerdo: number } | null> => {
      const respuesta = await pedir(URL_DE_LLAVES_DE_GOOGLE, { signal: control.signal });
      if (!respuesta.ok) return null;
      const cuerpo = (await respuesta.json()) as { keys?: unknown } | null;
      if (cuerpo === null || typeof cuerpo !== "object" || !Array.isArray(cuerpo.keys)) return null;
      const llaves = new Map<string, CryptoKey>();
      for (const entrada of cuerpo.keys as unknown[]) {
        const par = await importarLlave(entrada);
        if (par) llaves.set(par[0], par[1]);
      }
      if (llaves.size === 0) return null;
      return { llaves, recuerdo: recuerdoDe(respuesta) };
    })();
    // Si el corte gana, el pedido que quedó atrás no puede dejar un rechazo sin atrapar.
    leer.catch(() => null);
    const leidas = await Promise.race([leer, corte]);
    if (leidas === null) {
      memoria.fallo = ahora();
      return false;
    }
    // La memoria se cambia de una vez y solo con un pedido entero: nunca llaves nuevas con la caducidad de otras.
    memoria.llaves = leidas.llaves;
    memoria.pedidas = ahora();
    memoria.vence = memoria.pedidas + leidas.recuerdo;
    memoria.fallo = null;
    return true;
  } catch {
    memoria.fallo = ahora();
    return false;
  } finally {
    if (reloj !== undefined) clearTimeout(reloj);
  }
}

/**
 * La llave de `kid`, de la memoria o pedida a Google, y a lo sumo un pedido por verificación. Devuelve la llave, `null` si
 * Google no tiene esa llave o `"no-disponible"` si no se pudieron conseguir las llaves.
 *
 * Los pedidos en vuelo se comparten entre quienes verifican a la vez: en un Worker, el pedido que quedó atrás por un corte
 * de otra conexión da un rechazo para todos, y el siguiente intento lo repite.
 */
async function llaveDe(kid: string, memoria: MemoriaDeLlaves, pedir: PedirLlaves, ahora: () => number, tiempoMaxMs: number): Promise<CryptoKey | null | "no-disponible"> {
  const hora = ahora();
  const vigente = memoria.llaves.size > 0 && hora < memoria.vence;
  if (vigente) {
    const hay = memoria.llaves.get(kid);
    if (hay) return hay;
    // Google pudo rotar sus llaves: se piden otra vez, pero no antes de la espera entre pedidos, cuente el último pedido
    // como bueno o como fallido.
    if (hora - memoria.pedidas < ESPERA_ENTRE_PEDIDOS_MS) return null;
    if (memoria.fallo !== null && hora - memoria.fallo < ESPERA_ENTRE_PEDIDOS_MS) return null;
  } else if (memoria.enCurso === null && memoria.fallo !== null && hora - memoria.fallo < ESPERA_TRAS_FALLO_SIN_LLAVES_MS) {
    return "no-disponible";
  }
  if (memoria.enCurso === null) {
    const pedido = pedirLlaves(memoria, pedir, ahora, tiempoMaxMs).finally(() => {
      if (memoria.enCurso === pedido) memoria.enCurso = null;
    });
    memoria.enCurso = pedido;
  }
  const quedaron = await memoria.enCurso;
  if (!quedaron) return "no-disponible";
  return memoria.llaves.get(kid) ?? null;
}

/** Verifica el token de identidad de Google. Nunca lanza y nunca escribe nada del token. */
export async function verificarIdentidadDeGoogle(token: string, opciones: OpcionesDeIdentidad): Promise<ResultadoDeIdentidad> {
  try {
    return await verificar(token, opciones);
  } catch {
    return rechazo("mal-formado");
  }
}

async function verificar(token: string, opciones: OpcionesDeIdentidad): Promise<ResultadoDeIdentidad> {
  if (typeof token !== "string" || token === "" || token.length > MAX_LARGO_TOKEN) return rechazo("mal-formado");
  const partes = token.split(".");
  if (partes.length !== 3) return rechazo("mal-formado");
  const [h, c, f] = partes as [string, string, string];
  if (!ES_SEGMENTO.test(h) || !ES_SEGMENTO.test(c) || (f !== "" && !ES_SEGMENTO.test(f))) return rechazo("mal-formado");

  let cabecera: Record<string, unknown> | null;
  let cuerpo: Record<string, unknown> | null;
  try {
    cabecera = objetoDe(deB64url(h));
    cuerpo = objetoDe(deB64url(c));
  } catch {
    return rechazo("mal-formado");
  }
  if (cabecera === null || cuerpo === null) return rechazo("mal-formado");
  const kid = cabecera.kid;
  if (typeof kid !== "string" || kid === "") return rechazo("mal-formado");

  // El algoritmo lo fija la sala, no el token: cualquier otro, incluido `none`, se rechaza sin pedir llaves.
  if (cabecera.alg !== "RS256") return rechazo("firma");
  if (f === "") return rechazo("firma");

  const ahora = opciones.ahora ?? Date.now;
  const llave = await llaveDe(kid, opciones.memoria ?? memoriaDelWorker, opciones.pedir ?? ((url, init) => fetch(url, init)), ahora, opciones.tiempoMaxMs ?? TIEMPO_MAX_LLAVES_MS);
  if (llave === "no-disponible") return rechazo("llaves-no-disponibles");
  if (llave === null) return rechazo("firma");

  let buena = false;
  try {
    buena = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", llave, new Uint8Array(deB64url(f)), new TextEncoder().encode(`${h}.${c}`));
  } catch {
    buena = false;
  }
  if (!buena) return rechazo("firma");

  // Desde acá el cuerpo es de Google.
  if (typeof cuerpo.iss !== "string" || !EMISORES.has(cuerpo.iss)) return rechazo("emisor");
  if (opciones.clienteId === "" || cuerpo.aud !== opciones.clienteId) return rechazo("audiencia");
  const exp = cuerpo.exp;
  if (typeof exp !== "number" || !Number.isFinite(exp)) return rechazo("mal-formado");
  if (exp * 1000 <= ahora()) return rechazo("vencido");
  const verificado = cuerpo.email_verified;
  const correo = cuerpo.email;
  if ((verificado !== true && verificado !== "true") || typeof correo !== "string" || correo.trim() === "") return rechazo("correo-sin-verificar");
  const sub = cuerpo.sub;
  if (typeof sub !== "string" || !ES_SUB.test(sub)) return rechazo("mal-formado");
  return { ok: true, usuario: `google:${sub}`, correo: correo.trim() };
}
