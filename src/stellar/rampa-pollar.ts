/**
 * Cargar saldo con Pollar (bolivianos por QR de banco, hasta dólares digitales en la cuenta), con las funciones de
 * `@pollar/core` 0.12: `quoteRamp`, `createRampOrder`, `signRampLeg` y `registerRampSigningHandler`.
 *
 * `<RampWidget>` es de `@pollar/react` y este sitio no usa React: no se instala. Esto es lo mismo, a mano.
 *
 * ESTADO: lista para cotizar; NO lista para cargar. Una carga con Pollar tiene pasos que firma la cuenta (el canje y
 * el puente hasta Stellar), y en Pollar 0.12 cada firma pasa por la confirmación que atiende `atenderFirmas`
 * (`wallet-pollar.ts`), que a propósito solo confirma el sello y el sorteo. Mientras la rampa firma, el SDK pide la
 * confirmación en modo "prompt" y esa puerta rechazaría la firma, dejando la orden a medias con el dinero de la
 * persona en el camino. Por eso `crearOrden` no arranca nada sin un firmante propio de la rampa (`FirmanteDeRampa`),
 * y la pantalla no ofrece cargar con Pollar hasta que exista. La guía de Meru es el camino que anda.
 */

/** Lo que se usa del cliente de Pollar. El cliente de verdad (`PollarClient`) lo cumple. */
export interface ClienteDeRampa {
  quoteRamp(body: unknown): Promise<unknown>;
  createRampOrder(body: unknown): Promise<unknown>;
  checkRampOrder(id: string): Promise<unknown>;
  signRampLeg(orderId: string, actionId: string): Promise<unknown>;
  registerRampSigningHandler(chain: string, encoding: string, handler: (accion: AccionDeFirma) => Promise<string>): () => void;
}

/** La firma que pide un paso de la orden. */
export interface AccionDeFirma {
  chain: string;
  payload: { encoding: string; value: string };
}

/** Bolivia por QR de banco, a USDC en Stellar. */
export const BOLIVIA_QR = { currency: "BOB", rail: "QR", country: "BO" } as const;
export const USDC_EN_STELLAR = { code: "USDC", identifier: null, chain: "STELLAR" } as const;

export type Cotizacion =
  | { estado: "ok"; quoteId: string; recibis: number | null; minutos: number | null }
  | { estado: "sin-ruta" }
  | { estado: "error" };

/** Un número que Pollar puede mandar como número, como texto o como `{ value }`. */
function numeroDe(x: unknown): number | null {
  if (typeof x === "number") return Number.isFinite(x) ? x : null;
  if (typeof x === "string") return x.trim() !== "" && Number.isFinite(Number(x)) ? Number(x) : null;
  if (x && typeof x === "object") {
    const o = x as Record<string, unknown>;
    return numeroDe(o.value ?? o.amount);
  }
  return null;
}

/** Cuánto recibiría en dólares digitales quien paga `bolivianos` Bs. No mueve nada: solo pregunta. */
export async function cotizarCarga(cliente: Pick<ClienteDeRampa, "quoteRamp">, bolivianos: number): Promise<Cotizacion> {
  if (!Number.isFinite(bolivianos) || bolivianos <= 0) return { estado: "error" };
  try {
    const r = (await cliente.quoteRamp({
      direction: "ONRAMP",
      fiat: BOLIVIA_QR,
      asset: USDC_EN_STELLAR,
      amount: { value: String(bolivianos), denomination: "in" },
    })) as { quotes?: Record<string, unknown>[] };
    const mejor = r?.quotes?.[0];
    if (!mejor || typeof mejor.quoteId !== "string") return { estado: "sin-ruta" };
    const eta = numeroDe(mejor.etaSeconds);
    return { estado: "ok", quoteId: mejor.quoteId, recibis: numeroDe(mejor.amountOut), minutos: eta === null ? null : Math.max(1, Math.round(eta / 60)) };
  } catch (e) {
    return (e as { code?: unknown } | null)?.code === "SDK_RAMPS_NO_ROUTE" ? { estado: "sin-ruta" } : { estado: "error" };
  }
}

/** Quien firma los pasos de la rampa, y solo ellos. Todavía no existe uno para la cuenta de Pollar (ver arriba). */
export interface FirmanteDeRampa {
  cuenta: string;
  /** Firma el paso (un XDR) y lo devuelve firmado, sin mandarlo. */
  firmar(xdr: string): Promise<string>;
  /** Comprueba que cada operación sale de `cuenta` (`assertRampStellarSigner` de `@pollar/core`). */
  verificar(accion: AccionDeFirma, cuenta: string): void;
}

/** Registra el firmante para los pasos de la rampa en Stellar. Devuelve cómo quitarlo. */
export function registrarFirmante(cliente: Pick<ClienteDeRampa, "registerRampSigningHandler">, f: FirmanteDeRampa): () => void {
  return cliente.registerRampSigningHandler("STELLAR", "xdr", async (accion) => {
    f.verificar(accion, f.cuenta);
    return f.firmar(accion.payload.value);
  });
}

/** Arranca la orden de cargar. Sin firmante no arranca: la persona podría pagar y la orden quedarse sin poder seguir. */
export async function crearOrden(
  cliente: Pick<ClienteDeRampa, "createRampOrder">,
  cotizacion: Extract<Cotizacion, { estado: "ok" }>,
  firmante: FirmanteDeRampa | null,
  payee: Record<string, string> = {},
): Promise<unknown> {
  if (!firmante) throw new Error("rampa-sin-firmante");
  return cliente.createRampOrder({ quoteId: cotizacion.quoteId, payee });
}

/** Qué le toca hacer a la persona ahora, según la orden. */
export type PasoDeOrden =
  | { paso: "pagar"; qr: string | null }
  | { paso: "firmar"; actionId: string }
  | { paso: "aprobar" }
  | { paso: "verificar"; url: string | null }
  | { paso: "esperar" }
  | { paso: "listo" }
  | { paso: "fallo" };

export function pasoDeOrden(orden: unknown): PasoDeOrden {
  const o = (orden ?? {}) as { state?: string; pendingAction?: Record<string, unknown> | null };
  if (o.state === "completed") return { paso: "listo" };
  if (o.state === "failed" || o.state === "refunded") return { paso: "fallo" };
  const a = o.pendingAction;
  switch (a?.kind) {
    case "FIAT_PAYMENT": {
      const i = a.instructions as { scannable?: { code?: unknown } } | undefined;
      return { paso: "pagar", qr: typeof i?.scannable?.code === "string" ? i.scannable.code : null };
    }
    case "SIGNATURE":
      return typeof a.actionId === "string" ? { paso: "firmar", actionId: a.actionId } : { paso: "esperar" };
    case "COSIGN_APPROVAL":
      return { paso: "aprobar" };
    case "KYC":
      return { paso: "verificar", url: typeof a.url === "string" ? a.url : null };
    default:
      return { paso: "esperar" };
  }
}

/** Autoriza el paso que la persona ve: solo si la orden de verdad espera una firma, y esa. */
export async function autorizar(cliente: Pick<ClienteDeRampa, "signRampLeg">, ordenId: string, paso: PasoDeOrden): Promise<unknown> {
  if (paso.paso !== "firmar") throw new Error("rampa-nada-que-firmar");
  return cliente.signRampLeg(ordenId, paso.actionId);
}
