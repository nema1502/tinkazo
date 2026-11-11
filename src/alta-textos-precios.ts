/**
 * La frase de `precios.html` para cuando el modo Oficial se abre con cupones (sección 8 del diseño del cobro por uso).
 * Reemplaza solo a `prNote` y solo en un build con `VITE_ALTA=1` (`i18n.ts` la pone encima del diccionario): con la
 * bandera apagada, que es la de hoy, la página dice lo que decía, porque todavía no hay cupones que ofrecer.
 *
 * Igual que `i18n-modo-oficial.ts`, el texto del HTML (lo que se ve antes de que cargue el JavaScript y lo que leen los
 * buscadores) pasa a ser este en el mismo commit en que se prende la bandera en producción: `revision-textos.test.ts` y
 * `seo.test.ts` miran el HTML contra el diccionario sin la bandera, y por eso esos dos textos hoy no cambian.
 *
 * El texto entero de la página, con los precios y la cláusula de costo, va con el pago (paso W11 del diseño).
 */

/** El build pide el acceso por cupón o por pago. */
export const ALTA_EN_EL_BUILD: boolean = import.meta.env.VITE_ALTA === "1";

export const TEXTOS_PRECIOS_CON_CUPON: { es: Record<string, string>; en: Record<string, string> } = {
  es: {
    prNote: "Con un cupón de tu evento, el modo Oficial es gratis. Participar en un sorteo y comprobarlo es gratis, siempre.",
  },
  en: {
    prNote: "With a coupon from your event, Live mode is free. Joining a draw and checking it is always free.",
  },
};
