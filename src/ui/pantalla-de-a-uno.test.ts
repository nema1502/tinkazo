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
async function abrir(revelados: number | undefined, prize = "Termo"): Promise<string[]> {
  vi.resetModules();
  document.body.innerHTML = "";
  const { app } = await import("../state");
  app.frozen = { names: [...NOMBRES], listHash: "00".repeat(32), ts: 1, at: "", prize, round: 1 } as never;
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

/** Lo que dice debajo de cada nombre en la pantalla grande. */
const pies = (): string[] => [...document.querySelectorAll(".pantalla .pantalla-premio")].map((e) => e.textContent ?? "");

const TRES = "1.er premio: Bici, 2.º premio: Termo, 3.er premio: Libro";

describe("la pantalla grande con un premio por lugar", () => {
  it("después del show del primer lugar, el primero se lleva solo el suyo y no los tres", async () => {
    await abrir(1, TRES);
    expect(pies()).toEqual(["Se lleva: Bici"]);
    expect(document.querySelector(".pantalla")?.textContent).not.toContain("Termo");
  });

  it("con un solo premio para todos, el único ganador lo lleva entero, como siempre", async () => {
    await abrir(1, "Termo");
    expect(pies()).toEqual(["Se lleva: Termo"]);
  });

  it("con dos lugares jugados, cada tarjeta dice el suyo y arriba no se anuncian los tres", async () => {
    await abrir(2, TRES);
    expect(pies()).toEqual(["1.er premio: Bici", "2.º premio: Termo"]);
    expect(document.querySelector(".pantalla-llevan")).toBeNull();
    expect(document.querySelector(".pantalla")?.textContent).not.toContain("Libro");
  });

  it("el pie del lugar va con la letra de texto y el número solo con la de máquina", async () => {
    await abrir(3, "1.er premio: Bici, 3.er premio: Libro");
    const clases = [...document.querySelectorAll(".pantalla .pantalla-premio")].map((e) => e.className);
    expect(clases).toEqual(["pantalla-premio por-lugar", "pantalla-premio", "pantalla-premio por-lugar"]);
  });

  it("un lugar sin premio escrito queda solo con su número", async () => {
    await abrir(3, "1.er premio: Bici, 3.er premio: Libro");
    expect(pies()).toEqual(["1.er premio: Bici", "#2", "3.er premio: Libro"]);
  });

  it("con un solo premio para todos y varios ganadores, arriba el premio una vez y en cada tarjeta su número, como siempre", async () => {
    await abrir(3, "Termo");
    expect(document.querySelector(".pantalla-llevan")?.textContent).toBe("Se llevan: Termo");
    expect(pies()).toEqual(["#1", "#2", "#3"]);
    expect(document.querySelector(".pantalla .por-lugar")).toBeNull();
  });
});
