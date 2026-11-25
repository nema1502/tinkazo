// Si el conteo de cuentas nuevas fallara por lo que sea, la vigilancia del portero no falla: el bloque queda en null y
// las firmas, el patrocinio y lo demás salen como siempre. El conteo se simula roto.
import { describe, expect, it, vi } from "vitest";
import { T0, montarAltas } from "./altas-prueba";

vi.mock("./lectura-cuentas", async (original) => ({
  ...(await original<typeof import("./lectura-cuentas")>()),
  contarCuentasEnUso: () => {
    throw new RangeError("Invalid time value");
  },
}));

describe("la vigilancia con el conteo de cuentas roto", () => {
  it("cuentas en null y todo lo demás igual", async () => {
    const m = montarAltas();
    m.pm.movimientos = [{ event: "cosign.signature:STELLAR", amount: -20, createdAt: new Date(T0 - 3_600_000).toISOString() }];
    m.pm.uso = [{ event: "wallet.created:STELLAR:COSIGNED", count: 3 }];
    const v = await m.puerta.vigilancia();
    expect(v.cuentas).toBeNull();
    expect(v.firmasSinExplicar).toBe(1);
    expect(v.patrocinioPollar).toEqual({ esperado: true, prendidos: [] });
  });
});
