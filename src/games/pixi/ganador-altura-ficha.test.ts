import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { nombreDeLaFicha } from "./ganador-altura";

// El escenario es de WebGL y no corre en estas pruebas: lo que se puede cuidar acá es qué nombre recibe la ficha
// y que el escenario lo arme con esa función.
const escenario = readFileSync(new URL("./stage.ts", import.meta.url), "utf8");

const cinco = ["Ana Uno", "Nora Dos", "Beto Tres", "Ana Cuatro", "Nora Cinco"];

describe("la ficha con el nombre completo cuando hay varios premios", () => {
  it("lleva solo el nombre del primer premio, que es el cuerpo que se despeja", () => {
    expect(nombreDeLaFicha(cinco)).toBe("Ana Uno");
  });

  it("no deja asomar ningún otro nombre antes de su momento", () => {
    const ficha = nombreDeLaFicha(cinco);
    for (const otro of cinco.slice(1)) expect(ficha).not.toContain(otro);
    expect(ficha).not.toContain("\n");
  });

  it("con dos premios tampoco adelanta al segundo", () => {
    expect(nombreDeLaFicha(["Beto Tres", "Nora Dos"])).toBe("Beto Tres");
  });

  it("con un solo premio queda igual que antes", () => {
    expect(nombreDeLaFicha(["Ana Uno"])).toBe("Ana Uno");
  });

  it("sin ganadores queda vacía", () => {
    expect(nombreDeLaFicha([])).toBe("");
  });

  it("el escenario arma la ficha con esa función y no junta a todos los ganadores", () => {
    expect(escenario).toMatch(/textoGanador = nombreDeLaFicha\(all\)/);
    expect(escenario).not.toMatch(/textoGanador = all\.join/);
  });
});
