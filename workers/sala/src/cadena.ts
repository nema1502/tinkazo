/**
 * Lee el sello y el resultado de un sorteo del contrato oficial de Tinkazo con
 * `getLedgerEntries`, como `src/stellar/registro.ts`, pero con
 * `@stellar/stellar-sdk/base`: el SDK entero no se carga en un Worker.
 * La instancia, `Raffle(id)` y `Draw(id)` llegan en la misma consulta y del
 * mismo ledger. Nada de esto corre dentro del objeto persistente.
 */
import { Address, scValToNative, xdr } from "@stellar/stellar-sdk/base";
import type { xdr as XdrNs } from "@stellar/stellar-sdk/base";
import deployments from "../../../src/stellar/deployments.json";
import { esCuentaValida } from "./logica";

export interface SelloEnLaRed {
  listHash: string;
  count: number;
  numWinners: number;
  sorteado: boolean;
  /** La cuenta que selló, tal como la guarda el contrato. Null si el sello no la trae en una forma que se entienda. */
  organizador: string | null;
  /** La ronda de drand que decide el sorteo. La sala solo acepta el sello si esa ronda todavía no salió. */
  ronda: number;
}

export interface SorteoEnLaRed {
  sello: SelloEnLaRed | null;
  ganadores: number[] | null;
}

interface EntradaRpc {
  key: string;
  xdr: string;
}

const hexadecimal = (bytes: Uint8Array): string => {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
};

function entero(valor: unknown): number {
  const numero = typeof valor === "bigint" && valor >= 0n && valor <= BigInt(0xffff_ffff) ? Number(valor) : valor;
  if (typeof numero !== "number" || !Number.isSafeInteger(numero) || numero < 0 || numero > 0xffff_ffff) {
    throw new Error("entero fuera de forma");
  }
  return numero;
}

/** Un número de ronda (`u64` del contrato) que entra en un entero seguro y es de una ronda que existe (la primera es 1). */
function ronda(valor: unknown): number {
  const tope = BigInt(Number.MAX_SAFE_INTEGER);
  const numero = typeof valor === "bigint" && valor >= 1n && valor <= tope ? Number(valor) : valor;
  if (typeof numero !== "number" || !Number.isSafeInteger(numero) || numero < 1) throw new Error("ronda fuera de forma");
  return numero;
}

/** Un `Raffle` ya convertido por `scValToNative`, con solo lo que necesita la sala. */
export function selloDeLaRed(raw: unknown): SelloEnLaRed {
  if (!raw || typeof raw !== "object") throw new Error("sello fuera de forma");
  const r = raw as Record<string, unknown>;
  if (!(r.list_hash instanceof Uint8Array) || r.list_hash.length !== 32) {
    throw new Error("huella fuera de forma");
  }
  const estados = Array.isArray(r.status) ? (r.status as unknown[]) : [];
  const estado = estados.length === 1 ? estados[0] : undefined;
  if (estado !== "Sealed" && estado !== "Drawn") throw new Error("estado fuera de forma");
  return {
    listHash: hexadecimal(r.list_hash),
    count: entero(r.count),
    numWinners: entero(r.num_winners),
    sorteado: estado === "Drawn",
    // Una dirección que no es de cuenta (o no es texto) queda en null: nunca coincide con la que firmó la campaña.
    organizador: esCuentaValida(r.organizer) ? r.organizer : null,
    // Sin una ronda legible no hay con qué saber si la semilla ya existe: el sello no se entiende y no comprueba nada.
    ronda: ronda(r.round),
  };
}

/** Un `Draw` ya convertido por `scValToNative`: los puestos son índices de la lista sellada. */
export function ganadoresDeLaRed(raw: unknown): number[] {
  if (!raw || typeof raw !== "object") throw new Error("resultado fuera de forma");
  const winners = (raw as Record<string, unknown>).winners;
  if (!Array.isArray(winners)) throw new Error("ganadores fuera de forma");
  return (winners as unknown[]).map((indice) => entero(indice));
}

