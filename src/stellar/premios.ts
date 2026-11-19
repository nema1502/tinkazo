import type { xdr as XdrNs } from "@stellar/stellar-sdk";
import { listHash } from "../protocol/canonical";
import { bytesToHex } from "../protocol/quicknet";
import type { ContratoDePremios, ContratoOficial } from "./oficiales";

/**
 * El contrato de premios de una campaña, leído de la cadena tal cual.
 *
 * Una campaña con premio no sella en el contrato del sorteo: llama a `seal` del contrato de premios, que
 * guarda la promoción y sella adentro, en el sorteo oficial que declara su `Config.raffle`. La transacción
 * de ese `seal` no trae la huella ni los ganadores que el sorteo guardó: trae la promoción, las entradas y
 * la ronda. Lo demás sale del estado del contrato de premios, y el sobre queda atado por el hash de la
 * transacción (`historial.ts`), así que se lee de una sola consulta (`getLedgerEntries`) con las claves del
 * contrato: la instancia (con su `Config`, que dice cuál es el sorteo oficial), el `Promo(id)` y cada
 * `Prize(id, posición)`.
 *
 * Es la mitad que le faltaba al comprobante por historial: el estado del contrato de premios vence como
 * cualquier otro, pero mientras esté se puede comprobar que el sello de la campaña entró de verdad al sorteo
 * oficial, y con qué número (el `raffle_id` que la promoción guardó al sellar). Y mientras esté, el
 * comprobante muestra el depósito, la huella de las bases y el pago de cada premio.
 *
 * El SDK de Stellar se pide recién acá adentro, con `import()`: las páginas no lo bajan al abrirse.
 */

/** Cuántas claves acepta el RPC en una consulta. */
const CLAVES_POR_CONSULTA = 200;
const TIEMPO_MS = 15_000;
const INTENTOS = 2;
const ESPERA_MS = 700;

/** Una dirección de contrato o de cuenta: 56 caracteres del alfabeto base32 de Stellar. */
const ES_DIRECCION = /^[A-Z2-7]{56}$/;
/** Un u64 sin ceros adelante, como texto (el mismo criterio que el número de un comprobante). */
const ES_U64 = /^(0|[1-9][0-9]{0,19})$/;

type Fetch = typeof fetch;

/** El estado del pago de un premio (`PrizeState` del contrato). */
export type EstadoDelPremio = "Paid" | "Owed" | "Held" | "Returned";

/** Un premio de la promoción, con el estado de su pago, tal como lo guarda el contrato. */
export interface PremioDeLaPromocion {
  /** El puesto, desde 0: el orden de los premios. */
  position: number;
  /** El índice del ganador en la lista canónica: es el que la selección (`select.ts`) tiene que dar. */
  index: number;
  /** El monto, en unidades mínimas del activo, como texto (es un i128). */
  amount: string;
  state: EstadoDelPremio;
  /** La cuenta del ganador, tal como la guardó el contrato. */
  winner: string;
}

/** Una promoción de un contrato de premios. */
export interface Promocion {
  /** El número de la promoción en su contrato, como texto (es un u64). */
  id: string;
  /** La huella de la lista que se selló (la misma que la del sello, en el sorteo oficial). */
  listHash: string;
  /** La huella de las bases: lo que quien organiza publicó como reglas. */
  rulesHash: string;
  /** Cuántas entradas tenía la lista sellada. */
  count: number;
  /** La ronda objetivo de la semilla. */
  round: number;
  /** El número del sorteo que creó el sello en el contrato oficial. */
  raffleId: string;
  /** Los montos de los premios, en orden de puesto y en unidades mínimas del activo. */
  prizes: string[];
  /** La suma de los premios: lo que quedó depositado en el contrato. */
  deposit: string;
  /** El activo en que se depositó: la dirección de su contrato (un SAC). */
  token: string;
  /** El premio se entrega en especie: el monto es una referencia, no el activo depositado. */
  inKind: boolean;
  /** La comisión del contrato, y si ya se cobró. */
  fee: string;
  feePaid: boolean;
  /** El título: es el `meta` con el que el sello entró al sorteo oficial. */
  title: string;
  status: "Funded" | "Sealed" | "Settled" | "Refunded" | "Cancelled";
  sponsor: string;
  operator: string;
  /** El estado de cada premio (mismo orden que `prizes`). */
  premios: PremioDeLaPromocion[];
}

