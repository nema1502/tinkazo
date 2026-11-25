import { campanasActivo } from "../campana/bandera";
import { montoDelPremio } from "../stellar/pagos";

/**
 * El aviso del premio en plata (25 de noviembre de 2026).
 *
 * Quien sortea un premio en dólares digitales y lo escribe en el campo ("50 USD") no tenía cómo enterarse de que existe la
 * campaña de una empresa, que se lo paga a quien gana. Debajo del campo aparece un aviso corto con el enlace. Es solo una
 * pista: se puede cerrar, no vuelve en la sesión, nunca frena Sellar la lista ni suma un botón principal. Un falso positivo
 * ("Entrada $10") cuesta un toque en la cruz. Solo existe con las campañas abiertas y solo en el modo de sortear premios:
 * en el orden de turnos y en el amigo secreto el campo es el nombre del orden.
 *
 * Aparece al salir del campo, cuando la persona terminó de escribir, y no mientras escribe: así no empuja Sellar la lista
 * debajo de su dedo. Si el foco se va a un botón o a un enlace no aparece, porque la persona ya está tocando otra cosa.
 * Al cerrarlo el foco no vuelve a un campo de texto, que en un celular abriría el teclado. El enlace abre en otra pestaña
 * para no sacar a quien organiza de la lista que está armando.
 *
 * Reconoce el monto con `montoDelPremio`, el mismo que usa Pagar premio para proponer cuánto pagar.
 */

/** Dónde queda que se cerró el aviso: vive en la pestaña, como el borrador. */
const CLAVE_CERRADO = "tinkazo.aviso-plata-cerrado";

/** ¿Lo escrito parece un monto de dinero? */
export const parecePremioEnPlata = (texto: string): boolean => montoDelPremio(texto) !== null;

let montado = false;
let activo = false;
/** Si se cerró en esta página: vale aunque la pestaña no deje guardar nada. */
let cerrado = false;

const aviso = (): HTMLElement | null => document.getElementById("prize-plata");

/** El modo de la herramienta: solo el de sortear premios tiene premios. */
const enModoDeSorteo = (): boolean => (document.getElementById("modo-botones")?.dataset.modo ?? "sorteo") === "sorteo";

/** Lo que dicen el campo del premio y los de los demás lugares. */
function textosDelPremio(): string[] {
  const campos = [document.getElementById("prize"), ...document.querySelectorAll("#prize-lugares input")];
  return campos.flatMap((c) => (c instanceof HTMLInputElement ? [c.value] : []));
}

function seCerroAntes(): boolean {
  if (cerrado) return true;
  try {
    return typeof sessionStorage !== "undefined" && sessionStorage.getItem(CLAVE_CERRADO) === "1";
  } catch {
    return false;
  }
}

/** ¿Se ve el aviso ahora? Para las pruebas y para quien lo quiera saber. */
export const avisoDePlataVisible = (): boolean => aviso()?.hidden === false;

/** Pone o saca el aviso según lo escrito. Se llama al salir del campo o al cambiar el modo. */
export function actualizarAvisoDePlata(): void {
  const el = aviso();
  if (!el) return;
  const ver = montado && activo && enModoDeSorteo() && !seCerroAntes() && textosDelPremio().some(parecePremioEnPlata);
  if (el.hidden === !ver) return;
  el.hidden = !ver;
}

/** ¿El foco se va a algo que se toca (un botón o un enlace)? Entonces la persona ya no está escribiendo. */
function vaAUnBoton(destino: EventTarget | null): boolean {
  return destino instanceof HTMLElement && destino.matches("button, a[href], summary, [role='button']");
}

/** La persona salió de un campo del premio: recién ahora se mira lo escrito. */
function alSalirDelCampo(e: FocusEvent): void {
  if (vaAUnBoton(e.relatedTarget)) return;
  actualizarAvisoDePlata();
}

/** Cierra el aviso para el resto de la sesión. */
function cerrar(): void {
  cerrado = true;
  try {
    if (typeof sessionStorage !== "undefined") sessionStorage.setItem(CLAVE_CERRADO, "1");
  } catch {
    /* sin almacenamiento, el cierre vale mientras dura la página */
  }
  const el = aviso();
  if (el) el.hidden = true;
  // La cruz desaparece con el foco adentro: pasa al enlace discreto de al lado, que ahora se ve, y nunca a un campo de texto (en
  // un celular abriría el teclado) ni a Sellar la lista (un segundo Enter sellaría).
  document.querySelector<HTMLElement>(".premio-campana a")?.focus({ preventScroll: true });
}

/** Se llama una vez, con la herramienta armada. Con las campañas cerradas no engancha nada. */
export function montarAvisoDePlata(campanas: boolean = campanasActivo()): void {
  if (montado || !aviso()) return;
  montado = true;
  activo = campanas;
  if (!activo) return;
  // Al salir del campo y no al escribir: `focusout` sube desde cada campo de los demás lugares.
  document.getElementById("prize")?.addEventListener("focusout", alSalirDelCampo);
  document.getElementById("prize-lugares")?.addEventListener("focusout", alSalirDelCampo);
  // Cambiar de modo cambia lo que quiere decir el campo.
  document.getElementById("modo-botones")?.addEventListener("click", () => queueMicrotask(actualizarAvisoDePlata));
  document.getElementById("prize-plata-x")?.addEventListener("click", cerrar);
  actualizarAvisoDePlata();
}

/** Para las pruebas: vuelve al estado de recién cargada la página. */
export function reiniciarAvisoDePlata(): void {
  montado = false;
  activo = false;
  cerrado = false;
}
