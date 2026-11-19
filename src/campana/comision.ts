import { sha256 } from "@noble/hashes/sha2.js";

/**
 * Lo que cobra Tinkazo por una campaña de empresa, calculado sin tocar el DOM ni la red: el panel de quien organiza y el
 * guion de quien activa campañas cargan este mismo archivo, así los dos dan siempre el mismo monto y la misma nota.
 *
 * Todo en `bigint` de stroops (un dólar digital son 10.000.000, un centavo 100.000), sin coma flotante. El cobro es un
 * porcentaje del total de los premios, redondeado hacia arriba al centavo, con un mínimo. Se SUMA a lo que la empresa
 * carga y nunca sale del premio: quien gana recibe el premio entero.
 */

/** Los stroops de un dólar digital. */
export const DOLAR = 10_000_000n;
/** Los stroops de un centavo. */
export const CENTAVO = 100_000n;
/** Los puntos básicos de una unidad entera: 10.000 son el 100 %. */
export const BASE_PB = 10_000n;
/** Lo menos que tiene que llegar con un retiro con costo: es el piso del camino por el que viaja este cobro. */
export const LLEGA_MINIMO_DEL_RETIRO = DOLAR;
/** La nota de la comisión vive entre 2^40 y 10^15: nunca es una orden de compra (menos de 2^40) y no pasa de 15 cifras. */
const NOTA_DESDE = 1n << 40n;
const NOTA_HASTA = 10n ** 15n;

/** La suma de los premios, redondeada hacia arriba al centavo. */
export function totalDePremios(premios: readonly bigint[]): bigint {
  let total = 0n;
  for (const p of premios) {
    if (p < 0n) throw new Error("comision: premio negativo");
    total += p;
  }
  return ((total + CENTAVO - 1n) / CENTAVO) * CENTAVO;
}

/**
 * Lo que se cobra: el porcentaje del total de los premios (`pb` puntos básicos) redondeado hacia arriba al centavo, o el
 * mínimo si es más. Lanza con un porcentaje fuera de 1 a 1.000 o un mínimo que no es positivo.
 */
export function comisionDe(premios: readonly bigint[], pb: bigint, minimo: bigint): bigint {
  if (pb < 1n || pb > 1_000n || minimo <= 0n) throw new Error("comision: configuración fuera de forma");
  const bruto = totalDePremios(premios) * pb;
  const unidad = BASE_PB * CENTAVO;
  const redondeada = ((bruto + unidad - 1n) / unidad) * CENTAVO;
  return redondeada > minimo ? redondeada : minimo;
}

/** Lo que la empresa tiene que cargar en total: los premios más la comisión. */
export const totalACargar = (premios: readonly bigint[], comision: bigint): bigint => totalDePremios(premios) + comision;

/** Lo que alcanza a ver la red para dar por pagada la comisión: lo que llega al destino, que es la comisión menos el costo del retiro. */
export const umbralPagado = (comision: bigint, costo: bigint): bigint => comision - costo;

/** Lo que falta cargar para llegar al total, o cero. */
export const falta = (saldo: bigint, total: bigint): bigint => (total > saldo ? total - saldo : 0n);

/** ¿Un monto está escrito en centavos justos? */
export const esDeCentavosJustos = (monto: bigint): boolean => monto % CENTAVO === 0n;

/**
 * La nota numérica del evento: sale de su nombre y no de nada que cambie entre pantallas. Entre 13 y 15 cifras, nunca
 * cero, nunca una orden de compra.
 */
export function notaDeLaComision(evento: string): string {
  const h = sha256(new TextEncoder().encode(`tinkazo:comision:v1:${evento}`));
  let x = 0n;
  for (let i = 0; i < 8; i++) x = (x << 8n) | BigInt(h[i] ?? 0);
  return (NOTA_DESDE + (x % (NOTA_HASTA - NOTA_DESDE))).toString();
}

const esObjeto = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);

/**
 * Lo que el guion necesita del archivo de una campaña: el evento con la forma del modelo, los premios y la hora de apertura.
 * `null` si no tiene esa forma. Acepta el texto (ya leído) y no el archivo firmado: el que llama saca `texto` antes.
 */
export function loQueCobra(datos: unknown): { evento: string; premios: bigint[]; abreMs: number; organizadora: string | null } | null {
  if (!esObjeto(datos)) return null;
  const { evento, premios, abreMs, organizadora } = datos;
  if (typeof evento !== "string" || !/^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/u.test(evento)) return null;
  if (!Array.isArray(premios) || premios.length < 1 || premios.length > 10) return null;
  const lista: bigint[] = [];
  for (const p of premios) {
    if (typeof p !== "string" || !/^\d{1,16}$/u.test(p) || BigInt(p) < CENTAVO) return null;
    lista.push(BigInt(p));
  }
  if (typeof abreMs !== "number" || !Number.isFinite(abreMs)) return null;
  return { evento, premios: lista, abreMs, organizadora: typeof organizadora === "string" ? organizadora : null };
}

/** El porcentaje escrito: `2 %` en español y `2%` en inglés, con coma o punto para los décimos. */
export function porcentajeEnTexto(pb: bigint, idioma: "es" | "en"): string {
  const enteros = pb / 100n;
  const decimas = pb % 100n;
  const coma = idioma === "es" ? "," : ".";
  const numero = decimas === 0n ? `${enteros}` : `${enteros}${coma}${decimas.toString().padStart(2, "0").replace(/0+$/, "")}`;
  return idioma === "es" ? `${numero} %` : `${numero}%`;
}

/** El monto en dólares con dos decimales como mínimo (hasta siete si hacen falta), coma en español y punto en inglés. */
export function dolaresEnTexto(stroops: bigint, idioma: "es" | "en"): string {
  const enteros = (stroops / DOLAR).toString();
  const decimales = (stroops % DOLAR).toString().padStart(7, "0").replace(/0+$/, "").padEnd(2, "0");
  return `${enteros}${idioma === "es" ? "," : "."}${decimales}`;
}

/** El activo con que se paga: el código y el emisor. */
export interface ActivoDeCobro {
  code: string;
  issuer: string;
}

/**
 * El enlace de pago que leen las billeteras (SEP-7), con la nota como número: la cuenta que cobra, el monto con sus dos decimales,
 * el activo y la nota del evento. Lo usan el plegado del panel y el guion de quien activa campañas, para que lleven lo mismo.
 */
export function enlaceDePago(cuenta: string, monto: bigint, nota: string, activo: ActivoDeCobro): string {
  const p = new URLSearchParams({
    destination: cuenta,
    amount: dolaresEnTexto(monto, "en"),
    asset_code: activo.code,
    asset_issuer: activo.issuer,
    memo: nota,
    memo_type: "MEMO_ID",
  });
  return `web+stellar:pay?${p.toString()}`;
}
