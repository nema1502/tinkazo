// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_WINNERS } from "../protocol/select";

/**
 * El resultado en grande con muchos ganadores (`pantalla.ts`): hasta doce, tarjetas con cara (en dos columnas desde seis);
 * con más, una lista de renglones cortos. Es el markup lo que se prueba: cómo se acomoda en una pantalla de proyector
 * se mira con un navegador, que jsdom no tiene (no calcula tamaños).
 */

vi.mock("../enlace-corto", () => ({ acortar: async () => null, enlaceParaElQr: async () => ({ ahora: "", despues: Promise.resolve(null) }) }));
vi.mock("./qr", () => ({ pintarQrDelComprobante: async () => false }));
vi.mock("./logo-sorteo", () => ({ piezaParaLaSala: () => null }));

async function abrir(n: number, premio = "Termo"): Promise<HTMLElement> {
  vi.resetModules();
  document.body.innerHTML = "";
  const { app } = await import("../state");
  const names = Array.from({ length: Math.max(n + 3, 20) }, (_, i) => `Persona <${i + 1}> & Co`);
  app.frozen = { names, listHash: "00".repeat(32), ts: 1, at: "", prize: premio, round: 1 } as never;
  app.drawn = { beacon: { round: 1, randomness: "00".repeat(32), signature: "" }, winners: Array.from({ length: n }, (_, i) => i + 1) } as never;
  const { mostrarResultado } = await import("./pantalla");
  await mostrarResultado("https://tinkazo.app/v#x");
  return document.querySelector(".pantalla") as HTMLElement;
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("el resultado en grande según cuántos ganan", () => {
  it("uno solo y hasta doce: tarjetas con su cara, como siempre", async () => {
    for (const n of [1, 3, 6, 12]) {
      const p = await abrir(n);
      expect(p.classList.contains("lista"), `con ${n}`).toBe(false);
      expect(p.querySelectorAll(".pantalla-ganador"), `con ${n}`).toHaveLength(n);
      expect(p.querySelectorAll(".pantalla-ganador img"), `con ${n}`).toHaveLength(n);
      expect(p.querySelector(".pantalla-lista"), `con ${n}`).toBeNull();
    }
    expect((await abrir(6)).classList.contains("muchos")).toBe(true);
    expect((await abrir(5)).classList.contains("muchos")).toBe(false);
  });

  it("más de doce: una lista numerada, sin una imagen por persona", async () => {
    for (const n of [13, 50, MAX_WINNERS]) {
      const p = await abrir(n);
      expect(p.classList.contains("lista"), `con ${n}`).toBe(true);
      const filas = [...p.querySelectorAll<HTMLElement>(".pantalla-lista .pantalla-fila")];
      expect(filas, `con ${n}`).toHaveLength(n);
      expect(p.querySelectorAll(".pantalla-ganador"), `con ${n}`).toHaveLength(0);
      expect(p.querySelectorAll(".pantalla-ganadores img"), `con ${n}`).toHaveLength(0);
      // En el orden de los premios, con el número de cada uno y su nombre entero.
      expect(filas[0]?.querySelector(".pantalla-num")?.textContent).toBe("#1");
      expect(filas[n - 1]?.querySelector(".pantalla-num")?.textContent).toBe(`#${n}`);
      expect(filas[0]?.querySelector(".pantalla-nombre")?.textContent).toBe("Persona <2> & Co");
    }
  });

  it("la lista dice una vez qué se llevan, y los nombres no abren etiquetas", async () => {
    const p = await abrir(40, "Una <b>polera</b>");
    expect(p.querySelectorAll(".pantalla-llevan")).toHaveLength(1);
    expect(p.querySelector(".pantalla-llevan b")?.textContent).toBe("Una <b>polera</b>");
    expect(p.querySelectorAll(".pantalla-lista b")).toHaveLength(0);
  });
});
