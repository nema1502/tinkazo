import { describe, expect, it } from "vitest";
import { T } from "../i18n";
import { errorDeCodigo } from "./ingreso-errores";

describe("errores de ingreso: evidencia antes de atribuir una causa", () => {
  it("conserva código inválido y vencido sin inventar otra causa", () => {
    expect(errorDeCodigo(new Error("EMAIL_CODE_INVALID"), "verificar")).toBe(T.es.loginBadCode);
    expect(errorDeCodigo(new Error("EMAIL_CODE_EXPIRED"), "verificar")).toBe(T.es.loginExpired);
  });
  // El proveedor llama de dos maneras al código equivocado: `EMAIL_CODE_INVALID` en su estado de error y
  // `INVALID_EMAIL_CODE` (o `SDK_EMAIL_CODE_INVALID`) en lo que contesta su servicio. Con el servicio de ingreso, un
  // código equivocado llegó como `INVALID_EMAIL_CODE` y la persona vio «no pudimos entrar» en vez de «ese código no es».
  it.each(["EMAIL_CODE_INVALID", "INVALID_EMAIL_CODE", "SDK_EMAIL_CODE_INVALID"])("un código equivocado se reconoce con el nombre %s", (nombre) => {
    expect(errorDeCodigo(new Error(nombre), "verificar")).toBe(T.es.loginBadCode);
    // El nombre también puede venir en `code` del error, con otro texto en `message`.
    expect(errorDeCodigo(Object.assign(new Error("no se pudo verificar"), { code: nombre }), "verificar")).toBe(T.es.loginBadCode);
  });
  it.each(["EMAIL_CODE_EXPIRED", "SDK_EMAIL_CODE_EXPIRED"])("un código vencido se reconoce con el nombre %s", (nombre) => {
    expect(errorDeCodigo(new Error(nombre), "verificar")).toBe(T.es.loginExpired);
    expect(errorDeCodigo(Object.assign(new Error("no se pudo verificar"), { code: nombre }), "verificar")).toBe(T.es.loginExpired);
  });
  it("los nombres que da el paquete del proveedor se reconocen: si los cambia, esta prueba avisa", async () => {
    const { AUTH_ERROR_CODES } = await import("@pollar/core");
    expect(errorDeCodigo(new Error(AUTH_ERROR_CODES.EMAIL_CODE_INVALID), "verificar")).toBe(T.es.loginBadCode);
    expect(errorDeCodigo(new Error(AUTH_ERROR_CODES.EMAIL_CODE_EXPIRED), "verificar")).toBe(T.es.loginExpired);
    // El resto de sus fallas de entrada no culpa al código.
    expect(errorDeCodigo(new Error(AUTH_ERROR_CODES.EMAIL_VERIFY_FAILED), "verificar")).toBe(T.es.loginFailed);
  });
  it.each(["EXPIRED_EMAIL_CODE", "EMAIL_VERIFY_FAILED", "email_code_invalid", "INVALID_EMAIL_CODE otra vez", "INVALID_FLOW"])(
    "lo que el proveedor no define, o no es exactamente un nombre suyo, no culpa al código: %s",
    (nombre) => {
      expect(errorDeCodigo(new Error(nombre), "verificar")).toBe(T.es.loginFailed);
      expect(errorDeCodigo(Object.assign(new Error("boom"), { code: nombre }), "verificar")).toBe(T.es.loginFailed);
    },
  );
  it("al pedir el código no se culpa al código que todavía no hay, ni siquiera con su nombre", () => {
    expect(errorDeCodigo(new Error("INVALID_EMAIL_CODE"), "enviar")).toBe(T.es.loginSendFailed);
    expect(errorDeCodigo(new Error("EMAIL_CODE_EXPIRED"), "enviar")).toBe(T.es.loginSendFailed);
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
    for (const k of ["loginAbrirFallo", "loginOtraVia", "loginSendFailed", "loginFailed", "drawPreparar", "drawConsultar", "drawAusente", "drawSinConfirmar"]) {
      expect(typeof T[lang][k]).toBe("string");
      expect(T[lang][k]).not.toMatch(/mailto:|Revisá el correo|Check the address/);
    }
  });
});
