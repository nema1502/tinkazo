// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { T } from "../i18n";

/**
 * El pliegue de las opciones ya no depende de cuántos ganan, porque ese control está a la vista. El del resultado se arma
 * en el navegador (`plegarElResultado`): también se cuida que cada id que busca esté en `index.html` y su texto en los dos
 * idiomas.
 */
describe("el pliegue de las opciones", () => {
  beforeEach(() => {
    vi.resetModules();
    document.body.innerHTML =
      '<div><details id="mas-opciones"><summary>Premio y subir CSV</summary><input id="prize" /></details>' +
      '<input id="nw" type="hidden" value="1" /></div>';
  });

  it("la cantidad ya no lo abre: está a la vista junto a Sellar la lista", async () => {
    const { initPlegables } = await import("./plegable");
    initPlegables();
    const mas = document.getElementById("mas-opciones") as HTMLDetailsElement;
    const nw = document.getElementById("nw") as HTMLInputElement;
    nw.value = "3";
    nw.dispatchEvent(new Event("input", { bubbles: true }));
    nw.dispatchEvent(new Event("change", { bubbles: true }));
    expect(mas.open).toBe(false);
  });

  it("un premio escrito sí lo abre, porque sigue plegado", async () => {
    const { initPlegables } = await import("./plegable");
    initPlegables();
    const mas = document.getElementById("mas-opciones") as HTMLDetailsElement;
    const prize = document.getElementById("prize") as HTMLInputElement;
    prize.value = "Termo";
    prize.dispatchEvent(new Event("input", { bubbles: true }));
    expect(mas.open).toBe(true);
  });
});

/** Con un modo elegido arriba, su nombre de siempre lo pone la herramienta: eso no abre el pliegue, un nombre escrito sí. */
describe("el pliegue de las opciones con un modo elegido", () => {
  beforeEach(() => {
    vi.resetModules();
    delete document.documentElement.dataset.modoLista;
    document.body.innerHTML =
      '<button id="btn-turnos" aria-pressed="false"></button>' +
      '<div><details id="mas-opciones"><summary>Nombre y subir CSV</summary><input id="prize" /></details></div>';
  });

  /** Arranca el pliegue con `nombre` ya puesto en el campo, como lo deja el selector de modos. */
  async function abrirCon(nombre: string): Promise<HTMLDetailsElement> {
    (document.getElementById("prize") as HTMLInputElement).value = nombre;
    const { initPlegables } = await import("./plegable");
    initPlegables();
    return document.getElementById("mas-opciones") as HTMLDetailsElement;
  }

  it("con Orden de turnos, el nombre Turnos no lo abre", async () => {
    document.getElementById("btn-turnos")?.setAttribute("aria-pressed", "true");
    expect((await abrirCon("Turnos")).open).toBe(false);
  });

  it("con Amigo secreto, el nombre Amigo secreto no lo abre", async () => {
    document.documentElement.dataset.modoLista = "amigo";
    expect((await abrirCon("Amigo secreto")).open).toBe(false);
  });

  it("con Amigo secreto en inglés, el nombre Secret Santa no lo abre", async () => {
    document.documentElement.dataset.modoLista = "amigo";
    expect((await abrirCon("Secret Santa")).open).toBe(false);
  });

  it("con Amigo secreto, un nombre escrito sí lo abre", async () => {
    document.documentElement.dataset.modoLista = "amigo";
    expect((await abrirCon("Amigo secreto: Navidad")).open).toBe(true);
  });

  it("sin el modo del amigo, Amigo secreto es un premio escrito y lo abre", async () => {
    expect((await abrirCon("Amigo secreto")).open).toBe(true);
  });
});

describe("el pliegue del resultado", () => {
  // Con jsdom, import.meta.url no es una URL de archivo: las rutas salen de la raíz del proyecto.
  const fuente = readFileSync(join(process.cwd(), "src", "ui", "plegable.ts"), "utf8");
  const html = readFileSync(join(process.cwd(), "index.html"), "utf8");
  const creados = new Set(["mas-resultado"]);
  const buscados = [...fuente.matchAll(/getElementById\("([^"]+)"\)/g)].map((m) => m[1] as string).filter((id) => !creados.has(id));

  it("busca solo ids que están en index.html", () => {
    expect(buscados).toEqual(expect.arrayContaining(["again-acciones", "btn-again-nueva", "btn-copy", "btn-email", "mas-opciones"]));
    const faltan = buscados.filter((id) => !new RegExp(`\\bid="${id}"`).test(html));
    expect(faltan).toEqual([]);
  });

  it("el título del pliegue está en español y en inglés", () => {
    for (const l of ["es", "en"] as const) expect(typeof T[l].masResultado, l).toBe("string");
  });

  it("lo que se pliega es lo que se usa poco: la acción principal y 'Compartir el resultado' no se mueven", () => {
    const plegados = [...fuente.matchAll(/const (\w+) = document\.getElementById\("(btn-[\w-]+)"\)/g)].map((m) => m[2]);
    expect(plegados.sort()).toEqual(["btn-again-nueva", "btn-copy", "btn-email"]);
    for (const principal of ["btn-again-sin", "btn-proof", "btn-whatsapp", "btn-grande"]) expect(plegados).not.toContain(principal);
  });
});
