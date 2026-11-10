// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { T } from "../i18n";

/**
 * «Orden de turnos» en la herramienta (`turnos.ts`), con el markup de verdad de `index.html` y el resto de la lista
 * (`participants.ts`): la cantidad que sigue a la lista, el tope de la red, el borrador y, sobre todo, que sin la
 * bandera y sin el parámetro la herramienta de siempre no cambia en nada.
 */

const h = vi.hoisted(() => ({ tope: 300 }));
vi.mock("../stellar/config", async (orig) => ({ ...(await orig<typeof import("../stellar/config")>()), topeDeGanadores: () => h.tope }));

const pagina = readFileSync(join(process.cwd(), "index.html"), "utf8");
const nombres = (n: number): string => Array.from({ length: n }, (_, i) => `Participante ${i + 1}`).join("\n");

const $ = (id: string): HTMLElement => document.getElementById(id) as HTMLElement;
const campo = (): HTMLInputElement => $("nw") as HTMLInputElement;
const premio = (): HTMLInputElement => $("prize") as HTMLInputElement;
const sellar = (): HTMLButtonElement => $("btn-freeze") as HTMLButtonElement;
const opcion = (): HTMLElement => $("turnos-opcion");
const boton = (): HTMLButtonElement => $("btn-turnos") as HTMLButtonElement;
const nota = (): HTMLElement => $("turnos-nota");
const rotulo = (selector: string): string => document.querySelector(selector)?.textContent ?? "";
const BORRADOR = "tinkazo.borrador";
/** El punto medio (U+00B7) no se escribe en ningún texto que se vea: se arma con su código para no dejarlo en el archivo. */
const PUNTO_MEDIO = String.fromCharCode(0xb7);

interface Modulos {
  participants: typeof import("./participants");
  turnos: typeof import("./turnos");
  ganadores: typeof import("./ganadores");
}

/** Arma la página como `main.ts`: la lista, los campos y la opción, con `n` personas en el cuadro. */
async function montar(n: number, tope = 300): Promise<Modulos> {
  vi.resetModules();
  h.tope = tope;
  sessionStorage.clear();
  document.body.innerHTML = new DOMParser().parseFromString(pagina, "text/html").body.innerHTML;
  const participants = await import("./participants");
  const ganadores = await import("./ganadores");
  const turnos = await import("./turnos");
  participants.bindParticipants();
  ganadores.montarGanadores();
  turnos.montarTurnos();
  poner(n);
  return { participants, turnos, ganadores };
}

/** Pone `n` personas en el cuadro, como si se pegaran. */
function poner(n: number): void {
  const ta = $("ta") as HTMLTextAreaElement;
  ta.value = nombres(n);
  ta.dispatchEvent(new Event("input", { bubbles: true }));
}

const escribirPremio = (texto: string): void => {
  premio().value = texto;
  premio().dispatchEvent(new Event("input", { bubbles: true }));
  premio().dispatchEvent(new Event("change", { bubbles: true }));
};

beforeEach(() => {
  history.replaceState(null, "", "/");
});

afterEach(() => {
  vi.unstubAllEnvs();
  history.replaceState(null, "", "/");
});

