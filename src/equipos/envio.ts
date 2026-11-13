import type { WalletAdapter } from "../stellar/wallet-lite";
import { enviarTransaccion, type MotivoDeEnvio, type ResultadoDeEnvio } from "./horizon";

/**
 * Aprobar y mandar la transacción de cupones.
 *
 * La cuenta del evento aprueba con lo que tenga a mano:
 *  - Freighter o la cuenta de prueba de testnet, si son la cuenta del evento: aprueban y la transacción sale sola;
 *  - Pollar (entrar con Google), a propósito NO: su firma solo se confirma para lo que la persona acaba de pedir con
 *    su botón (`atenderFirmas`, en `wallet-pollar.ts`), y esto no se amplía. En ese caso, y cuando la billetera
 *    no es la cuenta del evento, se devuelve el código de la transacción para aprobarla en Stellar Lab.
 */

export type Aprobacion =
  | { tipo: "enviado"; hash: string }
  | { tipo: "a-mano"; xdr: string; porque: "pollar" | "otra-cuenta" | "sin-billetera" }
  | { tipo: "fallo"; motivo: MotivoDeEnvio | "rechazada" | "otra-red" | "cancelada" };

export interface DependenciasDeEnvio {
  billetera: WalletAdapter | null;
  passphrase: string;
  enviar?: (xdr: string) => Promise<ResultadoDeEnvio>;
}

/** Una billetera que firma y envía por su cuenta (Pollar): nunca se le pide esto. */
const seEnviaSola = (w: WalletAdapter): boolean => (w as { submitsItself?: boolean }).submitsItself === true;

export async function aprobarYEnviar(xdr: string, origen: string, d: DependenciasDeEnvio): Promise<Aprobacion> {
  const w = d.billetera;
  if (!w) return { tipo: "a-mano", xdr, porque: "sin-billetera" };
  if (seEnviaSola(w)) return { tipo: "a-mano", xdr, porque: "pollar" };
  if (w.address !== origen) return { tipo: "a-mano", xdr, porque: "otra-cuenta" };
  const pass = await w.networkPassphrase().catch(() => null);
  if (pass && pass !== d.passphrase) return { tipo: "fallo", motivo: "otra-red" };
  let aprobada: string;
  try {
    aprobada = (await w.signTransaction(xdr, { networkPassphrase: d.passphrase, address: origen })).signedTxXdr;
  } catch {
    return { tipo: "fallo", motivo: "cancelada" };
  }
  const r = await (d.enviar ?? ((x) => enviarTransaccion(x)))(aprobada);
  return r.ok ? { tipo: "enviado", hash: r.hash } : { tipo: "fallo", motivo: r.motivo };
}

/** Stellar Lab, donde se aprueba y se manda una transacción con la llave de la cuenta del evento. */
export const LAB_FIRMAR = "https://lab.stellar.org/transaction/sign";
