/**
 * La lista blanca del portero: qué transacciones se pagan. Es estricta a propósito:
 * una sola operación, el contrato oficial, `seal` o `draw`, y nada más. Todo lo que
 * no está en la lista da 400 (o 403) sin gastar cupo ni un centavo.
 *
 * Orden (de lo más barato a lo más caro, ver README.md):
 *   1. el XDR se entiende y es una transacción común (no un fee-bump, no la versión vieja);
 *   2. una sola operación, sin origen propio, que invoca el contrato oficial con `seal` o `draw`;
 *   3. en `seal`, `organizer` es la cuenta de origen; las autorizaciones son de esa cuenta;
 *   (sin memo; el memo no se paga ni se acepta)
 *   4. tiene datos de recursos, sin entradas para restaurar y por debajo del tope;
 *   5. ventana de tiempo corta;
 *   6. la firma de la cuenta de origen es de verdad. Recién ahí algo puede contarse.
 *
 * La firma vale si los pesos de las firmas válidas alcanzan el umbral medio de la cuenta
 * (es el que pide `invokeHostFunction`), según los firmantes y umbrales que la cadena dice.
 * Se verifican a lo sumo `MAX_FIRMAS_VERIFICADAS` firmas.
 *
 * Las firmas se verifican con WebCrypto (Ed25519 nativo): la implementación en
 * JavaScript puro del SDK gasta más CPU de lo que el plan gratis da por pedido.
 */
import { StrKey, TransactionBuilder, xdr } from "@stellar/stellar-sdk/base";

export type Metodo = "seal" | "draw";

/** Quién puede firmar por una cuenta y cuánto hace falta, leído de la cadena. */
export interface Autoridad {
  /** Las llaves Ed25519 que firman por la cuenta (la maestra incluida, con su peso), crudas de 32 bytes. */
  firmantes: Array<{ clave: Uint8Array; peso: number }>;
  /** El umbral medio de la cuenta. */
  umbral: number;
}

/** Cuántas firmas de un sobre se verifican como máximo: lo demás se ignora y no gasta CPU. */
export const MAX_FIRMAS_VERIFICADAS = 5;

export interface ReglasLista {
  passphrase: string;
  /** El contrato oficial de la red, de `deployments.json`. */
  contractId: string;
  /** La hora de la red, en segundos. */
  ahoraS: number;
  /** Lo más que se paga por una transacción, en stroops. */
  topeTx: number;
  /** Lo más que puede faltar para que venza la transacción, en segundos. */
  ventanaMaxS: number;
  /**
   * Lo más que la transacción puede declarar de comisión de inclusión (el total menos los recursos), en stroops.
   * La oferta del fee-bump sale de nuestra configuración y nunca de lo declarado, pero la red exige que sea
   * al menos igual a la de la transacción interna: una inclusión declarada por encima no se paga.
   */
  inclusionMax?: number;
  /**
   * Los firmantes y umbrales de la cuenta de origen, leídos de la cadena. Se pide recién cuando
   * todo lo demás de la lista blanca pasó y hay alguna firma. Devuelve null si la cuenta no existe
   * (o si no se sabe): entonces solo vale la llave de la propia cuenta, con peso 1.
   */
  autoridad?: (cuenta: string) => Promise<Autoridad | null>;
}

export interface TxAceptada {
  /** El hash de la transacción interna (el que ve `envio.ts`), en hex. */
  hash: string;
  /** La cuenta de origen (G…). */
  cuenta: string;
  metodo: Metodo;
  /** La comisión de recursos que declara la transacción, en stroops. */
  resourceFee: number;
  /** El total que declara pagar la transacción interna, en stroops. */
  feeDeclarado: number;
  /** El `maxTime` de la ventana, en segundos. */
  venceS: number;
  /** En `seal`, cuántos ganadores pide (`num_winners`); en `draw`, null. */
  ganadores: number | null;
  /**
   * En `seal`, la huella de la lista (argumento 1, en hexadecimal) y la ronda de drand (argumento 4): lo que el portero
   * anota de cada sello que paga, para saber después si un `draw` es de un sello suyo. En `draw`, o si no se puede leer, null.
   */
  sello: { huellaLista: string; ronda: number } | null;
}

export type MotivoRechazo = "xdr" | "no-permitida" | "ventana" | "fee-alta" | "restaurar" | "firma";

export type Veredicto = { ok: true; tx: TxAceptada } | { ok: false; estado: 400; motivo: MotivoRechazo; detalle: string };

const rechazo = (motivo: MotivoRechazo, detalle: string): Veredicto => ({ ok: false, estado: 400, motivo, detalle });

