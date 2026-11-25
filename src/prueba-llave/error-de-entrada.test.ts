import { describe, expect, it } from "vitest";
import { clasificarErrorDelKit, ErrorDeEntrada } from "./error-de-entrada";

const delKit = (code: number, reason?: string): Error => Object.assign(new Error("del kit"), { name: "SmartAccountError", code, context: reason ? { reason } : {} });

describe("la clasificación de los errores del kit", () => {
  it("un error de la prueba vuelve igual", () => {
    const e = new ErrorDeEntrada("vencida");
    expect(clasificarErrorDelKit(e)).toBe(e);
  });

  it("2005 con transaction_not_found es de red: lo que se acababa de encontrar todavía no se ve", () => {
    const r = clasificarErrorDelKit(delKit(2005, "transaction_not_found")) as ErrorDeEntrada;
    expect(r).toBeInstanceOf(ErrorDeEntrada);
    expect(r.motivo).toBe("red");
  });

  it("2005 con otra razón y sin razón, 2004, 2006 y 2007 se rechazan", () => {
    for (const e of [delKit(2005, "deployer_mismatch"), delKit(2005), delKit(2004), delKit(2006), delKit(2007)]) {
      expect((clasificarErrorDelKit(e) as ErrorDeEntrada).motivo).toBe("rechazada");
    }
  });

  it("el error común de que no hay contrato es de red", () => {
    const r = clasificarErrorDelKit(new Error("Smart account contract not found on-chain for credential abc.")) as ErrorDeEntrada;
    expect(r.motivo).toBe("red");
  });

  it("lo que no es del kit vuelve igual: el rechazo del navegador se sigue reconociendo", () => {
    const cancelada = Object.assign(new Error("no"), { name: "NotAllowedError" });
    expect(clasificarErrorDelKit(cancelada)).toBe(cancelada);
    expect(clasificarErrorDelKit("texto")).toBe("texto");
    expect(clasificarErrorDelKit(null)).toBeNull();
    const otro = delKit(9001);
    expect(clasificarErrorDelKit(otro)).toBe(otro);
  });
});
