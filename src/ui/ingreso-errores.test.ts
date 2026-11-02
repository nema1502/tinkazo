import { describe, expect, it } from "vitest";
import { T } from "../i18n";
import { errorDeCodigo } from "./ingreso-errores";

describe("errores de ingreso: evidencia antes de atribuir una causa", () => {
  it("conserva código inválido y vencido sin inventar otra causa", () => {
    expect(errorDeCodigo(new Error("EMAIL_CODE_INVALID"), "verificar")).toBe(T.es.loginBadCode);
    expect(errorDeCodigo(new Error("EMAIL_CODE_EXPIRED"), "verificar")).toBe(T.es.loginExpired);
  });
  it.each([new Error("boom"), {}, null, "rechazo"])("un fallo desconocido ofrece reintento y otra vía: %s", (e) => {
    expect(errorDeCodigo(e, "enviar")).toBe(T.es.loginSendFailed);
    expect(errorDeCodigo(e, "verificar")).toBe(T.es.loginFailed);
  });
  it("solo un error de red reconocido habla de conexión", () => {
    expect(errorDeCodigo(new TypeError("Failed to fetch"), "enviar")).toBe(T.es.loginConexion);
    expect(errorDeCodigo(new TypeError("Load failed"), "verificar")).toBe(T.es.loginConexion);
  });
  it.each(["es", "en"] as const)("las dos vías neutrales están traducidas: %s", (lang) => {
    for (const k of ["loginAbrirFallo", "loginOtraVia", "loginReintentar", "loginSendFailed", "loginFailed", "drawPreparar", "drawConsultar", "drawAusente", "drawSinConfirmar"]) {
      expect(typeof T[lang][k]).toBe("string");
      expect(T[lang][k]).not.toMatch(/mailto:|Revisá el correo|Check the address/);
    }
  });
});
