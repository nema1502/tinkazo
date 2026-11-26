/**
 * Lo que la página de una campaña de personas hace antes de dejar entrar al guion de Google. El guion corre dentro de la página:
 * puede leer la dirección y todo lo que la dirección lleva (la campaña, la sala, el pase del QR y la clave de los nombres), y las
 * pantallas que dibuja piden cosas a Google con la política de referencia de la página. Dos medidas, las dos solo en este modo:
 *
 *  - la página pasa a no mandar de dónde viene (`no-referrer`) en todo lo que pida desde ese momento, no solo en la etiqueta del
 *    guion;
 *  - la dirección queda sin la campaña, la sala, el pase ni la clave. Lo que se saca se guarda en el historial de esta pestaña
 *    (`history.state`), que sobrevive a recargar y no es almacenamiento: recargar la página sigue abriendo la misma campaña, y
 *    copiar el enlace sigue copiando el entero. Los demás parámetros (el idioma, el tema) se quedan.
 *
 * La campaña de siempre no pasa por acá: sus direcciones y su política de referencia no cambian en nada.
 */

import { enlaceGuardadoEnElHistorial, MARCA_DEL_ENLACE } from "./enlace";

/** Los parámetros de la dirección que dicen qué campaña es y cómo se entra a ella. */
const DE_LA_CAMPANA = ["c", "q", "s", "p"] as const;

export interface EntornoDeLaPagina {
  documento: Document;
  historial: Pick<History, "replaceState" | "state">;
  ubicacion: Pick<Location, "origin" | "pathname" | "search" | "hash">;
}

const delNavegador = (): EntornoDeLaPagina => ({ documento: document, historial: history, ubicacion: location });

interface Guardado {
  search: string;
  hash: string;
}

/** Saca la campaña de la dirección y manda la página a no decir de dónde viene. Se puede llamar más de una vez. */
export function aislarDelGuion(e: EntornoDeLaPagina = delNavegador()): void {
  const { head } = e.documento;
  if (head && !head.querySelector('meta[name="referrer"][content="no-referrer"]')) {
    const meta = e.documento.createElement("meta");
    meta.name = "referrer";
    meta.content = "no-referrer";
    head.appendChild(meta);
  }
  const parametros = new URLSearchParams(e.ubicacion.search);
  if (!DE_LA_CAMPANA.some((k) => parametros.has(k)) && e.ubicacion.hash === "") return;
  const entero: Guardado = { search: e.ubicacion.search, hash: e.ubicacion.hash };
  for (const k of DE_LA_CAMPANA) parametros.delete(k);
  const resto = parametros.toString();
  try {
    e.historial.replaceState({ [MARCA_DEL_ENLACE]: entero }, "", e.ubicacion.pathname + (resto === "" ? "" : `?${resto}`));
  } catch {
    // Un navegador que no deja cambiar la dirección la deja como está: la página sigue andando.
  }
}

/** La dirección entera de la página, la que hay que copiar o compartir, aunque la de la barra esté limpia. */
export function enlaceCompleto(e: EntornoDeLaPagina = delNavegador()): string {
  const guardado = enlaceGuardadoEnElHistorial(e.historial.state);
  if (!guardado) return `${e.ubicacion.origin}${e.ubicacion.pathname}${e.ubicacion.search}${e.ubicacion.hash}`;
  const resto = new URLSearchParams(e.ubicacion.search);
  const entero = new URLSearchParams(guardado.search);
  // Lo que cambió en la barra desde entonces (el idioma, por ejemplo) vale más que lo guardado.
  for (const [k, v] of resto) entero.set(k, v);
  const consulta = entero.toString();
  return `${e.ubicacion.origin}${e.ubicacion.pathname}${consulta === "" ? "" : `?${consulta}`}${guardado.hash}`;
}
