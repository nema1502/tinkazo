import { HORIZON_URLS, RPC_LISTAS, type NetworkName } from "./config";
import { passphraseDe } from "./oficiales";
import { type ActivoDePago, type LecturaDePago, stroopsDe } from "./pagos";

/**
 * Buscar en la red el pago de un premio.
 *
 * Un premio pagado es un pago clásico en USDC, de la cuenta de quien organiza a la cuenta de quien ganó, con la nota
 * `tk:premio:<sorteo>:<puesto>` (`pagos.ts`). Acá se lo busca, sin guardar nada: en Horizon, con los pagos de la cuenta
 * ganadora y la nota de cada uno (`join=transactions`); y si Horizon no contesta, en el RPC, con los eventos de
 * transferencia del USDC hacia esa cuenta y la nota de la transacción de cada uno.
 *
 * Qué se le cree a la red y qué no: se buscan los pagos que **salieron bien**, a esa cuenta, en ese activo (el emisor
 * también cuenta), con esa nota exacta y desde una de las cuentas que pagan. Una nota igual puesta por cualquier otra
 * cuenta no hace "Pagado" a un premio: ese es el motivo de `pagadoras`.
 *
 * Sin reintentos agresivos: un solo pedido por página, con tiempo y tamaño acotados y un tope de páginas. Si no se
 * pudo terminar de mirar sin encontrar el pago, no se dice que no hay: se dice que no se pudo consultar.
 */

type Fetch = typeof fetch;

export interface BusquedaDePago {
  red: NetworkName;
  /** La cuenta de quien ganó. */
  destino: string;
  activo: ActivoDePago;
  /** La nota exacta del pago de este premio. */
  nota: string;
  /** Desde qué cuentas vale el pago. Vacío: desde cualquiera. */
  pagadoras: readonly string[];
  /** Los pagos anteriores a este instante (Unix, segundos) no cuentan, y la búsqueda no baja más. */
  desde: number;
}

export interface OpcionesDeLectura {
  /** Para las pruebas: otro `fetch`. */
  fetch?: Fetch;
  /** Para las pruebas: otra dirección de Horizon. */
  horizon?: string;
  /** Para las pruebas: otros RPC, en orden. */
  rpcs?: readonly string[];
  /** Cuánto se espera cada pedido (8 s). */
  tiempoMs?: number;
  /** Lo más que se acepta de una respuesta, en bytes (512 KB: una página de 25 pagos con su transacción pesa unos 130). */
  maxBytes?: number;
  /** Cuántas páginas de Horizon se miran como mucho (4). */
  maxPaginas?: number;
  /** Cuántos pagos por página (25). */
  porPagina?: number;
  /** Para las pruebas: no probar el RPC cuando Horizon falla. */
  sinRpc?: boolean;
}

const TIEMPO_MS = 8_000;
const MAX_BYTES = 512 * 1024;
const MAX_PAGINAS = 4;
const POR_PAGINA = 25;
/** Cuántos RPC se prueban como mucho, y cuántas transacciones se miran en cada uno. */
const MAX_RPC = 2;
const MAX_TRANSACCIONES_RPC = 6;
/**
 * El RPC mira de a unos 10.000 ledgers por pedido y devuelve un cursor para seguir, aunque no haya eventos. Los eventos
 * se piden desde un poco antes del sorteo (un ledger cierra cada 4 o 5 segundos; se cuenta cada 4, para que sobren) y se
 * sigue el cursor hasta el último ledger. Para un sorteo de hoy es un pedido; para uno de hace una semana, una docena:
 * pasado el tope de pedidos o de tiempo, no se dice que no hay: se dice que no se pudo consultar.
 */
const SEGUNDOS_POR_LEDGER = 4;
const HOLGURA_DE_LEDGERS = 300;
/** Si el RPC guarda menos, se empieza este tanto después de lo más viejo que dice tener (esa cifra se corre con cada ledger). */
const MARGEN_DEL_RPC = 2_000;
const EVENTOS_POR_PAGINA = 50;
const MAX_PAGINAS_RPC = 16;
const TIEMPO_TOTAL_RPC_MS = 30_000;

