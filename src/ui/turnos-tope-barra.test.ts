// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { T } from "../i18n";

/**
 * Un orden de turnos más largo de lo que admite la red (32 en la red de prueba) deja el botón de sellar apagado. La barra
 * de «lo que sigue» y el resumen junto al botón tienen que decir por qué: antes la barra decía «Sellando la lista», que es
 * falso, y el motivo quedaba lejos, dentro del pliegue de las opciones.
 */

const h = vi.hoisted(() => ({ tope: 300 }));
vi.mock("../stellar/config", async (orig) => ({ ...(await orig<typeof import("../stellar/config")>()), topeDeGanadores: () => h.tope }));

const pagina = readFileSync(join(process.cwd(), "index.html"), "utf8");
const nombres = (n: number): string => Array.from({ length: n }, (_, i) => `Participante ${i + 1}`).join("\n");

const $ = (id: string): HTMLElement => document.getElementById(id) as HTMLElement;
const barra = (): string => $("sig-paso").textContent ?? "";
const resumen = (): string => $("sellar-resumen").textContent ?? "";

interface Modulos {
  siguiente: typeof import("./siguiente");
}

/** Arma la herramienta como `main.ts`: la lista, el modo de turnos prendido y la barra, con `n` personas en el cuadro. */
async function montar(n: number, tope: number): Promise<Modulos> {
  vi.resetModules();
  h.tope = tope;
  sessionStorage.clear();
  history.replaceState(null, "", "/?modo=turnos&lang=es");
  document.body.innerHTML = new DOMParser().parseFromString(pagina, "text/html").body.innerHTML;
  await import("../i18n");
  const participants = await import("./participants");
  const ganadores = await import("./ganadores");
  const turnos = await import("./turnos");
  const siguiente = await import("./siguiente");
  participants.bindParticipants();
  ganadores.montarGanadores();
  turnos.montarTurnos();
  siguiente.initSiguiente({ segundos: () => 0 });
  turnos.ponerModoTurnos(true);
  poner(n);
  siguiente.actualizarPaso();
  return { siguiente };
}

/** Pone `n` personas en el cuadro, como si se pegaran. */
function poner(n: number): void {
  const ta = $("ta") as HTMLTextAreaElement;
  ta.value = nombres(n);
  ta.dispatchEvent(new Event("input", { bubbles: true }));
}

beforeEach(() => {
  history.replaceState(null, "", "/");
});

afterEach(() => {
  history.replaceState(null, "", "/");
});

describe("la barra de lo que sigue con un orden que no entra", () => {
  it("con 40 turnos y un tope de 32, el botón está apagado y la barra no dice que se está sellando", async () => {
    const { siguiente } = await montar(40, 32);
    expect(($("btn-freeze") as HTMLButtonElement).disabled).toBe(true);
    expect(barra()).not.toMatch(/sellando/i);
    expect(barra()).toBe("Paso 2 de 4: no se puede sellar, el orden llega hasta 32 turnos");
    // El botón de la barra copia al de verdad: apagado.
    expect(($("sig-btn") as HTMLButtonElement).disabled).toBe(true);
    // Lo que se anuncia al lector de pantalla es lo mismo, y tampoco dice que se esté sellando.
    siguiente.actualizarPaso();
    expect($("sig-aviso").textContent ?? "").not.toMatch(/sellando/i);
  });

  it("dice lo mismo en inglés, con el tope de la red", async () => {
    await montar(40, 32);
    const { setLang } = await import("../i18n");
    setLang("en");
    expect(barra()).toBe("Step 2 of 4: can't seal, the order goes up to 32 turns");
    expect(barra()).not.toMatch(/sealing the list/i);
  });

  it("el tope es el de la red de ahora: con 301 turnos y un tope de 300, lo mismo", async () => {
    await montar(301, 300);
    expect(barra()).toBe("Paso 2 de 4: no se puede sellar, el orden llega hasta 300 turnos");
  });

  it("con una lista que entra, la barra es la de siempre, y si vuelve a entrar, se va el aviso", async () => {
    const { siguiente } = await montar(20, 32);
    expect(($("btn-freeze") as HTMLButtonElement).disabled).toBe(false);
    expect(barra()).toBe("Paso 2 de 4: lista de 20 personas");
    poner(40);
    siguiente.actualizarPaso();
    expect(barra()).toContain("no se puede sellar");
    poner(32);
    siguiente.actualizarPaso();
    expect(barra()).toBe("Paso 2 de 4: lista de 32 personas");
    expect(barra()).not.toContain("no se puede sellar");
  });

  it("apagado por otra razón (falta una segunda persona), la barra no habla del tope", async () => {
    const { siguiente } = await montar(1, 32);
    siguiente.actualizarPaso();
    expect(barra()).not.toContain("no se puede sellar");
  });
});

describe("el resumen de al lado del botón dice por qué no se puede sellar", () => {
  it("con 40 turnos y un tope de 32, el motivo va en la misma línea del resumen", async () => {
    await montar(40, 32);
    expect(resumen()).toBe("40 personas, turnos del 1 al 40. En esta red el orden llega hasta 32 turnos: con más, no se puede sellar.");
    expect(resumen()).not.toContain("Al sellar");
  });

  it("repartido: 20 personas con 2 turnos cada una son 40 turnos, y dice el tope también", async () => {
    await montar(2, 32);
    const ta = $("ta") as HTMLTextAreaElement;
    ta.value = Array.from({ length: 20 }, (_, i) => [`Persona ${i + 1} (1/2)`, `Persona ${i + 1} (2/2)`]).flat().join("\n");
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    expect(resumen()).toContain("20 personas, 40 turnos");
    expect(resumen()).toContain("En esta red el orden llega hasta 32 turnos: con más, no se puede sellar.");
  });

  it("en inglés el motivo también está", async () => {
    await montar(40, 32);
    const { setLang } = await import("../i18n");
    setLang("en");
    expect(resumen()).toBe("40 people, turns 1 to 40. On this network the order goes up to 32 turns: with more, it can't be sealed.");
  });

  it("con una lista que entra no aparece, y la promesa del sello vuelve", async () => {
    await montar(20, 32);
    expect(resumen()).toBe("20 personas, turnos del 1 al 20. Al sellar, la lista queda cerrada.");
  });

  it("la frase es la misma de la nota del pliegue, en los dos idiomas", () => {
    for (const lang of ["es", "en"] as const) {
      const nota = String(T[lang].turnsLimit).replace("{n}", "32");
      expect(T[lang].turnsSellarTope(40, 40, 32), lang).toContain(nota);
      // Sin el tope (quien llama no lo sabe), el texto de antes: nada que prometer ni que explicar.
      expect(T[lang].turnsSellarTope(40, 40), lang).not.toContain(nota);
    }
  });
});