/** Los bytes de un valor del XDR nuevo, que guarda su contenido en `.value` o es el propio arreglo. */
function bytesDe(v: unknown): Uint8Array | null {
  if (v instanceof Uint8Array) return v;
  if (v && typeof v === "object" && "value" in v && (v as { value: unknown }).value instanceof Uint8Array) return (v as { value: Uint8Array }).value;
  return null;
}

function hex(b: Uint8Array): string {
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

/** Los bytes de la dirección del contrato oficial, para comparar sin armar textos. */
function contratoEnBytes(contractId: string): Uint8Array {
  return StrKey.decodeContract(contractId);
}

function iguales(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= (a[i] as number) ^ (b[i] as number);
  return d === 0;
}

/** Verifica una firma Ed25519 con WebCrypto. Una clave o una firma malformadas dan false, nunca una excepción. */
export async function verificarFirma(clavePublica: Uint8Array, firma: Uint8Array, mensaje: Uint8Array): Promise<boolean> {
  try {
    const clave = await crypto.subtle.importKey("raw", clavePublica as BufferSource, { name: "Ed25519" }, false, ["verify"]);
    return await crypto.subtle.verify({ name: "Ed25519" }, clave, firma as BufferSource, mensaje as BufferSource);
  } catch {
    return false;
  }
}

/**
 * Suma los pesos de las firmas válidas, cada firmante una sola vez. Mira a lo sumo
 * `MAX_FIRMAS_VERIFICADAS` firmas del sobre: mandar más con la misma pista no cuesta más CPU.
 */
async function pesoDeLasFirmas(firmas: ReadonlyArray<{ hint: unknown; signature: unknown }>, hash: Uint8Array, aut: Autoridad): Promise<{ peso: number }> {
  const contados = new Set<string>();
  let peso = 0;
  for (const f of firmas.slice(0, MAX_FIRMAS_VERIFICADAS)) {
    const pista = bytesDe(f.hint);
    const firma = bytesDe(f.signature);
    if (!pista || !firma) continue;
    for (const k of aut.firmantes) {
      if (k.peso <= 0 || k.clave.length !== 32 || !iguales(pista, k.clave.slice(28, 32)) || contados.has(hex(k.clave))) continue;
      if (await verificarFirma(k.clave, firma, hash)) {
        contados.add(hex(k.clave));
        peso += k.peso;
        break;
      }
    }
  }
  return { peso };
}

/**
 * Decide si una transacción firmada entra en la lista blanca. No cuenta ni guarda nada.
 * Todo lo que no se pueda leer o no sea exactamente lo esperado se rechaza.
 */
export async function evaluar(xdrBase64: string, r: ReglasLista): Promise<Veredicto> {
  let env: xdr.TransactionEnvelope;
  try {
    env = xdr.TransactionEnvelope.fromXDR(xdrBase64, "base64");
  } catch {
    return rechazo("xdr", "no se entiende");
  }
  if (env.type === "envelopeTypeTxFeeBump") return rechazo("no-permitida", "fee-bump");
  if (env.type !== "envelopeTypeTx") return rechazo("no-permitida", "version");
  const sobre = env.value;
  const t = sobre.tx;

  // 2. Una sola operación, sin origen propio.
  if (t.operations.length !== 1) return rechazo("no-permitida", "operaciones");
  const op = t.operations[0];
  if (!op || op.sourceAccount !== null) return rechazo("no-permitida", "origen-de-operacion");
  if (op.body.type !== "invokeHostFunction") return rechazo("no-permitida", "tipo");
  const invocacion = op.body.value;
  const fn = invocacion.hostFunction;
  if (fn.type !== "hostFunctionTypeInvokeContract") return rechazo("no-permitida", "funcion");
  const llamada = fn.value;
  if (llamada.contractAddress.type !== "scAddressTypeContract") return rechazo("no-permitida", "contrato");
  const direccion = bytesDe(llamada.contractAddress.value);
  if (!direccion || !iguales(direccion, contratoEnBytes(r.contractId))) return rechazo("no-permitida", "contrato");
  const nombre = String(llamada.functionName);
  if (nombre !== "seal" && nombre !== "draw") return rechazo("no-permitida", "metodo");
  const metodo: Metodo = nombre;

  // Sin memo: no cuesta ni cambia nada, pero la lista es estricta en todos los campos.
  if (t.memo.type !== "memoNone") return rechazo("no-permitida", "memo");

  // Cuenta de origen: una G… común, nunca una cuenta multiplexada.
  if (t.sourceAccount.type !== "keyTypeEd25519") return rechazo("no-permitida", "origen");
  const origenCrudo = bytesDe(t.sourceAccount.value);
  if (!origenCrudo || origenCrudo.length !== 32) return rechazo("no-permitida", "origen");
  const cuenta = StrKey.encodeEd25519PublicKey(origenCrudo as never);

  // 3. Los argumentos tienen la forma exacta del contrato, y en `seal` el organizador es quien manda la transacción.
  const args = llamada.args;
  const forma = metodo === "seal" ? ["scvAddress", "scvBytes", "scvU32", "scvU32", "scvU64", "scvString"] : ["scvU64", "scvBytes"];
  if (args.length !== forma.length || args.some((a, i) => a.type !== forma[i])) return rechazo("no-permitida", "argumentos");
  let ganadores: number | null = null;
  let sello: TxAceptada["sello"] = null;
  if (metodo === "seal") {
    const organizador = args[0];
    if (!organizador || organizador.type !== "scvAddress") return rechazo("no-permitida", "argumentos");
    const dir = organizador.value;
    if (dir.type !== "scAddressTypeAccount") return rechazo("no-permitida", "organizador");
    const crudo = bytesDe(dir.value.ed25519);
    if (!crudo || !iguales(crudo, origenCrudo)) return rechazo("no-permitida", "organizador");
    const lista = bytesDe(args[1]?.value) ?? new Uint8Array();
    if (lista.length !== 32) return rechazo("no-permitida", "argumentos");
    // Solo se lee: no cambia qué se acepta. Lo que no se pueda leer queda en null y el sello cuenta como el más caro.
    const g = Number(args[3]?.value);
    ganadores = Number.isInteger(g) && g >= 0 ? g : null;
    const ronda = enteroSeguro(args[4]?.value);
    sello = ronda === null ? null : { huellaLista: hex(lista), ronda };
  } else if ((bytesDe(args[1]?.value) ?? new Uint8Array()).length !== 96) {
    return rechazo("no-permitida", "argumentos");
  }
  // Autorizaciones: solo las de la cuenta de origen (que ya firma la transacción). Una dirección ajena, nunca.
  for (const a of invocacion.auth) {
    if (a.credentials.type !== "sorobanCredentialsSourceAccount") return rechazo("no-permitida", "autorizacion");
  }

  // 4. Datos de recursos: sin entradas para restaurar y por debajo del tope.
  if (t.ext.type !== "sorobanData") return rechazo("no-permitida", "sin-recursos");
  const datos = t.ext.value;
  if (datos.ext.type === "resourceExt" && datos.ext.value.archivedSorobanEntries.length > 0) return rechazo("restaurar", "entradas-archivadas");
  const resourceFee = Number(datos.resourceFee);
  const feeDeclarado = Number(t.fee);
  if (!Number.isFinite(resourceFee) || resourceFee < 0 || resourceFee > r.topeTx) return rechazo("fee-alta", "recursos");
  if (feeDeclarado > r.topeTx || feeDeclarado < resourceFee) return rechazo("fee-alta", "total");
  if (r.inclusionMax !== undefined && feeDeclarado - resourceFee > r.inclusionMax) return rechazo("fee-alta", "inclusion");

  // 5. Ventana de tiempo: de 5 minutos o menos, y sin vencer.
  if (t.cond.type !== "precondTime") return rechazo("ventana", "sin-ventana");
  const maxS = Number(t.cond.value.maxTime);
  if (!Number.isFinite(maxS) || maxS === 0) return rechazo("ventana", "sin-limite");
  if (maxS < r.ahoraS) return rechazo("ventana", "vencida");
  if (maxS - r.ahoraS > r.ventanaMaxS) return rechazo("ventana", "larga");

  // 6. Las firmas, contra el hash de esta red y contra los firmantes y umbrales de la cuenta. Si son de otra red o de otra cuenta, no valen.
  let hash: Uint8Array;
  try {
    hash = TransactionBuilder.fromXDR(xdrBase64, r.passphrase).hash();
  } catch {
    return rechazo("xdr", "hash");
  }
  if (sobre.signatures.length === 0) return rechazo("firma", "sin-firma-valida");
  const autoridad = (await r.autoridad?.(cuenta)) ?? { firmantes: [{ clave: origenCrudo, peso: 1 }], umbral: 1 };
  const alcanzado = await pesoDeLasFirmas(sobre.signatures, hash, autoridad);
  if (alcanzado.peso <= 0) return rechazo("firma", "sin-firma-valida");
  if (alcanzado.peso < Math.max(1, autoridad.umbral)) return rechazo("firma", "peso-insuficiente");

  return { ok: true, tx: { hash: hex(hash), cuenta, metodo, resourceFee, feeDeclarado, venceS: maxS, ganadores, sello } };
}

/** Un `u64` del XDR como número, si entra sin perder precisión; si no, null. */
function enteroSeguro(v: unknown): number | null {
  try {
    const b = typeof v === "bigint" ? v : BigInt(String(v));
    return b >= 0n && b <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(b) : null;
  } catch {
    return null;
  }
}

/** Si un texto es una cuenta G… válida. */
export function esCuenta(g: string): boolean {
  return StrKey.isValidEd25519PublicKey(g);
}
