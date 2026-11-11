/**
 * Los enlaces al contrato en el explorador, marcados con `data-contrato` en el HTML. El `href` escrito en la página es
 * el del contrato de la red de prueba: sirve sin JavaScript y para los buscadores. Al cargar, `pagina.ts` lo cambia por
 * el del modo de la pestaña, para que en el modo Oficial el enlace lleve al contrato de la red principal.
 *
 * Sin efectos al importarse: solo toca el documento cuando se la llama.
 */
export function enlazarContrato(raiz: ParentNode, url: string | null): number {
  if (!url) return 0;
  const enlaces = raiz.querySelectorAll<HTMLAnchorElement>("a[data-contrato]");
  enlaces.forEach((a) => {
    a.href = url;
  });
  return enlaces.length;
}
