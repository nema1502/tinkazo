import { texto } from "../idioma";

/**
 * "Cómo se usa", primero en "Más", en todas las páginas: lleva a la herramienta
 * con el tutorial abierto (`/#como-se-usa`, main.ts). Se agrega acá y no en
 * cada HTML: así llega también a las páginas que no son de este cambio. El
 * texto sale de `navComoUsa`, que el build pone en los textos de cada página
 * porque esta cadena está en el código (vite.config.ts, `textosPorPagina`).
 */
function ponerComoSeUsa(mas: HTMLElement): void {
  const lista = mas.querySelector(".mas-lista");
  if (!lista || lista.querySelector('a[href="/#como-se-usa"]')) return;
  const a = document.createElement("a");
  a.href = "/#como-se-usa";
  a.dataset.i = "navComoUsa";
  a.textContent = texto("navComoUsa");
  lista.prepend(a);
}

/**
 * El menú de páginas en el celular: "Sortear" y "Mis sorteos" a la vista, y las
 * demás páginas detrás de "Más" (`.mas` en `styles.css`). En pantallas de más de
 * 760 px el botón no se muestra y la fila entera está a la vista: el código
 * solo abre y cierra la lista chica.
 *
 * Lo usan todas las páginas con cabecera. Si el menú no existe en la página,
 * no hace nada.
 */
export function initMenuMas(): void {
  const mas = document.querySelector<HTMLElement>(".topnav .mas");
  const boton = mas?.querySelector<HTMLButtonElement>(".mas-btn");
  if (!mas || !boton) return;
  ponerComoSeUsa(mas);

  const poner = (abierto: boolean): void => {
    mas.classList.toggle("abierto", abierto);
    boton.setAttribute("aria-expanded", String(abierto));
  };

  boton.addEventListener("click", () => poner(!mas.classList.contains("abierto")));
  // Un enlace de la misma página ("Cómo se usa", en la herramienta) no recarga: la lista se cierra igual.
  mas.querySelector(".mas-lista")?.addEventListener("click", (e) => {
    if ((e.target as Element | null)?.closest("a")) poner(false);
  });
  // Un toque fuera del menú lo cierra. Con Escape se cierra y el foco vuelve al botón.
  document.addEventListener("click", (e) => {
    if (mas.classList.contains("abierto") && !mas.contains(e.target as Node)) poner(false);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && mas.classList.contains("abierto")) {
      poner(false);
      boton.focus();
    }
  });
  // Si la pantalla pasa a escritorio, la fila entera va a la vista y la lista se cierra.
  matchMedia("(min-width: 761px)").addEventListener("change", (e) => {
    if (e.matches) poner(false);
  });
}
