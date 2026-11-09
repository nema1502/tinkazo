/**
 * La cuenta de Tinkazo: monedas, tiendita y plan del equipo.
 *
 *   GET  /v1/monedas/<cuenta>               → 200 el saldo, lo hecho, el historial corto, lo que se puede canjear y el plan
 *   POST /v1/monedas/<cuenta>/evento        {tipo, ref?}  → 200 {acreditado, monedas?, saldo, motivo?}
 *   POST /v1/monedas/<cuenta>/canje         {codigo, id?} + Authorization: Bearer <token de quien organiza>
 *                                           → 200 {ok, canje, saldo, repetido} | 409 {error:"saldo", saldo, falta}
 *   GET  /v1/plan/<cuenta>                  → 200 {plan}
 *   POST /v1/plan/<cuenta>/activar          → 200 {activado, plan, monedas?, saldo, motivo?}
 *   GET  /v1/cuenta/<cuenta>/plan           → 200 {activo:true, vence, cupo:{sellos, sorteos}} | {activo:false}
 *                                           Público y de solo lectura (sin `Origin`): lo consulta el portero para subir el
 *                                           cupo de quien tiene el plan activo. Nada más sale de acá.
 *
 * Esta lógica no importa nada de Cloudflare para que las pruebas la corran con un libro, un Horizon y un reloj de
 * mentira (`servidor.test.ts`). `index.ts` solo la enchufa al Worker. Ver README.md.
 *
 * Lo que decide el Worker y no el navegador:
 * - la primera carga y el plan se comprueban contra Horizon antes de acreditar;
 * - un canje lo pide solo quien organiza (su token, guardado como huella SHA-256), nunca el navegador de quien participa;
 * - ningún camino compra monedas, las transfiere, las cambia por dinero ni da más probabilidades en un sorteo.
 */
import { type ContextoHorizon, buscarCarga, buscarPagosDePlan, cuentaExiste } from "./pagos";
import type { PorIp } from "./por-ip";
import { type Cuenta, type Red, acreditar, activarPlan, canjear, esCuenta, esTipoDeEvento, leerCanjes, leerCuenta, planParaElPortero, planVigente, vistaDe } from "./reglas";

/** Lo mínimo que se usa del libro: un KV de Cloudflare ya lo cumple. */
export interface Libro {
  get(clave: string): Promise<string | null>;
  put(clave: string, valor: string): Promise<void>;
}

export interface Entorno {
  CUENTAS: Libro;
  /** `testnet` (por defecto) o `mainnet`: la red de la que se leen los pagos. */
  RED?: string;
  /** La cuenta que cobra el plan del equipo. Sin ella, el plan está apagado. */
  CUENTA_PLANES?: string;
  /** Los canjes de la tiendita, en JSON. Sin ella, los de siempre. */
  CANJES?: string;
  /** Las huellas SHA-256 (hex) de los tokens de quienes organizan, separadas por comas. Sin ellas, no hay canjes. */
  HUELLAS_ORGANIZADORES?: string;
  /** Otro Horizon (solo para probar). */
  HORIZON_URL?: string;
}

export interface Dependencias {
  fetch: typeof fetch;
  ahora: () => number;
  /** Lecturas, escrituras y canjes por dirección y por hora. */
  leer: PorIp;
  escribir: PorIp;
  canjes: PorIp;
  /** Las consultas públicas del plan (las del portero llegan todas de la misma dirección: su tope es alto). */
  planes: PorIp;
}

export const LEER_POR_HORA = 240;
export const ESCRIBIR_POR_HORA = 60;
/** Un stand comparte la wifi: más margen para canjear que para pedir monedas. */
export const CANJES_POR_HORA = 240;
export const MAX_CUERPO = 512;
/** Consultas del plan por dirección y por hora: alto, porque el portero las hace todas desde la misma. */
export const PLAN_POR_HORA = 6000;
/** Cuánto puede guardar una respuesta del plan quien la recibe, en segundos: corto, para que un plan nuevo se note enseguida. */
export const PLAN_CACHE_S = 30;

const SITIO = "https://tinkazo.app";

