/**
 * La forma de los pagos clásicos que el portero paga: el pago de un premio y el retiro con su costo. Es el evaluador, y es
 * puro: lee un sobre firmado y dice si tiene exactamente la forma de una de las dos. No tiene red, ni reloj, ni cuentas
 * guardadas: lo que necesita de afuera (la hora, los firmantes de la cuenta) entra como argumento. Por eso se prueba
 * entero con sobres armados a propósito (`armar-pago.ts`).
 *
 * Es aparte de `lista-blanca.ts`: el sello y el sorteo siguen siendo lo único que pasa por `evaluar`, y un pago clásico
 * sigue sin entrar por esa puerta. Mientras nadie llame a estas funciones, el portero hace lo de siempre.
 *
 * Son tres funciones, para que un reenvío de algo que ya está guardado se conteste por su estado y no por su ventana:
 *   1. `leerPago`: la forma del sobre. Sin reloj ni cuentas. Devuelve el hash apenas el sobre se pudo leer.
 *   2. `ventanaDelPago`: que no haya vencido ni venza demasiado lejos. Se corre después de buscar el hash.
 *   3. `firmasDelPago`: que las firmas lleguen al umbral de la cuenta. También después de buscar el hash.
 *
 * Las dos formas, exactas:
 *   - premio: un solo `payment` de USDC de Circle a otra cuenta G, con la nota `tk:premio:<sorteo>:<puesto>`.
 *   - retiro: dos `payment` de USDC de Circle, el primero a otra cuenta G y el segundo a la cuenta de cobros por el costo
 *     exacto, sin una nota que se lea como una orden. El orden es fijo: primero la persona y después el costo.
 * En las dos: sobre común (ni fee-bump ni la versión vieja), origen G que no es del portero, ninguna operación con origen
 * propio, solo condiciones de tiempo, sin datos de Soroban y una comisión declarada de 1000 por operación como mucho.
 *
 * Lo que este archivo no mira, porque pide la red: la existencia de las cuentas, sus líneas y sus saldos, que el sorteo
 * del premio exista y sea de quien paga, y los topes.
 */
import { StrKey, hash, xdr } from "@stellar/stellar-sdk/base";
import { EMISOR_USDC, ordenDeNota, sinSeparadores } from "./cobros";
import { type Autoridad, pesoDeLasFirmas } from "./lista-blanca";
import { leerNumeroDeSorteo } from "./sorteadora";

export type FormaDePago = "premio" | "retiro";

/** Lo más que se acepta declarar de comisión por operación, en stroops. Es menos que la oferta del envoltorio. */
export const COMISION_MAXIMA_POR_OPERACION = 1000;
/** Las firmas que cabe en un sobre. */
export const FIRMAS_MAXIMAS = 20;
/** El puesto más alto de un premio: el contrato admite hasta 300 ganadores y el primer puesto es el 0. */
export const PUESTO_MAXIMO = 299;
/**
 * Lo más lejos que puede vencer un pago, en segundos, aunque `VENTANA_MAX_S` diga más: el sitio arma los pagos a 240 y
 * acepta hasta 300. Una ventana más larga deja más tiempo en el aire un sobre firmado que ya está en duda.
 */
export const VENTANA_MAXIMA_DEL_PAGO_S = 300;

/** El código `USDC` de un activo de cuatro letras, en bytes. */
const CODIGO_USDC = new Uint8Array([0x55, 0x53, 0x44, 0x43]);
/** Quién emite el USDC de Circle, en bytes. */
const EMISOR_EN_BYTES = StrKey.decodeEd25519PublicKey(EMISOR_USDC);
/** La nota de un premio en su forma canónica: sin ceros adelante ni espacios. El comprobante busca la nota exacta. */
const NOTA_DE_PREMIO = /^tk:premio:([1-9]\d{0,19}):(0|[1-9]\d{0,2})$/;

/**
 * Por qué un pago no entra, en el vocabulario que ve el sitio dentro de `no-permitida`. El `detalle` es una palabra fija,
 * nunca un dato del pedido.
 */
export type RazonDePago =
  | "xdr"
  | "sobre"
  | "forma"
  | "origen"
  | "origen-del-portero"
  | "recursos"
  | "ventana"
  | "operaciones"
  | "origen-de-operacion"
  | "tipo"
  | "destino-m"
  | "activo"
  | "monto"
  | "destino-propio"
  | "destino-del-portero"
  | "destino-cobros"
  | "costo-destino"
  | "costo-monto"
  | "nota"
  | "fee-alta"
  | "firma";

