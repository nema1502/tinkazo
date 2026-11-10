import { $ } from "../dom";
import { getLang, textos } from "../idioma";
import { roundTime } from "../protocol/quicknet";
import type { Revision } from "../protocol/verificacion";
import { activoDePagos, cuentasQuePagan } from "../stellar/pagos";
import { crearLectorDePagos } from "../stellar/pagos-red";
import { hayCuentas, montarGanadores, type OpcionesDeGanadores } from "./panel-ganadores";
import { TEXTOS_PAGOS } from "./pagos-textos";

/**
 * El panel de ganadores en el comprobante (verificar.html), de solo lectura.
 *
 * Solo cuando el número del sorteo lo atestigua la cadena (el contrato guarda el sorteo): la nota del pago lo lleva, y el
 * que viene en un enlace sin testigo se podría cambiar. Cuentan los pagos de la cuenta que selló el sorteo y de las
 * cuentas de evento configuradas. Los 7 días se cuentan desde el ledger del sorteo; si no se leyó, desde que nació la
 * ronda, que es público.
 *
 * Esta página solo carga este archivo con la bandera prendida (`pagos-bandera.ts`), y sus textos se suman al diccionario
 * de la página recién acá: con la bandera apagada no cuestan nada.
 */

/** Lo que hace falta para montar el panel de este comprobante, o `null` si no corresponde mostrarlo. */
export function panelDelComprobante(r: Revision, premio: string): Omit<OpcionesDeGanadores, "lector"> | null {
  if (r.veredicto !== "verde" || r.fuente !== "estado" || r.ancla.tipo !== "oficial") return null;
  const sello = r.registro?.sello;
  if (!sello || r.ganadores.length === 0) return null;
  const entradas = r.ganadores.map((i) => r.nombres[i] ?? "");
  if (!hayCuentas(entradas)) return null;
  const red = r.ancla.contrato.red;
  const nacio = roundTime(r.ronda);
  return {
    red,
    raffleId: sello.id,
    premio,
    activo: activoDePagos(red),
    ganadores: r.ganadores.map((i, puesto) => ({ puesto, entrada: r.nombres[i] ?? "" })),
    sorteoEn: r.registro?.resultado?.drawnAt ?? nacio,
    desde: nacio - 600,
    pagadoras: new Set([sello.organizer, ...cuentasQuePagan()]),
    sinTitulo: true,
  };
}

/** Un solo lector para la página: lo que ya se leyó no se vuelve a pedir enseguida. */
const lector = crearLectorDePagos();

export function mostrarPagosDelComprobante(r: Revision, premio: string): void {
  const opciones = panelDelComprobante(r, premio);
  if (!opciones) return;
  // Los textos del panel entran al diccionario de esta página; el título, que ya está en el markup, se vuelve a escribir.
  for (const l of ["es", "en"] as const) Object.assign(textos(l), TEXTOS_PAGOS[l]);
  const titulo = document.querySelector<HTMLElement>("#sec-pagos [data-i]");
  if (titulo) titulo.textContent = TEXTOS_PAGOS[getLang()].pgTitulo ?? titulo.textContent;
  $("sec-pagos").style.display = "block";
  montarGanadores($("pagos-cuerpo"), { ...opciones, lector });
}
