import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cuentaDePrueba } from "../campana/cuentas-de-prueba";
import { comisionDelBuild } from "./comision-config";
import { type OpcionesDeLaComision, problemasDeLaComision } from "./premios-build";

/**
 * Lo que frena el build con la comisión de las campañas a medio poner, armado como lo arma el build: el entorno y lo que dice
 * el archivo del portero. Todo con cuentas inventadas y sin red.
 */
const COBROS = cuentaDePrueba(1);
const RECIBE = cuentaDePrueba(2);
const PATROCINADORA = cuentaDePrueba(3);
const BIEN: Record<string, string> = {
  VITE_COMISION_PB: "200",
  VITE_COMISION_MINIMO: "1.50",
  VITE_COMISION_CUENTA: RECIBE,
  VITE_RETIRO_COSTO: "0.50",
  VITE_RETIRO_CUENTA: COBROS,
  VITE_PAGAR_CON_GOOGLE: "1",
};
const PORTERO_BIEN: OpcionesDeLaComision = {
  cuentasDelPortero: [PATROCINADORA, COBROS],
  costoDelPortero: 5_000_000n,
  retirosDelPortero: true,
};
const con = (c: Record<string, string>): Record<string, string> => ({ ...BIEN, ...c });

describe("el control de la comisión", () => {
  it("con todo en regla, sin problemas", () => {
    expect(problemasDeLaComision(BIEN, PORTERO_BIEN)).toEqual([]);
  });

  it("con las tres vacías no mira nada", () => {
    const sin = { VITE_RETIRO_COSTO: "0.50", VITE_RETIRO_CUENTA: COBROS };
    expect(problemasDeLaComision(sin, { cuentasDelPortero: null, costoDelPortero: null, retirosDelPortero: null })).toEqual([]);
  });

  it("con una sola de las tres, no sale: van juntas", () => {
    const p = problemasDeLaComision({ ...BIEN, VITE_COMISION_PB: "", VITE_COMISION_MINIMO: "" }, PORTERO_BIEN);
    expect(p.some((x) => x.includes("juntas"))).toBe(true);
  });

  it("puntos básicos fuera de 1 a 1000, no sale", () => {
    expect(problemasDeLaComision(con({ VITE_COMISION_PB: "0" }), PORTERO_BIEN).length).toBeGreaterThan(0);
    expect(problemasDeLaComision(con({ VITE_COMISION_PB: "1001" }), PORTERO_BIEN).length).toBeGreaterThan(0);
    expect(problemasDeLaComision(con({ VITE_COMISION_PB: "2,5" }), PORTERO_BIEN).length).toBeGreaterThan(0);
  });

  it("un mínimo mal escrito, no sale", () => {
    expect(problemasDeLaComision(con({ VITE_COMISION_MINIMO: "1,50" }), PORTERO_BIEN).length).toBeGreaterThan(0);
  });

  it("un mínimo que el camino del retiro no puede pagar, no sale", () => {
    const p = problemasDeLaComision(con({ VITE_COMISION_MINIMO: "1.49" }), PORTERO_BIEN);
    expect(p.some((x) => x.includes("camino del retiro"))).toBe(true);
  });

  it("una cuenta que no es una dirección, no sale", () => {
    expect(problemasDeLaComision(con({ VITE_COMISION_CUENTA: "GNOESUNACUENTA" }), PORTERO_BIEN).length).toBeGreaterThan(0);
  });

  it("la cuenta igual a la de cobros del retiro, no sale", () => {
    expect(problemasDeLaComision(con({ VITE_COMISION_CUENTA: COBROS }), PORTERO_BIEN).length).toBeGreaterThan(0);
  });

  it("la cuenta igual a una del portero, no sale", () => {
    expect(problemasDeLaComision(con({ VITE_COMISION_CUENTA: PATROCINADORA }), PORTERO_BIEN).length).toBeGreaterThan(0);
  });

  it("sin poder leer el archivo del portero, no sale", () => {
    const sinLeer = { cuentasDelPortero: null, costoDelPortero: null, retirosDelPortero: null };
    expect(problemasDeLaComision(BIEN, sinLeer).length).toBeGreaterThan(0);
  });

  it("sin pagar con Google, no sale", () => {
    expect(problemasDeLaComision(con({ VITE_PAGAR_CON_GOOGLE: "" }), PORTERO_BIEN).length).toBeGreaterThan(0);
  });

  it("sin el costo del retiro cobrándose, no sale", () => {
    expect(problemasDeLaComision(con({ VITE_RETIRO_COSTO: "" }), PORTERO_BIEN).length).toBeGreaterThan(0);
  });

  it("un costo del sitio distinto del que exige el portero, no sale", () => {
    const p = problemasDeLaComision(BIEN, { ...PORTERO_BIEN, costoDelPortero: 7_000_000n });
    expect(p.some((x) => x.includes("COSTO_RETIRO"))).toBe(true);
  });

  it("con los retiros apagados en el portero, no sale", () => {
    const p = problemasDeLaComision(BIEN, { ...PORTERO_BIEN, retirosDelPortero: false });
    expect(p.some((x) => x.includes("RETIROS"))).toBe(true);
  });

  it("ningún mensaje escribe el valor de una variable", () => {
    const malo = con({ VITE_COMISION_PB: "9999", VITE_COMISION_MINIMO: "1.49", VITE_COMISION_CUENTA: COBROS });
    const texto = problemasDeLaComision(malo, { ...PORTERO_BIEN, costoDelPortero: 7_000_000n }).join("\n");
    for (const valor of [COBROS, RECIBE, "9999", "1.49", "7000000"]) expect(texto).not.toContain(valor);
  });

  it("toda configuración que pasa el control prende en el sitio", () => {
    const entornos = [
      BIEN,
      con({ VITE_COMISION_PB: "1" }),
      con({ VITE_COMISION_PB: "1000", VITE_COMISION_MINIMO: "5" }),
      con({ VITE_COMISION_MINIMO: "1.50", VITE_RETIRO_COSTO: "0.50" }),
      con({ VITE_RETIRO_COSTO: "1", VITE_COMISION_MINIMO: "2" }),
      con({ VITE_RETIRO_COSTO: "1", VITE_COMISION_MINIMO: "1.99" }),
      con({ VITE_COMISION_CUENTA: cuentaDePrueba(9) }),
    ];
    for (const e of entornos) {
      const costo = e.VITE_RETIRO_COSTO === "1" ? 10_000_000n : 5_000_000n;
      const problemas = problemasDeLaComision(e, { ...PORTERO_BIEN, costoDelPortero: costo });
      if (problemas.length === 0) expect(comisionDelBuild(e), JSON.stringify(e)).not.toBeNull();
    }
  });
});

