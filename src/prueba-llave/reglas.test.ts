import { describe, expect, it } from "vitest";
import { revisarReglas } from "./reglas";

const regla = (cambios: Record<string, unknown> = {}): Record<string, unknown> => ({ signers: [{ External: ["verificador", "clave"] }], policies: [], valid_until: undefined, ...cambios });

describe("la revisión de las reglas de la cuenta", () => {
  it("da bien con una regla, un firmante, ninguna política y sin vencimiento", () => {
    expect(revisarReglas(1, regla())).toEqual({ ok: true });
    expect(revisarReglas(1, regla({ valid_until: null }))).toEqual({ ok: true });
    expect(revisarReglas(1n, regla())).toEqual({ ok: true });
  });

  it("con más de una regla creada alguna vez, no", () => {
    expect(revisarReglas(2, regla())).toEqual({ ok: false, motivo: "otra-regla" });
    expect(revisarReglas(0, regla())).toEqual({ ok: false, motivo: "otra-regla" });
    expect(revisarReglas(undefined, regla())).toEqual({ ok: false, motivo: "otra-regla" });
  });

  it("con un firmante de más, no", () => {
    expect(revisarReglas(1, regla({ signers: [{}, {}] }))).toEqual({ ok: false, motivo: "firmante-de-mas" });
  });

  it("sin firmante, no", () => {
    expect(revisarReglas(1, regla({ signers: [] }))).toEqual({ ok: false, motivo: "sin-firmante" });
  });

  it("con una política, no", () => {
    expect(revisarReglas(1, regla({ policies: ["limite"] }))).toEqual({ ok: false, motivo: "politicas" });
  });

  it("con vencimiento, no", () => {
    expect(revisarReglas(1, regla({ valid_until: 123 }))).toEqual({ ok: false, motivo: "vencida" });
  });

  it("una regla que no se puede leer no pasa", () => {
    expect(revisarReglas(1, null)).toEqual({ ok: false, motivo: "ilegible" });
    expect(revisarReglas(1, { signers: [{}] })).toEqual({ ok: false, motivo: "ilegible" });
    expect(revisarReglas(1, "regla")).toEqual({ ok: false, motivo: "ilegible" });
  });
});
