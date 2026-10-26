import type { xdr as XdrNs } from "@stellar/stellar-sdk";
import type { Proof } from "../protocol/proof";
import { RPC_URLS } from "./config";
import { esFalloDeRpc, respaldoDe, rpcRed } from "./rpc-red";

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
 *
 * Desde el 25 de octubre de 2026 el sitio tiene un contrato vigente y dos
 * anteriores (`deployments.json`), y los sorteos de una cuenta están repartidos
 * entre los tres: el historial de otro equipo solo mostraba los del vigente
 * (`sealsOfAccount` los recorre todos).
 */

const RPC: Record<string, string> = RPC_URLS;

async function rpcUna(url: string, method: string, params: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(15_000),
  });
  // Un RPC saturado o caído contesta 429 o 5xx, a veces con una página que no es JSON: eso es "el RPC no sirve".
  if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
  const body = (await res.json()) as { result?: Record<string, unknown>; error?: { message?: string } };
  if (body.error) throw new Error(body.error.message ?? "rpc-error");
  return body.result ?? {};
}

/**
 * Una lectura al RPC. Si ese RPC no sirve (se cortó, tardó, 429, 5xx) y tiene un
 * segundo en su lista (`rpc-red.ts`), se lee del otro: leer es seguro en los dos.
 * La próxima lectura de quien usa el vigente ya sale por el que anduvo.
 */
async function rpc(url: string, method: string, params: unknown): Promise<Record<string, unknown>> {
  try {
    return await rpcUna(url, method, params);
  } catch (e) {
    const respaldo = esFalloDeRpc(e) ? respaldoDe(url) : null;
    if (!respaldo) throw e;
    const r = await rpcUna(respaldo.otro, method, params);
    rpcRed(respaldo.red).fallo(e);
    return r;
  }
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
  return sealsOnChain(organizer, proof.contract, url, proof.id);
}

/* --------------------------------------------- los sorteos, desde el contrato */

/**
 * Un sorteo tal como lo guarda el contrato. Sin nombres: la lista nunca sube a
 * la cadena, solo su huella. De los ganadores se sabe el puesto en la lista.
 */
export interface ChainRaffle {
  id: string;
  /**
   * El contrato donde está el sello. Los números de sorteo arrancan en 1 en cada
   * contrato, así que el #12 no dice de cuál es sin esta dirección: con ella el
   * comprobante y la verificación apuntan al contrato correcto.
   */
  contract?: string;
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
  /**
   * Sellos de OTRAS cuentas con la misma huella que el sorteo `matchId`. Es la
   * forma de la selección del compromiso que cambia de cuenta para no quedar
   * junta en la lista de una sola. Vacío si no se pidió o no hay.
   */
  elsewhere?: ChainRaffle[];
  /**
   * Sellos de OTRAS cuentas con la misma cantidad de gente que el sorteo
   * `matchId` y una ronda a menos de diez minutos de la suya. Es la forma que
   * además reordena la lista para cambiar la huella. Más débil: puede ser otro
   * evento a la misma hora. Vacío si no se pidió o no hay.
   */
  cercanos?: ChainRaffle[];
  /**
   * No se recorrió el contrato entero: hay sorteos más viejos que no se miraron.
   * Con varios contratos, basta que se haya cortado uno.
   */
  truncated: boolean;
}

/** Diez minutos de rondas de quicknet (una cada tres segundos). */
export const RONDAS_CERCANAS = 200;

/** Cuántas claves acepta el RPC en un solo `getLedgerEntries`. */
const KEYS_PER_CALL = 200;
/**
 * Cuántos sorteos del contrato se recorren como mucho, de los más nuevos para
 * atrás. Son diez viajes. El costo crece con los sorteos de todo el contrato,
 * no con los de la cuenta, así que hace falta un techo para que la página no
 * se cuelgue el día que haya decenas de miles. El techo es por contrato.
 */
export const SCAN_MAX = 2_000;

const hex = (b: Uint8Array | undefined): string =>
  [...(b ?? [])].map((x) => x.toString(16).padStart(2, "0")).join("");

/**
 * Pasa un `Raffle` del contrato, ya convertido a valores de JavaScript, a la
 * forma de acá. Devuelve `null` si le falta algo: mejor saltar una fila que
 * mostrarla inventada. `contract` es la dirección del contrato de donde se leyó
 * (el `Raffle` no la trae): queda anotada en el sello.
 */
