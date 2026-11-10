import { SERVICIO } from "../sala/cliente";

/**
 * El enlace del QR de los equipos: la página de registro del sitio, con la sala y la clave.
 *
 *   https://tinkazo.app/equipos.html?sala=<id>#<clave>
 *
 * La clave que cifra los datos del equipo va después del `#`: ningún navegador la manda a un servidor. La sala vive
 * en `s.tinkazo.app` (`workers/sala`); en local, para probar con `wrangler dev`, el enlace lleva además `servicio=`
 * y la página solo lo acepta desde `localhost`.
 */

const ES_ID = /^[0-9A-Za-z]{8}$/;
const ES_CLAVE = /^[A-Za-z0-9_-]{22}$/;
const ES_LOCAL = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

export interface SalaDeRegistro {
  id: string;
  clave: string;
  servicio: string;
}

export function enlaceDeRegistro(s: SalaDeRegistro, origen: string): string {
  const q = new URLSearchParams({ sala: s.id });
  if (s.servicio !== SERVICIO) q.set("servicio", s.servicio);
  return `${origen.replace(/\/$/, "")}/equipos.html?${q.toString()}#${s.clave}`;
}

/** La sala que dice un enlace, o `null` si le falta algo o no tiene la forma. */
export function leerEnlaceDeRegistro(search: string, hash: string, hostname: string): SalaDeRegistro | null {
  const q = new URLSearchParams(search);
  const id = q.get("sala") ?? "";
  const clave = hash.replace(/^#/, "");
  if (!ES_ID.test(id) || !ES_CLAVE.test(clave)) return null;
  const otro = q.get("servicio");
  const local = hostname === "localhost" || hostname === "127.0.0.1";
  return { id, clave, servicio: otro && local && ES_LOCAL.test(otro) ? otro : SERVICIO };
}
