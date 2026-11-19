/**
 * Lo común a las respuestas del Worker: qué orígenes se aceptan, el JSON y las cabeceras de CORS. Sin Cloudflare,
 * para que las rutas se prueben en Node.
 */

const SITIO = "https://tinkazo.app";

export function origenPermitido(origen: string | null): boolean {
  if (!origen) return false;
  if (origen === SITIO || origen === "https://www.tinkazo.app") return true;
  if (/^https:\/\/tinkazo(-[a-z0-9-]+)?\.vercel\.app$/.test(origen)) return true;
  return /^http:\/\/localhost:\d{2,5}$/.test(origen);
}

export function json(cuerpo: unknown, estado: number, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(cuerpo), { status: estado, headers: { "Content-Type": "application/json; charset=utf-8", "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store", ...extra } });
}

/** `conAutorizacion`: las rutas con sesión (`/v1/alta/*`) reciben el token en `Authorization`. Las demás, como siempre. */
export function cors(origen: string | null, abierto: boolean, conAutorizacion = false): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": abierto ? "*" : origenPermitido(origen) && origen ? origen : "null",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": conAutorizacion ? "Content-Type, Authorization" : "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}
