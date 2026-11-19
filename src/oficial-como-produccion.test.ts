import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { errorKey } from "./stellar/errores";
import { errorDeRespuesta } from "./stellar/patrocinador";

/**
 * La compra con QR no cambia el sello ni el sorteo del modo Oficial: los dos quedan como en producción. El control de
 * costos de Oficial (los topes antes de firmar, el resultado sin registrar, el costo alto que no se reintenta) entra
 * después, con su propia revisión y con el servidor que lo acompaña.
 *
 * Las pruebas leen el código como texto desde la raíz del repositorio (en jsdom `import.meta.url` no es de archivo).
 */

const leer = (f: string): string => readFileSync(resolve(process.cwd(), f), "utf8");

describe("el sello y el sorteo de Oficial, como en producción", () => {
  it("lo que el portero de producción contesta cuando su simulación sale cara se toma como la red ocupada", () => {
    expect(errorKey(errorDeRespuesta(400, { motivo: "no-permitida", razon: "fee-alta", detalle: "simulacion" }), { patrocinada: true })).toBe("busy");
    expect(errorKey(errorDeRespuesta(400, { motivo: "fee-alta", detalle: "simulacion" }), { patrocinada: true })).toBe("busy");
  });

  it("el sello y el sorteo no preguntan por los topes antes de firmar, y el sorteo no sale sin registrarse", () => {
    for (const f of ["src/ui/anchor.ts", "src/ui/draw.ts", "src/ui/freeze.ts", "src/verify.ts", "src/ui/history.ts"]) {
      const s = leer(f);
      expect(s, f).not.toMatch(/topes-oficial|revisarTopes|frenoAntesDeFirmar/);
      expect(s, f).not.toMatch(/sin-registro|registroPendiente|notaSinRegistro/);
    }
    expect(existsSync(resolve(process.cwd(), "src/stellar/topes-oficial.ts"))).toBe(false);
    expect(existsSync(resolve(process.cwd(), "src/ui/sin-registro.ts"))).toBe(false);
  });

  it("verificar no dice que un resultado está calculado sin registrar", () => {
    expect(leer("src/verificacion-textos.ts")).not.toMatch(/detalleSinRegistrar|verificarRegistroEnCamino/);
  });
});
