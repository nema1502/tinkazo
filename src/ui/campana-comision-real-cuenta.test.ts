import { describe, expect, it, vi } from "vitest";

/**
 * La compuerta de la cuenta antes de pagar el servicio, en la red principal: lo que el cobro le pasa a la compuerta del paso.
 * Mientras se revisa la cuenta en la red, el panel tiene que enterarse, para apagar el botón y decirlo como al sellar.
 */

const h = vi.hoisted(() => ({
  para: null as string | null,
  abre: false,
}));

vi.mock("../stellar/config", async (original) => {
  const o = await original<typeof import("../stellar/config")>();
  return { ...o, network: { ...o.network, name: "mainnet" } };
});
vi.mock("./cuenta-lista-flujo", () => ({
  cuentaListaParaGrabar: async (para: string, o: { alRevisar?: (revisando: boolean) => void; alAbrir?: () => void }) => {
    h.para = para;
    o.alRevisar?.(true);
    o.alRevisar?.(false);
    if (h.abre) o.alAbrir?.();
    return true;
  },
}));

import { depsDeComisionReales } from "./campana-comision-real";

describe("la cuenta lista antes de pagar, en la red principal", () => {
  it("le pasa a la compuerta del pago el aviso de que está revisando", async () => {
    h.abre = false;
    const vistos: boolean[] = [];
    expect(await depsDeComisionReales().cuentaLista?.((r) => void vistos.push(r))).toBe("lista");
    expect(h.para).toBe("pago");
    expect(vistos).toEqual([true, false]);
  });

  it("si el paso se abrió, dice paso", async () => {
    h.abre = true;
    expect(await depsDeComisionReales().cuentaLista?.()).toBe("paso");
  });
});
