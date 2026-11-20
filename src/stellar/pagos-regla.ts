import { esDireccionG } from "./direccion-g";
import { passphraseDe } from "./oficiales";
import { USDC_MAINNET, stroopsDe } from "./pagos";
import { TOPE_DEL_COSTO } from "./retiro-config";

/**
 * Las reglas de contenido de los pagos que se hacen desde la cuenta de la persona: pagar el premio de un sorteo y
 * retirar dólares digitales. Sin DOM y sin red: el SDK de Stellar se pide recién al leer una transacción.
 *
 * Primero se lee lo armado (`leerPagoArmado`) y después se compara con lo que la persona pidió ver:
 *
 * - `motivoContraElPremio`: ¿es exactamente el pago del premio, y nada más?
 * - `motivoContraElRetiro`: ¿es exactamente un retiro, y nada más?
 *
 * Las dos devuelven `null` cuando la transacción es la esperada y, si no, un motivo corto en palabras fijas, sin
 * cuentas, notas ni montos (va a la consola). Quien llama pasa la regla antes de firmar y no firma nada que no
 * la pase. Lo que se compara es lo que armó la propia página, nunca lo que diga otra parte.
 *
 * Qué es "exactamente" en los dos casos:
 *
 * - Una transacción común, no envuelta en otra, de la red principal y de la cuenta de la persona.
 * - Operaciones de pago en USDC de Circle y sin cuenta propia (la de la transacción es la única que mueve plata).
 * - Cada destino es una dirección común de la red (la que empieza con G), tal cual: una multiplexada no vale.
 * - Comisión de 1000 por operación y solo una condición de tiempo: vence más adelante y como mucho a los 300 segundos.
 * - El premio es un solo pago al puesto, con la nota del premio. El retiro es el pago a la persona por lo que llega
 *   y, si hay costo, un segundo pago por el costo exacto a la cuenta del costo, en ese orden y nada más.
 */

/** Cuánto vive un pago armado, en segundos: lo justo para firmarlo y mandarlo. */
export const VIDA_DEL_PAGO_S = 240;
/**
 * Lo más que se acepta que viva un pago, en segundos. Es el tope de ventana del portero, que no manda nada que venza
 * más tarde. Los 60 segundos de diferencia con `VIDA_DEL_PAGO_S` cubren un reloj corrido.
 */
export const VIDA_MAXIMA_DEL_PAGO_S = 300;
/** La comisión que declara cada operación, en stroops. */
export const COMISION_POR_OPERACION = 1000n;
/** La nota que lleva un retiro cuando la persona no pide una: no la confunde ningún lector de órdenes ni de premios. */
export const NOTA_DEL_RETIRO = "tkz-retiro";

/** Lo más que admite Stellar en un pago, en stroops: el máximo de un entero de 64 bits con signo. */
const MONTO_MAXIMO = 9_223_372_036_854_775_807n;
/** El máximo de una nota numérica de Stellar: un entero de 64 bits sin signo. */
const NOTA_ID_MAXIMA = 18_446_744_073_709_551_615n;
/** Lo que cabe en una nota de texto, en bytes. */
const NOTA_TEXTO_BYTES = 28;
/** Cómo se escribe un monto: hasta trece cifras enteras y, si hay decimales, de uno a siete. */
const FORMA_DEL_MONTO = /^\d{1,13}(?:\.\d{1,7})?$/;
/** La nota de un premio en su forma única: sorteo sin ceros delante y puesto sin ceros delante. */
const FORMA_DE_LA_NOTA_DEL_PREMIO = /^tk:premio:[1-9]\d{0,19}:(?:0|[1-9]\d{0,8})$/;

/* ------------------------------------------------------------------ lo que se lee */

/** La nota de un pago: ninguna, un número o un texto corto. Es la misma forma que usa la ventana de Mandar. */
export type NotaDelPago = { tipo: "ninguna" } | { tipo: "id"; valor: string } | { tipo: "texto"; valor: string };

/** La nota como sale de una transacción. `otra` es lo que Tinkazo nunca arma: un hash, un retorno o bytes que no son texto. */
export type NotaLeida = NotaDelPago | { tipo: "otra" };

/** El activo de un pago leído: la moneda nativa o un código con su emisor. */
export type ActivoLeido = "nativo" | { code: string; issuer: string };

