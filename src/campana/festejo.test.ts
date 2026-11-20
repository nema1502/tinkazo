// @vitest-environment jsdom
/** El papel picado de Ganaste: reparto de la caída, colores visibles y fin antes de los 2,6 s. */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FESTEJO_GRANDE, festejar } from "./festejo";

function papelitos(grande: boolean, reducido = false): HTMLElement[] {
  document.body.innerHTML = "<section id=\"bloque\"></section>";
  const bloque = document.querySelector<HTMLElement>("#bloque") as HTMLElement;
  festejar(bloque, { grande, reducido, vibrar: () => undefined });
  return [...bloque.querySelectorAll<HTMLElement>(".cmp-papelito")];
}

function milisegundos(valor: string): number {
  return Number.parseFloat(valor);
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("el papel picado grande", () => {
  it("son treinta papelitos y cada corrida es idéntica, sin azar", () => {
    const primera = papelitos(true).map((p) => p.style.animationDelay + p.style.animationDuration + p.style.left);
    const segunda = papelitos(true).map((p) => p.style.animationDelay + p.style.animationDuration + p.style.left);
    expect(primera).toHaveLength(FESTEJO_GRANDE.cantidad);
    expect(segunda).toEqual(primera);
  });

  it("reparte la caída: salen entre 0 y 700 ms y duran entre 1,1 y 1,9 s", () => {
    const lista = papelitos(true);
    const retrasos = lista.map((p) => milisegundos(p.style.animationDelay));
    const duraciones = lista.map((p) => milisegundos(p.style.animationDuration));
    expect(Math.min(...retrasos)).toBe(0);
    expect(Math.max(...retrasos)).toBe(FESTEJO_GRANDE.retrasoMaxMs);
    expect(Math.min(...duraciones)).toBe(FESTEJO_GRANDE.duracionMinMs);
    expect(Math.max(...duraciones)).toBe(FESTEJO_GRANDE.duracionMaxMs);
    expect(new Set(retrasos).size).toBeGreaterThan(20);
    expect(new Set(duraciones).size).toBeGreaterThan(20);
  });

  it("ningún papelito termina después de los 2,6 s y todos se retiran poco después", () => {
    const lista = papelitos(true);
    for (const p of lista) {
      const fin = milisegundos(p.style.animationDelay) + milisegundos(p.style.animationDuration);
      expect(fin).toBeLessThanOrEqual(2600);
    }
    vi.advanceTimersByTime(2900);
    expect(document.querySelectorAll(".cmp-papelito")).toHaveLength(0);
  });

  it("incluye papelitos blancos, que se ven sobre el bloque de cualquier color de empresa", () => {
    const fondos = new Set(papelitos(true).map((p) => p.style.background));
    expect(fondos.has("rgb(255, 255, 255)") || fondos.has("#fff")).toBe(true);
    expect(fondos.has("var(--cmp-acento, var(--magenta))")).toBe(false);
  });

  it("con movimiento reducido no crea papelitos", () => {
    expect(papelitos(true, true)).toHaveLength(0);
  });
});

describe("el papel picado chico", () => {
  it("son doce papelitos de 600 ms, de un solo soplo", () => {
    const lista = papelitos(false);
    expect(lista).toHaveLength(12);
    for (const p of lista) expect(milisegundos(p.style.animationDuration)).toBe(600);
  });
});
