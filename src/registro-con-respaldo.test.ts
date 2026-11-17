import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { Registro } from "./protocol/verificacion";
import type { ContratoOficial } from "./stellar/oficiales";
import { leerRegistroConRespaldo } from "./registro-con-respaldo";

/**
 * La verificación lee el registro del sorteo de un solo servicio de lectura, con tres intentos al mismo ritmo. Con cien
 * celulares abriendo la verificación desde la misma wifi, ese servicio puede limitar, y salía No pude comprobarlo del
 * todo. Ahora, si falla, se lee del otro de su lista (`respaldoDe`), como ya hace la lectura de los otros sellos.
 */

const PRIMERO = "https://mainnet.sorobanrpc.com";
const SEGUNDO = "https://rpc.lightsail.network";
const CONTRATO = { red: "mainnet", contractId: "C", rpcUrl: PRIMERO } as unknown as ContratoOficial;
const REGISTRO = { wasm: "w", siguiente: 2, sello: null, resultado: null } as unknown as Registro;

describe("leer el registro con respaldo", () => {
  it("con el primero limitando, el registro sale del segundo", async () => {
    const leer = vi.fn(async (c: ContratoOficial, _id: string) => {
      if (c.rpcUrl === PRIMERO) throw new Error("rpc 429");
      return REGISTRO;
    });
    await expect(leerRegistroConRespaldo(CONTRATO, "7", leer)).resolves.toBe(REGISTRO);
    expect(leer).toHaveBeenCalledTimes(2);
    expect(leer.mock.calls[1]?.[0].rpcUrl).toBe(SEGUNDO);
    expect(leer.mock.calls[1]?.[0].contractId).toBe("C");
    expect(leer.mock.calls[1]?.[1]).toBe("7");
  });

  it("si el primero contesta, no se le pregunta al otro", async () => {
    const leer = vi.fn(async () => REGISTRO);
    await expect(leerRegistroConRespaldo(CONTRATO, "7", leer)).resolves.toBe(REGISTRO);
    expect(leer).toHaveBeenCalledTimes(1);
  });

  it("si los dos fallan, falla como antes", async () => {
    const leer = vi.fn(async () => {
      throw new Error("rpc 503");
    });
    await expect(leerRegistroConRespaldo(CONTRATO, "7", leer)).rejects.toThrow("rpc 503");
    expect(leer).toHaveBeenCalledTimes(2);
  });

  it("con un servicio que no está en ninguna lista, el error de siempre y sin otro intento", async () => {
    const leer = vi.fn(async () => {
      throw new Error("rpc 429");
    });
    const raro = { ...CONTRATO, rpcUrl: "https://rpc.example.org" } as ContratoOficial;
    await expect(leerRegistroConRespaldo(raro, "7", leer)).rejects.toThrow("rpc 429");
    expect(leer).toHaveBeenCalledTimes(1);
  });

  it("la verificación lee el registro con respaldo", () => {
    const verify = readFileSync(new URL("./verify.ts", import.meta.url), "utf8");
    expect(verify).toMatch(/leerRegistro: leerRegistroConRespaldo,/);
  });
});
