import { sha256 } from "@noble/hashes/sha2.js";

/**
 * El enlace corto de un comprobante: `tinkazo.app/c/<id>#<clave>`.
 *
 * El enlace de siempre lleva la lista entera después del `#`. Con doscientos
 * nombres pasa de mil caracteres: su QR no se lee en una foto de WhatsApp y
 * algunos chats lo cortan al pegarlo. El corto deja ese enlace guardado en
 * `c.tinkazo.app` (el Worker de `workers/enlaces/`), con dos reglas:
 *
 * - **Se guarda protegido.** El navegador lo cifra antes de mandarlo (AES-GCM,
 *   con una clave nueva de 16 bytes para cada enlace), y la clave viaja solo en
 *   el fragmento del enlace corto, que el navegador no le manda a ningún
 *   servidor. El servicio guarda bytes que no puede leer.
 * - **Nunca frena compartir.** Si el servicio no contesta en unos segundos, o
 *   cualquier cosa falla, `acortar` devuelve null y se comparte el enlace largo.
 *
 * Lo que se cifra es `{"v":1,"u":"/verificar.html#…"}`: la ruta y el fragmento
 * del enlace largo, sin el dominio. Al abrirlo, `abrir` solo acepta una ruta de
 * `verificar.html` o de `evento.html` de este mismo sitio: un enlace corto no
 * puede llevar a otra página ni a otro dominio.
 *
 * Lo que se manda es `[1][IV de 12 bytes][cifrado]`: el 1 es la versión.
 *
 * Este equipo se acuerda de los cortos que armó (en memoria y en
 * `localStorage`, por la huella de la ruta), con el permiso para borrarlos:
 * compartir dos veces lo mismo no crea dos enlaces, y "Borrar el enlace corto"
 * de Mis sorteos sabe cuál borrar.
 */

/** El servicio de enlaces cortos. */
export const SERVICIO = "https://c.tinkazo.app";
const VERSION = 1;
/** Lo que se espera al crear uno antes de compartir el largo. */
const ESPERA_CREAR_MS = 5_000;
/** Lo que se espera al abrir uno: quien lo abre no tiene otro camino. */
const ESPERA_ABRIR_MS = 10_000;
/** El tope del servicio, en bytes. */
const MAX_BYTES = 256 * 1024;
export const ES_ID = /^[0-9A-Za-z]{8}$/;
/** 16 bytes en base64url, sin relleno. */
const ES_CLAVE = /^[A-Za-z0-9_-]{22}$/;
/** Lo único a lo que lleva un enlace corto: el comprobante de un sorteo o un evento. */
const ES_RUTA = /^\/(?:verificar|evento)\.html#[A-Za-z0-9_-]{2,}$/;
const GUARDADOS = "tinkazo.cortos";
const MAX_GUARDADOS = 300;

export interface Corto {
  /** El enlace para compartir: `<origen>/c/<id>#<clave>`. */
  corto: string;
  id: string;
  /** El permiso para borrarlo. Vacío si este equipo no lo creó: solo lo abrió. */
  borrar: string;
}

/** Para las pruebas: otro servicio, otro origen, otra espera u otro `fetch`. */
export interface Opciones {
  servicio?: string;
  origen?: string;
  espera?: number;
  fetch?: typeof fetch;
}

export type Abierto = { ruta: string; corto: Corto } | { error: "no-existe" | "red" | "roto" };

/* ------------------------------------------------------------------ formato */

const b64url = (bytes: Uint8Array): string => {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

const deB64url = (s: string): Uint8Array<ArrayBuffer> => {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};

/** Una ruta a la que puede llevar un enlace corto. */
export function esRuta(u: unknown): u is string {
  return typeof u === "string" && ES_RUTA.test(u);
}

/** La ruta y el fragmento de un enlace largo de Tinkazo, o null si no es un comprobante ni un evento. */
export function rutaDe(enlace: string): string | null {
  try {
    const u = new URL(enlace, "https://tinkazo.app");
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    const ruta = u.pathname + u.hash;
    return esRuta(ruta) ? ruta : null;
  } catch {
    return null;
  }
}

/** `[1][IV][cifrado]` con la clave dada. */
export async function cifrar(texto: string, clave: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const k = await crypto.subtle.importKey("raw", clave, "AES-GCM", false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cifrado = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, k, new TextEncoder().encode(texto)));
  const out = new Uint8Array(1 + iv.length + cifrado.length);
  out[0] = VERSION;
  out.set(iv, 1);
  out.set(cifrado, 1 + iv.length);
  return out;
}

/** Lo contrario de `cifrar`. Tira si la versión no es la conocida o si la clave no es la que lo cerró. */
export async function descifrar(bytes: Uint8Array<ArrayBuffer>, clave: Uint8Array<ArrayBuffer>): Promise<string> {
  if (bytes.length < 1 + 12 + 16 || bytes[0] !== VERSION) throw new Error("corto-formato");
  const k = await crypto.subtle.importKey("raw", clave, "AES-GCM", false, ["decrypt"]);
  const claro = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.slice(1, 13) }, k, bytes.slice(13));
  return new TextDecoder().decode(claro);
}

