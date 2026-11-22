import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TOPES, esSoloDelCelular, excesos, hojasDelHtml, informe, medir, trozosDelHtml } from "./peso-participar.mjs";

const carpetas = [];
afterEach(() => {
  for (const c of carpetas.splice(0)) rmSync(c, { recursive: true, force: true });
});

/** Un dist de mentira: el HTML, los trozos y, si se pide, el mapa de cada uno. */
function armarDist(trozos, entrada = "/assets/participar-a.js") {
  const dist = mkdtempSync(join(tmpdir(), "peso-"));
  carpetas.push(dist);
  mkdirSync(join(dist, "assets"));
  const precargas = trozos.filter((t) => `/assets/${t.nombre}` !== entrada).map((t) => `<link rel="modulepreload" crossorigin href="/assets/${t.nombre}">`);
  writeFileSync(join(dist, "participar.html"), `<html><head><script type="module" crossorigin src="${entrada}"></script>${precargas.join("")}</head></html>`);
  for (const t of trozos) {
    writeFileSync(join(dist, "assets", t.nombre), t.codigo);
    if (t.fuentes) writeFileSync(join(dist, "assets", `${t.nombre}.map`), JSON.stringify({ sources: t.fuentes }));
  }
  return dist;
}

const ruido = (n) => Array.from({ length: n }, (_, i) => String((i * 2654435761) % 1000003)).join(",");

describe("la prueba de peso de la página del celular", () => {
  it("lee el script de entrada y lo que precarga", () => {
    const html = '<script type="module" crossorigin src="/assets/participar-a.js"></script><link rel="modulepreload" href="/assets/x.js"><link rel="stylesheet" href="/assets/m.css">';
    expect(trozosDelHtml(html)).toEqual({ entrada: "/assets/participar-a.js", js: ["/assets/participar-a.js", "/assets/x.js"] });
  });

  it("lee las hojas de estilo que pide el HTML", () => {
    const html = '<link rel="stylesheet" crossorigin href="/assets/menu-a.css"><link rel="stylesheet" href="/assets/campana-b.css"><link rel="modulepreload" href="/assets/x.js">';
    expect(hojasDelHtml(html)).toEqual(["/assets/menu-a.css", "/assets/campana-b.css"]);
  });

  it("mide como hoja de la campaña solo la que trae las reglas del bloque cmp-hero", () => {
    const dist = armarDist([{ nombre: "participar-a.js", codigo: "x", fuentes: ["../src/participar.ts"] }]);
    writeFileSync(join(dist, "participar.html"), '<script type="module" src="/assets/participar-a.js"></script><link rel="stylesheet" href="/assets/general.css"><link rel="stylesheet" href="/assets/campana.css">');
    writeFileSync(join(dist, "assets", "general.css"), `.cmp-aviso{color:red}${ruido(3000)}`);
    writeFileSync(join(dist, "assets", "campana.css"), `.cmp-hero{color:red}${ruido(200)}`);
    const medida = medir(dist);
    expect(medida.hoja).toBeGreaterThan(0);
    expect(medida.hoja).toBeLessThan(1_000);
  });

  it("cuenta como del celular solo lo que no trae nada de la herramienta", () => {
    expect(esSoloDelCelular(["../src/campana/textos.ts"])).toBe(true);
    expect(esSoloDelCelular(["../src/sala/campana.ts", "../src/campana/sesion.ts"])).toBe(true);
    expect(esSoloDelCelular(["../src/campana/comision.ts", "../src/idioma.ts"])).toBe(false);
    expect(esSoloDelCelular(["../node_modules/x/y.js"])).toBe(false);
    expect(esSoloDelCelular([])).toBe(false);
  });

  it("suma la entrada y los trozos propios, y deja afuera los de otras páginas", () => {
    const dist = armarDist([
      { nombre: "participar-a.js", codigo: ruido(2000), fuentes: ["../src/participar.ts"] },
      { nombre: "textos-b.js", codigo: ruido(1000), fuentes: ["../src/campana/textos.ts"] },
      { nombre: "menu-c.js", codigo: ruido(5000), fuentes: ["../src/idioma.ts", "../src/campana/comision.ts"] },
    ]);
    const medida = medir(dist);
    expect(medida.detalle.map((d) => d.ruta)).toEqual(["/assets/participar-a.js", "/assets/textos-b.js"]);
    expect(medida.celular).toBe(medida.detalle[0].comprimido + medida.detalle[1].comprimido);
    expect(medida.entrada).toBe(medida.detalle[0].comprimido);
    expect(medida.html).toBeGreaterThan(0);
  });

  it("falla por encima del tope y dice cuál", () => {
    const dist = armarDist([{ nombre: "participar-a.js", codigo: ruido(60000), fuentes: ["../src/participar.ts"] }]);
    const medida = medir(dist);
    expect(medida.entrada).toBeGreaterThan(TOPES.entrada);
    expect(excesos(medida).map((e) => e.nombre)).toContain("entrada");
    expect(informe(medida)).toContain("PASA EL TOPE: entrada");
  });

  it("pasa cuando todo entra", () => {
    const dist = armarDist([{ nombre: "participar-a.js", codigo: ruido(500), fuentes: ["../src/participar.ts"] }]);
    const medida = medir(dist);
    expect(excesos(medida)).toEqual([]);
    expect(informe(medida)).not.toContain("PASA EL TOPE");
  });

  it("avisa claro si no hay sitio construido o si falta un trozo", () => {
    expect(() => medir(join(tmpdir(), "no-existe-peso"))).toThrow(/Construí el sitio primero/u);
    const dist = armarDist([{ nombre: "participar-a.js", codigo: "x", fuentes: [] }]);
    writeFileSync(join(dist, "participar.html"), '<script type="module" src="/assets/participar-a.js"></script><link rel="modulepreload" href="/assets/falta.js">');
    expect(() => medir(dist)).toThrow(/falta\.js/u);
  });
});