describe("el markup de la opción", () => {
  it("nace escondida, apagada y con los textos en español y en inglés", () => {
    const html = new DOMParser().parseFromString(pagina, "text/html");
    expect(html.getElementById("turnos-opcion")?.hasAttribute("hidden")).toBe(true);
    expect(html.getElementById("btn-turnos")?.getAttribute("aria-pressed")).toBe("false");
    for (const clave of ["turnsOption", "turnsHelp", "turnsExample", "turnsCount", "turnsPrizeLabel", "turnsPrize", "turnsMas", "turnsLimit"]) {
      for (const l of ["es", "en"] as const) expect(typeof T[l][clave], `${l}.${clave}`).toBe("string");
    }
    expect(T.es.turnsLimit).toContain("{n}");
    expect(T.en.turnsLimit).toContain("{n}");
  });

  it("la ayuda dice lo de la propuesta y el ejemplo es la única línea con «pasanaku»", () => {
    expect(T.es.turnsOption).toBe("Orden de turnos");
    expect(T.en.turnsOption).toBe("Turn order");
    expect(T.es.turnsHelp).toBe("Salen todos, en orden. Ese orden son los turnos.");
    expect(T.en.turnsHelp).toBe("Everyone comes out, in order. That order is the turns.");
    expect(T.es.turnsPrize).toBe("Turnos");
    expect(T.en.turnsPrize).toBe("Turns");
    const claves = Object.keys(T.es).filter((k) => k.startsWith("turns"));
    const conPasanaku = claves.filter((k) => /pasanaku/i.test(String(T.es[k])) || /pasanaku/i.test(String(T.en[k])));
    expect(conPasanaku).toEqual(["turnsExample"]);
    expect(T.es.turnsExample).toMatch(/^Sirve para un pasanaku, para turnos de exposición/);
  });

  it("ningún texto del modo usa las palabras de ganar, en ninguno de los dos idiomas", () => {
    const prohibidas = /ganador|ganan?\b|gané|premio|pozo|suerte|aportes|winner|\bwins?\b|prize|\bpot\b|luck|rifa|lotería|raffle|lottery/i;
    for (const k of Object.keys(T.es).filter((c) => c.startsWith("turns"))) {
      for (const l of ["es", "en"] as const) {
        const v = T[l][k];
        expect(typeof v === "string" ? v : "", `${l}.${k}`).not.toMatch(prohibidas);
        expect(typeof v === "string" ? v : "", `${l}.${k}`).not.toContain(PUNTO_MEDIO);
      }
    }
  });
});

describe("sin la bandera y sin el parámetro la herramienta es la de siempre", () => {
  it("la opción sigue escondida y nada del campo ni de los rótulos cambia", async () => {
    await montar(12);
    expect(opcion().hidden).toBe(true);
    expect(campo().disabled).toBe(false);
    expect(campo().value).toBe("1");
    expect(rotulo('label[for="nw"]')).toBe("Cuántos ganan");
    expect(rotulo("#prize-etiqueta")).toBe("¿Qué sorteás? (opcional)");
    expect(rotulo("#mas-opciones > summary")).toBe("Premio, cuántos ganan y subir CSV");
    expect($("prize-chips").style.display).toBe("");
    expect($("nw-atajos").style.display).toBe("");
    expect(premio().value).toBe("");
  });

  it("la cantidad no sigue a la lista, y una lista más larga que el tope de la red sigue pudiéndose sellar", async () => {
    const { turnos } = await montar(40, 32);
    expect(campo().value).toBe("1");
    expect(sellar().disabled).toBe(false);
    expect(turnos.ordenNoCabe(40)).toBe(false);
    expect(nota().hidden).toBe(true);
    poner(3);
    expect(campo().value).toBe("1");
  });

  it("la dirección sin ?modo no prende nada", async () => {
    const { turnos } = await montar(5);
    turnos.abrirConElModoPedido();
    expect(turnos.modoTurnosActivo()).toBe(false);
    expect(campo().disabled).toBe(false);
  });

  it("el borrador es el de siempre, sin el campo del modo", async () => {
    const { participants } = await montar(6);
    participants.guardarBorrador();
    const guardado = JSON.parse(sessionStorage.getItem(BORRADOR) as string) as Record<string, unknown>;
    expect(Object.keys(guardado).sort()).toEqual(["nw", "premio", "texto"]);
  });
});

describe("a la vista", () => {
  it("con la bandera VITE_MODOS=1 la opción se ve, pero no está elegida", async () => {
    vi.stubEnv("VITE_MODOS", "1");
    const { turnos } = await montar(5);
    expect(opcion().hidden).toBe(false);
    expect(boton().getAttribute("aria-pressed")).toBe("false");
    expect(turnos.modoTurnosActivo()).toBe(false);
    expect(campo().disabled).toBe(false);
  });

  it("con ?modo=turnos la opción se ve y la herramienta abre con ella elegida", async () => {
    history.replaceState(null, "", "/?modo=turnos");
    const { turnos } = await montar(12);
    expect(opcion().hidden).toBe(false);
    turnos.abrirConElModoPedido();
    expect(turnos.modoTurnosActivo()).toBe(true);
    expect(boton().getAttribute("aria-pressed")).toBe("true");
    expect(campo().value).toBe("12");
    expect(campo().disabled).toBe(true);
    expect(premio().value).toBe("Turnos");
    // La opción está en el pliegue: queda abierto para que se vea lo elegido.
    expect(($("mas-opciones") as HTMLDetailsElement).open).toBe(true);
  });

  it("con ?modo=varias la opción se ve pero no se prende: esa es de otra tarea", async () => {
    history.replaceState(null, "", "/?modo=varias");
    const { turnos } = await montar(12);
    expect(opcion().hidden).toBe(false);
    turnos.abrirConElModoPedido();
    expect(turnos.modoTurnosActivo()).toBe(false);
  });
});

