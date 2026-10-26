/**
 * Enlaces cortos para los comprobantes.
 *
 * Guarda bytes opacos detrás de un id de 8 caracteres y los devuelve. Los bytes
 * son el comprobante cifrado en el navegador: la clave viaja en el fragmento del
 * enlace (tinkazo.app/c/<id>#<clave>) y nunca llega acá, así que este servicio
 * no puede leer los nombres. La verificación tampoco depende de él: la página
 * vuelve a calcular el sello de la lista y lo compara con el que está en Stellar.
 *
 *   POST   /v1        cuerpo binario, hasta 256 KB      → 201 {"id", "borrar"}
 *   GET    /v1/<id>                                     → 200 los mismos bytes
 *   DELETE /v1/<id>   Authorization: Bearer <borrar>    → 204
 *   DELETE /v1/<id>   Authorization: Bearer <ADMIN_TOKEN> → 204 (Tinkazo, a pedido)
 *   GET    /<id>                                        → 302 a tinkazo.app/c/<id>
 *
 * Y el contador anónimo del embudo (ver `conteo.ts` y README.md):
 *
 *   POST   /v1/contar    {"e", "p"?, "ref"?}, hasta 512 bytes → 204
 *   GET    /v1/conteos?desde=AAAA-MM-DD&hasta=AAAA-MM-DD      → 200 [{dia, e, p, ref?, n}]
 *
 * Un enlace no vence: queda para que el sorteo se pueda volver a comprobar. La
 * interfaz no ofrece borrarlo (cortaba la verificación de todos los que ya lo
 * tenían); si alguien necesita que se borre, por ejemplo porque alguien de la
 * lista lo pide, lo borra Tinkazo con el secreto del Worker (ver README.md).
 *
 * Lo guardan Durable Objects con SQLite: son consistentes apenas escriben, así que
 * un enlace recién creado abre al instante en cualquier país. Los enlaces se
 * reparten en 62 objetos según el primer carácter del id (en el plan gratis cada
 * objeto puede tener hasta 1 GB y la cuenta 5 GB), y un objeto aparte lleva los
 * cupos.
 */
import { DurableObject } from "cloudflare:workers";
import { type ConteoValido, type Fila, MAX_CUERPO, claveDeProps, claveDeRef, diaUtc, filaDe, grupoDeIp, rangoDeDias, validarConteo } from "./conteo";

export interface Env {
  ALMACEN: DurableObjectNamespace<Almacen>;
  /** El contador del embudo: un solo objeto, "conteos". */
  CONTADOR: DurableObjectNamespace<Contador>;
  /**
   * El permiso de Tinkazo para borrar cualquier enlace, a pedido. Es un secreto
   * del Worker (`npx wrangler@4 secret put ADMIN_TOKEN`). Si no está cargado, o
   * tiene menos de 32 caracteres, ese camino no existe.
   */
  ADMIN_TOKEN?: string;
}

const SITIO = "https://tinkazo.app";
const MAX_BYTES = 256 * 1024;
const ID_LARGO = 8;
const ALFABETO = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const ES_ID = /^[0-9A-Za-z]{8}$/;
/** Altas por dirección IP y por hora. Se cuentan en memoria: si el objeto se duerme, vuelven a cero. */
const POR_IP_POR_HORA = 60;
/** Altas por día en total: cuida el plan gratis (100.000 filas escritas por día). */
const POR_DIA = 20_000;
/** El largo mínimo del secreto de administración: uno más corto se podría adivinar probando. */
const ADMIN_MINIMO = 32;

/**
 * Desde dónde se pueden crear enlaces. Leer, desde cualquier lado: los bytes van
 * cifrados. Borrar pide el permiso de ese enlace o el secreto de administración.
 */
function origenPermitido(origen: string | null): boolean {
  if (!origen) return false;
  if (origen === SITIO || origen === "https://www.tinkazo.app") return true;
  if (/^https:\/\/tinkazo(-[a-z0-9-]+)?\.vercel\.app$/.test(origen)) return true;
  return /^http:\/\/localhost:\d{2,5}$/.test(origen);
}

