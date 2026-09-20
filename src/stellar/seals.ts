import type { Proof } from "../protocol/proof";

/**
 * Los otros sellos del mismo organizador.
 *
 * Esto existe por el único ataque conocido que sigue abierto contra Tinkazo:
 * la **selección del compromiso**. Un organizador puede sellar cinco listas
 * distintas contra cinco rondas distintas y después publicar solo el
 * comprobante de la que le dio el resultado que quería. Cada uno de esos
 * sorteos es, por separado, perfectamente legítimo.
 *
 * La defensa siempre existió: todos los sellos son públicos bajo la dirección
 * del organizador. Pero dependía de que alguien supiera buscarlos en un
 * explorador de bloques, y eso no es una defensa, es una nota al pie. Acá se
 * traen y se muestran al lado del veredicto.
 *
 * Límite que hay que decir: el RPC guarda siete días de eventos, no más. El
 * ataque ocurre cerca en el tiempo del sorteo que se publica, así que la
 * ventana alcanza; auditar el historial completo de una dirección no se puede
 * por acá, y para eso está el explorador de bloques.
 */

/**
 * Cuántos ledgers hacia atrás se pregunta.
 *
 * El RPC guarda 120 960 ledgers, que a cinco segundos cada uno son siete días.
 * Se pide casi todo, dejando margen porque la ventana se corre entre una
 * llamada y la siguiente y pedir el borde exacto da error.
 *
 * Cuesta siempre lo mismo: el RPC escanea como mucho diez mil ledgers por
 * llamada, así que son trece viajes, encuentre o no encuentre algo.
 */
const LOOKBACK = 119_000;
/** Cuántos ledgers barre el RPC en una sola llamada. */
const SCAN = 10_000;

export interface Seal {
  raffleId: string;
  /** Cuántas personas tenía esa lista. */
  count: number;
  round: number;
  listHash: string;
  at: string;
  txHash: string;
}

export interface SealsResult {
  seals: Seal[];
  /** Desde qué momento se pudo mirar. Antes de eso el RPC ya no indexa. */
  since: string;
  /** El RPC cortó la lista: hay más de los que se muestran. */
  truncated: boolean;
}

const RPC: Record<string, string> = {
  mainnet: "https://mainnet.sorobanrpc.com",
  testnet: "https://soroban-testnet.stellar.org",
};

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
 * Trae los sellos recientes de quien selló este sorteo.
 *
 * Devuelve `null` si el sorteo no está anclado o si no se pudo preguntar. No
 * se inventa nada: sin respuesta del RPC, la página no afirma ni que hay uno
 * solo ni que hay varios.
 */
export async function recentSealsOf(proof: Proof): Promise<SealsResult | null> {
  if (!proof.contract || !proof.net) return null;
  const url = RPC[proof.net];
  if (!url) return null;

  const { xdr, scValToNative, Address } = await import("@stellar/stellar-sdk");

  // Primero hay que saber quién selló: el comprobante no lo trae.
  const organizer = await organizerOf(url, proof, xdr, scValToNative);
  if (!organizer) return null;

  const health = (await rpc(url, "getHealth", {})) as { latestLedger?: number };
  const latest = Number(health.latestLedger ?? 0);
  if (!latest) return null;
  const startLedger = Math.max(1, latest - LOOKBACK);

  const addressTopic = new Address(organizer).toScVal().toXDR("base64");
  const filters = [
    {
      type: "contract",
      contractIds: [proof.contract],
      // El evento de sello lleva el nombre, el identificador y la dirección
      // como temas. El comodín en el segundo deja pasar cualquier sorteo de
      // esta misma dirección.
      topics: [["*", "*", addressTopic]],
    },
  ];

  // El RPC barre como mucho diez mil ledgers por llamada, así que la semana
  // entera son trece viajes. Se sigue el cursor hasta el final o hasta que se
  // junten doscientos sellos, que es más de lo que nadie va a mirar.
  const list: unknown[] = [];
  let cursor: string | undefined;
  for (let trip = 0; trip < Math.ceil(LOOKBACK / SCAN) + 1 && list.length < 200; trip++) {
    const page = (await rpc(url, "getEvents", {
      ...(cursor ? {} : { startLedger }),
      filters,
      pagination: cursor ? { cursor, limit: 200 } : { limit: 200 },
    })) as { events?: unknown[]; cursor?: string };
    const got = Array.isArray(page.events) ? page.events : [];
    list.push(...got);
    if (!page.cursor) break;
    cursor = page.cursor;
  }
  const seals: Seal[] = [];
  for (const raw of list) {
    const e = raw as {
      topic?: string[];
      value?: string;
      ledgerClosedAt?: string;
      txHash?: string;
    };
    try {
      const name = scValToNative(xdr.ScVal.fromXDR(e.topic?.[0] ?? "", "base64")) as unknown;
      if (String(name) !== "sealed") continue;
      const id = scValToNative(xdr.ScVal.fromXDR(e.topic?.[1] ?? "", "base64")) as bigint | number;
      const body = scValToNative(xdr.ScVal.fromXDR(e.value ?? "", "base64")) as {
        count?: number;
        round?: bigint | number;
        list_hash?: Uint8Array;
      };
      seals.push({
        raffleId: String(id),
        count: Number(body.count ?? 0),
        round: Number(body.round ?? 0),
        listHash: [...(body.list_hash ?? [])].map((b) => b.toString(16).padStart(2, "0")).join(""),
        at: e.ledgerClosedAt ?? "",
        txHash: e.txHash ?? "",
      });
    } catch {
      // Un evento que no se puede leer se salta: mejor mostrar de menos que
      // afirmar de más.
    }
  }
  seals.sort((a, b) => a.at.localeCompare(b.at));

  const since = seals[0]?.at ?? "";
  return { seals, since, truncated: list.length >= 200 };
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