describe("prendido: la cantidad sigue a la lista", () => {
  const prender = async (n: number, tope = 300): Promise<Modulos> => {
    history.replaceState(null, "", "/?modo=turnos");
    const m = await montar(n, tope);
    boton().click();
    return m;
  };

  it("al tocar la opción: la cantidad es la de la lista, el campo y los atajos se bloquean, el nombre queda en «Turnos»", async () => {
    await prender(12);
    expect(boton().getAttribute("aria-pressed")).toBe("true");
    expect(campo().value).toBe("12");
    expect(campo().disabled).toBe(true);
    for (const b of document.querySelectorAll<HTMLButtonElement>("#nw-atajos button")) expect(b.disabled).toBe(true);
    expect($("nw-atajos").style.display).toBe("none");
    expect($("prize-chips").style.display).toBe("none");
    expect(premio().value).toBe("Turnos");
    // El nombre se puede editar: no se bloquea.
    expect(premio().disabled).toBe(false);
  });

  it("los rótulos hablan de turnos y no de ganar ni de premio", async () => {
    await prender(12);
    expect(rotulo('label[for="nw"]')).toBe("Cuántos turnos");
    expect(rotulo("#prize-etiqueta")).toBe("Nombre de los turnos (opcional)");
    expect(rotulo("#mas-opciones > summary")).toBe("Orden de turnos, nombre y subir CSV");
    expect(document.querySelector('label[for="nw"]')?.getAttribute("data-i")).toBe("turnsCount");
  });

  it("si la lista cambia, los turnos son la nueva cantidad", async () => {
    await prender(12);
    poner(15);
    expect(campo().value).toBe("15");
    poner(3);
    expect(campo().value).toBe("3");
    poner(2);
    expect(campo().value).toBe("2");
    poner(300);
    expect(campo().value).toBe("300");
  });

  it("con la lista vacía o de una persona la cantidad queda en 1 y no se puede sellar", async () => {
    await prender(0);
    expect(campo().value).toBe("1");
    expect(sellar().disabled).toBe(true);
    poner(1);
    expect(campo().value).toBe("1");
    expect(sellar().disabled).toBe(true);
    poner(2);
    expect(campo().value).toBe("2");
    expect(sellar().disabled).toBe(false);
  });

  it("el resumen de antes de sellar sigue a la lista", async () => {
    await prender(12);
    // Dice los turnos, no cuántos ganan.
    expect($("sellar-resumen").textContent).toBe("12 personas, turnos del 1 al 12. Al sellar, la lista queda cerrada.");
    poner(4);
    expect($("sellar-resumen").textContent).toBe("4 personas, turnos del 1 al 4. Al sellar, la lista queda cerrada.");
    // Si el nombre ya no empieza con «Turnos», el resumen vuelve a ser el de siempre.
    premio().value = "Termo";
    premio().dispatchEvent(new Event("input", { bubbles: true }));
    expect($("sellar-resumen").textContent).toContain("4 personas, 4 ganadores, Termo");
  });

  it("apagarlo devuelve el campo y el nombre a lo que tenían", async () => {
    history.replaceState(null, "", "/?modo=turnos");
    const { turnos, ganadores } = await montar(12);
    ganadores.ponerGanadores(3);
    escribirPremio("Termo");
    turnos.ponerModoTurnos(true);
    expect(premio().value).toBe("Turnos");
    turnos.ponerModoTurnos(false);
    expect(campo().value).toBe("3");
    expect(campo().disabled).toBe(false);
    expect(premio().value).toBe("Termo");
    expect(rotulo('label[for="nw"]')).toBe("Cuántos ganan");
    expect($("nw-atajos").style.display).toBe("");
    expect($("prize-chips").style.display).toBe("");
  });

  it("el campo queda bloqueado aunque la lista se cierre y se vuelva a abrir; la opción se bloquea con la lista", async () => {
    const { participants } = await prender(12);
    participants.cerrarLista(true);
    expect(boton().disabled).toBe(true);
    expect(campo().disabled).toBe(true);
    participants.cerrarLista(false);
    expect(boton().disabled).toBe(false);
    expect(campo().disabled).toBe(true);
  });
});

