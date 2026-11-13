// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Los sellos cercanos de la verificación: otra cuenta, la misma cantidad de gente, casi a la misma hora. Es la señal de
 * alguien que reordenó la lista para cambiar el resultado. Con listas chicas no dice nada: dos equipos de 5 que sellan
 * con minutos de diferencia se mostraban uno al otro con el aviso. Ahora se avisa desde 20 personas.
 */

const pagina = readFileSync(join(process.cwd(), "verificar.html"), "utf8");

beforeAll(() => {
  window.matchMedia = ((q: string) =>
    ({ matches: false, media: q, onchange: null, addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined, dispatchEvent: () => false })) as typeof window.matchMedia;
});

beforeEach(() => {
  vi.resetModules();
  history.replaceState(null, "", "/verificar.html?lang=es");
  document.body.innerHTML = new DOMParser().parseFromString(pagina, "text/html").body.innerHTML;
});

async function montar(): Promise<typeof import("./verify")> {
  await import("./i18n");
  return import("./verify");
}

const sello = (id: string, count: number) => ({ id, count, organizer: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", round: 1, listHash: id.repeat(64) });

describe("el aviso de sellos cercanos", () => {
  it("con dos sellos de 5 personas no hay aviso", async () => {
    const { cercanosParaAvisar } = await montar();
    expect(cercanosParaAvisar([sello("a", 5), sello("b", 5)])).toEqual([]);
  });

  it("con dos sellos de 30 personas sí", async () => {
    const { cercanosParaAvisar } = await montar();
    expect(cercanosParaAvisar([sello("a", 30), sello("b", 30)]).map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("desde 20 personas", async () => {
    const { cercanosParaAvisar } = await montar();
    expect(cercanosParaAvisar([sello("a", 19)])).toEqual([]);
    expect(cercanosParaAvisar([sello("b", 20)]).map((r) => r.id)).toEqual(["b"]);
  });

  it("la lista de sellos usa ese filtro", () => {
    const verify = readFileSync(join(process.cwd(), "src", "verify.ts"), "utf8");
    expect(verify).toMatch(/const cerca = cercanosParaAvisar\(found\.cercanos \?\? \[\]\);/);
  });
});
