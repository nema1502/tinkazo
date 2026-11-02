import { describe, expect, it, vi } from "vitest";
import { sortearConReintentos } from "./sorteo-seguro";

// E4: primero se comprueba el camino existente; no se modifica la selección.
describe("recuperación del resultado registrado", () => {
  it("AlreadyDrawn recupera los índices registrados sin otro intento ni otra selección", async () => {
    const registrado = { winners: [2, 0], randomness: "ab".repeat(32) };
    const intentar = vi.fn().mockRejectedValue(new Error("Error(Contract, #2)"));
    const yaEsta = vi.fn().mockResolvedValue(registrado);
    const reintentable = vi.fn(() => false);
    expect(await sortearConReintentos({ intentar, yaEsta, reintentable })).toEqual({ ok: true, valor: registrado, yaEstaba: true });
    expect(intentar).toHaveBeenCalledTimes(1);
    expect(yaEsta).toHaveBeenCalledTimes(1);
    expect(reintentable).not.toHaveBeenCalled();
  });
});
