/**
 * El tema forzado de las capturas (`?theme=light|dark`).
 *
 * Vive aparte, sin efectos al cargarse, para que lo usen las páginas de lectura (`pagina.ts`) y la herramienta
 * (`main.ts`, con la captura de la portada) sin arrastrar una a la otra.
 */

/**
 * Fija el tema y deja cada captura pidiendo la versión del tema.
 *
 * Con `?theme=light|dark` (igual que en la página principal: sirve para mirar
 * las dos versiones sin tocar el sistema) este código corre con el HTML ya
 * abierto, así que el navegador puede haber pedido ya la versión del tema del
 * sistema. Solo cambiar el `media` del `<source>` no siempre vuelve a pedir:
 * quedaban capturas sin cargar en juegos.html (sapo, trompo, chovena). Por eso
 * al hacer el tema no se negocia: el `<picture>` queda con una sola fuente, la
 * del tema, escrita en el `img`.
 */
export function fijarElTema(forzado: string | null): void {
  if (forzado !== "light" && forzado !== "dark") return;
  document.documentElement.dataset.theme = forzado;
  document.querySelectorAll<HTMLPictureElement>("picture").forEach((picture) => {
    const source = picture.querySelector<HTMLSourceElement>('source[media*="prefers-color-scheme"]');
    const img = picture.querySelector("img");
    if (!source || !img) return;
    // Las capturas por hoy solo traen versión clara: la clara vive en el
    // `<source>` y la oscura es el `img` de base.
    const pedida = forzado === "light" ? (source.srcset.split(",")[0]?.trim().split(/\s+/)[0] ?? "") : (img.getAttribute("src") ?? "");
    if (!pedida) return;
    source.remove();
    img.src = pedida;
  });
}
