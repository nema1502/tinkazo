import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { problemasDePremios } from "./premios-build";

/**
 * El build no sale con el modo premios junto con el pago con el saldo o con la compra con QR: el modo promete que la
 * cuenta solo ve su saldo y recibe, y esos dos firman con ella o le traen dinero. No toca ninguna bandera: obliga a elegir.
 */

describe("el modo premios y la venta", () => {
  it("con el pago con el saldo prendido, el build no sale: nombra las banderas y no sus valores", () => {
    const p = problemasDePremios({ VITE_RAMPA: "premios", VITE_PAGO_CON_SALDO: "1" });
    expect(p).toHaveLength(1);
    expect(p[0]).toContain("VITE_RAMPA=premios");
    expect(p[0]).toContain("VITE_PAGO_CON_SALDO=1");
  });

  it("con la compra con QR prendida, tampoco", () => {
    const p = problemasDePremios({ VITE_RAMPA: "premios", VITE_COMPRA_QR: "1" });
    expect(p).toHaveLength(1);
    expect(p[0]).toContain("VITE_COMPRA_QR=1");
  });

  it("con las dos, dice las dos", () => {
    expect(problemasDePremios({ VITE_RAMPA: "premios", VITE_PAGO_CON_SALDO: "1", VITE_COMPRA_QR: "1", VITE_ALTA_PAGO: "1" })).toHaveLength(2);
  });

  it("lee el modo como lo lee el sitio: sin mayúsculas ni espacios que importen", () => {
    expect(problemasDePremios({ VITE_RAMPA: "  Premios ", VITE_PAGO_CON_SALDO: "1" })).toHaveLength(1);
    expect(problemasDePremios({ VITE_RAMPA: "PREMIOS", VITE_COMPRA_QR: "1" })).toHaveLength(1);
  });

  it("con el modo premios solo, o con premios y la venta sin esas dos, no hay ningún problema", () => {
    expect(problemasDePremios({ VITE_RAMPA: "premios" })).toEqual([]);
    expect(problemasDePremios({ VITE_RAMPA: "premios", VITE_ALTA_PAGO: "1", VITE_ALTA: "1" })).toEqual([]);
    expect(problemasDePremios({ VITE_RAMPA: "premios", VITE_PAGO_CON_SALDO: "0", VITE_COMPRA_QR: "" })).toEqual([]);
    expect(problemasDePremios({})).toEqual([]);
  });

  it("con la venta sin el modo premios, o con otro modo de la rampa, el build sale como hoy", () => {
    for (const rampa of [undefined, "", "pollar", "recibir", "meru", "premio", "premios,recibir"]) {
      expect(problemasDePremios({ ...(rampa === undefined ? {} : { VITE_RAMPA: rampa }), VITE_PAGO_CON_SALDO: "1", VITE_COMPRA_QR: "1" }), String(rampa)).toEqual([]);
    }
  });

  it("no escribe valores de variables: ni una dirección ni una llave llegan a la bitácora", () => {
    const secreto = "https://pm.tinkazo.app/ruta-secreta";
    const p = problemasDePremios({ VITE_RAMPA: "premios", VITE_PAGO_CON_SALDO: "1", VITE_PATROCINIO_URL_MAINNET: secreto, VITE_POLLAR_PUBLISHABLE_KEY_MAINNET: "pub_llave" });
    expect(p.join(" ")).not.toContain(secreto);
    expect(p.join(" ")).not.toContain("pub_llave");
  });
});

describe("vite.config.ts frena el build con esta regla", () => {
  const config = readFileSync(new URL("../../vite.config.ts", import.meta.url), "utf8");

  it("arma el control solo al construir, con las variables VITE_ del entorno, y lo pone entre los plugins", () => {
    expect(config).toContain('import { problemasDePremios } from "./src/stellar/premios-build";');
    const control = config.slice(config.indexOf("function validarModoPremios"), config.indexOf("function validarPaginasConCobro"));
    expect(control).toContain('apply: "build"');
    expect(control).toContain('loadEnv(mode, __dirname, ["VITE_"])');
    expect(control).toMatch(/if \(problemas\.length\) throw new Error/);
    expect(config).toMatch(/plugins: \[[^\]]*validarModoPremios\(\)/);
  });

  it("no frena pnpm dev ni las pruebas: el control es solo del build", () => {
    const control = config.slice(config.indexOf("function validarModoPremios"), config.indexOf("function validarPaginasConCobro"));
    expect(control).not.toContain("configureServer");
    expect(control).not.toMatch(/apply:\s*"serve"/);
  });
});
