// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * El resultado en grande con los lugares de a uno (`revelados`, draw.ts): la sala ve un lugar por show, así que la
 * pantalla grande muestra solo los lugares ya jugados. Los que siguen tienen su show con «Siguiente premio».
 */

vi.mock("../enlace-corto", () => ({ acortar: async () => null, enlaceParaElQr: async () => ({ ahora: "", despues: Promise.resolve(null) }) }));
vi.mock("./qr", () => ({ pintarQrDelComprobante: async () => false }));
vi.mock("./logo-sorteo", () => ({ piezaParaLaSala: () => null }));

const NOMBRES = ["Ana", "Beto", "Carla", "Dani", "Eva", "Fede"];

/** Abre la pantalla grande con tres lugares sellados (Beto, Dani y Fede) y los que ya se vieron. */
async function abrir(revelados: number | undefined): Promise<string[]> {
  vi.resetModules();
  document.body.innerHTML = "";
  const { app } = await import("../state");
  app.frozen = { names: [...NOMBRES], listHash: "00".repeat(32), ts: 1, at: "", prize: "Termo", round: 1 } as never;
  app.drawn = {
    beacon: { round: 1, randomness: "00".repeat(32), signature: "" },
    winners: [1, 3, 5],
    ...(revelados === undefined ? {} : { revelados }),
  } as never;
  const { mostrarResultado } = await import("./pantalla");
  await mostrarResultado("https://tinkazo.app/v#x");
  return [...document.querySelectorAll(".pantalla .pantalla-nombre")].map((e) => e.textContent ?? "");
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("la pantalla grande con los lugares de a uno", () => {
  it("después del show del primer lugar muestra solo al primero", async () => {
    expect(await abrir(1)).toEqual(["Beto"]);
  });

  it("después del segundo, los dos ya jugados y no el tercero", async () => {
    expect(await abrir(2)).toEqual(["Beto", "Dani"]);
  });

  it("con los tres jugados, los tres", async () => {
    expect(await abrir(3)).toEqual(["Beto", "Dani", "Fede"]);
  });

  it("sin la progresión en marcha, todos, como siempre", async () => {
    expect(await abrir(undefined)).toEqual(["Beto", "Dani", "Fede"]);
  });
});
