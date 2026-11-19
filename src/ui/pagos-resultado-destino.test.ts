// @vitest-environment jsdom
import { Keypair } from "@stellar/stellar-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../state";
import type { ContextoDePago } from "./pagar-premio";
import { destinoDeLaLista, mostrarPagosDelResultado } from "./pagos-resultado";

const { pagarPremioEn } = vi.hoisted(() => ({ pagarPremioEn: vi.fn((_ctx: unknown) => () => undefined) }));
vi.mock("./pagar-premio", () => ({ pagarPremioEn }));
vi.mock("./wallet-ui", () => ({ currentSession: () => ({ address: "GORG" }) }));

/**
 * La cuenta de quien ganó que paga Pagar premio sale de la lista sellada y sorteada en el momento de pagar: nunca de lo que
 * quedó pintado en la pantalla. Con el sorteo, la lista y los ganadores de mentira.
 */

const cuenta = (): string => Keypair.random().publicKey();
/** La ronda de quicknet que nace ahora (la primera nació el 23 de agosto de 2023 y sale una cada 3 segundos). */
const rondaDeAhora = (): number => Math.floor((Date.now() / 1000 - 1_692_803_367) / 3) + 1;

function sortear(names: string[], winners: number[]): void {
  const sellada = { names, listHash: "ab".repeat(32), ts: 1_793_000_000, at: "", prize: "50 USDC", round: 100, raffleId: 777n };
  app.frozen = sellada as NonNullable<typeof app.frozen>;
  app.drawn = { beacon: { round: rondaDeAhora(), randomness: "cd".repeat(32), signature: "ef".repeat(48) }, winners };
}

beforeEach(() => {
  document.body.innerHTML = '<div id="winner-box"><section class="pagos" id="pagos-box" style="display:none"></section></div>';
  pagarPremioEn.mockClear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("{}", { status: 404 })),
  );
  history.replaceState({}, "", "/");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  app.frozen = null;
  app.drawn = null;
});

describe("la cuenta de quien ganó, releída de la lista sellada", () => {
  it("es la que dice la lista en el puesto de ese ganador", () => {
    const [a, b, c] = [cuenta(), cuenta(), cuenta()] as [string, string, string];
    sortear([a, b, c], [2, 0]);
    expect(destinoDeLaLista("777", 0)).toBe(c);
    expect(destinoDeLaLista("777", 1)).toBe(a);
  });

  it("si en la página hay otro sorteo, no hay cuenta", () => {
    sortear([cuenta()], [0]);
    expect(destinoDeLaLista("778", 0)).toBeNull();
  });

  it("sin sorteo sellado o sin sortear, no hay cuenta", () => {
    expect(destinoDeLaLista("777", 0)).toBeNull();
    sortear([cuenta()], [0]);
    app.drawn = null;
    expect(destinoDeLaLista("777", 0)).toBeNull();
    sortear([cuenta()], [0]);
    delete (app.frozen as { raffleId?: bigint }).raffleId;
    expect(destinoDeLaLista("777", 0)).toBeNull();
  });

  it("un puesto que no existe no tiene cuenta", () => {
    sortear([cuenta(), cuenta()], [1]);
    expect(destinoDeLaLista("777", 1)).toBeNull();
  });

  it("un nombre que no es una cuenta de Stellar no es una cuenta", () => {
    sortear(["Ana Mamani", cuenta()], [0, 1]);
    expect(destinoDeLaLista("777", 0)).toBeNull();
    expect(destinoDeLaLista("777", 1)).not.toBeNull();
  });
});

describe("lo que recibe Pagar premio al armar el panel", () => {
  it("con la cuenta abierta, le pasa cómo releer la lista, y lo que contesta es lo que hay en la lista en ese momento", () => {
    vi.stubEnv("VITE_PAGOS", "1");
    const [a, b] = [cuenta(), cuenta()] as [string, string];
    sortear([a, b], [1, 0]);
    mostrarPagosDelResultado();
    expect(pagarPremioEn).toHaveBeenCalledTimes(1);
    const ctx = pagarPremioEn.mock.calls[0]?.[0] as ContextoDePago;
    expect(ctx.raffleId).toBe("777");
    expect(ctx.destinoDe?.(0)).toBe(b);
    // La lista cambia después de armar el panel: se lee lo de ahora, no lo de cuando se pintó.
    const otra = cuenta();
    (app.frozen as { names: string[] }).names = [a, otra];
    expect(ctx.destinoDe?.(0)).toBe(otra);
    // Y si el sorteo de la página es otro, ya no hay con qué pagar.
    (app.frozen as { raffleId?: bigint }).raffleId = 999n;
    expect(ctx.destinoDe?.(0)).toBeNull();
  });
});
