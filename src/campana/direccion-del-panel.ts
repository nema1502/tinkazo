/**
 * La dirección del panel de quien organiza una campaña, en el modo oficial: a la que lleva crear-campana.html al activar y el
 * aviso del modo Prueba. Lleva también el idioma y el tema que la persona tenía puestos en la dirección de donde viene
 * (`?lang=` y `?theme=`): el panel los lee igual que el armado, y sin esto abría con el idioma de la memoria y el tema del
 * sistema. Lo que no es un idioma ni un tema que el sitio conozca no se pasa.
 */

/** La dirección base: `campana` sin valor, como la lee `campana-arranque.ts`. */
export const DIRECCION_DE_LA_CAMPANA = "/?campana&red=oficial";

/** `desde` es la consulta de la página de donde se sale (`location.search`, con o sin el signo de pregunta). */
export function direccionDelPanel(desde: string): string {
  const consulta = new URLSearchParams(desde);
  const sumar: string[] = [];
  const idioma = consulta.get("lang");
  if (idioma === "es" || idioma === "en") sumar.push(`lang=${idioma}`);
  const tema = consulta.get("theme");
  if (tema === "light" || tema === "dark") sumar.push(`theme=${tema}`);
  return sumar.length === 0 ? DIRECCION_DE_LA_CAMPANA : `${DIRECCION_DE_LA_CAMPANA}&${sumar.join("&")}`;
}
