import { $ } from "../dom";
import { app, params } from "../state";
import { enEnsayo } from "../ensayo-modo";

/**
 * La primera vez: una línea, "¿Primera vez? Mirá cómo se usa o probalo con un
 * ejemplo.", sin botones de color, arriba de la lista.
 *
 * Reemplaza a la bienvenida de tres pasos (hasta el 22 de octubre de 2026),
 * que salía solo con la cuenta abierta, se veía una vez y no volvía, y en
 * escritorio dejaba "Entendido" como la única acción principal de la pantalla,
 * que no era la acción (diseño del onboarding). Ahora el tutorial está siempre
 * a mano ("¿Cómo se usa?", tutorial.ts) y esto solo lo ofrece.
 *
 * Se ofrece una sola vez por equipo, solo con la lista vacía y sin un sorteo
 * sellado, nunca en la demo ni en el ensayo, y nunca a quien ya tiene sorteos
 * (se entera por `tinkazo:con-sorteos`, que manda el historial). Se va con la ✕
 * ("No mostrar más"), al cargar una lista, al abrir el tutorial o el ensayo y
 * al sellar. Se recuerda en el equipo; si el almacenamiento no responde
 * (ventana privada, datos bloqueados), aparece igual y se cierra igual.
 */
const CLAVE = "tinkazo.tutorial.v1";

let vistaEnMemoria = false;

/** Si la oferta ya se vio (y se cerró) en este equipo. */
export function ofertaVista(): boolean {
  if (vistaEnMemoria) return true;
  try {
    return localStorage.getItem(CLAVE) === "1";
  } catch {
    return false;
  }
}

/** No ofrecerla más en este equipo. */
export function marcarOfertaVista(): void {
  vistaEnMemoria = true;
  try {
    localStorage.setItem(CLAVE, "1");
  } catch {
    // Sin almacenamiento se cierra igual: dura lo que la página.
  }
  pintar();
}

/** Cuántos nombres hay en la lista: los que dibuja `renderNames`. */
const nombres = (): number => document.getElementById("names")?.childElementCount ?? 0;

function pintar(): void {
  const box = document.getElementById("primera-vez");
  if (!box) return;
  const ve = !ofertaVista() && !params.has("demo") && !enEnsayo() && !app.frozen && nombres() === 0;
  box.style.display = ve ? "" : "none";
}

/** Se llama una vez, con la herramienta armada. `abrirTutorial` abre "¿Cómo se usa?". */
export function initOnboarding(abrirTutorial: () => void): void {
  $("pv-cerrar").addEventListener("click", () => {
    marcarOfertaVista();
    // El foco no queda en el aire: va a lo que toca, "Pegar lista".
    document.getElementById("btn-pegar")?.focus({ preventScroll: true });
  });
  $("pv-como").addEventListener("click", () => {
    marcarOfertaVista();
    abrirTutorial();
  });
  // "probalo con un ejemplo" entra al ensayo (ensayo.ts, por `data-entrar-ensayo`); acá solo se cierra.
  $("pv-ensayo").addEventListener("click", marcarOfertaVista);
  // Quien ya sorteó con esta cuenta, aunque sea en otro equipo, no la necesita.
  document.addEventListener("tinkazo:con-sorteos", marcarOfertaVista);
  // Quien sella ya entendió.
  document.addEventListener("tinkazo:sellado", marcarOfertaVista);
  // Al cargar una lista se va; si la vacía antes de sellar, vuelve (no se cerró).
  new MutationObserver(pintar).observe($("names"), { childList: true });
  document.addEventListener("tinkazo:paso", pintar);
  pintar();
}
