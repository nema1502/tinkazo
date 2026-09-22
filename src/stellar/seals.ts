import type { xdr as XdrNs } from "@stellar/stellar-sdk";
import type { Proof } from "../protocol/proof";
import { RPC_URLS } from "./config";

/**
 * Los sellos de un organizador, leídos del contrato.
 *
 * Esto existe por el único ataque conocido que sigue abierto contra Tinkazo:
 * la **selección del compromiso**. Un organizador puede sellar la misma lista
 * cinco veces contra cinco rondas distintas y después publicar solo el
 * comprobante de la que le dio el resultado que quería. Cada uno de esos
 * sorteos es, por separado, perfectamente legítimo.
 *
 * La defensa siempre existió: todos los sellos son públicos bajo la dirección
 * del organizador. Pero dependía de que alguien supiera buscarlos en un
 * explorador de bloques, y eso no es una defensa, es una nota al pie. Acá se
 * traen y se muestran al lado del veredicto.
 *
 * La primera versión los buscaba en los eventos del RPC, que duran siete días,
 * así que un sello de hace un mes no aparecía. Ahora se leen de lo que guarda
 * el contrato (`sealsOnChain`), que no tiene ventana: están todos los que
 * siguen vivos. El mismo recorrido arma el historial de la cuenta en otro
 * equipo.
 */

const RPC: Record<string, string> = RPC_URLS;

async function rpc(url: string, method: string, params: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await res.json()) as { result?: Record<string, unknown>; error?: { message?: string } };
  if (body.error) throw new Error(body.error.message ?? "rpc-error");
  return body.result ?? {};
}

/**
 * Todos los sellos de quien selló este sorteo, del más nuevo al más viejo.
 *
 * Devuelve `null` si el sorteo no está anclado o si no se pudo preguntar. No
 * se inventa nada: sin respuesta del RPC, la página no afirma ni que hay uno
 * solo ni que hay varios.
 */
export async function sealsOf(proof: Proof): Promise<ChainHistory | null> {
  if (!proof.contract || !proof.net) return null;
  const url = RPC[proof.net];
  if (!url) return null;

  const { xdr, scValToNative } = await import("@stellar/stellar-sdk");
  // Primero hay que saber quién selló: el comprobante no lo trae.
  const organizer = await organizerOf(url, proof, xdr, scValToNative);
  if (!organizer) return null;
  return sealsOnChain(organizer, proof.contract, url);
}

/* --------------------------------------------- los sorteos, desde el contrato */

/**
 * Un sorteo tal como lo guarda el contrato. Sin nombres: la lista nunca sube a
 * la cadena, solo su huella. De los ganadores se sabe el puesto en la lista.
 */
export interface ChainRaffle {
  id: string;
  organizer: string;
  listHash: string;
  count: number;
  numWinners: number;
  round: number;
  /** Momento del sello, en segundos. */
  sealedAt: number;
  prize: string;
  drawn: boolean;
  /** Índices ganadores en la lista canónica, desde cero. Solo si ya se sorteó. */
  winners?: number[];
}

export interface ChainHistory {
  raffles: ChainRaffle[];
  /** No se recorrió el contrato entero: hay sorteos más viejos que no se miraron. */
  truncated: boolean;
}

/** Cuántas claves acepta el RPC en un solo `getLedgerEntries`. */
const KEYS_PER_CALL = 200;
/**
 * Cuántos sorteos del contrato se recorren como mucho, de los más nuevos para
 * atrás. Son diez viajes. El costo crece con los sorteos de todo el contrato,
 * no con los de la cuenta, así que hace falta un techo para que la página no
 * se cuelgue el día que haya decenas de miles.
 */
const SCAN_MAX = 2_000;

const hex = (b: Uint8Array | undefined): string =>
  [...(b ?? [])].map((x) => x.toString(16).padStart(2, "0")).join("");

/**
 * Pasa un `Raffle` del contrato, ya convertido a valores de JavaScript, a la
 * forma de acá. Devuelve `null` si le falta algo: mejor saltar una fila que
 * mostrarla inventada.
 */
export function parseRaffle(raw: unknown): ChainRaffle | null {
  const r = raw as {
    id?: bigint | number;
    organizer?: string;
    list_hash?: Uint8Array;
    count?: number;
    num_winners?: number;
    round?: bigint | number;
    sealed_at?: bigint | number;
    meta?: string;
    status?: unknown;
  } | null;
  if (!r || r.id === undefined || typeof r.organizer !== "string") return null;
  // Las variantes sin datos de un enum del contrato llegan como `["Drawn"]`.
  const status = Array.isArray(r.status) ? String(r.status[0]) : String(r.status ?? "");
  return {
    id: String(r.id),
    organizer: r.organizer,
    listHash: hex(r.list_hash),
    count: Number(r.count ?? 0),
    numWinners: Number(r.num_winners ?? 0),
    round: Number(r.round ?? 0),
    sealedAt: Number(r.sealed_at ?? 0),
    prize: String(r.meta ?? ""),
    drawn: status === "Drawn",
  };
}

