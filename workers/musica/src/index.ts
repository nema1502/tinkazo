/**
 * La música de los juegos, solo para el sitio, y el kit para creadores, público. La lógica está en
 * `logica.ts` (la música) y `kit.ts` (el kit); se prueban sin Cloudflare. Acá solo se elige de dónde
 * salen los bytes. Ver README.md.
 *
 * Dos caminos, el mismo Worker:
 *  - `MUSICA` y `KIT`: buckets de R2 (`wrangler.r2.toml`).
 *  - `ASSETS`: los archivos propios del Worker, carpeta `camas/` (`wrangler.toml`); el kit va en `camas/kit/`.
 */
import { esDelKit, servirKit } from "./kit";
import { type Fetcher, type Fuente, fuenteDeAssets, servir } from "./logica";

export interface Env {
  MUSICA?: Fuente;
  KIT?: Fuente;
  ASSETS?: Fetcher;
}

export default {
  fetch(req: Request, env: Env): Promise<Response> {
    if (esDelKit(req.url)) {
      // Con R2, el kit tiene su propio bucket (sus claves son el nombre del archivo, sin carpeta); si no, es la carpeta camas/kit/.
      const kit = env.KIT ?? (env.ASSETS ? fuenteDeAssets(env.ASSETS) : null);
      if (!kit) return Promise.resolve(new Response("El kit no está configurado.\n", { status: 500, headers: { "Cache-Control": "no-store" } }));
      return servirKit(req, kit, env.KIT ? "" : "kit/");
    }
    const fuente = env.MUSICA ?? (env.ASSETS ? fuenteDeAssets(env.ASSETS) : null);
    if (!fuente) return Promise.resolve(new Response("La música no está configurada.\n", { status: 500, headers: { "Cache-Control": "no-store" } }));
    return servir(req, fuente);
  },
};
