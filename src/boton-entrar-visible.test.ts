import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * El botón grande de la portada se lee desde el HTML, antes de que llegue el JS. Esconder su texto hasta que el JS
 * decide (contra el salto al recargar) quedó apagado detrás de un interruptor: el atributo `data-cta-espera` en la
 * etiqueta html de index.html, que hoy no está. Medido en un celular con datos lentos, el botón principal quedaba vacío
 * más de un segundo y el salto seguía igual, porque viene del cambio de tamaño del botón y no del cambio de texto. Si el
 * JS no llegaba a correr, quedaba vacío para siempre.
 */
describe("el texto del botón grande se ve desde el HTML", () => {
  const css = readFileSync("src/styles.css", "utf8");
  const html = readFileSync("index.html", "utf8");

  it("la regla que esconde el texto solo vale con el interruptor en la etiqueta html", () => {
    const reglas = css.split("\n").filter((linea) => linea.includes(".cta-t") && linea.includes("visibility: hidden"));
    expect(reglas.length).toBeGreaterThan(0);
    for (const linea of reglas) expect(linea.trim().startsWith("html[data-cta-espera] ")).toBe(true);
  });

  it("index.html no prende el interruptor", () => {
    const etiqueta = html.match(/<html\b[^>]*>/)?.[0] ?? "";
    expect(etiqueta).not.toBe("");
    expect(etiqueta).not.toContain("data-cta-espera");
  });

  it("los botones grandes traen su texto en el HTML", () => {
    const botones = html.match(/<a [^>]*data-cta-entrar[^>]*>[\s\S]*?<\/a>/g) ?? [];
    expect(botones).toHaveLength(3);
    for (const b of botones) expect(b).toContain('<span class="cta-t" data-i="ctaHero">Entrar y sortear gratis</span>');
  });
});