const ES_HASH = /^[0-9a-f]{64}$/;
const ES_HORA = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?Z$/;
const ES_MONTO = /^\d{1,13}\.\d{1,7}$/;

/* ------------------------------------------------------------------- pedidos */

/** Corre `hacer` con un tiempo límite: al vencer corta y falla, aunque quien contesta (un `fetch` falso) no escuche. */
async function conEspera<T>(ms: number, hacer: (senal: AbortSignal) => Promise<T>): Promise<T> {
  const ctl = new AbortController();
  const vence = new Promise<never>((_, rechazar) => {
    ctl.signal.addEventListener("abort", () => rechazar(new Error("pagos-espera")), { once: true });
  });
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    return await Promise.race([hacer(ctl.signal), vence]);
  } finally {
    clearTimeout(t);
  }
}

/** El texto de la respuesta, o `null` si pasa de `max`. */
async function leerAcotado(res: Response, max: number): Promise<string | null> {
  const declarado = Number(res.headers?.get?.("content-length"));
  if (Number.isFinite(declarado) && declarado > max) {
    void res.body?.cancel().catch(() => undefined);
    return null;
  }
  const texto = await res.text();
  return texto.length > max ? null : texto;
}

type Pedido = { tipo: "ok"; json: unknown } | { tipo: "no-existe" | "falla" };

/** Un pedido que devuelve JSON. Un 404 es "no existe"; todo lo demás que no sea 200 es una falla. */
async function pedir(url: string, init: RequestInit | undefined, op: OpcionesDeLectura): Promise<Pedido> {
  const f = op.fetch ?? fetch;
  try {
    return await conEspera(op.tiempoMs ?? TIEMPO_MS, async (signal) => {
      const r = await f(url, { ...init, signal });
      if (r.status === 404) {
        void r.body?.cancel().catch(() => undefined);
        return { tipo: "no-existe" } as const;
      }
      if (!r.ok) {
        void r.body?.cancel().catch(() => undefined);
        return { tipo: "falla" } as const;
      }
      const texto = await leerAcotado(r, op.maxBytes ?? MAX_BYTES);
      if (texto === null) return { tipo: "falla" } as const;
      try {
        return { tipo: "ok", json: JSON.parse(texto) as unknown } as const;
      } catch {
        return { tipo: "falla" } as const;
      }
    });
  } catch {
    return { tipo: "falla" };
  }
}

const hex = (b: Uint8Array): string => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");

const esObjeto = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);

/* ------------------------------------------------------------------- Horizon */

/** El pago que dice un registro de `GET /accounts/{cuenta}/payments?join=transactions`, si es el de este premio. */
export function pagoDelRegistro(rec: unknown, b: BusquedaDePago): Extract<LecturaDePago, { tipo: "pagado" }> | null {
  if (!esObjeto(rec)) return null;
  // Pagos que dejan USDC en la cuenta: el clásico y los de camino (que pueden cambiar de activo en el medio).
  if (rec.type !== "payment" && rec.type !== "path_payment_strict_send" && rec.type !== "path_payment_strict_receive") return null;
  // Una transacción que falló no pagó nada. Horizon lo dice en el pago y en la transacción.
  const tx = rec.transaction;
  if (rec.transaction_successful === false || !esObjeto(tx) || tx.successful === false) return null;
  if (rec.to !== b.destino || rec.asset_code !== b.activo.code || rec.asset_issuer !== b.activo.issuer) return null;
  if (tx.memo_type !== "text" || tx.memo !== b.nota) return null;
  const de = rec.from;
  if (typeof de !== "string" || (b.pagadoras.length > 0 && !b.pagadoras.includes(de))) return null;
  const monto = rec.amount;
  if (typeof monto !== "string" || !ES_MONTO.test(monto) || stroopsDe(monto) <= 0n) return null;
  const hash = rec.transaction_hash;
  if (typeof hash !== "string" || !ES_HASH.test(hash)) return null;
  const cuando = hora(rec.created_at);
  if (cuando === null) return null;
  return { tipo: "pagado", hash, monto, cuando, de };
}

