import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FUSIBLE_DE_RETOMA_MS, VENTANA_RETOMA_MS } from "../stellar/pollar-config";

/**
 * La cabecera no ofrece Entrar mientras la sesión de Google todavía se está retomando.
 *
 * La retoma espera al proveedor hasta `VENTANA_RETOMA_MS` (30 segundos, con la red lenta de un stand). El fusible de la
 * cabecera, que corta el "Retomando…" por si algo queda colgado, tiene que ser más largo: si no, a los 12 segundos la
 * cabecera mostraba Entrar con la sesión todavía en camino, y la persona podía empezar otra entrada en paralelo.
 */

const fuente = (ruta: string): string => readFileSync(new URL(ruta, import.meta.url), "utf8").replace(/\r\n/g, "\n");

describe("el fusible de la cabecera y la retoma de la sesión", () => {
  it("el fusible es más largo que la ventana de la retoma, con margen para bajar el SDK", () => {
    expect(FUSIBLE_DE_RETOMA_MS).toBeGreaterThanOrEqual(VENTANA_RETOMA_MS + 5_000);
  });

  it("la cabecera usa ese fusible y ya no corta a los 12 segundos", () => {
    const ui = fuente("./wallet-ui.ts");
    expect(ui).toMatch(/setTimeout\(fin,\s*FUSIBLE_DE_RETOMA_MS\)/);
    expect(ui).not.toMatch(/setTimeout\(fin,\s*12_000\)/);
    expect(ui).not.toMatch(/nunca más de 12 s/);
  });

  it("la retoma de wallet-pollar.ts y el fusible miran la misma ventana", () => {
    const pollar = fuente("../stellar/wallet-pollar.ts");
    expect(pollar).toMatch(/VENTANA_RETOMA_MS[^;]*from "\.\/pollar-config"/);
    expect(pollar).not.toMatch(/export const VENTANA_RETOMA_MS\s*=/);
  });
});
