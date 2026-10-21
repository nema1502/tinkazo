import { describe, expect, it } from "vitest";
import { buscar, normalizar, parecidos, repetidos, vecesExacto } from "./buscar";

const lista = ["María Quispe", "Jorge Mamani", "ana quispe", "Ana Quispe", "Mariana Flores"];

describe("buscarse en la lista", () => {
  it("compara sin tildes, mayúsculas ni espacios de más", () => {
    expect(normalizar("  María   QUISPE ")).toBe("maria quispe");
  });

  it("da los puestos desde 1 de todo lo que coincide", () => {
    expect(buscar(lista, "maria")).toEqual([1, 5]);
    expect(buscar(lista, "Jorge")).toEqual([2]);
    expect(buscar(lista, "nadie")).toEqual([]);
    expect(buscar(lista, "   ")).toEqual([]);
  });

  it("marca los repetidos aunque estén escritos distinto", () => {
    expect([...repetidos(lista)].sort()).toEqual([2, 3]);
    expect(repetidos(["Ana", "Luis"]).size).toBe(0);
  });

  it("dice qué nombres parecen la misma persona escrita distinto, como se escribieron (D09)", () => {
    expect(parecidos(lista)).toEqual([["ana quispe", "Ana Quispe"]]);
    expect(parecidos(["José Pérez", "JOSE PEREZ", "Luis", "luis", "Carla"])).toEqual([
      ["José Pérez", "JOSE PEREZ"],
      ["Luis", "luis"],
    ]);
    expect(parecidos(["Ana", "Luis"])).toEqual([]);
  });

  it("cuenta las veces exactas de un nombre", () => {
    expect(vecesExacto(lista, "ANA QUISPE")).toBe(2);
    expect(vecesExacto(lista, "Jorge Mamani")).toBe(1);
  });
});
