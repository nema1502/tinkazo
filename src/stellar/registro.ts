import type { xdr as XdrNs } from "@stellar/stellar-sdk";
import type { Registro, Resultado, Sello } from "../protocol/verificacion";
import type { ContratoOficial } from "./oficiales";

/**
 * Lo que guarda un contrato oficial sobre un sorteo, leído de la cadena tal cual.
 *
 * Una sola consulta (`getLedgerEntries`) trae, del mismo ledger, la instancia
 * del contrato (para saber qué `.wasm` corre y hasta qué número dio), el sello
 * (`Raffle(id)`) y el resultado (`Draw(id)`). No pasa por la interfaz que el
 * contrato declara de sí mismo ni simula llamadas: lee el almacenamiento con las
 * claves del contrato de Tinkazo. Antes la página bajaba el `.wasm` del contrato
 * que dijera el enlace y le creía lo que contestara.
 *
 * El SDK de Stellar se pide recién acá adentro, con `import()`: las páginas no lo
 * bajan al abrirse.
 */

/** Cuántas claves acepta el RPC en una consulta. */
const CLAVES_POR_CONSULTA = 200;

type Fetch = typeof fetch;

/** El registro leído no tiene la forma del de Tinkazo. */
export class RegistroDeforme extends Error {
  constructor(que: string) {
    super(`registro-deforme: ${que}`);
  }
}

const hex = (b: Uint8Array): string => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");

const bytes = (v: unknown, largo: number, que: string): string => {
  if (!(v instanceof Uint8Array) || v.length !== largo) throw new RegistroDeforme(que);
  return hex(v);
};

const entero = (v: unknown, que: string, max = Number.MAX_SAFE_INTEGER): number => {
  const n = typeof v === "bigint" ? (v <= BigInt(max) && v >= 0n ? Number(v) : NaN) : typeof v === "number" ? v : NaN;
  if (!Number.isSafeInteger(n) || n < 0 || n > max) throw new RegistroDeforme(que);
  return n;
};

const u64 = (v: unknown, que: string): string => {
  if (typeof v === "bigint" && v >= 0n) return v.toString();
  if (typeof v === "number" && Number.isSafeInteger(v) && v >= 0) return String(v);
  throw new RegistroDeforme(que);
};

const texto = (v: unknown, que: string): string => {
  if (typeof v === "string") return v;
  if (v instanceof Uint8Array) return new TextDecoder().decode(v);
  throw new RegistroDeforme(que);
};

/** Un `Raffle` del contrato, ya pasado a valores de JavaScript (`scValToNative`), a la forma de acá. */
export function selloDe(raw: unknown): Sello {
  if (!raw || typeof raw !== "object") throw new RegistroDeforme("sello");
  const r = raw as Record<string, unknown>;
  // Las variantes sin datos de un enum del contrato llegan como `["Drawn"]`.
  const estado = Array.isArray(r.status) && r.status.length === 1 ? r.status[0] : undefined;
  if (estado !== "Sealed" && estado !== "Drawn") throw new RegistroDeforme("estado");
  if (typeof r.organizer !== "string") throw new RegistroDeforme("organizador");
  return {
    id: u64(r.id, "id"),
    organizer: r.organizer,
    listHash: bytes(r.list_hash, 32, "huella"),
    count: entero(r.count, "cantidad", 0xffff_ffff),
    numWinners: entero(r.num_winners, "ganadores", 0xffff_ffff),
    round: entero(r.round, "ronda"),
    sealedAt: entero(r.sealed_at, "sellado"),
    meta: texto(r.meta, "premio"),
    drawn: estado === "Drawn",
  };
}

/** Un `Draw` del contrato, ya pasado a valores de JavaScript, a la forma de acá. */
export function resultadoDe(raw: unknown): Resultado {
  if (!raw || typeof raw !== "object") throw new RegistroDeforme("resultado");
  const d = raw as Record<string, unknown>;
  if (!Array.isArray(d.winners)) throw new RegistroDeforme("ganadores");
  return {
    raffleId: u64(d.raffle_id, "id"),
    round: entero(d.round, "ronda"),
    signature: bytes(d.signature, 48, "firma"),
    randomness: bytes(d.randomness, 32, "semilla"),
    winners: d.winners.map((w) => entero(w, "índice ganador", 0xffff_ffff)),
    drawnAt: entero(d.drawn_at, "sorteado"),
  };
}

/** Cuántas veces se pregunta antes de decir "no pude leer la cadena", y cuánto se espera entre una y otra. */
const INTENTOS = 3;
const ESPERA_MS = 1_200;

/**
 * Una consulta, con dos reintentos si la red o el RPC fallan (el RPC público
 * corta ráfagas: una verificación con los otros sellos son once consultas). Lo
 * que el RPC contestó bien no se reintenta.
 */
async function consultar(url: string, keys: string[], fetchFn: Fetch, esperaMs: number): Promise<{ key: string; xdr: string }[]> {
  let ultimo: unknown = null;
  for (let i = 0; i < INTENTOS; i++) {
    if (i) await new Promise((r) => setTimeout(r, esperaMs * i));
    try {
      return await consultarUnaVez(url, keys, fetchFn);
    } catch (e) {
      ultimo = e;
    }
  }
  throw ultimo instanceof Error ? ultimo : new Error("rpc-sin-respuesta");
}

