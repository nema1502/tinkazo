// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * El modo stand elige cuántas personas salen, y entrar y salir de él no mueve nada del sorteo de verdad.
 *
 * El HTML es el de verdad y los módulos de la lista, el contador, los turnos, el premio y el stand también. Las cuatro
 * cosas que hablan con la red o con el show (`wallet-ui`, `freeze`, `draw` y `siguiente`) van de mentira. Cada "página"
 * es un conjunto nuevo de módulos con el mismo almacenamiento de la pestaña, y arranca en el orden de `main.ts`: salir
 * del stand recarga la página, y eso es lo que se prueba, con el cierre de la página (`pagehide`) incluido.
 */

const h = vi.hoisted(() => ({ recargar: vi.fn(), conCuenta: true }));
vi.mock("./wallet-ui", () => ({
  MARCA_INGRESAR: "tinkazo.abrir",
  currentSession: () => h.conCuenta ? { address: "Cuenta de prueba" } : null,
  refrescarPuerta: vi.fn(),
}));
vi.mock("./freeze", () => ({
  GUARDA_DESPUES_DE_SOLTAR_MS: 700,
  refreshFreezeLabel: vi.fn(),
  rotarJuego: vi.fn(),
  unfreeze: vi.fn(),
}));
vi.mock("./draw", () => ({ newDraw: vi.fn() }));
vi.mock("./siguiente", () => ({ actualizarPaso: vi.fn() }));

const html = readFileSync(join(process.cwd(), "index.html"), "utf8");
const css = readFileSync(join(process.cwd(), "src/styles.css"), "utf8");
const BORRADOR = "tinkazo.borrador";
const CLAVE_LISTA = "tinkazo.stand-lista";
const CINCO = "Flor\nGus\nHana\nIvo\nJuli";
const OCHO = "Ana\nBeto\nNora\nLeo\nIris\nMax\nPía\nTeo";

type Pagina = {
  p: typeof import("./participants");
  g: typeof import("./ganadores");
  tu: typeof import("./turnos");
  pr: typeof import("./premios");
  stand: typeof import("./stand");
  modo: typeof import("../ensayo-modo");
  i18n: typeof import("../i18n");
};

const el = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const cuadro = (): HTMLTextAreaElement => el<HTMLTextAreaElement>("ta");
const campo = (): HTMLInputElement => el<HTMLInputElement>("nw");
const premio = (): HTMLInputElement => el<HTMLInputElement>("prize");
const control = (): HTMLElement => el("ganadores-control");
const guardado = (): { texto?: string; premio?: string; nw?: number; modo?: string } | null => {
  const crudo = sessionStorage.getItem(BORRADOR);
  return crudo === null ? null : (JSON.parse(crudo) as { texto?: string; premio?: string; nw?: number; modo?: string });
};

/** Los oyentes que cada página dejó en la ventana y en el documento: una página que se va se los lleva. */
const oyentes: Array<[EventTarget, string, EventListenerOrEventListenerObject]> = [];
const agregarEnVentana = window.addEventListener.bind(window);
const agregarEnDocumento = document.addEventListener.bind(document);
const quitarOyentes = (): void => {
  for (const [donde, tipo, f] of oyentes.splice(0)) donde.removeEventListener(tipo, f);
};

/** Una página nueva: HTML limpio, módulos nuevos y el almacenamiento de la pestaña tal como estaba. */
async function cargar(search = "", hash = "#sortear"): Promise<Pagina> {
  h.conCuenta = true;
  vi.resetModules();
  quitarOyentes();
  document.body.removeAttribute("data-stand");
  document.body.innerHTML = new DOMParser().parseFromString(html, "text/html").body.innerHTML;
  h.recargar = vi.fn();
  vi.stubGlobal("location", { search, pathname: "/", hash, reload: h.recargar });
  vi.stubGlobal("scrollTo", () => undefined);
  vi.spyOn(window, "addEventListener").mockImplementation((tipo: string, f: EventListenerOrEventListenerObject, o?: boolean | AddEventListenerOptions) => {
    oyentes.push([window, tipo, f]);
    agregarEnVentana(tipo, f, o);
  });
  vi.spyOn(document, "addEventListener").mockImplementation((tipo: string, f: EventListenerOrEventListenerObject, o?: boolean | AddEventListenerOptions) => {
    oyentes.push([document, tipo, f]);
    agregarEnDocumento(tipo, f, o);
  });
  const [p, g, tu, pr, stand, modo, i18n] = await Promise.all([
    import("./participants"),
    import("./ganadores"),
    import("./turnos"),
    import("./premios"),
    import("./stand"),
    import("../ensayo-modo"),
    import("../i18n"),
  ]);
  i18n.setLang("es");
  return { p, g, tu, pr, stand, modo, i18n };
}

