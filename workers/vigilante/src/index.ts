/**
 * El vigilante de Tinkazo: un Worker de Cloudflare propio y aparte que mira el portero de mainnet cada diez minutos y
 * avisa por correo (y por Telegram si está prendido). Solo enchufa a Cloudflare lo que `vuelta.ts` y `publica.ts`
 * deciden: el KV, el binding del correo, el reloj y el `fetch` del Worker. Ver README.md.
 *
 *   scheduled   cada 10 minutos (Cron Trigger): una vuelta.
 *   GET /       la hora de la última vuelta y si salió bien, sin nada privado.
 *   POST /prueba  forzar un aviso de prueba (con la clave de prueba, un derivado de la clave de operar).
 */
import { servir } from "./publica";
import { registrador } from "./registro";
import { type Entorno, vuelta } from "./vuelta";

const registrar = registrador();

const dependencias = () => ({
  fetch: (...a: Parameters<typeof fetch>) => fetch(...a),
  ahora: () => Date.now(),
  registrar,
});

export type { Entorno };

export default {
  fetch(req: Request, env: Entorno): Promise<Response> {
    return servir(req, env, dependencias());
  },

  async scheduled(_controlador: { scheduledTime: number; cron: string }, env: Entorno, _ctx: { waitUntil(promesa: Promise<unknown>): void }): Promise<void> {
    try {
      await vuelta(env, dependencias());
    } catch (e) {
      // Una falla que la vuelta no esperaba: queda anotada y se deja subir para que Cloudflare la cuente como falla.
      registrar("error-interno", { donde: "vuelta", error: e instanceof Error ? e.name : "desconocido" });
      throw e;
    }
  },
};
