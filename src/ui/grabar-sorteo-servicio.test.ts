import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { roundTime } from "../protocol/quicknet";

/**
 * La grabación del sorteo con el servicio de comisiones prendido (`grabar-sorteo.ts` y `sorteo-del-servicio.ts`): el
 * servicio manda y la red confirma, o el servicio asegura que no lo manda y sigue el camino de siempre. Lo que decide
 * cada paso del servicio se prueba en `sorteo-del-servicio.test.ts`: acá, cómo lo usa la grabación.
 */

const h = vi.hoisted(() => ({
  drawOnChain: vi.fn(),
  readDraw: vi.fn(),
  loToma: vi.fn(),
  sortearPorElServicio: vi.fn(),
  reserva: vi.fn(),
  clave: vi.fn(),
}));
vi.mock("./anchor", () => ({
  drawOnChain: (...a: unknown[]) => h.drawOnChain(...a),
  readDraw: (...a: unknown[]) => h.readDraw(...a),
}));
vi.mock("../protocol/drand", () => ({ decompressG1: (s: string) => `96:${s}` }));
vi.mock("../stellar/errores", async (orig) => ({ ...(await orig<typeof import("../stellar/errores")>()), errorKey: (e: unknown) => h.clave(e) }));
vi.mock("../stellar/alta-config", async (orig) => ({ ...(await orig<typeof import("../stellar/alta-config")>()), sorteoPorServidor: () => true }));
vi.mock("./sorteo-del-servicio", () => ({
  loTomaElServicio: (...a: unknown[]) => h.loToma(...a),
  sortearPorElServicio: (...a: unknown[]) => h.sortearPorElServicio(...a),
  reservaDelServicioViva: (...a: unknown[]) => h.reserva(...a),
}));

const R = 32254977;
const base = { raffleId: 7n, round: R, signature: "ab".repeat(48), esperados: [4, 11, 3], ahora: () => (roundTime(R) + 60) * 1000, dormir: async () => undefined };
const GANADORES = { winners: [4, 11, 3], randomness: "00ff" };
const HASH = "cd".repeat(32);

beforeEach(() => {
  vi.resetModules();
  h.drawOnChain.mockReset();
  h.readDraw.mockReset().mockResolvedValue(null);
  h.loToma.mockReset().mockReturnValue(true);
  h.sortearPorElServicio.mockReset();
  h.reserva.mockReset().mockReturnValue(false);
  h.clave.mockReset().mockReturnValue("rpcDown");
  vi.stubEnv("VITE_SORTEO_SERVIDOR", "1");
});
afterEach(() => vi.unstubAllEnvs());

