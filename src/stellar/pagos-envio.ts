import { HORIZON_URLS, type NetworkName } from "./config";
import { passphraseDe } from "./oficiales";
import { type ActivoDePago, esDireccionG, notaDelPremio, stroopsDe } from "./pagos";

/**
 * Armar el pago de un premio y mandarlo.
 *
 * Es un pago clásico de Stellar: un `payment` en USDC de la cuenta de quien organiza a la de quien ganó, con la nota
 * `tk:premio:<sorteo>:<puesto>` (`pagos.ts`). Tinkazo lo arma, la billetera de quien organiza lo firma (esto no firma
 * nada ni guarda llaves) y se manda a Horizon. Antes de pedir la firma se mira la red para no hacer firmar un pago que
 * va a fallar: si la cuenta de destino no existe o no tiene el USDC activado (la línea de confianza), si la de quien paga
 * no tiene saldo.
 *
 * El SDK de Stellar se pide recién acá adentro, con `import()`: las páginas no lo bajan al abrirse.
 */

type Fetch = typeof fetch;

export interface DatosDelPago {
  red: NetworkName;
  /** La cuenta que paga: la que firma. */
  origen: string;
  /** La cuenta de quien ganó. */
  destino: string;
  activo: ActivoDePago;
  /** El monto ya normalizado (`montoDePago`): siete decimales. */
  monto: string;
  raffleId: string | number | bigint;
  /** El puesto del premio, desde 0. */
  puesto: number;
}

export interface OpcionesDeEnvio {
  fetch?: Fetch;
  horizon?: string;
  tiempoMs?: number;
}

/** Por qué no se pudo preparar el pago. */
export type MotivoSinPago =
  | "datos-invalidos"
  | "destino-sin-cuenta"
  | "destino-sin-linea"
  | "destino-lleno"
  | "origen-sin-cuenta"
  | "origen-sin-linea"
  | "origen-sin-saldo"
  | "sin-red";

export type Preparacion =
  | { ok: true; xdr: string; nota: string; monto: string }
  | { ok: false; motivo: MotivoSinPago; /** Con `origen-sin-saldo`: lo que tiene la cuenta, con siete decimales. */ saldo?: string };

const TIEMPO_MS = 10_000;
/** Comisión máxima del pago: 0,0001 XLM por operación, diez veces la base, para que entre aunque la red esté cargada. */
const COMISION = "1000";
/** Cuánto vale el pago armado para mandarlo, en segundos. Da margen para firmar con calma. */
const VALE_S = 600;

async function conEspera<T>(ms: number, hacer: (senal: AbortSignal) => Promise<T>): Promise<T> {
  const ctl = new AbortController();
  const vence = new Promise<never>((_, rechazar) => {
    ctl.signal.addEventListener("abort", () => rechazar(new Error("pagos-espera")), { once: true });
  });
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    return await Promise.race([hacer(ctl.signal), vence]);
  } finally {
    clearTimeout(t);
  }
}

/** Una cuenta de Horizon: su número de secuencia y sus saldos, o que no existe, o que no se pudo leer. */
interface CuentaLeida {
  secuencia: string;
  saldos: Array<{ code: string; issuer: string; saldo: string; limite: string; autorizada: boolean }>;
}

async function leerCuenta(base: string, cuenta: string, op: OpcionesDeEnvio): Promise<CuentaLeida | "no-existe" | "sin-red"> {
  const f = op.fetch ?? fetch;
  try {
    return await conEspera(op.tiempoMs ?? TIEMPO_MS, async (signal) => {
      const r = await f(`${base}/accounts/${encodeURIComponent(cuenta)}`, { signal });
      if (r.status === 404) return "no-existe" as const;
      if (!r.ok) return "sin-red" as const;
      const j = (await r.json()) as { sequence?: unknown; balances?: unknown };
      if (typeof j.sequence !== "string" || !/^\d{1,20}$/.test(j.sequence) || !Array.isArray(j.balances)) return "sin-red" as const;
      const saldos: CuentaLeida["saldos"] = [];
      for (const b of j.balances as Array<Record<string, unknown>>) {
        if (typeof b.asset_code !== "string" || typeof b.asset_issuer !== "string") continue;
        saldos.push({
          code: b.asset_code,
          issuer: b.asset_issuer,
          saldo: typeof b.balance === "string" ? b.balance : "0",
          limite: typeof b.limit === "string" ? b.limit : "0",
          // Sin el dato, se supone que sí: la mayoría de los emisores no pide autorización.
          autorizada: b.is_authorized !== false,
        });
      }
      return { secuencia: j.sequence, saldos };
    });
  } catch {
    return "sin-red";
  }
}

/** Los siete decimales de un monto de Horizon, para mostrarlo y compararlo. */
const siete = (m: string): string => {
  const [e = "0", d = ""] = m.split(".");
  return `${e}.${d.padEnd(7, "0").slice(0, 7)}`;
};

/**
 * Arma el pago, sin firmar ni mandar nada: el sobre de la transacción en base 64 (XDR), listo para firmar. Con la
 * secuencia de la cuenta que paga. Lanza si los datos no valen (cuenta, monto, número del sorteo o puesto).
 */
