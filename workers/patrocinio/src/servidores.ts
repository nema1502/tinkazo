/**
 * Los servidores de afuera a los que el portero de mainnet les habla con una llave: Pollar
 * (con la llave secreta de la app) y Horizon (para leer los pagos). Van fijos en el código y
 * no en una variable: el repositorio es público y una variable cambiada mandaría la llave a
 * otro lado. Solo se aceptan rutas limpias sobre el servidor fijo, y una redirección no se
 * sigue: falla (un `fetch` que sigue la redirección a otro origen conserva las cabeceras propias,
 * como `x-pollar-api-key`).
 *
 * El `fetch` entra como argumento: las pruebas nunca tocan la red.
 */

/** La API de servidor de Pollar. */
export const POLLAR_SERVIDOR = "https://server.api.pollar.xyz";
/** Horizon de la red principal, para leer los pagos que llegan a la cuenta de cobros. */
export const HORIZON_MAINNET = "https://horizon.stellar.org";

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

/** Un pedido que habría salido hacia otro servidor, o una redirección: no se mandó o no se siguió. */
export class ServidorAjeno extends Error {
  constructor(detalle: "ruta" | "redireccion") {
    super(`servidor-ajeno:${detalle}`);
    this.name = "ServidorAjeno";
  }
}

/** Una ruta absoluta del servidor, sin otro servidor adentro: `/v3/tokens/verify`, `/accounts/G…/payments?order=asc`. */
const RUTA_LIMPIA = /^\/(?![/\\])[A-Za-z0-9\-._~/?=&%:+,]*$/;

/** Un `fetch` que solo llega a `base`. Lo que no es una ruta limpia de ese servidor se rechaza sin llamar a nadie. */
export function haciaServidorFijo(base: string, f: Fetch): (ruta: string, init?: RequestInit) => Promise<Response> {
  const origen = new URL(base).origin;
  return async (ruta, init) => {
    if (typeof ruta !== "string" || !RUTA_LIMPIA.test(ruta)) throw new ServidorAjeno("ruta");
    const url = new URL(ruta, origen);
    if (url.origin !== origen) throw new ServidorAjeno("ruta");
    const res = await f(url.href, { ...init, redirect: "manual" });
    if ((res.status >= 300 && res.status < 400) || res.type === "opaqueredirect") throw new ServidorAjeno("redireccion");
    return res;
  };
}

export const haciaPollar = (f: Fetch) => haciaServidorFijo(POLLAR_SERVIDOR, f);
export const haciaHorizon = (f: Fetch) => haciaServidorFijo(HORIZON_MAINNET, f);
