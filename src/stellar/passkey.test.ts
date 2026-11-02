import { describe, expect, it } from "vitest";
import { aBase64url, deBase64url, rpIdDe } from "./passkey";

describe("base64url de la ceremonia del desbloqueo", () => {
  it("ida y vuelta, con todos los bytes", () => {
    const todos = Uint8Array.from({ length: 256 }, (_, i) => i);
    expect([...deBase64url(aBase64url(todos))]).toEqual([...todos]);
  });

  it("sin relleno y con - y _ en vez de + y /", () => {
    const texto = aBase64url(Uint8Array.from([251, 255, 254]));
    expect(texto).toBe("-__-");
    expect(texto).not.toMatch(/[+/=]/);
  });

  it("acepta el texto con o sin relleno de longitud", () => {
    expect([...deBase64url("AQID")]).toEqual([1, 2, 3]);
    expect([...deBase64url("AQI")]).toEqual([1, 2]);
  });
});

describe("el dominio de la llave de acceso", () => {
  it.each([
    ["tinkazo.app", "tinkazo.app"],
    ["www.tinkazo.app", "tinkazo.app"],
    ["sorteos.tinkazo.app", "tinkazo.app"],
    ["tinkazo.vercel.app", "tinkazo.vercel.app"],
    ["localhost", "localhost"],
    ["notinkazo.app", "notinkazo.app"],
    ["tinkazo.app.evil.com", "tinkazo.app.evil.com"],
  ])("%s usa %s", (host, esperado) => {
    expect(rpIdDe(host)).toBe(esperado);
  });
});
