import { describe, expect, it } from "vitest";
import { ErrorDeEntrada } from "./error-de-entrada";
import { motivoDeLaLlave } from "./motivo-llave";

const suelto = (name: string): Error => Object.assign(new Error(name), { name });
const envuelto = (name: string): Error => Object.assign(new Error("fallo la llave"), { name: "WebAuthnError", cause: suelto(name) });

describe("el motivo de una llave que no salió", () => {
  it("un NotAllowedError con foco es una cancelación, suelto o envuelto", () => {
    expect(motivoDeLaLlave(suelto("NotAllowedError"), true)).toBe("cancelada");
    expect(motivoDeLaLlave(envuelto("NotAllowedError"), true)).toBe("cancelada");
  });

  it("el mismo error sin el foco de la página es sin-foco, no una cancelación", () => {
    expect(motivoDeLaLlave(suelto("NotAllowedError"), false)).toBe("sin-foco");
    expect(motivoDeLaLlave(envuelto("NotAllowedError"), false)).toBe("sin-foco");
  });

  it("NotSupportedError es que no soporta y SecurityError es el dominio", () => {
    expect(motivoDeLaLlave(suelto("NotSupportedError"), true)).toBe("no-soporta");
    expect(motivoDeLaLlave(envuelto("SecurityError"), true)).toBe("dominio");
  });

  it("lo demás, y lo que no es un error, es otro", () => {
    expect(motivoDeLaLlave(new Error("x"), true)).toBe("otro");
    expect(motivoDeLaLlave("texto", true)).toBe("otro");
    expect(motivoDeLaLlave(null, false)).toBe("otro");
    expect(motivoDeLaLlave(undefined, true)).toBe("otro");
  });

  it("un error de entrada de la prueba da su motivo antes que cualquier otra lectura", () => {
    expect(motivoDeLaLlave(new ErrorDeEntrada("sin-cuenta"), true)).toBe("sin-cuenta");
    expect(motivoDeLaLlave(new ErrorDeEntrada("firmantes", "politicas"), false)).toBe("firmantes");
    expect(motivoDeLaLlave(new ErrorDeEntrada("vencida"), true)).toBe("vencida");
  });
});
