// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_WINNERS } from "../protocol/select";

/**
 * «Cuántos ganan» con el resto de la lista (`participants.ts`): el resumen de «Sellar la lista», el borrador de la
 * pestaña y el bloqueo al sellar, con el markup de verdad de `index.html` y el tope de la red en 100 (el de una red con
 * el contrato nuevo). Con el de testnet de hoy (32) ver `ganadores.test.ts` y `config-tope.test.ts`.
 */

const h = vi.hoisted(() => ({ tope: 100 }));
vi.mock("../stellar/config", async (orig) => ({ ...(await orig<typeof import("../stellar/config")>()), topeDeGanadores: () => h.tope }));

const pagina = readFileSync(join(process.cwd(), "index.html"), "utf8");
const nombres = (n: number): string => Array.from({ length: n }, (_, i) => `Participante ${i + 1}`).join("\n");

const campo = (): HTMLInputElement => document.getElementById("nw") as HTMLInputElement;
const chip = (n: number): HTMLButtonElement => document.querySelector(`#nw-atajos button[data-n="${n}"]`) as HTMLButtonElement;
const resumen = (): string => document.getElementById("sellar-resumen")?.textContent ?? "";
const escribir = (valor: string): void => {
  campo().value = valor;
  campo().dispatchEvent(new Event("input", { bubbles: true }));
};

async function montar(n: number): Promise<typeof import("./participants")> {
  vi.resetModules();
  h.tope = 100;
  sessionStorage.clear();
  document.body.innerHTML = new DOMParser().parseFromString(pagina, "text/html").body.innerHTML;
  const p = await import("./participants");
  const g = await import("./ganadores");
  p.bindParticipants();
  g.montarGanadores();
  const ta = document.getElementById("ta") as HTMLTextAreaElement;
  ta.value = nombres(n);
  ta.dispatchEvent(new Event("input", { bubbles: true }));
  return p;
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("el resumen de «Sellar la lista» sigue a «Cuántos ganan»", () => {
  it("con 100 de 150: lo dice, y al teclearlo y con un atajo", async () => {
    await montar(150);
    escribir("100");
    expect(resumen()).toContain("150 personas, 100 ganadores");
    chip(5).click();
    expect(resumen()).toContain("150 personas, 5 ganadores");
    chip(1).click();
    expect(resumen()).toContain("150 personas, 1 ganador");
  });

  it("no pasa de las personas de la lista: pedir 100 con 40 en la lista son 40", async () => {
    await montar(40);
    escribir("100");
    expect(resumen()).toContain("40 personas, 40 ganadores");
  });
});

describe("el borrador de la pestaña", () => {
  const BORRADOR = "tinkazo.borrador";

  it("guarda el máximo y lo repone en otra carga de la página", async () => {
    const p = await montar(120);
    escribir(String(MAX_WINNERS));
    p.guardarBorrador();
    const guardado = sessionStorage.getItem(BORRADOR) as string;
    expect((JSON.parse(guardado) as { nw: number }).nw).toBe(MAX_WINNERS);
    // Otra carga de la página: sin lista, y el borrador de la pestaña sigue ahí.
    const q = await montar(0);
    sessionStorage.setItem(BORRADOR, guardado);
    q.reponerBorrador();
    expect(campo().value).toBe(String(MAX_WINNERS));
    expect(chip(10).getAttribute("aria-pressed")).toBe("false");
  });

  it("un borrador de más que lo que admite esta red baja a lo que admite (testnet: 32)", async () => {
    const q = await montar(0);
    h.tope = 32;
    sessionStorage.setItem(BORRADOR, JSON.stringify({ texto: nombres(120), premio: "", nw: 80 }));
    q.reponerBorrador();
    expect(campo().value).toBe("32");
  });

  it("un borrador torcido, con más que el protocolo, no se repone", async () => {
    const q = await montar(0);
    sessionStorage.setItem(BORRADOR, JSON.stringify({ texto: nombres(120), premio: "", nw: MAX_WINNERS + 1 }));
    q.reponerBorrador();
    expect(campo().value).toBe("1");
  });
});

describe("al sellar", () => {
  it("la lista cerrada bloquea el campo y los atajos, y al soltarla vuelven", async () => {
    const p = await montar(30);
    p.cerrarLista(true);
    expect(campo().disabled).toBe(true);
    for (const n of [1, 2, 3, 5, 10]) expect(chip(n).disabled, `atajo ${n}`).toBe(true);
    p.cerrarLista(false);
    expect(campo().disabled).toBe(false);
    for (const n of [1, 2, 3, 5, 10]) expect(chip(n).disabled, `atajo ${n}`).toBe(false);
  });
});
