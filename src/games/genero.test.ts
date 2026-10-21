import { describe, expect, it } from "vitest";
import { generoDe } from "./genero";

describe("generoDe: la ropa sale del nombre", () => {
  it("reconoce los nombres de la lista, con tildes y espacios", () => {
    expect(generoDe("María Quispe")).toBe("f");
    expect(generoDe("  elena  condori")).toBe("f");
    expect(generoDe("Ángela Mamani")).toBe("f");
    expect(generoDe("Ruth")).toBe("f");
    expect(generoDe("Carlos Choque")).toBe("m");
    expect(generoDe("Iván")).toBe("m");
  });

  it("la lista manda sobre la terminación", () => {
    expect(generoDe("Luca Rossi")).toBe("m");
    expect(generoDe("Luz")).toBe("f");
  });

  it("sin la lista, la terminación", () => {
    expect(generoDe("Xiomara")).toBe("f");
    expect(generoDe("Gilberto")).toBe("m");
  });

  it("lo que no se puede clasificar vuelve null", () => {
    expect(generoDe("Sam")).toBeNull();
    expect(generoDe("Kim Lee")).toBeNull();
    expect(generoDe("")).toBeNull();
    expect(generoDe("Ka")).toBeNull();
  });
});