describe("el nombre de los turnos", () => {
  it("lo que escribe la persona queda si empieza con «Turnos» o «Turns»; si no, la palabra va por delante", async () => {
    history.replaceState(null, "", "/?modo=turnos");
    await montar(5);
    boton().click();
    escribirPremio("Turnos de limpieza");
    expect(premio().value).toBe("Turnos de limpieza");
    escribirPremio("turns for the lab");
    expect(premio().value).toBe("turns for the lab");
    escribirPremio("Orden de noviembre");
    expect(premio().value).toBe("Turnos: Orden de noviembre");
    escribirPremio("");
    expect(premio().value).toBe("Turnos");
    escribirPremio("Turnstile");
    expect(premio().value).toBe("Turnos: Turnstile");
  });

  it("antes de sellar se ajusta aunque no haya salido del cuadro, y fuera del modo no toca nada", async () => {
    history.replaceState(null, "", "/?modo=turnos");
    const { turnos } = await montar(5);
    expect(turnos.ajustarPremioDeTurnos()).toBe("");
    escribirPremio("  Termo  ");
    expect(turnos.ajustarPremioDeTurnos()).toBe("Termo");
    expect(premio().value).toBe("  Termo  ");
    boton().click();
    premio().value = "Orden de turnos del grupo";
    expect(turnos.ajustarPremioDeTurnos()).toBe("Turnos: Orden de turnos del grupo");
    expect(premio().value).toBe("Turnos: Orden de turnos del grupo");
  });

  it("al cambiar de idioma, el nombre por defecto se traduce y uno escrito no se toca", async () => {
    history.replaceState(null, "", "/?modo=turnos");
    const { turnos } = await montar(5);
    const { setLang } = await import("../i18n");
    turnos.ponerModoTurnos(true);
    setLang("en");
    expect(premio().value).toBe("Turns");
    expect(rotulo('label[for="nw"]')).toBe("How many turns");
    escribirPremio("Turnos de limpieza");
    setLang("es");
    expect(premio().value).toBe("Turnos de limpieza");
    expect(rotulo('label[for="nw"]')).toBe("Cuántos turnos");
  });
});

