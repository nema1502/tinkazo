import { cobroEnElBuild } from "./alta-textos-con-cobro";
import { dolaresEnTexto, porcentajeEnTexto } from "./campana/comision";
import { comisionDelBuild } from "./stellar/comision-config";
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

/**
 * La respuesta con lo que se cobra a una campaña de empresa además del costo del retiro. `{p}` es el porcentaje, `{m}` el mínimo
 * dicho de palabra (`1,50 dólares digitales`) y `{c}` el costo del retiro dicho de palabra.
 */
const FAQ_CON_RETIRO_Y_COMISION = {
  es:
    "Organizar es gratis. Si tu empresa sortea premios en dólares digitales, paga {p} de los premios. " +
    "Participar, comprobar y recibir un premio son gratis siempre. Retirar cuesta {c}.",
  en:
    "Organizing is free. If your company gives away prizes in digital dollars, it pays {p} of the prizes. " +
    "Taking part, checking and receiving a prize are always free. Withdrawing costs {c}.",
};

/** Lo que cobra Tinkazo a una campaña, tal como lo necesita la respuesta: el porcentaje en puntos básicos y el mínimo en stroops. */
export interface ComisionDeLaPortada {
  pb: bigint;
  minimo: bigint;
}

/**
 * La respuesta de la portada con un costo de retiro de esos stroops, en los dos idiomas. Con la comisión de las campañas
 * configurada, la respuesta dice también cuánto cobra Tinkazo a una empresa.
 */
export function textoDeLaPortadaConRetiro(stroops: bigint, comision: ComisionDeLaPortada | null = null): { es: string; en: string } {
  if (comision === null) {
    return {
      es: FAQ_CON_RETIRO.es.replace("{c}", montoEnPalabras(stroops, "es")),
      en: FAQ_CON_RETIRO.en.replace("{c}", montoEnPalabras(stroops, "en")),
    };
  }
  const dicho = (l: "es" | "en"): string => {
    const m = `${dolaresEnTexto(comision.minimo, l)} ${l === "es" ? "dólares digitales" : "digital dollars"}`;
    return FAQ_CON_RETIRO_Y_COMISION[l].replace("{p}", porcentajeEnTexto(comision.pb, l)).replace("{m}", m).replace("{c}", montoEnPalabras(stroops, l));
  };
  return { es: dicho("es"), en: dicho("en") };
}

/** La comisión de las campañas que dice el entorno, o `null` si no se cobra (las tres variables válidas, `comision-config.ts`). */
function comisionDelEntorno(env: Entorno): ComisionDeLaPortada | null {
  const c = comisionDelBuild(env);
  return c === null ? null : { pb: c.pb, minimo: c.minimo };
}

/**
 * La respuesta de la portada que va encima del diccionario, o `null` si no va ninguna: sin costo configurado, o con la
 * compra de sorteos a la vista (que ya cambia ese texto por el suyo). Sin entorno, el de este sitio en esta pestaña.
 */
export function faqConElRetiro(env?: Entorno): { es: string; en: string } | null {
  const stroops = costoDelRetiro(env ?? entornoDelBuild());
  if (stroops === null || cobroEnElBuild(env)) return null;
  return textoDeLaPortadaConRetiro(stroops, comisionDelEntorno(env ?? entornoDelBuild()));
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
  if (faqDelHtml(html) === textoDeLaPortadaConRetiro(stroops, comisionDelEntorno(env)).es) return [];
  return [
    "index.html todavía dice lo de antes sobre cuánto cuesta: con el costo del retiro prendido, la respuesta data-i=\"faq3a\" tiene que traer " +
      "el texto de costo-del-retiro-portada.ts, en el mismo commit que lo prende.",
  ];
}
