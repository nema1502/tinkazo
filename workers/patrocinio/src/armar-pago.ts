/**
 * Arma pagos de premio y retiros como los arma el sitio, con variantes a propósito mal hechas. Lo usan solo las pruebas de
 * unidad (`pagos-lista.test.ts`). No entra en el Worker. Sin reloj: la ventana se pide en segundos de la red, contados desde
 * una hora fija (`AHORA_DE_PRUEBA`), para que ninguna prueba dependa de la hora de la máquina.
 */
import {
  Account,
  Asset,
  Keypair,
  Memo,
  MuxedAccount,
  Networks,
  Operation,
  SorobanDataBuilder,
  TransactionBuilder,
  xdr,
  type Transaction,
} from "@stellar/stellar-sdk/base";
import { EMISOR_USDC } from "./cobros";
import type { FormaDePago } from "./pagos-lista";

/** Una hora fija de la red, en segundos: la ventana de un pago se cuenta desde acá. */
export const AHORA_DE_PRUEBA = 1_800_000_000;
/** Lo que dura un pago armado: lo mismo que el sitio. */
export const VALE_DE_PRUEBA_S = 240;
/** El USDC de Circle, el único activo que el portero paga. */
export const USDC_DE_CIRCLE = new Asset("USDC", EMISOR_USDC);

export interface VariantePago {
  /** Quién manda: es el origen del pago y, por defecto, quien lo firma. */
  firmante: Keypair;
  /** Qué se arma: un premio (un pago) o un retiro (dos pagos: la persona y el costo). */
  forma: FormaDePago;
  /** La cuenta de cobros, adonde va el costo del retiro. */
  cobros: string;
  /** La red; por defecto la principal. */
  passphrase?: string;
  secuencia?: string;
  /** Quien recibe lo que llega; por defecto una cuenta al azar. */
  persona?: string;
  /** Lo que llega, con siete decimales; por defecto 3 en el premio y 1 en el retiro. */
  monto?: string;
  /** El costo del retiro, con siete decimales; por defecto 0,50. */
  costo?: string;
  /** El sorteo y el puesto de la nota del premio. */
  sorteo?: string;
  puesto?: number;
  /** La nota: la de la forma por defecto (la del premio; ninguna en el retiro). `null` es sin nota. */
  nota?: Memo | null;
  /** Las operaciones a mano, en lugar de las de la forma. */
  operaciones?: xdr.Operation[];
  /** La comisión por operación; por defecto 1000. */
  fee?: number;
  /** Pisa la comisión total en el XDR, después de armarlo. */
  feeTotal?: number;
  /** Cuándo vence, en segundos de la red; 0 es sin límite. Por defecto 240 segundos después de `AHORA_DE_PRUEBA`. */
  venceS?: number;
  /** Desde cuándo vale, en segundos de la red; por defecto 0. */
  desdeS?: number;
  /** Condiciones que no son solo de tiempo: dan una transacción con `precondV2`. */
  condiciones?: "ledger" | "secuencia" | "firmantes";
  /** El origen de la transacción como cuenta multiplexada (una M). */
  origenM?: boolean;
  /** Quiénes firman; por defecto el firmante. Una lista vacía deja el sobre sin firmas. */
  firmas?: Keypair[];
  /** Le pone datos de Soroban a un pago clásico, en el XDR ya armado (el SDK no los deja junto a una nota). */
  datosDeSoroban?: boolean;
  /** Pisa el monto de la primera operación en el XDR, para armar a mano lo que el SDK no deja (un cero, un negativo). */
  montoCrudo?: bigint;
}

/** Un pago de USDC de Circle, sin origen propio. */
export function pagoUsdc(destino: string, monto: string, activo: Asset = USDC_DE_CIRCLE): xdr.Operation {
  return Operation.payment({ destination: destino, asset: activo, amount: monto });
}

/** La dirección multiplexada (una M) de una cuenta G. */
export function direccionM(g: string, id = "7"): string {
  return new MuxedAccount(new Account(g, "0"), id).accountId();
}

/** La nota de un premio, como la escribe el sitio. */
export const notaDePremio = (sorteo: string, puesto: number): string => `tk:premio:${sorteo}:${puesto}`;

function operacionesDe(v: VariantePago): xdr.Operation[] {
  if (v.operaciones) {
    return v.operaciones;
  }
  const persona = v.persona ?? Keypair.random().publicKey();
  if (v.forma === "premio") {
    return [pagoUsdc(persona, v.monto ?? "3.0000000")];
  }
  return [pagoUsdc(persona, v.monto ?? "1.0000000"), pagoUsdc(v.cobros, v.costo ?? "0.5000000")];
}

