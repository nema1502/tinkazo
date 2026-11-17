import type {
  RampOrder,
  RampOrderLeg,
  RampOrderLegStep,
  RampOrdersPage,
  RampPendingAction,
  RampQuote,
  RampQuoteLeg,
  RampQuoteRejection,
  RampQuotesResponse,
  RampRoute,
  RampRoutesResponse,
} from "@pollar/core";
import { describe, expect, it, vi } from "vitest";
import { USDC_MAINNET } from "./pagos";
import {
  type Cotizacion,
  type MarcasDeOrden,
  SIN_MARCAS,
  anotarMarca,
  aprobacionesQueFaltan,
  cargaAbierta,
  cargaCerradaSinTerminar,
  cotizarCarga,
  cuerpoDeCotizacion,
  dondeEstaTuDinero,
  etapasDeCarga,
  imagenDelQr,
  leerCotizacion,
  leerErrorDeCotizacion,
  leerMarcas,
  motivoDelError,
  numeroDeCarga,
  palabraDeEtapa,
  pasoDeOrden,
  quitarMarca,
  rutaDeBolivia,
  tiempoQueFalta,
} from "./rampa-pollar";

const ok = (c: Cotizacion): Extract<Cotizacion, { estado: "ok" }> => {
  if (c.estado !== "ok") throw new Error(`debía cotizar: ${c.estado}`);
  return c;
};

describe("cotizar una carga con Pollar", () => {
  it("pide bolivianos por QR de banco a USDC en Stellar, por lo que paga la persona", async () => {
    const quoteRamp = vi.fn(async () => ({ quotes: [{ quoteId: "q1", amountOut: "28.41", etaSeconds: 600 }] }));
    const c = await cotizarCarga({ quoteRamp }, 200);
    expect(quoteRamp).toHaveBeenCalledWith({
      direction: "ONRAMP",
      fiat: { currency: "BOB", rail: "QR", country: "BO" },
      asset: { code: "USDC", identifier: null, chain: "STELLAR" },
      amount: { value: "200", denomination: "in" },
    });
    expect(c).toEqual({ estado: "ok", quoteId: "q1", recibis: 28.41, minutos: 10 });
  });

  it("entiende el monto como número, como texto o como { value }", async () => {
    for (const amountOut of [12.5, "12.5", { value: "12.5" }, { amount: 12.5 }]) {
      const c = await cotizarCarga({ quoteRamp: async () => ({ quotes: [{ quoteId: "q", amountOut, etaSeconds: 30 }] }) }, 50);
      expect(ok(c).recibis, JSON.stringify(amountOut)).toBe(12.5);
      expect(ok(c).minutos).toBe(1);
    }
    const sinDatos = ok(await cotizarCarga({ quoteRamp: async () => ({ quotes: [{ quoteId: "q" }] }) }, 50));
    expect(sinDatos).toMatchObject({ recibis: null, minutos: null });
  });

  it("sin camino para ese monto, o con un error, lo dice sin lanzar", async () => {
    expect(await cotizarCarga({ quoteRamp: async () => ({ quotes: [] }) }, 50)).toEqual({ estado: "sin-ruta" });
    expect(await cotizarCarga({ quoteRamp: async () => Promise.reject(Object.assign(new Error("x"), { code: "SDK_RAMPS_NO_ROUTE" })) }, 50)).toEqual({ estado: "sin-ruta" });
    expect(await cotizarCarga({ quoteRamp: async () => Promise.reject(new Error("caído")) }, 50)).toEqual({ estado: "error" });
  });

  it("un monto que no es un monto no llega a preguntar", async () => {
    const quoteRamp = vi.fn();
    for (const n of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) expect(await cotizarCarga({ quoteRamp }, n)).toEqual({ estado: "error" });
    expect(quoteRamp).not.toHaveBeenCalled();
  });
});

describe("nada firma un tramo de la carga por fuera de la regla", () => {
  it("el archivo ya no trae con qué crear una orden, firmar un tramo ni registrar un firmante", async () => {
    const m = (await import("./rampa-pollar")) as Record<string, unknown>;
    for (const viejo of ["crearOrden", "registrarFirmante", "autorizar"]) expect(m[viejo], viejo).toBeUndefined();
  });
});

/* ------------------------------------------------------------------ las rutas y la cotización, con los tipos del kit */

const CIRCLE = USDC_MAINNET.issuer;
const BOB_QR = { kind: "fiat", currency: "BOB", rail: "QR", country: "BO" } as const;
const USDC_STELLAR = { kind: "asset", code: "USDC", identifier: CIRCLE, chain: "STELLAR" } as const;
const USDT_POLYGON = { kind: "asset", code: "USDT0", identifier: "0x00000000000000000000000000000000000000aa", chain: "POLYGON" } as const;
const USDC_POLYGON = { kind: "asset", code: "USDC", identifier: "0x00000000000000000000000000000000000000bb", chain: "POLYGON" } as const;

const ruta = (r: Partial<RampRoute> = {}): RampRoute => ({ fiat: BOB_QR, asset: USDC_STELLAR, legs: ["PROVIDER_ONRAMP", "SWAP", "BRIDGE"], ...r });

/** Las cuatro rutas de cargar que Pollar devolvió al prender Bolivia: a Polygon (dos), a Stellar y a Solana. */
const RUTAS_DE_BOLIVIA: RampRoutesResponse = {
  routes: [
    ruta({ asset: { kind: "asset", code: "USDT", identifier: "0x1", chain: "POLYGON" }, legs: ["PROVIDER_ONRAMP"] }),
    ruta({ asset: { kind: "asset", code: "USDC", identifier: "0x2", chain: "POLYGON" }, legs: ["PROVIDER_ONRAMP"] }),
    ruta(),
    ruta({ asset: { kind: "asset", code: "USDC", identifier: "EPj", chain: "SOLANA" }, legs: ["PROVIDER_ONRAMP", "BRIDGE"] }),
  ],
};

