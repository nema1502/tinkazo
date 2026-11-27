// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { lineaDePrueba } from "../campana/cuentas-de-prueba";
import { setLang } from "../i18n";
import { app } from "../state";
import { mostrarPagosDelResultado } from "./pagos-resultado";

/**
 * El panel de pagos nunca se monta cuando quienes ganaron son líneas de persona: con la bandera de pagos prendida, una
 * cuenta que paga configurada y un sorteo anclado, igual no hay filas, ni botón de pagar, ni un solo pedido a la red.
 * Hoy lo impide una sola condición (`hayCuentas`): esta prueba la fija.
 */

const rondaDeAhora = (): number => Math.floor((Date.now() / 1000 - 1_692_803_367) / 3) + 1;

function sortear(names: string[], winners: number[]): void {
  app.frozen = { names, listHash: "ab".repeat(32), ts: 1_793_000_000, at: "", prize: "Auriculares", round: 100, raffleId: 777n } as NonNullable<typeof app.frozen>;
  app.drawn = { beacon: { round: rondaDeAhora(), randomness: "cd".repeat(32), signature: "ef".repeat(48) }, winners };
}

let pedidos: string[];

beforeEach(() => {
  document.body.innerHTML = '<div id="winner-box"><section class="pagos" id="pagos-box" style="display:none"></section></div>';
  setLang("es");
  pedidos = [];
  vi.stubEnv("VITE_PAGOS", "1");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL | Request) => {
      pedidos.push(String(url));
      return new Response("{}", { status: 404 });
    }),
  );
  history.replaceState({}, "", "/");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  app.frozen = null;
  app.drawn = null;
});

describe("el panel de pagos con una lista de personas", () => {
  it("con la bandera prendida y ganadoras que son líneas de persona, no se monta ni pide nada", () => {
    const lineas = [1, 2, 3].map(lineaDePrueba);
    sortear(lineas, [0, 1, 2]);
    mostrarPagosDelResultado();
    const caja = document.getElementById("pagos-box") as HTMLElement;
    expect(caja.style.display).toBe("none");
    expect(caja.childElementCount).toBe(0);
    expect(document.querySelector("[data-pagos]")).toBeNull();
    expect(pedidos).toEqual([]);
  });
});
