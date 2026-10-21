import { describe, expect, it } from "vitest";
import { grabador } from "./delatores-grabador.mjs";

/**
 * El grabador corre adentro de la página, así que acá solo se comprueba lo que
 * se puede sin navegador: que el guion se arme bien con cada opción y que lo
 * que pide cada juego le llegue. Que grabe lo que ve la sala lo comprueba la
 * corrida en el navegador (la validación con race y sapo en el informe).
 */
describe("el guion del grabador", () => {
  it("es JavaScript válido, con y sin opciones", () => {
    for (const cfg of [{}, { numeros: true }, { trazos: [{ color: 0xffc629, alpha: 0.9 }] }, { dibujar: true, turbo: 60, cada: 2 }]) {
      // eslint-disable-next-line no-new-func
      expect(() => new Function(grabador(cfg))).not.toThrow();
    }
  });

  it("lleva sus opciones y el reconocedor de nombres adentro", () => {
    const s = grabador({ numeros: true, trazos: [{ color: 0xffc629, alpha: 0.9 }] });
    expect(s).toContain('"numeros":true');
    expect(s).toContain(String(0xffc629));
    expect(s).toContain("const crearReconocedor = function crearReconocedor(nombres)");
    // Por defecto no dibuja: el motor calcula todo igual y la corrida va varias veces más rápido.
    expect(grabador()).toContain('"dibujar":false');
  });

  it("engancha lo que ve la sala: la aplicación de PixiJS, el relator y el reloj", () => {
    const s = grabador();
    expect(s).toContain("globalThis.__PIXI_APP_INIT__");
    expect(s).toContain('getElementById("commentary")');
    expect(s).toContain("performance.now = () => virt");
  });
});
