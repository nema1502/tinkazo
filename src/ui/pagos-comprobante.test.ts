// @vitest-environment jsdom
import { Keypair } from "@stellar/stellar-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLang, textos, usarTextos } from "../idioma";
import { roundTime } from "../protocol/quicknet";
import type { Revision } from "../protocol/verificacion";
import { mostrarPagosDelComprobante, panelDelComprobante } from "./pagos-comprobante";

const [ORG, A, B] = [Keypair.random().publicKey(), Keypair.random().publicKey(), Keypair.random().publicKey()] as [string, string, string];
const RONDA = 28_000_000;
const DRAWN_AT = roundTime(RONDA) + 90;

/** Lo que la verificación sabe de un sorteo anclado en el contrato oficial y ya sorteado. */
function revision(over: Record<string, unknown> = {}): Revision {
  return {
    veredicto: "verde",
    motivos: [],
    falta: null,
    ancla: { tipo: "oficial", contrato: { red: "testnet", contractId: "C" + "A".repeat(55) } },
    nombres: [A, "Ana Mamani", B],
    huella: "ab".repeat(32),
    ronda: RONDA,
    firma: "ef".repeat(48),
    firmaOk: true,
    semilla: "cd".repeat(32),
    k: 2,
    ganadores: [0, 2],
    registro: { sello: { id: "778", organizer: ORG, listHash: "ab".repeat(32), count: 3, numWinners: 2, round: RONDA, sealedAt: 1, meta: "50 USDC", drawn: true }, resultado: { drawnAt: DRAWN_AT } },
    fuente: "estado",
    historial: null,
    ...over,
  } as unknown as Revision;
}

describe("el panel de ganadores del comprobante", () => {
  it("se arma con el número del sorteo del contrato, la cuenta que selló y el ledger del sorteo", () => {
    const p = panelDelComprobante(revision(), "50 USDC");
    expect(p).toMatchObject({ red: "testnet", raffleId: "778", premio: "50 USDC", sorteoEn: DRAWN_AT, desde: roundTime(RONDA) - 600, sinTitulo: true });
    expect(p?.activo).toEqual({ code: "USDC", issuer: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5" });
    expect([...(p?.pagadoras ?? [])]).toEqual([ORG]);
    // Los ganadores salen de la verificación: las posiciones de la lista, en el orden en que salieron.
    expect(p?.ganadores).toEqual([
      { puesto: 0, entrada: A },
      { puesto: 1, entrada: B },
    ]);
  });

  it("si no se leyó el ledger del sorteo, los 7 días se cuentan desde que nació la ronda", () => {
    const p = panelDelComprobante(revision({ registro: { sello: { id: "778", organizer: ORG }, resultado: null } }), "");
    expect(p?.sorteoEn).toBe(roundTime(RONDA));
  });

  it("en mainnet, el USDC de Circle", () => {
    const p = panelDelComprobante(revision({ ancla: { tipo: "oficial", contrato: { red: "mainnet", contractId: "C" } } }), "");
    expect(p?.red).toBe("mainnet");
    expect(p?.activo.issuer).toBe("GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN");
  });

  it("no se muestra si el sorteo no está atestiguado por el contrato", () => {
    expect(panelDelComprobante(revision({ veredicto: "libre" }), "")).toBeNull();
    expect(panelDelComprobante(revision({ veredicto: "mal" }), "")).toBeNull();
    expect(panelDelComprobante(revision({ veredicto: "pendiente" }), "")).toBeNull();
    // Con el sello del historial el número del sorteo no se comprueba: la nota del pago lo llevaría sin que nadie lo atestigüe.
    expect(panelDelComprobante(revision({ fuente: "historial" }), "")).toBeNull();
    expect(panelDelComprobante(revision({ ancla: { tipo: "libre" } }), "")).toBeNull();
    expect(panelDelComprobante(revision({ registro: null }), "")).toBeNull();
    expect(panelDelComprobante(revision({ ganadores: [] }), "")).toBeNull();
  });

  it("no se muestra si los ganadores no son cuentas", () => {
    expect(panelDelComprobante(revision({ nombres: ["Ana", "Luis", "Marta"] }), "")).toBeNull();
  });
});

describe("montarlo en la página de verificación", () => {
  const pedidos: string[] = [];

  beforeEach(() => {
    document.body.innerHTML = '<section id="sec-pagos" style="display:none"><h2 data-i="pgTitulo">Ganadores y premios</h2><div id="pagos-cuerpo"></div></section>';
    // La página trae solo los textos que su markup nombra: el título.
    usarTextos({ es: { pgTitulo: "Ganadores y premios" }, en: { pgTitulo: "Winners and prizes" } });
    setLang("es");
    pedidos.length = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request) => {
        pedidos.push(String(url));
        return new Response("{}", { status: 404 });
      }),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it("suma sus textos al diccionario de la página y muestra el panel con el estado de cada pago", async () => {
    expect(textos("es").pgPagar).toBeUndefined();
    mostrarPagosDelComprobante(revision(), "50 USDC");
    expect(textos("es").pgPagar).toBe("Pagar premio");
    expect(textos("en").pgPagar).toBe("Pay prize");
    expect((document.getElementById("sec-pagos") as HTMLElement).style.display).toBe("block");
    expect(document.querySelectorAll(".gan-fila")).toHaveLength(2);
    await vi.waitFor(() => expect(document.getElementById("pagos-cuerpo")?.textContent).not.toContain("Consultando"));
    // El sorteo es de 2026 y estos pagos se miran contra una ronda vieja: el panel dice Vencido si no hay pago.
    expect(document.querySelectorAll(".gan-est.vencido").length + document.querySelectorAll(".gan-est.pendiente").length).toBe(2);
    expect(pedidos).toHaveLength(2);
    expect(pedidos[0]).toContain(`/accounts/${A}/payments`);
    // El comprobante es de solo lectura: ni un botón de pagar.
    expect(document.querySelector(".gan-pagar")).toBeNull();
    expect((document.querySelector(".gan-titulo") as HTMLElement).hidden).toBe(true);
  });

  it("y cambia con el idioma de la página", async () => {
    mostrarPagosDelComprobante(revision(), "");
    await vi.waitFor(() => expect(document.getElementById("pagos-cuerpo")?.textContent).not.toContain("Consultando"));
    setLang("en");
    expect(document.querySelector("#sec-pagos h2")?.textContent).toBe("Winners and prizes");
    expect(document.querySelector(".gan-actualizar")?.textContent).toBe("Refresh");
  });

  it("si el comprobante no corresponde, no toca la página ni la red", () => {
    mostrarPagosDelComprobante(revision({ fuente: "historial" }), "");
    expect((document.getElementById("sec-pagos") as HTMLElement).style.display).toBe("none");
    expect(textos("es").pgPagar).toBeUndefined();
    expect(pedidos).toEqual([]);
  });
});
