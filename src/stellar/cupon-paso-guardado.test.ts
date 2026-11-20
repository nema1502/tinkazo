// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { CLAVE_PASO_CUPON, limpiarPasoDelCupon } from "./cupon-paso-guardado";

describe("la marca guardada del paso del cupón", () => {
  beforeEach(() => sessionStorage.clear());

  it("su limpieza borra solo esa marca y no la puerta de entrar", () => {
    sessionStorage.setItem(CLAVE_PASO_CUPON, "1");
    sessionStorage.setItem("tinkazo.ingresar", "1");
    sessionStorage.setItem("otra.marca", "1");

    limpiarPasoDelCupon();

    expect(sessionStorage.getItem(CLAVE_PASO_CUPON)).toBeNull();
    expect(sessionStorage.getItem("tinkazo.ingresar")).toBe("1");
    expect(sessionStorage.getItem("otra.marca")).toBe("1");
  });
});
