import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import hoja from "./emblemas/hoja.svg?raw";
import { CLAVES, COLORES, emblemaDe, emblemasDe } from "./emblemas";
import { aclarar, cargarHoja, dibujarEmblema, emblemaSvg, emblemaUrl, papelDe, simbolosDe } from "./emblemas-dibujo";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "emblemas");

const interiorDe = (clave: string): string => {
  for (const carpeta of ["propios", "twemoji"]) {
    const ruta = join(DIR, carpeta, `${clave}.svg`);
    if (existsSync(ruta)) return /^<svg\b[^>]*>([\s\S]*)<\/svg>$/.exec(readFileSync(ruta, "utf8").trim())?.[1]?.trim() ?? "";
  }
  return "";
};

describe("emblemas: la hoja de sprites", () => {
  const simbolos = simbolosDe(hoja);

  it("tiene un símbolo por cada clave y ninguno más", () => {
    expect([...simbolos.keys()].sort()).toEqual([...CLAVES].sort());
  });

  it("coincide con los dibujos sueltos (si no, correr scripts/emblemas-hoja.mjs)", () => {
    for (const c of CLAVES) {
      expect(interiorDe(c), c).not.toBe("");
      expect(simbolos.get(c), c).toBe(interiorDe(c));
    }
  });

  it("no trae ids, estilos, imágenes, textos ni scripts: se mezcla con los otros dibujos", () => {
    expect(hoja.replace(/<symbol id="[a-z]+"/g, "")).not.toMatch(/\bid=|<script|<style|<image|<use|<foreignObject|<text|href=|\bon\w+=/i);
  });

  it("pesa poco: cada dibujo entra en 6 KB y la hoja en 60", () => {
    expect(hoja.length).toBeLessThan(60_000);
    for (const [c, s] of simbolos) expect(s.length, c).toBeLessThan(6_000);
  });

  it("todos los dibujos usan colores fijos en hex (nada de currentColor ni de variables)", () => {
    for (const [c, s] of simbolos) {
      for (const m of s.matchAll(/(?:fill|stroke)="(#[0-9a-fA-F]+)"/g)) expect(m[1], c).toMatch(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);
    }
    expect(hoja).not.toMatch(/currentColor|var\(/);
  });
});

describe("emblemas: la ficha", () => {
  beforeAll(() => cargarHoja(hoja));

  it("aclarar mezcla con blanco", () => {
    expect(aclarar("#000000", 0)).toBe("#000000");
    expect(aclarar("#000000", 1)).toBe("#ffffff");
    expect(aclarar("#e93d9c", 0.86)).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("emblemaSvg es un SVG con el dibujo adentro, el aro del color y el lado pedido", () => {
    for (const c of CLAVES) {
      const e = { clave: c, color: COLORES[3] as string, tono: 3 };
      const svg = emblemaSvg(e, 36);
      expect(svg.startsWith("<svg"), c).toBe(true);
      expect(svg).toContain('width="36" height="36"');
      expect(svg).toContain(`fill="${e.color}"`);
      expect(svg).toContain(`fill="${papelDe(e.color)}"`);
      expect(svg).toContain(simbolosDe(hoja).get(c) as string);
      // XML bien formado: cada <svg> que se abre se cierra
      expect(svg.match(/<svg\b/g)?.length).toBe(svg.match(/<\/svg>/g)?.length);
    }
  });

  it("emblemaUrl es una dirección data: estable y con memoria", () => {
    const e = emblemaDe("Ana", 1);
    const u = emblemaUrl(e, 24);
    expect(u.startsWith("data:image/svg+xml,")).toBe(true);
    expect(emblemaUrl(e, 24)).toBe(u);
    expect(emblemaUrl(e, 36)).not.toBe(u);
  });

  it("una lista de 30 da 30 fichas distintas", () => {
    const nombres = Array.from({ length: 30 }, (_, i) => `Persona ${i + 1}`);
    const urls = emblemasDe(nombres, 99).map((e) => emblemaSvg(e, 24));
    expect(new Set(urls).size).toBe(30);
  });

  it("dibujarEmblema pinta tinta, aro y papel con medidas enteras y dos fichas vecinas no se pisan ni dejan raya", () => {
    const cajas: { x: number; y: number; w: number; h: number; fill: string }[] = [];
    let fill = "";
    const c = {
      set fillStyle(v: string) { fill = v; },
      beginPath() {},
      roundRect(x: number, y: number, w: number, h: number) { cajas.push({ x, y, w, h, fill }); },
      fill() {},
      drawImage() {},
    } as unknown as CanvasRenderingContext2D;
    const e = emblemaDe("Ana", 1);
    for (const lado of [24, 36, 64]) {
      cajas.length = 0;
      dibujarEmblema(c, e, 10, 20, lado);
      dibujarEmblema(c, e, 10 + lado, 20, lado);
      expect(cajas.length).toBe(6);
      for (const b of cajas) for (const v of [b.x, b.y, b.w, b.h]) expect(Number.isInteger(v)).toBe(true);
      expect(cajas[0]?.fill).toBe("#191919");
      expect(cajas[1]?.fill).toBe(e.color);
      expect(cajas[2]?.fill).toBe(papelDe(e.color));
      // la tinta de la primera termina donde empieza la de la segunda: sin raya ni solapa
      expect((cajas[0]?.x ?? 0) + (cajas[0]?.w ?? 0)).toBe(cajas[3]?.x);
    }
  });
});
