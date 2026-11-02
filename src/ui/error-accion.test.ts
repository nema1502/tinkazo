import { describe, expect, it, vi } from "vitest";
import { eventoError } from "./error-accion";

describe("handoff compatible del error", () => {
  it("los consumidores anteriores siguen recibiendo texto cancelable", () => {
    const e = eventoError("No pudimos confirmar");
    expect(e.type).toBe("tinkazo:error"); expect(e.detail).toBe("No pudimos confirmar");
    expect(e.cancelable).toBe(true); expect(e.accion).toBeUndefined();
    e.preventDefault(); expect(e.defaultPrevented).toBe(true);
  });
  it("agrega la misma acción sin ejecutarla ni cambiar detail", () => {
    const ejecutar = vi.fn(); const accion = { texto: "Consultar", ejecutar };
    const e = eventoError("Resultado registrado", accion);
    expect(e.detail).toBe("Resultado registrado"); expect(e.accion).toBe(accion);
    expect(ejecutar).not.toHaveBeenCalled(); e.accion?.ejecutar();
    expect(ejecutar).toHaveBeenCalledTimes(1);
  });
});
