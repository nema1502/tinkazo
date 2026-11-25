import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FUSIBLE_DE_RETOMA_MS, VENTANA_RETOMA_MS } from "../stellar/pollar-config";

/**
 * El fusible de la cabecera y la retoma de la sesión de Google.
 *
 * La cabecera dice Retomando como máximo lo de siempre: 8 segundos de primera mirada del proveedor y 12 de fusible. La
 * retoma paciente (`VENTANA_RETOMA_MS`, 30 segundos) corre por detrás y no cambia lo que se ve: pasada la primera
 * mirada la retoma misma suelta la cabecera (`cuandoTarda`), y si la sesión llega después, se abre sola.
 */

const fuente = (ruta: string): string => readFileSync(new URL(ruta, import.meta.url), "utf8").replace(/
/g, "
");

describe("el fusible de la cabecera y la retoma de la sesión", () => {
  it("el fusible es el de siempre y la ventana paciente corre por detrás, más larga que él", () => {
    expect(FUSIBLE_DE_RETOMA_MS).toBe(12_000);
    expect(VENTANA_RETOMA_MS).toBeGreaterThan(FUSIBLE_DE_RETOMA_MS);
  });

  it("la cabecera usa ese fusible y la retoma la suelta al terminar su primera mirada", () => {
    const ui = fuente("./wallet-ui.ts");
    expect(ui).toMatch(/setTimeout\(fin,\s*FUSIBLE_DE_RETOMA_MS\)/);
    expect(ui).toMatch(/restorePollar\(fin\)/);
    expect(ui).toMatch(/restore\(\{\s*cuandoTarda:/);
  });

  it("la retoma de wallet-pollar.ts y el fusible miran la misma ventana", () => {
    const pollar = fuente("../stellar/wallet-pollar.ts");
    expect(pollar).toMatch(/VENTANA_RETOMA_MS[^;]*from "\.\/pollar-config"/);
    expect(pollar).not.toMatch(/export const VENTANA_RETOMA_MS\s*=/);
  });
});
