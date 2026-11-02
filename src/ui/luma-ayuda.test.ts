import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { T } from "../i18n";

/**
 * "Desde Luma" a la vista y su "?" (luma-ayuda.ts). No hay DOM en las pruebas: se cuida que lo que el módulo busca esté
 * en `index.html`, que "Desde Luma" ya no viva dentro del pliegue, y que cada texto exista en los dos idiomas, sin el
 * punto medio y sin tecnicismos.
 */
describe("Luma a la vista y su ayuda", () => {
  const fuente = readFileSync(new URL("./luma-ayuda.ts", import.meta.url), "utf8");
  const html = readFileSync(new URL("../../index.html", import.meta.url), "utf8");
  const claves = ["lumaQ", "lumaT", "lumaP1", "lumaP2", "lumaP3", "lumaNota", "againSigue", "againSigueLuma", "pegarAyuda"];

  it("busca solo ids que están en index.html", () => {
    const buscados = [...fuente.matchAll(/getElementById\("([^"]+)"\)/g)].map((m) => m[1] as string);
    expect(buscados).toEqual(expect.arrayContaining(["luma-q", "luma-ayuda", "csv-luma"]));
    expect(buscados.filter((id) => !new RegExp(`\\bid="${id}"`).test(html))).toEqual([]);
  });

  it('"Desde Luma" está a la vista: antes del pliegue de las opciones, y su "?" abre el panel por aria-controls', () => {
    const luma = html.indexOf('id="csv-luma"');
    expect(luma).toBeGreaterThan(html.indexOf('id="origenes"'));
    expect(luma).toBeLessThan(html.indexOf('id="mas-opciones"'));
    expect(html).toMatch(/id="luma-q"[^>]*aria-controls="luma-ayuda"/);
    expect(html).toMatch(/id="luma-ayuda" hidden/);
  });

  it("el panel enseña tres pasos y cada texto está en es y en", () => {
    expect(html.match(/<li data-i="lumaP\d">/g)?.length).toBe(3);
    for (const l of ["es", "en"] as const) {
      for (const k of claves) {
        const v = T[l][k];
        expect(typeof v, `${l}.${k}`).toBe("string");
        expect(v as string, `${l}.${k}`).not.toMatch(/\u00b7|drand|hash|firma|XLM/i);
      }
    }
  });

  it("nada de rifa ni raffle en lo que se ve", () => {
    for (const l of ["es", "en"] as const) for (const k of claves) expect(T[l][k] as string).not.toMatch(/rifa|raffle/i);
  });
});
