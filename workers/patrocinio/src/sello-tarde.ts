/**
 * Si un sello que entró a un ledger y falló lo rechazó el contrato por la ronda muy cerca (`RoundTooSoon`, el error 5),
 * comprobado con lo que guardó la red y nunca con lo que diga la página.
 *
 * Es el caso del 13 de noviembre de 2026 en la red principal: la firma de la cuenta de Google tardó medio minuto, el
 * sello entró a un ledger con 25 s por delante (el contrato pide 30) y el portero contó como gastado el único sorteo
 * oficial de la cuenta. Con esta prueba el portero lo devuelve (`Cupos.devolverSelloTardio`).
 *
 * La prueba sale toda de la consulta del portero a su RPC (`getTransaction` por el hash interno, `red.ts`):
 *
 * 1. la transacción entró y falló (`FAILED`);
 * 2. el sobre que guardó la red es el de ese hash (el fee-bump del portero, o la transacción sola) y su única operación
 *    es un `seal` del contrato oficial, del que se lee la ronda (el argumento 4);
 * 3. el resultado es la operación atrapada (`invokeHostFunctionTrapped`): el contrato devolvió un error, no faltaron
 *    recursos ni había entradas archivadas;
 * 4. la ronda nace menos de 30 s después del cierre del ledger en que entró (`createdAt`), que es la hora con que el
 *    contrato compara (`env.ledger().timestamp()`);
 * 5. si el RPC trae eventos de diagnóstico y alguno nombra otro error del contrato, no.
 *
 * Con 4 cumplido, el contrato tuvo que devolver `RoundTooSoon`: lo que mira antes (la cantidad de la lista, los
 * ganadores y el largo del texto) depende solo de los argumentos, que la simulación del portero ya había aceptado, y la
 * autorización es la de la cuenta de origen (`lista-blanca.ts`), que firmó la transacción.
 */
import { TransactionBuilder, StrKey, xdr, type FeeBumpTransaction, type Transaction } from "@stellar/stellar-sdk/base";
import type { Consulta } from "./red";

/** El génesis y el período de drand quicknet (`src/protocol/quicknet.ts`, `contracts/raffle/src/drand.rs`). */
export const GENESIS_QUICKNET_S = 1_692_803_367;
export const PERIODO_QUICKNET_S = 3;
/** Lo que pide el contrato entre el ledger del sello y su ronda (`MIN_LEAD_SECS`, `contracts/raffle/src/lib.rs`). */
export const MARGEN_DEL_CONTRATO_S = 30;
/** El número de `Error::RoundTooSoon` en el contrato. Es ABI: no cambia. */
export const CODIGO_RONDA_MUY_CERCA = 5;

/** El instante (Unix, segundos) en que nace una ronda de quicknet. */
export function horaDeLaRonda(ronda: number): number {
  return GENESIS_QUICKNET_S + (Math.max(1, ronda) - 1) * PERIODO_QUICKNET_S;
}

/** Por qué un sello fallido no se devuelve. Nombres fijos, para el registro del portero. */
export type SinDevolucion = "no-fallo" | "sin-datos" | "otro-sobre" | "no-es-sello" | "otra-falla" | "otro-error" | "a-tiempo";

export type Tarde = { ok: true; ronda: number; cierreS: number; faltaban: number } | { ok: false; motivo: SinDevolucion };

const no = (motivo: SinDevolucion): Tarde => ({ ok: false, motivo });

/** Los bytes de un valor del XDR nuevo, que guarda su contenido en `.value` o es el propio arreglo. */
function bytesDe(v: unknown): Uint8Array | null {
  if (v instanceof Uint8Array) return v;
  if (v && typeof v === "object" && "value" in v && (v as { value: unknown }).value instanceof Uint8Array) return (v as { value: Uint8Array }).value;
  return null;
}