describe("la ruta de Bolivia: QR en bolivianos hasta el USDC de Circle en Stellar", () => {
  it("de las cuatro rutas de cargar, toma la que llega a Stellar y el emisor que dice la ruta", () => {
    expect(rutaDeBolivia(RUTAS_DE_BOLIVIA)).toEqual({
      fiat: { currency: "BOB", rail: "QR", country: "BO" },
      asset: { code: "USDC", identifier: CIRCLE, chain: "STELLAR" },
      emisor: CIRCLE,
    });
  });

  it("una ruta a Polygon o a Solana se ignora: sin la de Stellar no hay ruta", () => {
    expect(rutaDeBolivia({ routes: RUTAS_DE_BOLIVIA.routes.filter((r) => r.asset.chain !== "STELLAR") })).toBeNull();
  });

  it("otro país, otro medio, otra moneda, otro emisor, sin emisor o con un tramo raro, se ignora", () => {
    const malas: RampRoute[] = [
      ruta({ fiat: { kind: "fiat", currency: "MXN", rail: "SPEI", country: "MX" } }),
      ruta({ fiat: { kind: "fiat", currency: "BOB", rail: "ACH", country: "BO" } }),
      ruta({ fiat: { kind: "fiat", currency: "USD", rail: "QR", country: "BO" } }),
      ruta({ fiat: { kind: "fiat", currency: "BOB", rail: "QR", country: "PE" } }),
      ruta({ asset: { ...USDC_STELLAR, identifier: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5" } }),
      ruta({ asset: { ...USDC_STELLAR, identifier: null } }),
      ruta({ asset: { ...USDC_STELLAR, code: "EURC" } }),
      ruta({ legs: ["PROVIDER_OFFRAMP", "BRIDGE"] }),
      ruta({ legs: ["BRIDGE"] }),
      ruta({ legs: [] }),
      ruta({ legs: ["PROVIDER_ONRAMP", "OTRO" as never] }),
    ];
    for (const r of malas) expect(rutaDeBolivia({ routes: [r] }), JSON.stringify(r)).toBeNull();
  });

  it("lo que no es una lista de rutas no lanza: no hay ruta", () => {
    for (const x of [null, undefined, 3, "x", {}, { routes: null }, { routes: [null, 1, "x", {}] }]) expect(rutaDeBolivia(x)).toBeNull();
  });

  it("el pedido de precio usa la ruta tal cual, con el monto que paga la persona", () => {
    const r = rutaDeBolivia(RUTAS_DE_BOLIVIA);
    if (!r) throw new Error("debía haber ruta");
    expect(cuerpoDeCotizacion(r, 300)).toEqual({
      direction: "ONRAMP",
      fiat: { currency: "BOB", rail: "QR", country: "BO" },
      asset: { code: "USDC", identifier: CIRCLE, chain: "STELLAR" },
      amount: { value: "300", denomination: "in" },
    });
    for (const n of [0, -100, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 1e20]) expect(cuerpoDeCotizacion(r, n), String(n)).toBeNull();
  });
});

/** El `422 SDK_RAMPS_NO_ROUTE` medido al prender Bolivia: dos rutas, las dos esperando el primero de cuatro pasos. */
function rechazo(r: Partial<RampQuoteRejection> = {}): RampQuoteRejection {
  return {
    legs: [
      { index: 0, kind: "PROVIDER_ONRAMP", from: BOB_QR, to: USDT_POLYGON },
      { index: 1, kind: "BRIDGE", from: USDC_POLYGON, to: USDC_STELLAR },
    ],
    failure: { code: "PROVIDER_VERIFICATION_REQUIRED", legIndex: 0, retryable: true, resolutionOwner: "END_USER", resolutionAction: "complete_verification" },
    requirement: { corridorId: "cor-bo", position: 1, completed: 0, total: 4, type: "KYC", optionId: "opt-kyc", status: "none" },
    ...r,
  };
}
const errorDelKit = (code: string, body: Record<string, unknown> = {}) => Object.assign(new Error(code), { name: "PollarApiError", code, body: { success: false, code, ...body } });
const SIN_RUTA_MEDIDO = errorDelKit("SDK_RAMPS_NO_ROUTE", { rejected: [rechazo(), rechazo({ legs: [{ index: 0, kind: "PROVIDER_ONRAMP", from: BOB_QR, to: USDC_POLYGON }] })] });

describe("lo que falta antes de ver un precio, en vez de «no hay camino»", () => {
  it("el 422 medido: el primero de cuatro pasos, la verificación de identidad, sin empezar", () => {
    expect(leerErrorDeCotizacion(SIN_RUTA_MEDIDO)).toEqual({
      estado: "falta",
      falta: [{ que: "verificacion", paso: { tipo: "KYC", estado: "por-hacer", numero: 1, total: 4, opcion: "opt-kyc", corredor: "cor-bo" } }],
    });
  });

  it("cada estado de un paso de verificación", () => {
    const leer = (requirement: RampQuoteRejection["requirement"]) => leerErrorDeCotizacion(errorDelKit("SDK_RAMPS_NO_ROUTE", { rejected: [rechazo({ requirement })] }));
    const req = rechazo().requirement as NonNullable<RampQuoteRejection["requirement"]>;
    expect(leer({ ...req, status: "pending" })).toMatchObject({ estado: "falta", falta: [{ paso: { estado: "en-curso" } }] });
    expect(leer({ ...req, status: "pending", reviewReason: "DUPLICATE_DOCUMENT" })).toEqual({ estado: "en-revision" });
    expect(leer({ ...req, status: "rejected" })).toEqual({ estado: "rechazada" });
    expect(leer({ ...req, status: "expired" })).toMatchObject({ estado: "falta", falta: [{ paso: { estado: "vencido" } }] });
    expect(leer({ ...req, type: "FORM", position: 2, completed: 1, status: "none" })).toMatchObject({ falta: [{ paso: { tipo: "FORM", numero: 2, total: 4 } }] });
    expect(leer({ ...req, type: "FORM", status: "pending" })).toMatchObject({ falta: [{ paso: { tipo: "FORM", estado: "en-curso" } }] });
    expect(leer({ ...req, type: "REGISTRY_CHECK", position: 3, completed: 2, status: "pending" })).toEqual({ estado: "en-revision" });
    expect(leer({ ...req, type: "REGISTRY_CHECK", status: "none" })).toMatchObject({ falta: [{ paso: { tipo: "REGISTRY_CHECK", estado: "por-hacer" } }] });
    expect(leer({ ...req, type: "PROVIDER_REGISTRATION", position: 4, completed: 3 })).toMatchObject({ falta: [{ paso: { tipo: "PROVIDER_REGISTRATION", numero: 4 } }] });
  });

  it("un paso de un tipo o un estado que no conocemos no se muestra como si lo conociéramos", () => {
    const req = rechazo().requirement as NonNullable<RampQuoteRejection["requirement"]>;
    const leer = (requirement: unknown) => leerErrorDeCotizacion(errorDelKit("SDK_RAMPS_NO_ROUTE", { rejected: [rechazo({ requirement: requirement as never })] }));
    expect(leer({ ...req, type: "VIDEO_CALL" })).toEqual({ estado: "no-se-puede" });
    expect(leer({ ...req, status: "maybe" })).toEqual({ estado: "no-se-puede" });
    expect(leer({ ...req, position: "uno", completed: null })).toMatchObject({ falta: [{ paso: { numero: null } }] });
  });

  it("con una verificación rechazada en cualquier ruta, la carga no está disponible", () => {
    const req = rechazo().requirement as NonNullable<RampQuoteRejection["requirement"]>;
    const e = errorDelKit("SDK_RAMPS_NO_ROUTE", { rejected: [rechazo(), rechazo({ requirement: { ...req, status: "rejected" } })] });
    expect(leerErrorDeCotizacion(e)).toEqual({ estado: "rechazada" });
  });

  it("preparar para recibir: la línea de USDC de Circle y la cuenta de paso en Polygon, en ese orden", () => {
    const sinReq = (failure: RampQuoteRejection["failure"], legs?: RampQuoteRejection["legs"]): RampQuoteRejection => {
      const r = rechazo({ failure, ...(legs ? { legs } : {}) });
      delete r.requirement;
      return r;
    };
    const cuentaDePaso = sinReq({ code: "WALLET_REQUIRED", legIndex: 1, retryable: true, resolutionOwner: "END_USER", resolutionAction: "set_up_wallet", detail: "POLYGON" });
    const linea = sinReq({ code: "TRUSTLINE_REQUIRED", legIndex: 1, retryable: true, resolutionOwner: "END_USER", resolutionAction: "add_trustline" });
    expect(leerErrorDeCotizacion(errorDelKit("SDK_RAMPS_NO_ROUTE", { rejected: [cuentaDePaso, linea] }))).toEqual({
      estado: "falta",
      falta: [{ que: "linea", emisor: CIRCLE }, { que: "cuenta-de-paso", red: "POLYGON" }],
    });
    // La línea de otro emisor no se abre: no es la que sabemos abrir.
    const otra = sinReq({ code: "TRUSTLINE_REQUIRED", legIndex: 1, retryable: true, resolutionOwner: "END_USER", resolutionAction: "add_trustline" }, [
      { index: 1, kind: "BRIDGE", from: USDC_POLYGON, to: { ...USDC_STELLAR, identifier: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5" } },
    ]);
    expect(leerErrorDeCotizacion(errorDelKit("SDK_RAMPS_NO_ROUTE", { rejected: [otra] }))).toEqual({ estado: "no-se-puede" });
    // Una cuenta de paso en otra red tampoco.
    const solana = sinReq({ code: "WALLET_REQUIRED", legIndex: 1, retryable: true, resolutionOwner: "END_USER", resolutionAction: "set_up_wallet", detail: "SOLANA" });
    expect(leerErrorDeCotizacion(errorDelKit("SDK_RAMPS_NO_ROUTE", { rejected: [solana] }))).toEqual({ estado: "no-se-puede" });
    // Con la verificación por delante, va primero.
    expect(leerErrorDeCotizacion(errorDelKit("SDK_RAMPS_NO_ROUTE", { rejected: [linea, rechazo()] }))).toMatchObject({ falta: [{ que: "verificacion" }, { que: "linea" }] });
  });

  it("proteger la cuenta, cambiar el monto y lo que no sabemos resolver", () => {
    const con = (resolutionAction: string, detail?: string) => {
      const r = rechazo({ failure: { code: "X", legIndex: 0, retryable: true, resolutionOwner: "END_USER", resolutionAction, ...(detail ? { detail } : {}) } });
      delete r.requirement;
      return leerErrorDeCotizacion(errorDelKit("SDK_RAMPS_NO_ROUTE", { rejected: [r] }));
    };
    expect(con("set_up_recovery")).toEqual({ estado: "falta", falta: [{ que: "proteger-cuenta" }] });
    expect(con("change_amount")).toEqual({ estado: "cambiar-monto" });
    for (const a of ["fund_gas_wallet", "enable_signing_mode", "contact_pollar", "create_wallet", "migrate_custody", "complete_verification", "algo-nuevo"]) {
      expect(con(a), a).toEqual({ estado: "no-se-puede" });
    }
    expect(leerErrorDeCotizacion(errorDelKit("SDK_RAMPS_NO_ROUTE", { rejected: [] }))).toEqual({ estado: "no-se-puede" });
    expect(leerErrorDeCotizacion(errorDelKit("SDK_RAMPS_NO_ROUTE"))).toEqual({ estado: "no-se-puede" });
    expect(leerErrorDeCotizacion(errorDelKit("SDK_RAMPS_NO_ROUTE", { rejected: [{ legs: [] }, null, "x"] }))).toEqual({ estado: "no-se-puede" });
  });

  it("sin créditos (402), sin red, pidiendo proteger la cuenta o con cualquier otro error", () => {
    expect(leerErrorDeCotizacion(errorDelKit("SDK_CREDITS_INSUFFICIENT"))).toEqual({ estado: "sin-creditos" });
    expect(leerErrorDeCotizacion(errorDelKit("SDK_BILLING_OVERDUE"))).toEqual({ estado: "sin-creditos" });
    expect(leerErrorDeCotizacion(Object.assign(new Error("Request timed out after 30000ms"), { name: "PollarNetworkError", code: "SDK_NETWORK_TIMEOUT" }))).toEqual({ estado: "sin-red" });
    expect(leerErrorDeCotizacion(new TypeError("Failed to fetch"))).toEqual({ estado: "sin-red" });
    expect(leerErrorDeCotizacion(errorDelKit("SDK_WALLET_RECOVERY_REQUIRED"))).toEqual({ estado: "falta", falta: [{ que: "proteger-cuenta" }] });
    expect(leerErrorDeCotizacion(errorDelKit("VALIDATION_ERROR"))).toEqual({ estado: "no-se-puede" });
    for (const e of [null, undefined, "x", 3, {}]) expect(leerErrorDeCotizacion(e)).toEqual({ estado: "no-se-puede" });
  });

  it("los errores de las otras llamadas de la carga, en una palabra", () => {
    expect(motivoDelError(errorDelKit("SDK_CREDITS_INSUFFICIENT"))).toBe("sin-creditos");
    expect(motivoDelError(errorDelKit("SDK_BILLING_OVERDUE"))).toBe("sin-creditos");
    expect(motivoDelError(new TypeError("Load failed"))).toBe("sin-red");
    expect(motivoDelError(errorDelKit("SDK_WALLET_RECOVERY_REQUIRED"))).toBe("proteger-cuenta");
    expect(motivoDelError(errorDelKit("SDK_RAMPS_WALLET_NOT_READY"))).toBe("cuenta-de-paso-espera");
    expect(motivoDelError(errorDelKit("SDK_RAMPS_QUOTE_EXPIRED"))).toBe("precio-vencido");
    expect(motivoDelError(errorDelKit("SDK_RAMPS_NO_ROUTE"))).toBe("otro");
    expect(motivoDelError(null)).toBe("otro");
  });
});

/* ------------------------------------------------------------------ el precio */

const tramo = (t: Partial<RampQuoteLeg> & Pick<RampQuoteLeg, "index" | "kind" | "from" | "to">): RampQuoteLeg => ({
  amountIn: "0",
  amountOut: "0",
  providerFees: [],
  fees: [],
  etaSeconds: null,
  expiresAt: null,
  wallet: null,
  requiredFields: [],
  ...t,
});
const cotizacion = (q: Partial<RampQuote> = {}): RampQuote => ({
  quoteId: "q-300",
  expiresAt: "2026-11-11T15:10:00.000Z",
  amountIn: "300",
  amountOut: "24.5",
  etaSeconds: 540,
  legs: [
    tramo({ index: 0, kind: "PROVIDER_ONRAMP", from: BOB_QR, to: USDT_POLYGON, amountIn: "300", amountOut: "24.9" }),
    tramo({ index: 1, kind: "SWAP", from: USDT_POLYGON, to: USDC_POLYGON, amountIn: "24.9", amountOut: "24.85", wallet: { chain: "POLYGON", address: "0x00000000000000000000000000000000000000cc", mode: "COSIGNED", signs: true } }),
    tramo({ index: 2, kind: "BRIDGE", from: USDC_POLYGON, to: USDC_STELLAR, amountIn: "24.85", amountOut: "24.5", wallet: { chain: "POLYGON", address: "0x00000000000000000000000000000000000000cc", mode: "COSIGNED", signs: true } }),
  ],
  ...q,
});
const respuesta = (quotes: RampQuote[], rejected: RampQuoteRejection[] = []): RampQuotesResponse => ({ quotes, rejected });

describe("el precio de una carga", () => {
  it("lo que paga, lo que le llega, cuánto le sale cada dólar, cuánto tarda y hasta cuándo vale", () => {
    expect(leerCotizacion(respuesta([cotizacion()]))).toEqual({
      estado: "precio",
      precio: { quoteId: "q-300", vence: "2026-11-11T15:10:00.000Z", pagas: 300, recibis: 24.5, tasa: 300 / 24.5, minutos: 9, aprobaciones: null, campos: [] },
    });
  });

  it("el número de aprobaciones sale de los pasos que firman, solo si la cotización los trae en cada tramo", () => {
    const conPasos = (legs: RampQuoteLeg[]) => legs.map((l) => (l.kind === "PROVIDER_ONRAMP" ? l : { ...l, steps: [{ kind: "approve", signs: true }, { kind: l.kind === "SWAP" ? "swap" : "burn", signs: true }, { kind: "mint", signs: false }] }));
    const q = cotizacion();
    expect(leerCotizacion(respuesta([{ ...q, legs: conPasos(q.legs) }]))).toMatchObject({ precio: { aprobaciones: 4 } });
    // Si un tramo que firma no trae sus pasos, no se inventa un número.
    const legs = conPasos(q.legs);
    legs[2] = q.legs[2] as RampQuoteLeg;
    expect(leerCotizacion(respuesta([{ ...q, legs }]))).toMatchObject({ precio: { aprobaciones: null } });
  });

  it("los datos que pide, una vez por clave, de todos los tramos", () => {
    const campo = { key: "docNumber", label: "Número de carnet", type: "text" as const };
    const q = cotizacion();
    const legs = q.legs.map((l, i) => (i === 0 ? { ...l, requiredFields: [campo, { key: "email", label: "Correo", type: "email" as const }] } : i === 1 ? { ...l, requiredFields: [campo] } : l));
    expect(leerCotizacion(respuesta([{ ...q, legs }]))).toMatchObject({ precio: { campos: [campo, { key: "email", label: "Correo", type: "email" }] } });
    // Un dato de un tipo que no sabemos pedir deja esa cotización afuera.
    const raro = q.legs.map((l, i) => (i === 0 ? { ...l, requiredFields: [{ key: "x", label: "X", type: "file" as never }] } : l));
    expect(leerCotizacion(respuesta([{ ...q, legs: raro }]))).toEqual({ estado: "no-se-puede" });
  });

  it("toma la mejor cotización que de verdad paga bolivianos y llega al USDC de Circle en Stellar", () => {
    const q = cotizacion();
    const aPolygon = cotizacion({ quoteId: "q-polygon", legs: [q.legs[0] as RampQuoteLeg] });
    const otroEmisor = cotizacion({ quoteId: "q-otro", legs: [q.legs[0] as RampQuoteLeg, { ...(q.legs[2] as RampQuoteLeg), to: { ...USDC_STELLAR, identifier: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5" } }] });
    const conVenta = cotizacion({ quoteId: "q-venta", legs: [{ ...(q.legs[0] as RampQuoteLeg), kind: "PROVIDER_OFFRAMP" }, q.legs[2] as RampQuoteLeg] });
    const enDolares = cotizacion({ quoteId: "q-usd", legs: [{ ...(q.legs[0] as RampQuoteLeg), from: { ...BOB_QR, currency: "USD" } }, q.legs[2] as RampQuoteLeg] });
    const sinMonto = cotizacion({ quoteId: "q-cero", amountOut: "0" });
    const montoRaro = cotizacion({ quoteId: "q-raro", amountIn: "trescientos" });
    const buena = cotizacion({ quoteId: "q-buena" });
    expect(leerCotizacion(respuesta([aPolygon, otroEmisor, conVenta, enDolares, sinMonto, montoRaro, buena]))).toMatchObject({ estado: "precio", precio: { quoteId: "q-buena" } });
    expect(leerCotizacion(respuesta([aPolygon, otroEmisor, conVenta, enDolares, sinMonto, montoRaro]))).toEqual({ estado: "no-se-puede" });
  });

  it("sin cotizaciones, lee las rutas rechazadas; sin nada, no se puede", () => {
    expect(leerCotizacion(respuesta([], [rechazo()]))).toMatchObject({ estado: "falta", falta: [{ que: "verificacion" }] });
    expect(leerCotizacion(respuesta([]))).toEqual({ estado: "no-se-puede" });
    for (const x of [null, undefined, {}, { quotes: "x" }]) expect(leerCotizacion(x)).toEqual({ estado: "no-se-puede" });
  });

  it("sin tiempo estimado o sin vencimiento legible, no se inventan", () => {
    expect(leerCotizacion(respuesta([cotizacion({ etaSeconds: null, expiresAt: "pronto" })]))).toMatchObject({ precio: { minutos: null, vence: null } });
    expect(leerCotizacion(respuesta([cotizacion({ etaSeconds: 20 })]))).toMatchObject({ precio: { minutos: 1 } });
  });
});

/* ------------------------------------------------------------------ la orden, con los tipos del kit */

const CREADA = "2026-11-16T15:00:00.000Z";
const T0 = Date.parse(CREADA);
const MIN = 60_000;
const VENCE_QR = "2026-11-16T15:15:00.000Z";
const CUENTA = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";
const IMAGEN_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

const paso = (kind: RampOrderLegStep["kind"], status: RampOrderLegStep["status"] = "pending"): RampOrderLegStep => ({
  kind,
  status,
  signs: kind === "approve" || kind === "swap" || kind === "burn",
  hash: null,
});

const tramoDeOrden = (t: Partial<RampOrderLeg> & Pick<RampOrderLeg, "index" | "kind" | "from" | "to">): RampOrderLeg => ({
  status: "PENDING",
  amountInPlanned: "0",
  amountOutPlanned: "0",
  amountInActual: null,
  amountOutActual: null,
  onchainTxHash: null,
  signingMode: null,
  fundsLocation: null,
  failure: null,
  steps: [],
  etaSeconds: null,
  startedAt: null,
  ...t,
});

type AccionDePago = Extract<RampPendingAction, { kind: "FIAT_PAYMENT" }>;
type Instrucciones = AccionDePago["instructions"];

const pagoQr = (instrucciones: Record<string, unknown> = {}, accion: Partial<AccionDePago> = {}): AccionDePago => ({
  kind: "FIAT_PAYMENT",
  actionId: "act-pago",
  legIndex: 0,
  expiresAt: VENCE_QR,
  instructions: {
    kind: "qr",
    payload: "00020101021226370016",
    amount: "300.00",
    currency: "BOB",
    scannable: { kind: "opaque", payload: null, payloadLabel: null, image: { mediaType: "image/png", encoding: "base64", data: IMAGEN_PNG, inlineSafe: false } },
    link: null,
    ...instrucciones,
  } as Instrucciones,
  ...accion,
});
const NADA: RampPendingAction = { kind: "NONE", actionId: "act-nada", legIndex: 0 };
const aprobacion = (legIndex: number, cosignRequestId = "cos-1"): RampPendingAction => ({ kind: "COSIGN_APPROVAL", actionId: "act-aprobar", legIndex, cosignRequestId, summary: "Approve" });
const FONDOS_EN_PASO = { chain: "POLYGON", address: "0x00000000000000000000000000000000000000cc", asset: "USDT0", amount: "24900000" } as const;

interface Tramos {
  onramp?: Partial<RampOrderLeg>;
  canje?: Partial<RampOrderLeg>;
  envio?: Partial<RampOrderLeg>;
}

/** Una carga de Bs 300: Stereum entrega USDT0 en Polygon, la cuenta de paso lo cambia a USDC y el puente lo deja en Stellar. */
function orden(o: Partial<RampOrder> = {}, t: Tramos = {}): RampOrder {
  return {
    id: "ord_9f8e7d6c5b4a3210",
    direction: "ONRAMP",
    state: "awaiting_payment",
    createdAt: CREADA,
    updatedAt: CREADA,
    legs: [
      tramoDeOrden({ index: 0, kind: "PROVIDER_ONRAMP", from: BOB_QR, to: USDT_POLYGON, amountInPlanned: "300", amountOutPlanned: "24.9", status: "AWAITING_ACTION", etaSeconds: 300, startedAt: CREADA, ...t.onramp }),
      tramoDeOrden({ index: 1, kind: "SWAP", from: USDT_POLYGON, to: USDC_POLYGON, amountInPlanned: "24.9", amountOutPlanned: "24.85", signingMode: "COSIGNED", steps: [paso("approve"), paso("swap")], etaSeconds: 60, ...t.canje }),
      tramoDeOrden({ index: 2, kind: "BRIDGE", from: USDC_POLYGON, to: USDC_STELLAR, amountInPlanned: "24.85", amountOutPlanned: "24.5", signingMode: "COSIGNED", steps: [paso("approve"), paso("burn"), paso("attestation"), paso("mint")], etaSeconds: 600, ...t.envio }),
    ],
    pendingAction: pagoQr(),
    failure: null,
    nextPollAfter: "2026-11-16T15:00:10.000Z",
    ...o,
  };
}

const ONRAMP_LISTO: Partial<RampOrderLeg> = { status: "COMPLETED", amountInActual: "300", amountOutActual: "24.9" };
/** Stereum registró el pago y lo está pasando a dólares digitales. */
const conStereum = () => orden({ state: "processing", pendingAction: NADA }, { onramp: { status: "ACTIVE", amountInActual: "300" } });
/** El dinero llegó a la cuenta de paso y espera que se apruebe el permiso del canje: la primera aprobación. */
const enLaCuentaDePaso = (accion: RampPendingAction | null = aprobacion(1)) =>
  orden(
    { state: "processing", pendingAction: accion },
    { onramp: ONRAMP_LISTO, canje: { status: "AWAITING_ACTION", fundsLocation: FONDOS_EN_PASO, startedAt: CREADA, steps: [paso("approve", "awaiting_approval"), paso("swap")] } },
  );
/** El permiso del canje ya se aprobó: espera el canje. */
const esperaElCanje = () =>
  orden(
    { state: "processing", pendingAction: aprobacion(1, "cos-2") },
    { onramp: ONRAMP_LISTO, canje: { status: "AWAITING_ACTION", fundsLocation: FONDOS_EN_PASO, startedAt: CREADA, steps: [paso("approve", "done"), paso("swap", "awaiting_approval")] } },
  );
const CANJE_LISTO: Partial<RampOrderLeg> = { status: "COMPLETED", amountOutActual: "24.85", steps: [paso("approve", "done"), paso("swap", "done")] };
/** En el envío a Stellar, con el permiso o el envío esperando. */
const esperaElEnvio = (cual: "approve" | "burn") =>
  orden(
    { state: "processing", pendingAction: aprobacion(2, "cos-3") },
    {
      onramp: ONRAMP_LISTO,
      canje: CANJE_LISTO,
      envio: {
        status: "AWAITING_ACTION",
        fundsLocation: { ...FONDOS_EN_PASO, asset: "USDC" },
        startedAt: CREADA,
        steps: cual === "approve" ? [paso("approve", "awaiting_approval"), paso("burn"), paso("attestation"), paso("mint")] : [paso("approve", "done"), paso("burn", "awaiting_approval"), paso("attestation"), paso("mint")],
      },
    },
  );
/** El envío ya salió de Polygon y Circle lo está confirmando. */
const viajando = () =>
  orden(
    { state: "settling_onchain", pendingAction: NADA },
    { onramp: ONRAMP_LISTO, canje: CANJE_LISTO, envio: { status: "ACTIVE", startedAt: CREADA, steps: [paso("approve", "done"), paso("burn", "done"), paso("attestation", "confirming"), paso("mint")] } },
  );
const llego = (amountOutActual: string | null = "24.5") =>
  orden(
    { state: "completed", pendingAction: null, nextPollAfter: null },
    { onramp: ONRAMP_LISTO, canje: CANJE_LISTO, envio: { status: "COMPLETED", amountOutActual, steps: [paso("approve", "done"), paso("burn", "done"), paso("attestation", "done"), paso("mint", "done")] } },
  );
const frenadaEnElCanje = (failure: RampOrder["failure"], fundsLocation: RampOrderLeg["fundsLocation"] = FONDOS_EN_PASO) =>
  orden({ state: "processing", pendingAction: NADA, failure, nextPollAfter: null }, { onramp: ONRAMP_LISTO, canje: { status: "HELD", fundsLocation, failure } });
const falla = (f: Partial<NonNullable<RampOrder["failure"]>> = {}): NonNullable<RampOrder["failure"]> => ({
  legIndex: 1,
  code: "SWAP_FAILED",
  retryable: false,
  resolutionOwner: "POLLAR",
  resolutionAction: "pollar_follows_up",
  detail: null,
  ...f,
});

const marcas = (m: Partial<MarcasDeOrden> = {}): MarcasDeOrden => ({ ...SIN_MARCAS, ...m });

/** Órdenes raras que no se leen como una carga. */
function ordenesQueNoSonUnaCarga(): unknown[] {
  const o = orden();
  const sinTramos = { ...o, legs: [] };
  const otroPrimero = { ...o, legs: [o.legs[1], o.legs[0], o.legs[2]] };
  const otroEmisor = { ...o, legs: [o.legs[0], o.legs[1], { ...o.legs[2], to: { ...USDC_STELLAR, identifier: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5" } }] };
  const aPolygon = { ...o, legs: [o.legs[0], o.legs[1]] };
  const tramoRaro = { ...o, legs: [o.legs[0], { ...o.legs[1], kind: "TELEPORT" }, o.legs[2]] };
  const pasoRaro = { ...o, legs: [o.legs[0], { ...o.legs[1], steps: [{ kind: "approve", status: "maybe", signs: true, hash: null }] }, o.legs[2]] };
  const puenteAntes = { ...o, legs: [o.legs[0], o.legs[2], o.legs[1]] };
  const indiceRepetido = { ...o, legs: [o.legs[0], o.legs[1], { ...o.legs[2], index: 1 }] };
  const enDolares = { ...o, legs: [{ ...o.legs[0], from: { ...BOB_QR, currency: "USD" } }, o.legs[1], o.legs[2]] };
  return [null, undefined, 3, "x", {}, { ...o, direction: "OFFRAMP" }, { ...o, id: "" }, sinTramos, otroPrimero, otroEmisor, aPolygon, tramoRaro, pasoRaro, puenteAntes, indiceRepetido, enDolares];
}

describe("dónde está tu dinero, en cada momento", () => {
  const donde = (o: unknown, m: Partial<MarcasDeOrden> = {}, vista = {}) => dondeEstaTuDinero(o, marcas(m), T0 + MIN, vista);

  it("antes de pagar, si todavía no pagaste, en tu banco; con Ya pagué, saliendo de tu banco", () => {
    expect(donde(orden())).toEqual({ donde: "dondeBanco" });
    expect(donde(orden(), { mostroQr: T0, guardoQr: T0 })).toEqual({ donde: "dondeBanco" });
    expect(donde(orden(), { dijoPago: T0 })).toEqual({ donde: "dondeSaliendo" });
  });

  it("nunca afirma que no pagaste: antes de que el pago se vea, siempre la frase prudente", () => {
    const vencido = pagoQr({}, { expiresAt: "2026-11-16T14:00:00.000Z" });
    for (const state of ["created", "awaiting_payment", "processing"] as const) {
      for (const pendingAction of [pagoQr(), vencido, NADA, null]) {
        for (const m of [{}, { mostroQr: T0 }, { guardoQr: T0 }, { mostroQr: T0, guardoQr: T0 }]) {
          const r = donde(orden({ state, pendingAction }), m);
          if (state === "processing" && pendingAction?.kind !== "FIAT_PAYMENT") expect(r).toEqual({ donde: "dondeStereum" });
          else expect(r, `${state} ${pendingAction?.kind} ${JSON.stringify(m)}`).toEqual({ donde: "dondeBanco" });
        }
      }
    }
  });

  it("con Stereum, en la cuenta de paso, viajando y en tu cuenta", () => {
    expect(donde(conStereum())).toEqual({ donde: "dondeStereum" });
    expect(donde(enLaCuentaDePaso())).toEqual({ donde: "dondePaso" });
    expect(donde(esperaElCanje())).toEqual({ donde: "dondePaso" });
    expect(donde(esperaElEnvio("approve"))).toEqual({ donde: "dondePaso" });
    expect(donde(esperaElEnvio("burn"))).toEqual({ donde: "dondePaso" });
    expect(donde(viajando())).toEqual({ donde: "dondeViaje" });
    expect(donde(llego())).toEqual({ donde: "dondeCuenta" });
  });

  it("en la cuenta de paso no lleva ningún número: todavía no se sabe en qué unidad viene", () => {
    const r = donde(enLaCuentaDePaso());
    expect(Object.keys(r)).toEqual(["donde"]);
    // Sin la ubicación de los fondos, el tramo que sale de Polygon con el anterior terminado también es la cuenta de paso.
    expect(donde(orden({ state: "processing", pendingAction: NADA }, { onramp: ONRAMP_LISTO }))).toEqual({ donde: "dondePaso" });
  });

  it("retenida: en la cuenta de paso, en tu cuenta o, sin un dato que lo diga, en revisión", () => {
    expect(donde(frenadaEnElCanje(falla()))).toEqual({ donde: "dondePaso" });
    expect(donde(frenadaEnElCanje(falla(), null))).toEqual({ donde: "dondeRevision" });
    const enStellar = { chain: "STELLAR", address: CUENTA, asset: "USDC", amount: "24.5" } as const;
    const envioFrenado = (fundsLocation: RampOrderLeg["fundsLocation"]) =>
      orden({ state: "processing", pendingAction: NADA, nextPollAfter: null }, { onramp: ONRAMP_LISTO, canje: CANJE_LISTO, envio: { status: "HELD", fundsLocation, steps: [paso("approve", "done"), paso("burn", "done"), paso("attestation", "done"), paso("mint")] } });
    expect(donde(envioFrenado(enStellar), {}, { cuenta: CUENTA })).toEqual({ donde: "dondeCuenta" });
    // Sin saber que es la cuenta de la persona, no se dice que está en su cuenta.
    expect(donde(envioFrenado(enStellar))).toEqual({ donde: "dondeRevision" });
    expect(donde(envioFrenado({ ...enStellar, address: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5" }), {}, { cuenta: CUENTA })).toEqual({ donde: "dondeRevision" });
    // Ya salió de Polygon: no está en la cuenta de paso aunque el tramo diga Polygon.
    expect(donde(envioFrenado(FONDOS_EN_PASO), {}, { cuenta: CUENTA })).toEqual({ donde: "dondeRevision" });
    expect(donde(orden({ state: "processing", pendingAction: NADA }, { onramp: { status: "HELD", fundsLocation: FONDOS_EN_PASO } }))).toEqual({ donde: "dondeRevision" });
  });

  it("devuelta, falló antes de que hubiera QR y falló en cualquier otro caso", () => {
    expect(donde(orden({ state: "refunded" }))).toEqual({ cierre: "cargaDevueltaSinMonto" });
    const fallo = orden({ state: "failed", pendingAction: null, nextPollAfter: null });
    expect(donde(fallo, {}, { falloAlCrear: true })).toEqual({ cierre: "cargaFalloSinPago" });
    expect(donde(fallo)).toEqual({ cierre: "cargaFalloSinVerPago" });
    for (const m of [{ mostroQr: T0 }, { guardoQr: T0 }, { dijoPago: T0 }]) expect(donde(fallo, m, { falloAlCrear: true })).toEqual({ cierre: "cargaFalloSinVerPago" });
  });

  it("lo que no se lee como una carga lo revisa Pollar", () => {
    for (const x of ordenesQueNoSonUnaCarga()) expect(donde(x), JSON.stringify(x)?.slice(0, 80)).toEqual({ donde: "dondeRevision" });
  });
});

describe("qué pantalla toca según la orden", () => {
  const AHORA = T0 + 30_000;
  const pantalla = (o: unknown, m: Partial<MarcasDeOrden> = {}, ahora = AHORA, vista = {}) => pasoDeOrden(o, marcas(m), ahora, vista);

  it("la orden recién creada, sin QR mostrado en este navegador: el QR para pagar", () => {
    expect(pantalla(orden())).toEqual({ pantalla: "pagar", qr: { bs: "300.00", imagen: `data:image/png;base64,${IMAGEN_PNG}`, enlace: null, vence: Date.parse(VENCE_QR) } });
  });

  it("el monto a pagar sale de la orden, no del botón que se eligió", () => {
    expect(pantalla(orden({ pendingAction: pagoQr({ amount: "312.50" }) }))).toMatchObject({ pantalla: "pagar", qr: { bs: "312.50" } });
    // Un monto que no es un monto, cero o en otra moneda no se muestra para pagar.
    for (const i of [{ amount: "tres" }, { amount: "0" }, { amount: "" }, { currency: "USD" }]) expect(pantalla(orden({ pendingAction: pagoQr(i) })), JSON.stringify(i)).toEqual({ pantalla: "desconocido" });
  });

  it("el enlace al banco, solo si es https", () => {
    expect(pantalla(orden({ pendingAction: pagoQr({ link: "https://pago.example.org/qr/1" }) }))).toMatchObject({ qr: { enlace: "https://pago.example.org/qr/1" } });
    for (const link of ["http://pago.example.org", "javascript:alert(1)", "https://ana:clave@pago.example.org", "no es un enlace"]) {
      expect(pantalla(orden({ pendingAction: pagoQr({ link }) })), link).toMatchObject({ qr: { enlace: null } });
    }
  });

  it("con el QR ya mostrado o guardado, o con la orden de más de 2 minutos, primero pregunta si ya pagó", () => {
    expect(pantalla(orden(), { mostroQr: T0 })).toEqual({ pantalla: "ya-pagaste" });
    expect(pantalla(orden(), { guardoQr: T0 })).toEqual({ pantalla: "ya-pagaste" });
    expect(pantalla(orden(), {}, T0 + 2 * MIN)).toEqual({ pantalla: "ya-pagaste" });
    // Otro aparato o una ventana privada: sin marcas y con la orden vieja, también pregunta.
    expect(pantalla(orden(), {}, T0 + 10 * MIN)).toEqual({ pantalla: "ya-pagaste" });
    // Sin saber cuándo se creó, pregunta.
    expect(pantalla(orden({ createdAt: "ayer" }))).toEqual({ pantalla: "ya-pagaste" });
    // Con Todavía no, mostrame el QR, el QR.
    expect(pantalla(orden(), { mostroQr: T0 }, AHORA, { qrALaVista: true })).toMatchObject({ pantalla: "pagar" });
  });

  it("sin la imagen del QR: no pagues nada", () => {
    const sinImagen = [
      { scannable: undefined },
      { scannable: { kind: "opaque", payload: "000201", payloadLabel: null, image: { mediaType: "image/png", encoding: "base64", data: "", inlineSafe: false } } },
      { scannable: { kind: "opaque", payload: null, payloadLabel: null, image: { mediaType: "text/html", encoding: "utf8", data: "<b>x</b>", inlineSafe: false } } },
      { scannable: { kind: "opaque", payload: null, payloadLabel: null, image: { mediaType: "image/png", encoding: "base64", data: "no es base64!", inlineSafe: false } } },
      { scannable: { kind: "opaque", payload: null, payloadLabel: null, image: { mediaType: "image/png", encoding: "utf8", data: "PNG", inlineSafe: false } } },
    ];
    for (const i of sinImagen) expect(pantalla(orden({ pendingAction: pagoQr(i) })), JSON.stringify(i)).toEqual({ pantalla: "qr-falta" });
    // Esperando el pago sin ninguna acción de pago: tampoco hay QR que pagar.
    expect(pantalla(orden({ pendingAction: NADA }))).toEqual({ pantalla: "qr-falta" });
    expect(pantalla(orden({ state: "created", pendingAction: null }))).toEqual({ pantalla: "qr-falta" });
  });

  it("el QR va siempre como imagen: un SVG del servidor nunca se mete en la página", () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>';
    const r = pantalla(orden({ pendingAction: pagoQr({ scannable: { kind: "opaque", payload: null, payloadLabel: null, image: { mediaType: "image/svg+xml", encoding: "utf8", data: svg, inlineSafe: true } } }) }));
    expect(r).toMatchObject({ pantalla: "pagar" });
    const imagen = (r as { qr: { imagen: string } }).qr.imagen;
    expect(imagen.startsWith("data:image/svg+xml;charset=utf-8,")).toBe(true);
    expect(imagen).not.toContain("<");
    expect(imagenDelQr({ mediaType: "image/png", encoding: "base64", data: `${IMAGEN_PNG.slice(0, 20)}\n${IMAGEN_PNG.slice(20)}`, inlineSafe: false })).toBe(`data:image/png;base64,${IMAGEN_PNG}`);
    for (const x of [null, undefined, "x", {}, { mediaType: "image/png", encoding: "hex", data: "00" }]) expect(imagenDelQr(x)).toBeNull();
  });

  it("después de Ya pagué, el QR se esconde y se espera; a los 2 minutos, que tarda", () => {
    expect(pantalla(orden(), { mostroQr: T0, dijoPago: T0 + 30_000 }, T0 + MIN)).toEqual({ pantalla: "esperando-pago", tarda: false });
    expect(pantalla(orden(), { dijoPago: T0 + 30_000 }, T0 + 30_000 + 2 * MIN)).toEqual({ pantalla: "esperando-pago", tarda: true });
    // Aunque el QR haya estado a la vista.
    expect(pantalla(orden(), { dijoPago: T0 }, AHORA, { qrALaVista: true })).toEqual({ pantalla: "esperando-pago", tarda: false });
    // Si dijo que pagó y la orden ya no muestra la acción de pago, sigue esperando.
    expect(pantalla(orden({ pendingAction: NADA }), { dijoPago: T0 })).toEqual({ pantalla: "esperando-pago", tarda: false });
  });

  it("pagó con el QR ya vencido: nunca se le pide pagar otra vez", () => {
    expect(pantalla(orden(), { dijoPago: T0 + 20 * MIN }, T0 + 21 * MIN)).toEqual({ pantalla: "esperando-pago", tarda: false });
  });

  it("el QR venció y la carga sigue abierta: no se da otro QR", () => {
    const despues = Date.parse(VENCE_QR) + 1;
    for (const m of [{}, { mostroQr: T0 }, { guardoQr: T0 }]) {
      expect(pantalla(orden(), m, despues)).toEqual({ pantalla: "qr-vencido-abierta" });
      expect(pantalla(orden(), m, despues, { qrALaVista: true })).toEqual({ pantalla: "qr-vencido-abierta" });
    }
  });

  it("el QR venció y la carga se cerró: primero pregunta, y recién con Todavía no ofrece uno nuevo", () => {
    const despues = Date.parse(VENCE_QR) + 1;
    const cerrada = orden({ state: "failed", nextPollAfter: null });
    expect(pantalla(cerrada, {}, despues)).toEqual({ pantalla: "ya-pagaste" });
    expect(pantalla(cerrada, { mostroQr: T0 }, despues, { qrALaVista: true })).toEqual({ pantalla: "qr-vencido-cerrada" });
    // Si dijo que pagó, no se le ofrece otro QR: la carga no se pudo.
    expect(pantalla(cerrada, { dijoPago: T0 }, despues, { qrALaVista: true })).toEqual({ pantalla: "no-se-pudo" });
    // Cerrada sin el QR vencido, o sin la acción de pago: no se pudo.
    expect(pantalla(cerrada, {}, AHORA)).toEqual({ pantalla: "no-se-pudo" });
    expect(pantalla(orden({ state: "failed", pendingAction: null }), {}, despues)).toEqual({ pantalla: "no-se-pudo" });
  });

  it("antes de la primera aprobación, el aviso con cuántos pasos vienen; después, cada paso con los que faltan", () => {
    expect(pantalla(enLaCuentaDePaso())).toEqual({ pantalla: "antes-de-aprobar", pasos: 4 });
    const vio = { vioAntesDeAprobar: true };
    expect(pantalla(enLaCuentaDePaso(), {}, AHORA, vio)).toEqual({ pantalla: "aprobar", paso: { tramo: 1, que: "permiso-cambio", pedido: "cos-1" }, despues: 3 });
    // Con un paso ya aprobado, el aviso no vuelve.
    expect(pantalla(esperaElCanje())).toEqual({ pantalla: "aprobar", paso: { tramo: 1, que: "cambio", pedido: "cos-2" }, despues: 2 });
    expect(pantalla(esperaElEnvio("approve"))).toEqual({ pantalla: "aprobar", paso: { tramo: 2, que: "permiso-envio", pedido: "cos-3" }, despues: 1 });
    expect(pantalla(esperaElEnvio("burn"))).toEqual({ pantalla: "aprobar", paso: { tramo: 2, que: "envio", pedido: "cos-3" }, despues: 0 });
  });

  it("cerró con pasos por delante o no aprobó por días: al volver, el mismo paso, que no se aprueba solo", () => {
    // Lo mismo una hora o dos días después: la pantalla pide el toque, no aprueba.
    for (const ahora of [T0 + 60 * MIN, T0 + 48 * 60 * MIN]) expect(pantalla(esperaElCanje(), {}, ahora)).toMatchObject({ pantalla: "aprobar" });
  });

  it("un pedido de aprobación que no reconocemos va al paso desconocido", () => {
    const con = (accion: RampPendingAction, canje: Partial<RampOrderLeg> = {}) =>
      orden({ state: "processing", pendingAction: accion }, { onramp: ONRAMP_LISTO, canje: { status: "AWAITING_ACTION", fundsLocation: FONDOS_EN_PASO, steps: [paso("approve", "awaiting_approval"), paso("swap")], ...canje } });
    const raros: RampOrder[] = [
      con(aprobacion(0)),
      con(aprobacion(7)),
      con({ ...(aprobacion(1) as Extract<RampPendingAction, { kind: "COSIGN_APPROVAL" }>), cosignRequestId: "" }),
      con(aprobacion(1), { steps: [paso("approve", "awaiting_approval"), paso("swap", "awaiting_approval")] }),
      con(aprobacion(1), { steps: [paso("approve", "done"), paso("swap", "done")] }),
      con(aprobacion(1), { steps: [{ kind: "approve", status: "awaiting_approval", signs: false, hash: null }] }),
      con(aprobacion(1), { steps: [paso("burn", "awaiting_approval")] }),
      con(aprobacion(1), { steps: [] }),
      orden({ state: "processing", pendingAction: aprobacion(2) }, { onramp: ONRAMP_LISTO, canje: CANJE_LISTO, envio: { status: "AWAITING_ACTION", steps: [paso("approve", "done"), paso("swap", "awaiting_approval")] } }),
      orden({ state: "processing", pendingAction: aprobacion(2) }, { onramp: ONRAMP_LISTO, canje: CANJE_LISTO, envio: { status: "AWAITING_ACTION", steps: [paso("approve", "done"), paso("burn", "done"), { kind: "attestation", status: "awaiting_approval", signs: true, hash: null }] } }),
    ];
    for (const o of raros) expect(pantalla(o, {}, AHORA, { vioAntesDeAprobar: true }), JSON.stringify(o.pendingAction)).toEqual({ pantalla: "desconocido" });
  });

  it("firmar con una billetera propia, pagar por transferencia o en la página del proveedor, una verificación dentro de la orden o un estado nuevo: paso desconocido", () => {
    const firma: RampPendingAction = { kind: "SIGNATURE", actionId: "a", legIndex: 1, chain: "POLYGON", payload: { encoding: "hex", value: "0x02" }, summary: "Sign", expiresAt: VENCE_QR };
    const kyc: RampPendingAction = { kind: "KYC", actionId: "a", legIndex: 0, steps: [], url: "https://verificar.example.org" };
    const transferencia = pagoQr({ kind: "bank_transfer", details: [{ label: "Cuenta", value: "123" }], reference: null });
    const pagina = pagoQr({ kind: "hosted", url: "https://pago.example.org" });
    for (const pendingAction of [firma, kyc, transferencia, pagina, { kind: "TELEPORT", actionId: "a", legIndex: 0 } as unknown as RampPendingAction]) {
      expect(pantalla(orden({ state: "processing", pendingAction })), pendingAction.kind).toEqual({ pantalla: "desconocido" });
    }
    expect(pantalla(orden({ state: "en_el_aire" }))).toEqual({ pantalla: "desconocido" });
    for (const x of ordenesQueNoSonUnaCarga()) expect(pantalla(x), JSON.stringify(x)?.slice(0, 80)).toEqual({ pantalla: "desconocido" });
  });

  it("en camino: con cero aprobaciones por delante sigue sola, con una o más hay que volver", () => {
    expect(pantalla(viajando())).toEqual({ pantalla: "en-camino", faltan: 0 });
    expect(pantalla(conStereum())).toEqual({ pantalla: "en-camino", faltan: 4 });
    expect(pantalla(orden({ state: "processing", pendingAction: NADA }, { onramp: ONRAMP_LISTO, canje: CANJE_LISTO }))).toEqual({ pantalla: "en-camino", faltan: 2 });
  });

  it("llegó, con lo que llegó si la orden lo dice", () => {
    expect(pantalla(llego())).toEqual({ pantalla: "llego", dolares: 24.5 });
    expect(pantalla(llego(null))).toEqual({ pantalla: "llego", dolares: null });
  });

  it("devuelta o fallada: no se pudo", () => {
    expect(pantalla(orden({ state: "refunded", pendingAction: null }))).toEqual({ pantalla: "no-se-pudo" });
    expect(pantalla(orden({ state: "failed", pendingAction: null }))).toEqual({ pantalla: "no-se-pudo" });
  });

  it("frenada: la arregla la persona, la revisa Pollar, o falta algo de Tinkazo", () => {
    expect(pantalla(frenadaEnElCanje(falla({ resolutionOwner: "END_USER", retryable: true, resolutionAction: "approve_again" })))).toEqual({ pantalla: "frenada", quien: "vos" });
    expect(pantalla(frenadaEnElCanje(falla()))).toEqual({ pantalla: "frenada", quien: "pollar" });
    expect(pantalla(frenadaEnElCanje(null))).toEqual({ pantalla: "frenada", quien: "pollar" });
    expect(pantalla(frenadaEnElCanje(falla({ resolutionOwner: "APP", resolutionAction: "fund_gas_wallet" })))).toEqual({ pantalla: "frenada", quien: "tinkazo" });
    // Pide proteger la cuenta: el paso de la cuenta.
    expect(pantalla(frenadaEnElCanje(falla({ resolutionOwner: "END_USER", retryable: true, resolutionAction: "set_up_recovery" })))).toEqual({ pantalla: "proteger-cuenta" });
    // Algo de la persona que no se reintenta desde acá: no se adivina.
    expect(pantalla(frenadaEnElCanje(falla({ resolutionOwner: "END_USER", retryable: false, resolutionAction: "correct_input" })))).toEqual({ pantalla: "desconocido" });
    // La orden dejó de moverse sola sin un tramo frenado: lo mismo.
    expect(pantalla(orden({ state: "processing", pendingAction: NADA, nextPollAfter: null, failure: falla() }, { onramp: ONRAMP_LISTO }))).toEqual({ pantalla: "frenada", quien: "pollar" });
    // Un tramo que no salió con la orden todavía abierta y moviéndose: no se muestra como si se supiera.
    expect(pantalla(orden({ state: "processing", pendingAction: NADA }, { onramp: ONRAMP_LISTO, canje: { status: "FAILED" } }))).toEqual({ pantalla: "desconocido" });
  });

  it("sin créditos con la carga abierta: falta algo de Tinkazo, también con un paso esperando", () => {
    for (const o of [enLaCuentaDePaso(), viajando(), orden()]) expect(pantalla(o, {}, AHORA, { sinCreditos: true })).toEqual({ pantalla: "frenada", quien: "tinkazo" });
    // Una carga que ya terminó no cambia por eso.
    expect(pantalla(llego(), {}, AHORA, { sinCreditos: true })).toMatchObject({ pantalla: "llego" });
  });
});

describe("cuántas aprobaciones faltan", () => {
  it("los pasos que firman y esperan, en los tramos que no terminaron", () => {
    expect(aprobacionesQueFaltan(orden())).toBe(4);
    expect(aprobacionesQueFaltan(enLaCuentaDePaso())).toBe(4);
    expect(aprobacionesQueFaltan(esperaElCanje())).toBe(3);
    expect(aprobacionesQueFaltan(esperaElEnvio("approve"))).toBe(2);
    expect(aprobacionesQueFaltan(esperaElEnvio("burn"))).toBe(1);
    expect(aprobacionesQueFaltan(viajando())).toBe(0);
    expect(aprobacionesQueFaltan(llego())).toBe(0);
  });

  it("un tramo frenado, que no salió o cancelado no suma", () => {
    for (const status of ["HELD", "FAILED", "CANCELLED"]) expect(aprobacionesQueFaltan(orden({}, { canje: { status } })), status).toBe(2);
  });

  it("un tramo sin pasos que no es del proveedor suma uno si tiene modo de firma, cualquiera sea", () => {
    expect(aprobacionesQueFaltan(orden({}, { canje: { steps: [], signingMode: "COSIGNED" } }))).toBe(3);
    expect(aprobacionesQueFaltan(orden({}, { canje: { steps: [], signingMode: "ALGO_NUEVO" } }))).toBe(3);
    expect(aprobacionesQueFaltan(orden({}, { canje: { steps: [], signingMode: null } }))).toBe(2);
    expect(aprobacionesQueFaltan(orden({}, { onramp: { signingMode: "COSIGNED" } }))).toBe(4);
  });

  it("lo que no se lee no tiene un número", () => {
    for (const x of ordenesQueNoSonUnaCarga()) expect(aprobacionesQueFaltan(x)).toBeNull();
  });
});

describe("la palabra de cada etapa", () => {
  it("frenada siempre dice Frenada, aunque el kit la cuente como fallada", () => {
    expect(palabraDeEtapa(["COMPLETED", "HELD"], true)).toBe("frenada");
    expect(palabraDeEtapa(["HELD"], false)).toBe("frenada");
    expect(palabraDeEtapa(["FAILED"], true)).toBe("no-salio");
    expect(palabraDeEtapa(["CANCELLED"], true)).toBe("no-salio");
    expect(palabraDeEtapa(["COMPLETED", "COMPLETED"], false)).toBe("listo");
    expect(palabraDeEtapa(["COMPLETED", "ACTIVE"], true)).toBe("ahora");
    expect(palabraDeEtapa(["PENDING"], false)).toBe("despues");
    expect(palabraDeEtapa([], true)).toBe("ahora");
  });

  it("las tres etapas: llega tu pago, se pasa a dólares digitales, llega a tu cuenta", () => {
    expect(etapasDeCarga(orden())).toEqual(["ahora", "despues", "despues"]);
    expect(etapasDeCarga(conStereum())).toEqual(["listo", "ahora", "despues"]);
    expect(etapasDeCarga(enLaCuentaDePaso())).toEqual(["listo", "ahora", "despues"]);
    expect(etapasDeCarga(esperaElEnvio("burn"))).toEqual(["listo", "listo", "ahora"]);
    expect(etapasDeCarga(viajando())).toEqual(["listo", "listo", "ahora"]);
    expect(etapasDeCarga(llego())).toEqual(["listo", "listo", "listo"]);
  });

  it("una etapa frenada o que no salió lo dice, y las que siguen quedan para después", () => {
    expect(etapasDeCarga(frenadaEnElCanje(falla()))).toEqual(["listo", "frenada", "despues"]);
    expect(etapasDeCarga(orden({ pendingAction: NADA }, { onramp: { status: "HELD" } }))).toEqual(["frenada", "despues", "despues"]);
    expect(etapasDeCarga(orden({ pendingAction: NADA }, { onramp: ONRAMP_LISTO, canje: CANJE_LISTO, envio: { status: "FAILED" } }))).toEqual(["listo", "listo", "no-salio"]);
  });

  it("sin canje: Stereum entrega USDC y el puente lo lleva", () => {
    const o = orden({ state: "processing", pendingAction: NADA });
    const sinCanje = { ...o, legs: [{ ...(o.legs[0] as RampOrderLeg), ...ONRAMP_LISTO, to: USDC_POLYGON }, { ...(o.legs[2] as RampOrderLeg), index: 1, status: "ACTIVE" }] };
    expect(etapasDeCarga(sinCanje)).toEqual(["listo", "listo", "ahora"]);
    expect(aprobacionesQueFaltan(sinCanje)).toBe(2);
  });

  it("lo que no se lee no tiene etapas", () => {
    for (const x of ordenesQueNoSonUnaCarga()) expect(etapasDeCarga(x)).toBeNull();
  });
});

describe("cuánto falta", () => {
  it("lo que le queda al tramo en curso más lo que tardan los que siguen", () => {
    // El canje empezó hace 30 s y tarda 60; después, el envío tarda 600.
    expect(tiempoQueFalta(enLaCuentaDePaso(), T0 + 30_000)).toEqual({ minutos: 11 });
    expect(tiempoQueFalta(viajando(), T0 + 5 * MIN)).toEqual({ minutos: 5 });
    expect(tiempoQueFalta(viajando(), T0 + 9 * MIN + 59_000)).toEqual({ minutos: 1 });
  });

  it("pasado el doble de lo que dice el tramo, o media hora, tarda más de lo normal", () => {
    expect(tiempoQueFalta(viajando(), T0 + 20 * MIN + 1000)).toEqual({ tardaMas: true });
    expect(tiempoQueFalta(orden({ pendingAction: NADA }, { onramp: { etaSeconds: 3600 } }), T0 + 30 * MIN + 1000)).toEqual({ tardaMas: true });
    expect(tiempoQueFalta(orden({ pendingAction: NADA }, { onramp: { etaSeconds: null } }), T0 + 30 * MIN + 1000)).toEqual({ tardaMas: true });
  });

  it("sin saber cuándo empezó o cuánto tarda alguno, no se inventa un número", () => {
    expect(tiempoQueFalta(orden({ pendingAction: NADA }, { onramp: { startedAt: null } }), T0 + MIN)).toBeNull();
    expect(tiempoQueFalta(orden({ pendingAction: NADA }, { canje: { etaSeconds: null } }), T0 + MIN)).toBeNull();
    expect(tiempoQueFalta(llego(), T0 + MIN)).toBeNull();
    expect(tiempoQueFalta(frenadaEnElCanje(falla()), T0 + MIN)).toBeNull();
    expect(tiempoQueFalta(null, T0)).toBeNull();
  });
});

describe("las marcas de este navegador", () => {
  function almacen(inicial: Record<string, string> = {}) {
    const datos = new Map(Object.entries(inicial));
    return { datos, getItem: (k: string) => datos.get(k) ?? null, setItem: (k: string, v: string) => void datos.set(k, v) };
  }

  it("sin nada guardado, sin marcas; cada marca guarda la primera vez", () => {
    const a = almacen();
    expect(leerMarcas("ord-1", a)).toEqual(SIN_MARCAS);
    expect(anotarMarca("ord-1", "mostroQr", T0, SIN_MARCAS, a)).toEqual({ mostroQr: T0, guardoQr: null, dijoPago: null });
    expect(anotarMarca("ord-1", "mostroQr", T0 + MIN, SIN_MARCAS, a)).toEqual({ mostroQr: T0, guardoQr: null, dijoPago: null });
    expect(anotarMarca("ord-1", "dijoPago", T0 + 2 * MIN, SIN_MARCAS, a)).toEqual({ mostroQr: T0, guardoQr: null, dijoPago: T0 + 2 * MIN });
    expect(leerMarcas("ord-1", a)).toEqual({ mostroQr: T0, guardoQr: null, dijoPago: T0 + 2 * MIN });
    expect(leerMarcas("ord-2", a)).toEqual(SIN_MARCAS);
  });

  it("sin almacenamiento, o con uno que falla o trae basura, no lanza y las marcas siguen en memoria", () => {
    const roto = { getItem: () => { throw new Error("SecurityError"); }, setItem: () => { throw new Error("QuotaExceededError"); } };
    expect(leerMarcas("ord-1", roto)).toEqual(SIN_MARCAS);
    const enMemoria = anotarMarca("ord-1", "guardoQr", T0, SIN_MARCAS, roto);
    expect(enMemoria).toEqual({ mostroQr: null, guardoQr: T0, dijoPago: null });
    expect(anotarMarca("ord-1", "dijoPago", T0 + MIN, enMemoria, null)).toEqual({ mostroQr: null, guardoQr: T0, dijoPago: T0 + MIN });
    for (const basura of ["{", "[]", "3", JSON.stringify({ "ord-1": { mostroQr: "ayer", guardoQr: -5, dijoPago: Number.NaN } })]) {
      expect(leerMarcas("ord-1", almacen({ "tinkazo.carga.marcas": basura })), basura).toEqual(SIN_MARCAS);
    }
  });

  it("Todavía no pagué borra la marca de haber dicho que pagó, y nada más, también sin almacenamiento", () => {
    const a = almacen();
    const juntas = anotarMarca("ord-1", "dijoPago", T0 + MIN, anotarMarca("ord-1", "mostroQr", T0, SIN_MARCAS, a), a);
    expect(quitarMarca("ord-1", "dijoPago", juntas, a)).toEqual({ mostroQr: T0, guardoQr: null, dijoPago: null });
    expect(leerMarcas("ord-1", a)).toEqual({ mostroQr: T0, guardoQr: null, dijoPago: null });
    // Volver a decir que pagó anota la hora nueva, no la de antes.
    expect(anotarMarca("ord-1", "dijoPago", T0 + 3 * MIN, SIN_MARCAS, a).dijoPago).toBe(T0 + 3 * MIN);
    const roto = { getItem: () => { throw new Error("SecurityError"); }, setItem: () => { throw new Error("QuotaExceededError"); } };
    expect(quitarMarca("ord-2", "dijoPago", { mostroQr: T0, guardoQr: null, dijoPago: T0 }, roto)).toEqual({ mostroQr: T0, guardoQr: null, dijoPago: null });
    expect(quitarMarca("ord-2", "dijoPago", { mostroQr: T0, guardoQr: null, dijoPago: T0 }, null)).toEqual({ mostroQr: T0, guardoQr: null, dijoPago: null });
  });

  it("guarda las de las últimas veinte cargas, nada más", () => {
    const a = almacen();
    for (let i = 0; i < 25; i++) anotarMarca(`ord-${i}`, "mostroQr", T0 + i, SIN_MARCAS, a);
    const guardado = JSON.parse(a.datos.get("tinkazo.carga.marcas") as string) as Record<string, unknown>;
    expect(Object.keys(guardado)).toHaveLength(20);
    expect(leerMarcas("ord-24", a).mostroQr).toBe(T0 + 24);
    expect(leerMarcas("ord-0", a)).toEqual(SIN_MARCAS);
  });
});

describe("el número de carga y las cargas abiertas", () => {
  it("el número son los últimos 8 caracteres de la orden, en mayúsculas", () => {
    expect(numeroDeCarga("ord_9f8e7d6c5b4a3210")).toBe("5B4A3210");
    expect(numeroDeCarga("ord_9f8e7d6c5b4a32ab")).toBe("5B4A32AB");
  });

  it("una carga que no terminó cuenta como abierta, también con un estado nuevo", () => {
    const pagina = (orders: unknown[]): RampOrdersPage => ({ orders, nextCursor: null }) as unknown as RampOrdersPage;
    expect(cargaAbierta(pagina([]))).toEqual({ estado: "ninguna" });
    expect(cargaAbierta(pagina([llego(), orden({ state: "refunded" }), orden({ state: "failed" })]))).toEqual({ estado: "ninguna" });
    expect(cargaAbierta(pagina([llego(), enLaCuentaDePaso()]))).toEqual({ estado: "abierta", id: "ord_9f8e7d6c5b4a3210" });
    expect(cargaAbierta(pagina([orden({ id: "ord_nueva", state: "en_el_aire" })]))).toEqual({ estado: "abierta", id: "ord_nueva" });
    // Lo que no se lee no dice que no hay ninguna.
    for (const x of [null, {}, { orders: "x" }, pagina([{ state: "processing" }]), pagina([null])]) expect(cargaAbierta(x)).toEqual({ estado: "no-se-sabe" });
  });

  it("al volver, la última carga cerrada que no terminó bien, para mostrar su final antes de un precio nuevo", () => {
    const pagina = (orders: unknown[]): RampOrdersPage => ({ orders, nextCursor: null }) as unknown as RampOrdersPage;
    const hace = (min: number) => new Date(T0 - min * MIN).toISOString();
    const fallida = orden({ id: "ord_fallida", state: "failed", createdAt: hace(30), pendingAction: null, nextPollAfter: null });
    const devuelta = orden({ id: "ord_devuelta", state: "refunded", createdAt: hace(60), pendingAction: null, nextPollAfter: null });
    const vieja = orden({ id: "ord_vieja", state: "failed", createdAt: hace(3 * 24 * 60), pendingAction: null, nextPollAfter: null });
    const bien = { ...llego(), id: "ord_bien", createdAt: hace(10) };
    const desde = T0 - 24 * 60 * MIN;
    expect(cargaCerradaSinTerminar(pagina([devuelta, fallida]), desde)).toEqual({ id: "ord_fallida", orden: fallida });
    expect(cargaCerradaSinTerminar(pagina([devuelta]), desde)?.id).toBe("ord_devuelta");
    // Si la última terminó bien, la de antes ya no cuenta. Las de antes de desde, tampoco.
    expect(cargaCerradaSinTerminar(pagina([fallida, bien]), desde)).toBeNull();
    expect(cargaCerradaSinTerminar(pagina([vieja]), desde)).toBeNull();
    // Una abierta no es de esta búsqueda, y lo que no se lee no se muestra como si se conociera.
    expect(cargaCerradaSinTerminar(pagina([enLaCuentaDePaso()]), desde)).toBeNull();
    for (const x of [null, {}, { orders: "x" }, pagina([{ id: "x", state: "failed" }])]) expect(cargaCerradaSinTerminar(x, desde)).toBeNull();
  });
});
