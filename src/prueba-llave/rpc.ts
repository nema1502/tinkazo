import { StrKey, TransactionBuilder, rpc, xdr } from "@stellar/stellar-sdk";
import type { RespuestaConsulta, RespuestaEnvio } from "../stellar/envio";
import type { RespuestaCruda } from "./cobro";
import { RED_DE_PRUEBA } from "./red";

/**
 * Lo que la prueba le pide a la red de prueba. Todo sale por un solo RPC. Los pedidos sueltos (mandar, preguntar, leer una
 * cuenta) son JSON-RPC con un `fetch` que se puede cambiar en las pruebas, como en `workers/patrocinio/src/red.ts`. La
 * simulación y el ensamblado usan el SDK, que sabe leer lo que contesta.
 */

/** Lo que importa de una simulación. */
export interface ResultadoDeSimulacion {
  ok: boolean;
  /** Las entradas de autorización que registró la simulación, en base64. */
  authB64: string[];
  latestLedger: number;
  /** Lo que devolvería la llamada, en base64. */
  retornoB64?: string;
  error?: string;
  /** Hay entradas archivadas que restaurar antes: la prueba no sigue. */
  restaurar?: boolean;
  /** La respuesta del SDK, para ensamblar. */
  simulacion: unknown;
}

/** La parte del servidor del SDK que usamos: así una prueba pone el suyo. */
export interface ServidorDeSimulacion {
  simulateTransaction(tx: ReturnType<typeof TransactionBuilder.fromXDR>): Promise<unknown>;
}

export interface OpcionesDeRpc {
  fetchFn?: typeof fetch;
  servidor?: ServidorDeSimulacion;
  /** Cuánto se espera cada pedido, en milisegundos. */
  topeMs?: number;
}