/**
 * Corre `hacer` con un tiempo límite: al vencer, corta el pedido y falla,
 * aunque quien contesta (en las pruebas, un `fetch` falso) no escuche la señal.
 */
async function conEspera<T>(ms: number, hacer: (senal: AbortSignal) => Promise<T>): Promise<T> {
  const ctl = new AbortController();
  const vence = new Promise<never>((_, rechazar) => {
    ctl.signal.addEventListener("abort", () => rechazar(new Error("corto-espera")), { once: true });
  });
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    return await Promise.race([hacer(ctl.signal), vence]);
  } finally {
    clearTimeout(t);
  }
}

/* ------------------------------------------------- lo que recuerda este equipo */

interface Guardado {
  c: string;
  i: string;
  b: string;
  t: number;
}

const memoria = new Map<string, Corto>();
const enCurso = new Map<string, Promise<Corto | null>>();
const oyentes: Array<(ruta: string, c: Corto) => void> = [];

/** La huella de la ruta: el enlace largo de un evento puede pesar cientos de KB y no se guarda dos veces. */
const llave = (ruta: string): string => b64url(sha256(new TextEncoder().encode(ruta)));

const ES_CORTO = /\/c\/([0-9A-Za-z]{8})#[A-Za-z0-9_-]{22}$/;

function valido(g: unknown): g is Guardado {
  if (!g || typeof g !== "object") return false;
  const x = g as Partial<Guardado>;
  return typeof x.c === "string" && typeof x.i === "string" && typeof x.b === "string" && typeof x.t === "number" &&
    ES_ID.test(x.i) && ES_CORTO.exec(x.c)?.[1] === x.i;
}

function leerGuardados(): Record<string, Guardado> {
  try {
    const raw = localStorage.getItem(GUARDADOS);
    const v = raw ? (JSON.parse(raw) as unknown) : null;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, Guardado>) : {};
  } catch {
    return {};
  }
}

function escribirGuardados(g: Record<string, Guardado>): void {
  try {
    const entradas = Object.entries(g).sort((a, b) => b[1].t - a[1].t).slice(0, MAX_GUARDADOS);
    localStorage.setItem(GUARDADOS, JSON.stringify(Object.fromEntries(entradas)));
  } catch {
    /* sin almacenamiento, se recuerda hasta recargar */
  }
}

function deRuta(ruta: string): Corto | null {
  const m = memoria.get(ruta);
  if (m) return m;
  const g = leerGuardados()[llave(ruta)];
  if (!valido(g)) return null;
  const c: Corto = { corto: g.c, id: g.i, borrar: g.b };
  memoria.set(ruta, c);
  return c;
}

function recordar(ruta: string, c: Corto): void {
  const g = leerGuardados();
  const k = llave(ruta);
  const antes = g[k];
  // Abrir el propio enlace no le saca el permiso de borrarlo.
  const borrar = c.borrar || (valido(antes) && antes.i === c.id ? antes.b : "");
  const final: Corto = { ...c, borrar };
  memoria.set(ruta, final);
  g[k] = { c: final.corto, i: final.id, b: final.borrar, t: Date.now() };
  escribirGuardados(g);
  for (const fn of oyentes) {
    try {
      fn(ruta, final);
    } catch {
      /* un oyente roto no frena a los demás */
    }
  }
}

function olvidar(ruta: string): void {
  memoria.delete(ruta);
  const g = leerGuardados();
  delete g[llave(ruta)];
  escribirGuardados(g);
}

/** Avisa cada vez que hay un corto nuevo para una ruta: el resultado cambia su QR y sus avisos al corto. */
export function alAcortar(fn: (ruta: string, c: Corto) => void): void {
  oyentes.push(fn);
}

/** El corto que este equipo ya tiene para un enlace largo, sin ir a la red. */
export function cortoGuardado(enlaceLargo: string): Corto | null {
  const ruta = rutaDe(enlaceLargo);
  return ruta ? deRuta(ruta) : null;
}

/** Si este equipo creó el corto de ese enlace y lo puede borrar. */
export const puedeBorrar = (enlaceLargo: string): boolean => !!cortoGuardado(enlaceLargo)?.borrar;

/* ------------------------------------------------------------------ la red */

/**
 * El enlace corto de un comprobante o de un evento, o null si no sale (el
 * servicio no contesta, el enlace no es de Tinkazo, pesa más de 256 KB…).
 * Nunca tira. Pedido dos veces el mismo, se arma una sola vez.
 */
export function acortar(enlaceLargo: string, op: Opciones = {}): Promise<Corto | null> {
  const ruta = rutaDe(enlaceLargo);
  if (!ruta) return Promise.resolve(null);
  let ya: Corto | null = null;
  try {
    ya = deRuta(ruta);
  } catch {
    /* sin huella, se arma de nuevo */
  }
  if (ya) return Promise.resolve(ya);
  const pendiente = enCurso.get(ruta);
  if (pendiente) return pendiente;
  const p = crear(ruta, op)
    .catch(() => null)
    .finally(() => enCurso.delete(ruta));
  enCurso.set(ruta, p);
  return p;
}