async function consultarUnaVez(url: string, keys: string[], fetchFn: Fetch): Promise<{ key: string; xdr: string }[]> {
  const res = await fetchFn(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getLedgerEntries", params: { keys } }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`rpc ${res.status}`);
  const body = (await res.json()) as { result?: { entries?: unknown; latestLedger?: unknown }; error?: { message?: string } };
  if (body.error) throw new Error(body.error.message ?? "rpc-error");
  // Sin el número de ledger no es una respuesta: no se toma como "no hay nada".
  if (!body.result || typeof body.result.latestLedger !== "number") throw new Error("rpc-sin-respuesta");
  const entries = Array.isArray(body.result.entries) ? body.result.entries : [];
  return entries.filter(
    (e): e is { key: string; xdr: string } =>
      !!e && typeof (e as { key?: unknown }).key === "string" && typeof (e as { xdr?: unknown }).xdr === "string",
  );
}

/**
 * Los registros de varios sorteos de un mismo contrato oficial. Lanza si no se
 * pudo leer la cadena; un sorteo que no está vuelve con `sello: null`.
 */
export async function leerRegistros(
  contrato: ContratoOficial,
  ids: readonly string[],
  fetchFn: Fetch = fetch,
  esperaMs = ESPERA_MS,
): Promise<Map<string, Registro>> {
  const { xdr, Address, scValToNative } = await import("@stellar/stellar-sdk");
  const direccion = new Address(contrato.contractId).toScAddress();
  const clave = (val: XdrNs.ScVal): string =>
    xdr.LedgerKey.contractData(
      new xdr.LedgerKeyContractData({ contract: direccion, key: val, durability: xdr.ContractDataDurability.persistent }),
    ).toXdr("base64");
  const deSorteo = (variante: "Raffle" | "Draw", id: string): string =>
    clave(xdr.ScVal.scvVec([xdr.ScVal.scvSymbol(variante), xdr.ScVal.scvU64(BigInt(id))]));

  const unicos = [...new Set(ids)];
  const instancia = clave(xdr.ScVal.scvLedgerKeyContractInstance());
  const claves = [instancia, ...unicos.flatMap((id) => [deSorteo("Raffle", id), deSorteo("Draw", id)])];
  const pedidas = new Set(claves);
  const valores = new Map<string, XdrNs.ScVal>();
  for (let i = 0; i < claves.length; i += CLAVES_POR_CONSULTA) {
    for (const e of await consultar(contrato.rpcUrl, claves.slice(i, i + CLAVES_POR_CONSULTA), fetchFn, esperaMs)) {
      const data = xdr.LedgerEntryData.fromXdr(e.xdr, "base64");
      if (data.type !== "contractData") throw new RegistroDeforme("entrada");
      // La entrada dice de qué contrato, con qué clave y de qué duración es: tiene
      // que ser exactamente la que se pidió. Un RPC que contestara con la de otro
      // contrato bajo nuestra clave no pasa (uno que invente los datos, sí: para
      // eso no hay remedio con una sola fuente).
      const suya = xdr.LedgerKey.contractData(
        new xdr.LedgerKeyContractData({
          contract: data.contractData.contract,
          key: data.contractData.key,
          durability: data.contractData.durability,
        }),
      ).toXdr("base64");
      if (suya !== e.key || !pedidas.has(e.key)) throw new RegistroDeforme("clave");
      if (valores.has(e.key)) throw new RegistroDeforme("repetida");
      valores.set(e.key, data.contractData.val);
    }
  }

  // La instancia: qué código corre y hasta qué número dio.
  let wasm: string | null = null;
  let siguiente: number | null = null;
  const inst = valores.get(instancia);
  if (inst) {
    if (inst.type !== "scvContractInstance") throw new RegistroDeforme("instancia");
    const ejecutable = inst.instance.executable;
    // Un contrato de un activo (SAC) no corre ningún .wasm: no es el de Tinkazo.
    wasm = ejecutable.type === "contractExecutableWasm" ? hex(ejecutable.wasmHash.value) : ejecutable.type;
  }
  // Lo que guarda un contrato que no corre el código de Tinkazo no se lee: no
  // tiene por qué tener esta forma, y no vale nada aunque la tenga.
  const nuestro = wasm === contrato.wasmSha256;
  if (inst?.type === "scvContractInstance" && nuestro) {
    // El contador vive en el almacenamiento de la instancia; sin sorteos todavía, no está.
    siguiente = 1;
    for (const e of inst.instance.storage ?? []) {
      const k = scValToNative(e.key) as unknown;
      if (Array.isArray(k) && k[0] === "NextId") siguiente = entero(scValToNative(e.val), "siguiente");
    }
  }

  const out = new Map<string, Registro>();
  for (const id of unicos) {
    const s = nuestro ? valores.get(deSorteo("Raffle", id)) : undefined;
    const d = nuestro ? valores.get(deSorteo("Draw", id)) : undefined;
    out.set(id, {
      wasm,
      siguiente: nuestro ? siguiente : null,
      sello: s ? selloDe(scValToNative(s)) : null,
      resultado: d ? resultadoDe(scValToNative(d)) : null,
    });
  }
  return out;
}

/** El registro de un sorteo. Lanza si no se pudo leer la cadena. */
export async function leerRegistro(contrato: ContratoOficial, id: string, fetchFn: Fetch = fetch, esperaMs = ESPERA_MS): Promise<Registro> {
  const r = (await leerRegistros(contrato, [id], fetchFn, esperaMs)).get(id);
  if (!r) throw new Error("registro-sin-respuesta");
  return r;
}