/** El arranque de `main.ts`, en su orden: la lista, los contadores, el modo elegido y el borrador. `initStand` va al final. */
function arrancar(pg: Pagina): void {
  pg.p.bindParticipants();
  pg.pr.montarPremios();
  pg.g.montarGanadores();
  pg.tu.montarTurnos();
  pg.modo.cerrarSalidaDelStand();
  pg.p.reponerBorrador();
  pg.tu.abrirConElModoPedido();
  pg.stand.initStand();
}

function poner(pg: Pagina, lista: string): void {
  cuadro().value = lista;
  pg.p.renderNames();
}

const dialogo = (): HTMLElement | null => document.querySelector(".dlg-card");
const botonDelDialogo = (texto: string): HTMLButtonElement =>
  [...document.querySelectorAll<HTMLButtonElement>(".dlg-card button")].find((b) => b.textContent?.trim() === texto) as HTMLButtonElement;

/** Sale del stand como la persona: elige llevar la lista o no, y la página se recarga. Con una lista corta no hay pregunta. */
async function salir(pg: Pagina, llevar: boolean): Promise<void> {
  const salida = pg.stand.salirDelStand();
  if (dialogo()) botonDelDialogo(pg.i18n.t(llevar ? "standLlevarSi" : "standLlevarNo")).click();
  await salida;
  expect(h.recargar).toHaveBeenCalledTimes(1);
  // La página se va: el cierre guarda el borrador, y el modo sigue puesto para que no pise el de verdad.
  window.dispatchEvent(new Event("pagehide"));
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  quitarOyentes();
  sessionStorage.clear();
  document.body.removeAttribute("data-stand");
  document.body.removeAttribute("data-stand-arrancando");
  document.body.innerHTML = "";
});

