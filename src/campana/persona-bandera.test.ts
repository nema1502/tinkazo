import { describe, expect, it } from "vitest";
import { anotarseSinBilleteraActivo, clienteDeGoogleDelSitio } from "./persona-bandera";

describe("las banderas de anotarse sin billetera", () => {
  it("nacen apagadas", () => {
    expect(anotarseSinBilleteraActivo({})).toBe(false);
    expect(clienteDeGoogleDelSitio({})).toBeNull();
  });

  it("solo el 1 exacto prende el interruptor", () => {
    expect(anotarseSinBilleteraActivo({ VITE_ANOTARSE_SIN_BILLETERA: "1" })).toBe(true);
    for (const valor of ["", "0", "true", "si", " 1", "1 ", 1, true, null, undefined]) {
      expect(anotarseSinBilleteraActivo({ VITE_ANOTARSE_SIN_BILLETERA: valor }), String(valor)).toBe(false);
    }
  });

  it("el cliente de Google solo sale con el interruptor y con un identificador", () => {
    const cliente = "cliente.apps.example.org";
    expect(clienteDeGoogleDelSitio({ VITE_ANOTARSE_SIN_BILLETERA: "1", VITE_GOOGLE_CLIENT_ID: cliente })).toBe(cliente);
    expect(clienteDeGoogleDelSitio({ VITE_ANOTARSE_SIN_BILLETERA: "1", VITE_GOOGLE_CLIENT_ID: `  ${cliente}  ` })).toBe(cliente);
    expect(clienteDeGoogleDelSitio({ VITE_ANOTARSE_SIN_BILLETERA: "1", VITE_GOOGLE_CLIENT_ID: "" })).toBeNull();
    expect(clienteDeGoogleDelSitio({ VITE_ANOTARSE_SIN_BILLETERA: "1", VITE_GOOGLE_CLIENT_ID: "   " })).toBeNull();
    expect(clienteDeGoogleDelSitio({ VITE_ANOTARSE_SIN_BILLETERA: "1" })).toBeNull();
    expect(clienteDeGoogleDelSitio({ VITE_ANOTARSE_SIN_BILLETERA: "1", VITE_GOOGLE_CLIENT_ID: 7 })).toBeNull();
    expect(clienteDeGoogleDelSitio({ VITE_ANOTARSE_SIN_BILLETERA: "0", VITE_GOOGLE_CLIENT_ID: cliente })).toBeNull();
    expect(clienteDeGoogleDelSitio({ VITE_GOOGLE_CLIENT_ID: cliente })).toBeNull();
  });
});
