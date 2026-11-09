// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { T } from "../i18n";
import { app } from "../state";
import { abrirHojaDeModo, cambioBloqueado, haceFaltaConfirmar, marcarSellandoAhora, otroModo, pasarAModo, puedeCambiarDeModo } from "./modo-ui";

const h = vi.hoisted(() => ({ cambios: [] as string[] }));

vi.mock("../stellar/config", async (orig) => ({
  ...(await orig<typeof import("../stellar/config")>()),
  hayModoOficial: true,
  changeMode: (r: string) => {
    h.cambios.push(r);
    return true;
  },
}));

describe("la hoja para cambiar de modo", () => {
  it("un sorteo sellado esperando su número bloquea el cambio", () => {
    expect(cambioBloqueado({ names: ["Ana"] }, null)).toBe(true);
    expect(cambioBloqueado({ names: ["Ana"] }, { winners: [0] })).toBe(false);
    expect(cambioBloqueado(null, null)).toBe(false);
  });

  it("la confirmación es solo la primera vez y solo en Oficial", () => {
    expect(haceFaltaConfirmar("mainnet", false)).toBe(true);
    expect(haceFaltaConfirmar("mainnet", true)).toBe(false);
    expect(haceFaltaConfirmar("testnet", false)).toBe(false);
  });

  it("el otro modo es siempre el contrario", () => {
    expect(otroModo("testnet")).toBe("mainnet");
    expect(otroModo("mainnet")).toBe("testnet");
  });
});

describe("la guarda del cambio de modo, en un solo lugar", () => {
  beforeEach(() => {
    h.cambios = [];
    app.frozen = null;
    app.drawn = null;
    marcarSellandoAhora(false);
    document.body.innerHTML = "";
  });

  it("con un sorteo sellado esperando su número no se cambia de modo", () => {
    app.frozen = { names: ["Ana", "Beto"] } as unknown as typeof app.frozen;
    expect(puedeCambiarDeModo()).toBe(false);
    expect(pasarAModo("mainnet")).toBe(false);
    expect(h.cambios).toEqual([]);
  });

  it("mientras se sella tampoco, aunque el sello todavía no haya entrado: la hoja lo dice con el botón apagado", () => {
    marcarSellandoAhora(true);
    expect(puedeCambiarDeModo()).toBe(false);
    expect(pasarAModo("mainnet")).toBe(false);
    expect(h.cambios).toEqual([]);
    abrirHojaDeModo();
    const boton = document.querySelector<HTMLButtonElement>(".modo-card button.solid");
    expect(boton?.disabled).toBe(true);
    expect(document.querySelector(".modo-bloqueo")?.textContent).toBe(T.es.modeSwitchBlocked);
    // Y si el botón se tocara igual (el foco, un lector de pantalla), la guarda no deja pasar.
    boton?.dispatchEvent(new Event("click"));
    expect(h.cambios).toEqual([]);
  });

  it("terminado el sello o ya sorteado, se cambia", () => {
    marcarSellandoAhora(true);
    marcarSellandoAhora(false);
    expect(pasarAModo("mainnet")).toBe(true);
    app.frozen = { names: ["Ana", "Beto"] } as unknown as typeof app.frozen;
    app.drawn = { winners: [0] } as unknown as typeof app.drawn;
    expect(pasarAModo("testnet")).toBe(true);
    expect(h.cambios).toEqual(["mainnet", "testnet"]);
  });
});
