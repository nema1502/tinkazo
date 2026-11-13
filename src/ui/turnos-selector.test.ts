// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { T } from "../i18n";

/**
 * El modo se elige a la vista (13 de noviembre de 2026): dos botones grandes arriba de la lista, Sortear premios y Orden de
 * turnos, en lugar de un renglón dentro del pliegue de las opciones, donde casi nadie lo encontraba. Es una elección
 * previa: no compite con Pegar lista ni con Sellar la lista, y con la lista cerrada se queda quieta. Lo que se sella y
 * quién puede salir no cambian (eso lo cuidan `turnos.test.ts` y `src/modos/`).
 *
 * Varias participaciones por persona no es un modo aparte: vale en los dos (en un orden se lee Alguien tiene más de un
 * turno) y sigue debajo de la lista, donde se marca.
 */

const pagina = readFileSync(join(process.cwd(), "index.html"), "utf8");
const estilos = readFileSync(join(process.cwd(), "src", "styles.css"), "utf8");
const nombres = (n: number): string => Array.from({ length: n }, (_, i) => `Participante ${i + 1}`).join("\n");
const $ = (id: string): HTMLElement => document.getElementById(id) as HTMLElement;
const sorteo = (): HTMLButtonElement => $("btn-modo-sorteo") as HTMLButtonElement;
const turnos = (): HTMLButtonElement => $("btn-turnos") as HTMLButtonElement;
const titulo = (): string => document.querySelector("#sec-participants .head h2")?.textContent ?? "";
const ayuda = (): string => $("turnos-ayuda").textContent ?? "";
const pliegue = (): HTMLDetailsElement => $("mas-opciones") as HTMLDetailsElement;
const unMomento = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

/** Las claves que se ven en el selector, en el título del paso y en el pliegue según el modo. */
const CLAVES = ["modoRotulo", "modoSorteo", "modoSorteoSub", "modoSorteoAyuda", "turnsOption", "turnsExample", "turnsHelp", "turnsTitulo", "turnsMas", "masOpciones"] as const;
/** Las comillas angulares, el punto medio, la raya larga y la flecha no se escriben en ningún texto que se vea: se arman con su código. */
const PROHIBIDOS = new RegExp(`[;${String.fromCharCode(0xab, 0xbb, 0xb7, 0x2014, 0x2192)}]|rifa|loter[ií]a|raffle|ticket|boleto|apuesta|\\bbet\\b`, "i");
const JERGA = /\b(XLM|drand|hash|firma|token|transacci[oó]n|blockchain|Soroban|Stellar|modo)\b/i;

interface Modulos {
  participants: typeof import("./participants");
  turnos: typeof import("./turnos");
  i18n: typeof import("../i18n");
}

/** Arma la página como `main.ts`: la lista, los campos, el selector y el pliegue, con `n` personas en el cuadro. */
async function montar(n: number): Promise<Modulos> {
  vi.resetModules();
  sessionStorage.clear();
  document.body.innerHTML = new DOMParser().parseFromString(pagina, "text/html").body.innerHTML;
  const i18n = await import("../i18n");
  i18n.setLang("es");
  const participants = await import("./participants");
  const ganadores = await import("./ganadores");
  const t = await import("./turnos");
  const plegable = await import("./plegable");
  participants.bindParticipants();
  ganadores.montarGanadores();
  t.montarTurnos();
  plegable.initPlegables();
  const ta = $("ta") as HTMLTextAreaElement;
  ta.value = nombres(n);
  ta.dispatchEvent(new Event("input", { bubbles: true }));
  return { participants, turnos: t, i18n };
}

beforeEach(() => {
  history.replaceState(null, "", "/");
});

afterEach(() => {
  vi.unstubAllEnvs();
  history.replaceState(null, "", "/");
});

