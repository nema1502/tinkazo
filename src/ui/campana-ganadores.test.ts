// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Una campaña de empresa fija la cantidad de ganadoras a la de sus premios firmados: la sala no acepta otra. La traba es
 * aparte de la del orden de turnos (apagar el orden no la suelta) y se apaga al sellar, al soltar el sello y al dejar la campaña.
 */

function armar(): void {
  document.body.innerHTML =
    '<input id="nw" type="number" value="1"><span id="nw-valor"></span><button id="nw-menos"></button><button id="nw-mas"></button>' +
    '<div id="nw-atajos"><button data-n="1"></button><button data-n="2"></button><button data-n="3"></button></div>';
}
const boton = (id: string): HTMLButtonElement => document.getElementById(id) as HTMLButtonElement;
const campo = (): HTMLInputElement => document.getElementById("nw") as HTMLInputElement;

let g: typeof import("./ganadores");

beforeEach(async () => {
  // El contador se monta una sola vez por módulo: cada prueba arma su página y su módulo.
  vi.resetModules();
  armar();
  g = await import("./ganadores");
  g.montarGanadores();
});

describe("la cantidad de ganadoras fija por una campaña", () => {
  it("con la traba puesta, el contador y los atajos no cambian la cantidad", () => {
    g.ponerGanadores(2);
    g.fijarPorCampana(true);
    expect(campo().disabled).toBe(true);
    expect(boton("nw-menos").disabled).toBe(true);
    expect(boton("nw-mas").disabled).toBe(true);
    expect([...document.querySelectorAll<HTMLButtonElement>("#nw-atajos button")].every((b) => b.disabled)).toBe(true);
    boton("nw-mas").click();
    document.querySelector<HTMLButtonElement>('#nw-atajos button[data-n="3"]')?.click();
    expect(g.ganadoresPedidos()).toBe(2);
  });

  it("apagar el orden de turnos no suelta la traba de la campaña", () => {
    g.fijarPorCampana(true);
    g.fijarGanadores(true);
    g.fijarGanadores(false);
    expect(campo().disabled).toBe(true);
    expect(g.fijoPorCampana()).toBe(true);
  });

  it("al apagar la traba, un sorteo común vuelve a dejar cambiar la cantidad", () => {
    g.fijarPorCampana(true);
    g.fijarPorCampana(false);
    expect(campo().disabled).toBe(false);
    expect(boton("nw-mas").disabled).toBe(false);
    boton("nw-mas").click();
    expect(g.ganadoresPedidos()).toBe(2);
  });

  it("sin la traba, todo como siempre", () => {
    expect(g.fijoPorCampana()).toBe(false);
    expect(campo().disabled).toBe(false);
  });
});
