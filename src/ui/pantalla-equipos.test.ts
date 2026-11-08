// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * El resultado en grande con equipos con cupón: la sala lee el nombre del equipo, no las 56 letras de su cuenta
 * (hallazgo del ensayo general del 6 de noviembre de 2026: la cuenta se salía de la tarjeta y tapaba el QR).
 */

vi.mock("../enlace-corto", () => ({ acortar: async () => null, enlaceParaElQr: async () => ({ ahora: "", despues: Promise.resolve(null) }) }));
vi.mock("./qr", () => ({ pintarQrDelComprobante: async () => false }));
vi.mock("./logo-sorteo", () => ({ piezaParaLaSala: () => null }));

const CUENTA_A = `G${"A".repeat(55)}`;
const CUENTA_B = `G${"B".repeat(55)}`;

async function abrir(ganan: number[]): Promise<HTMLElement> {
  vi.resetModules();
  document.body.innerHTML = "";
  sessionStorage.clear();
  const { app } = await import("../state");
  const { ponerEtiquetas } = await import("../equipos/etiquetas");
  ponerEtiquetas(new Map([[CUENTA_A, "Los Cóndores"]]));
  app.frozen = { names: [CUENTA_A, CUENTA_B], listHash: "00".repeat(32), ts: 1, at: "", prize: "5 USDC", round: 1 } as never;
  app.drawn = { beacon: { round: 1, randomness: "00".repeat(32), signature: "" }, winners: ganan } as never;
  const { mostrarResultado } = await import("./pantalla");
  await mostrarResultado("https://tinkazo.app/v#x");
  return document.querySelector(".pantalla") as HTMLElement;
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("el resultado en grande de los equipos con cupón", () => {
  it("dice el nombre del equipo y no su cuenta", async () => {
    const p = await abrir([0]);
    expect(p.querySelector(".pantalla-nombre")?.textContent).toBe("Los Cóndores");
    expect(p.textContent).not.toContain(CUENTA_A);
  });

  it("un equipo sin nombre guardado se ve como siempre: con su línea tal cual", async () => {
    const p = await abrir([1]);
    expect(p.querySelector(".pantalla-nombre")?.textContent).toBe(CUENTA_B);
  });
});
