import { USDC_MAINNET, esDireccionG, montoDePago, stroopsDe } from "./pagos";

/**
 * Pagar un paquete de sorteos oficiales con el saldo de la propia cuenta (la de Google o de correo): la regla que decide
 * si el pago que armó el proveedor de la billetera es exactamente el de la orden, y nada más. Sin DOM y sin red: el SDK
 * de Stellar se pide recién al leer una transacción.
 *
 * Lo que se paga sale entero de la orden del servidor (`alta-api.ts`, `orden`): a qué cuenta, cuánto y con qué nota. El
 * activo sale solo de acá (`DOLAR_DIGITAL`), nunca de la orden ni del proveedor. La persona no escribe nada.
 *
 * `motivoContraElPago` se mira dos veces (`wallet-pollar.ts`, `pagarOrden`): con la transacción que armó el proveedor,
 * antes de dejar que la puerta de firmas la confirme, y con la firmada, antes de mandarla. Devuelve el motivo, en palabras
 * fijas y sin datos (va a la consola), o `null` si es el pago de la orden.
 */

/**
 * El dólar digital con que se paga: el USDC de Circle en la red principal. El emisor está confirmado con dos fuentes
 * oficiales: https://developers.circle.com/stablecoins/usdc-contract-addresses y el stellar.toml de Circle,
 * https://www.circle.com/.well-known/stellar.toml (y en la cadena, su `home_domain` es circle.com). Es el mismo
 * `USDC_MAINNET` de `pagos.ts` y el mismo que reconoce el servidor. Nunca sale de la orden ni del proveedor.
 */
export const DOLAR_DIGITAL: Readonly<{ code: string; issuer: string }> = Object.freeze({ code: USDC_MAINNET.code, issuer: USDC_MAINNET.issuer });

/** Cuánto vive el pago que se le pide armar al proveedor, en segundos: lo justo para firmarlo y mandarlo. */
export const VIDA_DEL_PAGO_S = 180;
/** Lo más que se acepta que viva un pago armado: si no se sabe si salió, a los 10 minutos ya no puede entrar. */
export const VIDA_MAXIMA_S = 600;

/** El pago que se pide: todo de la orden (y la cuenta, de la sesión). */
export interface PagoPedido {
  /** La cuenta de la persona, la que paga. */
  cuenta: string;
  /** La cuenta de la orden. */
  destino: string;
  /** El monto de la orden, como lo escribe el servidor. */
  monto: string;
  /** La nota de la orden (`tk:o:<id>`). */
  nota: string;
}

/** Una operación, con lo que la regla mira. `asset`: el activo del pago, o `nativo`. */
export interface OperacionLeida {
  type: string;
  source?: string | undefined;
  destination?: string | undefined;
  amount?: string | undefined;
  asset?: { code: string; issuer: string } | "nativo" | undefined;
}

/** Lo que se lee de una transacción para compararla con el pago pedido. */
export interface PagoLeido {
  /** Viene envuelta: otra transacción paga la comisión por encima. */
  envuelta: boolean;
  /** Envuelta, la cuenta que paga la comisión. */
  pagaLaComision: string | null;
  /** La cuenta de la transacción de adentro. */
  fuente: string;
  operaciones: readonly OperacionLeida[];
  nota: { tipo: string; texto: string | null };
  /** Hasta cuándo puede entrar, en segundos Unix. `null`: sin vencimiento. */
  vence: number | null;
}

/** El monto de la orden con los siete decimales que usa la red, o `null` si no es un monto positivo. */
export function montoExacto(m: string): string | null {
  if (!/^\d{1,13}(?:\.\d{1,7})?$/.test(m)) return null;
  return montoDePago(m);
}

/** La operación es la de esta cuenta: sin cuenta propia (la de la transacción) o esa misma. */
const deLaCuenta = (source: string | undefined, cuenta: string): boolean => source === undefined || source === cuenta;

