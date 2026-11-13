// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { T } from "../i18n";

/**
 * El rótulo del pliegue de las opciones (`#mas-opciones`, `turnos.ts`) nombra el orden de turnos cuando los modos están a la
 * vista: la opción se elige ahí adentro, y con el rótulo de siempre («Premio, cuántos ganan y subir CSV») quien la busca no
 * sabe que está. Con el modo elegido dice el del modo, y sin los modos a la vista, el de siempre.
 */

const pagina = readFileSync(join(process.cwd(), "index.html"), "utf8");
const nombres = (n: number): string => Array.from({ length: n }, (_, i) => `Participante ${i + 1}`).join("\n");
const pliegue = (): string => document.querySelector("#mas-opciones > summary")?.textContent ?? "";

/** Arma la página como `main.ts`: la lista, los campos y la opción, con `n` personas en el cuadro. */
async function montar(n: number): Promise<typeof import("./turnos")> {
  vi.resetModules();
  sessionStorage.clear();
  document.body.innerHTML = new DOMParser().parseFromString(pagina, "text/html").body.innerHTML;
  await import("../i18n");
  const participants = await import("./participants");
  const ganadores = await import("./ganadores");
  const turnos = await import("./turnos");
  participants.bindParticipants();
  ganadores.montarGanadores();
  turnos.montarTurnos();
  const ta = document.getElementById("ta") as HTMLTextAreaElement;
  ta.value = nombres(n);
  ta.dispatchEvent(new Event("input", { bubbles: true }));
  return turnos;
}

beforeEach(() => {
  history.replaceState(null, "", "/");
});

afterEach(() => {
  history.replaceState(null, "", "/");
});

describe("el rótulo del pliegue nombra el orden de turnos cuando los modos están a la vista", () => {
  it("con los modos a la vista dice orden de turnos antes de elegirlo, en los dos idiomas", async () => {
    history.replaceState(null, "", "/?modo=varias");
    await montar(5);
    expect(pliegue()).toBe("Premio, orden de turnos, cuántos ganan y subir CSV");
    const { setLang } = await import("../i18n");
    setLang("en");
    expect(pliegue()).toBe("Prize, turn order, how many win and upload CSV");
    setLang("es");
    expect(pliegue()).toBe("Premio, orden de turnos, cuántos ganan y subir CSV");
  });

  it("elegido el orden, el rótulo del modo; al apagarlo, vuelve el que nombra los dos", async () => {
    history.replaceState(null, "", "/?modo=turnos");
    const turnos = await montar(5);
    // Elegir el orden es lo que hace `abrirConElModoPedido` al cargar la herramienta.
    turnos.ponerModoTurnos(true);
    expect(pliegue()).toBe("Orden de turnos, nombre y subir CSV");
    turnos.ponerModoTurnos(false);
    expect(pliegue()).toBe("Premio, orden de turnos, cuántos ganan y subir CSV");
  });

  it("sin los modos a la vista, el rótulo de siempre", async () => {
    await montar(5);
    expect(pliegue()).toBe("Premio, cuántos ganan y subir CSV");
  });

  it("el rótulo nuevo existe en los dos idiomas y no usa palabras de apuesta", () => {
    for (const l of ["es", "en"] as const) {
      const v = String(T[l].masOpcionesModos);
      expect(v, l).toMatch(l === "es" ? /turnos/ : /turn order/);
      expect(v, l).not.toMatch(/rifa|loter|raffle|ticket|boleto|apuesta|;/i);
      expect(v, l).not.toContain(String.fromCharCode(0xab));
      expect(v, l).not.toContain(String.fromCharCode(0xbb));
    }
  });
});
