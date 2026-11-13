// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

/**
 * La línea de Ver detalle de un error (`detalle-error.ts`) unía sus partes con el punto medio, que no va en lo que se
 * ve en pantalla. Ahora las une con una barra.
 */

vi.mock("./anchor", () => ({ anchorErrorText: async () => "", cuentaPatrocinada: async () => false }));
vi.mock("../stellar/wallet-lite", () => ({ activeWallet: () => null }));
vi.mock("../stellar/wallet-pollar", () => ({ submitsItself: () => false }));

describe("la línea del detalle de un error", () => {
  it("separa sus partes con una barra, sin el punto medio", async () => {
    const { lineaDelError } = await import("./detalle-error");
    const linea = await lineaDelError(new Error("boom"), "sello");
    expect(linea).not.toContain("·");
    expect(linea.split(" / ").length).toBeGreaterThanOrEqual(6);
    expect(linea).toContain(" / sello / ");
  });
});