describe("entrar al stand", () => {
  it("el control se llama Cuántos salen, empieza en 1 y aparece cuando hay dos nombres", async () => {
    const pg = await cargar();
    arrancar(pg);
    pg.stand.entrarAlStand();
    expect(pg.modo.enStand()).toBe(true);
    expect(el("nw-etiqueta").dataset.i).toBe("standSalen");
    expect(el("nw-etiqueta").textContent).toBe("Cuántos salen");
    expect(campo().value).toBe("1");
    // Con el cuadro vacío no hay ronda que empezar ni un control sin uso.
    expect(control().hidden).toBe(true);
    poner(pg, "Ana");
    expect(control().hidden).toBe(true);
    poner(pg, OCHO);
    expect(control().hidden).toBe(false);
    expect((el("nw-mas") as HTMLButtonElement).disabled).toBe(false);
    (document.querySelector('#nw-atajos button[data-n="3"]') as HTMLButtonElement).click();
    expect(campo().value).toBe("3");
    expect(el("nw-valor").textContent).toBe("3");
    expect(el("sellar-resumen").textContent).toBe("8 personas en la ronda, salen 3");
  });

  it("con Orden de turnos elegido no queda el modo puesto ni el control bloqueado", async () => {
    const pg = await cargar();
    arrancar(pg);
    poner(pg, OCHO);
    pg.tu.ponerModoTurnos(true);
    expect(campo().disabled).toBe(true);
    expect(campo().value).toBe("8");
    expect(premio().value).toBe("Turnos");

    pg.stand.entrarAlStand();
    expect(pg.tu.modoTurnosActivo()).toBe(false);
    expect(el("btn-turnos").getAttribute("aria-pressed")).toBe("false");
    // Nombres nuevos del stand: el control sigue libre y la cantidad no sigue a la lista.
    poner(pg, OCHO);
    expect(campo().disabled).toBe(false);
    expect(campo().value).toBe("1");
    expect(control().hidden).toBe(false);
    expect((el("nw-mas") as HTMLButtonElement).disabled).toBe(false);
    expect(premio().value).toBe("");
    expect(el("nw-etiqueta").dataset.i).toBe("standSalen");
    // Y lo del sorteo de verdad quedó guardado tal cual.
    expect(guardado()).toEqual({ texto: OCHO, premio: "Turnos", nw: 8, modo: "turnos" });
    // El botón de empezar no se apaga por un tope de turnos: el stand no tiene orden.
    expect((el("btn-freeze") as HTMLButtonElement).disabled).toBe(false);
  });

  it("el pliegue para subir un archivo no se muestra en el stand", async () => {
    const pg = await cargar();
    arrancar(pg);
    pg.stand.entrarAlStand();
    expect(css).toMatch(/body\[data-stand="1"\] #mas-opciones,[\s\S]{0,200}display:\s*none !important/);
  });

  it("un premio escrito antes de entrar no viaja a las rondas del stand, y queda guardado", async () => {
    const pg = await cargar();
    arrancar(pg);
    poner(pg, CINCO);
    pg.pr.ponerPremio("Termo");
    pg.stand.entrarAlStand();
    expect(premio().value).toBe("");
    expect(guardado()?.premio).toBe("Termo");
  });

  it("no se entra con la lista cerrada: un sello en camino no se mezcla con el stand", async () => {
    const pg = await cargar();
    arrancar(pg);
    poner(pg, CINCO);
    pg.p.cerrarLista(true);
    pg.stand.entrarAlStand();
    expect(pg.modo.enStand()).toBe(false);
    expect(document.body.dataset.stand).toBeUndefined();
    expect(sessionStorage.getItem(BORRADOR)).toBeNull();
    expect(el("stand-aviso").textContent).toBe(pg.i18n.T.es.standNoSorteo);
    expect(el("stand-aviso").hidden).toBe(false);
  });

  it("el enlace Tengo un stand se esconde mientras la lista está cerrada y vuelve al abrirse", async () => {
    const pg = await cargar("", "");
    arrancar(pg);
    const enlace = el<HTMLButtonElement>("btn-stand");
    document.dispatchEvent(new CustomEvent("tinkazo:paso"));
    expect(enlace.hidden).toBe(false);
    pg.p.cerrarLista(true);
    document.dispatchEvent(new CustomEvent("tinkazo:paso"));
    expect(enlace.hidden).toBe(true);
    pg.p.cerrarLista(false);
    document.dispatchEvent(new CustomEvent("tinkazo:paso"));
    expect(enlace.hidden).toBe(false);
  });

  it("recargar dentro del stand sigue en el stand, con el control en 1 y sin orden de turnos aunque la dirección lo pida", async () => {
    const pg = await cargar("?modo=turnos");
    pg.modo.marcarStand(true);
    arrancar(pg);
    expect(pg.modo.enStand()).toBe(true);
    expect(pg.tu.modoTurnosActivo()).toBe(false);
    expect(el("nw-etiqueta").dataset.i).toBe("standSalen");
    expect(campo().value).toBe("1");
    expect(campo().disabled).toBe(false);
  });
});

describe("Cambiar la lista durante la cuenta", () => {
  it("se ve solo con la ronda por arrancar", async () => {
    const pg = await cargar();
    arrancar(pg);
    pg.stand.entrarAlStand();
    const { app } = await import("../state");
    app.frozen = { names: ["Ana", "Beto"] } as never;
    app.drawn = null;

    document.dispatchEvent(new CustomEvent("tinkazo:paso"));
    expect(el("stand-cambiar").hidden).toBe(false);

    app.drawn = { winners: [0] } as never;
    document.dispatchEvent(new CustomEvent("tinkazo:paso"));
    expect(el("stand-cambiar").hidden).toBe(true);
    app.frozen = null;
    app.drawn = null;
  });
});

describe("las entradas al stand", () => {
  it("Tengo un stand en la portada entra al modo", async () => {
    const pg = await cargar("", "");
    arrancar(pg);
    const boton = document.querySelector<HTMLButtonElement>(".hero [data-entrar-stand]");
    expect(boton?.textContent).toBe("Tengo un stand");
    boton?.click();
    expect(pg.modo.enStand()).toBe(true);
    expect(document.body.dataset.stand).toBe("1");
  });

  it("con ?stand en la dirección entra al modo y borra el parámetro", async () => {
    const pg = await cargar("?stand", "");
    const reemplazar = vi.spyOn(history, "replaceState");
    arrancar(pg);
    expect(pg.modo.enStand()).toBe(true);
    expect(reemplazar.mock.calls[0]).toEqual([null, "", "/#sortear"]);
  });

  it("con ?lang=en&stand=1 los demás parámetros se quedan", async () => {
    const pg = await cargar("?lang=en&stand=1", "");
    const reemplazar = vi.spyOn(history, "replaceState");
    arrancar(pg);
    expect(pg.modo.enStand()).toBe(true);
    expect(reemplazar.mock.calls[0]).toEqual([null, "", "/?lang=en#sortear"]);
  });

  it("en la demo, ?demo=race&stand no entra al modo y avisa que hay que salir del ejemplo", async () => {
    const pg = await cargar("?demo=race&stand", "");
    arrancar(pg);
    expect(pg.modo.enStand()).toBe(false);
    expect(document.body.dataset.stand).toBeUndefined();
    expect(el("stand-aviso").textContent).toBe("Salí del ejemplo para abrir el stand.");
    expect(el("stand-aviso").hidden).toBe(false);
  });

  it("Tengo un stand con un sorteo en curso explica que primero hay que terminarlo", async () => {
    const pg = await cargar("", "");
    arrancar(pg);
    const { app } = await import("../state");
    app.frozen = { names: ["Ana", "Beto"] } as never;

    document.querySelector<HTMLButtonElement>(".hero [data-entrar-stand]")?.click();

    expect(pg.modo.enStand()).toBe(false);
    expect(el("stand-aviso").textContent).toBe("Hay un sorteo en curso. Terminalo antes de abrir el stand.");
    expect(el("stand-aviso").hidden).toBe(false);
    expect(pg.i18n.T.en.standNoSorteo).toBe("A draw is in progress. Finish it before opening booth mode.");
    app.frozen = null;
  });

  it("Tengo un stand durante el ensayo avisa que hay que salir del ejemplo", async () => {
    const pg = await cargar();
    arrancar(pg);
    pg.modo.marcarEnsayo(true);

    el<HTMLButtonElement>("btn-stand").click();

    expect(pg.modo.enStand()).toBe(false);
    expect(el("stand-aviso").textContent).toBe(pg.i18n.T.es.standNoEjemplo);
    expect(pg.i18n.T.en.standNoEjemplo).toBe("Leave the example to open booth mode.");
  });

  it("adentro, los títulos dicen Tu stand, En la ronda y La ronda, también en inglés", async () => {
    const pg = await cargar();
    arrancar(pg);
    pg.stand.entrarAlStand();
    const titulo = document.querySelector<HTMLElement>(".appbar-t h2.tab-nuevo");
    const participantes = document.querySelector<HTMLElement>("#p1-titulo");
    const ronda = document.querySelector<HTMLElement>("#sec-draw .head h2 [data-i]");
    expect(titulo?.textContent).toBe("Tu stand");
    expect(participantes?.textContent).toBe("En la ronda");
    expect(ronda?.textContent).toBe("La ronda");
    pg.i18n.setLang("en");
    expect(titulo?.textContent).toBe("Your booth");
    expect(participantes?.textContent).toBe("In the round");
    expect(ronda?.textContent).toBe("The round");
  });

  it("con la lista vacía no se muestra la guía de arriba", async () => {
    const pg = await cargar();
    arrancar(pg);
    pg.stand.entrarAlStand();
    expect(el("ensayo-guia").textContent).toBe("");
    expect(el("ensayo-guia").hidden).toBe(true);
  });

  it("con el QR abierto y nombres, la guía pide que lo escaneen", async () => {
    const pg = await cargar();
    arrancar(pg);
    pg.stand.entrarAlStand();
    poner(pg, "Ana\nBeto");
    pg.stand.alPreguntarPorElQr(() => true);
    pg.stand.repintarGuia();
    expect(el("ensayo-guia").textContent).toBe(pg.i18n.T.es.standGuiaSala);
  });
  it("el botón apagado del resultado dice La ronda terminó en los dos idiomas", async () => {
    const pg = await cargar();
    arrancar(pg);
    pg.stand.entrarAlStand();
    const { app } = await import("../state");
    app.drawn = { winners: [0] } as never;
    document.dispatchEvent(new CustomEvent("tinkazo:paso"));
    expect(el("btn-draw").textContent).toBe("La ronda terminó");
    pg.i18n.setLang("en");
    expect(el("btn-draw").textContent).toBe("The round is over");
    app.drawn = null;
  });
});

describe("salir del stand con la página de verdad", () => {
  it("con lista y 3 antes de entrar: vuelven la lista, Cuántos ganan y el premio, aunque en el stand haya otros", async () => {
    const pg = await cargar();
    arrancar(pg);
    poner(pg, CINCO);
    pg.pr.ponerPremio("Termo");
    pg.g.ponerGanadores(3);
    pg.stand.entrarAlStand();
    poner(pg, OCHO);
    (document.querySelector('#nw-atajos button[data-n="2"]') as HTMLButtonElement).click();
    await salir(pg, false);

    const nueva = await cargar();
    arrancar(nueva);
    expect(nueva.modo.enStand()).toBe(false);
    expect(cuadro().value).toBe(CINCO);
    expect(premio().value).toBe("Termo");
    expect(campo().value).toBe("3");
    expect(el("nw-etiqueta").dataset.i).toBe("winners");
    expect(el("nw-etiqueta").textContent).toBe("Cuántos ganan");
    expect(el("nw-valor").textContent).toBe("3");
  });

  it("con el cuadro vacío y 3 antes de entrar: vuelve 3", async () => {
    const pg = await cargar();
    arrancar(pg);
    pg.g.ponerGanadores(3);
    pg.stand.entrarAlStand();
    poner(pg, OCHO);
    await salir(pg, false);

    const nueva = await cargar();
    arrancar(nueva);
    expect(campo().value).toBe("3");
    expect(el("nw-etiqueta").dataset.i).toBe("winners");
    expect(cuadro().value).toBe("");
  });

  it("con Orden de turnos: vuelve elegido, con el control fijo en la lista de antes", async () => {
    const pg = await cargar();
    arrancar(pg);
    poner(pg, CINCO);
    pg.tu.ponerModoTurnos(true);
    pg.stand.entrarAlStand();
    poner(pg, OCHO);
    await salir(pg, false);

    const nueva = await cargar();
    arrancar(nueva);
    expect(nueva.tu.modoTurnosActivo()).toBe(true);
    expect(el("btn-turnos").getAttribute("aria-pressed")).toBe("true");
    expect(cuadro().value).toBe(CINCO);
    expect(campo().value).toBe("5");
    expect(campo().disabled).toBe(true);
    expect(el("nw-etiqueta").dataset.i).toBe("turnsCount");
  });

  it("con Llevar esta lista: la lista es la del stand y el premio y Cuántos ganan son los de siempre", async () => {
    const pg = await cargar();
    arrancar(pg);
    poner(pg, CINCO);
    pg.pr.ponerPremio("Termo");
    pg.g.ponerGanadores(3);
    pg.stand.entrarAlStand();
    poner(pg, OCHO);
    (document.querySelector('#nw-atajos button[data-n="2"]') as HTMLButtonElement).click();
    await salir(pg, true);
    expect(sessionStorage.getItem(CLAVE_LISTA)).toBe(OCHO);

    const nueva = await cargar();
    arrancar(nueva);
    expect(nueva.modo.enStand()).toBe(false);
    expect(cuadro().value).toBe(OCHO);
    expect(premio().value).toBe("Termo");
    expect(campo().value).toBe("3");
    expect(el("nw-etiqueta").dataset.i).toBe("winners");
    expect(sessionStorage.getItem(CLAVE_LISTA)).toBeNull();
  });

  it("con Llevar esta lista y Orden de turnos: vuelve el orden con la lista nueva", async () => {
    const pg = await cargar();
    arrancar(pg);
    poner(pg, CINCO);
    pg.tu.ponerModoTurnos(true);
    pg.stand.entrarAlStand();
    poner(pg, OCHO);
    await salir(pg, true);

    const nueva = await cargar();
    arrancar(nueva);
    expect(nueva.tu.modoTurnosActivo()).toBe(true);
    expect(cuadro().value).toBe(OCHO);
    expect(campo().value).toBe("8");
    expect(campo().disabled).toBe(true);
  });

  it("con Llevar esta lista y sin nada guardado: entra la lista del stand y nada más", async () => {
    const pg = await cargar();
    arrancar(pg);
    pg.stand.entrarAlStand();
    poner(pg, OCHO);
    sessionStorage.removeItem(BORRADOR);
    await salir(pg, true);

    const nueva = await cargar();
    arrancar(nueva);
    expect(cuadro().value).toBe(OCHO);
    expect(campo().value).toBe("1");
    expect(premio().value).toBe("");
  });

  it("el cierre de la página con el stand puesto no escribe los nombres del stand como borrador", async () => {
    const pg = await cargar();
    arrancar(pg);
    poner(pg, CINCO);
    pg.stand.entrarAlStand();
    const antes = sessionStorage.getItem(BORRADOR);
    poner(pg, OCHO);
    window.dispatchEvent(new Event("pagehide"));
    expect(sessionStorage.getItem(BORRADOR)).toBe(antes);
    // Ni siquiera con el cuadro vacío borra el de verdad.
    poner(pg, "");
    window.dispatchEvent(new Event("pagehide"));
    expect(sessionStorage.getItem(BORRADOR)).toBe(antes);
    expect(JSON.parse(antes ?? "null").texto).toBe(CINCO);
  });
});

describe("las dos salidas del stand", () => {
  it("el botón de la banda sale sin dejar la marca que abre la entrada", async () => {
    const pg = await cargar();
    arrancar(pg);
    pg.stand.entrarAlStand();
    h.conCuenta = false;
    el<HTMLButtonElement>("stand-salir-banda").click();
    await vi.waitFor(() => expect(h.recargar).toHaveBeenCalledTimes(1));
    expect(sessionStorage.getItem("tinkazo.abrir")).toBeNull();
  });

  it("Hacer un sorteo de verdad sí deja la marca de entrada cuando no hay cuenta", async () => {
    const pg = await cargar();
    arrancar(pg);
    pg.stand.entrarAlStand();
    h.conCuenta = false;
    el<HTMLButtonElement>("stand-salir").click();
    await vi.waitFor(() => expect(h.recargar).toHaveBeenCalledTimes(1));
    expect(sessionStorage.getItem("tinkazo.abrir")).toBe("1");
  });
});

describe("una pestaña de stand que se abre fuera del sorteo", () => {
  it("el stand se termina y vuelve lo que se estaba armando", async () => {
    const pg = await cargar("", "");
    pg.modo.marcarStand(true);
    sessionStorage.setItem(BORRADOR, JSON.stringify({ texto: CINCO, premio: "Termo", nw: 3 }));
    arrancar(pg);
    expect(pg.modo.enStand()).toBe(false);
    expect(cuadro().value).toBe(CINCO);
    expect(premio().value).toBe("Termo");
    expect(campo().value).toBe("3");
  });

  it("con ?modo=turnos en la dirección: el orden queda elegido, y al volver a Sortear premios vuelven el premio y la cantidad", async () => {
    const pg = await cargar("?modo=turnos", "");
    pg.modo.marcarStand(true);
    sessionStorage.setItem(BORRADOR, JSON.stringify({ texto: CINCO, premio: "Termo", nw: 3 }));
    arrancar(pg);
    expect(pg.modo.enStand()).toBe(false);
    expect(pg.tu.modoTurnosActivo()).toBe(true);
    expect(cuadro().value).toBe(CINCO);
    expect(campo().value).toBe("5");
    (el("btn-modo-sorteo") as HTMLButtonElement).click();
    expect(pg.tu.modoTurnosActivo()).toBe(false);
    expect(premio().value).toBe("Termo");
    expect(campo().value).toBe("3");
  });

  it("sin borrador no repone nada y no rompe", async () => {
    const pg = await cargar("", "");
    pg.modo.marcarStand(true);
    arrancar(pg);
    expect(pg.modo.enStand()).toBe(false);
    expect(cuadro().value).toBe("");
    expect(campo().value).toBe("1");
  });
});

describe("la lista del stand sobrevive a una recarga", () => {
  it("recargar en el stand repone la lista escrita a mano", async () => {
    const pg = await cargar();
    arrancar(pg);
    pg.stand.entrarAlStand();
    poner(pg, OCHO);
    window.dispatchEvent(new Event("pagehide"));
    const nueva = await cargar();
    arrancar(nueva);
    expect(cuadro().value).toBe(OCHO);
  });

  it("al salir del stand no queda la lista guardada", async () => {
    const pg = await cargar();
    arrancar(pg);
    pg.stand.entrarAlStand();
    poner(pg, OCHO);
    await salir(pg, false);
    const nueva = await cargar();
    arrancar(nueva);
    expect(sessionStorage.getItem("tinkazo.stand-cuadro")).toBeNull();
  });

  it("en el stand, tocar el logo no saca del modo", async () => {
    const pg = await cargar();
    arrancar(pg);
    pg.stand.entrarAlStand();
    const logo = document.querySelector<HTMLAnchorElement>("a.wordmark");
    const clic = new MouseEvent("click", { bubbles: true, cancelable: true });
    logo?.dispatchEvent(clic);
    expect(clic.defaultPrevented).toBe(true);
    expect(pg.modo.enStand()).toBe(true);
  });
});
