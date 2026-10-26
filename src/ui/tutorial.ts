import { $ } from "../dom";
import { onLangChange, t } from "../i18n";
import { params } from "../state";
import { enEnsayo } from "../ensayo-modo";
import { contar } from "../contar";
import { pasoActual } from "./siguiente";
import { marcarOfertaVista } from "./onboarding";

/**
 * "¿Cómo se usa?": el tutorial siempre a mano.
 *
 * Nicolás, 22 de octubre de 2026: "que haya tutorial siempre para volver a
 * revisar; claro, bonito, pocos pasos y directo a la acción". Hasta ese día la
 * bienvenida se veía una vez y no volvía.
 *
 * - **Dónde:** un botón secundario en la fila del título de la herramienta, en
 *   todos los pasos, y "Cómo se usa" en el menú "Más" de todas las páginas
 *   (`/#como-se-usa`, menu.ts). Nunca flotando ni en la barra de abajo: esa zona
 *   es de la acción principal. Nunca en la demo, el ensayo, la espera en
 *   grande, el estadio ni el resultado en grande: esas son de la sala.
 * - **Qué es:** un panel en el lugar, debajo del título, que empuja la página y
 *   no tapa nada. No es una ventana: no atrapa el foco ni esconde la barra de lo
 *   que sigue. Al abrirlo el foco va a su título; al cerrarlo vuelve al botón.
 *   Escape lo cierra.
 * - **Cuatro tarjetas**, los cuatro pasos del indicador, con el dibujo del botón
 *   de verdad. En escritorio, una al lado de la otra; en 760 px o menos, de a
 *   una, con "Anterior" y "Siguiente". Abre en la tarjeta del paso en que está
 *   la persona, marcada "Estás acá".
 * - **Sin ningún botón de color adentro:** la única acción principal de la
 *   pantalla sigue siendo la del paso.
 * - **El mapa:** mientras está abierto, los controles de verdad llevan su número
 *   (1 en "Pegar lista", 2 en "Sellar la lista", 3 en "Lanzar el sorteo", 4 en
 *   "Compartir el resultado" y "Siguiente premio"). Hasta el primer sello del
 *   equipo, los números se ven siempre.
 * - **Nunca se abre solo.**
 */

/** Si en este equipo ya se selló un sorteo de verdad: desde ahí, los números solo con el tutorial abierto. */
const SELLADO = "tinkazo.sellado.v1";
let selladoEnMemoria = false;

function yaSello(): boolean {
  if (selladoEnMemoria) return true;
  try {
    return localStorage.getItem(SELLADO) === "1";
  } catch {
    return false;
  }
}

function marcarSellado(): void {
  selladoEnMemoria = true;
  try {
    localStorage.setItem(SELLADO, "1");
  } catch {
    /* sin almacenamiento, dura lo que la página */
  }
  pintarMapa();
}

/** Las tarjetas van de a una en un celular (760 px o menos). */
const deAUna = (): boolean => typeof matchMedia === "function" && matchMedia("(max-width: 760px)").matches;

let abierto = false;
/** La tarjeta que se ve cuando van de a una (1 a 4). */
let viendo = 1;

const panel = (): HTMLElement => $("como-panel");
const boton = (): HTMLElement => $("btn-como");

/** Los números en los controles de verdad: con el tutorial abierto, y siempre hasta el primer sello. */
function pintarMapa(): void {
  const on = !params.has("demo") && (abierto || !yaSello());
  if (on) document.body.dataset.mapa = "1";
  else delete document.body.dataset.mapa;
}

/** Qué tarjeta se ve (de a una), y la línea "2 de 4". */
function pintarTarjetas(): void {
  const una = deAUna();
  for (const li of panel().querySelectorAll<HTMLElement>(".como-tarjeta")) {
    const n = Number(li.dataset.paso);
    li.classList.toggle("ver", !una || n === viendo);
  }
  $("como-de").textContent = t("comoDe").replace("{i}", String(viendo));
  $<HTMLButtonElement>("como-ant").disabled = viendo <= 1;
  $<HTMLButtonElement>("como-sig").disabled = viendo >= 4;
}