describe("el servicio manda el sorteo", () => {
  it("guardado con el enlace, sin pasar por el camino de siempre", async () => {
    h.sortearPorElServicio.mockResolvedValue({ estado: "listo", valor: { ...GANADORES, txHash: HASH }, yaEstaba: false });
    const alPaso = vi.fn();
    const alReintentar = vi.fn();
    const { grabarElSorteo } = await import("./grabar-sorteo");
    const fin = await grabarElSorteo({ ...base, alPaso, alReintentar });
    expect(fin).toEqual({ estado: "guardado", txHash: HASH, yaEstaba: false });
    expect(h.drawOnChain).not.toHaveBeenCalled();
    expect(alReintentar).not.toHaveBeenCalled();
    expect(h.sortearPorElServicio).toHaveBeenCalledTimes(1);
    const pedido = h.sortearPorElServicio.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(pedido.raffleId).toBe(7n);
    expect(pedido.firma96).toBe(`96:${"ab".repeat(48)}`);
    expect(pedido.alPaso).toBe(alPaso);
    expect(pedido.ahora).toBe(base.ahora);
    expect(h.loToma).toHaveBeenCalledWith(7n, false, base.ahora);
  });

  it("sin el enlace si ya estaba hecho", async () => {
    h.sortearPorElServicio.mockResolvedValue({ estado: "listo", valor: GANADORES, yaEstaba: true });
    const { grabarElSorteo } = await import("./grabar-sorteo");
    expect(await grabarElSorteo(base)).toEqual({ estado: "guardado", yaEstaba: true });
  });

  it("si el contrato dice otros ganadores que los que vio la sala, no coincide", async () => {
    h.sortearPorElServicio.mockResolvedValue({ estado: "listo", valor: { winners: [4, 3, 11], randomness: "00ff", txHash: HASH }, yaEstaba: false });
    const { grabarElSorteo } = await import("./grabar-sorteo");
    expect(await grabarElSorteo(base)).toEqual({ estado: "no-coincide", esperados: [4, 11, 3], grabados: [4, 3, 11] });
  });

  it("un no que se muestra vuelve como fallo, sin el camino de siempre", async () => {
    const error = new Error("sin-confirmar");
    h.sortearPorElServicio.mockResolvedValue({ estado: "error", error });
    const { grabarElSorteo } = await import("./grabar-sorteo");
    expect(await grabarElSorteo(base)).toEqual({ estado: "fallo", error });
    expect(h.drawOnChain).not.toHaveBeenCalled();
  });

  it("el show y Mis sorteos a la vez mandan un solo pedido al servicio", async () => {
    let soltar: (v: unknown) => void = () => undefined;
    h.sortearPorElServicio.mockReturnValue(new Promise((r) => (soltar = r)));
    const { grabarElSorteo } = await import("./grabar-sorteo");
    const delShow = grabarElSorteo(base);
    await vi.waitFor(() => expect(h.sortearPorElServicio).toHaveBeenCalledTimes(1));
    const deMisSorteos = grabarElSorteo(base);
    await new Promise((r) => setTimeout(r, 20));
    expect(h.sortearPorElServicio).toHaveBeenCalledTimes(1);
    soltar({ estado: "listo", valor: { ...GANADORES, txHash: HASH }, yaEstaba: false });
    const guardado = { estado: "guardado", txHash: HASH, yaEstaba: false };
    expect(await delShow).toEqual(guardado);
    expect(await deMisSorteos).toEqual(guardado);
  });
});

describe("el servicio asegura que no lo manda", () => {
  it("sigue el camino de siempre, una vez, con los argumentos de siempre y su presupuesto entero", async () => {
    h.sortearPorElServicio.mockResolvedValue({ estado: "camino-de-hoy" });
    h.drawOnChain.mockResolvedValue({ ...GANADORES, txHash: HASH });
    const alPaso = vi.fn();
    const { grabarElSorteo } = await import("./grabar-sorteo");
    const fin = await grabarElSorteo({ ...base, alPaso });
    expect(fin).toEqual({ estado: "guardado", txHash: HASH, yaEstaba: false });
    expect(h.sortearPorElServicio).toHaveBeenCalledTimes(1);
    expect(h.drawOnChain).toHaveBeenCalledTimes(1);
    expect(h.drawOnChain).toHaveBeenCalledWith(7n, `96:${"ab".repeat(48)}`, alPaso, { pagarConMiCuenta: false });
  });

  it("y si falla, conserva sus cinco intentos", async () => {
    h.sortearPorElServicio.mockResolvedValue({ estado: "camino-de-hoy" });
    const e = new Error("la red no contestó");
    h.drawOnChain.mockRejectedValue(e);
    const { grabarElSorteo } = await import("./grabar-sorteo");
    expect(await grabarElSorteo(base)).toEqual({ estado: "fallo", error: e });
    expect(h.drawOnChain).toHaveBeenCalledTimes(5);
    expect(h.sortearPorElServicio).toHaveBeenCalledTimes(1);
  });

  it("si la condición dice que no (billetera propia, demo, sorteo marcado), ni se le pregunta", async () => {
    h.loToma.mockReturnValue(false);
    h.drawOnChain.mockResolvedValue({ ...GANADORES, txHash: HASH });
    const { grabarElSorteo } = await import("./grabar-sorteo");
    await grabarElSorteo({ ...base, pagarConMiCuenta: true });
    expect(h.loToma).toHaveBeenCalledWith(7n, true, base.ahora);
    expect(h.sortearPorElServicio).not.toHaveBeenCalled();
    expect(h.drawOnChain).toHaveBeenCalledTimes(1);
  });
});

