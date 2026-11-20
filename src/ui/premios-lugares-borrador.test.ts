// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Los premios del 2.º lugar en adelante no se pierden al recargar la página, al volver de entrar con Google ni al pasar
 * a Orden de turnos o a Amigo secreto y volver. Con el markup de verdad de `index.html` y los módulos montados como en
 * `main.ts`: los campos de premio antes que el borrador.
 */

const pagina = readFileSync(join(process.cwd(), "index.html"), "utf8");
const BORRADOR = "tinkazo.borrador";
const TRES = ["Bici", "Termo", "Libro"];

interface Modulos {
  participants: typeof import("./participants");
  turnos: typeof import("./turnos");
  premios: typeof import("./premios");
}

/** Arma la página con `n` personas en el cuadro. */
async function montar(n: number): Promise<Modulos> {
  vi.resetModules();
  sessionStorage.clear();
  document.body.innerHTML = new DOMParser().parseFromString(pagina, "text/html").body.innerHTML;
  const participants = await import("./participants");
  const ganadores = await import("./ganadores");
  const turnos = await import("./turnos");
  const premios = await import("./premios");
  participants.bindParticipants();
  ganadores.montarGanadores();
  turnos.montarTurnos();
  premios.montarPremios();
  const ta = document.getElementById("ta") as HTMLTextAreaElement;
  ta.value = Array.from({ length: n }, (_, i) => `Participante ${i + 1}`).join("\n");
  ta.dispatchEvent(new Event("input", { bubbles: true }));
  return { participants, turnos, premios };
}

/** Pide `n` ganadores como el contador, y escribe un premio en cada lugar desde el 1.º. */
function escribirPremios(premios: readonly string[]): void {
  const nw = document.getElementById("nw") as HTMLInputElement;
  nw.value = String(premios.length);
  nw.dispatchEvent(new Event("input", { bubbles: true }));
  (document.getElementById("prize") as HTMLInputElement).value = premios[0] ?? "";
  premios.slice(1).forEach((premio, i) => {
    const input = document.querySelector<HTMLInputElement>(`#prize-lugares input[data-lugar="${i + 2}"]`);
    if (!input) throw new Error(`falta el campo del lugar ${i + 2}`);
    input.value = premio;
  });
}

const cajaDeLugares = (): HTMLElement => document.getElementById("prize-lugares") as HTMLElement;

beforeEach(() => {
  history.replaceState(null, "", "/");
});

afterEach(() => {
  history.replaceState(null, "", "/");
});

describe("los premios por lugar no se pierden", () => {
  it("al recargar o al volver de entrar con Google, cada premio vuelve al campo de su lugar", async () => {
    const antes = await montar(6);
    escribirPremios(TRES);
    antes.participants.guardarBorrador();
    const guardado = sessionStorage.getItem(BORRADOR) as string;
    // Otra carga de la página: el cuadro vacío y el borrador de la pestaña todavía ahí.
    const despues = await montar(0);
    sessionStorage.setItem(BORRADOR, guardado);
    despues.participants.reponerBorrador();
    expect(despues.premios.premiosDeLosCampos()).toEqual(TRES);
    expect(cajaDeLugares().hidden).toBe(false);
  });

  it("al pasar a Orden de turnos y volver a Sortear premios", async () => {
    history.replaceState(null, "", "/?modo=turnos");
    const { turnos, premios } = await montar(6);
    escribirPremios(TRES);
    turnos.ponerModoTurnos(true);
    turnos.ponerModoTurnos(false);
    expect(premios.premiosDeLosCampos()).toEqual(TRES);
  });

  it("al pasar a Amigo secreto y volver a Sortear premios", async () => {
    history.replaceState(null, "", "/?modo=turnos");
    const { turnos, premios } = await montar(6);
    escribirPremios(TRES);
    turnos.ponerModoAmigo(true);
    turnos.ponerModoAmigo(false);
    expect(premios.premiosDeLosCampos()).toEqual(TRES);
  });
});