/** El pedido tiene forma: dos cuentas distintas, un monto positivo y una nota. */
export function pedidoValido(p: PagoPedido): boolean {
  return esDireccionG(p.cuenta) && esDireccionG(p.destino) && p.cuenta !== p.destino && montoExacto(p.monto) !== null && typeof p.nota === "string" && p.nota.length > 0;
}

/**
 * ¿Es el pago de la orden, y nada más? `firmada`: lo que devolvió la firma, que además tiene que venir envuelto con la
 * comisión a cargo de otra cuenta (si no, la pagaría la persona). Antes de firmar, en cambio, no tiene que venir envuelto.
 */
export function motivoContraElPago(tx: PagoLeido | null, p: PagoPedido, o: { ahora: number; firmada: boolean }): string | null {
  const monto = montoExacto(p.monto);
  if (!monto || !pedidoValido(p)) return "pedido";
  if (!tx) return "no se lee";
  if (o.firmada) {
    if (!tx.envuelta || !tx.pagaLaComision || !esDireccionG(tx.pagaLaComision) || tx.pagaLaComision === p.cuenta) return "sin-patrocinio";
  } else if (tx.envuelta) return "envuelta";
  if (tx.fuente !== p.cuenta) return "otra cuenta";
  const tipos = `operaciones: ${tx.operaciones.map((x) => x.type).join(",")}`;
  if (tx.operaciones.length !== 1) return tipos;
  const op = tx.operaciones[0] as OperacionLeida;
  if (op.type !== "payment") return tipos;
  if (!deLaCuenta(op.source, p.cuenta)) return "otra cuenta en la operación";
  if (op.destination !== p.destino) return "otro destino";
  const a = op.asset;
  if (!a || a === "nativo" || a.code !== DOLAR_DIGITAL.code || a.issuer !== DOLAR_DIGITAL.issuer) return "otro activo";
  if (!op.amount || !/^\d{1,13}\.\d{7}$/.test(op.amount) || stroopsDe(op.amount) !== stroopsDe(monto)) return "otro monto";
  if (tx.nota.tipo !== "text") return "sin nota de texto";
  if (tx.nota.texto !== p.nota) return "otra nota";
  if (tx.vence === null) return "sin vencimiento";
  if (tx.vence <= o.ahora) return "vencida";
  if (tx.vence > o.ahora + VIDA_MAXIMA_S) return "vence tarde";
  return null;
}

/** El texto de una nota: el SDK la entrega en texto o, leída de una transacción, en bytes. */
function textoDeNota(v: unknown): string | null {
  if (typeof v === "string") return v;
  if (v instanceof Uint8Array) {
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(v);
    } catch {
      return null;
    }
  }
  return null;
}