function cors(origen: string | null, metodos: string): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origenPermitido(origen) && origen ? origen : "*",
    "Access-Control-Allow-Methods": metodos,
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function json(cuerpo: unknown, estado: number, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(cuerpo), {
    status: estado,
    headers: { "Content-Type": "application/json; charset=utf-8", "X-Content-Type-Options": "nosniff", ...extra },
  });
}

/** Un id de 8 caracteres de base 62, sin sesgo: se descartan los bytes de 248 en adelante. */
function nuevoId(): string {
  let id = "";
  while (id.length < ID_LARGO) {
    for (const b of crypto.getRandomValues(new Uint8Array(16))) {
      if (b < 248 && id.length < ID_LARGO) id += ALFABETO[b % 62];
    }
  }
  return id;
}

function base64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sha256Hex(texto: string): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texto)));
  return Array.from(h, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Si `dado` es el secreto de administración. En tiempo constante: se comparan
 * las huellas SHA-256 de los dos, que siempre miden lo mismo, con la comparación
 * de Workers que no corta en la primera diferencia. Sin el secreto cargado (o con
 * uno de menos de 32 caracteres) siempre da false.
 */
async function esAdmin(dado: string, env: Env): Promise<boolean> {
  const secreto = env.ADMIN_TOKEN ?? "";
  if (secreto.length < ADMIN_MINIMO || !dado) return false;
  const huella = (s: string) => crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  const [a, b] = await Promise.all([huella(dado), huella(secreto)]);
  return crypto.subtle.timingSafeEqual(a, b);
}

type Permiso = { ok: true } | { ok: false; motivo: "cupo-ip" | "cupo-dia" };

export class Almacen extends DurableObject<Env> {
  private porIp = new Map<string, { n: number; vence: number }>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS enlaces (id TEXT PRIMARY KEY, datos BLOB NOT NULL, borrar TEXT NOT NULL, creado INTEGER NOT NULL)",
    );
    ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS cuotas (dia TEXT PRIMARY KEY, n INTEGER NOT NULL)");
  }

  /** Solo en el objeto de los cupos: cuenta un alta, o dice por qué no. */
  async permitir(ip: string): Promise<Permiso> {
    const ahora = Date.now();
    const c = this.porIp.get(ip);
    if (c && c.vence > ahora && c.n >= POR_IP_POR_HORA) return { ok: false, motivo: "cupo-ip" };
    const dia = new Date(ahora).toISOString().slice(0, 10);
    const hoy = this.ctx.storage.sql.exec<{ n: number }>("SELECT n FROM cuotas WHERE dia = ?", dia).toArray()[0]?.n ?? 0;
    if (hoy >= POR_DIA) return { ok: false, motivo: "cupo-dia" };
    this.ctx.storage.sql.exec("INSERT INTO cuotas (dia, n) VALUES (?, 1) ON CONFLICT(dia) DO UPDATE SET n = n + 1", dia);
    if (hoy === 0) {
      // El primer alta del día limpia los días viejos.
      this.ctx.storage.sql.exec("DELETE FROM cuotas WHERE dia < ?", new Date(ahora - 3 * 86_400_000).toISOString().slice(0, 10));
    }
    if (!c || c.vence <= ahora) this.porIp.set(ip, { n: 1, vence: ahora + 3_600_000 });
    else c.n += 1;
    if (this.porIp.size > 10_000) this.porIp.clear();
    return { ok: true };
  }

  /** Guarda bajo `id` y devuelve el token para borrarlo, o null si el id ya estaba usado. */
  async guardar(id: string, datos: ArrayBuffer): Promise<string | null> {
    if (this.ctx.storage.sql.exec("SELECT 1 FROM enlaces WHERE id = ?", id).toArray().length) return null;
    const borrar = base64url(crypto.getRandomValues(new Uint8Array(16)));
    this.ctx.storage.sql.exec(
      "INSERT INTO enlaces (id, datos, borrar, creado) VALUES (?, ?, ?, ?)",
      id,
      datos,
      await sha256Hex(borrar),
      Date.now(),
    );
    return borrar;
  }

  async leer(id: string): Promise<ArrayBuffer | null> {
    const fila = this.ctx.storage.sql.exec<{ datos: ArrayBuffer }>("SELECT datos FROM enlaces WHERE id = ?", id).toArray()[0];
    return fila ? fila.datos : null;
  }

  async borrar(id: string, token: string): Promise<"borrado" | "no-existe" | "prohibido"> {
    const fila = this.ctx.storage.sql.exec<{ borrar: string }>("SELECT borrar FROM enlaces WHERE id = ?", id).toArray()[0];
    if (!fila) return "no-existe";
    if (fila.borrar !== (await sha256Hex(token))) return "prohibido";
    this.ctx.storage.sql.exec("DELETE FROM enlaces WHERE id = ?", id);
    return "borrado";
  }

  /** El borrado a pedido, sin el permiso del enlace: lo pide solo quien trae el secreto de administración. */
  async borrarAPedido(id: string): Promise<"borrado" | "no-existe"> {
    if (!this.ctx.storage.sql.exec("SELECT 1 FROM enlaces WHERE id = ?", id).toArray().length) return "no-existe";
    this.ctx.storage.sql.exec("DELETE FROM enlaces WHERE id = ?", id);
    return "borrado";
  }
}