/**
 * Por qué no se pudo leer una promoción:
 * - `red-caida`: el RPC no contestó (corte, tiempo agotado, límite de pedidos, error del servidor).
 * - `respuesta-invalida`: contestó algo que no tiene la forma de la promoción de Tinkazo.
 * - `sin-estado`: la instancia o la promoción no están en el almacenamiento del contrato (archivadas, o una
 *   promoción que ese contrato nunca tuvo). No dice que la promoción no existiera: vence como todo estado.
 * - `contrato-ajeno`: la instancia no corre el `.wasm` que declara la tabla de `deployments.json`.
 */
export type ErrorDeLaPromocion = "red-caida" | "respuesta-invalida" | "sin-estado" | "contrato-ajeno";

/** Lo que se pudo leer: la promoción y, de su `Config`, el contrato del sorteo oficial de esa red. */
export type LecturaDeLaPromocion =
  | { ok: true; promocion: Promocion; raffle: string }
  | { ok: false; error: ErrorDeLaPromocion };

export interface OpcionesDeLaPromocion {
  /** Para las pruebas: otro `fetch`. */
  fetch?: Fetch;
  /** Cuánto se espera cada intento (15 s). */
  tiempoMs?: number;
  /** Cuántas veces se pregunta antes de decir que no se pudo (2). */
  intentos?: number;
  /** Cuánto se espera entre un intento y el siguiente (700 ms, creciente). */
  esperaMs?: number;
}

/** Lo que se guardó con una forma que no es la del contrato: se descarta la lectura entera. */
class PromocionDeforme extends Error {
  constructor(que: string) {
    super(`promocion-deforme: ${que}`);
  }
}

const esObjeto = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

const huella = (v: unknown, que: string): string => {
  if (!(v instanceof Uint8Array) || v.length !== 32) throw new PromocionDeforme(que);
  return bytesToHex(v);
};

const entero = (v: unknown, que: string, max = Number.MAX_SAFE_INTEGER): number => {
  const n = typeof v === "bigint" ? (v >= 0n && v <= BigInt(max) ? Number(v) : NaN) : typeof v === "number" ? v : NaN;
  if (!Number.isSafeInteger(n) || n < 0 || n > max) throw new PromocionDeforme(que);
  return n;
};

const u64 = (v: unknown, que: string): string => {
  if (typeof v === "bigint" && v >= 0n) return v.toString();
  if (typeof v === "number" && Number.isSafeInteger(v) && v >= 0) return String(v);
  throw new PromocionDeforme(que);
};

const monto = (v: unknown, que: string): string => {
  const n = typeof v === "bigint" ? v : typeof v === "number" && Number.isSafeInteger(v) ? BigInt(v) : null;
  if (n === null || n < 0n) throw new PromocionDeforme(que);
  return n.toString();
};

const direccion = (v: unknown, que: string): string => {
  if (typeof v !== "string" || !ES_DIRECCION.test(v)) throw new PromocionDeforme(que);
  return v;
};

const texto = (v: unknown, que: string): string => {
  const t = typeof v === "string" ? v : v instanceof Uint8Array ? new TextDecoder().decode(v) : null;
  if (t === null) throw new PromocionDeforme(que);
  return t;
};

/** Las variantes sin datos de un enum del contrato llegan como `["Drawn"]`. */
const variante = <T extends string>(v: unknown, validas: readonly T[], que: string): T => {
  const s = Array.isArray(v) && v.length === 1 ? v[0] : undefined;
  if (typeof s !== "string" || !(validas as readonly string[]).includes(s)) throw new PromocionDeforme(que);
  return s as T;
};

const ESTADOS_DEL_PREMIO: readonly EstadoDelPremio[] = ["Paid", "Owed", "Held", "Returned"];
const ESTADOS_DE_LA_PROMOCION: readonly Promocion["status"][] = ["Funded", "Sealed", "Settled", "Refunded", "Cancelled"];

