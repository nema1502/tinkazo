// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { T } from "../i18n";

/**
 * La i del selector de modos (20 de noviembre de 2026). Debajo de Sortear premios, Orden de turnos y Amigo secreto se
 * leían uno o dos párrafos de ayuda, y en el celular eran demasiado texto. Ahora lo que hace el modo elegido va plegado
 * detrás de una i pegada al marco: cerrada de entrada, se abre y se cierra con un toque, y abierta muestra la del modo
 * que esté elegido. Desde el issue #95 la nota del tope de la red se ve ya al elegir el modo (con la i cerrada, al
 * elegir Orden de turnos o Amigo secreto hay un párrafo a la vista), y lo que frena algo no se pliega: la lista que
 * no entra, que con 2 o 3 personas no hay secreto y la persona repetida de un Amigo secreto se ven cuando pasan.
 */

const h = vi.hoisted(() => ({ tope: 300 }));
vi.mock("../stellar/config", async (orig) => ({ ...(await orig<typeof import("../stellar/config")>()), topeDeGanadores: () => h.tope }));

const pagina = readFileSync(join(process.cwd(), "index.html"), "utf8");
const estilos = readFileSync(join(process.cwd(), "src", "styles.css"), "utf8");
const nombres = (n: number): string => Array.from({ length: n }, (_, i) => `Participante ${i + 1}`).join("\n");
const $ = (id: string): HTMLElement => document.getElementById(id) as HTMLElement;
const laI = (): HTMLButtonElement => $("btn-modo-info") as HTMLButtonElement;
const panel = (): HTMLElement => $("modo-info");
const nota = (): HTMLElement => $("turnos-nota");
const boton = (id: string): HTMLButtonElement => $(id) as HTMLButtonElement;

/** ¿Se ve? Ni el elemento ni ninguno de los que lo contienen está escondido. */
function aLaVista(el: Element): boolean {
  for (let n: Element | null = el; n; n = n.parentElement) {
    if (n instanceof HTMLElement && (n.hidden || n.style.display === "none")) return false;
  }
  return true;
}

/** Los párrafos del selector que se ven ahora, con su texto. */
const parrafosALaVista = (): string[] =>
  [...$("turnos-opcion").querySelectorAll("p")].filter((p) => p.id !== "modo-rotulo" && aLaVista(p)).map((p) => p.textContent ?? "");

interface Modulos {
  turnos: typeof import("./turnos");
  i18n: typeof import("../i18n");
}

/** Arma la página como `main.ts`, con los modos a la vista y `lista` en el cuadro. */
async function montar(lista: string, tope = 300): Promise<Modulos> {
  vi.resetModules();
  vi.stubEnv("VITE_MODOS", "1");
  h.tope = tope;
  sessionStorage.clear();
  document.body.innerHTML = new DOMParser().parseFromString(pagina, "text/html").body.innerHTML;
  const i18n = await import("../i18n");
  i18n.setLang("es");
  const participants = await import("./participants");
  const ganadores = await import("./ganadores");
  const turnos = await import("./turnos");
  participants.bindParticipants();
  ganadores.montarGanadores();
  turnos.montarTurnos();
  const ta = $("ta") as HTMLTextAreaElement;
  ta.value = lista;
  ta.dispatchEvent(new Event("input", { bubbles: true }));
  return { turnos, i18n };
}

beforeEach(() => {
  history.replaceState(null, "", "/");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  history.replaceState(null, "", "/");
});