/** Una operación de la transacción, con lo que miran las reglas. Lo que no es de un pago queda en `null`. */
export interface OperacionDelPago {
  /** El tipo que dice el SDK: `payment`, `changeTrust`, `setOptions`... */
  tipo: string;
  /** La cuenta propia de la operación, tal cual (común o multiplexada), o `null` si no trae y vale la de la transacción. */
  origen: string | null;
  /** Solo en un `payment`: a quién, tal cual (común o multiplexada). */
  destino: string | null;
  /** Solo en un `payment`: en qué activo. */
  activo: ActivoLeido | null;
  /** Solo en un `payment`: cuánto, en stroops (un dólar digital son 10.000.000). */
  monto: bigint | null;
}

/** Qué sobre trae la transacción: la común, la envuelta en otra que paga la comisión, o la de la versión vieja. */
export type SobreLeido = "comun" | "envuelto" | "antiguo";

/** Lo que se lee de una transacción armada para compararla con el pago pedido. */
export interface PagoArmado {
  /** La red con que se leyó (su passphrase). Solo vale la principal. */
  red: string;
  sobre: SobreLeido;
  /** Envuelta, la cuenta que paga la comisión. */
  pagaLaComision: string | null;
  /** La cuenta de la transacción (de la de adentro, si viene envuelta), tal cual. */
  fuente: string;
  /** La comisión total declarada, en stroops. */
  comision: bigint;
  /** Desde cuándo vale, en segundos Unix. 0 es sin límite. */
  desde: number;
  /** Hasta cuándo puede entrar, en segundos Unix. `null`: sin vencimiento. */
  vence: number | null;
  /**
   * Trae la forma larga de las condiciones, aunque venga vacía, o alguna condición que no es de tiempo: límites de
   * ledger, secuencia mínima, edad o distancia de secuencia, firmantes extra. El portero solo acepta la forma corta.
   */
  condicionesExtra: boolean;
  nota: NotaLeida;
  operaciones: readonly OperacionDelPago[];
}

/**
 * El texto de una nota: el SDK la entrega en texto o, leída de una transacción, en bytes. `null` si no es UTF-8 válido.
 * La marca de orden de bytes del principio se conserva: sin eso, una nota con tres bytes de más se leería igual que la
 * pedida y la búsqueda por nota después no la encontraría.
 */
function textoDeNota(valor: unknown): string | null {
  if (typeof valor === "string") return valor;
  if (!(valor instanceof Uint8Array)) return null;
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(valor);
  } catch {
    return null;
  }
}

/** La nota de una transacción según su tipo en el SDK (`none`, `text`, `id`, `hash` o `return`) y su valor. */
function notaLeida(tipo: string, valor: unknown): NotaLeida {
  if (tipo === "none") return { tipo: "ninguna" };
  if (tipo === "id" && typeof valor === "string") return { tipo: "id", valor };
  if (tipo !== "text") return { tipo: "otra" };
  const texto = textoDeNota(valor);
  return texto === null ? { tipo: "otra" } : { tipo: "texto", valor: texto };
}

/** Los stroops de un monto escrito con punto, o `null` si no es un monto entre 1 stroop y el máximo de la red. */
function stroopsDelMonto(monto: string): bigint | null {
  if (!FORMA_DEL_MONTO.test(monto)) return null;
  const stroops = stroopsDe(monto);
  return stroops > 0n && stroops <= MONTO_MAXIMO ? stroops : null;
}

/** El sobre según el tipo que trae la transacción por fuera. */
function sobreDe(tipo: string): SobreLeido {
  if (tipo === "envelopeTypeTxFeeBump") return "envuelto";
  return tipo === "envelopeTypeTxV0" ? "antiguo" : "comun";
}

/**
 * Lee una transacción armada con el SDK de Stellar y la red que se le pasa. `null` si no se puede leer. Nunca lanza.
 * Envuelta en otra, lee la de adentro y deja dicho quién paga la comisión. No firma ni manda nada.
 */
