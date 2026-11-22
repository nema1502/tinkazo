import { campanasActivo } from "../campana/bandera";
import type { Campana } from "../campana/modelo";
import type { DepsDePremio } from "./premio-recibir";

/**
 * La entrada del premio desde el celular de una campaña (`participar.html`): el gancho de «si ganó» que
 * dejó el registro (issue #172) abre la pantalla del ganador (`premio-recibir.ts`) con los datos de la
 * campaña (el contrato de premios, el número de su promoción y hasta cuándo se puede recibir) y la cuenta
 * de la sesión del proveedor, detrás de la bandera de campañas.
 *
 * Reingreso: quien se fue sin recibir entra con la misma cuenta desde cualquier equipo; el celular ya la
 * trae en la sesión, y con ella la ventana lee en la red Tus premios. Sin sesión, o con una campaña sin
 * premio, no abre nada.
 */

/** La entrada de la pantalla del ganador: la campaña y la cuenta de la sesión del proveedor (o `null` si no la hay). */
export interface DepsDelPremioDelCelular {
  campana: Campana;
  cuenta: string | null;
}

/** La entrada de la pantalla del ganador desde el celular: la sesión de la sala. */
export function abrirElPremioDeLaCampana(d: DepsDelPremioDelCelular, deps: Partial<DepsDePremio> = {}): boolean {
  if (!campanasActivo()) return false;
  if (!d.cuenta || !d.campana.contrato || !d.campana.promo) return false;
  const datos = { cuenta: d.cuenta, contrato: d.campana.contrato, promo: d.campana.promo, recibirHastaMs: d.campana.recibirHastaMs };
  // La pantalla va en diferido: cargarla es cargar el diálogo y `src/i18n.ts` entero, y la entrada del
  // celular no debe hacerlo al abrir (el guard de la casa lo marca en el import estático).
  void import("./premio-recibir").then((m) => m.abrirPremioDeLaCampana(datos, deps));
  return true;
}
