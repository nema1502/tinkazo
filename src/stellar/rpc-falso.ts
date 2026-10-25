/**
 * Un RPC de Stellar de mentira, solo para las pruebas.
 *
 * Contesta `getLedgerEntries` con el estado de contratos inventados: la
 * instancia con su contador (`NextId`), los `Raffle(id)` y los `Draw(id)`. Las
 * claves que llegan y las entradas que salen son XDR de verdad, armado y leído
 * con el mismo SDK que usa el sitio: así la prueba ejercita las claves que
 * `seals.ts` arma a mano y no una copia de su lógica. No sale nada de la
 * máquina: se instala con `vi.stubGlobal("fetch", rpc.fetch)`.
 *
 * Anota qué se pidió (`pedidos`) para poder afirmar que un contrato anterior no
 * se lee más allá de su `ultimoId`.
 */
import { Address, scValToNative, xdr } from "@stellar/stellar-sdk";

export interface SelloFalso {
  id: number;
  organizer: string;
  /** Momento del sello, en segundos. */
  sealedAt: number;
  /** Huella en hex de 64 caracteres. Por defecto una distinta por contrato y por número. */
  listHash?: string;
  count?: number;
  round?: number;
  prize?: string;
  /** Puestos ganadores: si están, el sorteo figura como sorteado y existe su `Draw(id)`. */
  winners?: number[];
}

export interface ContratoFalso {
  contractId: string;
  /** El contador del contrato: el número del próximo sorteo. Puede pasar del último sello guardado. */
  nextId: number;
  sellos: SelloFalso[];
  /** La instancia no está (nadie la extendió y se archivó): el RPC no la devuelve. */
  sinInstancia?: boolean;
  /** El RPC no contesta cuando se le pregunta por este contrato. */
  falla?: boolean;
}

export interface PedidosAlRpc {
  /** Cuántas veces se llamó a `getLedgerEntries`. */
  llamadas: number;
  /** Los números de `Raffle(id)` que se pidieron, por contrato, en orden de pedido. */
  raffles: Map<string, number[]>;
  /** Los números de `Draw(id)` que se pidieron, por contrato. */
  draws: Map<string, number[]>;
  /** Por qué dirección del RPC se preguntó por cada contrato. */
  urls: Map<string, Set<string>>;
}

const sym = (s: string): xdr.ScVal => xdr.ScVal.scvSymbol(s);
const u64 = (n: number): xdr.ScVal => xdr.ScVal.scvU64(BigInt(n));
const u32 = (n: number): xdr.ScVal => xdr.ScVal.scvU32(n);
const mapa = (o: Record<string, xdr.ScVal>): xdr.ScVal =>
  xdr.ScVal.scvMap(
    Object.keys(o)
      .sort()
      .map((k) => new xdr.ScMapEntry({ key: sym(k), val: o[k] as xdr.ScVal })),
  );

/** Una huella de 64 caracteres hex que depende del contrato y del número. */
function huellaPorDefecto(contractId: string, id: number): string {
  const hex = [...`${contractId}:${id}`].map((c) => c.charCodeAt(0).toString(16).padStart(2, "0")).join("");
  return hex.slice(-64).padStart(64, "0");
}

/** El `Raffle` como lo guarda el contrato (un mapa con las claves en orden alfabético). */
function raffleDe(c: ContratoFalso, s: SelloFalso): xdr.ScVal {
  const huella = (s.listHash ?? huellaPorDefecto(c.contractId, s.id)).padStart(64, "0");
  return mapa({
    id: u64(s.id),
    organizer: new Address(s.organizer).toScVal(),
    list_hash: xdr.ScVal.scvBytes(Uint8Array.from(huella.match(/../g) ?? [], (h) => parseInt(h, 16))),
    count: u32(s.count ?? 10),
    num_winners: u32(s.winners?.length ?? 1),
    round: u64(s.round ?? 1_000_000 + s.id),
    sealed_at: u64(s.sealedAt),
    sealed_ledger: u32(1),
    meta: xdr.ScVal.scvString(s.prize ?? ""),
    status: xdr.ScVal.scvVec([sym(s.winners ? "Drawn" : "Sealed")]),
  });
}

