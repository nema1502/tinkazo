/**
 * El depósito de la campaña y el pago a quien organizó: son pagos clásicos de
 * la cuenta de la empresa, armados por la página tal como `armarPago` arma el
 * de un premio (`src/stellar/pagos-envio.ts`). La firma sigue el patrón de
 * `src/equipos/envio.ts`: con Freighter sale sola; con Pollar o sin billetera,
 * la página entrega el código para aprobarlo en Stellar Lab.
 *
 * El SDK de Stellar se pide recién acá adentro, con `import()`: la página no lo
 * baja al abrirse.
 */

import type { NetworkName } from "../stellar/config";
import { esDireccionG } from "../stellar/pagos";
import { mirarCuenta, usdcDeLaRed } from "../stellar/usdc-cuenta";
import { passphraseDe } from "../stellar/oficiales";
import { aprobarYEnviar, type Aprobacion, type DependenciasDeEnvio } from "../equipos/envio";

export interface DatosDelDeposito {
  red: NetworkName;
  /** La cuenta de la empresa, la que firma. */
  origen: string;
  /** La cuenta que recibe: la del servicio al publicar, la de quien organizó al pagar. */
  destino: string;
  /** El monto, en stroops. */
  monto: bigint;
  /** La nota numérica del evento, con la forma que `notaDeLaComision` devuelve. */
  nota: string;
}

/** Los siete decimales de un monto de Horizon. */
const siete = (m: string): string => {
  const [e = "0", d = ""] = m.split(".");
  return `${e}.${d.padEnd(7, "0").slice(0, 7)}`;
};

const STROOPS = 10_000_000n;
const COMISION = "1000";
/** Cuánto vale el pago armado para mandarlo, en segundos: margen para firmar con calma. */
const VALE_S = 600;

const NOTA_DESDE = 1n << 40n;
const NOTA_HASTA = 10n ** 15n;

/** La nota del evento que la página manda con el pago: ni una orden de compra ni una nota con otra forma. */
export function notaValida(nota: string): boolean {
  if (!/^\d{1,20}$/u.test(nota)) return false;
  const valor = BigInt(nota);
  return valor >= NOTA_DESDE && valor < NOTA_HASTA;
}

/** Lo que la empresa tiene que poner: premios más servicio, en un monto con siete decimales. */
export const montoConSiete = (stroops: bigint): string => `${stroops / STROOPS}.${(stroops % STROOPS).toString().padStart(7, "0")}`;

/** El mismo horizonte que Stellar Lab ofrece para aprobar y mandar una transacción con la llave. */
export const LAB_FIRMAR = "https://lab.stellar.org/transaction/sign";

/** El sobre sin firmar, listo para la billetera o para Stellar Lab. Lanza con datos que no valen. */
export async function armarElDeposito(d: DatosDelDeposito, secuencia: string): Promise<{ xdr: string; nota: string }> {
  if (!esDireccionG(d.origen) || !esDireccionG(d.destino)) throw new Error("deposito: cuenta inválida");
  if (d.origen === d.destino) throw new Error("deposito: cuenta inválida");
  if (d.monto <= 0n) throw new Error("deposito: monto inválido");
  if (!notaValida(d.nota)) throw new Error("deposito: nota inválida");
  const monto = montoConSiete(d.monto);
  const activo = usdcDeLaRed(d.red);
  const { Account, Asset, Memo, Operation, TransactionBuilder } = await import("@stellar/stellar-sdk");
  const tx = new TransactionBuilder(new Account(d.origen, secuencia), {
    fee: COMISION,
    networkPassphrase: passphraseDe(d.red),
  })
    .addOperation(
      Operation.payment({
        destination: d.destino,
        // El dólar digital de Circle de la red: el mismo activo que el sitio mueve en las campañas.
        asset: new Asset(activo.code, activo.issuer),
        amount: monto,
      }),
    )
    .addMemo(Memo.text(d.nota))
    .setTimeout(VALE_S)
    .build();
  return { xdr: tx.toXDR(), nota: d.nota };
}

export type PreparacionDelDeposito =
  | { ok: true; xdr: string; nota: string; monto: string }
  | { ok: false; motivo: "datos-invalidos" | "origen-sin-cuenta" | "origen-sin-linea" | "origen-sin-saldo" | "destino-sin-cuenta" | "sin-red"; saldo?: string };

export interface OpcionesDeLaRed {
  fetch?: typeof fetch;
  tiempoMs?: number;
}

/** Mira la red y arma el sobre si va a entrar. Nunca lanza por la red. No firma ni manda nada. */
export async function prepararElDeposito(d: DatosDelDeposito, op: OpcionesDeLaRed = {}): Promise<PreparacionDelDeposito> {
  if (!esDireccionG(d.origen) || !esDireccionG(d.destino) || d.origen === d.destino) return { ok: false, motivo: "datos-invalidos" };
  if (d.monto <= 0n || !notaValida(d.nota)) return { ok: false, motivo: "datos-invalidos" };
  const activo = usdcDeLaRed(d.red);
  const [origen, destino] = await Promise.all([mirarCuenta(d.red, d.origen, op), mirarCuenta(d.red, d.destino, op)]);
  if (origen === "sin-red" || destino === "sin-red") return { ok: false, motivo: "sin-red" };
  if (origen === "no-existe") return { ok: false, motivo: "origen-sin-cuenta" };
  if (destino === "no-existe") return { ok: false, motivo: "destino-sin-cuenta" };
  const propia = origen.saldos.find((l) => l.code === activo.code && l.issuer === activo.issuer);
  if (!propia) return { ok: false, motivo: "origen-sin-linea" };
  if (stroopsDeMonto(propia.saldo) < d.monto) return { ok: false, motivo: "origen-sin-saldo", saldo: siete(propia.saldo) };
  try {
    const { xdr, nota } = await armarElDeposito(d, origen.secuencia);
    return { ok: true, xdr, nota, monto: montoConSiete(d.monto) };
  } catch {
    return { ok: false, motivo: "datos-invalidos" };
  }
}

const stroopsDeMonto = (m: string): bigint => {
  const [e = "0", dec = ""] = m.split(".");
  return BigInt(e) * STROOPS + BigInt(dec.padEnd(7, "0").slice(0, 7));
};

/**
 * La firma y el envío, con el mismo camino de los cupones: la billetera de la
 * empresa la firma si es su cuenta y su red, y si no, la página devuelve el
 * código para Stellar Lab.
 */
export function firmarElDeposito(xdr: string, origen: string, d: DependenciasDeEnvio): Promise<Aprobacion> {
  return aprobarYEnviar(xdr, origen, d);
}

/** Lo que la página necesita para mandar lo que no firmó la billetera, con la cuenta y la red de la campaña. */
export function datosParaStellarLab(xdr: string, origen: string, red: NetworkName): { url: string; xdr: string } {
  return {
    url: `${LAB_FIRMAR}?tx=${encodeURIComponent(xdr)}&network=${red === "mainnet" ? "public" : "testnet"}`,
    xdr,
  };
}
