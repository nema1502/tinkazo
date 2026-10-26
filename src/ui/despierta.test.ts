import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * La pantalla no se apaga mientras se sortea (despierta.ts). No hay página: se
 * le pone un `navigator.wakeLock` y un `document` de mentira y se mira cuántas
 * veces se pidió y se soltó.
 */
describe("el bloqueo de pantalla, con motivos", () => {
  let pedidos = 0;
  let soltados = 0;
  let visible = "visible";
  const escuchas = new Map<string, () => void>();

  beforeEach(() => {
    vi.resetModules();
    pedidos = 0;
    soltados = 0;
    visible = "visible";
    escuchas.clear();
    vi.stubGlobal("navigator", {
      wakeLock: {
        request: async () => {
          pedidos++;
          return { release: async () => void soltados++, addEventListener: () => undefined };
        },
      },
    });
    vi.stubGlobal("document", {
      get visibilityState() {
        return visible;
      },
      addEventListener: (ev: string, fn: () => void) => escuchas.set(ev, fn),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  const esperar = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

  it("se pide una vez aunque haya dos motivos, y se suelta cuando se sueltan los dos", async () => {
    const { mantenerDespierta, soltarDespierta, despiertaPedida } = await import("./despierta");
    mantenerDespierta("sorteo");
    mantenerDespierta("estadio");
    await esperar();
    expect(pedidos).toBe(1);
    soltarDespierta("estadio");
    await esperar();
    expect(soltados).toBe(0);
    expect(despiertaPedida()).toBe(true);
    soltarDespierta("sorteo");
    await esperar();
    expect(soltados).toBe(1);
    expect(despiertaPedida()).toBe(false);
  });

  it("al volver a la página (otra app, el celular desbloqueado) se pide de nuevo", async () => {
    const { mantenerDespierta } = await import("./despierta");
    mantenerDespierta("sorteo");
    await esperar();
    expect(pedidos).toBe(1);
    visible = "hidden";
    escuchas.get("visibilitychange")?.();
    visible = "visible";
    escuchas.get("visibilitychange")?.();
    await esperar();
    expect(pedidos).toBe(2);
  });

  it("sin la API no pasa nada", async () => {
    vi.stubGlobal("navigator", {});
    const { mantenerDespierta, soltarDespierta } = await import("./despierta");
    expect(() => {
      mantenerDespierta("sorteo");
      soltarDespierta("sorteo");
    }).not.toThrow();
  });
});
