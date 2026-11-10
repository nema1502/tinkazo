import { network, type NetworkName } from "./config";

/**
 * Premios pagados: lo que no necesita la red ni el SDK.
 *
 * Tinkazo no guarda ni mueve dinero. Cuando un premio es en USDC, quien organiza lo paga desde su propia cuenta a la
 * cuenta de quien ganó, con un pago clásico de Stellar (la billetera de quien organiza lo firma), y el pago lleva una
 * nota de texto que nombra el sorteo y el puesto: `tk:premio:<número del sorteo>:<puesto desde 0>`. El comprobante y la
 * pantalla del resultado buscan ese pago en la red (`pagos-red.ts`) y dicen "Pagado", "Pendiente" o "Vencido".
 *
 * Esto es la parte pura: la bandera, el activo, las cuentas, la nota, el monto y el estado. Nada de esto decide un
 * sorteo ni toca el protocolo (docs/protocolo.md).
 */

/** Cuántos días hay para pagar, contados desde que se sorteó. */
export const PLAZO_DE_PAGO_DIAS = 7;
export const PLAZO_DE_PAGO_S = PLAZO_DE_PAGO_DIAS * 86_400;

/* ------------------------------------------------------------------ bandera */

// Vive aparte, mínima: la página de verificación solo carga el resto cuando está prendida.
export { pagosActivos } from "./pagos-bandera";

/* ------------------------------------------------------------------- activo */

/** Un activo clásico de Stellar: el código y quien lo emite. */
export interface ActivoDePago {
  code: string;
  issuer: string;
}

