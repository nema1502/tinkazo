/**
 * Lo que ve la persona cuando el modo Oficial frena la venta de un paquete para que el servicio no cueste de más: el
 * paquete pausado y su precio. En español y en inglés; `i18n.ts` los suma al diccionario.
 *
 * Sin palabras de la cadena: ni la red, ni la comisión, ni cifras. Nada promete un plazo que no siempre se cumple.
 */

export const TEXTOS_COSTOS: { es: Record<string, string>; en: Record<string, string> } = {
  es: {
    pagoPausado: "Este paquete no está a la venta por ahora. Vuelve solo cuando baje el costo. Lo que ya compraste sigue siendo tuyo, y los días caros no le cuentan.",
    precioPausado: "Por ahora no disponible",
  },
  en: {
    pagoPausado: "This pack isn't on sale right now. It comes back on its own when the cost goes down. What you already bought is still yours, and expensive days don't count against it.",
    precioPausado: "Not available right now",
  },
};