function drawDe(s: SelloFalso): xdr.ScVal {
  return mapa({
    raffle_id: u64(s.id),
    winners: xdr.ScVal.scvVec((s.winners ?? []).map(u32)),
  });
}

/** La entrada de almacenamiento persistente de un contrato, en el XDR que devuelve el RPC. */
function entrada(contractId: string, key: xdr.ScVal, val: xdr.ScVal): string {
  return xdr.LedgerEntryData.contractData(
    new xdr.ContractDataEntry({
      ext: xdr.ExtensionPoint.v0(),
      contract: new Address(contractId).toScAddress(),
      key,
      durability: xdr.ContractDataDurability.persistent,
      val,
    }),
  ).toXdr("base64");
}

function instanciaDe(c: ContratoFalso): xdr.ScVal {
  return xdr.ScVal.scvContractInstance(
    new xdr.ScContractInstance({
      executable: xdr.ContractExecutable.contractExecutableWasm(new Uint8Array(32)),
      storage: [new xdr.ScMapEntry({ key: xdr.ScVal.scvVec([sym("NextId")]), val: u64(c.nextId) })],
    }),
  );
}

export function rpcFalso(contratos: ContratoFalso[]): {
  fetch: (url: unknown, init?: { body?: unknown }) => Promise<{ json: () => Promise<unknown> }>;
  pedidos: PedidosAlRpc;
} {
  const porDireccion = new Map(contratos.map((c) => [c.contractId, c]));
  const pedidos: PedidosAlRpc = { llamadas: 0, raffles: new Map(), draws: new Map(), urls: new Map() };
  const anotar = (m: Map<string, number[]>, contractId: string, n: number): void => {
    m.set(contractId, [...(m.get(contractId) ?? []), n]);
  };

  const fetchFalso = async (url: unknown, init?: { body?: unknown }): Promise<{ json: () => Promise<unknown> }> => {
    const pedido = JSON.parse(String(init?.body)) as { method?: string; params?: { keys?: string[] } };
    if (pedido.method !== "getLedgerEntries") throw new Error(`rpc-falso: método no previsto ${pedido.method}`);
    pedidos.llamadas++;
    const entries: { key: string; xdr: string }[] = [];
    for (const k of pedido.params?.keys ?? []) {
      const clave = xdr.LedgerKey.fromXdr(k, "base64");
      if (clave.type !== "contractData") continue;
      const contractId = Address.fromScAddress(clave.contractData.contract).toString();
      const c = porDireccion.get(contractId);
      if (!c) continue;
      if (c.falla) throw new TypeError("fetch failed");
      pedidos.urls.set(contractId, new Set([...(pedidos.urls.get(contractId) ?? []), String(url)]));
      const key = clave.contractData.key;
      if (key.type === "scvLedgerKeyContractInstance") {
        if (!c.sinInstancia) entries.push({ key: k, xdr: entrada(contractId, key, instanciaDe(c)) });
        continue;
      }
      const [variante, numero] = scValToNative(key) as [string, bigint];
      const id = Number(numero);
      const sello = c.sellos.find((s) => s.id === id);
      if (variante === "Raffle") {
        anotar(pedidos.raffles, contractId, id);
        if (sello) entries.push({ key: k, xdr: entrada(contractId, key, raffleDe(c, sello)) });
      } else if (variante === "Draw") {
        anotar(pedidos.draws, contractId, id);
        if (sello?.winners) entries.push({ key: k, xdr: entrada(contractId, key, drawDe(sello)) });
      }
    }
    return { json: async () => ({ jsonrpc: "2.0", id: 1, result: { entries, latestLedger: 1 } }) };
  };

  return { fetch: fetchFalso, pedidos };
}
