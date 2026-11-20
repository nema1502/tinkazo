import { esDireccionG } from "./direccion-g";

/**
 * La configuración del costo del retiro: cuánto cuesta retirar dólares digitales desde una cuenta de Google de
 * Tinkazo y a qué cuenta va ese costo. Son dos variables del build y van juntas:
 *
 * - `VITE_RETIRO_COSTO`: el monto fijo de cada retiro, en dólares digitales, escrito con punto y hasta 7 decimales
 *   (por ejemplo `0.50`). Sin porcentaje: es el mismo sea cual sea lo que se retire. Con tope de 5 dólares, porque
 *   arriba de eso es un error de escritura.
 * - `VITE_RETIRO_CUENTA`: la cuenta (una dirección G) que recibe el costo. Es la `CUENTA_COBROS` del portero
 *   (`workers/patrocinio/wrangler.toml`) y el build no sale con otra. Su dirección no se escribe en el código del sitio:
 *   sale solo de esta variable.
 *
 * Sin la cuenta no se cobra nada. Con el costo en cero tampoco. Las dos vacías son el sitio de siempre: nada de esto
 * se prende solo.
 *
 * Es un archivo mínimo y sin nada del navegador a propósito: lo lee también `vite.config.ts` (el control del build, en
 * `premios-build.ts`) y la entrada es el entorno que se le pasa. Los montos son siempre `bigint` en stroops (un dólar
 * digital son 10.000.000), sin redondeo: lo que se escribe es exactamente lo que se cobra.
 */

type Entorno = Record<string, unknown>;

/** Los stroops de un dólar digital. */
export const STROOPS_POR_DOLAR = 10_000_000n;

/** Los stroops de un centavo de dólar digital. */
const STROOPS_POR_CENTAVO = STROOPS_POR_DOLAR / 100n;

/** El costo más alto que se acepta, en stroops: 5 dólares digitales. Arriba de eso es un error de escritura. */
export const TOPE_DEL_COSTO = 5n * STROOPS_POR_DOLAR;

/** Cómo se escribe el costo: hasta tres cifras enteras y, si hay decimales, un punto y de uno a siete. */
const FORMA_DEL_COSTO = /^\d{1,3}(\.\d{1,7})?$/;

/** Qué dice el entorno del costo: sin poner, mal escrito, por encima del tope o un monto bueno (puede ser cero). */
export type LecturaDelCosto = { tipo: "vacio" } | { tipo: "mal-escrito" } | { tipo: "sobre-el-tope" } | { tipo: "valido"; stroops: bigint };

/** Qué dice el entorno de la cuenta: sin poner, que no es una dirección G de verdad, o una que sí lo es. */
export type LecturaDeLaCuenta = { tipo: "vacia" } | { tipo: "invalida" } | { tipo: "valida"; cuenta: string };

/** Lee el texto de `VITE_RETIRO_COSTO` y lo pasa a stroops sin redondear. Los espacios de las puntas no cuentan. */
export function leerElCosto(crudo: unknown): LecturaDelCosto {
  if (crudo === undefined || crudo === null) return { tipo: "vacio" };
  if (typeof crudo !== "string") return { tipo: "mal-escrito" };
  const texto = crudo.trim();
  if (texto === "") return { tipo: "vacio" };
  if (!FORMA_DEL_COSTO.test(texto)) return { tipo: "mal-escrito" };
  const [enteros = "0", decimales = ""] = texto.split(".");
  const stroops = BigInt(enteros) * STROOPS_POR_DOLAR + BigInt(decimales.padEnd(7, "0"));
  if (stroops > TOPE_DEL_COSTO) return { tipo: "sobre-el-tope" };
  return { tipo: "valido", stroops };
}

