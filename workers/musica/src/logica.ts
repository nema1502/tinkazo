/**
 * La música de los juegos, solo para el sitio.
 *
 *   GET  /<juego>.mp3   → 200 (o 206 con Range) el archivo, si el pedido viene de tinkazo.app
 *   HEAD /<juego>.mp3   → lo mismo, sin cuerpo
 *
 * Todo lo demás es 404 (otra ruta) o 405 (otro método). No hay listado ni subida por
 * HTTP: los archivos se suben con `wrangler r2 object put` (ver `subir.mjs`).
 *
 * Esta lógica no importa nada de Cloudflare para que las pruebas la corran con una
 * fuente de mentira (R2 o archivos propios). `index.ts` solo la enchufa al Worker.
 */

/** Los únicos orígenes que reciben música. */
export const ORIGENES = ["https://tinkazo.app", "https://www.tinkazo.app"] as const;

const RUTA = /^\/([a-z0-9-]{1,32})\.mp3$/;
const PEDIDO_RANGE = /^bytes=(\d*)-(\d*)$/;

/** Lo mínimo que usamos de un objeto de R2. */
export interface ObjetoR2 {
  size: number;
  httpEtag?: string;
  body?: ReadableStream | null;
  range?: { offset: number; length: number };
}

/**
 * De dónde salen los bytes: lo que la lógica necesita y nada más. Un bucket de R2 ya
 * cumple esta forma tal cual; los archivos propios del Worker (Static Assets) entran
 * por `fuenteDeAssets`. La puerta por `Origin` y las cabeceras son las mismas con las dos.
 */
export interface Fuente {
  get(key: string, opciones?: { range?: { offset: number; length?: number } | { suffix: number } }): Promise<ObjetoR2 | null>;
  head(key: string): Promise<ObjetoR2 | null>;
}

/** Un `Fetcher` de Cloudflare, que es lo que es el binding `ASSETS`. */
export interface Fetcher {
  fetch(req: Request): Promise<Response>;
}

/**
 * Los archivos propios del Worker (`camas/`, ver wrangler.toml) vistos como una `Fuente`.
 *
 * `ASSETS.fetch` no se fía para los tramos (`Range`) ni para `HEAD` (en local contesta el
 * archivo entero a un `Range` y un `Content-Length` de 0 a un `HEAD`), así que el tramo se
 * corta acá: cada cama pesa unos 280 KB y cabe de sobra en memoria. El tamaño se mide
 * leyendo los bytes, porque `ASSETS` tampoco deja un `Content-Length` en el que confiar.
 */
export function fuenteDeAssets(assets: Fetcher): Fuente {
  const pedir = (key: string) => assets.fetch(new Request(`https://camas.interno/${key}`));
  return {
    async get(key, opciones) {
      const res = await pedir(key);
      if (res.status !== 200) {
        await res.body?.cancel();
        return null;
      }
      const etag = res.headers.get("ETag") ?? undefined;
      const extra = etag ? { httpEtag: etag } : {};
      const r = opciones?.range;
      const bytes = new Uint8Array(await res.arrayBuffer());
      const size = bytes.length;
      if (!r) return { size, body: new Response(bytes).body, ...extra };
      const offset = "suffix" in r ? Math.max(0, size - r.suffix) : Math.min(r.offset, size);
      const fin = "suffix" in r || r.length === undefined ? size : Math.min(size, offset + r.length);
      return { size, body: new Response(bytes.slice(offset, fin)).body, range: { offset, length: fin - offset }, ...extra };
    },
    async head(key) {
      const res = await pedir(key);
      if (res.status !== 200) {
        await res.body?.cancel();
        return null;
      }
      const etag = res.headers.get("ETag") ?? undefined;
      return { size: (await res.arrayBuffer()).byteLength, ...(etag ? { httpEtag: etag } : {}) };
    },
  };
}

