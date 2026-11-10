import { CUPON_MONTO, TOPE_OPERACIONES, esCuenta, memoCupon } from "./modelo";

/**
 * La transacción de cupones: UN pago clásico de 1 stroop de XLM a cada cuenta, todos en la misma transacción
 * (hasta 100 operaciones, el tope de la red) y con la misma nota `tk:cupon:<evento>`. La arma el navegador de quien
 * organiza, la aprueba su billetera y se manda a Stellar: ningún servidor de Tinkazo toca la plata ni las llaves.
 *
 * El SDK de Stellar se pide recién acá adentro, con `import()`: las pantallas no lo bajan al abrirse.
 */

export interface PedidoDeCupones {
  /** La cuenta del evento: la que paga y firma. */
  origen: string;
  /** Su número de secuencia de ahora (Horizon: `sequence`). */
  secuencia: string;
  /** A quién se le manda el cupón, sin repetidos. */
  destinos: readonly string[];
  evento: string;
  passphrase: string;
  /** Cuánto dura la transacción para entrar a la red, en segundos (una hora: da tiempo de aprobarla desde Stellar Lab). */
  vigenciaS?: number;
}

export interface TransaccionDeCupones {
  xdr: string;
  destinos: string[];
  memo: string;
}

export class ErrorDeCupones extends Error {
  constructor(readonly motivo: "vacia" | "demasiadas" | "repetidas" | "cuenta") {
    super(`cupones:${motivo}`);
  }
}

/** Parte una lista en tandas de a 100: una transacción por tanda. */
export function tandas<T>(xs: readonly T[], tope = TOPE_OPERACIONES): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += tope) out.push(xs.slice(i, i + tope));
  return out;
}

/** Arma la transacción, sin firmar. Falla con `ErrorDeCupones` si la lista está vacía, pasa de 100 o repite una cuenta. */
export async function armarCupones(p: PedidoDeCupones): Promise<TransaccionDeCupones> {
  if (p.destinos.length === 0) throw new ErrorDeCupones("vacia");
  if (p.destinos.length > TOPE_OPERACIONES) throw new ErrorDeCupones("demasiadas");
  if (new Set(p.destinos).size !== p.destinos.length) throw new ErrorDeCupones("repetidas");
  if (!esCuenta(p.origen) || p.destinos.some((d) => !esCuenta(d))) throw new ErrorDeCupones("cuenta");
  const { Account, Asset, Memo, Operation, TransactionBuilder } = await import("@stellar/stellar-sdk");
  const memo = memoCupon(p.evento);
  const b = new TransactionBuilder(new Account(p.origen, p.secuencia), {
    // La comisión del SDK es POR operación: 1.000 stroops cada una como tope (la red cobra lo que hace falta, no lo que se ofrece).
    fee: "1000",
    networkPassphrase: p.passphrase,
  });
  for (const destination of p.destinos) b.addOperation(Operation.payment({ destination, asset: Asset.native(), amount: CUPON_MONTO }));
  const tx = b.addMemo(Memo.text(memo)).setTimeout(p.vigenciaS ?? 3600).build();
  return { xdr: tx.toXDR(), destinos: [...p.destinos], memo };
}

/** Lo que tiene una transacción de cupones ya armada, leída del XDR: para comprobar lo que se va a aprobar. */
export interface ResumenDeCupones {
  origen: string;
  /** La comisión máxima de toda la transacción, en stroops. */
  comision: number;
  memo: string | null;
  operaciones: { destino: string; monto: string; nativo: boolean }[];
}

export async function leerCupones(xdr: string, passphrase: string): Promise<ResumenDeCupones> {
  const { Transaction, TransactionBuilder } = await import("@stellar/stellar-sdk");
  const tx = TransactionBuilder.fromXDR(xdr, passphrase);
  if (!(tx instanceof Transaction)) throw new Error("cupones:fee-bump");
  return {
    origen: tx.source,
    comision: Number(tx.fee),
    // Al leer un XDR, la nota de texto vuelve como bytes.
    memo: tx.memo.type === "text" ? (tx.memo.value instanceof Uint8Array ? new TextDecoder().decode(tx.memo.value) : String(tx.memo.value)) : null,
    operaciones: tx.operations.map((o) => {
      if (o.type !== "payment") throw new Error("cupones:operacion");
      return { destino: o.destination, monto: o.amount, nativo: o.asset.isNative() };
    }),
  };
}
