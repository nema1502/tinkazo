import { beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorPortero, elegirPatrocinador, olvidarElEstado, olvidarLaCaida } from "./patrocinador";

const URL = "http://127.0.0.1:8794";
const HASH = "ab".repeat(32);
const CUENTA = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

const responder = (estado: number, cuerpo: unknown): Response => new Response(JSON.stringify(cuerpo), { status: estado, headers: { "Content-Type": "application/json" } });

beforeEach(() => {
  olvidarElEstado();
  olvidarLaCaida();
});

describe("elegirPatrocinador en la red principal", () => {
  const billetera = { signAndSubmit: vi.fn(async () => HASH) };
  beforeEach(() => billetera.signAndSubmit.mockClear());

  it("sin portero configurado cierra, en vez de dejar a Pollar como quien paga", async () => {
    const f = vi.fn();
    const e = await elegirPatrocinador(CUENTA, billetera, { url: null, red: "mainnet", fetch: f as unknown as typeof fetch }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ErrorPortero);
    expect(e).toMatchObject({ motivo: "cerrado", detalle: "sin-portero" });
    expect(f).not.toHaveBeenCalled();
    expect(billetera.signAndSubmit).not.toHaveBeenCalled();
  });

  it("cierra también sin la dirección de la cuenta", async () => {
    await expect(elegirPatrocinador("", billetera, { url: null, red: "mainnet" })).rejects.toMatchObject({ motivo: "cerrado" });
  });

  it("con portero configurado y que contesta, se sigue como siempre", async () => {
    const f = async () => responder(200, { rige: "pollar", prendido: false, motivo: "pollar" });
    const p = await elegirPatrocinador(CUENTA, billetera, { url: URL, red: "mainnet", fetch: f as unknown as typeof fetch });
    expect(p.nombre).toBe("pollar");
  });

  it("con portero configurado y sin respuesta, sigue cerrado", async () => {
    const caido = async () => {
      throw new TypeError("sin red");
    };
    await expect(elegirPatrocinador(CUENTA, billetera, { url: URL, red: "mainnet", fetch: caido as unknown as typeof fetch })).rejects.toMatchObject({ motivo: "cerrado" });
  });

  it("en Prueba, sin portero, rige Pollar como hoy", async () => {
    const f = vi.fn();
    const p = await elegirPatrocinador(CUENTA, billetera, { url: null, red: "testnet", fetch: f as unknown as typeof fetch });
    expect(p.nombre).toBe("pollar");
    expect(f).not.toHaveBeenCalled();
  });

  it("sin decir la red, vale la del build (Prueba)", async () => {
    expect((await elegirPatrocinador(CUENTA, billetera, { url: null })).nombre).toBe("pollar");
  });
});