/** La promoción tal como la devuelve el RPC, ya pasada a valores de JavaScript (`scValToNative`). */
function promocionDe(raw: unknown, id: string): Promocion {
  if (!esObjeto(raw)) throw new PromocionDeforme("promocion");
  if (u64(raw.id, "id") !== id) throw new PromocionDeforme("id");
  if (!Array.isArray(raw.prizes)) throw new PromocionDeforme("premios");
  const prizes = raw.prizes.map((p) => monto(p, "premio"));
  const deposit = prizes.reduce((suma, p) => suma + BigInt(p), 0n).toString();
  return {
    id,
    listHash: huella(raw.list_hash, "huella"),
    rulesHash: huella(raw.rules_hash, "bases"),
    count: entero(raw.count, "cantidad", 0xffff_ffff),
    round: entero(raw.round, "ronda"),
    raffleId: u64(raw.raffle_id, "sorteo"),
    prizes,
    deposit,
    token: direccion(raw.token, "activo"),
    // Un contrato anterior no declaraba si el premio era en especie: sin el campo, se depositó el activo.
    inKind: raw.in_kind === true,
    fee: monto(raw.fee, "comision"),
    feePaid: raw.fee_paid === true,
    title: texto(raw.title, "titulo"),
    status: variante(raw.status, ESTADOS_DE_LA_PROMOCION, "estado"),
    sponsor: direccion(raw.sponsor, "patrocinador"),
    operator: direccion(raw.operator, "operadora"),
    premios: [],
  };
}

/** Un premio y su estado, tal como los devuelve el RPC. */
function premioDe(raw: unknown, promocionId: string, posicion: number): PremioDeLaPromocion {
  if (!esObjeto(raw)) throw new PromocionDeforme("premio");
  if (u64(raw.promo_id, "premio de la promocion") !== promocionId) throw new PromocionDeforme("premio de otra promocion");
  if (entero(raw.position, "puesto", 0xffff_ffff) !== posicion) throw new PromocionDeforme("puesto");
  return {
    position: posicion,
    index: entero(raw.index, "indice", 0xffff_ffff),
    amount: monto(raw.amount, "monto"),
    state: variante(raw.state, ESTADOS_DEL_PREMIO, "estado del premio"),
    winner: direccion(raw.winner, "ganador"),
  };
}

/** Un pedido al RPC, con un reintento para lo que es de la red y no de la promoción. */
async function consultar(url: string, keys: string[], op: OpcionesDeLaPromocion): Promise<{ key: string; xdr: string }[]> {
  const f = op.fetch ?? fetch;
  const intentos = Math.max(1, op.intentos ?? INTENTOS);
  const esperaMs = op.esperaMs ?? ESPERA_MS;
  let ultimo: unknown = null;
  for (let i = 0; i < intentos; i++) {
    if (i) await new Promise((r) => setTimeout(r, esperaMs * i));
    try {
      const res = await f(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getLedgerEntries", params: { keys } }),
        signal: AbortSignal.timeout(op.tiempoMs ?? TIEMPO_MS),
      });
      if (!res.ok) throw new Error(`rpc ${res.status}`);
      const cuerpo = (await res.json()) as { result?: { entries?: unknown; latestLedger?: unknown }; error?: { message?: string } };
      if (cuerpo.error) throw new Error(cuerpo.error.message ?? "rpc-error");
      // Sin el número de ledger no es una respuesta: no se toma como "no hay nada".
      if (!cuerpo.result || typeof cuerpo.result.latestLedger !== "number") throw new Error("rpc-sin-respuesta");
      const entries = Array.isArray(cuerpo.result.entries) ? cuerpo.result.entries : [];
      return entries.filter(
        (e): e is { key: string; xdr: string } =>
          !!e && typeof (e as { key?: unknown }).key === "string" && typeof (e as { xdr?: unknown }).xdr === "string",
      );
    } catch (e) {
      ultimo = e;
    }
  }
  throw ultimo instanceof Error ? ultimo : new Error("rpc-sin-respuesta");
}

