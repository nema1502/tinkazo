import { describe, expect, it } from "vitest";
import { T } from "../i18n";
import { network } from "../stellar/config";
import { type Entry, falteGrabar } from "./history";

/**
 * Mis sorteos con un sorteo que la sala ya vio y que no se llegó a guardar (se cerró la pestaña durante la grabación):
 * ofrece Guardarlo ahora, solo cuando de verdad falta y se puede hacer desde acá.
 */
const entrada = (over: Partial<Entry>): Entry => ({
  organizer: "GAAA",
  listHash: "aa",
  count: 10,
  numWinners: 1,
  round: 100,
  sealedAt: 1_000,
  prize: "",
  id: "7",
  winners: ["Ana"],
  porGrabar: true,
  ...over,
});

describe("un sorteo jugado que falta guardar", () => {
  it("se ofrece guardar cuando ya tiene ganador, número de sorteo y no quedó grabado", () => {
    expect(falteGrabar(entrada({}))).toBe(true);
    expect(falteGrabar(entrada({ contract: network.contractId ?? "" }))).toBe(true);
  });

  it("no se ofrece si ya quedó grabado, si nunca se jugó, sin sello o en otro contrato", () => {
    expect(falteGrabar(entrada({ porGrabar: false }))).toBe(false);
    expect(falteGrabar(entrada({ drawTx: "cd".repeat(32) }))).toBe(false);
    expect(falteGrabar(entrada({ winners: undefined }))).toBe(false);
    expect(falteGrabar(entrada({ id: undefined }))).toBe(false);
    expect(falteGrabar(entrada({ contract: "COTRO" }))).toBe(false);
  });

  it("los textos están en los dos idiomas, sin palabras técnicas", () => {
    for (const k of ["pendienteGrabarBtn", "histStateSinGuardar", "grabNoSePudo", "grabGuardando", "grabGuardado", "grabReintentar", "grabNoCoincide"] as const) {
      for (const L of [T.es, T.en]) {
        const s = String((L as Record<string, unknown>)[k]);
        expect(s.length).toBeGreaterThan(3);
        expect(s).not.toMatch(/[;«»]|\b(token|hash|transacci|firma|ledger|drand|XLM|ronda|cadena|blockchain|signature|transaction)\b/i);
      }
    }
  });
});
