import { $ } from "../dom";
import { app, params } from "../state";

/**
 * La bienvenida de la primera vez que alguien entra con su cuenta: los tres
 * pasos del sorteo, y una demo para mirar antes de sortear de verdad.
 *
 * La demo es un enlace a `?demo=`, que nunca graba nada aunque haya cuenta.
 * Hasta el 16 de octubre de 2026 el botón cargaba la lista de ejemplo, y con
 * cuenta sellarla era un sello real en Stellar: comisión pagada y un sorteo
 * de prueba en Mis sorteos.
 *
 * Se muestra una sola vez por equipo, y nunca a quien ya tiene sorteos (se
 * entera por `tinkazo:con-sorteos`, que manda el historial). Si el
 * almacenamiento del navegador no responde (ventana privada, datos
 * bloqueados), aparece igual y se cierra igual. Nunca en la demo ni con un
 * sorteo en curso.
 */
const CLAVE = "tinkazo.bienvenida.v1";

function vista(): boolean {
  try {
    return localStorage.getItem(CLAVE) === "1";
  } catch {
    return false;
  }
}

function marcar(): void {
  try {
    localStorage.setItem(CLAVE, "1");
  } catch {
    // Sin almacenamiento se cierra igual.
  }
}

/** Se llama antes de `initWalletUI`, que avisa la sesión con `tinkazo:sesion`. */
export function initOnboarding(): void {
  const box = $("onboard");
  const cerrar = (): void => {
    marcar();
    box.style.display = "none";
  };
  document.addEventListener("tinkazo:sesion", (e) => {
    const cuenta = (e as CustomEvent<string | null>).detail;
    box.style.display = cuenta && !vista() && !params.has("demo") && !app.frozen ? "block" : "none";
  });
  // Quien ya sorteó con esta cuenta, aunque sea en otro equipo, no la necesita.
  document.addEventListener("tinkazo:con-sorteos", cerrar);
  $("ob-ok").addEventListener("click", () => {
    cerrar();
    $<HTMLTextAreaElement>("ta").focus({ preventScroll: true });
  });
  // Quien sella sin cerrarla ya entendió: no vuelve a aparecer. La demo
  // aprieta "Sellar" sola, y eso no cuenta: "Ver una demo primero" borraba la
  // bienvenida para siempre (revisión del 16 de octubre de 2026).
  $("btn-freeze").addEventListener("click", () => {
    if (!params.has("demo") && $("btn-freeze").getAttribute("aria-disabled") !== "true") cerrar();
  });
}
