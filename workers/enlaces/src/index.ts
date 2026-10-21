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
 *   GET    /<id>                                        → 302 a tinkazo.app/c/<id>
 *
 * Lo guarda un Durable Object con SQLite: es consistente apenas escribe, así que
 * un enlace recién creado abre al instante en cualquier país.
 */
import { DurableObject } from "cloudflare:workers";

export interface Env {
  ALMACEN: DurableObjectNamespace<Almacen>;
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

/** Desde dónde se pueden crear y borrar enlaces. Leer, desde cualquier lado: los bytes van cifrados. */
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

type Alta = { ok: true; id: string; borrar: string } | { ok: false; motivo: "cupo-ip" | "cupo-dia" };

export class Almacen extends DurableObject<Env> {
  private porIp = new Map<string, { n: number; vence: number }>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS enlaces (id TEXT PRIMARY KEY, datos BLOB NOT NULL, borrar TEXT NOT NULL, creado INTEGER NOT NULL)",
    );
    ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS cuotas (dia TEXT PRIMARY KEY, n INTEGER NOT NULL)");
  }

  async crear(datos: ArrayBuffer, ip: string): Promise<Alta> {
    const ahora = Date.now();
    const c = this.porIp.get(ip);
    if (c && c.vence > ahora && c.n >= POR_IP_POR_HORA) return { ok: false, motivo: "cupo-ip" };
    const dia = new Date(ahora).toISOString().slice(0, 10);
    const hoy = this.ctx.storage.sql.exec<{ n: number }>("SELECT n FROM cuotas WHERE dia = ?", dia).toArray()[0]?.n ?? 0;
    if (hoy >= POR_DIA) return { ok: false, motivo: "cupo-dia" };

    let id = nuevoId();
    while (this.ctx.storage.sql.exec("SELECT 1 FROM enlaces WHERE id = ?", id).toArray().length) id = nuevoId();
    const borrar = base64url(crypto.getRandomValues(new Uint8Array(16)));
    this.ctx.storage.sql.exec(
      "INSERT INTO enlaces (id, datos, borrar, creado) VALUES (?, ?, ?, ?)",
      id,
      datos,
      await sha256Hex(borrar),
      ahora,
    );
    this.ctx.storage.sql.exec(
      "INSERT INTO cuotas (dia, n) VALUES (?, 1) ON CONFLICT(dia) DO UPDATE SET n = n + 1",
      dia,
    );
    // Los días viejos no hacen falta.
    this.ctx.storage.sql.exec("DELETE FROM cuotas WHERE dia < ?", new Date(ahora - 3 * 86_400_000).toISOString().slice(0, 10));
    if (!c || c.vence <= ahora) this.porIp.set(ip, { n: 1, vence: ahora + 3_600_000 });
    else c.n += 1;
    if (this.porIp.size > 10_000) this.porIp.clear();
    return { ok: true, id, borrar };
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
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const origen = req.headers.get("Origin");
    const partes = url.pathname.split("/").filter(Boolean);
    const almacen = env.ALMACEN.get(env.ALMACEN.idFromName("v1"));

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
        const r = await almacen.crear(datos, ip);
        if (!r.ok) return json({ error: r.motivo }, 429, { ...h, "Retry-After": r.motivo === "cupo-ip" ? "3600" : "86400" });
        return json({ id: r.id, borrar: r.borrar }, 201, h);
      }

      if (partes.length === 2 && id && ES_ID.test(id)) {
        if (req.method === "GET" || req.method === "HEAD") {
          const h = cors(origen, "GET, OPTIONS");
          const datos = await almacen.leer(id);
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
          const r = await almacen.borrar(id, token);
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
