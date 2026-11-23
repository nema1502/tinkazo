/**
 * El botón de entrar del final de las páginas de lectura (como-funciona.html) dice lo mismo que el de la portada: con la cuenta
 * de Google a mano, "Entrar con Google y sortear gratis" y la G; con una sesión guardada, "Ir a sortear"; si no, el texto
 * de siempre. La portada lo decide en `main.ts` con la billetera cargada: acá la página no carga ninguna, así que se decide
 * con lo que se sabe sin ella (la llave del proveedor, el navegador y la marca de la sesión guardada).
 */

export type ClaveDeLaCta = "ctaGo" | "ctaGoogle" | "ctaHero";

export function claveDeLaCta(e: { conSesion: boolean; conGoogle: boolean }): ClaveDeLaCta {
  if (e.conSesion) return "ctaGo";
  return e.conGoogle ? "ctaGoogle" : "ctaHero";
}

/** Pone el texto de la clave y la G (solo con Google) en cada botón marcado con `data-cta-pagina`. */
export function pintarLaCtaDeLaPagina(doc: Document, clave: ClaveDeLaCta, tx: (clave: string) => string): void {
  for (const enlace of doc.querySelectorAll<HTMLElement>("[data-cta-pagina]")) {
    const t = enlace.querySelector<HTMLElement>(".cta-t");
    if (!t) continue;
    t.dataset.i = clave;
    t.textContent = tx(clave);
    enlace.dataset.g = clave === "ctaGoogle" ? "1" : "0";
  }
}