/**
 * Lo que el SDK no deja armar: la comisión total, los montos crudos y los datos de Soroban junto a una nota, cambiados en el
 * XDR ya armado.
 */
function parchar(xdrBase64: string, v: VariantePago): string {
  if (v.feeTotal === undefined && v.montoCrudo === undefined && !v.datosDeSoroban) {
    return xdrBase64;
  }
  const w = xdr.TransactionEnvelope.fromXDR(xdrBase64, "base64").toXdrObject();
  if (w.type !== 2) {
    throw new Error("armar-pago: solo se parcha un sobre común");
  }
  if (v.feeTotal !== undefined) {
    w.v1.tx.fee = v.feeTotal;
  }
  if (v.datosDeSoroban) {
    w.v1.tx.ext = { v: 1, sorobanData: new SorobanDataBuilder().build().toXdrObject() };
  }
  if (v.montoCrudo !== undefined) {
    const cuerpo = w.v1.tx.operations[0]?.body;
    if (cuerpo?.type !== 1) {
      throw new Error("armar-pago: la primera operación no es un pago");
    }
    cuerpo.paymentOp.amount = v.montoCrudo;
  }
  return xdr.TransactionEnvelope.fromXdrObject(w).toXDR("base64");
}

/** Arma el pago firmado: el sobre en base 64 y el hash de la transacción interna en hexadecimal. */
export function armarPago(v: VariantePago): { xdr: string; hash: string } {
  const passphrase = v.passphrase ?? Networks.PUBLIC;
  const cuenta = new Account(v.firmante.publicKey(), v.secuencia ?? "100");
  const maxTime = v.venceS ?? AHORA_DE_PRUEBA + VALE_DE_PRUEBA_S;
  const b = new TransactionBuilder(v.origenM ? new MuxedAccount(cuenta, "9") : cuenta, {
    fee: String(v.fee ?? 1000),
    networkPassphrase: passphrase,
    timebounds: { minTime: v.desdeS ?? 0, maxTime },
    ...(v.condiciones === "ledger" ? { ledgerbounds: { minLedger: 0, maxLedger: 5_000_000 } } : {}),
    ...(v.condiciones === "secuencia" ? { minAccountSequence: "5" } : {}),
    ...(v.condiciones === "firmantes" ? { extraSigners: [Keypair.random().publicKey()] } : {}),
  });
  for (const op of operacionesDe(v)) {
    b.addOperation(op);
  }
  const nota = v.nota === undefined ? (v.forma === "premio" ? Memo.text(notaDePremio(v.sorteo ?? "5", v.puesto ?? 0)) : null) : v.nota;
  if (nota !== null) {
    b.addMemo(nota);
  }
  const armada = TransactionBuilder.fromXDR(parchar(b.build().toXDR(), v), passphrase) as Transaction;
  armada.sign(...(v.firmas ?? [v.firmante]));
  return { xdr: armada.toXDR(), hash: Buffer.from(armada.hash()).toString("hex") };
}

/** Envuelve un pago ya armado en un fee-bump de otra cuenta, como lo manda el portero. */
export function comoFeeBump(xdrBase64: string, quienPaga: Keypair, passphrase: string = Networks.PUBLIC): string {
  const interna = TransactionBuilder.fromXDR(xdrBase64, passphrase) as Transaction;
  const envuelta = TransactionBuilder.buildFeeBumpTransaction(quienPaga, "10000", interna, passphrase);
  envuelta.sign(quienPaga);
  return envuelta.toXDR();
}

/** El mismo pago como sobre de la versión vieja de las transacciones, sin firmas. */
export function comoVersionVieja(xdrBase64: string): string {
  const env = xdr.TransactionEnvelope.fromXDR(xdrBase64, "base64");
  if (env.type !== "envelopeTypeTx") {
    throw new Error("armar-pago: la versión vieja pide un sobre común");
  }
  const t = env.value.tx;
  if (t.cond.type !== "precondTime" || t.sourceAccount.type !== "keyTypeEd25519") {
    throw new Error("armar-pago: la versión vieja pide una cuenta G y condiciones de tiempo");
  }
  const vieja = new xdr.TransactionV0({
    sourceAccountEd25519: t.sourceAccount.ed25519,
    fee: t.fee,
    seqNum: t.seqNum,
    timeBounds: t.cond.value,
    memo: t.memo,
    operations: t.operations,
    ext: xdr.TransactionV0Ext.v0(),
  });
  return xdr.TransactionEnvelope.envelopeTypeTxV0(new xdr.TransactionV0Envelope({ tx: vieja, signatures: [] })).toXDR("base64");
}
