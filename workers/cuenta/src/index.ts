/**
 * El Worker de la cuenta de Tinkazo: monedas, tiendita y plan del equipo. Solo enchufa a Cloudflare lo que
 * `servidor.ts` decide: el libro es un KV (`CUENTAS`), el reloj y la red son los del Worker. Ver README.md.
 */
import { PorIp } from "./por-ip";
import { type Entorno, servir } from "./servidor";

// En memoria, por nodo: ver `por-ip.ts`.
const dependencias = {
  fetch: (...a: Parameters<typeof fetch>) => fetch(...a),
  ahora: () => Date.now(),
  leer: new PorIp(),
  escribir: new PorIp(),
  canjes: new PorIp(),
  planes: new PorIp(),
};

export type { Entorno };

export default {
  fetch(req: Request, env: Entorno): Promise<Response> {
    return servir(req, env, dependencias);
  },
};
