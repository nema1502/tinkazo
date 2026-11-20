import { describe, expect, it } from "vitest";
import { conDosColumnas, ladoDelQr, rellenar } from "./campana-grande";

/** Las medidas de la pantalla grande: el QR tan grande como entre en cada tamaño de ventana. */

describe("el lado del QR de la pantalla grande", () => {
  it("en un proyector de 1920 por 1080 llega a 920 px", () => {
    expect(ladoDelQr(1920, 1080)).toBe(920);
  });

  it("en una laptop de 1366 por 768 llega a 643 px, el menor entre el alto libre y la mitad del ancho", () => {
    expect(ladoDelQr(1366, 768)).toBe(643);
  });

  it("en un celular de pie ocupa el ancho menos el margen", () => {
    expect(ladoDelQr(390, 844)).toBe(358);
    expect(ladoDelQr(360, 640)).toBe(328);
  });

  it("en un celular acostado cabe a lo alto y no obliga a hacer scroll", () => {
    expect(conDosColumnas(844, 390)).toBe(true);
    expect(ladoDelQr(844, 390)).toBe(280);
  });

  it("en una ventana cuadrada de 700 reparte dos columnas, igual que la hoja de estilos con ancho igual a alto", () => {
    expect(conDosColumnas(700, 700)).toBe(true);
    expect(ladoDelQr(700, 700)).toBe(310);
  });

  it("en un proyector viejo de 800 por 600 reparte dos columnas y entra entero", () => {
    expect(conDosColumnas(800, 600)).toBe(true);
    expect(ladoDelQr(800, 600)).toBe(360);
  });

  it("una ventana angosta de escritorio queda en una columna y mide por el alto también", () => {
    expect(conDosColumnas(600, 900)).toBe(false);
    expect(ladoDelQr(600, 500)).toBe(468);
  });

  it("nunca baja de 160 px", () => {
    expect(ladoDelQr(200, 150)).toBe(160);
  });
});

describe("llenar los huecos de un texto", () => {
  it("cambia cada hueco por su valor y deja los que no conoce", () => {
    expect(rellenar("Cierra a las {hora}. {n} pedidos. {otro}", { hora: "17:00", n: 3 })).toBe("Cierra a las 17:00. 3 pedidos. {otro}");
  });
});
