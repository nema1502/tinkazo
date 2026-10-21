import { describe, expect, it } from "vitest";
import { bolasEn, crearReconocedor, nombresEn } from "./delatores-nombres.mjs";

const NOMBRES = ["María Quispe", "Jorge Mamani", "Lucía Flores", "Carlos Choque", "Ana Vargas", "Valeria Torrez", "Óscar Limachi"];

describe("de quién es una etiqueta de la escena", () => {
  const quien = crearReconocedor(NOMBRES);

  it("el nombre entero, sin distinguir mayúsculas ni espacios de más", () => {
    expect(quien("María Quispe")).toBe(0);
    expect(quien("  jorge   MAMANI ")).toBe(1);
    expect(quien("ÓSCAR LIMACHI")).toBe(6);
  });

  it("las versiones cortas de los juegos: inicial, corte con puntos suspensivos, nombre de pila", () => {
    expect(quien("María Q.")).toBe(0);
    expect(quien("Valeria Torr…")).toBe(5);
    expect(quien("Lucía")).toBe(2);
    expect(quien("Carlos Ch.")).toBe(3);
  });

  it("lo que no es de nadie, o de más de uno, no cuenta", () => {
    expect(quien("GANA")).toBe(-1);
    expect(quien("N.º 7")).toBe(-1);
    expect(quien("7")).toBe(-1);
    expect(quien("Pedro")).toBe(-1);
    // Una letra suelta (la de "¿Quién es?") no es Jorge.
    expect(quien("J")).toBe(-1);
    expect(quien("Jo")).toBe(-1);
    const dos = crearReconocedor(["María Quispe", "María Quispe 2"]);
    expect(dos("María Q.")).toBe(-1);
    expect(dos("María Quispe 2")).toBe(1);
    expect(dos("María Quispe")).toBe(0);
  });

  it("anda sola, como cuando el grabador la inyecta en la página", () => {
    // eslint-disable-next-line no-new-func
    const suelta = new Function(`return (${crearReconocedor.toString()})`)();
    expect(suelta(NOMBRES)("Ana V.")).toBe(4);
  });
});

describe("a quién nombra un subtítulo", () => {
  it("en el orden en que aparecen, con repeticiones", () => {
    expect(nombresEn("¡Pelea de llamas: Jorge Mamani contra María Quispe!", NOMBRES)).toEqual([1, 0]);
    expect(nombresEn("¡María Quispe escupió y María Quispe se frenó!", NOMBRES)).toEqual([0, 0]);
    expect(nombresEn("¡Tic, tic, tic!", NOMBRES)).toEqual([]);
  });

  it("sin distinguir mayúsculas: el cartel del ganador grita", () => {
    expect(nombresEn("¡GANA LUCÍA FLORES!", NOMBRES)).toEqual([2]);
  });

  it("el nombre más largo primero, y con borde de palabra", () => {
    const ns = ["María Quispe", "María Quispe 2", "Ana Vargas"];
    expect(nombresEn("¡Quedan María Quispe 2 y María Quispe!", ns)).toEqual([1, 0]);
    expect(nombresEn("¡Mariana Vargas pasa!", ns)).toEqual([]);
    expect(nombresEn("¡Ana Vargasito!", ns)).toEqual([]);
  });
});

describe("las bolas que nombra la tómbola", () => {
  it("el número de la bola es el puesto en la lista, desde uno", () => {
    expect(bolasEn("¡Salió la 7!", 10)).toEqual([6]);
    expect(bolasEn("¿La 12?", 20)).toEqual([11]);
    expect(bolasEn("¡La número 3!", 10)).toEqual([2]);
    expect(bolasEn("¡Asoma la 1!", 10)).toEqual([0]);
  });

  it("los números que no son bolas no cuentan", () => {
    expect(bolasEn("¡8 bolas, una por cabeza!", 8)).toEqual([]);
    expect(bolasEn("¡Salió la 9!", 8)).toEqual([]);
    expect(bolasEn("¡Salió la 0!", 8)).toEqual([]);
  });
});
