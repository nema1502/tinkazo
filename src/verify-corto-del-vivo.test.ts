// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Quien llega a la verificación desde la vista en vivo (`ui/espectador.ts`) comparte el corto con el que entró ese
 * celular, y no crea otro: con 150 a 300 celulares detrás de la misma conexión, cada alta gastaría el tope por hora
 * del servicio de enlaces. Sin ese traspaso, la verificación comparte como siempre.
 */

const h = vi.hoisted(() => ({ abrirSorteo: vi.fn((..._a: unknown[]): void => undefined) }));
vi.mock("./ui/compartir", () => ({ abrirSorteo: (...a: unknown[]) => h.abrirSorteo(...a) }));

const pagina = readFileSync(join(process.cwd(), "verificar.html"), "utf8");
const CORTO = `${location.origin}/c/AbCdEfGh#${"a".repeat(22)}`;
const RUTA = "/verificar.html";

beforeAll(() => {
  window.matchMedia = ((q: string) =>
    ({ matches: false, media: q, onchange: null, addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined, dispatchEvent: () => false })) as typeof window.matchMedia;
});

beforeEach(() => {
  vi.resetModules();
  h.abrirSorteo.mockClear();
  sessionStorage.clear();
  history.replaceState(null, "", "/verificar.html?lang=es");
  document.body.innerHTML = new DOMParser().parseFromString(pagina, "text/html").body.innerHTML;
});

/** Pinta un resultado y toca Compartir, como quien llegó a la página. */
async function tocarCompartir(): Promise<void> {
  await import("./i18n");
  const { renderResult } = await import("./verify");
  const names = ["Ana", "Beto", "Carla"];
  renderResult({ names, prize: "Un libro" } as never, { ronda: 7, firma: "ab", semilla: "cd", ganadores: [1], nombres: names, ancla: { tipo: "libre" } } as never, "Un libro", {
    fromChain: false,
  });
  (document.getElementById("btn-compartir") as HTMLButtonElement).click();
}

describe("compartir desde la verificación", () => {
  it("con el corto de la vista en vivo, comparte ese y no crea otro", async () => {
    sessionStorage.setItem("tinkazo.corto-del-vivo", JSON.stringify({ r: RUTA, c: CORTO }));
    await tocarCompartir();
    expect(h.abrirSorteo).toHaveBeenCalledTimes(1);
    const [datos, lang, op] = h.abrirSorteo.mock.calls[0] as [{ enlace: string }, unknown, unknown];
    expect(datos.enlace).toBe(CORTO);
    expect(lang).toBeUndefined();
    expect(op).toEqual({ corto: false });
  });

  it("con el traspaso de otra ruta, comparte como siempre", async () => {
    sessionStorage.setItem("tinkazo.corto-del-vivo", JSON.stringify({ r: "/verificar.html#otraCosa", c: CORTO }));
    await tocarCompartir();
    expect(h.abrirSorteo).toHaveBeenCalledTimes(1);
    const args = h.abrirSorteo.mock.calls[0] as unknown[];
    expect((args[0] as { enlace: string }).enlace).not.toBe(CORTO);
    expect(args).toHaveLength(1);
  });

  it("sin traspaso, comparte como siempre", async () => {
    await tocarCompartir();
    expect(h.abrirSorteo).toHaveBeenCalledTimes(1);
    expect((h.abrirSorteo.mock.calls[0] as unknown[]).length).toBe(1);
  });
});
