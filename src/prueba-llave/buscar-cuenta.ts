import { sha256 } from "@noble/hashes/sha2.js";
import { Address, StrKey, TransactionBuilder, rpc, xdr } from "@stellar/stellar-sdk";
import { RED_DE_PRUEBA } from "./red";

/**
 * Entrar desde otro aparato con la misma llave, sin ningún índice ajeno. La dirección de la cuenta se calcula de la llave y
 * del desplegador compartido. Con ella se lee la instancia en la red, que dice en qué ledger se escribió por última vez, y
 * en ese ledger se busca la transacción que creó la cuenta, primero en el historial y después en el RPC. Lo que sale es una
 * pista: hash, ledger y código de nacimiento. El kit no confía en ella. La verifica entera contra la red antes de usarla.
 *
 * Usa solo el SDK del sitio. Sin el navegador: el servidor y el `fetch` entran por parámetro y las pruebas ponen los suyos.
 */

export type MotivoDeBusqueda = "sin-cuenta" | "vencida" | "red" | "sin-nacimiento" | "ambigua";
export type Fuente = "historial" | "rpc";

export interface Pista {
  contractId: string;
  creationTransactionHash: string;
  creationLedger: number;
  /** El código con que nació la cuenta, en hexadecimal. */
  birthWasmHash: string;
  fuente: Fuente;
}

export type ResultadoDeBusqueda = { ok: true; pista: Pista } | { ok: false; motivo: MotivoDeBusqueda; detalle: string };

/** Lo que se usa del servidor del SDK: así una prueba pone el suyo. */
export interface ServidorDeBusqueda {
  getHealth(): Promise<{ oldestLedger: number; latestLedger: number }>;
  getContractData(contract: string, key: xdr.ScVal): Promise<{ lastModifiedLedgerSeq?: number; liveUntilLedgerSeq?: number }>;
}

export interface OpcionesDeBusqueda {
  fetchFn?: typeof fetch;
  servidor?: ServidorDeBusqueda;
  dormir?: (ms: number) => Promise<void>;
  /** Si se pide una sola fuente, la otra no se mira. Con `null` o sin valor se prueba el historial y después el RPC. */
  fuente?: Fuente | null;
  /** Cuánto se espera cada pedido, en milisegundos. */
  topeMs?: number;
}

/* ------------------------------------------------------------------ la dirección */

const ENVELOPE_TYPE_CONTRACT_ID = 8;
const CONTRACT_ID_PREIMAGE_FROM_ADDRESS = 0;
const SC_ADDRESS_TYPE_ACCOUNT = 0;
const PUBLIC_KEY_TYPE_ED25519 = 0;

const entero32 = (n: number): Uint8Array => {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setInt32(0, n);
  return b;
};

function juntar(partes: Uint8Array[]): Uint8Array {
  const salida = new Uint8Array(partes.reduce((n, p) => n + p.length, 0));
  let al = 0;
  for (const p of partes) {
    salida.set(p, al);
    al += p.length;
  }
  return salida;
}