/** Lee una transacción con el SDK de Stellar y la red de la página. `null` si no se puede leer. Nunca lanza. */
export async function leerElPago(xdr: string, passphrase: string): Promise<PagoLeido | null> {
  if (!xdr) return null;
  try {
    const { FeeBumpTransaction, TransactionBuilder } = await import("@stellar/stellar-sdk");
    const t0 = TransactionBuilder.fromXDR(xdr, passphrase);
    const envuelta = t0 instanceof FeeBumpTransaction;
    const t = t0 instanceof FeeBumpTransaction ? t0.innerTransaction : t0;
    const maximo = Number(t.timeBounds?.maxTime ?? 0);
    return {
      envuelta,
      pagaLaComision: t0 instanceof FeeBumpTransaction ? t0.feeSource : null,
      fuente: t.source,
      operaciones: t.operations.map((op) => {
        const x = op as { type: string; source?: string; destination?: string; amount?: string; asset?: { isNative(): boolean; getCode(): string; getIssuer(): string } };
        const asset = x.asset ? (x.asset.isNative() ? ("nativo" as const) : { code: x.asset.getCode(), issuer: x.asset.getIssuer() }) : undefined;
        return { type: x.type, source: x.source, destination: x.destination, amount: x.amount, asset };
      }),
      nota: { tipo: String(t.memo.type), texto: t.memo.type === "text" ? textoDeNota(t.memo.value) : null },
      vence: Number.isFinite(maximo) && maximo > 0 ? maximo : null,
    };
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ el resultado */

/** Por qué el pago no salió (o no se mandó). */
export type MotivoDelPago =
  /** El saldo no alcanza. */
  | "sin-saldo"
  /** La cuenta no tiene la línea del dólar digital. */
  | "sin-linea"
  /** La persona no lo aprobó. */
  | "cancelado"
  /** Lo que armó el proveedor no era el pago de la orden: no se firmó o no se mandó. */
  | "regla"
  /** La comisión la pagaría la persona: no se mandó. */
  | "sin-patrocinio"
  /** La cuenta de la orden no puede recibir. */
  | "destino"
  /** La red lo rechazó por otro motivo. */
  | "rechazado"
  /** No se pudo armar ni firmar (sin conexión, el proveedor no contestó): no se mandó nada. */
  | "red"
  /** No hay una cuenta de la billetera del proveedor en la red principal con que pagar. */
  | "sin-cuenta";

/** Cómo terminó: salió (con el hash), no se sabe (no se manda de nuevo hasta `vence`), o no salió y por qué. */
export type ResultadoDelPagoConSaldo = { estado: "salio"; hash: string } | { estado: "incierto"; vence: number } | { estado: "no-salio"; motivo: MotivoDelPago };

/**
 * Qué dijo la red (o el proveedor, con los códigos de la red) cuando no tomó un pago ya mandado. `null`: no dice que la
 * red lo haya rechazado, así que no se sabe si salió. Ante la duda, `null`: un pago que quizás salió no se manda de nuevo.
 * `secuenciaIncierta`: la secuencia corrida tampoco dice que no entró. Va solo con la compra con QR en el build
 * (`compraQrActiva`): sin ella, el pago con el saldo queda como siempre y la secuencia corrida es un rechazo.
 */
export function motivoDelRechazo(codigos: readonly string[], o: { secuenciaIncierta?: boolean } = {}): Exclude<MotivoDelPago, "cancelado" | "regla" | "sin-patrocinio" | "red" | "sin-cuenta"> | null {
  const s = codigos.filter((c) => typeof c === "string").join(" ");
  // La secuencia corrida no dice que este pago no entró: el mismo pago mandado dos veces da este código la segunda vez.
  // No se sabe. Solo acá: en los sellos (`errores.ts`, `anchor.ts`) sigue siendo la red ocupada.
  const secuencia = /\b(txBadSeq|tx_bad_seq|TX_BAD_SEQUENCE)\b/.test(s);
  if (secuencia && o.secuenciaIncierta) return null;
  if (/\b(paymentSrcNoTrust|op_src_no_trust|paymentSrcNotAuthorized|op_src_not_authorized)\b/.test(s)) return "sin-linea";
  if (/\b(paymentUnderfunded|op_underfunded)\b/.test(s)) return "sin-saldo";
  if (/\b(paymentNoTrust|op_no_trust|paymentNoDestination|op_no_destination|paymentLineFull|op_line_full|paymentNotAuthorized|op_not_authorized|TX_NO_TRUSTLINE|TX_DESTINATION_NOT_FOUND|TX_LINE_FULL|TX_NOT_AUTHORIZED)\b/.test(s)) return "destino";
  if (
    secuencia ||
    /\b(txFailed|tx_failed|txTooLate|tx_too_late|txTooEarly|tx_too_early|txInsufficientFee|tx_insufficient_fee|txInsufficientBalance|tx_insufficient_balance|txNoAccount|tx_no_source_account|txBadAuth|tx_bad_auth|txMalformed|tx_malformed|TX_INSUFFICIENT_BALANCE|TX_TOO_LATE|TX_INSUFFICIENT_FEE|TX_SOURCE_NOT_FOUND)\b/.test(
      s,
    )
  )
    return "rechazado";
  return null;
}
