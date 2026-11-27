import { describe, expect, it } from "vitest";
import { enGrupos, montoVisible, MONTO_DEL_PREMIO, SALDO_INICIAL_DEL_DESTINO, SALDO_INICIAL_DEL_DESTINO_STROOPS } from "./premio";

describe("el monto que se ve", () => {
  it("un número entero va sin decimales", () => {
    expect(montoVisible(MONTO_DEL_PREMIO, "es")).toBe("10");
    expect(montoVisible(MONTO_DEL_PREMIO, "en")).toBe("10");
    expect(montoVisible(0n, "es")).toBe("0");
  });

  it("con resto, usa coma en español y punto en inglés, sin ceros al final", () => {
    expect(montoVisible(25_000_000n, "es")).toBe("2,5");
    expect(montoVisible(25_000_000n, "en")).toBe("2.5");
    expect(montoVisible(1n, "es")).toBe("0,0000001");
    expect(montoVisible(123_456_789n, "en")).toBe("12.3456789");
  });

  it("el premio son 10 monedas y el destino arranca con 2, que cubre la reserva de una cuenta con un dato", () => {
    expect(MONTO_DEL_PREMIO).toBe(10n * 10_000_000n);
    expect(SALDO_INICIAL_DEL_DESTINO_STROOPS).toBe(BigInt(SALDO_INICIAL_DEL_DESTINO) * 10_000_000n);
    // Una cuenta con un dato necesita (2 + 1) reservas de 0,5.
    expect(SALDO_INICIAL_DEL_DESTINO_STROOPS).toBeGreaterThanOrEqual(15_000_000n);
  });
});

describe("una dirección en grupos", () => {
  it("parte de a cuatro caracteres con un espacio, y deja el resto al final", () => {
    expect(enGrupos("ABCDEFGHIJ")).toBe("ABCD EFGH IJ");
    expect(enGrupos("")).toBe("");
  });

  it("al juntarlos de nuevo da la dirección original", () => {
    const g = "GAAH4OT36RRCCAGKARGPN2HLHT2NOBVFHO4GUHA6CF7UKQ4MMV24WQ4N";
    expect(enGrupos(g).split(" ").join("")).toBe(g);
  });
});
