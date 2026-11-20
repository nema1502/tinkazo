/**
 * Copiar un texto al portapapeles, con el respaldo para los navegadores de una app (Instagram, Facebook y parecidos), que a
 * veces no tienen portapapeles. Lo usan el enlace con cupón (`cupon-enlace-entorno.ts`) y la ventana de entrar desde una
 * app (`wallet-ui.ts`): es el mismo copiado, en un solo lugar. Devuelve si se copió.
 */
export async function copiarTexto(texto: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch {
    // Sin portapapeles: se copia seleccionando un campo que no se ve.
    try {
      const campo = document.createElement("textarea");
      campo.value = texto;
      campo.setAttribute("readonly", "");
      campo.style.cssText = "position:fixed;top:0;left:0;opacity:0";
      document.body.appendChild(campo);
      campo.select();
      const ok = document.execCommand("copy");
      campo.remove();
      return ok;
    } catch {
      return false;
    }
  }
}