/* ------------------------------------------------------------- el contador */

/** Conteos por IP (en IPv6, por /64) y por hora. En memoria: la IP no se guarda, y si el objeto se duerme vuelven a cero. */
const CONTEOS_POR_IP_POR_HORA = 1_000;
/** Conteos por día en total. */
const CONTEOS_POR_DIA = 20_000;
/** Combinaciones distintas por día (evento, propiedades y sorteo): con el día lleno, solo suman las que ya existen. */
const FILAS_POR_DIA = 2_000;
/** Consultas por IP (en IPv6, por /64) y por hora, también en memoria. */
const CONSULTAS_POR_IP_POR_HORA = 60;
/** Consultas por día que leen la base: las repetidas salen de la memoria. Cuida las filas leídas por día, que comparten los enlaces. */
const CONSULTAS_POR_DIA = 500;
/** Filas por consulta, como mucho. */
const FILAS_POR_CONSULTA = 5_000;
/** Lo que vive una consulta en la memoria, como el `max-age` de la respuesta. */
const CONSULTA_VIVE_MS = 300_000;
/** Direcciones distintas que se recuerdan por hora; con el mapa lleno, una nueva espera (no se vacía: vaciarlo se podía forzar). */
const DIRECCIONES = 20_000;
const HORA_MS = 3_600_000;

type Cupos = Map<string, { n: number; vence: number }>;

/**
 * Cuenta una vez más para la dirección en esta hora, o dice que no. Con el
 * mapa lleno, primero se van las horas vencidas; si sigue lleno, una dirección
 * nueva no entra hasta que se libere lugar.
 */
function dentroDelCupo(cupos: Cupos, ip: string, max: number, ahora: number): boolean {
  const clave = grupoDeIp(ip);
  const c = cupos.get(clave);
  if (c && c.vence > ahora) {
    if (c.n >= max) return false;
    c.n += 1;
    return true;
  }
  if (!c && cupos.size >= DIRECCIONES) {
    for (const [k, v] of cupos) if (v.vence <= ahora) cupos.delete(k);
    if (cupos.size >= DIRECCIONES) return false;
  }
  cupos.set(clave, { n: 1, vence: ahora + HORA_MS });
  return true;
}

export type Suma = "ok" | "cupo-ip" | "cupo-dia" | "cupo-filas";
export type Consulta = { ok: true; filas: Fila[] } | { ok: false; motivo: "cupo-ip" | "cupo-dia" | "muchas" };

