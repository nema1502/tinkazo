import { describe, expect, it } from "vitest";
import { anotarMarcas } from "./marcas";

const plan = { arco: "susto", marcas: { mitad: "3", peloton: "10" } };
const anotadas = (auditar: string | null): [string, string][] => {
  const out: [string, string][] = [];
  anotarMarcas(auditar, plan, (c, v) => out.push([c, v]));
  return out;
};

describe("las marcas del plan son para los auditores", () => {
  it("sin ?auditar no se anota nada: el arco y el puesto de la ganadora no están en el DOM desde el segundo cero", () => {
    expect(anotadas(null)).toEqual([]);
    expect(anotadas("")).toEqual([]);
  });

  it("con ?auditar=<lo que sea> quedan las marcas del plan y el arco", () => {
    for (const valor of ["marcas", "camara", "nino", "identidad"]) {
      expect(anotadas(valor), valor).toEqual([["mitad", "3"], ["peloton", "10"], ["arco", "susto"]]);
    }
  });

  it("un plan sin marcas propias anota solo el arco", () => {
    const out: [string, string][] = [];
    anotarMarcas("marcas", { arco: "duelo" }, (c, v) => out.push([c, v]));
    expect(out).toEqual([["arco", "duelo"]]);
  });
});