/**
 * Todos los sorteos de una cuenta que siguen vivos en el contrato.
 *
 * Es lo que deja ver el historial desde otro equipo sin servidor. Los eventos
 * del RPC duran siete días; lo que el contrato guarda, no. Cada sello vive
 * bajo `Raffle(id)` con la cuenta que lo firmó, y los ids son correlativos
 * desde 1, así que se puede recorrer el contrato de atrás para adelante con
 * `getLedgerEntries`, que no tiene ventana de tiempo.
 *
 * Límite que hay que decir: una entrada que nadie extiende se archiva cuando
 * se le acaba el alquiler (120 días en mainnet) y deja de aparecer acá. El
 * sorteo no se pierde, pero para leerlo hay que restaurarlo.
 *
 * Devuelve `null` si no se pudo preguntar. Sin respuesta, no se afirma nada.
 */
export async function sealsOnChain(
  organizer: string,
  contractId: string,
  rpcUrl: string,
): Promise<ChainHistory | null> {
  try {
    const { xdr, scValToNative, Address } = await import("@stellar/stellar-sdk");
    const contract = new Address(contractId).toScAddress();
    const keyOf = (val: XdrNs.ScVal): string =>
      xdr.LedgerKey.contractData(
        new xdr.LedgerKeyContractData({ contract, key: val, durability: xdr.ContractDataDurability.persistent }),
      ).toXdr("base64");
    const entryKey = (variant: string, id: number): string =>
      keyOf(xdr.ScVal.scvVec([xdr.ScVal.scvSymbol(variant), xdr.ScVal.scvU64(BigInt(id))]));
    /** Los valores guardados bajo esas claves. Las que no existen no vuelven. */
    const read = async (keys: string[]): Promise<XdrNs.ScVal[]> => {
      const out: XdrNs.ScVal[] = [];
      for (let i = 0; i < keys.length; i += KEYS_PER_CALL) {
        const got = (await rpc(rpcUrl, "getLedgerEntries", { keys: keys.slice(i, i + KEYS_PER_CALL) })) as {
          entries?: { xdr?: string }[];
        };
        for (const e of got.entries ?? []) {
          if (!e.xdr) continue;
          const data = xdr.LedgerEntryData.fromXdr(e.xdr, "base64");
          if (data.type === "contractData") out.push(data.contractData.val);
        }
      }
      return out;
    };

    // El contador vive en el almacenamiento de la instancia, no en una entrada
    // propia: se lee la instancia y se busca `NextId` adentro.
    const [inst] = await read([keyOf(xdr.ScVal.scvLedgerKeyContractInstance())]);
    if (inst?.type !== "scvContractInstance") return null;
    let next = 1;
    for (const e of inst.instance.storage ?? []) {
      const k = scValToNative(e.key) as unknown;
      if (Array.isArray(k) && k[0] === "NextId") next = Number(scValToNative(e.val));
    }

    const last = next - 1;
    const first = Math.max(1, last - SCAN_MAX + 1);
    const ids: number[] = [];
    for (let id = last; id >= first; id--) ids.push(id);

    const mine = (await read(ids.map((id) => entryKey("Raffle", id))))
      .map((v) => parseRaffle(scValToNative(v)))
      .filter((r): r is ChainRaffle => r !== null && r.organizer === organizer);

    // Los ganadores se piden solo de los que ya se sortearon, y solo de esta
    // cuenta: el registro del resultado es otra entrada.
    const drawn = mine.filter((r) => r.drawn);
    if (drawn.length) {
      const byId = new Map(mine.map((r) => [r.id, r]));
      for (const v of await read(drawn.map((r) => entryKey("Draw", Number(r.id))))) {
        const d = scValToNative(v) as { raffle_id?: bigint | number; winners?: number[] } | null;
        const r = d?.raffle_id !== undefined ? byId.get(String(d.raffle_id)) : undefined;
        if (r && Array.isArray(d?.winners)) r.winners = d.winners.map(Number);
      }
    }

    mine.sort((a, b) => b.sealedAt - a.sealedAt);
    return { raffles: mine, truncated: first > 1 };
  } catch {
    return null;
  }
}

/** Quién selló este sorteo, leído del contrato. */
async function organizerOf(
  url: string,
  proof: Proof,
  xdrNs: typeof import("@stellar/stellar-sdk").xdr,
  toNative: typeof import("@stellar/stellar-sdk").scValToNative,
): Promise<string | null> {
  try {
    const { Contract, TransactionBuilder, BASE_FEE, Account, nativeToScVal, Networks } = await import(
      "@stellar/stellar-sdk"
    );
    const passphrase = proof.net === "mainnet" ? Networks.PUBLIC : Networks.TESTNET;
    // Una cuenta cualquiera: la simulación no firma ni gasta nada.
    const probe = new Account("GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF", "0");
    const tx = new TransactionBuilder(probe, { fee: BASE_FEE, networkPassphrase: passphrase })
      .addOperation(
        new Contract(proof.contract as string).call(
          "get_raffle",
          nativeToScVal(BigInt(proof.id ?? "0"), { type: "u64" }),
        ),
      )
      .setTimeout(30)
      .build();
    const sim = (await rpc(url, "simulateTransaction", { transaction: tx.toXDR() })) as {
      results?: { xdr?: string }[];
    };
    const retXdr = sim.results?.[0]?.xdr;
    if (!retXdr) return null;
    const value = toNative(xdrNs.ScVal.fromXDR(retXdr, "base64")) as { organizer?: string } | null;
    return value?.organizer ?? null;
  } catch {
    return null;
  }
}
