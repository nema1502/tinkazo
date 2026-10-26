/**
 * Lo plegado de la lista («Premio y más opciones», `#mas-lista`): se abre solo si la persona ya eligió algo
 * ahí adentro, para que lo que eligió no quede escondido (un premio escrito, más de un ganador). Lo que se
 * eligió se lee igual arriba del botón de sellar.
 */
export function initPlegables(): void {
  const mas = document.getElementById("mas-lista") as HTMLDetailsElement | null;
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
