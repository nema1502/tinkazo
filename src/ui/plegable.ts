import { t } from "../i18n";

/**
 * Lo plegado de la lista («Premio, cuántos ganan y subir CSV», `#mas-opciones`): se abre solo si la persona ya eligió algo
 * ahí adentro, para que lo que eligió no quede escondido (un premio escrito, más de un ganador). Lo que se
 * eligió se lee igual arriba del botón de sellar.
 *
 * Y lo plegado del resultado (`#mas-resultado`, ver `plegarElResultado`).
 */
export function initPlegables(): void {
  plegarElResultado();
  const mas = document.getElementById("mas-opciones") as HTMLDetailsElement | null;
  if (!mas) return;
  const prize = document.getElementById("prize") as HTMLInputElement | null;
  const nw = document.getElementById("nw") as HTMLSelectElement | null;
  const revisar = (): void => {
    if ((prize?.value.trim() ?? "") !== "" || (nw !== null && nw.value !== "1")) mas.open = true;
  };
  prize?.addEventListener("input", revisar);
  nw?.addEventListener("change", revisar);
  // Un premio que se pone por código (los chips, "Siguiente premio") no avisa con un evento: se mira al tocar.
  mas.parentElement?.addEventListener("click", () => setTimeout(revisar, 0));
  window.addEventListener("pageshow", revisar);
  revisar();
}

/**
 * El resultado, con una sola acción principal y lo demás detrás de un pliegue (barrido de letra, 26 de octubre de
 * 2026; se cerró en el cierre del barrido): después del ganador queda "Siguiente premio" (o "Compartir el
 * resultado" si no queda con quién sortear), "Mostrar en grande" y "Avisarle por WhatsApp". "Usar otra lista",
 * "Copiar el mensaje" y "Avisarle por correo" se usan poco y estaban todos a la vista: eran siete botones en una
 * pantalla donde se pide uno. Se pliegan en «Otra lista, copiar el mensaje y más», debajo de la acción principal.
 *
 * Los botones son los de siempre, con sus ids y sus manejadores: solo cambian de lugar, así que nada de lo que los
 * usa se entera. Se arma acá y no en `index.html` para no repetir el markup de tres controles que otro código ya
 * escribe (el href del correo, el texto de copiado) y que cada auditor busca por su id.
 */
function plegarElResultado(): void {
  const fila = document.getElementById("again-acciones");
  const otra = document.getElementById("btn-again-nueva");
  const copiar = document.getElementById("btn-copy");
  const correo = document.getElementById("btn-email");
  if (!fila || !otra || !copiar || !correo || document.getElementById("mas-resultado")) return;
  const det = document.createElement("details");
  det.className = "mas";
  det.id = "mas-resultado";
  const resumen = document.createElement("summary");
  resumen.dataset.i = "masResultado";
  resumen.textContent = t("masResultado");
  const botones = document.createElement("div");
  botones.className = "row";
  botones.append(otra, copiar, correo);
  det.append(resumen, botones);
  fila.after(det);
}
