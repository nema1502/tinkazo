// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

// Sin red y sin carga de monedas: el panel abre con lo que le pasa la prueba.
vi.mock("../stellar/carga", () => ({
  contextoHorizon: () => undefined,
  revisarCarga: vi.fn(async () => ({ estado: "nada" })),
}));

import { ponerEtiquetas } from "../equipos/etiquetas";
import { openAccount, closeAccount } from "./account";
import { shortAddr } from "./account-model";

/**
 * El panel «Mis sorteos» muestra el nombre del equipo en vez de la cuenta, cuando este navegador lo conoce
 * (la lista viene de los equipos con cupón y sus etiquetas están cargadas). Sin etiquetas, la cuenta cortada de siempre.
 */

const CUENTA = "GAAA1111111111111111111111111111111111111111111111111111111111";

const vista = () => ({
  address: CUENTA,
  label: "stellar",
  balance: 10,
  onDisconnect: () => {},
  onFund: () => {},
});

afterEach(() => {
  closeAccount();
  // Las etiquetas son estado global del módulo: sin esto, una prueba contamina a la siguiente.
  ponerEtiquetas(new Map());
});

describe("el panel de la cuenta y el nombre del equipo", () => {
  it("sin etiquetas muestra la cuenta cortada de siempre", () => {
    openAccount(vista());
    expect(document.querySelector(".acct-short")?.textContent).toBe(shortAddr(CUENTA));
  });

  it("con etiquetas muestra el nombre del equipo en vez de la cuenta", () => {
    ponerEtiquetas(new Map([[CUENTA, "Los Cóndores"]]));
    openAccount(vista());
    expect(document.querySelector(".acct-short")?.textContent).toBe("Los Cóndores");
    expect(document.querySelector(".acct-short")?.textContent).not.toContain("GAAA");
  });

  it("el nombre del equipo es de este navegador: la copia sigue llevando la cuenta entera", () => {
    ponerEtiquetas(new Map([[CUENTA, "Los Cóndores"]]));
    openAccount(vista());
    const corta = document.querySelector(".acct-short");
    expect(corta?.getAttribute("title")).toBe(CUENTA);
  });
});