/** Las claves del contrato de premios, armadas a mano como en `registro.ts`. */
function clavesDe(sdk: { xdr: typeof XdrNs; Address: typeof import("@stellar/stellar-sdk").Address }, contrato: string, promocionId: string) {
  const direccionDelContrato = new sdk.Address(contrato).toScAddress();
  const deDatos = (val: XdrNs.ScVal): string =>
    sdk.xdr.LedgerKey.contractData(
      new sdk.xdr.LedgerKeyContractData({ contract: direccionDelContrato, key: val, durability: sdk.xdr.ContractDataDurability.persistent }),
    ).toXdr("base64");
  return {
    instancia: deDatos(sdk.xdr.ScVal.scvLedgerKeyContractInstance()),
    promocion: deDatos(sdk.xdr.ScVal.scvVec([sdk.xdr.ScVal.scvSymbol("Promo"), sdk.xdr.ScVal.scvU64(BigInt(promocionId))])),
    premio: (posicion: number): string =>
      deDatos(
        sdk.xdr.ScVal.scvVec([sdk.xdr.ScVal.scvSymbol("Prize"), sdk.xdr.ScVal.scvU64(BigInt(promocionId)), sdk.xdr.ScVal.scvU32(posicion)]),
      ),
  };
}

/**
 * Una promoción y su estado, leídos de su contrato. Nunca lanza: lo que no se pudo leer viene con su
 * motivo, y solo `sin-estado` y `red-caida` pueden significar que el estado ya no está (vence como todo).
 */
export async function leerPromocion(contrato: ContratoDePremios, promocionId: string, op: OpcionesDeLaPromocion = {}): Promise<LecturaDeLaPromocion> {
  if (!ES_U64.test(promocionId)) return { ok: false, error: "respuesta-invalida" };

  let sdk: { xdr: typeof XdrNs; Address: typeof import("@stellar/stellar-sdk").Address; scValToNative: typeof import("@stellar/stellar-sdk").scValToNative };
  try {
    const { xdr, Address, scValToNative } = await import("@stellar/stellar-sdk");
    sdk = { xdr, Address, scValToNative };
  } catch {
    return { ok: false, error: "red-caida" };
  }

  const claves = clavesDe(sdk, contrato.contractId, promocionId);
  let entradas: { key: string; xdr: string }[];
  try {
    entradas = await consultar(contrato.rpcUrl, [claves.instancia, claves.promocion], op);
  } catch {
    return { ok: false, error: "red-caida" };
  }

  try {
    const valores = new Map<string, XdrNs.ScVal>();
    for (const e of entradas) {
      const datos = sdk.xdr.LedgerEntryData.fromXdr(e.xdr, "base64");
      if (datos.type !== "contractData") throw new PromocionDeforme("entrada");
      // La entrada dice de qué contrato y con qué clave es: tiene que ser una de las que se pidieron.
      const suya = sdk.xdr.LedgerKey.contractData(
        new sdk.xdr.LedgerKeyContractData({ contract: datos.contractData.contract, key: datos.contractData.key, durability: datos.contractData.durability }),
      ).toXdr("base64");
      if (suya !== e.key || (e.key !== claves.instancia && e.key !== claves.promocion)) throw new PromocionDeforme("clave");
      valores.set(e.key, datos.contractData.val);
    }

    const instancia = valores.get(claves.instancia);
    const guardada = valores.get(claves.promocion);
    // Lo que el contrato no tiene puede estar archivado: no se afirma nada de la promoción.
    if (!instancia || !guardada) return { ok: false, error: "sin-estado" };
    if (instancia.type !== "scvContractInstance" || guardada.type !== "scvMap") return { ok: false, error: "respuesta-invalida" };

    // Qué código corre: un contrato no lo puede cambiar, así que un hash distinto es un RPC que no es ese contrato.
    const ejecutable = instancia.instance.executable;
    const wasm = ejecutable.type === "contractExecutableWasm" ? bytesToHex(ejecutable.wasmHash.value) : ejecutable.type;
    if (contrato.wasmSha256 !== undefined && wasm !== contrato.wasmSha256) return { ok: false, error: "contrato-ajeno" };

    // El `Config` vive en el almacenamiento de la instancia, no en una clave propia: ahí dice cuál es el
    // sorteo oficial de la red, y es lo que se comprueba antes de creerle nada a la promoción.
    const config = (instancia.instance.storage ?? []).find((e) => {
      const k = sdk.scValToNative(e.key) as unknown;
      return Array.isArray(k) && k[0] === "Config";
    });
    if (!config) return { ok: false, error: "respuesta-invalida" };
    const configNativa = sdk.scValToNative(config.val);
    if (!esObjeto(configNativa)) return { ok: false, error: "respuesta-invalida" };
    const raffle = direccion(configNativa.raffle, "sorteo oficial");

    const promocion = promocionDe(sdk.scValToNative(guardada), promocionId);
    // Los premios, en una consulta aparte: cuántos son lo dice la promoción.
    const pedidas = promocion.prizes.map((_, i) => claves.premio(i));
    const premios = new Map<number, PremioDeLaPromocion>();
    for (let i = 0; i < pedidas.length; i += CLAVES_POR_CONSULTA) {
      for (const e of await consultar(contrato.rpcUrl, pedidas.slice(i, i + CLAVES_POR_CONSULTA), op)) {
        const datos = sdk.xdr.LedgerEntryData.fromXdr(e.xdr, "base64");
        if (datos.type !== "contractData") throw new PromocionDeforme("entrada");
        const suya = sdk.xdr.LedgerKey.contractData(
          new sdk.xdr.LedgerKeyContractData({ contract: datos.contractData.contract, key: datos.contractData.key, durability: datos.contractData.durability }),
        ).toXdr("base64");
        const posicion = pedidas.indexOf(e.key);
        if (suya !== e.key || posicion < 0) throw new PromocionDeforme("clave");
        const premio = premioDe(sdk.scValToNative(datos.contractData.val), promocionId, posicion);
        premios.set(posicion, premio);
      }
    }
    // Un premio que el contrato no tiene (archivado) deja la promoción a medias: no se muestra ni se usa.
    if (premios.size !== pedidas.length) return { ok: false, error: "sin-estado" };
    promocion.premios = promocion.prizes.map((_, i) => premios.get(i) as PremioDeLaPromocion);
    return { ok: true, promocion, raffle };
  } catch {
    return { ok: false, error: "respuesta-invalida" };
  }
}