describe("el markup de la i", () => {
  const html = new DOMParser().parseFromString(pagina, "text/html");
  const i = html.getElementById("btn-modo-info") as HTMLElement;

  it("es un botón con su nombre para el lector de pantalla, que dice qué abre y nace cerrado", () => {
    expect(i.tagName).toBe("BUTTON");
    expect(i.getAttribute("type")).toBe("button");
    expect(i.getAttribute("aria-expanded")).toBe("false");
    expect(i.getAttribute("aria-controls")).toBe("modo-info");
    expect(i.getAttribute("data-i-aria")).toBe("modoInfo");
    expect(i.getAttribute("aria-label")).toBe(T.es.modoInfo);
  });

  it("lleva la i dibujada, escondida para el lector de pantalla, y ningún texto propio", () => {
    expect(i.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    expect(i.querySelector("svg circle")).not.toBeNull();
    expect(i.textContent?.trim()).toBe("");
  });

  it("va fuera de la grilla de los tres botones, pegada al marco, y el panel abre debajo de ella", () => {
    const grupo = html.getElementById("modo-botones") as HTMLElement;
    expect(grupo.contains(i)).toBe(false);
    expect(html.getElementById("turnos-opcion")?.contains(i)).toBe(true);
    expect(grupo.compareDocumentPosition(i) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const caja = html.getElementById("modo-info") as HTMLElement;
    expect(i.compareDocumentPosition(caja) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(caja.hasAttribute("hidden")).toBe(true);
  });

  it("la ayuda del modo vive dentro del panel, y la nota de los avisos queda fuera", () => {
    const caja = html.getElementById("modo-info") as HTMLElement;
    expect(caja.contains(html.getElementById("turnos-ayuda"))).toBe(true);
    expect(caja.contains(html.getElementById("turnos-nota"))).toBe(false);
  });

  it("su nombre existe en español y en inglés", () => {
    expect(T.es.modoInfo).toBe("Qué hace esta opción");
    expect(T.en.modoInfo).toBe("What this option does");
  });
});

describe("abrir y cerrar", () => {
  it("cerrada por defecto: el panel no se ve y aria-expanded dice false", async () => {
    await montar(nombres(10));
    expect(panel().hidden).toBe(true);
    expect(laI().getAttribute("aria-expanded")).toBe("false");
  });

  it("un toque la abre y otro la cierra, con aria-expanded al día", async () => {
    await montar(nombres(10));
    laI().click();
    expect(panel().hidden).toBe(false);
    expect(laI().getAttribute("aria-expanded")).toBe("true");
    expect(aLaVista($("turnos-ayuda"))).toBe(true);
    laI().click();
    expect(panel().hidden).toBe(true);
    expect(laI().getAttribute("aria-expanded")).toBe("false");
  });

  it("Escape la cierra con el foco en el selector y deja el foco en la i", async () => {
    await montar(nombres(10));
    laI().click();
    laI().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(panel().hidden).toBe(true);
    expect(laI().getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(laI());
  });

  it("al abrirla lleva el panel a la vista lo justo, sin saltos si ya se ve", async () => {
    await montar(nombres(10));
    const llevar = vi.fn();
    panel().scrollIntoView = llevar;
    laI().click();
    expect(llevar).toHaveBeenCalledTimes(1);
    expect(llevar).toHaveBeenCalledWith({ block: "nearest", behavior: "smooth" });
  });

  it("al cerrarla no mueve la página", async () => {
    await montar(nombres(10));
    const llevar = vi.fn();
    panel().scrollIntoView = llevar;
    laI().click();
    laI().click();
    expect(llevar).toHaveBeenCalledTimes(1);
  });

  it("con el movimiento reducido, el panel llega a la vista sin animación", async () => {
    await montar(nombres(10));
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("reduce") }) as MediaQueryList);
    const llevar = vi.fn();
    panel().scrollIntoView = llevar;
    laI().click();
    expect(llevar).toHaveBeenCalledWith({ block: "nearest", behavior: "auto" });
  });

  it("al cambiar de idioma, el nombre de la i se traduce", async () => {
    const { i18n } = await montar(nombres(10));
    i18n.setLang("en");
    expect(laI().getAttribute("aria-label")).toBe(T.en.modoInfo);
    i18n.setLang("es");
    expect(laI().getAttribute("aria-label")).toBe(T.es.modoInfo);
  });
});

describe("con la i cerrada solo se ve la nota del modo", () => {
  it("en Sortear premios no se ve nada", async () => {
    await montar(nombres(10));
    expect(parrafosALaVista()).toEqual([]);
  });

  it("en Orden de turnos, el tope de la red (issue #95: se ve ya al elegir)", async () => {
    await montar(nombres(10));
    boton("btn-turnos").click();
    expect(parrafosALaVista()).toEqual([String(T.es.turnsCap).replace("{n}", String(h.tope))]);
  });

  it("en Amigo secreto, su tope, y ni la ayuda ni lo que el modo no protege", async () => {
    await montar(nombres(10));
    boton("btn-amigo").click();
    expect(parrafosALaVista()).toEqual([String(T.es.amigoCap).replace("{n}", String(h.tope))]);
    expect(panel().contains($("amigo-privacidad"))).toBe(true);
  });
});

describe("abierta, muestra el modo elegido", () => {
  it("en Sortear premios, su ayuda", async () => {
    await montar(nombres(10));
    laI().click();
    expect(parrafosALaVista()).toEqual([T.es.modoSorteoAyuda]);
  });

  it("al pasar a Orden de turnos sigue abierta y dice la del orden, con el tope debajo", async () => {
    await montar(nombres(10));
    laI().click();
    boton("btn-turnos").click();
    expect(panel().hidden).toBe(false);
    expect(parrafosALaVista()).toEqual([T.es.turnsHelp, String(T.es.turnsCap).replace("{n}", String(h.tope))]);
  });

  it("al pasar a Amigo secreto dice la ayuda, que el reparto se puede calcular y su tope", async () => {
    await montar(nombres(10));
    laI().click();
    boton("btn-amigo").click();
    expect(panel().hidden).toBe(false);
    expect(parrafosALaVista()).toEqual([T.es.amigoHelp, T.es.amigoPrivacidad, String(T.es.amigoCap).replace("{n}", String(h.tope))]);
  });

  it("al volver a Sortear premios ya no dice lo del Amigo secreto", async () => {
    await montar(nombres(10));
    boton("btn-amigo").click();
    laI().click();
    boton("btn-modo-sorteo").click();
    expect(parrafosALaVista()).toEqual([T.es.modoSorteoAyuda]);
  });

  it("cerrada, cambiar de modo no la abre", async () => {
    await montar(nombres(10));
    boton("btn-amigo").click();
    boton("btn-turnos").click();
    expect(panel().hidden).toBe(true);
    expect(laI().getAttribute("aria-expanded")).toBe("false");
  });
});

describe("lo que frena algo no se pliega", () => {
  it("con 3 personas en un Amigo secreto, que no hay secreto se ve con la i cerrada", async () => {
    await montar(nombres(3));
    boton("btn-amigo").click();
    expect(panel().hidden).toBe(true);
    expect(aLaVista(nota())).toBe(true);
    expect(parrafosALaVista()).toEqual([T.es.amigoPrivacidadPoca]);
  });

  it("una lista más larga que el tope se ve con la i cerrada", async () => {
    await montar(nombres(40), 32);
    boton("btn-turnos").click();
    expect(panel().hidden).toBe(true);
    expect(aLaVista(nota())).toBe(true);
    expect(nota().textContent).toBe(String(T.es.turnsLimit).replace("{n}", "32"));
  });

  it("una persona repetida en un Amigo secreto se ve junto a Sellar, fuera del pliegue", async () => {
    // La lista de siempre ya junta dos renglones iguales: los que quedan son los que difieren en mayúsculas.
    await montar("Ana\nBeto\nana\nCarla\nDani");
    boton("btn-amigo").click();
    const linea = $("sellar-resumen");
    expect(aLaVista(linea)).toBe(true);
    expect(linea.textContent).toBe(String(T.es.amigoRepetido).replace("{nombre}", "Ana"));
    expect(panel().contains(linea)).toBe(false);
    expect(boton("btn-freeze").disabled).toBe(true);
  });
});

describe("los estilos de la i", () => {
  /** El cuerpo de la primera regla cuyo selector es exactamente `selector`. */
  const regla = (selector: string): string => {
    const re = new RegExp(`(?:^|[}\\s])${selector.replace(/[.[\]"=-]/g, "\\$&")}\\s*\\{([^}]*)\\}`);
    return re.exec(estilos)?.[1] ?? "";
  };

  it("el blanco de toque mide 48 px de ancho y de alto", () => {
    const cuerpo = regla(".modo-i");
    expect(cuerpo).toMatch(/width:\s*48px/);
    expect(cuerpo).toMatch(/height:\s*48px/);
  });

  it("el panel cerrado no ocupa lugar", () => {
    expect(regla(".modo-info[hidden]")).toMatch(/display:\s*none/);
  });

  it("el renglón de la i no ocupa alto: la i cuelga debajo del marco, por encima de lo que sigue", () => {
    expect(regla(".modo-pie")).toMatch(/height:\s*0;/);
    const i = regla(".modo-i");
    expect(i).toMatch(/position:\s*relative/);
    expect(i).toMatch(/z-index:\s*2/);
    expect(i).toMatch(/margin:\s*-4px -12px 0 0/);
  });

  it("el panel abierto empieza donde termina la i (48 px menos los 4 que sube)", () => {
    expect(regla(".modo-info")).toMatch(/margin-top:\s*44px/);
  });

  it("con el panel cerrado, la nota y los orígenes le dejan libre el costado a la i", () => {
    expect(estilos).toContain(".modo-info[hidden] + .nw-nota { padding-right: 40px; }");
    expect(estilos).toContain(".modo-elegir:not([hidden]) ~ #origenes { max-width: 640px; padding-right: 40px; box-sizing: border-box; }");
    // La nota va pegada al panel y los orígenes son hermanos del selector: si el markup cambia, las reglas dejan de valer.
    const html = new DOMParser().parseFromString(pagina, "text/html");
    expect(html.getElementById("modo-info")?.nextElementSibling?.id).toBe("turnos-nota");
    expect(html.getElementById("origenes")?.parentElement).toBe(html.getElementById("turnos-opcion")?.parentElement);
  });

  it("al llevarlo a la vista, el panel deja abajo el alto de la barra de lo que sigue y un poco de aire", () => {
    expect(regla(".modo-info")).toMatch(/scroll-margin-bottom:\s*calc\(var\(--sig-alto, 0px\) \+ 12px\)/);
  });
});
