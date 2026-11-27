import { scValToNative, xdr } from "@stellar/stellar-sdk";

/**
 * Lo que cobró la red y lo que escribió una transacción, leído de lo que contesta `getTransaction`. Nada se estima: si un
 * dato no está, queda en cero o en `null`, dicho tal cual.
 *
 * El XDR del SDK 17 trae uniones con un campo `type` y una rama con nombre (`v4`, `v1`, `created`), y además el campo
 * genérico `value`. Se lee con las dos formas y sin suponer los tipos exactos: lo que no se entiende da cero, nunca lanza.
 */

/** Lo que importa de la respuesta cruda de `getTransaction`. */
export interface RespuestaCruda {
  status?: string;
  hash?: string;
  ledger?: number | string;
  createdAt?: number | string;
  envelopeXdr?: string;
  resultXdr?: string;
  resultMetaXdr?: string;
  diagnosticEventsXdr?: unknown;
  /** Los eventos de la transacción: uno de contrato por operación, cada uno con sus eventos en base64. */
  events?: { transactionEventsXdr?: string[]; contractEventsXdr?: string[][] };
  /** La hora de cierre del último ledger que conoce el RPC, en segundos. */
  latestLedgerCloseTime?: number | string;
}

export interface EventosDeComision {
  /** Lo cobrado, en stroops. */
  cobro: number;
  /** Lo devuelto después, en stroops (positivo). */
  reembolso: number;
  neto: number;
}

export interface Declarado {
  instrucciones: number;
  bytesLeidosDisco: number;
  bytesEscritos: number;
  entradasSoloLectura: number;
  entradasLecturaEscritura: number;
  /** La comisión por recursos que la transacción declaró que pagaría, en stroops. */
  recursoDeclarado: number;
}

export interface Medido {
  cpu_insn: number;
  mem_byte: number;
  read_key_byte: number;
  write_data_byte: number;
}

export interface Escrito {
  tipo: string;
  durabilidad?: string;
  bytes: number;
  cambio: "creada" | "actualizada" | "restaurada";
}

export interface Cobro {
  hash: string;
  ledger: number;
  estado: string;
  totalStroops: number;
  inclusionStroops: number;
  recursosNoReembolsables: number;
  recursosReembolsables: number;
  alquiler: number;
  eventosDeComision: EventosDeComision | null;
  declarado: Declarado;
  medido: Medido | null;
  escrito: Escrito[];
  bytesDeLaTransaccion: number;
}

type Obj = Record<string, unknown>;

const obj = (x: unknown): Obj | null => (typeof x === "object" && x !== null ? (x as Obj) : null);