/** De base64url (como lo da el navegador) a los bytes de la credencial. */
export function bytesDeLaCredencial(credentialId: string): Uint8Array {
  const b64 = credentialId.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

/** La sal con que el kit crea la cuenta: el SHA-256 de los bytes de la credencial. */
export function salDeLaLlave(credentialId: string): Uint8Array {
  return sha256(bytesDeLaCredencial(credentialId));
}

/**
 * La dirección de un contrato creado desde una cuenta con una sal. Son los 112 bytes de la preimagen que define la red
 * (tipo de sobre, clave de la red, tipo de preimagen, tipo de dirección, tipo de clave, la clave y la sal) con su SHA-256.
 */
export function direccionDeContrato(desplegador: string, sal: Uint8Array, passphrase: string = RED_DE_PRUEBA.passphrase): string {
  if (sal.length !== 32) throw new Error("sal-de-largo-malo");
  const preimagen = juntar([
    entero32(ENVELOPE_TYPE_CONTRACT_ID),
    sha256(new TextEncoder().encode(passphrase)),
    entero32(CONTRACT_ID_PREIMAGE_FROM_ADDRESS),
    entero32(SC_ADDRESS_TYPE_ACCOUNT),
    entero32(PUBLIC_KEY_TYPE_ED25519),
    StrKey.decodeEd25519PublicKey(desplegador),
    sal,
  ]);
  return StrKey.encodeContract(sha256(preimagen));
}

/** La dirección que tendría la cuenta de una llave, con el desplegador compartido. */
export function direccionDeLaLlave(credentialId: string): string {
  return direccionDeContrato(RED_DE_PRUEBA.desplegador, salDeLaLlave(credentialId));
}

/* ------------------------------------------------------------------ leer una creación */

type Obj = Record<string, unknown>;
const obj = (x: unknown): Obj | null => (typeof x === "object" && x !== null ? (x as Obj) : null);

/** La rama de una unión del XDR: el campo con su nombre o, si no, el genérico `value`. */
function rama(x: unknown, nombre: string): Obj | null {
  const o = obj(x);
  if (!o) return null;
  return obj(o[nombre]) ?? obj(o["value"]);
}

function bytesDe(v: unknown): Uint8Array | null {
  if (v instanceof Uint8Array) return v;
  const o = obj(v);
  if (o && o["value"] instanceof Uint8Array) return o["value"];
  return null;
}

const hex = (b: Uint8Array): string => Array.from(b, (n) => n.toString(16).padStart(2, "0")).join("");

/** El código de nacimiento de cada operación del sobre que crea exactamente la dirección pedida. */
export function creacionesDe(envelopeB64: string, destino: string): string[] | "ilegible" {
  let operaciones: unknown[];
  try {
    operaciones = TransactionBuilder.fromXDR(envelopeB64, RED_DE_PRUEBA.passphrase).operations as unknown[];
  } catch {
    return "ilegible";
  }
  const codigos: string[] = [];
  for (const op of operaciones) {
    const o = obj(op);
    if (!o || o["type"] !== "invokeHostFunction") continue;
    const f = obj(o["func"]);
    if (!f || f["type"] !== "hostFunctionTypeCreateContractV2") continue;
    const crear = rama(f, "createContractV2");
    const preimagen = obj(crear?.["contractIdPreimage"]);
    if (!crear || !preimagen || preimagen["type"] !== "contractIdPreimageFromAddress") continue;
    const desde = rama(preimagen, "fromAddress");
    const sal = bytesDe(desde?.["salt"]);
    if (!desde || !sal) continue;
    let direccion: string;
    try {
      direccion = direccionDeContrato(Address.fromScAddress(desde["address"] as xdr.ScAddress).toString(), sal);
    } catch {
      continue;
    }
    if (direccion !== destino) continue;
    const ejecutable = obj(crear["executable"]);
    const codigo = ejecutable && ejecutable["type"] === "contractExecutableWasm" ? bytesDe(ejecutable["wasmHash"]) : null;
    codigos.push(codigo ? hex(codigo) : "");
  }
  return codigos;
}

/* ------------------------------------------------------------------ las fuentes */

interface Transaccion {
  hash: string;
  envelopeXdr: string;
}

type LecturaDeFuente = { estado: "ok"; transacciones: Transaccion[] } | { estado: "no-esta" } | { estado: "red"; detalle: string };

const MAXIMO_DE_PAGINAS = 30;

/** Las transacciones exitosas de un ledger, del historial de la red, página por página. */
async function desdeElHistorial(ledger: number, fetchFn: typeof fetch, topeMs: number): Promise<LecturaDeFuente> {
  const transacciones: Transaccion[] = [];
  let url: string = `${RED_DE_PRUEBA.horizon}/ledgers/${ledger}/transactions?limit=200`;
  for (let pagina = 0; pagina < MAXIMO_DE_PAGINAS; pagina++) {
    let res: Response;
    try {
      res = await fetchFn(url, { signal: AbortSignal.timeout(topeMs) });
    } catch (e) {
      return { estado: "red", detalle: `historial: ${e instanceof Error ? e.message : "sin-respuesta"}` };
    }
    if (res.status === 404 && pagina === 0) return { estado: "no-esta" };
    if (!res.ok) return { estado: "red", detalle: `historial ${res.status}` };
    let cuerpo: unknown;
    try {
      cuerpo = await res.json();
    } catch {
      return { estado: "red", detalle: "historial: respuesta ilegible" };
    }
    const registros = obj(obj(cuerpo)?.["_embedded"])?.["records"];
    if (!Array.isArray(registros)) return { estado: "red", detalle: "historial: sin registros" };
    if (registros.length === 0) return { estado: "ok", transacciones };
    for (const r of registros) {
      const t = obj(r);
      if (!t || t["successful"] !== true || t["ledger"] !== ledger) continue;
      if (typeof t["hash"] === "string" && typeof t["envelope_xdr"] === "string") transacciones.push({ hash: t["hash"].toLowerCase(), envelopeXdr: t["envelope_xdr"] });
    }
    const siguiente = obj(obj(obj(cuerpo)?.["_links"])?.["next"])?.["href"];
    // Solo se sigue por el mismo anfitrión: lo que dice la respuesta no manda a ninguna otra parte.
    if (typeof siguiente !== "string" || !siguiente.startsWith(`${RED_DE_PRUEBA.horizon}/`)) return { estado: "ok", transacciones };
    url = siguiente;
  }
  return { estado: "red", detalle: "historial: demasiadas páginas" };
}

const POR_PAGINA_DEL_RPC = 20;

/** Lo mismo desde el RPC, con JSON-RPC a mano para que el SDK no decodifique lo que pesa. Corta en el primer ledger mayor. */
async function desdeElRpc(ledger: number, fetchFn: typeof fetch, topeMs: number): Promise<LecturaDeFuente> {
  const transacciones: Transaccion[] = [];
  let cursor: string | null = null;
  for (let pagina = 0; pagina < MAXIMO_DE_PAGINAS; pagina++) {
    const params = cursor === null ? { startLedger: ledger, pagination: { limit: POR_PAGINA_DEL_RPC } } : { pagination: { cursor, limit: POR_PAGINA_DEL_RPC } };
    let cuerpo: unknown;
    try {
      const res = await fetchFn(RED_DE_PRUEBA.rpc, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getTransactions", params }),
        signal: AbortSignal.timeout(topeMs),
      });
      if (!res.ok) return { estado: "red", detalle: `rpc ${res.status}` };
      cuerpo = await res.json();
    } catch (e) {
      return { estado: "red", detalle: `rpc: ${e instanceof Error ? e.message : "sin-respuesta"}` };
    }
    const error = obj(obj(cuerpo)?.["error"]);
    if (error) return { estado: "red", detalle: `rpc ${String(error["code"] ?? "")}`.trim() };
    const resultado = obj(obj(cuerpo)?.["result"]);
    const lista = resultado?.["transactions"] ?? [];
    if (!Array.isArray(lista)) return { estado: "red", detalle: "rpc: respuesta inesperada" };
    for (const r of lista) {
      const t = obj(r);
      const delLedger = Number(t?.["ledger"]);
      if (!t || !Number.isFinite(delLedger)) continue;
      if (delLedger > ledger) return { estado: "ok", transacciones };
      if (delLedger === ledger && t["status"] === "SUCCESS" && typeof t["txHash"] === "string" && typeof t["envelopeXdr"] === "string") {
        transacciones.push({ hash: t["txHash"].toLowerCase(), envelopeXdr: t["envelopeXdr"] });
      }
    }
    const siguiente = resultado?.["cursor"];
    if (lista.length === 0 || typeof siguiente !== "string" || siguiente === "") return { estado: "ok", transacciones };
    cursor = siguiente;
  }
  return { estado: "red", detalle: "rpc: demasiadas páginas" };
}

