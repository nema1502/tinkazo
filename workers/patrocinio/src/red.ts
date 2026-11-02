/**
 * Lo que el portero le pregunta a la red (el RPC de Soroban) y cómo lo entiende.
 *
 * Una interfaz chica (`Red`) para que `servicio.ts` se pruebe sin red, y una
 * implementación (`RpcRed`) que habla JSON-RPC con la lista de RPC en orden: si uno
 * se corta, tarda o contesta 5xx, sigue con el siguiente.
 */
import { StrKey, xdr } from "@stellar/stellar-sdk/base";

export type Simulacion = { ok: true; minResourceFee: number } | { ok: false; motivo: "fallaria" | "restaurar"; detalle: string };

export interface CuentaEnRed {
  /** Quién patrocina la reserva de la cuenta (la billetera de fondos de Pollar, si la abrió nuestra app), o null. */
  patrocinador: string | null;
  balance: bigint;
  /** Las llaves que firman por la cuenta (la maestra con su peso y los firmantes extra), crudas de 32 bytes. Sin esto vale solo la maestra. */
  firmantes?: Array<{ clave: Uint8Array; peso: number }>;
  /** El umbral medio de la cuenta: el que pide una invocación de contrato. */
  umbralMedio?: number;
}

export interface Envio {
  status: "PENDING" | "DUPLICATE" | "TRY_AGAIN_LATER" | "ERROR";
  /** El código del rechazo cuando el status es ERROR: `txBadSeq`, `txInsufficientBalance`… */
  codigo?: string;
}

export interface Consulta {
  status: "SUCCESS" | "FAILED" | "NOT_FOUND";
  /** Lo que cobró la red, en stroops, si la transacción entró. */
  feeCharged?: number;
}

/** Los bytes de un valor del XDR nuevo, que guarda su contenido en `.value` o es el propio arreglo. */
function bytesDe(v: unknown): Uint8Array | null {
  if (v instanceof Uint8Array) return v;
  if (v && typeof v === "object" && "value" in v && (v as { value: unknown }).value instanceof Uint8Array) return (v as { value: Uint8Array }).value;
  return null;
}

/** El RPC no contestó con sentido (corte, tiempo, 5xx). Distinto de que la red diga que no. */
export class ErrorDeRed extends Error {
  constructor(mensaje: string, options?: ErrorOptions) {
    super(mensaje, options);
    this.name = "ErrorDeRed";
  }
}

export interface Red {
  simular(xdrTx: string): Promise<Simulacion>;
  leerCuenta(cuenta: string): Promise<CuentaEnRed | null>;
  enviar(xdrTx: string): Promise<Envio>;
  consultar(hash: string): Promise<Consulta>;
}

const TIEMPO_MS = 8000;

export class RpcRed implements Red {
  constructor(
    private readonly urls: readonly string[],
    private readonly pedir: typeof fetch = (...a) => fetch(...a),
  ) {}