/** Un número de un entero grande, o cero. */
function num(x: unknown): number {
  try {
    const n = Number(x);
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

/** La rama de una unión: el campo con su nombre o, si no, el genérico `value`. */
function rama(x: unknown, nombre: string): Obj | null {
  const o = obj(x);
  if (!o) return null;
  return obj(o[nombre]) ?? obj(o["value"]);
}

/** Los bytes de un XDR en base64, sin decodificarlo. */
export function bytesDeBase64(b64: string): number {
  const limpio = b64.trim();
  if (!limpio) return 0;
  const relleno = limpio.endsWith("==") ? 2 : limpio.endsWith("=") ? 1 : 0;
  return Math.floor((limpio.length * 3) / 4) - relleno;
}

/** El largo en bytes de un valor del XDR que sabe escribirse en base64, o cero. */
function bytesDeUnValor(x: unknown): number {
  try {
    const f = obj(x)?.["toXDR"];
    if (typeof f !== "function") return 0;
    const b64 = (f as (formato: string) => unknown).call(x, "base64");
    return typeof b64 === "string" ? bytesDeBase64(b64) : 0;
  } catch {
    return 0;
  }
}

/** Lo que la transacción declaró en su sobre. */
export function declaradoDeSobre(sobre: unknown): Declarado {
  const vacio: Declarado = { instrucciones: 0, bytesLeidosDisco: 0, bytesEscritos: 0, entradasSoloLectura: 0, entradasLecturaEscritura: 0, recursoDeclarado: 0 };
  const tx = obj(rama(sobre, "v1")?.["tx"]);
  const ext = obj(tx?.["ext"]);
  if (!ext) return vacio;
  const datos = rama(ext, "sorobanData");
  if (!datos) return vacio;
  const recursos = obj(datos["resources"]);
  const huella = obj(recursos?.["footprint"]);
  const largo = (x: unknown): number => (Array.isArray(x) ? x.length : 0);
  return {
    instrucciones: num(recursos?.["instructions"]),
    bytesLeidosDisco: num(recursos?.["diskReadBytes"]),
    bytesEscritos: num(recursos?.["writeBytes"]),
    entradasSoloLectura: largo(huella?.["readOnly"]),
    entradasLecturaEscritura: largo(huella?.["readWrite"]),
    recursoDeclarado: num(datos["resourceFee"]),
  };
}

/** Los tres componentes de lo cobrado por recursos, de la parte Soroban de la meta. */
export function recursosDeMeta(sorobanMeta: unknown): { noReembolsables: number; reembolsables: number; alquiler: number } {
  const ext = obj(obj(sorobanMeta)?.["ext"]);
  const v1 = ext && ext["type"] === "v1" ? rama(ext, "v1") : null;
  return {
    noReembolsables: num(v1?.["totalNonRefundableResourceFeeCharged"]),
    reembolsables: num(v1?.["totalRefundableResourceFeeCharged"]),
    alquiler: num(v1?.["rentFeeCharged"]),
  };
}

/** Lo que la meta dice que se creó, se actualizó o se restauró en la primera operación. */
export function escritoDeMeta(operaciones: unknown): Escrito[] {
  const primera = Array.isArray(operaciones) ? obj(operaciones[0]) : null;
  const cambios = primera?.["changes"];
  if (!Array.isArray(cambios)) return [];
  const salida: Escrito[] = [];
  for (const c of cambios) {
    const o = obj(c);
    if (!o) continue;
    const tipo = String(o["type"] ?? "");
    const cambio = tipo === "ledgerEntryCreated" ? "creada" : tipo === "ledgerEntryUpdated" ? "actualizada" : tipo === "ledgerEntryRestored" ? "restaurada" : null;
    if (!cambio) continue;
    const entrada = obj(o["created"] ?? o["updated"] ?? o["restored"]) ?? obj(o["value"]);
    const datos = obj(entrada?.["data"]);
    const clase = String(datos?.["type"] ?? "desconocida");
    const interior = rama(datos, clase);
    // La vida de un dato del contrato es un enumerado con `name` (`persistent`, `temporary`); a mano puede venir como `type`.
    const vida = obj(interior?.["durability"]);
    const durabilidad = vida ? (typeof vida["name"] === "string" ? vida["name"] : typeof vida["type"] === "string" ? vida["type"] : undefined) : undefined;
    salida.push({ tipo: clase, ...(durabilidad ? { durabilidad } : {}), bytes: bytesDeUnValor(entrada), cambio });
  }
  return salida;
}

/** Lo cobrado y devuelto por los eventos `fee` de la transacción, o `null` si no hay. */
export function eventosDeComisionDeMeta(eventos: unknown): EventosDeComision | null {
  if (!Array.isArray(eventos)) return null;
  let cobro = 0;
  let reembolso = 0;
  let hubo = false;
  for (const e of eventos) {
    try {
      const v0 = rama(rama(obj(e)?.["event"], "body"), "v0");
      const temas = v0?.["topics"];
      if (!Array.isArray(temas) || temas.length === 0) continue;
      if (scValToNative(temas[0] as xdr.ScVal) !== "fee") continue;
      const monto = Number(scValToNative(v0?.["data"] as xdr.ScVal) as bigint | number);
      if (!Number.isFinite(monto)) continue;
      hubo = true;
      if (monto >= 0) cobro += monto;
      else reembolso += -monto;
    } catch {
      /* un evento que no se entiende no cuenta */
    }
  }
  return hubo ? { cobro, reembolso, neto: cobro - reembolso } : null;
}

const MEDIDAS: ReadonlyArray<keyof Medido> = ["cpu_insn", "mem_byte", "read_key_byte", "write_data_byte"];

/** Los contadores de `core_metrics` de los eventos de diagnóstico, o `null` si el RPC no los dio. */
export function medidoDeDiagnostico(eventos: unknown[]): Medido | null {
  const m: Partial<Medido> = {};
  for (const e of eventos) {
    try {
      const v0 = rama(rama(obj(e)?.["event"], "body"), "v0");
      const temas = v0?.["topics"];
      if (!Array.isArray(temas) || temas.length < 2) continue;
      if (scValToNative(temas[0] as xdr.ScVal) !== "core_metrics") continue;
      const nombre = String(scValToNative(temas[1] as xdr.ScVal));
      const clave = MEDIDAS.find((k) => k === nombre);
      if (clave) m[clave] = Number(scValToNative(v0?.["data"] as xdr.ScVal) as bigint | number);
    } catch {
      /* un evento que no se entiende no cuenta */
    }
  }
  return MEDIDAS.every((k) => typeof m[k] === "number") ? (m as Medido) : null;
}

/** Las piezas ya decodificadas de una respuesta, para armar el cobro sin tocar el XDR. */
export interface Decodificada {
  hash: string;
  ledger: number;
  estado: string;
  totalStroops: number;
  sobre: unknown;
  bytesDeLaTransaccion: number;
  /** La meta ya reducida a su rama v4 o v3, o `null`. */
  meta: unknown;
  diagnosticos: unknown[];
}

/** El cobro de una transacción a partir de sus piezas decodificadas. */
export function cobroDeLaDecodificada(d: Decodificada): Cobro {
  const meta = obj(d.meta);
  const soroban = meta?.["sorobanMeta"];
  const r = recursosDeMeta(soroban);
  const medidoMeta = Array.isArray(meta?.["diagnosticEvents"]) ? (meta?.["diagnosticEvents"] as unknown[]) : [];
  return {
    hash: d.hash,
    ledger: d.ledger,
    estado: d.estado,
    totalStroops: d.totalStroops,
    inclusionStroops: d.totalStroops - (r.noReembolsables + r.reembolsables),
    recursosNoReembolsables: r.noReembolsables,
    recursosReembolsables: r.reembolsables,
    alquiler: r.alquiler,
    eventosDeComision: eventosDeComisionDeMeta(meta?.["events"]),
    declarado: declaradoDeSobre(d.sobre),
    medido: medidoDeDiagnostico(d.diagnosticos) ?? medidoDeDiagnostico(medidoMeta),
    escrito: escritoDeMeta(meta?.["operations"]),
    bytesDeLaTransaccion: d.bytesDeLaTransaccion,
  };
}

/** La rama v4 (o v3) de una `TransactionMeta`, o `null`. */
function ramaDeMeta(meta: unknown): unknown {
  const o = obj(meta);
  if (!o) return null;
  if (o["type"] === "v4") return rama(o, "v4");
  if (o["type"] === "v3") return rama(o, "v3");
  return null;
}

function tryDecodificar<T>(f: () => T): T | null {
  try {
    return f();
  } catch {
    return null;
  }
}

/** Lee el cobro de la respuesta cruda de `getTransaction`. Nunca lanza: lo que no se puede leer queda en cero. */
export function leerCobro(c: RespuestaCruda): Cobro {
  const resultado = c.resultXdr ? tryDecodificar(() => xdr.TransactionResult.fromXDR(c.resultXdr as string, "base64")) : null;
  const meta = c.resultMetaXdr ? tryDecodificar(() => xdr.TransactionMeta.fromXDR(c.resultMetaXdr as string, "base64")) : null;
  const sobre = c.envelopeXdr ? tryDecodificar(() => xdr.TransactionEnvelope.fromXDR(c.envelopeXdr as string, "base64")) : null;
  const diagnosticos: unknown[] = [];
  if (Array.isArray(c.diagnosticEventsXdr)) {
    for (const d of c.diagnosticEventsXdr) {
      if (typeof d !== "string") continue;
      const e = tryDecodificar(() => xdr.DiagnosticEvent.fromXDR(d, "base64"));
      if (e) diagnosticos.push(e);
    }
  }
  return cobroDeLaDecodificada({
    hash: c.hash ?? "",
    ledger: num(c.ledger),
    estado: c.status ?? "",
    totalStroops: num(obj(resultado)?.["feeCharged"]),
    sobre,
    bytesDeLaTransaccion: c.envelopeXdr ? bytesDeBase64(c.envelopeXdr) : 0,
    meta: ramaDeMeta(meta),
    diagnosticos,
  });
}

/** El valor que devolvió la llamada, de la parte Soroban de la meta, o `undefined` si no hay. */
export function retornoDeMeta(meta: unknown): unknown {
  try {
    const valor = obj(obj(meta)?.["sorobanMeta"])?.["returnValue"];
    return valor ? scValToNative(valor as xdr.ScVal) : undefined;
  } catch {
    return undefined;
  }
}

/** El valor que devolvió la llamada de una transacción que entró: el número del sorteo de `seal`, el registro de `draw`. */
export function retornoDe(c: RespuestaCruda): unknown {
  const meta = c.resultMetaXdr ? tryDecodificar(() => xdr.TransactionMeta.fromXDR(c.resultMetaXdr as string, "base64")) : null;
  return retornoDeMeta(ramaDeMeta(meta));
}
