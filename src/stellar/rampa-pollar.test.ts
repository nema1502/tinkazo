import { describe, expect, it, vi } from "vitest";
import { type AccionDeFirma, type Cotizacion, type FirmanteDeRampa, autorizar, cotizarCarga, crearOrden, pasoDeOrden, registrarFirmante } from "./rampa-pollar";

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

describe("la orden: sin firmante propio no arranca", () => {
  const cotizacion = { estado: "ok", quoteId: "q1", recibis: 28, minutos: 10 } as const;

  it("no crea ninguna orden si la rampa no tiene con qué firmar sus pasos", async () => {
    const createRampOrder = vi.fn();
    await expect(crearOrden({ createRampOrder }, cotizacion, null)).rejects.toThrow("rampa-sin-firmante");
    expect(createRampOrder).not.toHaveBeenCalled();
  });

  it("con firmante, crea la orden de esa cotización", async () => {
    const createRampOrder = vi.fn(async () => ({ id: "o1" }));
    const firmante: FirmanteDeRampa = { cuenta: "G", firmar: async (x) => x, verificar: () => undefined };
    expect(await crearOrden({ createRampOrder }, cotizacion, firmante, { cuenta: "x" })).toEqual({ id: "o1" });
    expect(createRampOrder).toHaveBeenCalledWith({ quoteId: "q1", payee: { cuenta: "x" } });
  });

  it("el firmante se registra solo para Stellar/xdr, comprueba la cuenta y firma sin mandar", async () => {
    let registrado: { chain: string; encoding: string; handler: (a: AccionDeFirma) => Promise<string> } | null = null;
    const quitar = vi.fn();
    const cliente = {
      registerRampSigningHandler: (chain: string, encoding: string, handler: (a: AccionDeFirma) => Promise<string>) => {
        registrado = { chain, encoding, handler };
        return quitar;
      },
    };
    const verificar = vi.fn();
    const firmar = vi.fn(async (xdr: string) => `firmado:${xdr}`);
    const baja = registrarFirmante(cliente, { cuenta: "GCUENTA", firmar, verificar });
    expect(registrado).toMatchObject({ chain: "STELLAR", encoding: "xdr" });
    const accion = { chain: "STELLAR", payload: { encoding: "xdr", value: "AAAA" } };
    expect(await (registrado as unknown as { handler: (a: AccionDeFirma) => Promise<string> }).handler(accion)).toBe("firmado:AAAA");
    expect(verificar).toHaveBeenCalledWith(accion, "GCUENTA");
    baja();
    expect(quitar).toHaveBeenCalled();
  });

  it("si la comprobación rechaza el paso, no se firma", async () => {
    let handler!: (a: AccionDeFirma) => Promise<string>;
    const cliente = { registerRampSigningHandler: (_c: string, _e: string, h: typeof handler) => ((handler = h), () => undefined) };
    const firmar = vi.fn(async (x: string) => x);
    registrarFirmante(cliente, {
      cuenta: "G",
      firmar,
      verificar: () => {
        throw new Error("sale de otra cuenta");
      },
    });
    await expect(handler({ chain: "STELLAR", payload: { encoding: "xdr", value: "AAAA" } })).rejects.toThrow("otra cuenta");
    expect(firmar).not.toHaveBeenCalled();
  });
});

describe("qué le toca a la persona según la orden", () => {
  it("pagar con el QR, firmar, aprobar, verificarse, esperar, listo o fallo", () => {
    expect(pasoDeOrden({ state: "awaiting_payment", pendingAction: { kind: "FIAT_PAYMENT", instructions: { scannable: { code: "00020101" } } } })).toEqual({ paso: "pagar", qr: "00020101" });
    expect(pasoDeOrden({ state: "awaiting_payment", pendingAction: { kind: "FIAT_PAYMENT" } })).toEqual({ paso: "pagar", qr: null });
    expect(pasoDeOrden({ state: "processing", pendingAction: { kind: "SIGNATURE", actionId: "a1" } })).toEqual({ paso: "firmar", actionId: "a1" });
    expect(pasoDeOrden({ state: "processing", pendingAction: { kind: "SIGNATURE" } })).toEqual({ paso: "esperar" });
    expect(pasoDeOrden({ state: "processing", pendingAction: { kind: "COSIGN_APPROVAL" } })).toEqual({ paso: "aprobar" });
    expect(pasoDeOrden({ state: "processing", pendingAction: { kind: "KYC", url: "https://x" } })).toEqual({ paso: "verificar", url: "https://x" });
    expect(pasoDeOrden({ state: "processing", pendingAction: { kind: "NONE" } })).toEqual({ paso: "esperar" });
    expect(pasoDeOrden({ state: "completed" })).toEqual({ paso: "listo" });
    expect(pasoDeOrden({ state: "failed" })).toEqual({ paso: "fallo" });
    expect(pasoDeOrden({ state: "refunded" })).toEqual({ paso: "fallo" });
    expect(pasoDeOrden(null)).toEqual({ paso: "esperar" });
  });

  it("solo autoriza cuando de verdad hay una firma esperando", async () => {
    const signRampLeg = vi.fn(async () => ({}));
    await expect(autorizar({ signRampLeg }, "o1", { paso: "esperar" })).rejects.toThrow("rampa-nada-que-firmar");
    await expect(autorizar({ signRampLeg }, "o1", { paso: "pagar", qr: null })).rejects.toThrow();
    expect(signRampLeg).not.toHaveBeenCalled();
    await autorizar({ signRampLeg }, "o1", { paso: "firmar", actionId: "a1" });
    expect(signRampLeg).toHaveBeenCalledWith("o1", "a1");
  });
});