export function parseRaffle(raw: unknown, contract?: string): ChainRaffle | null {
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
    ...(contract ? { contract } : {}),
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
 *
 * Mira UN contrato. Para el historial de una cuenta, que puede estar repartido
 * entre el contrato vigente y los anteriores, se usa `sealsOfAccount`.
 */
export async function sealsOnChain(
  organizer: string,
  contractId: string,
  rpcUrl: string,
  matchId?: string,
): Promise<ChainHistory | null> {
  try {
    const escaneo = await escanearContrato(contractId, rpcUrl);
    if (!escaneo) return null;
    const { todos, truncated, leerGanadores } = escaneo;
    const mine = todos.filter((r) => r.organizer === organizer);
    // Ya se leyeron todos: la misma huella sellada por otra cuenta sale gratis.
    const match = matchId ? todos.find((r) => r.id === matchId) : undefined;
    const elsewhere = match ? todos.filter((r) => r.listHash === match.listHash && r.organizer !== organizer) : [];
    // Y la que además reordena la lista para cambiar la huella: otra cuenta, la
    // misma cantidad de gente, casi a la misma hora.
    const cercanos = match
      ? todos.filter(
          (r) =>
            r.organizer !== organizer &&
            r.id !== match.id &&
            r.listHash !== match.listHash &&
            r.count === match.count &&
            Math.abs(r.round - match.round) <= RONDAS_CERCANAS,
        )
      : [];
    await leerGanadores(mine);
    ordenarSellos(mine);
    return { raffles: mine, truncated, elsewhere, cercanos };
  } catch {
    return null;
  }
}

/**
 * Del más nuevo al más viejo. A la misma hora gana el sello del contrato que
 * viene primero en `contratos` (el vigente va primero) y, dentro de un mismo
 * contrato, el de número mayor: así el orden no depende de en qué orden
 * contestó el RPC. Ordena `raffles` en el lugar y lo devuelve.
 */
function ordenarSellos(raffles: ChainRaffle[], contratos: readonly { contractId: string }[] = []): ChainRaffle[] {
  const lugar = new Map(contratos.map((c, i) => [c.contractId, i]));
  const de = (r: ChainRaffle): number => lugar.get(r.contract ?? "") ?? contratos.length;
  return raffles.sort((a, b) => b.sealedAt - a.sealedAt || de(a) - de(b) || Number(b.id) - Number(a.id));
}

/** Un contrato donde buscar sellos: su dirección, su RPC y, si es uno anterior, hasta qué número vale. */
export interface ContratoALeer {
  contractId: string;
  rpcUrl: string;
  /**
   * En un contrato anterior, el último número que dio mientras era el del sitio
   * (`ultimoId` de `deployments.json`). Como el contrato no se puede apagar,
   * cualquiera puede seguir sellando en él: lo que sellen ahí después no es un
   * sorteo de Tinkazo y no se lee.
   */
  ultimoId?: number;
}

/**
 * Todos los sorteos de una cuenta en TODOS los contratos que se le pasan: en
 * el uso normal, el vigente y los anteriores de la lista oficial
 * (`contratosOficiales`, en `oficiales.ts`).
 *
 * Cuando el sitio cambia de contrato los números de sorteo vuelven a empezar y
 * los sellos viejos se quedan en el anterior, que sigue leyéndose igual. Antes
 * el historial de otro equipo (o con los datos del navegador borrados) solo
 * traía los del vigente, y la cuenta veía desaparecer casi todo lo que había
 * hecho. Cada sello vuelve con la dirección de su contrato (`contract`) y en
 * un anterior solo valen los números hasta su `ultimoId`.
 *
 * Cada contrato se recorre con el techo de `SCAN_MAX` sorteos, así que el
 * costo crece con la cantidad de contratos, no con la de sorteos de la cuenta.
 * `truncated` es verdadero si alguno se cortó por el techo.
 *
 * Qué pasa cuando un contrato no contesta:
 * - Si no se pudo preguntar a alguno (red caída, RPC con error), no se afirma
 *   nada: devuelve `null` y la pantalla vuelve a intentar. Una lista a medias
 *   que parece entera es justo el error que esto viene a arreglar.
 * - Si un contrato no tiene instancia viva (nadie la extendió y se archivó), no
 *   se puede leer y se salta; solo si ninguno tiene instancia devuelve `null`.
 *   Es el mismo límite de siempre con la renta: el sorteo no se pierde, pero
 *   para leerlo hay que restaurarlo.
 *
 * Con un solo contrato el resultado es el mismo que el de `sealsOnChain`.
 */
export async function sealsOfAccount(organizer: string, contratos: readonly ContratoALeer[]): Promise<ChainHistory | null> {
  if (contratos.length === 0) return null;
  try {
    const escaneos = await Promise.all(contratos.map((c) => escanearContrato(c.contractId, c.rpcUrl, c.ultimoId)));
    const leidos = escaneos.filter((e): e is NonNullable<typeof e> => e !== null);
    if (leidos.length === 0) return null;
    const suyos = await Promise.all(
      leidos.map(async (e) => {
        const mine = e.todos.filter((r) => r.organizer === organizer);
        await e.leerGanadores(mine);
        return mine;
      }),
    );
    return { raffles: ordenarSellos(suyos.flat(), contratos), truncated: leidos.some((e) => e.truncated) };
  } catch {
    return null;
  }
}

/**
 * Los sellos de los últimos `SCAN_MAX` sorteos de un contrato, de cualquier
 * cuenta, y cómo pedir después los ganadores de los que hagan falta. `null` si
 * el contrato no contestó con su instancia. Lanza si no se pudo preguntar.
 *
 * `ultimoId` es el tope de un contrato anterior: no se lee ningún número mayor,
 * aunque el contador del contrato haya seguido subiendo. Cada sello sale con la
 * dirección del contrato.
 */
export async function escanearContrato(
  contractId: string,
  rpcUrl: string,
  ultimoId?: number,
): Promise<{ todos: ChainRaffle[]; truncated: boolean; leerGanadores: (de: ChainRaffle[]) => Promise<void> } | null> {
  // Un tope que no es un entero no se interpreta: mejor no leer nada que leer de más.
  if (ultimoId !== undefined && !(Number.isSafeInteger(ultimoId) && ultimoId >= 0)) throw new Error("ultimo-id-invalido");
  {
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

    // En un contrato anterior, lo que pasa de `ultimoId` no es del sitio.
    const last = Math.min(next - 1, ultimoId ?? Infinity);
    const first = Math.max(1, last - SCAN_MAX + 1);
    const ids: number[] = [];
    for (let id = last; id >= first; id--) ids.push(id);

    const todos = (await read(ids.map((id) => entryKey("Raffle", id))))
      .map((v) => parseRaffle(scValToNative(v), contractId))
      .filter((r): r is ChainRaffle => r !== null);

    // Los ganadores se piden solo de los que ya se sortearon, y solo de los que
    // hacen falta: el registro del resultado es otra entrada.
    const leerGanadores = async (de: ChainRaffle[]): Promise<void> => {
      const drawn = de.filter((r) => r.drawn);
      if (!drawn.length) return;
      const byId = new Map(de.map((r) => [r.id, r]));
      for (const v of await read(drawn.map((r) => entryKey("Draw", Number(r.id))))) {
        const d = scValToNative(v) as { raffle_id?: bigint | number; winners?: number[] } | null;
        const r = d?.raffle_id !== undefined ? byId.get(String(d.raffle_id)) : undefined;
        if (r && Array.isArray(d?.winners)) r.winners = d.winners.map(Number);
      }
    };
    return { todos, truncated: first > 1, leerGanadores };
  }
}

/* ------------------------------------- si un sello que se mandó entró o no */

/**
 * El último ledger que conoce la red: su número y su hora de cierre, en
 * segundos. Es el reloj que manda para saber si un sello todavía puede entrar
 * (`resolverSello` en `envio.ts`): el del navegador puede estar corrido.
 */
export async function ultimoLedger(rpcUrl: string): Promise<{ secuencia: number; cierre: number }> {
  const r = (await rpc(rpcUrl, "getLatestLedger", null)) as { sequence?: unknown; closeTime?: unknown };
  const secuencia = Number(r.sequence);
  const cierre = Number(r.closeTime);
  if (Number.isFinite(secuencia) && secuencia > 0 && Number.isFinite(cierre) && cierre > 0) return { secuencia, cierre };
  // Un RPC que todavía no dice la hora en `getLatestLedger`: la dice `getTransaction`, de cualquier hash.
  const t = (await rpc(rpcUrl, "getTransaction", { hash: "0".repeat(64) })) as { latestLedger?: unknown; latestLedgerCloseTime?: unknown };
  const s2 = Number(t.latestLedger);
  const c2 = Number(t.latestLedgerCloseTime);
  if (!Number.isFinite(s2) || !Number.isFinite(c2)) throw new Error("rpc-sin-respuesta: sin hora de la red");
  return { secuencia: s2, cierre: c2 };
}

/** Cuántos sorteos se leen por viaje al buscar el sello de un intento, y cuántos viajes como mucho. */
const LOTE_DEL_INTENTO = 60;
const VIAJES_DEL_INTENTO = 10;
/**
 * Hasta dónde para atrás se busca: un sello entra a lo sumo 30 segundos antes de
 * su ronda y se pide con un minuto y medio de margen como mucho. Diez minutos
 * antes de la ronda (en la hora de la red, que es la que guarda el contrato) ya
 * no puede haber un sello de este intento.
 */
const VENTANA_DEL_INTENTO_S = 600;

/**
 * Busca en el contrato el sello de un intento: la misma cuenta, la misma huella
 * de la lista y la misma ronda. Lee del más nuevo para atrás, por lotes, hasta
 * pasar la ventana del intento. `secuencia` es el ledger del que leyó (el menor
 * de las lecturas): lo que no estaba ahí, no había entrado hasta ese ledger.
 *
 * Si no alcanza a recorrer la ventana (decenas de sellos por minuto), lanza: sin
 * haber mirado todo no se afirma que no está.
 */
export async function selloDelIntento(
  intento: { organizer: string; listHash: string; round: number },
  contractId: string,
  rpcUrl: string,
): Promise<{ id?: string; secuencia: number }> {
  const { xdr, scValToNative, Address } = await import("@stellar/stellar-sdk");
  const { roundTime } = await import("../protocol/quicknet");
  const contract = new Address(contractId).toScAddress();
  const keyOf = (val: XdrNs.ScVal): string =>
    xdr.LedgerKey.contractData(
      new xdr.LedgerKeyContractData({ contract, key: val, durability: xdr.ContractDataDurability.persistent }),
    ).toXdr("base64");
  const leer = async (keys: string[]): Promise<{ vals: XdrNs.ScVal[]; secuencia: number }> => {
    const got = (await rpc(rpcUrl, "getLedgerEntries", { keys })) as { entries?: { xdr?: string }[]; latestLedger?: unknown };
    const vals: XdrNs.ScVal[] = [];
    for (const e of got.entries ?? []) {
      if (!e.xdr) continue;
      const data = xdr.LedgerEntryData.fromXdr(e.xdr, "base64");
      if (data.type === "contractData") vals.push(data.contractData.val);
    }
    const secuencia = Number(got.latestLedger);
    if (!Number.isFinite(secuencia)) throw new Error("rpc-sin-respuesta: getLedgerEntries sin ledger");
    return { vals, secuencia };
  };

  const instancia = await leer([keyOf(xdr.ScVal.scvLedgerKeyContractInstance())]);
  const inst = instancia.vals[0];
  if (inst?.type !== "scvContractInstance") throw new Error("rpc-sin-respuesta: sin la instancia del contrato");
  let next = 1;
  for (const e of inst.instance.storage ?? []) {
    const k = scValToNative(e.key) as unknown;
    if (Array.isArray(k) && k[0] === "NextId") next = Number(scValToNative(e.val));
  }
  let secuencia = instancia.secuencia;
  const desde = roundTime(intento.round) - VENTANA_DEL_INTENTO_S;
  const huella = intento.listHash.toLowerCase();
  let id = next - 1;
  for (let viaje = 0; viaje < VIAJES_DEL_INTENTO && id >= 1; viaje++) {
    const ids: number[] = [];
    for (let k = 0; k < LOTE_DEL_INTENTO && id >= 1; k++, id--) ids.push(id);
    const lote = await leer(ids.map((n) => keyOf(xdr.ScVal.scvVec([xdr.ScVal.scvSymbol("Raffle"), xdr.ScVal.scvU64(BigInt(n))]))));
    secuencia = Math.min(secuencia, lote.secuencia);
    const filas = lote.vals.map((v) => parseRaffle(scValToNative(v))).filter((r): r is ChainRaffle => r !== null);
    const mio = filas.find((r) => r.organizer === intento.organizer && r.listHash === huella && r.round === intento.round);
    if (mio) return { id: mio.id, secuencia };
    // Ya se pasó la ventana: los que siguen son más viejos que cualquier sello de este intento.
    if (filas.some((r) => r.sealedAt < desde)) return { secuencia };
  }
  if (id < 1) return { secuencia };
  throw new Error("rpc-sin-respuesta: demasiados sellos para mirar");
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
