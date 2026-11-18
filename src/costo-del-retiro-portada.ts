import { cobroEnElBuild } from "./alta-textos-con-cobro";
import { costoDelRetiro, montoEnPalabras } from "./stellar/retiro-config";
import { entornoDelBuild, ventaAbiertaATodos } from "./stellar/venta-piloto";

/**
 * Lo que dice la portada del costo del retiro.
 *
 * La respuesta de la pregunta ¿Cuánto cuesta? de la portada (`faq3a`) dice hoy que Tinkazo no cobra nada y que los precios se
 * publican pronto. Con el costo del retiro configurado (`stellar/retiro-config.ts`) eso deja de ser cierto, así que la
 * respuesta pasa a decir cuánto cuesta retirar. Este archivo tiene el texto y lo que lo exige, sin nada del navegador:
 * lo lee `i18n.ts` para ponerlo encima del diccionario y lo lee también `vite.config.ts`.
 *
 * - Sin costo configurado (sin cuenta, o en cero) no hay texto nuevo: la portada queda como estaba.
 * - Con la compra de sorteos a la vista, la portada ya dice otra cosa (`textosConCobro` en `alta-textos-con-cobro.ts`)
 *   y no se pisa: se queda con su texto. Esa combinación todavía no tiene su frase.
 * - La publicación de producción con el costo prendido no sale mientras el HTML de la portada (lo que se ve antes de que
 *   cargue el JavaScript y lo que leen los buscadores) diga otra cosa: se cambia en el mismo commit que lo prende.
 */

type Entorno = Record<string, unknown>;

/** La respuesta de la portada con el costo. `{c}` es el monto dicho de palabra (`50 centavos`). */
const FAQ_CON_RETIRO = {
  es: "Hoy organizar es gratis. Participar, comprobar y recibir un premio son gratis siempre. Retirar dinero de tu cuenta cuesta {c}.",
  en: "Organizing is free today. Taking part, checking and receiving a prize are always free. Withdrawing money from your account costs {c}.",
};

/** La respuesta de la portada con un costo de retiro de esos stroops, en los dos idiomas. */
export function textoDeLaPortadaConRetiro(stroops: bigint): { es: string; en: string } {
  return {
    es: FAQ_CON_RETIRO.es.replace("{c}", montoEnPalabras(stroops, "es")),
    en: FAQ_CON_RETIRO.en.replace("{c}", montoEnPalabras(stroops, "en")),
  };
}

/**
 * La respuesta de la portada que va encima del diccionario, o `null` si no va ninguna: sin costo configurado, o con la
 * compra de sorteos a la vista (que ya cambia ese texto por el suyo). Sin entorno, el de este sitio en esta pestaña.
 */
export function faqConElRetiro(env?: Entorno): { es: string; en: string } | null {
  const stroops = costoDelRetiro(env ?? entornoDelBuild());
  if (stroops === null || cobroEnElBuild(env)) return null;
  return textoDeLaPortadaConRetiro(stroops);
}

/** La respuesta `faq3a` del HTML de una página, o `null` si la página no la trae. */
function faqDelHtml(html: string): string | null {
  return /\bdata-i="faq3a">([^<]*)</.exec(html)?.[1] ?? null;
}

/**
 * Lo que frena la publicación de producción con el costo prendido: que el HTML de la portada todavía diga otra cosa que
 * el costo, o que la compra de sorteos abierta a todos pise esa respuesta. Recibe el entorno del build (`VITE_*` y
 * `VERCEL_ENV`) y las páginas de la raíz (nombre y HTML). Vacío: puede salir. Fuera de producción, o con el costo sin
 * cobrar (sin cuenta, o en cero), nunca frena: las vistas previas sirven para probarlo. Sin los valores de las variables.
 */
export function problemasDeLaPortadaConRetiro(env: Record<string, string | undefined>, paginas: Readonly<Record<string, string>>): string[] {
  if (env.VERCEL_ENV !== "production") return [];
  const stroops = costoDelRetiro(env);
  if (stroops === null) return [];
  if (cobroEnElBuild(env) && ventaAbiertaATodos(env)) {
    return [
      "La compra de sorteos abierta a todos cambia la respuesta de la portada sobre cuánto cuesta, y esa respuesta todavía no dice " +
        "el costo del retiro: las dos juntas no tienen su frase.",
    ];
  }
  const html = paginas["index.html"] ?? "";
  if (faqDelHtml(html) === textoDeLaPortadaConRetiro(stroops).es) return [];
  return [
    "index.html todavía dice lo de antes sobre cuánto cuesta: con el costo del retiro prendido, la respuesta data-i=\"faq3a\" tiene que traer " +
      "el texto de costo-del-retiro-portada.ts, en el mismo commit que lo prende.",
  ];
}