interface Hoy {
  dia: string;
  /** Conteos del día. */
  total: number;
  /** Las combinaciones del día que ya existen, para el tope de filas sin leer la base en cada conteo. */
  claves: Set<string>;
  consultas: number;
}

/**
 * Las sumas por día del embudo, en un solo objeto ("conteos"). Guarda
 * (día, evento, propiedades, sorteo) → cuántas veces: nunca un evento suelto,
 * ni la hora, ni la IP, ni nada que diga quién fue.
 *
 * Cada conteo se escribe al llegar: una fila escrita por conteo, con el tope de
 * 20.000 por día (una quinta parte de las 100.000 filas escritas por día de la
 * cuenta, que comparten los enlaces). Juntarlos en memoria y escribir una vez
 * por minuto (lo que sugería §4.8) se probó el 22-oct y se descartó: un objeto
 * quieto se apaga antes de su alarma y lo que tenía en memoria se pierde sin
 * aviso, justo cuando hay poco movimiento.
 */
export class Contador extends DurableObject<Env> {
  private porIp: Cupos = new Map();
  private consultasPorIp: Cupos = new Map();
  private hoy: Hoy | null = null;
  private recientes = new Map<string, { vence: number; filas: Fila[] }>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS conteos (dia TEXT NOT NULL, e TEXT NOT NULL, p TEXT NOT NULL, ref TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (dia, e, p, ref))",
    );
  }

  /** Lo de hoy. Se rehace al cambiar el día o al despertar, desde la base. */
  private delDia(ahora: number): Hoy {
    const dia = diaUtc(ahora);
    if (this.hoy?.dia !== dia) {
      const filas = this.ctx.storage.sql
        .exec<{ e: string; p: string; ref: string; n: number }>("SELECT e, p, ref, n FROM conteos WHERE dia = ?", dia)
        .toArray();
      this.hoy = {
        dia,
        total: filas.reduce((s, f) => s + f.n, 0),
        claves: new Set(filas.map((f) => `${f.e}\u0000${f.p}\u0000${f.ref}`)),
        consultas: 0,
      };
    }
    return this.hoy;
  }

  /** Suma uno a lo de hoy, o dice qué tope se pasó. Sin esperas en el medio: dos conteos no se pisan. */
  async sumar(c: ConteoValido, ip: string): Promise<Suma> {
    const ahora = Date.now();
    if (!dentroDelCupo(this.porIp, ip, CONTEOS_POR_IP_POR_HORA, ahora)) return "cupo-ip";
    const hoy = this.delDia(ahora);
    if (hoy.total >= CONTEOS_POR_DIA) return "cupo-dia";
    const p = claveDeProps(c.p);
    const ref = claveDeRef(c.ref);
    const combinacion = `${c.e}\u0000${p}\u0000${ref}`;
    if (!hoy.claves.has(combinacion)) {
      if (hoy.claves.size >= FILAS_POR_DIA) return "cupo-filas";
      hoy.claves.add(combinacion);
    }
    this.ctx.storage.sql.exec(
      "INSERT INTO conteos (dia, e, p, ref, n) VALUES (?, ?, ?, ?, 1) ON CONFLICT (dia, e, p, ref) DO UPDATE SET n = n + 1",
      hoy.dia,
      c.e,
      p,
      ref,
    );
    hoy.total += 1;
    return "ok";
  }

  /** Las sumas de `desde` a `hasta`, inclusive, en orden. */
  async leer(desde: string, hasta: string, ip: string): Promise<Consulta> {
    const ahora = Date.now();
    if (!dentroDelCupo(this.consultasPorIp, ip, CONSULTAS_POR_IP_POR_HORA, ahora)) return { ok: false, motivo: "cupo-ip" };
    const clave = `${desde}/${hasta}`;
    const guardada = this.recientes.get(clave);
    if (guardada && guardada.vence > ahora) return { ok: true, filas: guardada.filas };
    const hoy = this.delDia(ahora);
    if (hoy.consultas >= CONSULTAS_POR_DIA) return { ok: false, motivo: "cupo-dia" };
    hoy.consultas += 1;
    const filas = this.ctx.storage.sql
      .exec<{ dia: string; e: string; p: string; ref: string; n: number }>(
        "SELECT dia, e, p, ref, n FROM conteos WHERE dia >= ? AND dia <= ? ORDER BY dia, e, p, ref LIMIT ?",
        desde,
        hasta,
        FILAS_POR_CONSULTA + 1,
      )
      .toArray();
    if (filas.length > FILAS_POR_CONSULTA) return { ok: false, motivo: "muchas" };
    const publicadas = filas.map(filaDe);
    if (this.recientes.size >= 50) this.recientes.clear();
    this.recientes.set(clave, { vence: ahora + CONSULTA_VIVE_MS, filas: publicadas });
    return { ok: true, filas: publicadas };
  }
}

