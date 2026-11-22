/**
 * La caché corta del borde para las dos lecturas públicas del momento del resultado: `GET campana/estado` (sin pase y sin token)
 * y `GET campana/resultado`. Con cientos de celulares mirando a la vez, el objeto de la sala atiende como mucho un pedido cada
 * `VIDA_DE_LA_CACHE_S` segundos por lugar en vez de uno por celular.
 *
 * Qué se guarda y qué no:
 *  - Solo el estado y el cuerpo, nunca las cabeceras de origen: cada pedido recibe las suyas (`Access-Control-Allow-Origin` es
 *    del origen que preguntó), así que dos orígenes no se pisan.
 *  - Solo respuestas 200 y 404. Una falla pasajera no se recuerda, y tampoco el 404 de un resultado que todavía no existe
 *    (`sin-resultado`): cambia en el momento exacto en que quien organiza lo va a leer.
 *  - Nada que lleve pase (`?p=`) ni token: esas respuestas dependen de quien pregunta, y la del dueño trae más datos.
 *  - La clave es solo el camino: un parámetro inventado no esquiva la caché.
 * Sin la caché del borde (Node, o un entorno que no la tiene) todo sigue como siempre: cada pedido va a la sala.
 */

/** Cuánto vive una respuesta guardada. Más corto no ahorra nada; más largo atrasa el resultado en la mano de cada celular. */
export const VIDA_DE_LA_CACHE_S = 2;

/** Lo que el navegador y la caché compartida pueden recordar de estas lecturas. */
export const CABECERA_DE_CACHE = `public, max-age=${VIDA_DE_LA_CACHE_S}`;

/** Lo mínimo de la caché del borde de Cloudflare (`caches.default`) que este archivo usa. */
export interface CacheDeBorde {
  match(clave: Request): Promise<Response | undefined>;
  put(clave: Request, respuesta: Response): Promise<void>;
}

/** La caché del borde, o null si el entorno no la tiene. Se mira en cada pedido: nunca se guarda una referencia. */
export function cacheDeBorde(): CacheDeBorde | null {
  const caches = (globalThis as { caches?: { default?: CacheDeBorde } }).caches;
  const hay = caches?.default;
  return hay && typeof hay.match === "function" && typeof hay.put === "function" ? hay : null;
}

/** Si una lectura puede salir de la caché: ni pase ni token, que cambian lo que se contesta. */
export function esCacheable(url: URL, token: string): boolean {
  return token === "" && !url.searchParams.has("p");
}

/** La clave: el origen y el camino del sitio, sin parámetros. */
function claveDe(url: URL): Request {
  return new Request(`${url.origin}${url.pathname}`, { method: "GET" });
}

export interface Guardada {
  estado: number;
  cuerpo: unknown;
}

/**
 * Si lo guardado es el 404 de un resultado que todavía no existe. Ese no se sirve nunca de la caché: pasa a existir apenas la sala
 * lo guarda, y quien organiza lo lee en ese momento. Una entrada así que haya quedado de antes se ignora.
 */
export function esSinResultado(g: Guardada): boolean {
  const cuerpo = g.cuerpo;
  return g.estado === 404 && typeof cuerpo === "object" && cuerpo !== null && (cuerpo as { error?: unknown }).error === "sin-resultado";
}

/** Lo guardado para este camino, o null si no hay, si venció o si la caché falla (que nunca rompe el pedido). */
export async function leerGuardada(url: URL): Promise<Guardada | null> {
  const cache = cacheDeBorde();
  if (!cache) return null;
  try {
    const hay = await cache.match(claveDe(url));
    if (!hay) return null;
    const dato: unknown = JSON.parse(await hay.text());
    if (!dato || typeof dato !== "object") return null;
    const { estado, cuerpo } = dato as { estado?: unknown; cuerpo?: unknown };
    return estado === 200 || estado === 404 ? { estado, cuerpo } : null;
  } catch {
    return null;
  }
}

/** Guarda una respuesta pública por `VIDA_DE_LA_CACHE_S`. Solo 200 y 404. Devuelve la promesa para `ctx.waitUntil`. */
export async function guardar(url: URL, estado: number, cuerpo: unknown): Promise<void> {
  const cache = cacheDeBorde();
  if (!cache || (estado !== 200 && estado !== 404)) return;
  try {
    await cache.put(
      claveDe(url),
      new Response(JSON.stringify({ estado, cuerpo }), {
        headers: { "Content-Type": "application/json", "Cache-Control": CABECERA_DE_CACHE },
      }),
    );
  } catch {
    /* sin caché, el próximo pedido va a la sala */
  }
}
