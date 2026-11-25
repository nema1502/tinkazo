import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * La cuenta recordada del registro de equipos espera la respuesta de la retoma de Google: debe pedir la primera mirada
 * de 8 segundos y no la ventana paciente de 30, que es solo de la cabecera.
 */
describe("la cuenta recordada del registro de equipos", () => {
  it("retoma Google con la primera mirada, sin la ventana paciente", () => {
    const codigo = readFileSync("src/equipos-registro.ts", "utf8");
    expect(codigo).toMatch(/pollarWallet\.restore\(\{ ventanaMs: m\.LISTO_MS \}\)/);
  });
});