export async function leerPagoArmado(armada: string, passphrase: string): Promise<PagoArmado | null> {
  if (!armada) return null;
  try {
    const { FeeBumpTransaction, TransactionBuilder, xdr } = await import("@stellar/stellar-sdk");
    const crudo = xdr.TransactionEnvelope.fromXDR(armada, "base64");
    const sobre = sobreDe(crudo.type);
    // La transacción común (la de adentro, si viene envuelta) en crudo: el SDK no dice si las condiciones vienen en la forma
    // larga cuando no traen nada puesto, y Tinkazo nunca la arma.
    const comun = crudo.type === "envelopeTypeTxFeeBump" ? crudo.value.tx.innerTx.value : crudo.type === "envelopeTypeTx" ? crudo.value : null;
    const formaLarga = comun?.tx.cond.type === "precondV2";
    const leida = TransactionBuilder.fromXDR(armada, passphrase);
    const t = leida instanceof FeeBumpTransaction ? leida.innerTransaction : leida;
    const desde = Number(t.timeBounds?.minTime ?? 0);
    const hasta = Number(t.timeBounds?.maxTime ?? 0);
    return {
      red: t.networkPassphrase,
      sobre,
      pagaLaComision: leida instanceof FeeBumpTransaction ? leida.feeSource : null,
      fuente: t.source,
      comision: BigInt(t.fee),
      desde: Number.isFinite(desde) ? desde : Number.MAX_SAFE_INTEGER,
      vence: Number.isFinite(hasta) && hasta > 0 ? hasta : null,
      condicionesExtra:
        formaLarga ||
        t.ledgerBounds !== undefined ||
        t.minAccountSequence !== undefined ||
        (t.minAccountSequenceAge ?? 0n) > 0n ||
        (t.minAccountSequenceLedgerGap ?? 0) > 0 ||
        (t.extraSigners?.length ?? 0) > 0,
      nota: notaLeida(t.memo.type, t.memo.value),
      operaciones: t.operations.map((op): OperacionDelPago => {
        const origen = op.source ?? null;
        if (op.type !== "payment") return { tipo: op.type, origen, destino: null, activo: null, monto: null };
        const activo: ActivoLeido = op.asset.isNative() ? "nativo" : { code: op.asset.getCode(), issuer: op.asset.getIssuer() ?? "" };
        return { tipo: op.type, origen, destino: op.destination, activo, monto: stroopsDelMonto(op.amount) };
      }),
    };
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------- los motivos */

/** Lo que puede estar mal en cada pago de la transacción. */
type DelPago = "no es un pago" | "origen en la operación" | "destino multiplexado" | "otro destino" | "otro activo" | "otro monto";

/**
 * Por qué una transacción no es exactamente el pago esperado, en palabras fijas y sin datos. Los que terminan en
 * `del costo` son los de un pago, dichos del segundo pago de un retiro.
 */
export type MotivoDeLaRegla =
  | "pedido"
  | "nota de orden"
  | "no se lee"
  | "otra red"
  | "envuelta"
  | "sobre viejo"
  | "otra cuenta"
  | "condiciones de más"
  | "con inicio"
  | "sin vencimiento"
  | "vencida"
  | "vence tarde"
  | "operaciones de más"
  | "operaciones de menos"
  | "comisión"
  | "orden al revés"
  | "otra nota"
  | DelPago
  | `${DelPago} del costo`;

/** Cuándo se mira: `ahora` es la hora en segundos Unix, mejor la de la red que la del reloj de la persona. */
export interface OpcionesDeLaRegla {
  ahora: number;
}

/**
 * Lo que se mira de la transacción entera antes de mirar sus pagos: la red, el sobre, la cuenta, las condiciones, el
 * vencimiento, cuántas operaciones trae y la comisión. `operaciones` es cuántas tiene que traer.
 */
function motivoDelSobre(leido: PagoArmado, cuenta: string, operaciones: number, ahora: number): MotivoDeLaRegla | null {
  if (!Number.isFinite(ahora) || ahora <= 0) return "pedido";
  if (leido.red !== passphraseDe("mainnet")) return "otra red";
  if (leido.sobre === "envuelto") return "envuelta";
  if (leido.sobre === "antiguo") return "sobre viejo";
  if (leido.fuente !== cuenta) return "otra cuenta";
  if (leido.condicionesExtra) return "condiciones de más";
  if (leido.desde !== 0) return "con inicio";
  if (leido.vence === null) return "sin vencimiento";
  if (leido.vence <= ahora) return "vencida";
  if (leido.vence - ahora > VIDA_MAXIMA_DEL_PAGO_S) return "vence tarde";
  if (leido.operaciones.length > operaciones) return "operaciones de más";
  if (leido.operaciones.length < operaciones) return "operaciones de menos";
  if (leido.comision !== COMISION_POR_OPERACION * BigInt(operaciones)) return "comisión";
  return null;
}

/**
 * ¿Es esta operación el pago esperado en USDC de Circle? Sin cuenta propia (ni siquiera la misma de la transacción),
 * al destino exacto, por el monto exacto. `delCosto`: es el segundo pago de un retiro y los motivos lo dicen.
 */
function motivoDelPago(op: OperacionDelPago, esperado: { destino: string; monto: bigint }, delCosto: boolean): MotivoDeLaRegla | null {
  const dicho = (motivo: DelPago): MotivoDeLaRegla => (delCosto ? `${motivo} del costo` : motivo);
  if (op.tipo !== "payment") return dicho("no es un pago");
  if (op.origen !== null) return dicho("origen en la operación");
  if (op.destino !== esperado.destino) return dicho(op.destino?.startsWith("M") ? "destino multiplexado" : "otro destino");
  const a = op.activo;
  if (a === null || a === "nativo" || a.code !== USDC_MAINNET.code || a.issuer !== USDC_MAINNET.issuer) return dicho("otro activo");
  if (op.monto !== esperado.monto) return dicho("otro monto");
  return null;
}

/* ----------------------------------------------------------------------- el premio */

/**
 * El pago de un premio que se pide ver. La cuenta es la de la sesión, el destino el de la lista sellada en ese puesto,
 * el monto el que la persona vio (hasta siete decimales, con punto) y la nota `notaDelPremio(sorteo, puesto)`. El activo
 * no viene en el pedido: es siempre el USDC de Circle.
 */
export interface PedidoDelPremio {
  cuenta: string;
  destino: string;
  monto: string;
  nota: string;
}

/** El pedido tiene forma: dos cuentas comunes y distintas, un monto positivo y la nota de un premio en su forma única. */
function pedidoDelPremioValido(p: PedidoDelPremio): boolean {
  if (!esDireccionG(p.cuenta) || !esDireccionG(p.destino) || p.cuenta === p.destino) return false;
  if (typeof p.monto !== "string" || stroopsDelMonto(p.monto) === null) return false;
  return typeof p.nota === "string" && p.nota.length <= NOTA_TEXTO_BYTES && FORMA_DE_LA_NOTA_DEL_PREMIO.test(p.nota);
}

/**
 * ¿Es exactamente el pago de un premio, y nada más? Una sola operación de pago de esta cuenta, en el USDC de Circle, al
 * destino de la lista y por el monto que la persona vio, con la nota del premio. `null` si lo es, el motivo si no.
 */
export function motivoContraElPremio(leido: PagoArmado | null, pedido: PedidoDelPremio, o: OpcionesDeLaRegla): MotivoDeLaRegla | null {
  const monto = pedidoDelPremioValido(pedido) ? stroopsDelMonto(pedido.monto) : null;
  if (monto === null) return "pedido";
  if (!leido) return "no se lee";
  const delSobre = motivoDelSobre(leido, pedido.cuenta, 1, o.ahora);
  if (delSobre) return delSobre;
  const [pago] = leido.operaciones;
  if (!pago) return "operaciones de menos";
  const delPago = motivoDelPago(pago, { destino: pedido.destino, monto }, false);
  if (delPago) return delPago;
  return leido.nota.tipo === "texto" && leido.nota.valor === pedido.nota ? null : "otra nota";
}

/* ----------------------------------------------------------------------- el retiro */

/** El costo del retiro: cuánto, en stroops, y a qué cuenta común va. Sale de la configuración del build, nunca de la pantalla. */
export interface CostoDelRetiro {
  stroops: bigint;
  destino: string;
}

/**
 * El retiro que se pide ver. La cuenta es la de la sesión. `llega` es lo que recibe el destino, en stroops. `costo` es
 * `null` cuando no se cobra nada: el retiro es un solo pago. Con costo son dos, en este orden: lo que llega al destino
 * y después el costo exacto a su cuenta.
 */
export interface PedidoDelRetiro {
  cuenta: string;
  destino: string;
  llega: bigint;
  nota: NotaDelPago;
  costo: CostoDelRetiro | null;
}

/**
 * ¿Un texto es una nota que un lector de órdenes de compra podría leer como una? Sin espacios ni guiones de ningún tipo
 * y sin distinguir mayúsculas, empieza con `tk:`. El retiro no lleva una nota así: el costo se mezclaría con una orden.
 */
export function notaParecidaAUnaOrden(texto: string): boolean {
  return /^tk:/i.test(texto.replace(/[\s\-‐-―−]/g, ""));
}

/** La nota pedida entra en una nota de Stellar: un número de hasta 64 bits sin signo o un texto no vacío de hasta 28 bytes. */
function notaPedidaValida(nota: NotaDelPago): boolean {
  if (nota.tipo === "ninguna") return true;
  if (nota.tipo === "id") return /^\d{1,20}$/.test(nota.valor) && BigInt(nota.valor) <= NOTA_ID_MAXIMA;
  return nota.valor.length > 0 && new TextEncoder().encode(nota.valor).length <= NOTA_TEXTO_BYTES;
}

/** El costo tiene forma: un monto positivo hasta el tope y una cuenta común que no es la de la persona ni su destino. */
function costoValido(c: CostoDelRetiro, cuenta: string, destino: string): boolean {
  if (c.stroops <= 0n || c.stroops > TOPE_DEL_COSTO) return false;
  return esDireccionG(c.destino) && c.destino !== cuenta && c.destino !== destino;
}

/** El pedido tiene forma: dos cuentas comunes y distintas, algo que llega, una nota que entra y un costo que vale o ninguno. */
function pedidoDelRetiroValido(p: PedidoDelRetiro): boolean {
  if (!esDireccionG(p.cuenta) || !esDireccionG(p.destino) || p.cuenta === p.destino) return false;
  if (p.llega <= 0n || p.llega > MONTO_MAXIMO || !notaPedidaValida(p.nota)) return false;
  return p.costo === null || costoValido(p.costo, p.cuenta, p.destino);
}

/** ¿Dos números escritos con cifras son el mismo? Se comparan por su valor, así que los ceros de adelante no cuentan. */
function mismoNumero(a: string, b: string): boolean {
  return /^\d{1,20}$/.test(a) && /^\d{1,20}$/.test(b) && BigInt(a) === BigInt(b);
}

/** ¿La nota de la transacción es la pedida, con el mismo tipo y el mismo valor? */
function esLaNotaPedida(leida: NotaLeida, pedida: NotaDelPago): boolean {
  if (pedida.tipo === "ninguna") return leida.tipo === "ninguna";
  if (pedida.tipo === "id") return leida.tipo === "id" && mismoNumero(leida.valor, pedida.valor);
  return leida.tipo === "texto" && leida.valor === pedida.valor;
}

/**
 * ¿Es exactamente un retiro, y nada más? Sin costo, un solo pago de esta cuenta al destino por lo que llega. Con costo,
 * dos pagos en este orden fijo: primero el de la persona y después el costo exacto a la cuenta del costo. En USDC de
 * Circle, con la nota pedida y sin que esa nota se pueda leer como una orden. `null` si lo es, el motivo si no.
 */
export function motivoContraElRetiro(leido: PagoArmado | null, pedido: PedidoDelRetiro, o: OpcionesDeLaRegla): MotivoDeLaRegla | null {
  if (!pedidoDelRetiroValido(pedido)) return "pedido";
  if (pedido.nota.tipo === "texto" && notaParecidaAUnaOrden(pedido.nota.valor)) return "nota de orden";
  if (!leido) return "no se lee";
  const delSobre = motivoDelSobre(leido, pedido.cuenta, pedido.costo ? 2 : 1, o.ahora);
  if (delSobre) return delSobre;
  const [persona, costo] = leido.operaciones;
  if (!persona) return "operaciones de menos";
  if (pedido.costo && costo && persona.destino === pedido.costo.destino && costo.destino === pedido.destino) return "orden al revés";
  const dePersona = motivoDelPago(persona, { destino: pedido.destino, monto: pedido.llega }, false);
  if (dePersona) return dePersona;
  if (pedido.costo) {
    if (!costo) return "operaciones de menos";
    const delCosto = motivoDelPago(costo, { destino: pedido.costo.destino, monto: pedido.costo.stroops }, true);
    if (delCosto) return delCosto;
  }
  return esLaNotaPedida(leido.nota, pedido.nota) ? null : "otra nota";
}