/* ------------------------------------------------------------------ la búsqueda */

const noEncontrado = (e: unknown): boolean => obj(e)?.["code"] === 404;

/** Qué tiene la instancia de la cuenta en la red. */
type LecturaDeInstancia = { estado: "ok"; ledger: number } | { estado: "sin-cuenta" } | { estado: "vencida" } | { estado: "red"; detalle: string };

async function leerInstancia(direccion: string, o: { servidor: ServidorDeBusqueda; dormir: (ms: number) => Promise<void>; latestLedger: number }): Promise<LecturaDeInstancia> {
  for (let intento = 0; intento < 2; intento++) {
    try {
      const e = await o.servidor.getContractData(direccion, xdr.ScVal.scvLedgerKeyContractInstance());
      const ledger = Number(e.lastModifiedLedgerSeq);
      if (e.liveUntilLedgerSeq !== undefined && Number(e.liveUntilLedgerSeq) < o.latestLedger) return { estado: "vencida" };
      if (!Number.isSafeInteger(ledger) || ledger < 1) return { estado: "red", detalle: "instancia sin ledger" };
      return { estado: "ok", ledger };
    } catch (err) {
      if (!noEncontrado(err)) return { estado: "red", detalle: `instancia: ${err instanceof Error ? err.message : "sin-respuesta"}` };
      // La red a veces tarda en mostrar lo recién escrito: se vuelve a mirar una vez.
      if (intento === 0) await o.dormir(2_000);
    }
  }
  return { estado: "sin-cuenta" };
}

