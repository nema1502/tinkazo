import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LEVELS, RED_PERCENT_OF_TARGET, UMBRALES, validarEstado } from "./umbrales-red.mjs";

// El detector (scripts/vigilar-red.mjs, rama vigilar-red) y la app miran la red con los mismos números:
// los de src/stellar/red-umbrales.json. Esta prueba cuida que ese archivo siga teniendo lo que el
// detector lee, y que los números de hoy sean los que el detector traía escritos en su propio código.

const archivo = JSON.parse(readFileSync(new URL("../../src/stellar/red-umbrales.json", import.meta.url), "utf8"));
const copia = () => structuredClone(archivo);

describe("los umbrales que comparten la app y el detector", () => {
  it("el detector lee el mismo archivo que la app, sin copias", () => {
    expect(UMBRALES).toEqual(archivo);
  });

  it("los niveles de hoy son los que el detector tenía escritos (ningún cambio al juntar las ramas)", () => {
    expect(LEVELS).toEqual({
      mainnet: [
        { name: "amarillo", mb: 2000 },
        { name: "naranja", mb: 2500 },
        { name: "rojo", mb: 2850 },
      ],
      testnet: [{ name: "rojo", mb: 6000 }],
    });
    expect(RED_PERCENT_OF_TARGET).toBe(95);
  });

  it("lo que lee la app sigue ahí: el tope, el factor y los dos niveles de costo de cada red", () => {
    for (const red of ["testnet", "mainnet"]) {
      const u = archivo[red];
      for (const k of ["topePollarXlm", "factorDelFeeBump", "rojoXlm", "amarilloXlm"]) {
        expect(Number.isFinite(u[k]) && u[k] > 0, `${red}.${k}`).toBe(true);
      }
      expect(u.amarilloXlm).toBeLessThan(u.rojoXlm);
      // El rojo deja la oferta del fee-bump justo debajo del tope del patrocinador.
      expect(u.rojoXlm * u.factorDelFeeBump).toBeLessThan(u.topePollarXlm);
    }
  });

  it("mainnet tiene tres niveles y testnet uno solo, el último siempre rojo", () => {
    expect(archivo.mainnet.estadoMb.map((n) => n.name)).toEqual(["amarillo", "naranja", "rojo"]);
    expect(archivo.testnet.estadoMb.map((n) => n.name)).toEqual(["rojo"]);
  });
});

describe("validarEstado: un archivo roto hace fallar al detector con el motivo, no comparar contra nada", () => {
  it("acepta el de hoy", () => {
    expect(() => validarEstado(copia())).not.toThrow();
  });

  it("sin niveles, desordenados, sin nombre válido o sin rojo al final", () => {
    const sinNiveles = copia();
    delete sinNiveles.mainnet.estadoMb;
    expect(() => validarEstado(sinNiveles)).toThrow(/mainnet\.estadoMb/);

    const vacio = copia();
    vacio.testnet.estadoMb = [];
    expect(() => validarEstado(vacio)).toThrow(/testnet\.estadoMb/);

    const alReves = copia();
    alReves.mainnet.estadoMb.reverse();
    expect(() => validarEstado(alReves)).toThrow(/de menor a mayor/);

    const nombre = copia();
    nombre.mainnet.estadoMb[0].name = "verde";
    expect(() => validarEstado(nombre)).toThrow(/nombre válido/);

    const sinRojo = copia();
    sinRojo.mainnet.estadoMb[2].name = "naranja";
    expect(() => validarEstado(sinRojo)).toThrow(/rojo/);

    const nan = copia();
    nan.testnet.estadoMb[0].mb = "6000";
    expect(() => validarEstado(nan)).toThrow(/menor a mayor/);
  });

  it("el porcentaje del objetivo tiene que estar entre 0 y 100", () => {
    for (const malo of [0, -5, 101, "95", undefined, Number.NaN]) {
      const u = copia();
      u.comun.rojoPorcientoDelObjetivo = malo;
      expect(() => validarEstado(u), String(malo)).toThrow(/rojoPorcientoDelObjetivo/);
    }
    const justo = copia();
    justo.comun.rojoPorcientoDelObjetivo = 100;
    expect(() => validarEstado(justo)).not.toThrow();
  });
});
