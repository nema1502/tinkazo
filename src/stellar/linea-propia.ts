import type { NetworkName } from "./config";
import { passphraseDe } from "./oficiales";
import { type OpcionesDeEnvio, mandarPago } from "./pagos-envio";
import { type CuentaMirada, mirarCuenta, usdcDeLaRed } from "./usdc-cuenta";

/**
 * Activar los dólares digitales en una billetera propia (Freighter u otra que firma y deja mandar a la página).
 *
 * Activarlos es abrir la línea del USDC de Circle de la red: una sola operación `changeTrust`, sin límite, con la cuenta
 * como origen. La arma la página, la billetera de la persona la firma (le pide aprobarla) y la página la manda a Horizon,
 * como el pago de un premio (`pagos-envio.ts`). La red aparta medio XLM de la billetera mientras la línea siga abierta y
 * cobra una comisión mínima. Tinkazo no paga ni guarda nada.
 *
 * Con una cuenta de Google o de correo no corre: esa la activa Pollar (`activarUsdc`).
 */

/** Lo que se le pide a la billetera. Es la de la página (`activeWallet`); en las pruebas, un reemplazo. */
export interface BilleteraPropia {
  readonly submitsItself?: boolean;
  networkPassphrase(): Promise<string | null>;
  signTransaction(xdr: string, opts: { networkPassphrase: string; address: string }): Promise<{ signedTxXdr: string }>;
}

export type ResultadoDeLinea =
  /** La línea está en la red: ya puede recibir. */
  | "activada"
  /** Se mandó y todavía no se ve: hay que volver a mirar. La misma no entra dos veces (lleva la secuencia). */
  | "enviada"
  | "no-aprobada"
  /** No alcanza el XLM libre, o la cuenta todavía no existe. */
  | "sin-xlm"
  | "otra-red"
  /** No se pudo leer la cuenta: no se firmó nada. */
  | "sin-red"
  /** La red la rechazó por otra cosa. */
  | "no-salio"
  /** Una billetera que firma y manda sola (Google o correo): acá no corre. */
  | "no-corre";

/** Comisión máxima: 0,0001 XLM, diez veces la base, como el pago de un premio. */
const COMISION = "1000";
/** Cuánto vale lo armado para mandarlo, en segundos: da tiempo para aprobarlo con calma. */
const VALE_S = 600;

export interface OpcionesDeLinea extends OpcionesDeEnvio {
  /** Hasta cuánto se espera a ver la línea después de mandarla. */
  esperaMs?: number;
  /** Cada cuánto se vuelve a mirar. */
  cadaMs?: number;
  dormir?: (ms: number) => Promise<void>;
}

const tieneLinea = (c: CuentaMirada, red: NetworkName): boolean => {
  const usdc = usdcDeLaRed(red);
  return c.saldos.some((s) => s.code === usdc.code && s.issuer === usdc.issuer);
};

/** Arma la activación sin firmarla: el sobre en base 64, con la secuencia de la cuenta. Lanza si la cuenta no vale. */
export async function armarLinea(red: NetworkName, cuenta: string, secuencia: string): Promise<string> {
  const usdc = usdcDeLaRed(red);
  const { Account, Asset, Operation, TransactionBuilder } = await import("@stellar/stellar-sdk");
  return new TransactionBuilder(new Account(cuenta, secuencia), { fee: COMISION, networkPassphrase: passphraseDe(red) })
    .addOperation(Operation.changeTrust({ asset: new Asset(usdc.code, usdc.issuer) }))
    .setTimeout(VALE_S)
    .build()
    .toXDR();
}

async function esperarLinea(red: NetworkName, cuenta: string, op: OpcionesDeLinea): Promise<boolean> {
  const dormir = op.dormir ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const cada = op.cadaMs ?? 3_000;
  const vueltas = Math.max(1, Math.ceil((op.esperaMs ?? 30_000) / cada));
  for (let i = 0; i < vueltas; i++) {
    const l = await mirarCuenta(red, cuenta, op);
    if (typeof l === "object" && tieneLinea(l, red)) return true;
    await dormir(cada);
  }
  return false;
}

/**
 * Activa los dólares digitales en la billetera propia de la persona. Nunca lanza. Antes de pedir la aprobación mira la
 * red: si la billetera está en otra red, si la cuenta ya tiene la línea o si no se puede leer, no pide nada.
 */
export async function activarLineaPropia(red: NetworkName, cuenta: string, w: BilleteraPropia, op: OpcionesDeLinea = {}): Promise<ResultadoDeLinea> {
  if (w.submitsItself) return "no-corre";
  const frase = passphraseDe(red);
  const suya = await w.networkPassphrase().catch(() => null);
  if (suya !== null && suya !== frase) return "otra-red";
  // Si la red dice que la secuencia ya no es la de la cuenta, se arma de nuevo una sola vez.
  for (let intento = 0; intento < 2; intento++) {
    const l = await mirarCuenta(red, cuenta, op);
    if (l === "sin-red") return "sin-red";
    if (l === "no-existe") return "sin-xlm";
    if (tieneLinea(l, red)) return "activada";
    let xdr: string;
    try {
      xdr = await armarLinea(red, cuenta, l.secuencia);
    } catch {
      return "no-salio";
    }
    let firmado: string;
    try {
      firmado = (await w.signTransaction(xdr, { networkPassphrase: frase, address: cuenta })).signedTxXdr;
    } catch {
      return "no-aprobada";
    }
    const env = await mandarPago(red, firmado, op);
    if (env.ok || env.rechazo === "sin-respuesta") return (await esperarLinea(red, cuenta, op)) ? "activada" : "enviada";
    if (env.rechazo === "sin-saldo") return "sin-xlm";
    if (env.rechazo === "secuencia" && intento === 0) continue;
    return "no-salio";
  }
  return "no-salio";
}
