/** Poner valores en un texto con huecos. Vive aparte de la previa para que la página de armar campañas no baje las pantallas. */

/**
 * Pone los valores en su lugar. Si un valor ya termina en punto, como el nombre abreviado Ana P.,
 * y la plantilla lo cierra con otro punto, queda uno solo.
 */
export function sustituir(texto: string, valores: Record<string, string>): string {
  return texto.replace(/\{(\w+)\}(\.?)/g, (_, clave: string, punto: string) => {
    const valor = valores[clave] ?? "";
    return punto && valor.endsWith(".") ? valor : `${valor}${punto}`;
  });
}