async function crear(ruta: string, op: Opciones): Promise<Corto | null> {
  const f = op.fetch ?? fetch;
  const origen = op.origen ?? location.origin;
  const clave = crypto.getRandomValues(new Uint8Array(16));
  const cuerpo = await cifrar(JSON.stringify({ v: VERSION, u: ruta }), clave);
  if (cuerpo.length > MAX_BYTES) return null;
  // Sin Content-Type: así el pedido es "simple" y no hace falta la consulta previa de CORS.
  const j = await conEspera(op.espera ?? ESPERA_CREAR_MS, async (signal) => {
    const r = await f(`${op.servicio ?? SERVICIO}/v1`, { method: "POST", body: cuerpo, signal });
    return r.status === 201 ? ((await r.json()) as { id?: unknown; borrar?: unknown }) : null;
  });
  if (!j || typeof j.id !== "string" || !ES_ID.test(j.id) || typeof j.borrar !== "string" || !j.borrar) return null;
  const c: Corto = { corto: `${origen}/c/${j.id}#${b64url(clave)}`, id: j.id, borrar: j.borrar };
  recordar(ruta, c);
  return c;
}

/**
 * Abre un enlace corto: trae los bytes, los descifra con la clave del
 * fragmento y devuelve la ruta a la que lleva, solo si es un comprobante o un
 * evento de este sitio. Nunca tira: dice qué pasó.
 */
export async function abrir(id: string, clave: string, op: Opciones = {}): Promise<Abierto> {
  if (!ES_ID.test(id) || !ES_CLAVE.test(clave)) return { error: "roto" };
  const f = op.fetch ?? fetch;
  let bytes: Uint8Array<ArrayBuffer> | null;
  try {
    bytes = await conEspera(op.espera ?? ESPERA_ABRIR_MS, async (signal) => {
      const r = await f(`${op.servicio ?? SERVICIO}/v1/${id}`, { signal });
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`corto-${r.status}`);
      return new Uint8Array(await r.arrayBuffer());
    });
  } catch {
    return { error: "red" };
  }
  if (!bytes) return { error: "no-existe" };
  try {
    const j = JSON.parse(await descifrar(bytes, deB64url(clave))) as { v?: unknown; u?: unknown };
    if (j.v !== VERSION || !esRuta(j.u)) return { error: "roto" };
    const corto: Corto = { corto: `${op.origen ?? location.origin}/c/${id}#${clave}`, id, borrar: "" };
    try {
      recordar(j.u, corto);
    } catch {
      /* recordar es para volver a compartirlo; abrirlo no depende de eso */
    }
    return { ruta: j.u, corto };
  } catch {
    return { error: "roto" };
  }
}

/**
 * Borra el corto de un enlace largo, si este equipo lo creó. Después de esto,
 * quien tenga el enlace corto o el QR ya no lo puede abrir. Devuelve si quedó
 * borrado (también si el servicio ya no lo tenía).
 */
export async function borrarCorto(enlaceLargo: string, op: Opciones = {}): Promise<boolean> {
  const ruta = rutaDe(enlaceLargo);
  const c = ruta ? deRuta(ruta) : null;
  if (!ruta || !c?.borrar) return false;
  if (!(await borrarId(c.id, c.borrar, op))) return false;
  olvidar(ruta);
  return true;
}

/** El DELETE de un id con su permiso. Borrado, o ya no estaba: true. */
async function borrarId(id: string, permiso: string, op: Opciones): Promise<boolean> {
  const f = op.fetch ?? fetch;
  try {
    const estado = await conEspera(op.espera ?? ESPERA_CREAR_MS, async (signal) => {
      const r = await f(`${op.servicio ?? SERVICIO}/v1/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${permiso}` },
        signal,
      });
      return r.status;
    });
    return estado === 204 || estado === 404;
  } catch {
    return false;
  }
}

/** Cuántos enlaces cortos creó este equipo y puede borrar. */
export function cortosBorrables(): number {
  return Object.values(leerGuardados()).filter((g) => valido(g) && !!g.b).length;
}

/**
 * Borra todos los enlaces cortos que creó este equipo, también los de un
 * evento al que después se le cambió el nombre o los sorteos (su enlace largo
 * ya es otro, y no hay otra forma de llegar a ellos).
 */
export async function borrarTodos(op: Opciones = {}): Promise<{ borrados: number; fallaron: number }> {
  const idos: string[] = [];
  let fallaron = 0;
  for (const [k, x] of Object.entries(leerGuardados())) {
    if (!valido(x) || !x.b) continue;
    if (await borrarId(x.i, x.b, op)) {
      idos.push(k);
      for (const [ruta, c] of memoria) if (c.id === x.i) memoria.delete(ruta);
    } else fallaron++;
  }
  // Se vuelve a leer: mientras se borraba pudo nacer otro corto, que se queda.
  const g = leerGuardados();
  for (const k of idos) delete g[k];
  escribirGuardados(g);
  return { borrados: idos.length, fallaron };
}

/** Para las pruebas: olvida lo que hay en memoria (lo guardado queda). */
export function olvidarMemoria(): void {
  memoria.clear();
  enCurso.clear();
}
