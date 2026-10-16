import { $ } from "../dom";
import { app, params } from "../state";
import { loadSample } from "./participants";

/**
 * La bienvenida de la primera vez que alguien entra con su cuenta: los tres
 * pasos del sorteo y un botón para probar con la lista de ejemplo.
 *
 * Se muestra una sola vez por equipo. Si el almacenamiento del navegador no
 * responde (ventana privada, datos bloqueados), aparece igual y se cierra
 * igual; solo puede volver a aparecer al recargar. Nunca en la demo ni con un
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
  $("ob-ok").addEventListener("click", cerrar);
  // Quien sella sin cerrarla ya entendió: no vuelve a aparecer.
  $("btn-freeze").addEventListener("click", cerrar);
  $("ob-sample").addEventListener("click", () => {
    cerrar();
    loadSample();
    $("btn-freeze").focus();
  });
}