const hora = (v: unknown): number | null => {
  if (typeof v !== "string" || !ES_HORA.test(v)) return null;
  const s = Math.floor(Date.parse(v) / 1000);
  return Number.isSafeInteger(s) && s > 0 ? s : null;
};

/** Los pagos de la cuenta ganadora, de los más nuevos a los más viejos, hasta dar con el del premio o pasar el sorteo. */
async function porHorizon(b: BusquedaDePago, op: OpcionesDeLectura): Promise<LecturaDePago> {
  const base = op.horizon ?? HORIZON_URLS[b.red];
  const porPagina = op.porPagina ?? POR_PAGINA;
  let cursor = "";
  for (let pagina = 0; pagina < (op.maxPaginas ?? MAX_PAGINAS); pagina++) {
    const url =
      `${base}/accounts/${encodeURIComponent(b.destino)}/payments?join=transactions&order=desc&limit=${porPagina}&include_failed=false` +
      (cursor ? `&cursor=${cursor}` : "");
    const r = await pedir(url, undefined, op);
    // Una cuenta que no existe no recibió nada.
    if (r.tipo === "no-existe") return { tipo: "no-hay" };
    if (r.tipo !== "ok" || !esObjeto(r.json) || !esObjeto(r.json._embedded) || !Array.isArray(r.json._embedded.records)) return { tipo: "sin-consulta" };
    const registros = r.json._embedded.records as unknown[];
    for (const rec of registros) {
      const creado = esObjeto(rec) ? hora(rec.created_at) : null;
      if (creado === null) return { tipo: "sin-consulta" };
      // Más viejo que el sorteo: no cuenta, y lo que sigue también es más viejo.
      if (creado < b.desde) return { tipo: "no-hay" };
      const p = pagoDelRegistro(rec, b);
      if (p) return p;
    }
    // La última página: se miró todo lo que la cuenta recibió.
    if (registros.length < porPagina) return { tipo: "no-hay" };
    const ultimo = registros[registros.length - 1];
    const ficha = esObjeto(ultimo) ? ultimo.paging_token : undefined;
    if (typeof ficha !== "string" || !/^\d{1,30}$/.test(ficha)) return { tipo: "sin-consulta" };
    cursor = ficha;
  }
  // Quedaron páginas sin mirar: no se puede decir que no hay.
  return { tipo: "sin-consulta" };
}

/* ----------------------------------------------------------------------- RPC */

/** El ledger que un cursor del RPC ya recorrió (los 32 bits de arriba de su primer número). `-1` si no se entiende. */
export function ledgerDelCursor(cursor: string): number {
  const m = /^(\d{1,30})-\d+$/.exec(cursor);
  return m ? Number(BigInt(m[1] as string) >> 32n) : -1;
}

const rpc = async (url: string, method: string, params: unknown, op: OpcionesDeLectura): Promise<{ ok: true; result: Record<string, unknown> } | { ok: false; mensaje: string }> => {
  const r = await pedir(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) }, op);
  if (r.tipo !== "ok" || !esObjeto(r.json)) return { ok: false, mensaje: "" };
  if (esObjeto(r.json.error)) return { ok: false, mensaje: typeof r.json.error.message === "string" ? r.json.error.message : "" };
  return esObjeto(r.json.result) ? { ok: true, result: r.json.result } : { ok: false, mensaje: "" };
};

/**
 * Los eventos de transferencia del USDC hacia la cuenta ganadora, en los últimos siete días. Cuando el pago lleva nota, el
 * evento la trae (`to_muxed_id`) y alcanza con él; si no la trae, se mira la transacción de cada uno. Es el respaldo de
 * Horizon: el RPC guarda poco tiempo (una semana en las redes públicas) y no tiene filtro por nota.
 */
