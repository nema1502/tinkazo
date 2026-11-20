// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * La letra del nombre en la pantalla grande del celular con un premio largo: la tarjeta ocupa todo el ancho y, girada,
 * asoma un par de píxeles por el costado. Eso no es un nombre que no entra, y la letra no baja al piso por eso.
 * jsdom no mide: las medidas se ponen a mano, las de una tarjeta de 358 px girada como en la página.
 */

vi.mock("../enlace-corto", () => ({ acortar: async () => null, enlaceParaElQr: async () => ({ ahora: "", despues: Promise.resolve(null) }) }));
vi.mock("./qr", () => ({ pintarQrDelComprobante: async () => false }));
vi.mock("./logo-sorteo", () => ({ piezaParaLaSala: () => null }));

/** Las medidas de mentira: el cuerpo, de 358 px, se pasa por `sobra`, y la tarjeta girada ocupa `anchoGirada`. */
function medir(sobra: number, anchoGirada: number): void {
  const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
  const es = (e: HTMLElement, clase: string): boolean => e.classList.contains(clase);
  Object.defineProperty(proto, "clientWidth", { configurable: true, get(this: HTMLElement) { return es(this, "pantalla-body") ? 358 : 0; } });
  Object.defineProperty(proto, "scrollWidth", { configurable: true, get(this: HTMLElement) { return es(this, "pantalla-body") ? 358 + sobra : 0; } });
  Object.defineProperty(proto, "offsetWidth", { configurable: true, get(this: HTMLElement) { return es(this, "pantalla-ganador") ? 358 : 0; } });
  Object.defineProperty(proto, "getBoundingClientRect", {
    configurable: true,
    value(this: HTMLElement) {
      return { width: es(this, "pantalla-ganador") ? anchoGirada : 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0 };
    },
  });
}

/** Abre la pantalla grande de un solo ganador con un premio largo y devuelve la letra del nombre. */
async function letraDelNombre(): Promise<string> {
  vi.resetModules();
  document.body.innerHTML = "";
  const { app } = await import("../state");
  app.frozen = {
    names: ["Ana", "Jorge Mamani"],
    listHash: "00".repeat(32),
    ts: 1,
    at: "",
    prize: "Auriculares inalámbricos con micrófono",
    round: 1,
  } as never;
  app.drawn = { beacon: { round: 1, randomness: "00".repeat(32), signature: "" }, winners: [1] } as never;
  const { mostrarResultado } = await import("./pantalla");
  await mostrarResultado("https://tinkazo.app/v#x");
  return document.querySelector<HTMLElement>(".pantalla-ganadores")?.style.getPropertyValue("--letra") ?? "";
}

const ANCHO_DE_ANTES = window.innerWidth;

beforeEach(() => {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
});

afterEach(() => {
  const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
  for (const k of ["clientWidth", "scrollWidth", "offsetWidth", "getBoundingClientRect"]) delete proto[k];
  Object.defineProperty(window, "innerWidth", { configurable: true, value: ANCHO_DE_ANTES });
  document.body.innerHTML = "";
});

describe("la tarjeta girada en la pantalla grande del celular", () => {
  it("lo que asoma por el giro no baja el nombre al piso", async () => {
    // Una tarjeta de 358 px girada 1,5 grados y de 152 px de alto ocupa unos 361,9: asoma 1,9 por cada lado.
    medir(2, 361.9);
    expect(await letraDelNombre()).toBe("132px");
  });

  it("sin giro que lo explique, lo que se sale del costado baja la letra, como siempre", async () => {
    medir(2, 358);
    expect(await letraDelNombre()).toBe("14px");
  });

  it("lo que se sale de más que el giro también la baja", async () => {
    medir(6, 361.9);
    expect(await letraDelNombre()).toBe("14px");
  });
});

describe("cuánto asoma una tarjeta por su giro", () => {
  it("la mitad de lo que el giro le suma al ancho", async () => {
    const { asomaPorElGiro } = await import("./pantalla");
    expect(asomaPorElGiro(358, 362)).toBe(2);
  });

  it("sin giro, nada", async () => {
    const { asomaPorElGiro } = await import("./pantalla");
    expect(asomaPorElGiro(358, 358)).toBe(0);
  });

  it("sin medidas, como en el ensayo, nada", async () => {
    const { asomaPorElGiro } = await import("./pantalla");
    expect(asomaPorElGiro(0, 0)).toBe(0);
  });
});
