/**
 * Los enlaces de la cabecera a la herramienta (`/#sortear`, `/#mis-sorteos`) navegan a la dirección sin parámetros, y con eso
 * se perdían `?lang=` y `?theme=` al tocar Sortear. Si la página es la principal y la dirección trae solo esos dos, el toque
 * cambia nada más que el `#`, sin recargar: el idioma y el tema elegidos se quedan. Con cualquier otro parámetro (la demo,
 * por ejemplo) el enlace navega como siempre, porque ahí salir de la dirección es lo que se quiere.
 */

/** Los parámetros que solo cambian cómo se ve la página. */
const DE_VISTA = new Set(["lang", "theme"]);

/** Si la dirección trae parámetros y son todos de cómo se ve. */
export function soloParametrosDeVista(search: string): boolean {
  const claves = [...new URLSearchParams(search).keys()];
  return claves.length > 0 && claves.every((k) => DE_VISTA.has(k));
}

/** Se llama una vez, con la cabecera armada. */
export function conservarVistaEnLaCabecera(raiz: ParentNode = document): void {
  for (const a of raiz.querySelectorAll<HTMLAnchorElement>('header a[href^="/#"]')) {
    a.addEventListener("click", (e) => {
      // Una apertura en otra pestaña o ventana la maneja el navegador, como en cualquier enlace.
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      if (location.pathname !== "/" || !soloParametrosDeVista(location.search)) return;
      e.preventDefault();
      location.hash = a.hash;
    });
  }
}