async function porRpc(b: BusquedaDePago, op: OpcionesDeLectura, url: string): Promise<LecturaDePago> {
  let sdk: Pick<typeof import("@stellar/stellar-sdk"), "Address" | "Asset" | "TransactionBuilder" | "scValToNative" | "xdr">;
  try {
    const { Address, Asset, TransactionBuilder, scValToNative, xdr } = await import("@stellar/stellar-sdk");
    sdk = { Address, Asset, TransactionBuilder, scValToNative, xdr };
  } catch {
    return { tipo: "sin-consulta" };
  }
  let filtro: unknown;
  try {
    filtro = {
      type: "contract",
      contractIds: [new sdk.Asset(b.activo.code, b.activo.issuer).contractId(passphraseDe(b.red))],
      // transfer(de, a, activo): el segundo tema es quien manda, el tercero quien recibe.
      topics: [[sdk.xdr.ScVal.scvSymbol("transfer").toXDR("base64"), "*", new sdk.Address(b.destino).toScVal().toXDR("base64"), "*"]],
    };
  } catch {
    return { tipo: "sin-consulta" };
  }

  const ultimo = await rpc(url, "getLatestLedger", undefined, op);
  const actual = ultimo.ok ? Number(ultimo.result.sequence) : NaN;
  if (!Number.isSafeInteger(actual)) return { tipo: "sin-consulta" };
  const cierreActual = Number(ultimo.ok ? ultimo.result.closeTime : NaN);
  const atras = Number.isFinite(cierreActual) ? Math.ceil(Math.max(0, cierreActual - b.desde) / SEGUNDOS_POR_LEDGER) : 0;
  let inicio = Math.max(2, actual - atras - HOLGURA_DE_LEDGERS);
  const limite = Date.now() + TIEMPO_TOTAL_RPC_MS;

  /** Un pago de USDC a la cuenta, de los eventos. `nota` es la que trae el evento: `undefined` si no la trae. */
  const candidatas: Array<{ hash: string; de: string; monto: bigint; cierre: number | null; nota: string | undefined }> = [];
  let cursor: string | undefined;
  let completo = false;
  for (let pagina = 0; pagina < MAX_PAGINAS_RPC && Date.now() < limite; pagina++) {
    const params = cursor
      ? { filters: [filtro], pagination: { cursor, limit: EVENTOS_POR_PAGINA } }
      : { startLedger: inicio, filters: [filtro], pagination: { limit: EVENTOS_POR_PAGINA } };
    let r = await rpc(url, "getEvents", params, op);
    // El RPC guarda poco tiempo: si el comienzo cae afuera, dice cuál es el rango, y se vuelve a pedir desde el más viejo.
    if (!r.ok && !cursor) {
      const rango = /(\d+)\s*-\s*(\d+)/.exec(r.mensaje);
      if (rango && Number(rango[1]) > inicio) {
        inicio = Math.min(Number(rango[1]) + MARGEN_DEL_RPC, Number(rango[2]));
        r = await rpc(url, "getEvents", { startLedger: inicio, filters: [filtro], pagination: { limit: EVENTOS_POR_PAGINA } }, op);
      }
    }
    if (!r.ok || !Array.isArray(r.result.events)) return { tipo: "sin-consulta" };
    const eventos = r.result.events as unknown[];
    for (const e of eventos) {
      if (!esObjeto(e) || typeof e.txHash !== "string" || !ES_HASH.test(e.txHash) || !Array.isArray(e.topic) || typeof e.value !== "string") continue;
      if (e.inSuccessfulContractCall === false) continue;
      try {
        const de = sdk.scValToNative(sdk.xdr.ScVal.fromXDR(String(e.topic[1]), "base64")) as unknown;
        const valor = sdk.scValToNative(sdk.xdr.ScVal.fromXDR(e.value, "base64")) as unknown;
        // Un pago a una cuenta lleva la cantidad sola o, si la transacción tiene nota, la cantidad y la nota (`to_muxed_id`).
        const monto = typeof valor === "bigint" ? valor : esObjeto(valor) && typeof valor.amount === "bigint" ? valor.amount : null;
        const nota = esObjeto(valor) && typeof valor.to_muxed_id === "string" ? valor.to_muxed_id : undefined;
        if (typeof de !== "string" || monto === null || monto <= 0n) continue;
        if (b.pagadoras.length > 0 && !b.pagadoras.includes(de)) continue;
        candidatas.push({ hash: e.txHash, de, monto, cierre: hora(e.ledgerClosedAt), nota });
      } catch {
        /* un evento que no se entiende no cuenta */
      }
    }
    // Se terminó cuando el cursor llegó al último ledger y la página no vino llena.
    const siguiente = typeof r.result.cursor === "string" ? r.result.cursor : undefined;
    const ultimoLedger = Number(r.result.latestLedger);
    if (!siguiente || (eventos.length < EVENTOS_POR_PAGINA && Number.isFinite(ultimoLedger) && ledgerDelCursor(siguiente) >= ultimoLedger)) {
      completo = true;
      break;
    }
    cursor = siguiente;
  }

  const pagado = (c: (typeof candidatas)[number], cuando: number | null): LecturaDePago => ({
    tipo: "pagado",
    hash: c.hash,
    monto: `${c.monto / 10_000_000n}.${String(c.monto % 10_000_000n).padStart(7, "0")}`,
    cuando: cuando ?? c.cierre ?? 0,
    de: c.de,
  });

  // Del más nuevo al más viejo, y sin repetir transacción.
  const vistas = new Set<string>();
  let miradas = 0;
  for (const c of candidatas.reverse()) {
    if (vistas.has(c.hash) || (c.cierre !== null && c.cierre < b.desde)) continue;
    vistas.add(c.hash);
    // El evento trae la nota de la transacción: si la trae, no hace falta preguntar por la transacción.
    if (c.nota !== undefined) {
      if (c.nota === b.nota) return pagado(c, null);
      continue;
    }
    // Sin nota en el evento (el pago no tiene o la red no la copia): se mira la transacción.
    if (miradas++ >= MAX_TRANSACCIONES_RPC) return { tipo: "sin-consulta" };
    const t = await rpc(url, "getTransaction", { hash: c.hash }, op);
    if (!t.ok) return { tipo: "sin-consulta" };
    if (t.result.status !== "SUCCESS" || typeof t.result.envelopeXdr !== "string") continue;
    try {
      const tx = sdk.TransactionBuilder.fromXDR(t.result.envelopeXdr, passphraseDe(b.red));
      const interior = "innerTransaction" in tx ? tx.innerTransaction : tx;
      // Tiene que ser la transacción del evento: el sobre que contesta el RPC se comprueba con el hash que se pidió.
      if (![tx.hash(), interior.hash()].some((h) => hex(h) === c.hash)) continue;
      // La nota de texto sale como bytes: se lee como texto.
      const v = interior.memo.value as unknown;
      const nota = typeof v === "string" ? v : v instanceof Uint8Array ? new TextDecoder().decode(v) : null;
      if (interior.memo.type !== "text" || nota !== b.nota) continue;
      const en = Number(t.result.createdAt);
      return pagado(c, Number.isSafeInteger(en) && en > 0 ? en : null);
    } catch {
      /* una transacción que no se decodifica no cuenta */
    }
  }
  // Se miraron todas las páginas y ninguna era: no hay. Si quedaron sin mirar, no se sabe.
  return completo ? { tipo: "no-hay" } : { tipo: "sin-consulta" };
}

