import { enEnsayo } from "../ensayo-modo";
import { app } from "../state";
import { debeAvisar } from "./cuenta-estado";
import { currentSession, entrar } from "./wallet-ui";

/**
 * El recordatorio suave de crear la cuenta, mientras se explora (26 de octubre de 2026).
 *
 * Quien prueba el ensayo no necesita una cuenta, pero para sortear de verdad sí. En el ensayo, antes de sellar, una
 * frase lo dice ("Para sortear con tu lista, entrá con Google: es gratis y tu cuenta se crea sola.") con un enlace que
 * abre la ventana de Google ahí mismo, sin salir del ensayo: ya hay un toque, que es lo que el navegador pide. Sin
 * ventana ni color de la casa, debajo de la línea que guía, **una sola vez por sesión** y nunca entre el sello y el
 * último resultado (`debeAvisar`, `cuenta-estado.ts`). Con una cuenta abierta, no.
 *
 * La demo (`?demo=`) sella sola a los 0,3 segundos: la frase no alcanzaría a leerse, y su invitación es el cierre
 * ("Así de fácil. ¿Lo hacemos con tu lista?", con "Entrar y sortear").
 */

/** Que ya se mostró en esta pestaña: vale aunque se recargue. */
export const CLAVE_AVISO = "tinkazo.aviso-cuenta";

/** Se le está mostrando ahora, en esta visita a la página. */
let esteAviso = false;

function yaSeAviso(): boolean {
  try {
    return sessionStorage.getItem(CLAVE_AVISO) === "1";
  } catch {
    return false;
  }
}

function recordarQueSeAviso(): void {
  try {
    sessionStorage.setItem(CLAVE_AVISO, "1");
  } catch {
    /* sin almacenamiento, vale hasta que se recargue la página */
  }
}

/** Mira si toca mostrar o esconder la frase. Barato: se llama cuando cambia el paso, la cuenta o hay una ventana. */
export function revisarAviso(): void {
  const el = document.getElementById("aviso-cuenta");
  if (!el) return;
  const muestra = debeAvisar({
    enEnsayoODemo: enEnsayo(),
    conSesion: currentSession() !== null,
    yaSeAviso: yaSeAviso(),
    esteAviso,
    sellada: app.frozen !== null,
    ventanaAbierta: document.querySelector(".modal-back") !== null,
  });
  if (muestra) {
    esteAviso = true;
    recordarQueSeAviso();
  } else if (app.frozen || currentSession()) {
    // Se sella o se entra: la frase cumplió, y no vuelve en esta pestaña.
    esteAviso = false;
  }
  el.hidden = !muestra;
}

/** Se llama una vez, con la herramienta y la cuenta ya armadas. */
export function initAvisoCuenta(): void {
  document.getElementById("aviso-cuenta-entrar")?.addEventListener("click", () => void entrar());
  for (const evento of ["tinkazo:paso", "tinkazo:cuenta", "tinkazo:sesion"]) document.addEventListener(evento, revisarAviso);
  // Las ventanas (ingreso, cuenta, tutorial) se agregan al cuerpo: con una abierta, la frase se va y vuelve al cerrarla.
  new MutationObserver(revisarAviso).observe(document.body, { childList: true });
  revisarAviso();
}