/** Una consulta a un RPC. Una respuesta mal formada es un intento fallido, nunca una ausencia de datos. */
async function consultar(url: string, claves: readonly string[], f: typeof fetch): Promise<EntradaRpc[]> {
  const respuesta = await f(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getLedgerEntries", params: { keys: claves } }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!respuesta.ok) throw new Error("rpc sin respuesta");
  const cuerpo = (await respuesta.json()) as {
    result?: { entries?: unknown; latestLedger?: unknown };
    error?: unknown;
  };
  if (cuerpo.error !== undefined || !cuerpo.result || typeof cuerpo.result.latestLedger !== "number") {
    throw new Error("respuesta fuera de forma");
  }
  const crudas = cuerpo.result.entries;
  if (crudas !== undefined && crudas !== null && !Array.isArray(crudas)) {
    throw new Error("entradas fuera de forma");
  }
  const entradas: unknown[] = Array.isArray(crudas) ? crudas : [];
  return entradas.map((entrada) => {
    if (!entrada || typeof entrada !== "object") throw new Error("entrada fuera de forma");
    const e = entrada as Record<string, unknown>;
    if (typeof e.key !== "string" || typeof e.xdr !== "string") throw new Error("entrada fuera de forma");
    return { key: e.key, xdr: e.xdr };
  });
}

/**
 * Lee un sorteo en el contrato vigente de la red indicada. Prueba los RPC en
 * orden, con diez segundos por intento. `red` significa que no se pudo comprobar
 * la respuesta; un sorteo ausente, en cambio, vuelve con sus campos en null.
 */
export async function leerSorteoEnLaRed(
  red: "mainnet" | "testnet",
  id: string,
  rpcs: readonly string[],
  f: typeof fetch,
): Promise<SorteoEnLaRed | "red"> {
  const contrato = deployments[red];
  if (!contrato.contractId || !contrato.wasmSha256) return "red";
  try {
    const direccion = new Address(contrato.contractId).toScAddress();
    const clave = (valor: XdrNs.ScVal): string => {
      return xdr.LedgerKey.contractData(
        new xdr.LedgerKeyContractData({
          contract: direccion,
          key: valor,
          durability: xdr.ContractDataDurability.persistent,
        }),
      ).toXdr("base64");
    };
    const deSorteo = (variante: "Raffle" | "Draw"): string => {
      return clave(xdr.ScVal.scvVec([xdr.ScVal.scvSymbol(variante), xdr.ScVal.scvU64(BigInt(id))]));
    };
    const instancia = clave(xdr.ScVal.scvLedgerKeyContractInstance());
    const claveSello = deSorteo("Raffle");
    const claveResultado = deSorteo("Draw");
    const claves = [instancia, claveSello, claveResultado];
    const pedidas = new Set(claves);
    let entradas: EntradaRpc[] | null = null;
    for (const rpc of rpcs) {
      try {
        entradas = await consultar(rpc, claves, f);
        break;
      } catch {
        // Un corte, un tope de tiempo o una respuesta incomprensible se prueba con el RPC siguiente.
      }
    }
    if (entradas === null) return "red";

    const valores = new Map<string, XdrNs.ScVal>();
    for (const entrada of entradas) {
      const data = xdr.LedgerEntryData.fromXdr(entrada.xdr, "base64");
      if (data.type !== "contractData") return "red";
      // La entrada misma identifica su contrato, clave y duración. Así no pasa
      // una entrada de otro contrato presentada bajo una de las claves pedidas.
      const suya = xdr.LedgerKey.contractData(
        new xdr.LedgerKeyContractData({
          contract: data.contractData.contract,
          key: data.contractData.key,
          durability: data.contractData.durability,
        }),
      ).toXdr("base64");
      if (suya !== entrada.key || !pedidas.has(entrada.key) || valores.has(entrada.key)) return "red";
      valores.set(entrada.key, data.contractData.val);
    }

    const inst = valores.get(instancia);
    if (!inst || inst.type !== "scvContractInstance") return "red";
    const ejecutable = inst.instance.executable;
    if (ejecutable.type !== "contractExecutableWasm") return "red";
    if (hexadecimal(ejecutable.wasmHash.value) !== contrato.wasmSha256) return "red";
    const valorSello = valores.get(claveSello);
    const valorResultado = valores.get(claveResultado);
    return {
      sello: valorSello ? selloDeLaRed(scValToNative(valorSello)) : null,
      ganadores: valorResultado ? ganadoresDeLaRed(scValToNative(valorResultado)) : null,
    };
  } catch {
    // Una dirección, un número, un XDR o un valor que no se entiende no comprueba nada.
    return "red";
  }
}