const falla = (motivo: MotivoDeBusqueda, detalle: string): ResultadoDeBusqueda => ({ ok: false, motivo, detalle });

/** Busca el nacimiento de la cuenta de una llave: calcula su dirección y sigue en `buscarPorDireccion`. */
export async function buscarNacimiento(credentialId: string, o: OpcionesDeBusqueda = {}): Promise<ResultadoDeBusqueda> {
  let destino: string;
  try {
    destino = direccionDeLaLlave(credentialId);
  } catch {
    return falla("sin-cuenta", "credencial-ilegible");
  }
  return buscarPorDireccion(destino, o);
}

/**
 * Busca el nacimiento de la cuenta de una dirección. Devuelve la pista o el motivo por el que no hay: `sin-cuenta` (no
 * existe), `vencida` (existió y ya terminó), `red` (no se pudo leer ahora), `sin-nacimiento` (existe pero ninguna creación
 * de ese ledger la crea) o `ambigua` (más de una).
 */
export async function buscarPorDireccion(destino: string, o: OpcionesDeBusqueda = {}): Promise<ResultadoDeBusqueda> {
  const fetchFn = o.fetchFn ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const dormir = o.dormir ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const topeMs = o.topeMs ?? 15_000;
  const servidor = o.servidor ?? (new rpc.Server(RED_DE_PRUEBA.rpc) as unknown as ServidorDeBusqueda);

  let salud: { oldestLedger: number; latestLedger: number };
  try {
    const h = await servidor.getHealth();
    salud = { oldestLedger: Number(h.oldestLedger), latestLedger: Number(h.latestLedger) };
  } catch (e) {
    return falla("red", `salud: ${e instanceof Error ? e.message : "sin-respuesta"}`);
  }

  const instancia = await leerInstancia(destino, { servidor, dormir, latestLedger: salud.latestLedger });
  if (instancia.estado === "sin-cuenta") return falla("sin-cuenta", destino);
  if (instancia.estado === "vencida") return falla("vencida", destino);
  if (instancia.estado === "red") return falla("red", instancia.detalle);
  const ledger = instancia.ledger;

  let lectura: LecturaDeFuente = { estado: "no-esta" };
  let fuente: Fuente = "historial";
  if (o.fuente !== "rpc") lectura = await desdeElHistorial(ledger, fetchFn, topeMs);
  if (o.fuente !== "historial" && lectura.estado !== "ok") {
    // El RPC solo guarda unos días: un ledger más viejo que su primer ledger no está ahí.
    if (ledger >= salud.oldestLedger) {
      lectura = await desdeElRpc(ledger, fetchFn, topeMs);
      fuente = "rpc";
    } else if (lectura.estado === "no-esta") {
      lectura = { estado: "red", detalle: "ledger fuera del RPC y sin historial" };
    }
  }
  if (lectura.estado === "no-esta") return falla("red", "historial: todavía no tiene el ledger");
  if (lectura.estado === "red") return falla("red", lectura.detalle);

  const coincidencias: Array<{ hash: string; codigo: string }> = [];
  for (const t of lectura.transacciones) {
    const codigos = creacionesDe(t.envelopeXdr, destino);
    if (codigos === "ilegible") continue;
    for (const codigo of codigos) coincidencias.push({ hash: t.hash, codigo });
  }
  if (coincidencias.length === 0) return falla("sin-nacimiento", `ledger ${ledger}`);
  const unica = coincidencias[0];
  if (coincidencias.length > 1 || !unica) return falla("ambigua", `ledger ${ledger}`);
  if (!/^[0-9a-f]{64}$/.test(unica.codigo)) return falla("sin-nacimiento", "sin código de nacimiento");
  return { ok: true, pista: { contractId: destino, creationTransactionHash: unica.hash, creationLedger: ledger, birthWasmHash: unica.codigo, fuente } };
}