export async function armarPago(d: DatosDelPago, secuencia: string): Promise<{ xdr: string; nota: string }> {
  if (!esDireccionG(d.origen) || !esDireccionG(d.destino) || !esDireccionG(d.activo.issuer)) throw new Error("pagos: cuenta inválida");
  if (!/^\d{1,13}\.\d{7}$/.test(d.monto) || stroopsDe(d.monto) <= 0n) throw new Error("pagos: monto inválido");
  const nota = notaDelPremio(d.raffleId, d.puesto);
  const { Account, Asset, Memo, Operation, TransactionBuilder } = await import("@stellar/stellar-sdk");
  const tx = new TransactionBuilder(new Account(d.origen, secuencia), { fee: COMISION, networkPassphrase: passphraseDe(d.red) })
    .addOperation(Operation.payment({ destination: d.destino, asset: new Asset(d.activo.code, d.activo.issuer), amount: d.monto }))
    .addMemo(Memo.text(nota))
    .setTimeout(VALE_S)
    .build();
  return { xdr: tx.toXDR(), nota };
}

/**
 * Mira la red y arma el pago si va a entrar. Nunca lanza por la red: lo que no se pudo leer es `sin-red`.
 * No firma ni manda nada.
 */
export async function prepararPago(d: DatosDelPago, op: OpcionesDeEnvio = {}): Promise<Preparacion> {
  if (!esDireccionG(d.origen) || !esDireccionG(d.destino) || d.origen === d.destino) return { ok: false, motivo: "datos-invalidos" };
  const base = op.horizon ?? HORIZON_URLS[d.red];
  const [origen, destino] = await Promise.all([leerCuenta(base, d.origen, op), leerCuenta(base, d.destino, op)]);
  if (origen === "sin-red" || destino === "sin-red") return { ok: false, motivo: "sin-red" };
  if (origen === "no-existe") return { ok: false, motivo: "origen-sin-cuenta" };
  if (destino === "no-existe") return { ok: false, motivo: "destino-sin-cuenta" };

  const es = (s: { code: string; issuer: string }): boolean => s.code === d.activo.code && s.issuer === d.activo.issuer;
  const suya = origen.saldos.find(es);
  if (!suya) return { ok: false, motivo: "origen-sin-linea" };
  if (stroopsDe(siete(suya.saldo)) < stroopsDe(d.monto)) return { ok: false, motivo: "origen-sin-saldo", saldo: siete(suya.saldo) };

  const sua = destino.saldos.find(es);
  if (!sua || !sua.autorizada) return { ok: false, motivo: "destino-sin-linea" };
  if (stroopsDe(siete(sua.limite)) - stroopsDe(siete(sua.saldo)) < stroopsDe(d.monto)) return { ok: false, motivo: "destino-lleno" };

  try {
    const { xdr, nota } = await armarPago(d, origen.secuencia);
    return { ok: true, xdr, nota, monto: d.monto };
  } catch {
    return { ok: false, motivo: "datos-invalidos" };
  }
}

/* ---------------------------------------------------------------------- mandar */

/** Por qué la red no aceptó el pago. */
export type MotivoDeRechazo = "sin-saldo" | "sin-linea" | "sin-cuenta" | "lleno" | "secuencia" | "vencido" | "firma" | "otro";

export type Envio =
  | { ok: true; hash: string }
  | { ok: false; rechazo: MotivoDeRechazo; codigos: string[] }
  /** No se supo si entró: no contestó o se cortó. Mandarlo otra vez no puede duplicarlo (es la misma transacción). */
  | { ok: false; rechazo: "sin-respuesta"; codigos: string[] };

function motivoDe(codigos: string[]): MotivoDeRechazo {
  const hay = (...c: string[]): boolean => codigos.some((x) => c.includes(x));
  if (hay("op_underfunded", "tx_insufficient_balance", "op_low_reserve")) return "sin-saldo";
  if (hay("op_no_trust", "op_not_authorized")) return "sin-linea";
  if (hay("op_no_destination")) return "sin-cuenta";
  if (hay("op_line_full")) return "lleno";
  if (hay("tx_bad_seq")) return "secuencia";
  if (hay("tx_too_late", "tx_too_early")) return "vencido";
  if (hay("tx_bad_auth", "tx_bad_auth_extra")) return "firma";
  return "otro";
}

/**
 * Manda el pago firmado a Horizon. Nunca lanza. El pago lleva la secuencia de la cuenta: mandar el mismo sobre dos
 * veces no cobra dos veces.
 */
export async function mandarPago(red: NetworkName, xdrFirmado: string, op: OpcionesDeEnvio = {}): Promise<Envio> {
  const f = op.fetch ?? fetch;
  const base = op.horizon ?? HORIZON_URLS[red];
  try {
    return await conEspera(op.tiempoMs ?? TIEMPO_MS * 3, async (signal) => {
      const r = await f(`${base}/transactions`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ tx: xdrFirmado }).toString(),
        signal,
      });
      let j: Record<string, unknown> = {};
      try {
        j = (await r.json()) as Record<string, unknown>;
      } catch {
        /* sin cuerpo que leer */
      }
      if (r.ok && typeof j.hash === "string" && /^[0-9a-f]{64}$/.test(j.hash)) return { ok: true, hash: j.hash } as const;
      // 504: Horizon no esperó el resultado. No se sabe si entró.
      if (r.status === 504 || r.status === 408 || r.status === 429 || r.status >= 500) return { ok: false, rechazo: "sin-respuesta", codigos: [] } as const;
      const extras = (j.extras ?? {}) as { result_codes?: { transaction?: unknown; operations?: unknown } };
      const codigos = [extras.result_codes?.transaction, ...(Array.isArray(extras.result_codes?.operations) ? (extras.result_codes?.operations as unknown[]) : [])].filter(
        (c): c is string => typeof c === "string",
      );
      return { ok: false, rechazo: motivoDe(codigos), codigos } as const;
    });
  } catch {
    return { ok: false, rechazo: "sin-respuesta", codigos: [] };
  }
}