export interface ReglasDePago {
  /** La red de esta transacción: con ella se calcula el hash que firma la persona. */
  passphrase: string;
  /** La forma que dice el pedido: tiene que coincidir con lo que trae el sobre. */
  forma: FormaDePago;
  /** La cuenta de cobros (G…), o null si no está cargada: sin ella no hay retiro. */
  cuentaCobros: string | null;
  /** El costo exacto del retiro, en diezmillonésimas de USDC, o null si no está configurado: sin él no hay retiro. */
  costoRetiro: number | null;
  /** Las cuentas del portero que hay: la que paga las comisiones, la sorteadora y la de cobros. Ninguna puede ser el origen. */
  cuentasDelPortero: readonly string[];
}

/** Un pago de una operación: a quién y cuánto. */
export interface SalidaDePago {
  /** La cuenta G que recibe. */
  destino: string;
  /** Lo que recibe, en diezmillonésimas de USDC. */
  monto: bigint;
}

/** La nota del pago: ninguna, de texto o numérica (en decimal). Las de tipo hash y retorno no se aceptan nunca. */
export type NotaDePago = { tipo: "ninguna" } | { tipo: "texto"; valor: string } | { tipo: "id"; valor: string };

/** Lo que tiene un pago que pasó la forma. Todavía sin ventana ni firmas. */
export interface PagoLeido {
  forma: FormaDePago;
  /** El hash de la transacción interna, la que firma la persona, en hexadecimal minúscula. */
  hash: string;
  /** La cuenta de origen (G…). */
  cuenta: string;
  /** Lo que paga cada operación, en orden. */
  salidas: SalidaDePago[];
  nota: NotaDePago;
  /** El `maxTime` de la ventana, en segundos. */
  venceS: number;
  /** El total que declara pagar la transacción interna, en stroops. */
  feeDeclarado: number;
  /** En el premio, lo que dice su nota y adónde va. En el retiro, null. */
  premio: { sorteo: string; puesto: number; destino: string } | null;
}

export interface RechazoDePago {
  ok: false;
  razon: RazonDePago;
  detalle: string;
  /** El hash de la transacción interna si el sobre se pudo leer como transacción común; si no, null. */
  hash: string | null;
}

export type LecturaDePago = { ok: true; pago: PagoLeido } | RechazoDePago;
export type VeredictoDePago = { ok: true } | RechazoDePago;

function rechazo(hashDelSobre: string | null, razon: RazonDePago, detalle: string): RechazoDePago {
  return { ok: false, razon, detalle, hash: hashDelSobre };
}