/** El número de un error del contrato que viene en el texto de una simulación (`Error(Contract, #5)`), o `null`. */
export function codigoDeContrato(error: string | undefined): number | null {
  const m = error ? /Error\(Contract, #(\d+)\)/.exec(error) : null;
  return m ? Number(m[1]) : null;
}

/** El nombre del resultado que dio la red al rechazar una transacción: `txBadSeq`, `txInsufficientBalance`... */
export function codigoDelRechazo(resultXdr: string | undefined): string | undefined {
  if (!resultXdr) return undefined;
  try {
    const r = xdr.TransactionResult.fromXDR(resultXdr, "base64");
    const afuera = r.result.type;
    if (afuera === "txFailed") {
      const op = (r.result.value as unknown as Array<{ type: string }>)[0]?.type;
      return op ? `${afuera}/${op}` : afuera;
    }
    return afuera;
  } catch {
    return undefined;
  }
}

export class RpcDePrueba {
  private readonly fetchFn: typeof fetch;
  private readonly servidor: ServidorDeSimulacion;
  private readonly topeMs: number;

  constructor(o: OpcionesDeRpc = {}) {
    this.fetchFn = o.fetchFn ?? ((...a) => fetch(...a));
    this.servidor = o.servidor ?? (new rpc.Server(RED_DE_PRUEBA.rpc) as unknown as ServidorDeSimulacion);
    this.topeMs = o.topeMs ?? 10_000;
  }

  private async llamar<T>(metodo: string, params: unknown): Promise<T> {
    const res = await this.fetchFn(RED_DE_PRUEBA.rpc, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: metodo, params }),
      signal: AbortSignal.timeout(this.topeMs),
    });
    if (!res.ok) throw new Error(`rpc ${res.status}`);
    const j = (await res.json()) as { result?: T; error?: { code?: number; message?: string } };
    if (j.error) throw new Error(`rpc ${j.error.code ?? ""} ${j.error.message ?? ""}`.trim());
    return j.result as T;
  }

  /** El ledger más reciente que conoce el RPC. */
  async ledgerActual(): Promise<number> {
    const r = await this.llamar<{ sequence: number }>("getLatestLedger", {});
    return Number(r.sequence);
  }

  /** La secuencia de una cuenta, o `null` si todavía no existe. */
  async secuencia(cuenta: string): Promise<string | null> {
    const clave = xdr.LedgerKey.account(new xdr.LedgerKeyAccount({ accountId: xdr.PublicKey.publicKeyTypeEd25519(new xdr.Uint256Bytes(StrKey.decodeEd25519PublicKey(cuenta))) }));
    const r = await this.llamar<{ entries?: Array<{ xdr: string }> | null }>("getLedgerEntries", { keys: [clave.toXDR("base64")] });
    const e = r.entries?.[0];
    if (!e) return null;
    const datos = xdr.LedgerEntryData.fromXDR(e.xdr, "base64");
    if (datos.type !== "account") return null;
    return String(datos.value.seqNum);
  }

  /** Simula una transacción. Con entradas de autorización en la operación, el RPC las exige. */
  async simular(txXdr: string): Promise<ResultadoDeSimulacion> {
    const tx = TransactionBuilder.fromXDR(txXdr, RED_DE_PRUEBA.passphrase);
    const sim = (await this.servidor.simulateTransaction(tx)) as rpc.Api.SimulateTransactionResponse;
    if (rpc.Api.isSimulationError(sim)) return { ok: false, authB64: [], latestLedger: Number(sim.latestLedger), error: sim.error, simulacion: sim };
    if (rpc.Api.isSimulationRestore(sim)) return { ok: false, authB64: [], latestLedger: Number(sim.latestLedger), error: "restaurar", restaurar: true, simulacion: sim };
    const r = sim.result;
    return {
      ok: true,
      authB64: (r?.auth ?? []).map((a) => a.toXDR("base64")),
      latestLedger: Number(sim.latestLedger),
      ...(r?.retval ? { retornoB64: r.retval.toXDR("base64") } : {}),
      simulacion: sim,
    };
  }

  /** La transacción lista para firmar y mandar: con los recursos y la comisión que calculó la simulación. */
  ensamblar(txXdr: string, simulacion: unknown): string {
    const tx = TransactionBuilder.fromXDR(txXdr, RED_DE_PRUEBA.passphrase);
    return rpc.assembleTransaction(tx, simulacion as rpc.Api.SimulateTransactionResponse).build().toXDR();
  }

  /** Manda una transacción ya firmada. */
  async enviar(txB64: string): Promise<RespuestaEnvio> {
    const r = await this.llamar<{ status: string; errorResultXdr?: string }>("sendTransaction", { transaction: txB64 });
    const status = r.status === "PENDING" || r.status === "DUPLICATE" || r.status === "TRY_AGAIN_LATER" ? r.status : "ERROR";
    const codigo = status === "ERROR" ? codigoDelRechazo(r.errorResultXdr) : undefined;
    return { status, ...(codigo ? { codigo } : {}) };
  }

  /** La respuesta cruda de `getTransaction`, con lo que hace falta para leer el cobro, y la hora de cierre del último ledger. */
  async consultarCruda(hash: string): Promise<RespuestaCruda & { latestLedgerCloseTime?: number | string }> {
    const r = await this.llamar<RespuestaCruda & { latestLedgerCloseTime?: number | string }>("getTransaction", { hash });
    return { ...r, hash };
  }

  /** Lo que pide `enviarYConfirmar`: el estado y la hora de la red. El valor que devolvió la llamada va decodificado. */
  async consultar(hash: string, decodificar?: (c: RespuestaCruda) => unknown): Promise<RespuestaConsulta> {
    const c = await this.consultarCruda(hash);
    const status = c.status === "SUCCESS" || c.status === "FAILED" ? c.status : "NOT_FOUND";
    const cierre = Number(c.latestLedgerCloseTime);
    return { status, cierre: Number.isFinite(cierre) ? cierre : Number.NaN, ...(status === "SUCCESS" && decodificar ? { valor: decodificar(c) } : {}) };
  }
}
