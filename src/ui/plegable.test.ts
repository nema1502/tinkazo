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
