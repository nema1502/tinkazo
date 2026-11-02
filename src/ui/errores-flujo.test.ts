import { beforeEach, describe, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ raffle: vi.fn(), next: vi.fn() }));
vi.mock("../stellar/contract", () => ({ getClient: async () => ({ get_raffle: h.raffle, next_id: h.next }) }));
import { existenciaDelSorteo } from "./anchor";

beforeEach(() => { h.raffle.mockReset(); h.next.mockReset(); });
describe("ausencia autoritativa del número de sorteo", () => {
  it("solo confirma ausencia si no fue asignado: get_raffle vacío y next_id menor o igual", async () => {
    h.raffle.mockResolvedValue({ result: undefined }); h.next.mockResolvedValue({ result: 42n });
    expect(await existenciaDelSorteo(42n)).toBe("ausente");
    expect(h.raffle).toHaveBeenCalledWith({ raffle_id: 42n });
    expect(h.next).toHaveBeenCalledTimes(1);
  });
  it("una entrada vacía pero asignada puede estar archivada: no permite otro sello", async () => {
    h.raffle.mockResolvedValue({ result: undefined }); h.next.mockResolvedValue({ result: 43n });
    expect(await existenciaDelSorteo(42n)).toBe("desconocida");
  });
  it("si existe conserva el sello", async () => {
    h.raffle.mockResolvedValue({ result: { id: 42n } });
    expect(await existenciaDelSorteo(42n)).toBe("existe"); expect(h.next).not.toHaveBeenCalled();
  });
  it.each(["Failed to fetch", "archived", "boom"])("un fallo de lectura (%s) no confirma ausencia", async (mensaje) => {
    h.raffle.mockRejectedValue(new Error(mensaje));
    expect(await existenciaDelSorteo(42n)).toBe("desconocida");
  });
  it("sin contador válido no afirma que no existe", async () => {
    h.raffle.mockResolvedValue({ result: undefined }); h.next.mockResolvedValue({ result: undefined });
    expect(await existenciaDelSorteo(42n)).toBe("desconocida");
  });
});
