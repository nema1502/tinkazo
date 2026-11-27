/**
 * Lo que Ganaste suma en una campaña de personas con el premio en dólares. Quien gana le muestra su código a quien organiza y le
 * pasa la dirección donde recibe dólares digitales: acá va la línea que lo dice y, para quien no tiene dónde recibirlos, un
 * plegado con tres pasos y el enlace que abre la herramienta.
 *
 * Se baja con lo de Ganaste (`premio.ts`, que lo vuelve a exportar) mientras la persona espera el sorteo: la entrada de la página
 * no lo carga, y al llegar el resultado ya está. Sus textos van en un diccionario propio (`textos-ganaste-dolares.ts`).
 */

import type { DepsDelCelular } from "./celular";
import { TEXTOS_GANASTE_DOLARES } from "./textos-ganaste-dolares";

/**
 * A dónde lleva Abrir Tinkazo: la herramienta, en el modo de la red de esta campaña. Nunca la entrada de recibir un premio: esa
 * entrada espera un acceso que en una campaña de personas no llega.
 */
export const destinoDeAbrirTinkazo = (red: "mainnet" | "testnet"): string => (red === "mainnet" ? "/?red=oficial" : "/?red=prueba");

function parrafo(texto: string): HTMLParagraphElement {
  const p = document.createElement("p");
  p.className = "cmp-apoyo";
  p.textContent = texto;
  return p;
}

/**
 * Completa el bloque de Ganaste que ya está pintado. Solo en una campaña de personas sin premio en mano: en las demás no hace
 * nada. Un bloque ya completado tampoco se toca. La línea va justo después de la del código (o de la última línea de apoyo, si el
 * código todavía no llegó) y el plegado justo debajo: el enlace para ver cómo se eligió queda donde estaba, al final del bloque.
 */
export function completarEnDolares(raiz: HTMLElement, deps: DepsDelCelular): void {
  if (!deps.persona || deps.campana.premioEnMano !== undefined) return;
  const bloque = raiz.querySelector<HTMLElement>(".cmp-gano .cmp-hero");
  if (!bloque || bloque.querySelector("[data-cmp-dolares]")) return;
  const tx = (clave: string): string => TEXTOS_GANASTE_DOLARES[deps.idioma()][clave] ?? "";
  const direccion = parrafo(tx("gdDireccion"));
  direccion.dataset.cmpDolares = "";
  const plegado = document.createElement("details");
  const resumen = document.createElement("summary");
  resumen.className = "cmp-suave";
  resumen.textContent = tx("gdSinDonde");
  const abrir = document.createElement("a");
  abrir.className = "cmp-suave";
  abrir.href = destinoDeAbrirTinkazo(deps.campana.red);
  // En otra pestaña: quien ganó no pierde la pantalla de su código.
  abrir.target = "_blank";
  abrir.rel = "noopener noreferrer";
  abrir.textContent = tx("gdAbrir");
  plegado.append(resumen, parrafo(tx("gdPaso1")), parrafo(tx("gdPaso2")), parrafo(tx("gdPaso3")), abrir);
  const apoyos = bloque.querySelectorAll<HTMLElement>(":scope > p.cmp-apoyo");
  const ancla = bloque.querySelector<HTMLElement>(":scope > .cmp-codigo-linea") ?? apoyos[apoyos.length - 1] ?? bloque.querySelector<HTMLElement>(":scope > .cmp-premio-resultado");
  if (ancla) ancla.after(direccion, plegado);
  else bloque.append(direccion, plegado);
}
