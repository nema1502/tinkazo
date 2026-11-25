import { beforeEach, describe, expect, it, vi } from "vitest";
import { DISYUNTOR_MS, loTomaElServicio, reiniciarElServicio, sortearPorElServicio } from "./sorteo-del-servicio";

/**
 * Cuándo toma el servicio un sorteo en esta pestaña, con la red principal, una cuenta de Google y la bandera prendida
 * simuladas: la marca de un sorteo que ya quedó por el camino de siempre, y el disyuntor que deja de lado al servicio
 * diez minutos después de una falla suya.
 */

const h = vi.hoisted(() => ({ pedir: vi.fn(), red: "mainnet", propia: false, ensayo: false, bandera: true, url: "https://pm.example" as string | null }));
vi.mock("./anchor", () => ({ readDraw: async () => null, SIN_GRABAR: "ensayo-sin-grabar" }));
vi.mock("../stellar/alta-config", async (orig) => ({ ...(await orig<typeof import("../stellar/alta-config")>()), sorteoPorServidor: () => h.bandera }));
vi.mock("../stellar/config", async (orig) => {
  const real = await orig<typeof import("../stellar/config")>();
  return { ...real, network: new Proxy(real.network, { get: (t, k) => (k === "name" ? h.red : Reflect.get(t, k)) }) };
});
vi.mock("../ensayo-modo", async (orig) => ({ ...(await orig<typeof import("../ensayo-modo")>()), sinGrabar: () => h.ensayo }));
vi.mock("../stellar/wallet-lite", async (orig) => ({ ...(await orig<typeof import("../stellar/wallet-lite")>()), activeWallet: () => ({ submitsItself: !h.propia }) }));
vi.mock("../stellar/patrocinio-config", async (orig) => ({ ...(await orig<typeof import("../stellar/patrocinio-config")>()), configDelPortero: () => ({ url: h.url, porDefecto: false }) }));
vi.mock("../stellar/sorteo-servidor-api", async (orig) => ({ ...(await orig<typeof import("../stellar/sorteo-servidor-api")>()), pedirElSorteo: (...a: unknown[]) => h.pedir(...a) }));

const FIRMA = new Uint8Array(96).fill(5);

beforeEach(() => {
  reiniciarElServicio();
  Object.assign(h, { red: "mainnet", propia: false, ensayo: false, bandera: true, url: "https://pm.example" });
  h.pedir.mockReset();
});

describe("loTomaElServicio", () => {
  it("con la bandera, la red principal, una cuenta de Google y el servicio a la vista, sí", () => {
    expect(loTomaElServicio(7n, false)).toBe(true);
  });
  it("la demo, la red de prueba, una billetera propia, la bandera apagada, sin servicio o pagando con la propia cuenta, no", () => {
    h.ensayo = true;
    expect(loTomaElServicio(7n, false)).toBe(false);
    h.ensayo = false;
    h.red = "testnet";
    expect(loTomaElServicio(7n, false)).toBe(false);
    h.red = "mainnet";
    h.propia = true;
    expect(loTomaElServicio(7n, false)).toBe(false);
    h.propia = false;
    h.bandera = false;
    expect(loTomaElServicio(7n, false)).toBe(false);
    h.bandera = true;
    h.url = null;
    expect(loTomaElServicio(7n, false)).toBe(false);
    h.url = "http://no-es-https.example";
    expect(loTomaElServicio(7n, false)).toBe(false);
    h.url = "https://pm.example";
    expect(loTomaElServicio(7n, true)).toBe(false);
    expect(loTomaElServicio(7n, false)).toBe(true);
  });
});

describe("lo que se recuerda después de una respuesta del servicio", () => {
  it("un no que es de este sorteo (no es del servicio) lo marca: ese sorteo va directo al camino de siempre, y los demás no", async () => {
    h.pedir.mockResolvedValue({ accion: "hoy", marca: true, disyuntor: false, olvidar: false });
    expect(await sortearPorElServicio({ raffleId: 7n, firma96: FIRMA })).toEqual({ estado: "camino-de-hoy" });
    expect(h.pedir).toHaveBeenCalledTimes(1);
    expect(loTomaElServicio(7n, false)).toBe(false);
    expect(loTomaElServicio(8n, false)).toBe(true);
  });

  it("una falla del servicio apaga el servicio diez minutos en la pestaña, para todos los sorteos, y pasado ese tiempo vuelve a pedir", async () => {
    h.pedir.mockResolvedValue({ accion: "hoy", marca: false, disyuntor: true, olvidar: true });
    const salida = Date.now();
    expect(await sortearPorElServicio({ raffleId: 7n, firma96: FIRMA })).toEqual({ estado: "camino-de-hoy" });
    expect(loTomaElServicio(8n, false)).toBe(false);
    expect(loTomaElServicio(7n, false)).toBe(false);
    expect(loTomaElServicio(8n, false, () => salida + DISYUNTOR_MS - 1000)).toBe(false);
    expect(loTomaElServicio(8n, false, () => salida + DISYUNTOR_MS + 1000)).toBe(true);
  });

  it("después de la duda que termina en el camino de siempre, el sorteo queda marcado y el servicio apagado un rato", async () => {
    h.pedir.mockResolvedValue({ accion: "incierto" });
    vi.useFakeTimers();
    try {
      const fin = sortearPorElServicio({ raffleId: 7n, firma96: FIRMA });
      await vi.advanceTimersByTimeAsync(60_000);
      expect(await fin).toEqual({ estado: "camino-de-hoy" });
      expect(h.pedir).toHaveBeenCalledTimes(1);
      expect(loTomaElServicio(7n, false)).toBe(false);
      expect(loTomaElServicio(8n, false)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("un sorteo que ya se hizo para la demo no llama al servicio", async () => {
    h.ensayo = true;
    const r = await sortearPorElServicio({ raffleId: 7n, firma96: FIRMA });
    expect(r.estado).toBe("error");
    expect((r as { error: Error }).error.message).toBe("ensayo-sin-grabar");
    expect(h.pedir).not.toHaveBeenCalled();
  });
});
