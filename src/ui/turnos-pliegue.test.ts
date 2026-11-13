// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { T } from "../i18n";

/**
 * El rótulo del pliegue de las opciones (`#mas-opciones`, `turnos.ts`). Hasta el 13 de noviembre de 2026 el orden de turnos se
 * elegía ahí adentro y el rótulo lo nombraba. Desde ese día se elige a la vista, en el selector de arriba de la lista
 * (`turnos-selector.test.ts`), así que el pliegue del sorteo común vuelve a decir lo que guarda: premio, cuántos ganan y
 * subir CSV. Con el orden elegido dice lo que guarda en ese modo: el nombre de los turnos y subir CSV.
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

describe("el rótulo del pliegue dice lo que guarda, con el modo elegido a la vista", () => {
  it("con los modos a la vista, el del sorteo común, en los dos idiomas: el orden se elige arriba", async () => {
    history.replaceState(null, "", "/?modo=varias");
    await montar(5);
    expect(pliegue()).toBe("Premio, cuántos ganan y subir CSV");
    const { setLang } = await import("../i18n");
    setLang("en");
    expect(pliegue()).toBe(String(T.en.masOpciones));
    setLang("es");
    expect(pliegue()).toBe("Premio, cuántos ganan y subir CSV");
  });

  it("elegido el orden, el rótulo del modo; al apagarlo, vuelve el del sorteo común", async () => {
    history.replaceState(null, "", "/?modo=turnos");
    const turnos = await montar(5);
    // Elegir el orden es lo que hace `abrirConElModoPedido` al cargar la herramienta.
    turnos.ponerModoTurnos(true);
    expect(pliegue()).toBe("Nombre de los turnos y subir CSV");
    turnos.ponerModoTurnos(false);
    expect(pliegue()).toBe("Premio, cuántos ganan y subir CSV");
  });

  it("sin los modos a la vista, el rótulo de siempre", async () => {
    await montar(5);
    expect(pliegue()).toBe("Premio, cuántos ganan y subir CSV");
  });

  it("el rótulo del orden existe en los dos idiomas y no usa palabras de apuesta", () => {
    for (const l of ["es", "en"] as const) {
      const v = String(T[l].turnsMas);
      expect(v, l).toMatch(l === "es" ? /turnos/ : /turns/);
      expect(v, l).not.toMatch(/rifa|loter|raffle|ticket|boleto|apuesta|;/i);
      expect(v, l).not.toContain(String.fromCharCode(0xab));
      expect(v, l).not.toContain(String.fromCharCode(0xbb));
    }
    // La clave que nombraba el orden dentro del pliegue ya no existe.
    expect(T.es.masOpcionesModos).toBeUndefined();
  });
});