/* ------------------------------------------------------- el sello de una campaña */

/** Lo que viaja en el sobre de una llamada `seal` al contrato de premios: `seal(promo_id, entradas, round)`. */
export interface SobreDelSelloDePremios {
  /** El número de la promoción, como texto (es un u64). */
  promocionId: string;
  /** Las entradas que se sellaron: una por cuenta, tal como las mandó quien organiza. */
  entradas: string[];
  /** La ronda objetivo de la semilla. */
  round: number;
}

/**
 * Los argumentos de una llamada a `seal` de un contrato de premios, o `null` si no tienen esa forma. Es la
 * firma del contrato (`seal(promo_id: u64, entries: Vec<address>, round: u64)`): otra cosa no es un sello
 * de una campaña, aunque llame a `seal`.
 */
export function sobreDeLosArgumentos(args: readonly XdrNs.ScVal[], aNativo: (v: XdrNs.ScVal) => unknown): SobreDelSelloDePremios | null {
  const tipos = args.map((x) => x.type);
  if (tipos.join() !== "scvU64,scvVec,scvU64") return null;
  try {
    const [promocionId, entradas, round] = args.map((x) => aNativo(x)) as unknown[];
    if (typeof promocionId !== "bigint" || promocionId < 0n || promocionId > 2n ** 64n - 1n) return null;
    if (typeof round !== "bigint" || round < 0n || round > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    if (!Array.isArray(entradas) || entradas.length < 1) return null;
    if (!entradas.every((e): e is string => typeof e === "string" && ES_DIRECCION.test(e))) return null;
    return { promocionId: promocionId.toString(), entradas, round: Number(round) };
  } catch {
    return null;
  }
}

/** La promoción detrás de un sello de campaña: lo que se depositó, las bases y el pago de cada premio. */
export interface PremioDelSello {
  /** El contrato de premios que selló. */
  contrato: string;
  /** El número de la promoción en ese contrato. */
  promocionId: string;
  /** El número del sorteo en el contrato oficial: el contrato de premios lo guardó al sellar. */
  sorteoId: string;
  /** La suma de los premios, en unidades mínimas del activo, como texto. */
  deposito: string;
  /** El activo depositado: la dirección de su contrato (un SAC). */
  token: string;
  inKind: boolean;
  /** La huella de las bases (las reglas que quien organiza publicó). */
  rulesHash: string;
  /** La huella de la lista sellada. */
  listHash: string;
  premios: PremioDeLaPromocion[];
}

/** El sello de una campaña, ya aceptado: lo mismo que un sello del contrato del sorteo, más la promoción. */
export interface SelloDePromocion {
  /** El contrato del sorteo oficial: donde la promoción selló de verdad. */
  raffle: string;
  /** Quién figura como organizador en el sorteo: la dirección del contrato de premios. */
  organizer: string;
  listHash: string;
  count: number;
  numWinners: number;
  round: number;
  /** El título de la promoción: es el `meta` con el que el sello entró al sorteo. */
  meta: string;
  premio: PremioDelSello;
}

/**
 * Por qué no se acepta un sello de una campaña. `no-es-un-sello` y `contrato-ajeno` son una contradicción
 * (se leyó el estado y no es lo que el comprobante dice); `red-caida`, no: no se pudo leer.
 */
export type RechazoDelSelloDePremios = "no-es-un-sello" | "contrato-ajeno" | "red-caida";

export type AceptacionDelSelloDePremios = { ok: true; sello: SelloDePromocion } | { ok: false; error: RechazoDelSelloDePremios };

/**
 * ¿El sobre de un `seal` del contrato de premios es el sello de una promoción que entró al sorteo oficial de
 * esa red? Se acepta solo si la promoción dice lo mismo que el sobre: la huella de la lista recalculada de
 * sus entradas (a), la cantidad (b), los premios que se sortearon (c), la ronda (d), y que su `Config.raffle`
 * sea el contrato del sorteo oficial vigente de la red y que guarde el número del sorteo que creó (e).
 *
 * La prueba de que selló en el sorteo oficial se apoya en el estado del contrato de premios: `Config.raffle`,
 * el `raffle_id` que guardó la promoción al sellar, y la huella recalculada. La transacción, con su hash, ata
 * todo eso a lo que se firmó, y Horizon dice cuándo cerró el ledger (docs/protocolo.md §7.3).
 */
export async function aceptarSelloDePremios(d: {
  contrato: ContratoDePremios;
  sobre: SobreDelSelloDePremios;
  /** Los contratos oficiales del sorteo de esa red: el de `Config.raffle` tiene que ser el vigente. */
  raffles: readonly ContratoOficial[];
  /** Para las pruebas: otro lector de la promoción. */
  leer?: (contrato: ContratoDePremios, promocionId: string) => Promise<LecturaDeLaPromocion>;
}): Promise<AceptacionDelSelloDePremios> {
  const { contrato, sobre, raffles } = d;
  const leer = d.leer ?? ((c, id) => leerPromocion(c, id));
  const lectura = await leer(contrato, sobre.promocionId);
  if (!lectura.ok) {
    // El código no es el de la tabla: no es ese contrato. Lo demás puede ser un estado archivado.
    return { ok: false, error: lectura.error === "contrato-ajeno" ? "contrato-ajeno" : "red-caida" };
  }
  const { promocion, raffle } = lectura;
  const oficial = raffles.find((c) => c.red === contrato.red && c.contractId === raffle && c.vigente);
  const huellaDelSobre = bytesToHex(listHash(sobre.entradas));
  const coincide =
    oficial !== undefined &&
    (promocion.status === "Sealed" || promocion.status === "Settled") &&
    // El número del sorteo que la promoción guardó: sin él no hay a qué sorteo atribuir el sello.
    /^[1-9][0-9]{0,19}$/.test(promocion.raffleId) &&
    promocion.listHash === huellaDelSobre &&
    promocion.count === sobre.entradas.length &&
    promocion.round === sobre.round &&
    promocion.prizes.length >= 1;
  if (!coincide) return { ok: false, error: "no-es-un-sello" };
  return {
    ok: true,
    sello: {
      raffle,
      organizer: contrato.contractId,
      listHash: promocion.listHash,
      count: promocion.count,
      numWinners: promocion.prizes.length,
      round: promocion.round,
      meta: promocion.title,
      premio: {
        contrato: contrato.contractId,
        promocionId: promocion.id,
        sorteoId: promocion.raffleId,
        deposito: promocion.deposit,
        token: promocion.token,
        inKind: promocion.inKind,
        rulesHash: promocion.rulesHash,
        listHash: promocion.listHash,
        premios: promocion.premios,
      },
    },
  };
}