/* ------------------------------------------------------------------- la unión */

/**
 * El pago de un premio, de la red. Nunca lanza. Primero Horizon; si no contesta, el RPC. `horizonFallo` dice si hubo
 * que recurrir al respaldo (el lector lo usa para no seguir insistiendo con un Horizon caído).
 */
export async function buscarPagoConDetalle(
  b: BusquedaDePago,
  op: OpcionesDeLectura & { sinHorizon?: boolean } = {},
): Promise<{ lectura: LecturaDePago; horizonFallo: boolean }> {
  let horizonFallo = false;
  if (!op.sinHorizon) {
    const h = await porHorizon(b, op).catch((): LecturaDePago => ({ tipo: "sin-consulta" }));
    if (h.tipo !== "sin-consulta") return { lectura: h, horizonFallo: false };
    horizonFallo = true;
  } else horizonFallo = true;
  if (op.sinRpc) return { lectura: { tipo: "sin-consulta" }, horizonFallo };
  for (const url of (op.rpcs ?? RPC_LISTAS[b.red]).slice(0, MAX_RPC)) {
    const r = await porRpc(b, op, url).catch((): LecturaDePago => ({ tipo: "sin-consulta" }));
    if (r.tipo !== "sin-consulta") return { lectura: r, horizonFallo };
  }
  return { lectura: { tipo: "sin-consulta" }, horizonFallo };
}