/** Desde dónde se puede hablar con el Worker: el sitio, las vistas de Vercel y localhost. */
export function origenPermitido(origen: string | null): boolean {
  if (!origen) return false;
  if (origen === SITIO || origen === "https://www.tinkazo.app") return true;
  if (/^https:\/\/tinkazo(-[a-z0-9-]+)?\.vercel\.app$/.test(origen)) return true;
  return /^http:\/\/localhost:\d{2,5}$/.test(origen);
}

function cabeceras(origen: string | null, metodos: string): Record<string, string> {
  return {
    ...(origenPermitido(origen) && origen ? { "Access-Control-Allow-Origin": origen } : {}),
    "Access-Control-Allow-Methods": metodos,
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function json(cuerpo: unknown, estado: number, h: Record<string, string>, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(cuerpo), {
    status: estado,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...h, ...extra },
  });
}

const sha256Hex = async (texto: string): Promise<string> =>
  Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texto))), (b) => b.toString(16).padStart(2, "0")).join("");

/** Compara dos textos sin cortar en la primera diferencia. */
function iguales(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

const ES_TOKEN = /^[A-Za-z0-9._~-]{16,128}$/;

/** Si el token es de alguien que organiza: su huella SHA-256 está entre las del Worker. Sin huellas cargadas, nadie lo es. */
export async function esOrganizador(token: string, env: Entorno): Promise<boolean> {
  const huellas = (env.HUELLAS_ORGANIZADORES ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter((h) => /^[0-9a-f]{64}$/.test(h));
  if (huellas.length === 0 || !ES_TOKEN.test(token)) return false;
  const mia = await sha256Hex(token);
  let ok = false;
  for (const h of huellas) ok = iguales(h, mia) || ok;
  return ok;
}

const claveDe = (cuenta: string): string => `c:${cuenta}`;
const claveDeTx = (tx: string): string => `t:${tx}`;
const ES_REF = /^[A-Za-z0-9:._-]{1,64}$/;
const ES_ID = /^[A-Za-z0-9_-]{8,40}$/;

type Cuerpo = { ok: true; valor: Record<string, unknown> } | { ok: false; respuesta: Response };

async function leerCuerpo(req: Request, h: Record<string, string>): Promise<Cuerpo> {
  const largo = Number(req.headers.get("Content-Length") ?? "NaN");
  if (!Number.isFinite(largo)) return { ok: false, respuesta: json({ error: "largo" }, 411, h) };
  if (largo > MAX_CUERPO) return { ok: false, respuesta: json({ error: "tamaño" }, 413, h) };
  const bytes = await req.arrayBuffer();
  if (bytes.byteLength > MAX_CUERPO) return { ok: false, respuesta: json({ error: "tamaño" }, 413, h) };
  if (bytes.byteLength === 0) return { ok: true, valor: {} };
  try {
    const v: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (!v || typeof v !== "object" || Array.isArray(v)) return { ok: false, respuesta: json({ error: "json" }, 400, h) };
    return { ok: true, valor: v as Record<string, unknown> };
  } catch {
    return { ok: false, respuesta: json({ error: "json" }, 400, h) };
  }
}

export async function servir(req: Request, env: Entorno, dep: Dependencias): Promise<Response> {
  const url = new URL(req.url);
  const origen = req.headers.get("Origin");
  const partes = url.pathname.split("/").filter(Boolean);
  const [v, recurso, cuenta, accion] = partes;
  const metodos = "GET, POST, OPTIONS";
  const h = cabeceras(origen, metodos);

  // El plan para el portero: público y de solo lectura, sin pedir `Origin` (lo consulta otro Worker, no una página).
  if (v === "v1" && recurso === "cuenta" && accion === "plan" && cuenta && partes.length === 4) return servirPlanParaElPortero(req, cuenta, env, dep, h);

  if (v !== "v1" || (recurso !== "monedas" && recurso !== "plan") || !cuenta || partes.length > 4) {
    return json({ error: "no-existe" }, 404, h);
  }
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: h });
  if (!origenPermitido(origen)) return json({ error: "origen" }, 403, h);
  if (!esCuenta(cuenta)) return json({ error: "cuenta" }, 400, h);

  const ip = req.headers.get("CF-Connecting-IP") ?? "sin-ip";
  const red: Red = env.RED === "mainnet" ? "mainnet" : "testnet";
  const horizon: ContextoHorizon = { red, fetch: dep.fetch, ...(env.HORIZON_URL ? { horizon: env.HORIZON_URL } : {}) };
  const libro = env.CUENTAS;
  const leerLa = async (): Promise<Cuenta> => leerCuenta(await libro.get(claveDe(cuenta)));
  const guardar = (c: Cuenta): Promise<void> => libro.put(claveDe(cuenta), JSON.stringify(c));
  const catalogo = leerCanjes(env.CANJES);

  /* ---------------------------------------------------------------- lecturas */
  if (req.method === "GET" && !accion) {
    if (!dep.leer.toca(ip, LEER_POR_HORA)) return json({ error: "cupo-ip" }, 429, h, { "Retry-After": "3600" });
    const c = await leerLa();
    if (recurso === "plan") {
      const p = planVigente(c, dep.ahora());
      return json({ plan: p ? { inicio: p.inicio, vence: p.vence, tx: p.tx } : null }, 200, h);
    }
    return json(vistaDe(cuenta, c, catalogo, dep.ahora()), 200, h);
  }

  if (req.method !== "POST" || !accion) return json({ error: "metodo" }, 405, h, { Allow: metodos });

  /* ---------------------------------------------------------------- monedas: un hecho */
  if (recurso === "monedas" && accion === "evento") {
    if (!dep.escribir.toca(ip, ESCRIBIR_POR_HORA)) return json({ error: "cupo-ip" }, 429, h, { "Retry-After": "3600" });
    const cuerpo = await leerCuerpo(req, h);
    if (!cuerpo.ok) return cuerpo.respuesta;
    const { tipo, ref } = cuerpo.valor;
    if (!esTipoDeEvento(tipo)) return json({ error: "tipo" }, 400, h);
    if (ref !== undefined && (typeof ref !== "string" || !ES_REF.test(ref))) return json({ error: "ref" }, 400, h);

    // Lo barato primero: si ya llegó a su tope no se le pregunta nada a la red.
    const antes = acreditar(await leerLa(), tipo, dep.ahora(), ref);
    if (!antes.ok) return json({ acreditado: false, motivo: antes.motivo, saldo: (await leerLa()).saldo }, 200, h);

    if (tipo === "primera_carga") {
      const carga = await buscarCarga(cuenta, horizon);
      if (!carga.ok) return json({ error: "red" }, 502, h);
      if (!carga.valor) return json({ acreditado: false, motivo: "sin-pago", saldo: (await leerLa()).saldo }, 200, h);
    } else {
      // Una cuenta que no existe en la red no suma: sacarse monedas de la nada con direcciones inventadas cuesta algo.
      const existe = await cuentaExiste(cuenta, horizon);
      if (!existe.ok) return json({ error: "red" }, 502, h);
      if (!existe.valor) return json({ acreditado: false, motivo: "sin-cuenta", saldo: (await leerLa()).saldo }, 200, h);
    }

    // Se vuelve a leer después de esperar a la red: dos pedidos a la vez se ven entre sí lo más posible (KV no es transaccional).
    const fresca = await leerLa();
    const ahora = acreditar(fresca, tipo, dep.ahora(), ref);
    if (!ahora.ok) return json({ acreditado: false, motivo: ahora.motivo, saldo: fresca.saldo }, 200, h);
    await guardar(ahora.cuenta);
    return json({ acreditado: true, monedas: ahora.monedas, saldo: ahora.cuenta.saldo }, 200, h);
  }

  /* ---------------------------------------------------------------- monedas: un canje */
  if (recurso === "monedas" && accion === "canje") {
    if (!dep.canjes.toca(ip, CANJES_POR_HORA)) return json({ error: "cupo-ip" }, 429, h, { "Retry-After": "3600" });
    if (!(env.HUELLAS_ORGANIZADORES ?? "").trim()) return json({ error: "apagado" }, 503, h);
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "token" }, 401, h);
    if (!(await esOrganizador(token, env))) return json({ error: "token" }, 403, h);
    const cuerpo = await leerCuerpo(req, h);
    if (!cuerpo.ok) return cuerpo.respuesta;
    const { codigo, id } = cuerpo.valor;
    const item = catalogo.find((x) => x.codigo === codigo);
    if (!item) return json({ error: "codigo" }, 400, h);
    if (id !== undefined && (typeof id !== "string" || !ES_ID.test(id))) return json({ error: "id" }, 400, h);

    const c = await leerLa();
    const r = canjear(c, item, dep.ahora(), id);
    if (!r.ok) return json({ error: "saldo", saldo: r.saldo, falta: r.falta }, 409, h);
    if (!r.repetido) await guardar(r.cuenta);
    return json({ ok: true, repetido: r.repetido, canje: r.canje, saldo: r.cuenta.saldo }, 200, h);
  }

  /* ---------------------------------------------------------------- plan: activarlo */
  if (recurso === "plan" && accion === "activar") {
    if (!dep.escribir.toca(ip, ESCRIBIR_POR_HORA)) return json({ error: "cupo-ip" }, 429, h, { "Retry-After": "3600" });
    if (!esCuenta(env.CUENTA_PLANES)) return json({ error: "apagado" }, 503, h);
    const pagos = await buscarPagosDePlan(env.CUENTA_PLANES, cuenta, horizon);
    if (!pagos.ok) return json({ error: "red" }, 502, h);
    const c = await leerLa();
    if (pagos.valor.length === 0) return json({ activado: false, motivo: "sin-pago", saldo: c.saldo }, 200, h);

    // El más viejo de los pagos que todavía no activaron nada.
    for (const pago of [...pagos.valor].reverse()) {
      if (c.plan?.usadas.includes(pago.tx)) continue;
      // Un pago que ya tiene dueño (esta cuenta u otra) se usó: la anotación de la cuenta guarda solo los últimos.
      if (await libro.get(claveDeTx(pago.tx))) continue;
      const r = activarPlan(c, pago.tx, dep.ahora());
      if (!r.ok) continue;
      // Primero la cuenta y después la marca del pago: si se corta en el medio, la cuenta ya lo tiene como usado.
      await guardar(r.cuenta);
      await libro.put(claveDeTx(pago.tx), cuenta);
      const plan = r.cuenta.plan;
      return json({ activado: true, plan: plan ? { inicio: plan.inicio, vence: plan.vence, tx: plan.tx } : null, monedas: r.monedas, saldo: r.cuenta.saldo }, 200, h);
    }
    const p = planVigente(c, dep.ahora());
    return json({ activado: false, motivo: "ya", plan: p ? { inicio: p.inicio, vence: p.vence, tx: p.tx } : null, saldo: c.saldo }, 200, h);
  }

  return json({ error: "no-existe" }, 404, h);
}

/** `GET /v1/cuenta/<cuenta>/plan`: si el plan está activo, hasta cuándo y qué cupo da. Lee una vez y no escribe nunca. */
async function servirPlanParaElPortero(req: Request, cuenta: string, env: Entorno, dep: Dependencias, h: Record<string, string>): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: h });
  if (req.method !== "GET") return json({ error: "metodo" }, 405, h, { Allow: "GET, OPTIONS" });
  if (!esCuenta(cuenta)) return json({ error: "cuenta" }, 400, h);
  const ip = req.headers.get("CF-Connecting-IP") ?? "sin-ip";
  if (!dep.planes.toca(ip, PLAN_POR_HORA)) return json({ error: "cupo-ip" }, 429, h, { "Retry-After": "3600" });
  let crudo: string | null;
  try {
    crudo = await env.CUENTAS.get(claveDe(cuenta));
  } catch {
    return json({ error: "libro" }, 503, h);
  }
  return json(planParaElPortero(leerCuenta(crudo), dep.ahora()), 200, h, { "Cache-Control": `public, max-age=${PLAN_CACHE_S}` });
}