function hex(b: ArrayLike<number>): string {
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

function iguales(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * La ronda del `seal` del contrato oficial que lleva el sobre, si el sobre es el de `hash` (el de la transacción interna
 * o el del fee-bump). `"otro-sobre"` si el hash no coincide, `"no-es-sello"` si no es un `seal` del contrato oficial.
 */
function rondaDelSobre(hash: string, sobre: string, o: { passphrase: string; contractId: string }): number | "otro-sobre" | "no-es-sello" {
  const leida = TransactionBuilder.fromXDR(sobre, o.passphrase) as Transaction | FeeBumpTransaction;
  const interna = "innerTransaction" in leida ? leida.innerTransaction : leida;
  const hashes = [hex(interna.hash()), hex(leida.hash())];
  if (!hashes.includes(hash.toLowerCase())) return "otro-sobre";
  const env = xdr.TransactionEnvelope.fromXDR(sobre, "base64");
  const t = env.type === "envelopeTypeTxFeeBump" ? env.value.tx.innerTx.value.tx : env.type === "envelopeTypeTx" ? env.value.tx : null;
  if (!t || t.operations.length !== 1) return "no-es-sello";
  const op = t.operations[0];
  if (!op || op.body.type !== "invokeHostFunction") return "no-es-sello";
  const fn = op.body.value.hostFunction;
  if (fn.type !== "hostFunctionTypeInvokeContract") return "no-es-sello";
  const llamada = fn.value;
  if (llamada.contractAddress.type !== "scAddressTypeContract") return "no-es-sello";
  const direccion = bytesDe(llamada.contractAddress.value);
  if (!direccion || !iguales(direccion, StrKey.decodeContract(o.contractId))) return "no-es-sello";
  if (String(llamada.functionName) !== "seal" || llamada.args.length !== 6) return "no-es-sello";
  const r = llamada.args[4];
  if (!r || r.type !== "scvU64") return "no-es-sello";
  const v = r.value as unknown;
  const ronda = typeof v === "bigint" ? v : BigInt(String(v));
  if (ronda < 1n || ronda > BigInt(Number.MAX_SAFE_INTEGER)) return "no-es-sello";
  return Number(ronda);
}

/** El resultado dice que la única operación quedó atrapada: el contrato devolvió un error (o entró en pánico). */
function atrapada(resultado: string): boolean {
  const r = xdr.TransactionResult.fromXDR(resultado, "base64");
  const fuera = r.result;
  const ops = fuera.type === "txFeeBumpInnerFailed" ? (fuera.value.result.result.type === "txFailed" ? fuera.value.result.result.value : null) : fuera.type === "txFailed" ? fuera.value : null;
  if (!ops || ops.length !== 1) return false;
  const op = ops[0];
  return !!op && op.type === "opInner" && op.value.type === "invokeHostFunction" && op.value.value.type === "invokeHostFunctionTrapped";
}

/** Si algún evento de diagnóstico nombra un error del contrato que no es el de la ronda muy cerca. Lo que no se lee no cuenta. */
function nombraOtroError(diagnosticos: readonly string[]): boolean {
  for (const d of diagnosticos) {
    let topicos: readonly xdr.ScVal[];
    try {
      const e = xdr.DiagnosticEvent.fromXDR(d, "base64");
      topicos = e.event.body.value.topics;
    } catch {
      continue;
    }
    for (const t of topicos) {
      if (t.type === "scvError" && t.value.type === "sceContract" && t.value.contractCode !== CODIGO_RONDA_MUY_CERCA) return true;
    }
  }
  return false;
}

/**
 * Si el sello de `hash` entró a un ledger y el contrato lo rechazó por la ronda muy cerca, con la ronda, la hora de
 * cierre de su ledger y cuántos segundos le faltaban a la ronda (menos de 30, o negativo si ya había nacido). Si no se
 * puede comprobar con lo que trae la consulta, no: ante la duda no se devuelve nada.
 */
export function selloQueEntroTarde(hash: string, c: Consulta, o: { passphrase: string; contractId: string }): Tarde {
  if (c.status !== "FAILED") return no("no-fallo");
  if (!c.sobre || !c.resultado || typeof c.cierreS !== "number" || !Number.isFinite(c.cierreS) || c.cierreS <= 0) return no("sin-datos");
  let ronda: number | "otro-sobre" | "no-es-sello";
  let quedoAtrapada: boolean;
  try {
    ronda = rondaDelSobre(hash, c.sobre, o);
    quedoAtrapada = atrapada(c.resultado);
  } catch {
    return no("sin-datos");
  }
  if (typeof ronda !== "number") return no(ronda);
  if (!quedoAtrapada) return no("otra-falla");
  if (c.diagnosticos?.length && nombraOtroError(c.diagnosticos)) return no("otro-error");
  const faltaban = horaDeLaRonda(ronda) - Math.floor(c.cierreS);
  if (faltaban >= MARGEN_DEL_CONTRATO_S) return no("a-tiempo");
  return { ok: true, ronda, cierreS: Math.floor(c.cierreS), faltaban };
}
