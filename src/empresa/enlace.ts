/**
 * El enlace privado de la empresa: la página nueva con la campaña en la
 * dirección y la clave en el fragmento, como el resto de los enlaces del
 * sitio. La clave nunca sale de la dirección hacia la red: nadie la manda a un
 * servidor.
 */

const ES_EVENTO = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/u;
const ES_CLAVE = /^[A-Za-z0-9_-]{22}$/u;

/** La campaña y la clave que vienen en el enlace. Sin clave: la vista de solo mirar. */
export interface EnlaceDeEmpresa {
  evento: string;
  clave: string | null;
}

/** El enlace privado para volver al panel de esta campaña: su id y su clave, la clave después del #. */
export function enlaceDeLaEmpresa(evento: string, clave: string, origen: string): string {
  if (!ES_EVENTO.test(evento) || !ES_CLAVE.test(clave)) throw new Error("enlace: datos inválidos");
  return `${origen.replace(/\/$/, "")}/empresa.html?c=${evento}#${clave}`;
}

/** Lo que dice un enlace: la campaña, y la clave si la trae. Una parte con otra forma anula la clave, no el resto. */
export function leerEnlaceDeLaEmpresa(search: string, hash: string): EnlaceDeEmpresa | null {
  const parametros = new URLSearchParams(search);
  const evento = parametros.get("c") ?? "";
  if (!ES_EVENTO.test(evento)) return null;
  const clave = hash.replace(/^#/, "");
  if (!clave) return { evento, clave: null };
  if (!ES_CLAVE.test(clave)) return null;
  return { evento, clave };
}