describe("el markup del selector", () => {
  const html = new DOMParser().parseFromString(pagina, "text/html");
  const opcion = html.getElementById("turnos-opcion") as HTMLElement;

  it("está fuera del pliegue, en la sección de la lista y antes de Pegar lista", () => {
    expect(opcion).not.toBeNull();
    expect(html.getElementById("mas-opciones")?.contains(opcion)).toBe(false);
    expect(html.getElementById("sec-participants")?.contains(opcion)).toBe(true);
    const pegar = html.getElementById("btn-pegar") as HTMLElement;
    expect(opcion.compareDocumentPosition(pegar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Y antes del botón de sellar: es una elección previa.
    const sellar = html.getElementById("btn-freeze") as HTMLElement;
    expect(opcion.compareDocumentPosition(sellar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("dos botones en un grupo con su rótulo, Sortear premios elegido de entrada", () => {
    const grupo = opcion.querySelector('[role="group"]') as HTMLElement;
    expect(grupo).not.toBeNull();
    const rotulo = html.getElementById(grupo.getAttribute("aria-labelledby") ?? "");
    expect(rotulo?.getAttribute("data-i")).toBe("modoRotulo");
    const botones = [...grupo.querySelectorAll("button")];
    expect(botones.map((b) => b.id)).toEqual(["btn-modo-sorteo", "btn-turnos"]);
    expect(html.getElementById("btn-modo-sorteo")?.getAttribute("aria-pressed")).toBe("true");
    expect(html.getElementById("btn-turnos")?.getAttribute("aria-pressed")).toBe("false");
    for (const b of botones) {
      expect(b.getAttribute("type"), b.id).toBe("button");
      // El texto va en dos partes con su clave: el nombre y para qué sirve. El botón no lleva clave propia, que lo pisaría.
      expect(b.hasAttribute("data-i"), b.id).toBe(false);
      expect(b.querySelector(".modo-tit[data-i]"), b.id).not.toBeNull();
      expect(b.querySelector(".modo-sub[data-i]"), b.id).not.toBeNull();
    }
    expect(html.querySelector("#btn-turnos .modo-sub")?.getAttribute("data-i")).toBe("turnsExample");
    // La ayuda que cambia con el modo nace con la del sorteo común.
    expect(html.getElementById("turnos-ayuda")?.getAttribute("data-i")).toBe("modoSorteoAyuda");
    // Nace escondido: sin la bandera ni el parámetro, la herramienta es la de siempre.
    expect(opcion.hasAttribute("hidden")).toBe(true);
  });

  it("el título del paso tiene su id para cambiar con el modo", () => {
    const span = html.querySelector("#sec-participants .head h2 > span") as HTMLElement;
    expect(span.id).toBe("p1-titulo");
    expect(span.getAttribute("data-i")).toBe("p1");
  });
});

describe("los textos del selector", () => {
  it("existen en español y en inglés, sin comillas angulares, punto y coma, rayas ni palabras de apuesta, y sin jerga", () => {
    for (const l of ["es", "en"] as const) {
      for (const k of CLAVES) {
        const v = T[l][k];
        expect(typeof v, `${l}.${k}`).toBe("string");
        expect(String(v), `${l}.${k}`).not.toMatch(PROHIBIDOS);
        expect(String(v), `${l}.${k}`).not.toMatch(JERGA);
      }
    }
  });

  it("dicen para qué sirve cada uno con palabras de la gente, y el pasanaku es un ejemplo entre otros", () => {
    expect(T.es.modoSorteo).toBe("Sortear premios");
    expect(T.en.modoSorteo).toBe("Draw prizes");
    expect(T.es.turnsOption).toBe("Orden de turnos");
    expect(T.es.turnsExample).toMatch(/pasanaku/);
    expect(T.es.turnsExample).toMatch(/exposiciones/);
    expect(T.en.turnsExample).toMatch(/pasanaku/);
    expect(T.en.turnsExample).toMatch(/presentations/);
    // La ayuda del orden dice que salen todos, no un ganador.
    expect(T.es.turnsHelp).toMatch(/Salen todos, en orden/);
    // Y el pliegue del sorteo común ya no nombra el orden de turnos: está a la vista, arriba.
    expect(T.es.masOpciones).not.toMatch(/turnos/);
  });

  it("los rótulos cortos entran en un botón del celular: nombre de hasta 16 letras y para qué sirve de hasta 32", () => {
    for (const l of ["es", "en"] as const) {
      for (const k of ["modoSorteo", "turnsOption"] as const) expect(String(T[l][k]).length, `${l}.${k}`).toBeLessThanOrEqual(16);
      for (const k of ["modoSorteoSub", "turnsExample"] as const) expect(String(T[l][k]).length, `${l}.${k}`).toBeLessThanOrEqual(32);
    }
  });
});

describe("elegir el modo con un toque", () => {
  it("con los modos a la vista, el selector se ve con Sortear premios elegido", async () => {
    vi.stubEnv("VITE_MODOS", "1");
    const { turnos: m } = await montar(8);
    expect($("turnos-opcion").hidden).toBe(false);
    expect(sorteo().getAttribute("aria-pressed")).toBe("true");
    expect(turnos().getAttribute("aria-pressed")).toBe("false");
    expect($("modo-botones").dataset.modo).toBe("sorteo");
    expect(m.modoTurnosActivo()).toBe(false);
    expect(titulo()).toBe("Participantes");
    expect(pliegue().querySelector("summary")?.textContent).toBe("Premio, cuántos ganan y subir CSV");
  });

  it("tocar Orden de turnos lo elige: cambian el título del paso, la ayuda y el resumen de junto al botón, y el pliegue no se abre", async () => {
    vi.stubEnv("VITE_MODOS", "1");
    const { turnos: m } = await montar(8);
    turnos().click();
    await unMomento();
    expect(m.modoTurnosActivo()).toBe(true);
    expect(turnos().getAttribute("aria-pressed")).toBe("true");
    expect(sorteo().getAttribute("aria-pressed")).toBe("false");
    expect($("modo-botones").dataset.modo).toBe("turnos");
    expect(titulo()).toBe("Quiénes tienen turno");
    expect(ayuda()).toBe("Salen todos, en orden. Ese orden son los turnos.");
    expect($("sellar-resumen").textContent).toBe("8 personas, turnos del 1 al 8. Al sellar, la lista queda cerrada.");
    // El nombre «Turnos» y la cantidad los pone la herramienta: no son algo elegido dentro del pliegue.
    expect(pliegue().open).toBe(false);
    expect(pliegue().querySelector("summary")?.textContent).toBe("Nombre de los turnos y subir CSV");
    // El botón principal sigue siendo el mismo: sellar la lista es la misma acción en los dos modos.
    expect($("btn-freeze").textContent).toBe("Sellar la lista");
  });

  it("tocar otra vez Orden de turnos no lo apaga, y Sortear premios vuelve al sorteo común", async () => {
    vi.stubEnv("VITE_MODOS", "1");
    const { turnos: m } = await montar(8);
    turnos().click();
    turnos().click();
    expect(m.modoTurnosActivo()).toBe(true);
    sorteo().click();
    await unMomento();
    expect(m.modoTurnosActivo()).toBe(false);
    expect(sorteo().getAttribute("aria-pressed")).toBe("true");
    expect(turnos().getAttribute("aria-pressed")).toBe("false");
    expect($("modo-botones").dataset.modo).toBe("sorteo");
    expect(titulo()).toBe("Participantes");
    expect(ayuda()).toBe("De la lista salen quienes ganan. Vos elegís cuántos.");
    expect(($("nw") as HTMLInputElement).value).toBe("1");
    expect($("sellar-resumen").textContent).toContain("8 personas, 1 ganador");
    // Tocar el que ya está elegido no hace nada.
    sorteo().click();
    expect(m.modoTurnosActivo()).toBe(false);
  });

  it("un premio escrito por la persona en un orden sí abre el pliegue, como siempre", async () => {
    vi.stubEnv("VITE_MODOS", "1");
    await montar(8);
    turnos().click();
    await unMomento();
    expect(pliegue().open).toBe(false);
    const premio = $("prize") as HTMLInputElement;
    premio.value = "Turnos de limpieza";
    premio.dispatchEvent(new Event("input", { bubbles: true }));
    expect(pliegue().open).toBe(true);
  });

  it("en el sorteo común, más de un ganador sigue abriendo el pliegue", async () => {
    vi.stubEnv("VITE_MODOS", "1");
    await montar(8);
    const nw = $("nw") as HTMLInputElement;
    nw.value = "3";
    nw.dispatchEvent(new Event("change", { bubbles: true }));
    expect(pliegue().open).toBe(true);
  });

  it("cada cambio vuelve a disparar la animación del título y de la ayuda", async () => {
    vi.stubEnv("VITE_MODOS", "1");
    await montar(8);
    expect($("turnos-ayuda").classList.contains("modo-cambia")).toBe(false);
    turnos().click();
    expect($("turnos-ayuda").classList.contains("modo-cambia")).toBe(true);
    expect($("p1-titulo").classList.contains("modo-cambia")).toBe(true);
  });

  it("con ?modo=turnos abre con el orden elegido en el selector y el pliegue cerrado", async () => {
    history.replaceState(null, "", "/?modo=turnos");
    const { turnos: m } = await montar(12);
    m.abrirConElModoPedido();
    await unMomento();
    expect(turnos().getAttribute("aria-pressed")).toBe("true");
    expect(sorteo().getAttribute("aria-pressed")).toBe("false");
    expect(titulo()).toBe("Quiénes tienen turno");
    expect(pliegue().open).toBe(false);
  });
});

describe("con la lista cerrada el modo ya no se cambia", () => {
  it("los dos botones se apagan, el selector se queda donde está y el modo no cambia", async () => {
    vi.stubEnv("VITE_MODOS", "1");
    const { participants, turnos: m } = await montar(8);
    turnos().click();
    participants.cerrarLista(true);
    expect(sorteo().disabled).toBe(true);
    expect(turnos().disabled).toBe(true);
    expect($("turnos-opcion").hidden).toBe(false);
    sorteo().click();
    expect(m.modoTurnosActivo()).toBe(true);
    expect(turnos().getAttribute("aria-pressed")).toBe("true");
    participants.cerrarLista(false);
    expect(sorteo().disabled).toBe(false);
    expect(turnos().disabled).toBe(false);
  });
});

describe("el idioma", () => {
  it("al cambiar de idioma se traducen el rótulo, las dos opciones, el título y la ayuda", async () => {
    vi.stubEnv("VITE_MODOS", "1");
    const { i18n } = await montar(8);
    turnos().click();
    i18n.setLang("en");
    expect($("modo-rotulo").textContent).toBe(String(T.en.modoRotulo));
    expect(sorteo().querySelector(".modo-tit")?.textContent).toBe("Draw prizes");
    expect(turnos().querySelector(".modo-tit")?.textContent).toBe("Turn order");
    expect(turnos().querySelector(".modo-sub")?.textContent).toBe(String(T.en.turnsExample));
    expect(titulo()).toBe(String(T.en.turnsTitulo));
    expect(ayuda()).toBe("Everyone is drawn, in order. That order sets the turns.");
    i18n.setLang("es");
    expect(titulo()).toBe("Quiénes tienen turno");
  });
});

describe("los estilos del selector", () => {
  /** Las reglas de styles.css cuyo selector nombra el selector de modo. */
  const reglas = [...estilos.matchAll(/([^{}]*\.modo-[^{}]*)\{([^{}]*)\}/g)].map((m) => ({ selector: (m[1] ?? "").trim(), cuerpo: m[2] ?? "" }));

  it("blancos de toque de 48 px o más", () => {
    const op = reglas.find((r) => /\.modo-op\s*$/.test(r.selector) || /\.modo-op\s*,/.test(r.selector));
    expect(op, "la regla de .modo-op").toBeDefined();
    const alto = Number(/min-height:\s*(\d+)px/.exec(op?.cuerpo ?? "")?.[1] ?? 0);
    expect(alto).toBeGreaterThanOrEqual(48);
  });

  it("el cambio se anima entre 160 y 220 ms", () => {
    const tiempos = reglas.flatMap((r) => [...r.cuerpo.matchAll(/(?:transition|animation)[^;]*?(\d+)ms/g)].map((m) => Number(m[1])));
    expect(tiempos.length).toBeGreaterThan(0);
    for (const ms of tiempos) {
      expect(ms).toBeGreaterThanOrEqual(160);
      expect(ms).toBeLessThanOrEqual(220);
    }
  });

  it("en el celular entra compacto: los dos botones lado a lado, solo con el nombre y sin el rótulo", () => {
    const bloques = [...estilos.matchAll(/@media \(max-width: 460px\)[^{]*\{([^@]*?)\}\s*\}/g)].map((m) => m[1] ?? "");
    const celular = bloques.find((b) => b.includes(".modo-"));
    expect(celular, "un bloque del celular para el selector").toBeDefined();
    const enCelular = [...(celular ?? "").matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ selector: (m[1] ?? "").trim(), cuerpo: m[2] ?? "" }));
    const regla = (re: RegExp): string => enCelular.filter((r) => re.test(r.selector)).map((r) => r.cuerpo).join(";");
    // Uno debajo del otro, con para qué sirve y el rótulo, medía 231 px y sacaba Pegar lista de una pantalla de 664.
    expect(regla(/\.modo-botones\s*$/)).not.toMatch(/grid-template-columns:\s*1fr\s*(;|$)/);
    expect(regla(/\.modo-sub/)).toMatch(/display:\s*none/);
    expect(regla(/\.modo-rotulo/)).toMatch(/display:\s*none/);
    // Y el toque sigue siendo grande.
    const alto = Number(/min-height:\s*(\d+)px/.exec(regla(/\.modo-op\s*$/))?.[1] ?? 48);
    expect(alto).toBeGreaterThanOrEqual(48);
  });

  it("con menos movimiento no se anima", () => {
    const bloques = [...estilos.matchAll(/@media \(prefers-reduced-motion: reduce\)\s*\{([^@]*?)\}\s*\}/g)].map((m) => m[1] ?? "");
    const delSelector = bloques.find((b) => b.includes(".modo-"));
    expect(delSelector, "un bloque de prefers-reduced-motion para el selector").toBeDefined();
    expect(delSelector).toMatch(/transition:\s*none/);
    expect(delSelector).toMatch(/animation:\s*none/);
  });
});
