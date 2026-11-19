import { describe, expect, it } from "vitest";
import type { SorteoDeCampana } from "../campana/en-curso";
import { roundTime } from "../protocol/quicknet";
import { pasoDelSelloPorConfirmar } from "./campana-resultado";

/**
 * Recargar entre mandar el sello y que la red lo confirme deja el sello en la red sin número en la entrada. Solo se recupera
 * tocando Sellar la lista: el panel da esa sola acción mientras la ronda del intento no salió, y después dice que no se llegó.
 */

const RONDA = 30_000_000;
const SALE = roundTime(RONDA) * 1000;
const entrada: SorteoDeCampana = {
  evento: "evento-uno",
  red: "testnet",
  contrato: "C",
  huella: "abc",
  premios: 2,
  organizadora: null,
  pasadaEn: 1,
};
const base = { huellaDelCuadro: "abc", entrada, fase: "cerrada" as const, intento: { round: RONDA }, ahora: SALE - 40_000 };

describe("el sello por confirmar después de recargar", () => {
  it("con la lista de la entrada en el cuadro y un intento guardado, da una sola acción: sellar ya", () => {
    expect(pasoDelSelloPorConfirmar(base)).toEqual({ paso: "sello-por-confirmar" });
  });

  it("pasada la ronda de ese intento, dice que no se llegó", () => {
    expect(pasoDelSelloPorConfirmar({ ...base, ahora: SALE + 1_000 })).toEqual({ paso: "tarde" });
  });

  it("sin un intento guardado no dice nada", () => {
    expect(pasoDelSelloPorConfirmar({ ...base, intento: null })).toBeNull();
  });

  it("con otra lista en el cuadro no dice nada", () => {
    expect(pasoDelSelloPorConfirmar({ ...base, huellaDelCuadro: "otra" })).toBeNull();
  });

  it("con la entrada ya con sorteo o sin huella no dice nada", () => {
    expect(pasoDelSelloPorConfirmar({ ...base, entrada: { ...entrada, sorteo: "5" } })).toBeNull();
    expect(pasoDelSelloPorConfirmar({ ...base, entrada: { ...entrada, huella: "" }, huellaDelCuadro: "" })).toBeNull();
    expect(pasoDelSelloPorConfirmar({ ...base, entrada: null })).toBeNull();
  });

  it("con la sala fuera de cerrada no dice nada", () => {
    expect(pasoDelSelloPorConfirmar({ ...base, fase: "sellada" })).toBeNull();
    expect(pasoDelSelloPorConfirmar({ ...base, fase: null })).toBeNull();
  });
});