/** Lee el texto de `VITE_RETIRO_CUENTA`: una dirección G con su final de control en regla, o lo que esté mal. */
export function leerLaCuenta(crudo: unknown): LecturaDeLaCuenta {
  if (crudo === undefined || crudo === null) return { tipo: "vacia" };
  if (typeof crudo !== "string") return { tipo: "invalida" };
  const texto = crudo.trim();
  if (texto === "") return { tipo: "vacia" };
  return esDireccionG(texto) ? { tipo: "valida", cuenta: texto } : { tipo: "invalida" };
}

/** La cuenta que recibe el costo (`VITE_RETIRO_CUENTA`), o `null` si no está puesta o no es una dirección G válida. */
export function cuentaDelRetiro(env: Entorno): string | null {
  const lectura = leerLaCuenta(env.VITE_RETIRO_CUENTA);
  return lectura.tipo === "valida" ? lectura.cuenta : null;
}

/**
 * El costo fijo de cada retiro en stroops, o `null` si no se cobra nada: sin la cuenta, con el costo vacío o en cero,
 * o con el monto mal escrito o arriba del tope (el build no deja salir esos dos, esto es por si igual llegaran).
 */
export function costoDelRetiro(env: Entorno): bigint | null {
  const costo = leerElCosto(env.VITE_RETIRO_COSTO);
  if (costo.tipo !== "valido" || costo.stroops === 0n) return null;
  return cuentaDelRetiro(env) === null ? null : costo.stroops;
}

/** Los siete decimales de un monto en stroops, con los ceros de la izquierda. */
const decimalesDe = (stroops: bigint): string => (stroops % STROOPS_POR_DOLAR).toString().padStart(7, "0");

/**
 * El monto como se escribe en cada idioma: coma decimal en español y punto en inglés, con dos decimales como mínimo y
 * los que haga falta hasta siete (50 centavos es `0,50`, y 1 dólar con 25 es `1,25`).
 */
export function montoEnTexto(stroops: bigint, idioma: "es" | "en"): string {
  const enteros = (stroops / STROOPS_POR_DOLAR).toString();
  const decimales = decimalesDe(stroops).replace(/0+$/, "").padEnd(2, "0");
  return `${enteros}${idioma === "es" ? "," : "."}${decimales}`;
}

/**
 * El monto dicho como se dice de palabra: `50 centavos` cuando es menos de un dólar y de centavos justos, y el monto
 * con su unidad en los demás casos (`1,25 dólares digitales`).
 */
export function montoEnPalabras(stroops: bigint, idioma: "es" | "en"): string {
  const centavos = stroops / STROOPS_POR_CENTAVO;
  if (stroops > 0n && stroops < STROOPS_POR_DOLAR && stroops % STROOPS_POR_CENTAVO === 0n) {
    if (idioma === "es") return centavos === 1n ? "1 centavo" : `${centavos} centavos`;
    return centavos === 1n ? "1 cent" : `${centavos} cents`;
  }
  const monto = montoEnTexto(stroops, idioma);
  return idioma === "es" ? `${monto} dólares digitales` : `${monto} digital dollars`;
}

/**
 * La `CUENTA_COBROS` de la red principal que tiene el portero, leída del texto de `workers/patrocinio/wrangler.toml`
 * (la sección `[env.mainnet.vars]`), o `null` si no está o está vacía. Lo usa el control del build para comprobar que
 * `VITE_RETIRO_CUENTA` es esa misma cuenta, letra por letra.
 */
export function cuentaDeCobrosDelPortero(toml: string): string | null {
  let seccion = "";
  for (const linea of toml.split(/\r?\n/)) {
    const encabezado = /^\s*\[{1,2}([^\]]+)\]{1,2}\s*(?:#.*)?$/.exec(linea);
    if (encabezado) {
      seccion = (encabezado[1] ?? "").trim();
      continue;
    }
    if (seccion !== "env.mainnet.vars") continue;
    const valor = /^\s*CUENTA_COBROS\s*=\s*"([^"]*)"/.exec(linea);
    if (valor) return (valor[1] ?? "").trim() === "" ? null : (valor[1] ?? "").trim();
  }
  return null;
}