export async function buscarPago(b: BusquedaDePago, op: OpcionesDeLectura = {}): Promise<LecturaDePago> {
  return (await buscarPagoConDetalle(b, op)).lectura;
}

/* ---------------------------------------------------------------- el lector */

export interface OpcionesDelLectorDePagos extends OpcionesDeLectura {
  /** Para las pruebas: otro reloj, en milisegundos. */
  ahora?: () => number;
  /** Cuánto dura lo que se leyó antes de volver a preguntar (45 s). Un pago encontrado no vence. */
  vigenciaMs?: number;
  /** Cuánto se espera, como mínimo, entre dos consultas forzadas de lo mismo (5 s). */
  entreForzadasMs?: number;
  /** Tras un Horizon que no contestó, cuánto se va directo al RPC (30 s). */
  reposoMs?: number;
}

export type LectorDePagos = (b: BusquedaDePago, forzar?: boolean) => Promise<LecturaDePago>;

/**
 * Un lector con memoria corta, para una página: el mismo pedido que ya está en camino no se repite, lo que se leyó vale
 * `vigenciaMs`, y "Actualizar" (`forzar`) vuelve a preguntar pero no más seguido que cada `entreForzadasMs`. Lo que no se
 * pudo consultar no se guarda: la próxima vez se vuelve a preguntar. Un pago encontrado se guarda para siempre (los pagos
 * no se deshacen). Tras un Horizon que no contestó, los pedidos siguientes van directo al RPC un rato, salvo "Actualizar".
 */
export function crearLectorDePagos(op: OpcionesDelLectorDePagos = {}): LectorDePagos {
  const ahora = op.ahora ?? Date.now;
  const vigencia = op.vigenciaMs ?? 45_000;
  const entreForzadas = op.entreForzadasMs ?? 5_000;
  const reposo = op.reposoMs ?? 30_000;
  const hechas = new Map<string, { en: number; lectura: Promise<LecturaDePago>; pagado: boolean }>();
  const horizonCaidoHasta = new Map<NetworkName, number>();
  return (b, forzar = false) => {
    const clave = [b.red, b.destino, b.activo.code, b.activo.issuer, b.nota, b.pagadoras.join(","), b.desde].join("|");
    const previa = hechas.get(clave);
    if (previa) {
      const edad = ahora() - previa.en;
      if (previa.pagado || edad < (forzar ? entreForzadas : vigencia)) return previa.lectura;
    }
    const hasta = horizonCaidoHasta.get(b.red);
    // "Actualizar" es la persona pidiéndolo: Horizon se vuelve a probar aunque haya fallado hace poco.
    const sinHorizon = !forzar && hasta !== undefined && ahora() < hasta;
    const entrada = { en: ahora(), pagado: false, lectura: Promise.resolve<LecturaDePago>({ tipo: "sin-consulta" }) };
    entrada.lectura = buscarPagoConDetalle(b, { ...op, sinHorizon }).then(({ lectura, horizonFallo }) => {
      if (horizonFallo && !sinHorizon) horizonCaidoHasta.set(b.red, ahora() + reposo);
      if (lectura.tipo === "pagado") entrada.pagado = true;
      // Lo que no se pudo consultar no se recuerda.
      else if (lectura.tipo === "sin-consulta" && hechas.get(clave) === entrada) hechas.delete(clave);
      return lectura;
    });
    hechas.set(clave, entrada);
    return entrada.lectura;
  };
}
