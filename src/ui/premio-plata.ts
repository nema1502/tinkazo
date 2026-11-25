import { campanasActivo } from "../campana/bandera";
import { EVENTO_PRACTICA, sinGrabar } from "../ensayo-modo";
import { montoDelPremio } from "../stellar/pagos";
import { fijoPorCampana } from "./ganadores";

/**
 * El aviso del premio en plata (25 de noviembre de 2026).
 *
 * Quien sortea un premio en dólares digitales y lo escribe en el campo ("50 USD") no tenía cómo enterarse de que existe la
 * campaña de una empresa, que se lo paga a quien gana. Debajo del campo aparece un aviso corto con el enlace. Es solo una
 * pista: se puede cerrar, no vuelve en la sesión, nunca frena Sellar la lista ni suma un botón principal. Un falso positivo
 * ("Entrada $10") cuesta un toque en la cruz. Solo existe con las campañas abiertas y solo en el modo de sortear premios:
 * en el orden de turnos y en el amigo secreto el campo es el nombre del orden. Tampoco aparece en un sorteo que ya viene de una
 * campaña (quien la armó no necesita que se la ofrezcan) ni en la demostración, el ensayo y el modo stand, donde nada se graba ni se paga. Si
 * estaba a la vista cuando eso pasa, se esconde: entrar al ensayo o al modo stand lo avisa con un evento del documento.
 *
 * Aparece al salir del campo, cuando la persona terminó de escribir, y no mientras escribe: así no empuja Sellar la lista
 * debajo de su dedo. Si la ventana pierde el foco (cambio de pestaña o de aplicación) el navegador también avisa que el campo
 * se dejó, sin destino: eso no cuenta, y al volver se mira de nuevo. Si la persona toca un botón o un enlace no aparece, porque
 * ya está tocando otra cosa. Con el teclado (Tab hacia un botón o un enlace) sí aparece: nadie lo está tocando.
 * Al cerrarlo el foco no vuelve a un campo de texto, que en un celular abriría el teclado. El enlace abre en otra pestaña
 * para no sacar a quien organiza de la lista que está armando.
 *
 * Reconoce el monto con `montoDelPremio`, el mismo que usa Pagar premio para proponer cuánto pagar.
 */

/** Dónde queda que se cerró el aviso: vive en la pestaña, como el borrador. */
const CLAVE_CERRADO = "tinkazo.aviso-plata-cerrado";

/**
 * La moneda de otro país (R$, MX$, COP$, ARS$): el signo pegado a unas letras que no son US ni USD. El aviso habla de dólares
 * digitales y no es cierto para un premio en reales o en pesos, así que esas monedas no cuentan. Se les saca el signo antes de
 * mirar el monto, y un monto en dólares escrito aparte sigue valiendo.
 */
const MONEDA_AJENA = /\b(?!(?:us|usd)\$)[a-z]{1,4}\$/gi;

/** ¿Lo escrito parece un monto de dinero? */
export const parecePremioEnPlata = (texto: string): boolean => montoDelPremio(texto.replace(MONEDA_AJENA, " ")) !== null;

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
  const ver = montado && activo && enModoDeSorteo() && !fijoPorCampana() && !sinGrabar() && !seCerroAntes() && textosDelPremio().some(parecePremioEnPlata);
  if (el.hidden === !ver) return;
  el.hidden = !ver;
}

/**
 * Cuándo fue el último toque o clic sobre un botón o un enlace. Safari (en la Mac y en el iPhone) no da foco a un botón al
 * tocarlo: al salir del campo el destino llega vacío aunque la persona esté tocando Sellar la lista, y el aviso, al aparecer,
 * movería el botón entre que apoya el dedo y lo suelta. El toque llega antes que la salida del campo, y eso es lo que se mira.
 */
const VENTANA_DEL_TOQUE_MS = 1500;
let ultimoToqueABoton = -Infinity;

function alTocar(e: Event): void {
  if (e.target instanceof Element && e.target.closest("button, a[href], summary, [role='button']")) ultimoToqueABoton = performance.now();
}

const tocabaUnBoton = (): boolean => performance.now() - ultimoToqueABoton < VENTANA_DEL_TOQUE_MS;

/** ¿La ventana está a la vista y con el foco? Si no, el foco que se va del campo es el de la ventana y no el de la persona. */
const ventanaActiva = (): boolean => document.visibilityState !== "hidden" && document.hasFocus();

/**
 * La persona salió de un campo del premio: recién ahora se mira lo escrito. Si lo que recibe el foco es un botón o un enlace
 * y nadie lo tocó, es el teclado (Tab): ahí el aviso aparece, porque el foco no se mueve de donde está y no hay un dedo que
 * apoyar. Si lo tocó el mouse o el dedo, el toque ya quedó anotado y el aviso espera.
 */
function alSalirDelCampo(_e: FocusEvent): void {
  if (!ventanaActiva() || tocabaUnBoton()) return;
  actualizarAvisoDePlata();
}

/** ¿El foco está en un campo del premio? Entonces la persona está escribiendo y el aviso espera a que salga. */
const escribiendoElPremio = (): boolean => {
  const activo = document.activeElement;
  return activo instanceof HTMLElement && activo.closest("#prize, #prize-lugares") !== null;
};

/** Para lo que cambia los campos sin que la persona escriba (un chip, el borrador, el idioma): no toca el aviso mientras escribe. */
export function refrescarAvisoDePlata(): void {
  if (escribiendoElPremio()) return;
  actualizarAvisoDePlata();
}

/** La ventana recuperó el foco: se vuelve a mirar el campo, salvo que la persona siga escribiendo en él. */
function alRecuperarElFoco(): void {
  refrescarAvisoDePlata();
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
  document.addEventListener("pointerdown", alTocar, true);
  window.addEventListener("focus", alRecuperarElFoco);
  // Entrar al ensayo o al modo stand, o salir de ellos: el aviso que estaba a la vista se esconde sin esperar a otro evento.
  document.addEventListener(EVENTO_PRACTICA, refrescarAvisoDePlata);
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
  ultimoToqueABoton = -Infinity;
  document.removeEventListener("pointerdown", alTocar, true);
  window.removeEventListener("focus", alRecuperarElFoco);
  document.removeEventListener(EVENTO_PRACTICA, refrescarAvisoDePlata);
}
