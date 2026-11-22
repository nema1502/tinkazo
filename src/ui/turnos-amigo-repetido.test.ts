// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { T } from "../i18n";

/**
 * Un Amigo secreto con una persona dos veces en la lista. El reparto va de renglón en renglón: si los dos renglones de
 * Ana caen seguidos, Ana se regala a sí misma, y eso queda sellado. Por eso no se sella, la línea pegada a Sellar dice
 * quién está dos veces y cómo seguir, la barra no dice que se está sellando, y el panel de varias participaciones no se
 * ofrece en este modo. La lista sellada ya saca los renglones exactamente iguales: lo que queda es el mismo nombre
 * escrito distinto («Ana» y «Ána») o con su marca de participación.
 */

const pagina = readFileSync(join(process.cwd(), "index.html"), "utf8");

const $ = (id: string): HTMLElement => document.getElementById(id) as HTMLElement;
const barra = (): string => $("sig-paso").textContent ?? "";
const resumen = (): string => $("sellar-resumen").textContent ?? "";
const sellar = (): HTMLButtonElement => $("btn-freeze") as HTMLButtonElement;

/** Arma la herramienta como `main.ts`, con el modo elegido y la lista en el cuadro. */
async function montar(modo: "amigo" | "turnos", lista: string[]): Promise<{ siguiente: typeof import("./siguiente") }> {
  vi.resetModules();
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
  if (modo === "amigo") turnos.ponerModoAmigo(true);
  else turnos.ponerModoTurnos(true);
  poner(lista);
  siguiente.actualizarPaso();
  return { siguiente };
}

/** Pone la lista en el cuadro, como si se pegara. */
function poner(lista: string[]): void {
  const ta = $("ta") as HTMLTextAreaElement;
  ta.value = lista.join("\n");
  ta.dispatchEvent(new Event("input", { bubbles: true }));
}

beforeEach(() => {
  history.replaceState(null, "", "/");
});

afterEach(() => {
  history.replaceState(null, "", "/");
});

describe("un Amigo secreto con alguien dos veces no se sella", () => {
  it("el mismo nombre con otras mayúsculas y tildes: Sellar queda apagado", async () => {
    await montar("amigo", ["Ana", "Beto", "ANA", "Carla"]);
    expect(sellar().disabled).toBe(true);
  });

  it("la línea pegada a Sellar dice quién está dos veces y cómo seguir", async () => {
    await montar("amigo", ["Ana", "Beto", "ana", "Carla"]);
    expect($("sellar-resumen").style.display).toBe("");
    expect(resumen()).toBe("Ana está dos veces. Si son dos personas, agregá una inicial.");
  });

  it("la barra no dice que se está sellando", async () => {
    const { siguiente } = await montar("amigo", ["Ana", "Beto", "Ána", "Carla"]);
    siguiente.actualizarPaso();
    expect(barra()).not.toMatch(/sellando/i);
    expect(barra()).toBe("Paso 2 de 4: no se puede sellar, hay un nombre dos veces");
    expect($("sig-aviso").textContent ?? "").not.toMatch(/sellando/i);
  });

  it("dos participaciones de la misma persona también cuentan como dos veces", async () => {
    await montar("amigo", ["Ana (1/2)", "Ana (2/2)", "Beto", "Carla"]);
    expect(sellar().disabled).toBe(true);
    expect(resumen()).toContain("Ana está dos veces");
  });

  it("con una inicial que las distingue, se sella como siempre", async () => {
    const { siguiente } = await montar("amigo", ["Ana", "Beto", "Ána", "Carla"]);
    poner(["Ana P", "Beto", "Ána", "Carla"]);
    siguiente.actualizarPaso();
    expect(sellar().disabled).toBe(false);
    expect(resumen()).not.toContain("dos veces");
    expect(barra()).not.toContain("no se puede sellar");
  });

  it("en inglés también", async () => {
    const { siguiente } = await montar("amigo", ["Ana", "Beto", "Ána", "Carla"]);
    const { setLang } = await import("../i18n");
    setLang("en");
    siguiente.actualizarPaso();
    expect(resumen()).toBe("Ana is on the list twice. If they're two people, add an initial.");
    expect(barra()).toBe("Step 2 of 4: can't seal, a name is on the list twice");
  });

  it("un nombre con $ sale tal cual en la línea: no se lee como un patrón del reemplazo", async () => {
    await montar("amigo", ["Mica $$", "Beto", "mica $$", "Carla"]);
    expect(resumen()).toBe("Mica $$ está dos veces. Si son dos personas, agregá una inicial.");
  });

  it("un orden de turnos con un nombre dos veces se sigue sellando: ahí nadie le regala a nadie", async () => {
    await montar("turnos", ["Ana", "Beto", "Ána", "Carla"]);
    expect(sellar().disabled).toBe(false);
  });
});

describe("la línea junto a Sellar en un Amigo secreto", () => {
  it("sin repetidos dice cuántas personas y que la lista se cierra, sin ganadores ni premio", async () => {
    await montar("amigo", ["Ana", "Beto", "Carla", "Diego"]);
    expect(resumen()).toBe("4 personas. Al sellar, la lista queda cerrada.");
  });

  it("en inglés tampoco habla de ganadores ni de premio", async () => {
    await montar("amigo", ["Ana", "Beto", "Carla", "Diego"]);
    const { setLang } = await import("../i18n");
    setLang("en");
    expect(resumen()).toBe("4 people. Sealing locks the list.");
  });
});

describe("el panel de varias participaciones en un Amigo secreto", () => {
  it("no se ofrece: cada persona va una vez", async () => {
    await montar("amigo", ["Ana", "Beto", "Carla"]);
    expect(($("btn-varias") as HTMLButtonElement).hidden).toBe(true);
  });

  it("tampoco la pregunta por los números que trae una lista pegada", async () => {
    await montar("amigo", ["Ana, 2", "Beto, 1", "Carla, 3"]);
    expect($("participaciones-aviso").style.display).toBe("none");
  });

  it("en un orden de turnos sigue a la mano", async () => {
    await montar("turnos", ["Ana", "Beto", "Carla"]);
    expect(($("btn-varias") as HTMLButtonElement).hidden).toBe(false);
  });

  it("los textos están en los dos idiomas, con el nombre en su lugar", () => {
    expect(T.es.amigoRepetido).toContain("{nombre}");
    expect(T.en.amigoRepetido).toContain("{nombre}");
    expect(T.es.sigRepetido).toBeTruthy();
    expect(T.en.sigRepetido).toBeTruthy();
  });
});
