// @vitest-environment jsdom
import { Keypair } from "@stellar/stellar-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Lo que la herramienta le cuenta a la sala de la campaña (el sello y el resultado) sale con el token guardado solo si la
 * cuenta dueña de la campaña está conectada: otra cuenta en esta compu no mueve la sala, y una memoria de antes (sin la cuenta
 * guardada) espera a que el panel la complete con la sesión.
 */

import { pasoDelPuente, ponerPaso } from "../campana/puente";
import { guardarSorteoDeCampana } from "../campana/en-curso";
import { type MemoriaDeOrg, guardarOrg, leerOrg } from "../sala/campana-org";
import { network } from "../stellar/config";
import { type WalletAdapter, setActiveWallet } from "../stellar/wallet-lite";
import { depsDelResultadoReales } from "./campana-resultado-real";
import { retomarAlArrancar } from "./campana-resultado";

const A = Keypair.random().publicKey();
const B = Keypair.random().publicKey();
const TOKEN = "T".repeat(22);

const conCuenta = (cuenta: string | null): void =>
  setActiveWallet(cuenta === null ? null : ({ kind: "guest", label: "prueba", address: cuenta } as unknown as WalletAdapter));

function ponerSala(cuenta: string | null | undefined, fase: MemoriaDeOrg["fase"] = "cerrada"): void {
  const memoria: MemoriaDeOrg = {
    sala: {
      id: "AbCd1234",
      token: TOKEN,
      clave: "C".repeat(22),
      vence: Date.now() + 3_600_000,
      servicio: "https://s.tinkazo.app",
      evento: "evento-uno",
      red: network.name,
    },
    fase,
  };
  if (cuenta !== undefined) memoria.cuenta = cuenta;
  guardarOrg(localStorage, memoria);
}

beforeEach(() => {
  localStorage.clear();
  ponerPaso({ paso: "nada" });
});
afterEach(() => {
  conCuenta(null);
  vi.unstubAllGlobals();
});

describe("la sala que la herramienta mueve con el token guardado", () => {
  it("con la cuenta dueña conectada se mueve", () => {
    ponerSala(A);
    conCuenta(A);
    const d = depsDelResultadoReales();
    expect(d.sala()?.token).toBe(TOKEN);
    expect(d.faseDeLaSala()).toBe("cerrada");
  });

  it("con otra cuenta conectada no hay sala que mover, y la memoria sigue guardada", () => {
    ponerSala(A);
    conCuenta(B);
    const d = depsDelResultadoReales();
    expect(d.sala()).toBeNull();
    expect(d.faseDeLaSala()).toBeNull();
    d.fijarFase("sellada");
    expect(leerOrg(localStorage, Date.now(), network.name, A)?.fase).toBe("cerrada");
  });

  it("sin sesión tampoco: sin la cuenta dueña conectada no sale nada", () => {
    ponerSala(A);
    conCuenta(null);
    expect(depsDelResultadoReales().sala()).toBeNull();
  });

  it("una campaña que no nombra a nadie queda a cargo de quien tenga el token", () => {
    ponerSala(null);
    conCuenta(B);
    expect(depsDelResultadoReales().sala()?.token).toBe(TOKEN);
  });

  it("una memoria de antes, sin cuenta guardada, espera a que el panel la complete", () => {
    ponerSala(undefined);
    conCuenta(A);
    expect(depsDelResultadoReales().sala()).toBeNull();
    ponerSala(A);
    expect(depsDelResultadoReales().sala()).not.toBeNull();
  });

  it("fijar la fase de la dueña la guarda", () => {
    ponerSala(A);
    conCuenta(A);
    depsDelResultadoReales().fijarFase("sellada");
    expect(leerOrg(localStorage, Date.now(), network.name, A)?.fase).toBe("sellada");
  });
});

describe("retomar lo que quedó a medias", () => {
  const pendiente = (organizadora: string): void =>
    guardarSorteoDeCampana({
      evento: "evento-uno",
      red: network.name,
      contrato: network.contractId ?? "",
      huella: "ab".repeat(32),
      premios: 1,
      organizadora,
      pasadaEn: Date.now() - 60_000,
      sorteo: "7",
      ronda: Math.floor(Date.now() / 3_000) + 10_000,
      mandados: ["7"],
      aviso: "pendiente",
    });

  it("con otra cuenta conectada no manda ningún aviso a la sala ni toca el paso", () => {
    const f = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", f);
    ponerSala(A);
    pendiente(A);
    conCuenta(B);
    retomarAlArrancar(depsDelResultadoReales());
    expect(f).not.toHaveBeenCalled();
    expect(pasoDelPuente().paso).toBe("nada");
  });

  it("con la dueña conectada retoma el aviso", () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })));
    ponerSala(A);
    pendiente(A);
    conCuenta(A);
    retomarAlArrancar(depsDelResultadoReales());
    expect(pasoDelPuente().paso).toBe("avisando");
  });
});