/** Desde dónde se cuenta: solo el sitio. El sitio tampoco cuenta desde otro lado (`src/contar.ts`). */
function origenDelSitio(origen: string | null): boolean {
  return origen === SITIO || origen === "https://www.tinkazo.app";
}

/**
 * `POST /v1/contar`. El sitio lo manda con `navigator.sendBeacon` y un cuerpo
 * de texto: sin consulta previa (CORS) y sin esperar la respuesta. Lo que no
 * está en la lista cerrada se rechaza entero.
 */
async function recibirConteo(req: Request, env: Env, origen: string | null): Promise<Response> {
  const h = cors(origenDelSitio(origen) ? origen : null, "POST, OPTIONS");
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: h });
  if (req.method !== "POST") return json({ error: "metodo" }, 405, { ...h, Allow: "POST, OPTIONS" });
  if (!origenDelSitio(origen)) return json({ error: "origen" }, 403, h);
  const largo = Number(req.headers.get("Content-Length") ?? "NaN");
  if (!Number.isFinite(largo)) return json({ error: "largo" }, 411, h);
  if (largo <= 0 || largo > MAX_CUERPO) return json({ error: "tamaño" }, 413, h);
  const bytes = await req.arrayBuffer();
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_CUERPO) return json({ error: "tamaño" }, 413, h);
  let cuerpo: unknown;
  try {
    cuerpo = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return json({ error: "json" }, 400, h);
  }
  const v = validarConteo(cuerpo);
  if (!v.ok) return json({ error: v.motivo }, 400, h);
  const ip = req.headers.get("CF-Connecting-IP") ?? "sin-ip";
  const r = await env.CONTADOR.get(env.CONTADOR.idFromName("conteos")).sumar(v.conteo, ip);
  if (r !== "ok") return json({ error: r }, 429, { ...h, "Retry-After": r === "cupo-ip" ? "3600" : "86400" });
  return new Response(null, { status: 204, headers: h });
}