describe("lo que se espera al servicio se descuenta, con un mínimo", () => {
  it("lo que se esperó al servicio se descuenta del presupuesto del camino de siempre", async () => {
    let t = (roundTime(R) + 60) * 1000;
    const ahora = (): number => t;
    const dormir = async (ms: number): Promise<void> => void (t += ms);
    // El servicio tardó 80 segundos y aseguró que no manda: al camino de siempre le queda su mínimo, 20.
    h.sortearPorElServicio.mockImplementation(async () => {
      t += 80_000;
      return { estado: "camino-de-hoy" };
    });
    h.drawOnChain.mockRejectedValue(new Error("la red no contestó"));
    const { grabarElSorteo } = await import("./grabar-sorteo");
    const fin = await grabarElSorteo({ ...base, ahora, dormir });
    expect(fin.estado).toBe("fallo");
    // Las esperas de 2, 4 y 8 segundos caben en 20, la de 16 ya no: cuatro intentos en vez de cinco.
    expect(h.drawOnChain).toHaveBeenCalledTimes(4);
  });

  it("si el servicio se llevó todo el presupuesto, el camino de siempre conserva su mínimo de reintentos", async () => {
    let t = (roundTime(R) + 60) * 1000;
    const ahora = (): number => t;
    const dormir = async (ms: number): Promise<void> => void (t += ms);
    h.sortearPorElServicio.mockImplementation(async () => {
      t += 150_000;
      return { estado: "camino-de-hoy" };
    });
    h.drawOnChain.mockRejectedValueOnce(new Error("la red no contestó")).mockResolvedValue({ ...GANADORES, txHash: HASH });
    const { grabarElSorteo } = await import("./grabar-sorteo");
    const fin = await grabarElSorteo({ ...base, ahora, dormir });
    expect(fin).toEqual({ estado: "guardado", txHash: HASH, yaEstaba: false });
    expect(h.drawOnChain).toHaveBeenCalledTimes(2);
  });

  it("si el servicio no se usó, el presupuesto es el de siempre", async () => {
    h.loToma.mockReturnValue(false);
    h.drawOnChain.mockRejectedValue(new Error("la red no contestó"));
    const { grabarElSorteo } = await import("./grabar-sorteo");
    await grabarElSorteo(base);
    expect(h.drawOnChain).toHaveBeenCalledTimes(5);
  });
});

describe("si el servicio no se puede ni preparar, sigue el camino de siempre", () => {
  it("una excepción al decidir si lo toma el servicio no corta la grabación", async () => {
    h.loToma.mockImplementation(() => {
      throw new Error("no se pudo leer la configuración");
    });
    h.drawOnChain.mockResolvedValue({ ...GANADORES, txHash: HASH });
    const { grabarElSorteo } = await import("./grabar-sorteo");
    expect(await grabarElSorteo(base)).toEqual({ estado: "guardado", txHash: HASH, yaEstaba: false });
    expect(h.sortearPorElServicio).not.toHaveBeenCalled();
    expect(h.drawOnChain).toHaveBeenCalledTimes(1);
  });
});