const TEXTO = { "Content-Type": "text/plain; charset=utf-8" };

function cors(origen: string): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origen,
    "Access-Control-Expose-Headers": "Content-Length, Content-Range, Accept-Ranges, ETag",
    // El mismo archivo contesta distinto según el origen: ningún caché lo mezcla.
    Vary: "Origin",
  };
}

function rechazo(estado: number, cuerpo: string, extra: Record<string, string> = {}): Response {
  return new Response(`${cuerpo}\n`, { status: estado, headers: { ...TEXTO, "Cache-Control": "no-store", ...extra } });
}

/**
 * `Range: bytes=a-b`, `a-` o `-n`. Devuelve el rango para R2, `null` si no hay
 * cabecera (o es de otra forma: se sirve entero) y `"mal"` si no se puede cumplir.
 */
export function leerRange(cabecera: string | null): { offset: number; length?: number } | { suffix: number } | null | "mal" {
  if (!cabecera) return null;
  const m = PEDIDO_RANGE.exec(cabecera.trim());
  if (!m) return null;
  const [, a = "", b = ""] = m;
  if (a === "" && b === "") return "mal";
  if (a === "") {
    const n = Number(b);
    return n > 0 ? { suffix: n } : "mal";
  }
  const desde = Number(a);
  if (b === "") return { offset: desde };
  const hasta = Number(b);
  return hasta >= desde ? { offset: desde, length: hasta - desde + 1 } : "mal";
}

export async function servir(req: Request, fuente: Fuente): Promise<Response> {
  if (req.method !== "GET" && req.method !== "HEAD") return rechazo(405, "Solo se lee la música.", { Allow: "GET, HEAD" });

  const m = RUTA.exec(new URL(req.url).pathname);
  if (!m) return rechazo(404, "No hay nada acá.");

  // La música es del sitio: sin su origen, o con otro, no sale.
  const origen = req.headers.get("Origin");
  if (!origen || !(ORIGENES as readonly string[]).includes(origen)) {
    return rechazo(403, "Esta música es del sitio de Tinkazo y solo se escucha desde tinkazo.app.", { Vary: "Origin" });
  }

  const key = `${m[1]}.mp3`;
  const base: Record<string, string> = {
    ...cors(origen),
    "Content-Type": "audio/mpeg",
    "Cache-Control": "public, max-age=31536000, immutable",
    "Accept-Ranges": "bytes",
  };

  if (req.method === "HEAD") {
    const o = await fuente.head(key);
    if (!o) return rechazo(404, "Ese archivo no existe.", cors(origen));
    return new Response(null, { status: 200, headers: { ...base, "Content-Length": String(o.size), ...(o.httpEtag ? { ETag: o.httpEtag } : {}) } });
  }

  const rango = leerRange(req.headers.get("Range"));
  if (rango === "mal") return rechazo(416, "Ese tramo no se puede dar.", cors(origen));
  const o = await fuente.get(key, rango ? { range: rango } : undefined);
  if (!o) return rechazo(404, "Ese archivo no existe.", cors(origen));

  const cabeceras: Record<string, string> = { ...base, ...(o.httpEtag ? { ETag: o.httpEtag } : {}) };
  if (rango && o.range) {
    const { offset, length } = o.range;
    if (length <= 0) {
      await o.body?.cancel();
      return rechazo(416, "Ese tramo no se puede dar.", { ...cors(origen), "Content-Range": `bytes */${o.size}` });
    }
    // R2 no dice el tamaño total en un tramo: `size` es el del objeto entero.
    cabeceras["Content-Range"] = `bytes ${offset}-${offset + length - 1}/${o.size}`;
    cabeceras["Content-Length"] = String(length);
    return new Response(o.body ?? null, { status: 206, headers: cabeceras });
  }
  cabeceras["Content-Length"] = String(o.size);
  return new Response(o.body ?? null, { status: 200, headers: cabeceras });
}