/** `GET /v1/conteos`: las sumas por día, crudas y públicas, para el tablero y el script de métricas. */
async function publicarConteos(req: Request, env: Env, url: URL): Promise<Response> {
  const h: Record<string, string> = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Max-Age": "86400",
  };
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: h });
  if (req.method !== "GET") return json({ error: "metodo" }, 405, { ...h, Allow: "GET, OPTIONS" });
  const rango = rangoDeDias(url.searchParams.get("desde"), url.searchParams.get("hasta"), Date.now());
  if (!rango) return json({ error: "rango" }, 400, h);
  const ip = req.headers.get("CF-Connecting-IP") ?? "sin-ip";
  const r = await env.CONTADOR.get(env.CONTADOR.idFromName("conteos")).leer(rango.desde, rango.hasta, ip);
  if (!r.ok) {
    if (r.motivo === "muchas") return json({ error: "muchas" }, 413, h);
    return json({ error: r.motivo }, 429, { ...h, "Retry-After": r.motivo === "cupo-ip" ? "3600" : "86400" });
  }
  return json(r.filas, 200, { ...h, "Cache-Control": "public, max-age=300" });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const origen = req.headers.get("Origin");
    const partes = url.pathname.split("/").filter(Boolean);
    /** El objeto que guarda un id: uno por primer carácter. */
    const de = (id: string) => env.ALMACEN.get(env.ALMACEN.idFromName(`s-${id[0]}`));

    // El contador: sus nombres no tienen 8 caracteres, así que no se cruzan con un enlace.
    if (partes[0] === "v1" && partes.length === 2 && partes[1] === "contar") return recibirConteo(req, env, origen);
    if (partes[0] === "v1" && partes.length === 2 && partes[1] === "conteos") return publicarConteos(req, env, url);

    if (partes[0] === "v1") {
      const id = partes[1];
      if (req.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: cors(origen, "GET, POST, DELETE, OPTIONS") });
      }

      if (partes.length === 1 && req.method === "POST") {
        const h = cors(origen, "POST, OPTIONS");
        if (!origenPermitido(origen)) return json({ error: "origen" }, 403, h);
        const largo = Number(req.headers.get("Content-Length") ?? "NaN");
        if (!Number.isFinite(largo)) return json({ error: "largo" }, 411, h);
        if (largo <= 0 || largo > MAX_BYTES) return json({ error: "tamaño" }, 413, h);
        const datos = await req.arrayBuffer();
        if (datos.byteLength === 0 || datos.byteLength > MAX_BYTES) return json({ error: "tamaño" }, 413, h);
        const ip = req.headers.get("CF-Connecting-IP") ?? "sin-ip";
        const permiso = await env.ALMACEN.get(env.ALMACEN.idFromName("cupos")).permitir(ip);
        if (!permiso.ok) {
          return json({ error: permiso.motivo }, 429, { ...h, "Retry-After": permiso.motivo === "cupo-ip" ? "3600" : "86400" });
        }
        for (let intento = 0; intento < 5; intento++) {
          const nuevo = nuevoId();
          const borrar = await de(nuevo).guardar(nuevo, datos);
          if (borrar) return json({ id: nuevo, borrar }, 201, h);
        }
        return json({ error: "ocupado" }, 503, h);
      }

      if (partes.length === 2 && id && ES_ID.test(id)) {
        if (req.method === "GET" || req.method === "HEAD") {
          const h = cors(origen, "GET, OPTIONS");
          const datos = await de(id).leer(id);
          if (!datos) return json({ error: "no-existe" }, 404, h);
          return new Response(req.method === "HEAD" ? null : datos, {
            status: 200,
            headers: {
              ...h,
              "Content-Type": "application/octet-stream",
              "Cache-Control": "public, max-age=300",
              "X-Content-Type-Options": "nosniff",
            },
          });
        }
        if (req.method === "DELETE") {
          const h = cors(origen, "DELETE, OPTIONS");
          const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
          if (!token) return json({ error: "token" }, 401, h);
          // Tinkazo, a pedido: con el secreto del Worker se borra cualquier enlace.
          if (await esAdmin(token, env)) {
            const a = await de(id).borrarAPedido(id);
            if (a === "no-existe") return json({ error: "no-existe" }, 404, h);
            return new Response(null, { status: 204, headers: h });
          }
          const r = await de(id).borrar(id, token);
          if (r === "no-existe") return json({ error: "no-existe" }, 404, h);
          if (r === "prohibido") return json({ error: "token" }, 403, h);
          return new Response(null, { status: 204, headers: h });
        }
      }
      return json({ error: "no-existe" }, 404, cors(origen, "GET, POST, DELETE, OPTIONS"));
    }

    // Quien abre c.tinkazo.app/<id> en el navegador va a la página del comprobante.
    // El fragmento (la clave) lo conserva el navegador al seguir la redirección.
    if (req.method === "GET" && partes.length === 1 && partes[0] && ES_ID.test(partes[0])) {
      return Response.redirect(`${SITIO}/c/${partes[0]}`, 302);
    }
    if (req.method === "GET" && partes.length === 0) return Response.redirect(SITIO, 302);
    return new Response("No existe.", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  },
} satisfies ExportedHandler<Env>;