/** "Estás acá" en la tarjeta del paso en que está la persona. */
function marcarAca(paso: number): void {
  for (const li of panel().querySelectorAll<HTMLElement>(".como-tarjeta")) {
    const aca = Number(li.dataset.paso) === paso;
    li.classList.toggle("aca", aca);
    if (aca) li.setAttribute("aria-current", "step");
    else li.removeAttribute("aria-current");
  }
}

/**
 * Abre el tutorial, en la tarjeta del paso en que se está. `desde` es de dónde
 * se abrió, para el contador del embudo (src/contar.ts, `tutorial_open`): la
 * oferta de primera vez, el botón, el menú o el final del ensayo o de la demo.
 */
export function abrirTutorial(desde: "offer" | "button" | "menu" | "end" = "button"): void {
  if (params.has("demo") || enEnsayo()) return;
  const paso = pasoActual();
  marcarAca(paso);
  viendo = paso;
  abierto = true;
  panel().hidden = false;
  boton().setAttribute("aria-expanded", "true");
  pintarTarjetas();
  pintarMapa();
  marcarOfertaVista();
  const titulo = $("como-titulo");
  titulo.focus({ preventScroll: true });
  panel().scrollIntoView({ block: "nearest" });
  contar("tutorial_open", { step: String(paso) as "1" | "2" | "3" | "4", from: desde });
}

/** Lo cierra, y el foco vuelve al botón (si se ve: con el panel abierto desde el menú, también). */
export function cerrarTutorial(): void {
  if (!abierto) return;
  const conFoco = panel().contains(document.activeElement);
  abierto = false;
  panel().hidden = true;
  boton().setAttribute("aria-expanded", "false");
  pintarMapa();
  if (conFoco) boton().focus({ preventScroll: true });
}

/** Se llama una vez, con la herramienta y los pasos ya armados. */
export function initTutorial(): void {
  boton().addEventListener("click", () => (abierto ? cerrarTutorial() : abrirTutorial("button")));
  for (const id of ["como-x", "como-cerrar"]) $(id).addEventListener("click", cerrarTutorial);
  // "Probar con un ejemplo" entra al ensayo (ensayo.ts, por `data-entrar-ensayo`); el tutorial se cierra.
  $("como-ensayo").addEventListener("click", () => {
    abierto = false;
    panel().hidden = true;
    boton().setAttribute("aria-expanded", "false");
  });
  $("como-ant").addEventListener("click", () => {
    viendo = Math.max(1, viendo - 1);
    pintarTarjetas();
  });
  $("como-sig").addEventListener("click", () => {
    viendo = Math.min(4, viendo + 1);
    pintarTarjetas();
  });
  panel().addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      cerrarTutorial();
      return;
    }
    // Con las tarjetas de a una, las flechas pasan de tarjeta (no dentro de un campo: no hay ninguno).
    if (!deAUna() || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
    viendo = Math.min(4, Math.max(1, viendo + (e.key === "ArrowRight" ? 1 : -1)));
    pintarTarjetas();
  });
  // Escape con el foco en el botón también lo cierra.
  boton().addEventListener("keydown", (e) => {
    if (e.key === "Escape" && abierto) cerrarTutorial();
  });
  matchMedia("(max-width: 760px)").addEventListener("change", () => abierto && pintarTarjetas());
  onLangChange(() => abierto && pintarTarjetas());
  // Al pasar de paso con el tutorial abierto, "Estás acá" sigue a la persona.
  document.addEventListener("tinkazo:paso", (e) => {
    if (abierto) marcarAca((e as CustomEvent<{ paso: number }>).detail.paso);
  });
  // El primer sello de este equipo (o una cuenta que ya tiene sorteos): los números dejan de verse siempre.
  document.addEventListener("tinkazo:sellado", marcarSellado);
  document.addEventListener("tinkazo:con-sorteos", marcarSellado);
  // El ensayo entra sin recargar: el tutorial se cierra (no va en el ensayo).
  new MutationObserver(() => {
    if (document.body.dataset.ensayo === "1" && abierto) {
      abierto = false;
      panel().hidden = true;
      boton().setAttribute("aria-expanded", "false");
    }
  }).observe(document.body, { attributes: true, attributeFilter: ["data-ensayo"] });
  pintarMapa();
}