describe("el tope de sorteos del mes cuando el servicio pudo dejar una reserva", () => {
  const cupo = (): Error => Object.assign(new Error("portero-cupo-cuenta"), { name: "ErrorPortero", motivo: "cupo-cuenta", estado: 429, que: "sorteos" });
  // Como en la aplicación: el tope de sorteos del portero no se arregla esperando.
  beforeEach(() => h.clave.mockImplementation((e: unknown) => ((e as { name?: string } | undefined)?.name === "ErrorPortero" ? "porteroCupoSorteos" : "rpcDown")));

  /** El reloj de la prueba corre solo con lo que se duerme. */
  function reloj(): { ahora: () => number; dormir: (ms: number) => Promise<void> } {
    let t = (roundTime(R) + 60) * 1000;
    return { ahora: () => t, dormir: async (ms) => void (t += ms) };
  }

  it("con una reserva posible, el tope no es definitivo: se sigue mirando la red sin firmar de nuevo y se da por hecho cuando el servicio termina", async () => {
    h.sortearPorElServicio.mockResolvedValue({ estado: "camino-de-hoy" });
    h.reserva.mockReturnValue(true);
    h.drawOnChain.mockRejectedValue(cupo());
    h.readDraw.mockResolvedValueOnce(null).mockResolvedValueOnce(null).mockResolvedValue(GANADORES);
    const { grabarElSorteo } = await import("./grabar-sorteo");
    const r = reloj();
    const fin = await grabarElSorteo({ ...base, ...r });
    expect(fin).toEqual({ estado: "guardado", yaEstaba: true });
    expect(h.drawOnChain).toHaveBeenCalledTimes(1);
    expect(h.readDraw.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(h.reserva).toHaveBeenCalledWith(7n, r.ahora);
  });

  it("si el sorteo no aparece en lo que dura el presupuesto, dice que no se pudo cubrir y no da la fecha del tope, con una sola firma", async () => {
    h.sortearPorElServicio.mockResolvedValue({ estado: "camino-de-hoy" });
    h.reserva.mockReturnValue(true);
    h.drawOnChain.mockRejectedValue(cupo());
    const { grabarElSorteo } = await import("./grabar-sorteo");
    const fin = await grabarElSorteo({ ...base, ...reloj() });
    expect(fin.estado).toBe("fallo");
    const error = (fin as { error: { name?: string; motivo?: string; detalle?: string; que?: string; liberaEn?: number } }).error;
    expect(error).toMatchObject({ name: "ErrorPortero", motivo: "fondo", detalle: "reserva-del-servicio" });
    expect(error.que).toBeUndefined();
    expect(error.liberaEn).toBeUndefined();
    expect(h.drawOnChain).toHaveBeenCalledTimes(1);
    expect(h.readDraw.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it("sin reserva posible, el tope es definitivo como siempre: un solo intento y sin esperas", async () => {
    h.sortearPorElServicio.mockResolvedValue({ estado: "camino-de-hoy" });
    h.reserva.mockReturnValue(false);
    const e = cupo();
    h.drawOnChain.mockRejectedValue(e);
    const alReintentar = vi.fn();
    const { grabarElSorteo } = await import("./grabar-sorteo");
    expect(await grabarElSorteo({ ...base, ...reloj(), alReintentar })).toEqual({ estado: "fallo", error: e });
    expect(h.drawOnChain).toHaveBeenCalledTimes(1);
    expect(alReintentar).not.toHaveBeenCalled();
  });

  it("con una reserva posible, otro error sigue su camino de siempre: se reintenta con la firma de siempre", async () => {
    h.sortearPorElServicio.mockResolvedValue({ estado: "camino-de-hoy" });
    h.reserva.mockReturnValue(true);
    h.drawOnChain.mockRejectedValueOnce(new Error("la red no contestó")).mockResolvedValue({ ...GANADORES, txHash: HASH });
    const { grabarElSorteo } = await import("./grabar-sorteo");
    expect(await grabarElSorteo({ ...base, ...reloj() })).toEqual({ estado: "guardado", txHash: HASH, yaEstaba: false });
    expect(h.drawOnChain).toHaveBeenCalledTimes(2);
  });

  it("con una reserva posible, solo el tope de sorteos se espera: el de sellos es definitivo", async () => {
    h.sortearPorElServicio.mockResolvedValue({ estado: "camino-de-hoy" });
    h.reserva.mockReturnValue(true);
    const e = Object.assign(cupo(), { que: "sellos" });
    h.drawOnChain.mockRejectedValue(e);
    const { grabarElSorteo } = await import("./grabar-sorteo");
    expect(await grabarElSorteo({ ...base, ...reloj() })).toEqual({ estado: "fallo", error: e });
    expect(h.drawOnChain).toHaveBeenCalledTimes(1);
    expect(h.readDraw).toHaveBeenCalledTimes(1);
  });

  it("sin servicio, el tope de sorteos no se toca: un solo intento", async () => {
    h.loToma.mockReturnValue(false);
    h.reserva.mockReturnValue(true);
    const e = cupo();
    h.drawOnChain.mockRejectedValue(e);
    const { grabarElSorteo } = await import("./grabar-sorteo");
    expect(await grabarElSorteo({ ...base, ...reloj() })).toEqual({ estado: "fallo", error: e });
    expect(h.drawOnChain).toHaveBeenCalledTimes(1);
  });
});