function hex(b: Uint8Array): string {
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

function iguales(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let d = 0;
  for (let i = 0; i < a.length; i++) {
    d |= (a[i] as number) ^ (b[i] as number);
  }
  return d === 0;
}

/** El hash que firma la persona: el de la transacción común dentro de la carga de firma de esta red. */
function hashDeLaTransaccion(t: xdr.Transaction, passphrase: string): Uint8Array {
  const carga = new xdr.TransactionSignaturePayload({
    networkId: hash(passphrase),
    taggedTransaction: xdr.TransactionSignaturePayloadTaggedTransaction.envelopeTypeTx(t),
  });
  return hash(carga.toXDR());
}

/** El hash de la transacción de adentro de un sobre envuelto, en hexadecimal, o null si no se puede calcular. */
function hashDeAdentro(env: xdr.TransactionEnvelope, passphrase: string): string | null {
  if (env.type !== "envelopeTypeTxFeeBump") {
    return null;
  }
  const adentro = env.value.tx.innerTx;
  if (adentro.type !== "envelopeTypeTx") {
    return null;
  }
  try {
    return hex(hashDeLaTransaccion(adentro.value.tx, passphrase));
  } catch {
    return null;
  }
}

/** La nota de la transacción, o null si no se acepta de ninguna forma: de tipo hash o retorno, o un texto que no es UTF-8. */
function leerNota(memo: xdr.Memo): NotaDePago | null {
  if (memo.type === "memoNone") {
    return { tipo: "ninguna" };
  }
  if (memo.type === "memoId") {
    return { tipo: "id", valor: memo.id.toString() };
  }
  if (memo.type !== "memoText") {
    return null;
  }
  try {
    return { tipo: "texto", valor: memo.text.toStringStrict() };
  } catch {
    return null;
  }
}

/** Lo que dice la nota de un premio, o null si no tiene la forma exacta, el sorteo no es un `u64` o el puesto no cabe. */
function leerNotaDePremio(nota: NotaDePago): { sorteo: string; puesto: number } | null {
  if (nota.tipo !== "texto") {
    return null;
  }
  const m = NOTA_DE_PREMIO.exec(nota.valor);
  if (m?.[1] === undefined || m[2] === undefined) {
    return null;
  }
  const sorteo = leerNumeroDeSorteo(m[1]);
  const puesto = Number(m[2]);
  if (sorteo === null || puesto > PUESTO_MAXIMO) {
    return null;
  }
  return { sorteo: sorteo.toString(), puesto };
}

/**
 * Si la nota de un retiro puede pasar. Ninguna y la numérica pasan. Un texto no puede leerse como la orden de una compra:
 * ni como la lee `ordenDeNota` ni, más ancho, empezando con `tk:` sin espacios ni guiones y sin distinguir mayúsculas.
 * Así un retiro nunca suma su costo a la orden de otra persona.
 */
function notaDeRetiroValida(nota: NotaDePago): boolean {
  if (nota.tipo !== "texto") {
    return true;
  }
  if (ordenDeNota({ tipo: "texto", valor: nota.valor }) !== null) {
    return false;
  }
  return !sinSeparadores(nota.valor).toLowerCase().startsWith("tk:");
}

/** Si un activo es el USDC de Circle: de cuatro letras, con el código y el emisor exactos. */
function esUsdcDeCircle(activo: xdr.Asset): boolean {
  if (activo.type !== "assetTypeCreditAlphanum4") {
    return false;
  }
  const { assetCode, issuer } = activo.alphaNum4;
  return iguales(assetCode.value, CODIGO_USDC) && iguales(issuer.ed25519.value, EMISOR_EN_BYTES);
}

type Rechazar = (razon: RazonDePago, detalle: string) => RechazoDePago;
type LecturaDeSalidas = { ok: true; salidas: SalidaDePago[] } | RechazoDePago;

/**
 * Las salidas de las operaciones, en orden, de lo más barato a lo más caro. Cada punto se mira en todas las operaciones
 * antes de pasar al siguiente. Lo que no es un pago de USDC de Circle a una cuenta G, o va a la propia cuenta o a una del
 * portero que no es la de cobros, se rechaza.
 */
function leerSalidas(ops: readonly xdr.Operation[], cuenta: string, reglas: ReglasDePago, no: Rechazar): LecturaDeSalidas {
  if (ops.some((op) => op.sourceAccount !== null)) {
    return no("origen-de-operacion", "propio");
  }
  const pagos: xdr.PaymentOp[] = [];
  for (const op of ops) {
    if (op.body.type !== "payment") {
      return no("tipo", op.body.type);
    }
    pagos.push(op.body.value);
  }
  const destinos: string[] = [];
  for (const p of pagos) {
    if (p.destination.type !== "keyTypeEd25519") {
      return no("destino-m", "multiplexado");
    }
    destinos.push(StrKey.encodeEd25519PublicKey(p.destination.ed25519.value));
  }
  for (const p of pagos) {
    if (p.asset.type === "assetTypeNative") {
      return no("activo", "nativo");
    }
    if (!esUsdcDeCircle(p.asset)) {
      return no("activo", "otro");
    }
  }
  if (pagos.some((p) => p.amount <= 0n)) {
    return no("monto", "no-positivo");
  }
  for (const destino of destinos) {
    if (destino === cuenta) {
      return no("destino-propio", "propio");
    }
    if (destino !== reglas.cuentaCobros && reglas.cuentasDelPortero.includes(destino)) {
      return no("destino-del-portero", "portero");
    }
  }
  return { ok: true, salidas: pagos.map((p, i) => ({ destino: destinos[i] as string, monto: p.amount })) };
}

/**
 * Lee un pago firmado y comprueba que tenga exactamente la forma de la que dice ser. No mira el reloj ni las firmas: eso
 * se hace después de buscar el hash, con `ventanaDelPago` y `firmasDelPago`. Todo lo que no se pueda leer o no sea
 * exactamente lo esperado se rechaza.
 */
export function leerPago(xdrBase64: string, reglas: ReglasDePago): LecturaDePago {
  let env: xdr.TransactionEnvelope;
  try {
    env = xdr.TransactionEnvelope.fromXDR(xdrBase64, "base64");
  } catch {
    return rechazo(null, "xdr", "no-se-entiende");
  }
  if (env.type === "envelopeTypeTxFeeBump") {
    // Se rechaza, pero con el hash de la transacción de adentro: es el que guarda el portero, y si esa ya está en el
    // aire la respuesta tiene que decir que puede salir.
    return rechazo(hashDeAdentro(env, reglas.passphrase), "sobre", "fee-bump");
  }
  if (env.type !== "envelopeTypeTx") {
    return rechazo(null, "sobre", "version");
  }
  const sobre = env.value;
  const t = sobre.tx;
  let hashBytes: Uint8Array;
  try {
    hashBytes = hashDeLaTransaccion(t, reglas.passphrase);
  } catch {
    return rechazo(null, "xdr", "hash");
  }
  const hashDelPago = hex(hashBytes);
  const no: Rechazar = (razon, detalle) => rechazo(hashDelPago, razon, detalle);

  // La cuenta de origen: una G común, y no una de las del portero. La de cobros se mira también por su nombre, por si
  // quien arma las reglas no la puso en la lista.
  if (t.sourceAccount.type !== "keyTypeEd25519") {
    return no("origen", "multiplexada");
  }
  const cuenta = StrKey.encodeEd25519PublicKey(t.sourceAccount.ed25519.value);
  if (reglas.cuentasDelPortero.includes(cuenta) || cuenta === reglas.cuentaCobros) {
    return no("origen-del-portero", "origen");
  }

  // Un pago clásico no lleva datos de Soroban.
  if (t.ext.type !== "v0") {
    return no("recursos", "datos-de-soroban");
  }

  // Solo condiciones de tiempo, y con límite: desde siempre y hasta un instante.
  if (t.cond.type !== "precondTime") {
    return no("ventana", "sin-ventana");
  }
  const { minTime, maxTime } = t.cond.value;
  if (minTime !== 0n) {
    return no("ventana", "desde");
  }
  if (maxTime === 0n) {
    return no("ventana", "sin-limite");
  }

  // La cantidad de operaciones es la de la forma. La cantidad de la otra forma dice que se la mandó con otro nombre.
  const cantidad = t.operations.length;
  const esperadas = reglas.forma === "premio" ? 1 : 2;
  const deLaOtra = reglas.forma === "premio" ? 2 : 1;
  if (cantidad === deLaOtra) {
    return no("forma", reglas.forma === "premio" ? "de-retiro" : "de-premio");
  }
  if (cantidad !== esperadas) {
    return no("operaciones", String(cantidad));
  }

  // Cada operación es un pago de USDC de Circle a una cuenta G, sin origen propio y a otra cuenta que no es del portero.
  const leidas = leerSalidas(t.operations, cuenta, reglas, no);
  if (!leidas.ok) {
    return leidas;
  }
  const salidas = leidas.salidas;

  // La comisión que declara la persona. La oferta del envoltorio sale de nuestra configuración y tiene que alcanzar.
  if (t.fee > COMISION_MAXIMA_POR_OPERACION * cantidad) {
    return no("fee-alta", "inclusion");
  }

  // Trae alguna firma, y no más de las que caben. Si valen se mira después, contra la cuenta.
  if (sobre.signatures.length < 1 || sobre.signatures.length > FIRMAS_MAXIMAS) {
    return no("firma", "sin-firma-valida");
  }

  const nota = leerNota(t.memo);
  if (nota === null) {
    return no("nota", "tipo");
  }
  let premio: PagoLeido["premio"] = null;
  if (reglas.forma === "premio") {
    // El premio: la nota exacta de su sorteo y su puesto, y el destino no es la cuenta de cobros.
    const dicho = leerNotaDePremio(nota);
    if (dicho === null) {
      return no("nota", "premio");
    }
    const destino = (salidas[0] as SalidaDePago).destino;
    if (reglas.cuentaCobros !== null && destino === reglas.cuentaCobros) {
      return no("destino-cobros", "premio");
    }
    premio = { sorteo: dicho.sorteo, puesto: dicho.puesto, destino };
  } else {
    // El retiro: primero lo de la persona, que no va a cobros, y después el costo exacto a cobros. Sin cobros o sin costo no hay retiro.
    if (reglas.cuentaCobros === null || reglas.costoRetiro === null || !Number.isSafeInteger(reglas.costoRetiro)) {
      return no("costo-destino", "sin-configurar");
    }
    const [persona, costo] = salidas as [SalidaDePago, SalidaDePago];
    if (persona.destino === reglas.cuentaCobros) {
      return no("destino-cobros", "primera");
    }
    if (costo.destino !== reglas.cuentaCobros) {
      return no("costo-destino", "segunda");
    }
    if (costo.monto !== BigInt(reglas.costoRetiro)) {
      return no("costo-monto", "segunda");
    }
    if (!notaDeRetiroValida(nota)) {
      return no("nota", "retiro");
    }
  }

  return {
    ok: true,
    pago: { forma: reglas.forma, hash: hashDelPago, cuenta, salidas, nota, venceS: Number(maxTime), feeDeclarado: t.fee, premio },
  };
}

/**
 * La ventana de un pago ya leído, contra la hora de la red: que no haya vencido y que no venza más lejos de lo que el
 * portero acepta (`ventanaMaxS`, y nunca más que `VENTANA_MAXIMA_DEL_PAGO_S`). Va aparte de `leerPago` para que un
 * reenvío vencido de algo que ya está guardado se conteste por su estado y no por su ventana. Una hora o un máximo que no
 * son un número rechazan: una comparación con NaN da siempre falso y dejaría pasar cualquier ventana.
 */
export function ventanaDelPago(pago: PagoLeido, ahoraS: number, ventanaMaxS: number): VeredictoDePago {
  if (!Number.isFinite(ahoraS) || !Number.isFinite(ventanaMaxS)) {
    return rechazo(pago.hash, "ventana", "reloj");
  }
  if (pago.venceS < ahoraS) {
    return rechazo(pago.hash, "ventana", "vencida");
  }
  if (pago.venceS - ahoraS > Math.min(ventanaMaxS, VENTANA_MAXIMA_DEL_PAGO_S)) {
    return rechazo(pago.hash, "ventana", "larga");
  }
  return { ok: true };
}

/**
 * Las firmas de un pago ya leído, contra el hash de esta red y contra los firmantes y el umbral medio de la cuenta (el
 * que pide un pago): los pesos de las firmas válidas tienen que llegar a ese umbral. `autoridad` es lo que dice la
 * cadena de la cuenta (`autoridadDe` de `servicio.ts`); null si no se pudo leer o la cuenta no existe, y entonces vale solo
 * su propia llave con peso 1. Se verifican a lo sumo `MAX_FIRMAS_VERIFICADAS` firmas.
 *
 * Las firmas valen solo para el pago que se leyó: si el sobre no da el mismo hash (otro sobre, o el mismo con otra red),
 * se rechaza sin mirarlas. Así nunca se aprueban las firmas de una transacción con la forma de otra.
 */
export async function firmasDelPago(xdrBase64: string, pago: PagoLeido, autoridad: Autoridad | null, passphrase: string): Promise<VeredictoDePago> {
  let env: xdr.TransactionEnvelope;
  try {
    env = xdr.TransactionEnvelope.fromXDR(xdrBase64, "base64");
  } catch {
    return rechazo(pago.hash, "xdr", "no-se-entiende");
  }
  if (env.type !== "envelopeTypeTx") {
    return rechazo(pago.hash, "sobre", env.type === "envelopeTypeTxFeeBump" ? "fee-bump" : "version");
  }
  let hashBytes: Uint8Array;
  try {
    hashBytes = hashDeLaTransaccion(env.value.tx, passphrase);
  } catch {
    return rechazo(pago.hash, "xdr", "hash");
  }
  if (hex(hashBytes) !== pago.hash) {
    return rechazo(pago.hash, "xdr", "otro-sobre");
  }
  const quienes: Autoridad = autoridad ?? { firmantes: [{ clave: StrKey.decodeEd25519PublicKey(pago.cuenta), peso: 1 }], umbral: 1 };
  // Un umbral que no es un número haría falsa cualquier comparación y dejaría pasar una sola firma.
  const umbral = Math.max(1, quienes.umbral);
  if (!Number.isFinite(umbral)) {
    return rechazo(pago.hash, "firma", "umbral");
  }
  const alcanzado = await pesoDeLasFirmas(env.value.signatures, hashBytes, quienes);
  if (alcanzado.peso <= 0) {
    return rechazo(pago.hash, "firma", "sin-firma-valida");
  }
  if (alcanzado.peso < umbral) {
    return rechazo(pago.hash, "firma", "peso-insuficiente");
  }
  return { ok: true };
}
