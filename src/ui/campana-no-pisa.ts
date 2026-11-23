import { hayCampanaActiva } from "../campana/en-curso";
import { t } from "../i18n";

/**
 * El stand y el ejemplo arman su propia lista: vacían el cuadro o lo llenan con nombres de ejemplo. Con una campaña viva en
 * este navegador (inscripción abierta, lista cerrada, sellada o sorteada) ese cuadro es el de la campaña, y pisarlo la dejaría
 * sin lista antes de sellar. Entonces ninguno de los dos entra: se avisa en una línea y todo queda como estaba.
 *
 * Fuera de una campaña no hace nada, así que `?stand` y `?demo` siguen abriendo igual.
 */
export function campanaNoSePisa(): boolean {
  if (!hayCampanaActiva()) return false;
  const aviso = document.getElementById("stand-aviso");
  if (aviso) {
    aviso.textContent = t("campanaNoPisa");
    aviso.hidden = false;
  }
  // Desde la portada el aviso no se ve: se lleva a la herramienta, donde está el panel de la campaña.
  if (location.hash !== "#sortear") {
    history.replaceState(null, "", `${location.pathname}${location.search}#sortear`);
    dispatchEvent(new HashChangeEvent("hashchange"));
  }
  return true;
}
