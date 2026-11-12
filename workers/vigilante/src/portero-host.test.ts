// La clave de operar solo viaja a un host de tinkazo.app, y el pedido que la lleva no sigue redirecciones: una
// redirección es una falla. Así un PORTERO_URL cambiado por error, o una respuesta que manda a otro lado, no la entregan.
import { describe, expect, it } from "vitest";
import { urlDelPortero } from "./config";
import { CLAVE_DE_OPERAR, PORTERO, mundoFalso } from "./mundo-falso";

describe("urlDelPortero: solo hosts de tinkazo.app", () => {
  it("acepta el portero de mainnet y los otros servicios del dominio", () => {
    expect(urlDelPortero("https://pm.tinkazo.app")).toBe("https://pm.tinkazo.app");
    expect(urlDelPortero("https://pm.tinkazo.app//")).toBe("https://pm.tinkazo.app");
    expect(urlDelPortero("https://p.tinkazo.app")).toBe("https://p.tinkazo.app");
    expect(urlDelPortero("https://PM.Tinkazo.App")).toBe("https://pm.tinkazo.app");
  });

  it("rechaza cualquier otro host y vuelve al de siempre", () => {
    for (const ajeno of [
      "https://otro.example.org",
      "https://tinkazo.app",
      "https://evil-tinkazo.app",
      "https://pm.tinkazo.app.evil.example",
      "https://tinkazo.app.evil.example",
      "https://eviltinkazo.app",
      "https://pm.tinkazo.com",
      "https://127.0.0.1",
      "https://localhost",
    ]) {
      expect(urlDelPortero(ajeno), ajeno).toBe(PORTERO);
    }
  });

  it("rechaza un puerto que no sea el de https", () => {
    expect(urlDelPortero("https://pm.tinkazo.app:8443")).toBe(PORTERO);
    expect(urlDelPortero("https://pm.tinkazo.app:443")).toBe("https://pm.tinkazo.app");
  });

  it("rechaza el usuario y la clave pegados, aunque el host sea bueno", () => {
    expect(urlDelPortero("https://usuario:clave@pm.tinkazo.app")).toBe(PORTERO);
    expect(urlDelPortero("https://pm.tinkazo.app@evil.example")).toBe(PORTERO);
  });
});

describe("el pedido que lleva la clave", () => {
  it("con un PORTERO_URL de otro host, la clave no sale: se le pregunta al portero de siempre", async () => {
    const m = mundoFalso({ env: { PORTERO_URL: "https://otro.example.org" } });
    await m.vuelta();
    expect(m.portero.llamadas).toHaveLength(1);
    expect(m.portero.llamadas[0]!.url).toBe(`${PORTERO}/v1/patrocinio/estado`);
  });

  it("no sigue redirecciones: el pedido pide el modo manual", async () => {
    const m = mundoFalso();
    const modos: unknown[] = [];
    const base = m.dep.fetch;
    m.dep.fetch = (async (entrada: string | URL | Request, init?: RequestInit) => {
      if (String(entrada).startsWith(PORTERO)) modos.push(init?.redirect);
      return base(entrada, init);
    }) as typeof fetch;
    await m.vuelta();
    expect(modos).toEqual(["manual"]);
  });

  it("una redirección es una falla: no avisa a la primera, avisa a la segunda y lo anota", async () => {
    for (const estado of [301, 302, 307, 308]) {
      const m = mundoFalso();
      m.portero.falla = estado;
      const r = await m.vuelta();
      expect(r.salioBien, String(estado)).toBe(false);
      expect(m.correo.enviados, String(estado)).toEqual([]);
      await m.vueltaEn(10);
      expect(m.correo.enviados, String(estado)).toHaveLength(1);
      expect(m.correo.enviados[0]!.subject, String(estado)).toMatch(/portero no contesta/i);
      expect(m.registro.join("\n"), String(estado)).toContain('"motivo":"redireccion"');
    }
  });

  it("la clave no queda en el registro cuando el portero redirige", async () => {
    const m = mundoFalso();
    m.portero.falla = 302;
    await m.vuelta();
    await m.vueltaEn(10);
    expect(m.registro.join("\n")).not.toContain(CLAVE_DE_OPERAR);
  });
});
