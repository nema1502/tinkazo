/**
 * El kit para creadores de contenido: los clips verticales, el logo animado y las placas, para bajar.
 *
 *   GET  /kit/<archivo>   → 200 (o 206 con Range) el archivo, para cualquiera, como descarga
 *   HEAD /kit/<archivo>   → lo mismo, sin cuerpo
 *
 * A diferencia de la música, el kit es público: está hecho para que cualquiera lo baje y lo ponga en su
 * TikTok, y por eso no mira el `Origin` y deja leerlo desde cualquier página (`Access-Control-Allow-Origin: *`).
 * Lo demás es igual: solo se lee, no hay listado (la lista es `lista.json`, un archivo más) y todo lo que no
 * sea un archivo del kit con nombre simple es 404. La lógica no importa nada de Cloudflare, igual que
 * `logica.ts`: recibe una `Fuente` (un bucket de R2 o los archivos propios del Worker, carpeta `camas/kit/`).
 */
import { type Fuente, leerRange } from "./logica";

/** Nombre simple: minúsculas, números, guiones y puntos, y una extensión de las que entrega el kit. */
const RUTA = /^\/kit\/([a-z0-9][a-z0-9._-]{0,79}\.(?:mp4|webm|mov|png|jpg|webp|svg|srt|txt|zip|json))$/;

const TIPOS: Record<string, string> = {
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
  svg: "image/svg+xml",
  srt: "application/x-subrip; charset=utf-8",
  txt: "text/plain; charset=utf-8",
  zip: "application/zip",
  json: "application/json; charset=utf-8",
};

/** `true` si el pedido es de esta parte del Worker (`/kit/...`, con o sin archivo válido). */
export const esDelKit = (url: string): boolean => new URL(url).pathname.startsWith("/kit/");

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Expose-Headers": "Content-Length, Content-Range, Accept-Ranges, ETag",
};

function rechazo(estado: number, cuerpo: string, extra: Record<string, string> = {}): Response {
  return new Response(`${cuerpo}\n`, { status: estado, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", ...extra } });
}

/** Cuánto se guarda en los cachés: una hora, porque el kit puede crecer (un archivo nuevo o corregido llega con su nombre). */
export const CACHE_KIT = "public, max-age=3600";

/** `prefijo`: dónde vive el kit dentro de la fuente. En los archivos propios del Worker es la carpeta `kit/`; en un bucket de R2 solo para el kit, la raíz. */
export async function servirKit(req: Request, fuente: Fuente, prefijo = "kit/"): Promise<Response> {
  if (req.method !== "GET" && req.method !== "HEAD") return rechazo(405, "Solo se lee el kit.", { Allow: "GET, HEAD", ...CORS });
  const m = RUTA.exec(new URL(req.url).pathname);
  if (!m) return rechazo(404, "No hay nada acá.", CORS);
  const nombre = m[1] as string;
  const ext = nombre.slice(nombre.lastIndexOf(".") + 1);
  const key = `${prefijo}${nombre}`;
  const base: Record<string, string> = {
    ...CORS,
    "Content-Type": TIPOS[ext] ?? "application/octet-stream",
    // Baja como archivo, con el nombre del kit. Un <video> o una <img> de la página lo muestra igual.
    "Content-Disposition": `attachment; filename="${nombre}"`,
    "Cache-Control": CACHE_KIT,
    "Accept-Ranges": "bytes",
  };

  if (req.method === "HEAD") {
    const o = await fuente.head(key);
    if (!o) return rechazo(404, "Ese archivo no existe.", CORS);
    return new Response(null, { status: 200, headers: { ...base, "Content-Length": String(o.size), ...(o.httpEtag ? { ETag: o.httpEtag } : {}) } });
  }

  const rango = leerRange(req.headers.get("Range"));
  if (rango === "mal") return rechazo(416, "Ese tramo no se puede dar.", CORS);
  const o = await fuente.get(key, rango ? { range: rango } : undefined);
  if (!o) return rechazo(404, "Ese archivo no existe.", CORS);

  const cabeceras: Record<string, string> = { ...base, ...(o.httpEtag ? { ETag: o.httpEtag } : {}) };
  if (rango && o.range) {
    const { offset, length } = o.range;
    if (length <= 0) {
      await o.body?.cancel();
      return rechazo(416, "Ese tramo no se puede dar.", { ...CORS, "Content-Range": `bytes */${o.size}` });
    }
    cabeceras["Content-Range"] = `bytes ${offset}-${offset + length - 1}/${o.size}`;
    cabeceras["Content-Length"] = String(length);
    return new Response(o.body ?? null, { status: 206, headers: cabeceras });
  }
  cabeceras["Content-Length"] = String(o.size);
  return new Response(o.body ?? null, { status: 200, headers: cabeceras });
}
