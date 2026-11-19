import { t } from "../i18n";
import { sinCuentaElegido } from "./sin-cuenta";

/**
 * Se anuncia una sola vez, al elegir (`anunciarFranja`), por la región viva de la cuenta. La franja misma no es una región
 * viva: se vuelve a pintar con cada cambio de la cuenta o del idioma, y un lector de pantalla la leería de nuevo cada vez.
 *
 * La línea permanente de quien siguió sin cuenta (plan B del ingreso, `ingreso-plan-b.ts`): dice que está sin cuenta y
 * que lo que sortee no queda a su nombre, y deja un botón para entrar con su cuenta cuando quiera. Va debajo de la
 * cabecera, como la franja del cupón, y se ve en todos los pasos mientras la elección siga. Una sola, aunque se pinte
 * muchas veces.
 */

export const ID_FRANJA = "sin-cuenta-franja";

/** Lo que oye quien usa un lector de pantalla al elegir seguir sin cuenta: una vez, en la región viva de la cuenta. */
export function anunciarFranja(): void {
  const vivo = document.getElementById("cuenta-aviso");
  if (vivo) vivo.textContent = t("sinCuentaLinea");
}

export function pintarFranja(entrar: () => void): void {
  let franja = document.getElementById(ID_FRANJA);
  if (!sinCuentaElegido()) {
    franja?.remove();
    return;
  }
  if (!franja) {
    franja = document.createElement("aside");
    franja.id = ID_FRANJA;
    franja.className = "sin-cuenta-franja";
    const cabecera = document.querySelector("header");
    if (cabecera) cabecera.after(franja);
    else document.body.prepend(franja);
  }
  // Con lo mismo escrito no se toca nada. Al cambiar de idioma se vuelve a armar: si el botón tenía el foco, el nuevo lo recibe.
  const hecha = franja.querySelector(".sin-cuenta-franja-t")?.textContent === t("sinCuentaLinea") && franja.querySelector(".sin-cuenta-franja-b")?.textContent === t("sinCuentaEntrar");
  if (hecha) return;
  const teniaElFoco = franja.contains(document.activeElement);
  const texto = document.createElement("p");
  texto.className = "sin-cuenta-franja-t";
  texto.textContent = t("sinCuentaLinea");
  const boton = document.createElement("button");
  boton.type = "button";
  boton.className = "sin-cuenta-franja-b";
  boton.textContent = t("sinCuentaEntrar");
  boton.addEventListener("click", entrar);
  franja.replaceChildren(texto, boton);
  if (teniaElFoco) boton.focus({ preventScroll: true });
}