/** USDC de Circle en mainnet (contrato `CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75`). */
export const USDC_MAINNET: ActivoDePago = { code: "USDC", issuer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN" };
/** El USDC de prueba de Circle en testnet (la cuenta tiene `centre.io` como dominio). */
export const USDC_TESTNET: ActivoDePago = { code: "USDC", issuer: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5" };

/** Un activo escrito `CODIGO:EMISOR`, o `null` si no lo es. */
export function leerActivo(texto: unknown): ActivoDePago | null {
  if (typeof texto !== "string") return null;
  const [code, issuer, resto] = texto.trim().split(":");
  if (resto !== undefined || !code || !issuer) return null;
  if (!/^[A-Za-z0-9]{1,12}$/.test(code) || !esDireccionG(issuer)) return null;
  return { code, issuer };
}

/**
 * El activo con que se paga en una red. En mainnet es siempre el USDC de Circle: no se cambia con una variable. En
 * testnet es el USDC de prueba de Circle o, con `VITE_PAGOS_ACTIVO=CODIGO:EMISOR`, otro activo de prueba (para
 * ensayar con uno propio sin pedir USDC de prueba).
 */
export function activoDePagos(red: NetworkName = network.name, propio: unknown = import.meta.env.VITE_PAGOS_ACTIVO): ActivoDePago {
  if (red === "mainnet") return USDC_MAINNET;
  return leerActivo(propio) ?? USDC_TESTNET;
}

/**
 * Las cuentas que pagan además de quien selló, separadas por comas (`VITE_PAGOS_CUENTAS`): la cuenta de un evento
 * que paga los premios sin ser la que selló los sorteos. Las que no son una dirección se descartan.
 */
export function cuentasQuePagan(crudo: unknown = import.meta.env.VITE_PAGOS_CUENTAS): string[] {
  if (typeof crudo !== "string") return [];
  return [...new Set(crudo.split(/[\s,;]+/).filter(esDireccionG))];
}

/* ------------------------------------------------------------------ cuentas */

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** CRC16 XModem, el que Stellar usa para el final de una dirección. */
function crc16(bytes: readonly number[]): number {
  let crc = 0;
  for (const b of bytes) {
    crc ^= b << 8;
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc;
}

/**
 * ¿Es una cuenta de Stellar (`G…`)? Mide 56 caracteres, empieza con G y su final de control cuadra: una dirección
 * con una letra cambiada no pasa. No usa el SDK, así se puede preguntar al pintar la pantalla del resultado.
 */
export function esDireccionG(s: unknown): s is string {
  if (typeof s !== "string" || !/^G[A-Z2-7]{55}$/.test(s)) return false;
  const bytes: number[] = [];
  let acc = 0;
  let bits = 0;
  for (const c of s) {
    acc = (acc << 5) | BASE32.indexOf(c);
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((acc >> bits) & 0xff);
    }
  }
  // 35 bytes: la versión (6 << 3 = cuenta), la llave de 32 y el control de 2, en ese orden.
  if (bytes.length !== 35 || bytes[0] !== 6 << 3) return false;
  const control = (bytes[34] as number) * 256 + (bytes[33] as number);
  return crc16(bytes.slice(0, 33)) === control;
}

/* --------------------------------------------------------------------- nota */

const PREFIJO_NOTA = "tk:premio:";

/** Lo más que cabe en la nota de texto de un pago de Stellar, en bytes. */
const NOTA_MAX_BYTES = 28;

/**
 * La nota que lleva el pago de un premio: `tk:premio:<número del sorteo>:<puesto>`, con el puesto desde 0 (el primero
 * en salir es el 0). Lanza si el número o el puesto no son enteros sin signo, o si no entra en una nota.
 */
export function notaDelPremio(raffleId: string | number | bigint, puesto: number): string {
  const id = String(raffleId);
  if (!/^\d{1,20}$/.test(id)) throw new Error("pagos: el número del sorteo no es un entero");
  if (!Number.isSafeInteger(puesto) || puesto < 0) throw new Error("pagos: el puesto no es un entero sin signo");
  const nota = `${PREFIJO_NOTA}${id}:${puesto}`;
  if (new TextEncoder().encode(nota).length > NOTA_MAX_BYTES) throw new Error("pagos: la nota no entra");
  return nota;
}

/** Al revés: de qué sorteo y de qué puesto es una nota, o `null` si no es la de un premio. */
export function leerNotaDelPremio(nota: unknown): { raffleId: string; puesto: number } | null {
  if (typeof nota !== "string") return null;
  const m = /^tk:premio:(\d{1,20}):(\d{1,9})$/.exec(nota);
  return m ? { raffleId: m[1] as string, puesto: Number(m[2]) } : null;
}

/* -------------------------------------------------------------------- monto */

/** Lo más que admite Stellar en un pago, en unidades mínimas (stroops): el máximo de un entero de 64 bits. */
const MONTO_MAX_STROOPS = 9_223_372_036_854_775_807n;

/**
 * El monto que escribió la persona, como lo pide Stellar: siete decimales ("50" es "50.0000000"). Acepta coma o punto
 * como decimal. Devuelve `null` si no es un número, si es cero o negativo, si tiene más de siete decimales o si no entra.
 */
export function montoDePago(texto: unknown): string | null {
  if (typeof texto !== "string") return null;
  const m = /^(\d{1,13})(?:[.,](\d{1,7}))?$/.exec(texto.trim());
  if (!m) return null;
  const decimales = (m[2] ?? "").padEnd(7, "0");
  const stroops = BigInt(m[1] as string) * 10_000_000n + BigInt(decimales);
  if (stroops <= 0n || stroops > MONTO_MAX_STROOPS) return null;
  return `${m[1]}.${decimales}`;
}

/** Los stroops de un monto con siete decimales, para compararlos sin errores de redondeo. */
export function stroopsDe(monto: string): bigint {
  const [e = "0", d = ""] = monto.split(".");
  return BigInt(e) * 10_000_000n + BigInt(d.padEnd(7, "0").slice(0, 7));
}

/** "50.0000000" como se lee: "50", y "12.5000000" como "12.5". */
export function montoLegible(monto: string): string {
  const [e = "0", d = ""] = monto.split(".");
  const dec = d.replace(/0+$/, "");
  return dec ? `${e}.${dec}` : e;
}

/**
 * El monto que dice el texto del premio, para proponerlo en el campo: "50 USDC", "USDC 50", "$50", "12,5 dólares".
 * Si no hay uno claro, `null`: se escribe a mano.
 */
export function montoDelPremio(premio: string): string | null {
  const num = "(\\d{1,9}(?:[.,]\\d{1,7})?)";
  const unidad = "(?:usdc|usd|us\\$|\\$|d[oó]lar(?:es)?)";
  const crudo = new RegExp(`${num}\\s*${unidad}(?![a-z])`, "i").exec(premio)?.[1] ?? new RegExp(`(?:usdc|usd|us\\$|\\$)\\s*${num}`, "i").exec(premio)?.[1];
  return crudo && montoDePago(crudo) ? crudo : null;
}

/* ------------------------------------------------------------------- estado */

/** Lo que dijo la red sobre el pago de un premio. */
export type LecturaDePago =
  | { tipo: "pagado"; hash: string; monto: string; cuando: number; de: string }
  | { tipo: "no-hay" }
  /** La red no contestó (ni Horizon ni el RPC): no se sabe. Nunca se toma como que no hay pago. */
  | { tipo: "sin-consulta" };

/** Cómo está un premio. `vence` es el último instante del plazo (Unix, segundos). */
export type EstadoDePago =
  | { tipo: "pagado"; hash: string; monto: string; cuando: number }
  | { tipo: "pendiente"; vence: number }
  | { tipo: "vencido"; vence: number }
  | { tipo: "sin-consulta" };

/**
 * El estado de un premio. Un pago encontrado manda siempre, aunque haya llegado tarde. Sin pago: "Pendiente" mientras
 * dura el plazo (hasta el instante en que se cumplen los siete días, inclusive) y "Vencido" después. Si la red no
 * contestó, no se afirma ni una cosa ni la otra: un "Vencido" por una consulta que falló acusaría a quien organiza.
 */
export function estadoDelPago(lectura: LecturaDePago, sorteoEn: number, ahora: number): EstadoDePago {
  if (lectura.tipo === "pagado") return { tipo: "pagado", hash: lectura.hash, monto: lectura.monto, cuando: lectura.cuando };
  if (lectura.tipo === "sin-consulta") return { tipo: "sin-consulta" };
  const vence = sorteoEn + PLAZO_DE_PAGO_S;
  return ahora > vence ? { tipo: "vencido", vence } : { tipo: "pendiente", vence };
}
