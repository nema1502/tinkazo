import { describe, expect, it } from "vitest";
import { cuentaDePrueba } from "../campana/cuentas-de-prueba";
import {
  comisionDelBuild,
  costoDelRetiroDelToml,
  cuentasDelPorteroEnElToml,
  leerMinimo,
  leerPb,
  minimoPosible,
  retirosDelToml,
  variablesDelPorteroEnElToml,
} from "./comision-config";

/** La configuración del cobro de una campaña: tres variables que van juntas, sobre el costo del retiro. Entornos armados a mano. */
const COBROS = cuentaDePrueba(1);
const RECIBE = cuentaDePrueba(2);
const BIEN = {
  VITE_COMISION_PB: "200",
  VITE_COMISION_MINIMO: "1.50",
  VITE_COMISION_CUENTA: RECIBE,
  VITE_RETIRO_COSTO: "0.50",
  VITE_RETIRO_CUENTA: COBROS,
};

describe("las variables", () => {
  it("200 puntos básicos valen", () => {
    expect(leerPb("200")).toEqual({ tipo: "valido", valor: 200n });
  });

  it("0 y 1001 puntos básicos están mal escritos", () => {
    expect(leerPb("0")).toEqual({ tipo: "mal-escrito" });
    expect(leerPb("1001")).toEqual({ tipo: "mal-escrito" });
  });

  it("puntos básicos con letras o con coma están mal escritos", () => {
    expect(leerPb("2%")).toEqual({ tipo: "mal-escrito" });
    expect(leerPb("2,5")).toEqual({ tipo: "mal-escrito" });
  });

  it("vacío es vacío", () => {
    expect(leerPb("")).toEqual({ tipo: "vacio" });
    expect(leerPb(undefined)).toEqual({ tipo: "vacio" });
    expect(leerMinimo("  ")).toEqual({ tipo: "vacio" });
  });

  it("el mínimo 1.50 da 15.000.000 stroops", () => {
    expect(leerMinimo("1.50")).toEqual({ tipo: "valido", valor: 15_000_000n });
    expect(leerMinimo("2")).toEqual({ tipo: "valido", valor: 20_000_000n });
  });

  it("el mínimo con más de dos decimales, con coma o en cero está mal escrito", () => {
    expect(leerMinimo("1.505")).toEqual({ tipo: "mal-escrito" });
    expect(leerMinimo("1,50")).toEqual({ tipo: "mal-escrito" });
    expect(leerMinimo("0.00")).toEqual({ tipo: "mal-escrito" });
  });

  it("lo que no es texto está mal escrito", () => {
    expect(leerPb(200)).toEqual({ tipo: "mal-escrito" });
  });
});

describe("la configuración del build", () => {
  it("las tres válidas con el costo del retiro dan la configuración", () => {
    expect(comisionDelBuild(BIEN)).toEqual({ pb: 200n, minimo: 15_000_000n, cuenta: RECIBE, costo: 5_000_000n, cobros: COBROS });
  });

  it("falta una de las tres, es null", () => {
    expect(comisionDelBuild({ ...BIEN, VITE_COMISION_PB: "" })).toBeNull();
    expect(comisionDelBuild({ ...BIEN, VITE_COMISION_MINIMO: "" })).toBeNull();
    expect(comisionDelBuild({ ...BIEN, VITE_COMISION_CUENTA: "" })).toBeNull();
  });

  it("una cuenta que no es una dirección es null", () => {
    expect(comisionDelBuild({ ...BIEN, VITE_COMISION_CUENTA: "GNOESUNACUENTA" })).toBeNull();
  });

  it("0 y 1001 puntos básicos son null", () => {
    expect(comisionDelBuild({ ...BIEN, VITE_COMISION_PB: "0" })).toBeNull();
    expect(comisionDelBuild({ ...BIEN, VITE_COMISION_PB: "1001" })).toBeNull();
  });

  it("un mínimo de 1,49 con un costo de 0,50 es null", () => {
    expect(comisionDelBuild({ ...BIEN, VITE_COMISION_MINIMO: "1.49" })).toBeNull();
  });

  it("el mínimo posible es el costo más un dólar", () => {
    expect(minimoPosible(5_000_000n)).toBe(15_000_000n);
  });

  it("la cuenta que recibe igual a la de cobros es null", () => {
    expect(comisionDelBuild({ ...BIEN, VITE_COMISION_CUENTA: COBROS })).toBeNull();
  });

  it("sin el costo del retiro es null", () => {
    expect(comisionDelBuild({ ...BIEN, VITE_RETIRO_COSTO: "" })).toBeNull();
  });

  it("sin la cuenta de cobros del retiro es null", () => {
    expect(comisionDelBuild({ ...BIEN, VITE_RETIRO_CUENTA: "" })).toBeNull();
  });
});

describe("lo que se lee del archivo del portero", () => {
  const TOML = [
    "[vars]",
    'CUENTA_PATROCINADORA = "GPRUEBA"',
    "[env.mainnet.vars]",
    `CUENTA_PATROCINADORA = "${cuentaDePrueba(3)}"`,
    `CUENTA_COBROS = "${COBROS}"`,
    'CUENTA_SORTEADORA = ""',
    'RETIROS = "1"',
    'COSTO_RETIRO = "0.50"',
    "[env.testnet.vars]",
    `CUENTA_COBROS = "${cuentaDePrueba(9)}"`,
  ].join("\r\n");

  it("lee las cuentas de la sección de la red principal y saltea las vacías y las de otra sección", () => {
    expect(cuentasDelPorteroEnElToml(TOML)).toEqual([cuentaDePrueba(3), COBROS]);
  });

  it("lee el costo del retiro del portero", () => {
    expect(costoDelRetiroDelToml(TOML)).toBe(5_000_000n);
  });

  it("sin el costo escrito da null", () => {
    expect(costoDelRetiroDelToml("[env.mainnet.vars]\nRETIROS = \"1\"")).toBeNull();
  });

  it("dice si el portero atiende retiros", () => {
    expect(retirosDelToml(TOML)).toBe(true);
    expect(retirosDelToml(TOML.replace('RETIROS = "1"', 'RETIROS = "0"'))).toBe(false);
  });

  it("pide solo los nombres que se le dan", () => {
    expect(variablesDelPorteroEnElToml(TOML, ["RETIROS"])).toEqual({ RETIROS: "1" });
  });
});
