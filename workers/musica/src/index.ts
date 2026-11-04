/**
 * La música de los juegos, solo para el sitio. La lógica está en `logica.ts`
 * (se prueba sin Cloudflare); acá solo se elige de dónde salen los bytes. Ver README.md.
 *
 * Dos caminos, el mismo Worker:
 *  - `MUSICA`: un bucket de R2 (`wrangler.r2.toml`).
 *  - `ASSETS`: los archivos propios del Worker, carpeta `camas/` (`wrangler.toml`).
 */
import { type Fetcher, type Fuente, fuenteDeAssets, servir } from "./logica";

export interface Env {
  MUSICA?: Fuente;
  ASSETS?: Fetcher;
}

export default {
  fetch(req: Request, env: Env): Promise<Response> {
    const fuente = env.MUSICA ?? (env.ASSETS ? fuenteDeAssets(env.ASSETS) : null);
    if (!fuente) return Promise.resolve(new Response("La música no está configurada.\n", { status: 500, headers: { "Cache-Control": "no-store" } }));
    return servir(req, fuente);
  },
};