describe("el tope de la red: un orden incompleto no se sella", () => {
  const prender = async (n: number, tope: number): Promise<Modulos> => {
    history.replaceState(null, "", "/?modo=turnos");
    const m = await montar(n, tope);
    boton().click();
    return m;
  };

  it("en testnet (32): 40 personas, no se puede sellar y se dice llano", async () => {
    const { turnos } = await prender(40, 32);
    expect(turnos.ordenNoCabe()).toBe(true);
    expect(sellar().disabled).toBe(true);
    expect(nota().hidden).toBe(false);
    expect(nota().textContent).toBe("En esta red el orden llega hasta 32 turnos: con más, no se puede sellar.");
    // Los turnos son los de la lista entera: no se recorta a 32 haciéndolo pasar por un orden.
    expect(campo().value).toBe("40");
  });

  it("con la lista que no entra, el resumen de antes de sellar no promete el sello", async () => {
    await prender(40, 32);
    expect($("sellar-resumen").textContent).toBe("40 personas, turnos del 1 al 40.");
    expect($("sellar-resumen").textContent).not.toContain("Al sellar");
    // Con una lista que sí entra, la promesa del sello vuelve.
    poner(20);
    expect($("sellar-resumen").textContent).toBe("20 personas, turnos del 1 al 20. Al sellar, la lista queda cerrada.");
  });

  it("el aviso habla de turnos, no de personas: 20 personas con 2 turnos cada una son 40 turnos y no entran", async () => {
    expect(T.es.turnsLimit).toContain("turnos");
    expect(T.es.turnsLimit).not.toContain("personas");
    expect(T.en.turnsLimit).toContain("turns");
    expect(T.en.turnsLimit).not.toContain("people");
    await prender(2, 32);
    const ta = $("ta") as HTMLTextAreaElement;
    ta.value = Array.from({ length: 20 }, (_, i) => [`Persona ${i + 1} (1/2)`, `Persona ${i + 1} (2/2)`]).flat().join("\n");
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    expect(sellar().disabled).toBe(true);
    expect(nota().hidden).toBe(false);
    expect(nota().textContent).toBe("En esta red el orden llega hasta 32 turnos: con más, no se puede sellar.");
    expect($("sellar-resumen").textContent).toContain("20 personas, 40 turnos");
  });

  it("más de 300 líneas: el resumen no habla de ganadores ni promete el sello, y sellar sigue apagado", async () => {
    for (const lineas of [301, 320]) {
      await prender(lineas, 300);
      const resumen = $("sellar-resumen").textContent ?? "";
      expect(resumen, `${lineas}`).toBe(`${lineas} personas, turnos del 1 al ${lineas}.`);
      expect(resumen, `${lineas}`).not.toMatch(/ganador|Al sellar/);
      expect(sellar().disabled, `${lineas}`).toBe(true);
    }
  });

  it("justo por encima del tope de una red chica, lo mismo", async () => {
    await prender(33, 32);
    expect($("sellar-resumen").textContent).toBe("33 personas, turnos del 1 al 33.");
    expect(sellar().disabled).toBe(true);
  });

  it("con 32 entra, con 33 no; al volver a una lista que entra, el aviso se va y se puede sellar", async () => {
    const { turnos } = await prender(32, 32);
    expect(turnos.ordenNoCabe()).toBe(false);
    expect(sellar().disabled).toBe(false);
    expect(nota().hidden).toBe(true);
    poner(33);
    expect(turnos.ordenNoCabe()).toBe(true);
    expect(sellar().disabled).toBe(true);
    expect(nota().hidden).toBe(false);
    poner(20);
    expect(sellar().disabled).toBe(false);
    expect(nota().hidden).toBe(true);
    expect(nota().textContent).toBe("");
  });

  it("apagar el modo con una lista que no entra deja sellar como siempre", async () => {
    const { turnos } = await prender(40, 32);
    expect(sellar().disabled).toBe(true);
    turnos.ponerModoTurnos(false);
    expect(sellar().disabled).toBe(false);
    expect(nota().hidden).toBe(true);
  });

  it("el aviso se vuelve a escribir en inglés", async () => {
    await prender(40, 32);
    const { setLang } = await import("../i18n");
    setLang("en");
    expect(nota().textContent).toBe("On this network the order goes up to 32 turns: with more, it can't be sealed.");
  });

  it("con el contrato de 300 una lista de 300 entra", async () => {
    const { turnos } = await prender(300, 300);
    expect(turnos.ordenNoCabe()).toBe(false);
    expect(sellar().disabled).toBe(false);
    expect(campo().value).toBe("300");
  });
});

describe("el borrador guarda el modo", () => {
  it("lo guarda junto con la cantidad y lo repone en otra carga, aunque la dirección ya no traiga ?modo", async () => {
    history.replaceState(null, "", "/?modo=turnos");
    const { participants, turnos } = await montar(12);
    turnos.ponerModoTurnos(true);
    escribirPremio("Turnos de limpieza");
    participants.guardarBorrador();
    const guardado = sessionStorage.getItem(BORRADOR) as string;
    expect(JSON.parse(guardado)).toMatchObject({ nw: 12, premio: "Turnos de limpieza", modo: "turnos" });

    // Volver de entrar con Google: la dirección es "/" y la página nace con el cuadro vacío.
    history.replaceState(null, "", "/");
    const otra = await montar(0);
    sessionStorage.setItem(BORRADOR, guardado);
    otra.participants.reponerBorrador();
    expect(otra.turnos.modoTurnosActivo()).toBe(true);
    expect(opcion().hidden).toBe(false);
    expect(campo().value).toBe("12");
    expect(campo().disabled).toBe(true);
    expect(premio().value).toBe("Turnos de limpieza");
    expect(boton().getAttribute("aria-pressed")).toBe("true");
  });

  it("un borrador sin modo no prende nada", async () => {
    const q = await montar(0);
    sessionStorage.setItem(BORRADOR, JSON.stringify({ texto: nombres(8), premio: "", nw: 2 }));
    q.participants.reponerBorrador();
    expect(q.turnos.modoTurnosActivo()).toBe(false);
    expect(campo().value).toBe("2");
    expect(campo().disabled).toBe(false);
  });

  it("al prender el modo se guarda el borrador enseguida", async () => {
    vi.useFakeTimers();
    try {
      history.replaceState(null, "", "/?modo=turnos");
      await montar(7);
      boton().click();
      vi.advanceTimersByTime(500);
      expect(JSON.parse(sessionStorage.getItem(BORRADOR) as string)).toMatchObject({ nw: 7, modo: "turnos" });
    } finally {
      vi.useRealTimers();
    }
  });
});
