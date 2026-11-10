import type { TipoDeEvento, VistaDeCuenta } from "../../workers/cuenta/src/reglas";

/**
 * Cómo habla el sitio con el Worker de la cuenta (`workers/cuenta`). Cada función devuelve `null` o un estado de
 * error en vez de lanzar: sin el Worker (caído, sin red, apagado) la pantalla sigue, solo que sin monedas.
 * La IP y el navegador no se mandan; el Worker no pide más que la cuenta pública.
 */

type Fetcher = typeof fetch;
const ESPERA_MS = 12_000;

async function pedir(f: Fetcher, url: string, init: RequestInit = {}): Promise<Response | null> {
  try {
    return await f(url, { ...init, signal: AbortSignal.timeout(ESPERA_MS), credentials: "omit", referrerPolicy: "no-referrer" });
  } catch {
    return null;
  }
}

const ruta = (base: string, recurso: string, cuenta: string, accion = ""): string => `${base}/v1/${recurso}/${encodeURIComponent(cuenta)}${accion ? `/${accion}` : ""}`;

const jsonPost = (cuerpo: unknown, extra: Record<string, string> = {}): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json", ...extra },
  body: JSON.stringify(cuerpo),
});

/** El saldo, lo hecho, el catálogo de la tiendita y el plan de la cuenta, o `null` si no se pudo leer. */
export async function leerCuenta(base: string, cuenta: string, f: Fetcher = fetch): Promise<VistaDeCuenta | null> {
  const r = await pedir(f, ruta(base, "monedas", cuenta));
  if (!r?.ok) return null;
  try {
    const x = (await r.json()) as VistaDeCuenta;
    return typeof x?.saldo === "number" && Array.isArray(x.catalogo) ? x : null;
  } catch {
    return null;
  }
}

export interface RespuestaDeEvento {
  acreditado: boolean;
  monedas?: number;
  saldo?: number;
  /** `ya`, `tope`, `sin-pago`, `sin-cuenta`. */
  motivo?: string;
}

/** Cuenta un hecho (`primer_sorteo`, `primera_carga`, `comprobar`). `null` si el Worker no contestó. */
export async function pedirEvento(base: string, cuenta: string, tipo: TipoDeEvento, ref?: string, f: Fetcher = fetch): Promise<RespuestaDeEvento | null> {
  const r = await pedir(f, ruta(base, "monedas", cuenta, "evento"), jsonPost({ tipo, ...(ref ? { ref } : {}) }));
  if (!r?.ok) return null;
  try {
    const x = (await r.json()) as RespuestaDeEvento;
    return typeof x?.acreditado === "boolean" ? x : null;
  } catch {
    return null;
  }
}

export interface RespuestaDePlan {
  activado: boolean;
  /** `sin-pago` o `ya`. */
  motivo?: string;
  plan?: { inicio: number; vence: number; tx: string } | null;
  monedas?: number;
  saldo?: number;
}

/** Le pide al Worker que active el plan: él mira el pago en la red. `"apagado"` si no está prendido, `null` si no contestó. */
export async function activarPlan(base: string, cuenta: string, f: Fetcher = fetch): Promise<RespuestaDePlan | "apagado" | null> {
  const r = await pedir(f, ruta(base, "plan", cuenta, "activar"), jsonPost({}));
  if (!r) return null;
  if (r.status === 503) return "apagado";
  if (!r.ok) return null;
  try {
    const x = (await r.json()) as RespuestaDePlan;
    return typeof x?.activado === "boolean" ? x : null;
  } catch {
    return null;
  }
}

export type ResultadoDeCanje =
  | { estado: "ok"; saldo: number; repetido: boolean }
  | { estado: "saldo"; saldo: number; falta: number }
  /** El token no es de quien organiza (o falta). */
  | { estado: "token" }
  /** El Worker no tiene canjes prendidos. */
  | { estado: "apagado" }
  | { estado: "error" };

/** Marca un canje. Solo lo pide quien organiza, con su token; el navegador de quien participa no lo tiene. */
export async function pedirCanje(base: string, cuenta: string, token: string, codigo: string, id: string, f: Fetcher = fetch): Promise<ResultadoDeCanje> {
  const r = await pedir(f, ruta(base, "monedas", cuenta, "canje"), jsonPost({ codigo, id }, { Authorization: `Bearer ${token}` }));
  if (!r) return { estado: "error" };
  try {
    const x = (await r.json()) as { saldo?: number; falta?: number; repetido?: boolean };
    if (r.ok) return typeof x.saldo === "number" ? { estado: "ok", saldo: x.saldo, repetido: x.repetido === true } : { estado: "error" };
    if (r.status === 409 && typeof x.saldo === "number" && typeof x.falta === "number") return { estado: "saldo", saldo: x.saldo, falta: x.falta };
    if (r.status === 401 || r.status === 403) return { estado: "token" };
    if (r.status === 503) return { estado: "apagado" };
  } catch {
    /* sin cuerpo que leer */
  }
  return { estado: "error" };
}

/** Un identificador para un canje: si el toque se repite, el Worker no descuenta dos veces. */
export function idDeCanje(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(15));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_");
}
