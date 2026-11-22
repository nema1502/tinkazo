// @vitest-environment jsdom
import { Keypair } from "@stellar/stellar-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Usar en esta compu con el sorteo ya hecho en otra: la compu que toma la campaña arma lo que recuerda del sorteo con el
 * resultado público de la sala (el número, las ganadoras y el comprobante) y el paso de las ganadoras anda como en la compu
 * donde se sorteó. Con la entrada real, la memoria real y una sala de mentira que solo publica el resultado.
 */

import { entradaDeUnSorteoRecuperado, entradaDelEvento, leerSorteosDeCampana } from "../campana/en-curso";
import { accionesDelPuente, pasoDelPuente, reiniciarElPuente } from "../campana/puente";
import { type MemoriaDeOrg, guardarOrg } from "../sala/campana-org";
import { network } from "../stellar/config";
import { type WalletAdapter, setActiveWallet } from "../stellar/wallet-lite";
import { retomarAlArrancar, registrarLasAcciones } from "./campana-resultado";
import { depsDelResultadoReales } from "./campana-resultado-real";
import { depsDeTusReales } from "./campana-tus-real";

const A = Keypair.random().publicKey();
const GANA_1 = Keypair.random().publicKey();
const GANA_2 = Keypair.random().publicKey();
const COMPROBANTE = "/verificar.html?c=CCONTRATO&s=42#x";
const SALA = {
  id: "AbCd1234",
  token: "T".repeat(22),
  clave: "C".repeat(22),
  vence: Date.now() + 3_600_000,
  servicio: "https://s.tinkazo.app",
  evento: "evento-uno",
  red: network.name,
};
const memoria: MemoriaDeOrg = { sala: SALA, fase: "sorteada", cuenta: A, recuperada: true };

const suelta = async (veces = 6): Promise<void> => {
  for (let i = 0; i < veces; i++) await new Promise<void>((r) => setTimeout(r, 0));
};

beforeEach(() => {
  localStorage.clear();
  reiniciarElPuente();
  setActiveWallet({ kind: "guest", label: "prueba", address: A } as unknown as WalletAdapter);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      String(url).endsWith("/campana/resultado")
        ? new Response(JSON.stringify({ sorteo: "42", ganadoras: [GANA_1, GANA_2], comprobante: COMPROBANTE }), { status: 200 })
        : new Response(null, { status: 404 }),
    ),
  );
});
afterEach(() => {
  setActiveWallet(null);
  reiniciarElPuente();
  vi.unstubAllGlobals();
});

describe("la entrada de un sorteo que se hizo en otra compu", () => {
  it("lleva el número, las ganadoras y el comprobante de la sala, sin huella ni ronda", () => {
    const e = entradaDeUnSorteoRecuperado({
      evento: "evento-uno",
      red: "mainnet",
      contrato: "CCONTRATO",
      organizadora: A,
      ahora: 1_000,
      resultado: { sorteo: "42", ganadoras: [GANA_1, GANA_2], comprobante: COMPROBANTE },
    });
    expect(e).toEqual({
      evento: "evento-uno",
      red: "mainnet",
      contrato: "CCONTRATO",
      huella: "",
      premios: 2,
      organizadora: A,
      pasadaEn: 1_000,
      sorteo: "42",
      aviso: "hecho",
      resultado: "hecho",
      comprobante: COMPROBANTE,
      ganadoras: [GANA_1, GANA_2],
    });
  });

  it("armarSorteo la guarda para la cuenta, con el resultado público, y una segunda vez no la pisa", async () => {
    const tus = depsDeTusReales();
    expect(await tus.armarSorteo(SALA, A)).toBe(true);
    const e = entradaDelEvento(network.name, "evento-uno", localStorage, A);
    expect(e).toMatchObject({ sorteo: "42", aviso: "hecho", resultado: "hecho", comprobante: COMPROBANTE, ganadoras: [GANA_1, GANA_2], organizadora: A });
    // Otra cuenta en esta compu no la ve.
    expect(leerSorteosDeCampana(localStorage, Keypair.random().publicKey())).toEqual([]);
    const antes = localStorage.getItem("tinkazo.campana.sorteos");
    expect(await tus.armarSorteo(SALA, A)).toBe(true);
    expect(localStorage.getItem("tinkazo.campana.sorteos")).toBe(antes);
  });

  it("sin el resultado de la sala no arma nada y lo dice", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "sin-resultado" }), { status: 404 })));
    expect(await depsDeTusReales().armarSorteo(SALA, A)).toBe(false);
    expect(leerSorteosDeCampana(localStorage, A)).toEqual([]);
  });

  it("con la entrada armada, el paso de las ganadoras muestra a cada una con su botón de avisar", async () => {
    guardarOrg(localStorage, memoria);
    await depsDeTusReales().armarSorteo(SALA, A);
    const d = depsDelResultadoReales();
    registrarLasAcciones(d);
    retomarAlArrancar(d);
    await suelta(8);
    const paso = pasoDelPuente();
    expect(paso.paso).toBe("resultado");
    expect(paso.paso === "resultado" ? paso.filas.map((f) => [f.cuenta, f.avisada]) : null).toEqual([
      [GANA_1, false],
      [GANA_2, false],
    ]);
    expect(typeof accionesDelPuente().avisarA).toBe("function");
  });

  it("sin la entrada armada, el paso no dice nada: por eso hace falta armarla antes de retomar", async () => {
    guardarOrg(localStorage, memoria);
    retomarAlArrancar(depsDelResultadoReales());
    await suelta(6);
    expect(pasoDelPuente()).toEqual({ paso: "nada" });
  });
});