describe("vite.config.ts y .env.example", () => {
  const config = readFileSync(new URL("../../vite.config.ts", import.meta.url), "utf8");
  const control = config.slice(config.indexOf("function validarComision"), config.indexOf("Las páginas de lectura se adelantan"));

  it("el plugin de la comisión está en la lista y solo lee el archivo del portero", () => {
    expect(config).toMatch(/import \{[^}]*\bproblemasDeLaComision\b[^}]*\} from "\.\/src\/stellar\/premios-build";/);
    expect(config).toContain("validarComision(),");
    expect(control).toContain("problemasDeLaComision(env");
    expect(control).toContain('apply: "build"');
    expect(control).not.toContain("writeFileSync");
  });

  it("el build deja comision.json con los datos públicos", () => {
    expect(control).toContain('fileName: "comision.json"');
  });

  it("las tres variables están vacías en .env.example, cada una con su comentario", () => {
    const lineas = readFileSync(new URL("../../.env.example", import.meta.url), "utf8").split(/\r?\n/);
    for (const nombre of ["VITE_COMISION_PB", "VITE_COMISION_MINIMO", "VITE_COMISION_CUENTA"]) {
      const i = lineas.indexOf(`${nombre}=`);
      expect(i, nombre).toBeGreaterThan(0);
      expect(lineas[i - 1], nombre).toMatch(/^#/);
    }
  });
});