  private async llamar<T>(metodo: string, params: unknown): Promise<T> {
    let ultimo: unknown = new ErrorDeRed("sin-rpc");
    for (const url of this.urls) {
      let r: Response;
      try {
        r = await this.pedir(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: metodo, params }), signal: AbortSignal.timeout(TIEMPO_MS) });
      } catch (e) {
        ultimo = new ErrorDeRed("rpc-corte", { cause: e });
        continue;
      }
      if (r.status === 429 || r.status >= 500) {
        ultimo = new ErrorDeRed(`rpc-${r.status}`);
        continue;
      }
      let j: { result?: T; error?: { message?: string } };
      try {
        j = (await r.json()) as typeof j;
      } catch (e) {
        ultimo = new ErrorDeRed("rpc-respuesta", { cause: e });
        continue;
      }
      // Un error del propio RPC (no un corte): para el portero es lo mismo, la red no contestó con sentido. Código fijo, no el texto crudo.
      if (j.error) throw new ErrorDeRed("rpc-error");
      if (j.result === undefined) {
        ultimo = new ErrorDeRed("rpc-vacio");
        continue;
      }
      return j.result;
    }
    throw ultimo;
  }

  async simular(xdrTx: string): Promise<Simulacion> {
    const r = await this.llamar<{ error?: string; minResourceFee?: string; restorePreamble?: unknown }>("simulateTransaction", { transaction: xdrTx });
    if (r.error) return { ok: false, motivo: "fallaria", detalle: r.error.slice(0, 200) };
    if (r.restorePreamble) return { ok: false, motivo: "restaurar", detalle: "hay entradas archivadas" };
    return { ok: true, minResourceFee: Number(r.minResourceFee ?? 0) };
  }

  async leerCuenta(cuenta: string): Promise<CuentaEnRed | null> {
    const clave = xdr.LedgerKey.account(new xdr.LedgerKeyAccount({ accountId: xdr.PublicKey.publicKeyTypeEd25519(new xdr.Uint256Bytes(StrKey.decodeEd25519PublicKey(cuenta))) }));
    const r = await this.llamar<{ entries?: Array<{ xdr: string; extXdr?: string }> | null }>("getLedgerEntries", { keys: [clave.toXDR("base64")] });
    const e = r.entries?.[0];
    if (!e) return null;
    const datos = xdr.LedgerEntryData.fromXDR(e.xdr, "base64");
    if (datos.type !== "account") return null;
    let patrocinador: string | null = null;
    if (e.extXdr) {
      const ext = xdr.LedgerEntryExt.fromXDR(e.extXdr, "base64");
      if (ext.type === "v1") {
        const id = ext.value.sponsoringId;
        if (id && id.type === "publicKeyTypeEd25519") patrocinador = StrKey.encodeEd25519PublicKey(id.ed25519.value as never);
      }
    }
    // La maestra con su peso (primer byte de los umbrales) y cada firmante Ed25519 de la cuenta.
    const umbrales = bytesDe(datos.value.thresholds);
    const firmantes: Array<{ clave: Uint8Array; peso: number }> = [];
    const maestra = bytesDe(datos.value.accountId.ed25519);
    if (maestra && umbrales) firmantes.push({ clave: maestra, peso: umbrales[0] ?? 0 });
    for (const f of datos.value.signers) {
      if (f.key.type !== "signerKeyTypeEd25519") continue;
      const clave = bytesDe(f.key.ed25519);
      if (clave) firmantes.push({ clave, peso: Number(f.weight) });
    }
    return { patrocinador, balance: datos.value.balance, firmantes, umbralMedio: umbrales?.[2] ?? 0 };
  }

  async enviar(xdrTx: string): Promise<Envio> {
    const r = await this.llamar<{ status: string; errorResultXdr?: string }>("sendTransaction", { transaction: xdrTx });
    const status = r.status === "PENDING" || r.status === "DUPLICATE" || r.status === "TRY_AGAIN_LATER" ? r.status : "ERROR";
    const codigo = status === "ERROR" ? codigoDelRechazo(r.errorResultXdr) : undefined;
    return { status, ...(codigo ? { codigo } : {}) };
  }

  async consultar(hash: string): Promise<Consulta> {
    const r = await this.llamar<{ status: string; resultXdr?: string }>("getTransaction", { hash });
    if (r.status !== "SUCCESS" && r.status !== "FAILED") return { status: "NOT_FOUND" };
    const fee = r.resultXdr ? feeCobrada(r.resultXdr) : undefined;
    return { status: r.status, ...(fee !== undefined ? { feeCharged: fee } : {}) };
  }
}

/** El nombre del resultado que dio la red: el de afuera y, si hay, el de adentro (`txFeeBumpInnerFailed/txBadSeq`, `txFailed/opBadAuth`). */
export function codigoDelRechazo(resultXdr: string | undefined): string | undefined {
  if (!resultXdr) return undefined;
  try {
    const r = xdr.TransactionResult.fromXDR(resultXdr, "base64");
    const afuera = r.result.type;
    if (afuera === "txFeeBumpInnerFailed" || afuera === "txFeeBumpInnerSuccess") {
      const dentro = (r.result.value as { result: { result: { type: string } } }).result.result.type;
      return `${afuera}/${dentro}`;
    }
    if (afuera === "txFailed") {
      const op = (r.result.value as Array<{ type: string }>)[0]?.type;
      return op ? `${afuera}/${op}` : afuera;
    }
    return afuera;
  } catch {
    return undefined;
  }
}

function feeCobrada(resultXdr: string): number | undefined {
  try {
    return Number(xdr.TransactionResult.fromXDR(resultXdr, "base64").feeCharged);
  } catch {
    return undefined;
  }
}
