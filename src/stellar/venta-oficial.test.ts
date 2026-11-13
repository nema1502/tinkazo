import { describe, expect, it } from "vitest";
import { T } from "../i18n";
import { claveDeLaOrden, productoPausado, rotuloDelPrecio } from "./venta-oficial";

/** La venta frenada sola: qué dice cada producto y qué dice un no de la orden. */
describe("la venta de paquetes cuando el servicio la frena", () => {
  it("un producto con `pausado` verdadero, o que no se entiende, está pausado; sin el campo o en falso, no", () => {
    expect(productoPausado({ id: "p10", pausado: true })).toBe(true);
    expect(productoPausado({ id: "p10", pausado: "si" })).toBe(true);
    expect(productoPausado({ id: "p10", pausado: null })).toBe(true);
    expect(productoPausado({ id: "p10", pausado: false })).toBe(false);
    // El portero de hoy todavía no lo manda: todo como hoy.
    expect(productoPausado({ id: "p10", usdc: "5", sorteos: 10, dias: 365 })).toBe(false);
    expect(productoPausado(null)).toBe(false);
  });

  it("el precio de un producto pausado dice que por ahora no está, en los dos idiomas", () => {
    const es = (k: string): string => String(T.es[k]);
    const en = (k: string): string => String(T.en[k]);
    expect(rotuloDelPrecio({ pausado: true }, "6 USD", es)).toBe("Por ahora no disponible");
    expect(rotuloDelPrecio({ pausado: true }, "6 USD", en)).toBe("Not available right now");
    expect(rotuloDelPrecio({ pausado: false }, "6 USD", es)).toBe("6 USD");
  });

  it("un 503 venta-pausada se lee como el paquete que no está a la venta, también con el techo", () => {
    expect(claveDeLaOrden(503, { motivo: "venta-pausada", producto: "p10" })).toBe("pagoPausado");
    expect(claveDeLaOrden(503, { motivo: "venta-pausada", detalle: "techo" })).toBe("pagoPausado");
    expect(String(T.es.pagoPausado)).toContain("Lo que ya compraste sigue siendo tuyo");
    expect(claveDeLaOrden(503, { motivo: "pago-apagado" })).toBeNull();
    expect(claveDeLaOrden(400, { motivo: "venta-pausada" })).toBeNull();
    expect(claveDeLaOrden(503, null)).toBeNull();
  });
});
