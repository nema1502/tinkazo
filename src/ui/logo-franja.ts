import { texto as t } from "../idioma";
import { huellaLogo, logoALienzo, type Logo } from "../logo";
import { crearPieza } from "./logo-pieza";

/**
 * La franja del logo en la página de comprobar (`verificar.html`) y en la del
 * evento: una pieza con el logo y "Hecho con Tinkazo", y debajo lo que hay que
 * saber, que lo agregó quien armó el enlace, que Tinkazo no lo revisó y que no es
 * parte de lo que se comprueba.
 *
 * Va **debajo** del veredicto, nunca dentro y nunca encima del título. Sale
 * solo con el veredicto listo, en verde o en amarillo: en rojo, o mientras se
 * revisa, no sale. Un logo no viste a un comprobante que falló, y el logo nunca
 * cambia el veredicto: esta página ni lo mira para decidir nada.
 *
 * Lo que dice es lo que se puede afirmar: cualquiera puede tomar el comprobante
 * público de un sorteo real y armar un enlace corto nuevo con otro logo. Lo que
 * cierra eso del todo es un perfil atado a la cuenta (docs/amenazas.md).
 */
export function pintarFranja(logo: Logo | null, estado: "ok" | "partial" | "bad" | "working"): void {
  const caja = document.getElementById("logo-franja");
  if (!caja) return;
  const mostrar = !!logo && (estado === "ok" || estado === "partial");
  const huella = mostrar && logo ? huellaLogo(logo) : "";
  if ((caja.dataset.huella ?? "") === huella) {
    caja.hidden = !mostrar || caja.dataset.roto === "1";
    return;
  }
  caja.dataset.huella = huella;
  delete caja.dataset.roto;
  caja.replaceChildren();
  caja.hidden = !mostrar;
  if (!mostrar || !logo) return;
  const nota = document.createElement("p");
  nota.className = "note";
  nota.dataset.i = "logoComprobar";
  nota.textContent = t("logoComprobar");
  caja.append(crearPieza(logo), nota);
  // Un logo que no se puede abrir no deja una franja con solo el texto: se esconde.
  void logoALienzo(logo).then((c) => {
    if (!c && caja.dataset.huella === huella) {
      caja.dataset.roto = "1";
      caja.hidden = true;
    }
  });
}
