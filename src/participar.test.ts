import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TEXTOS_CAMPANA } from "./campana/textos";

const html = readFileSync("participar.html", "utf8");

describe("el marcado de participar.html", () => {
  it("marca la página para dejar la cabecera mínima", () => {
    expect(html).toContain('<body class="pg-campana">');
  });

  it("deja un pie mínimo: Tinkazo, Términos y Hecho con amor en Bolivia", () => {
    const pie = html.split("<footer")[1] ?? "";
    expect(pie).not.toContain("/historia.html");
    expect(pie).toContain('href="/terminos.html"');
    expect(pie.match(/<a /gu)).toHaveLength(1);
    expect(pie).toContain('data-i="footL"');
    expect(pie).toContain('data-i="footR"');
  });

  it("la etiqueta de la demostración vive en la cabecera, es corta y la frase entera va en su ayuda", () => {
    const cabecera = /<header[\s\S]*<\/header>/.exec(html)?.[0] ?? "";
    expect(cabecera).toMatch(/<span id="cmp-ejemplo"[^>]*data-i="cpEjemplo"[^>]*>Demo<\/span>/u);
    expect(html.split("<main")[1] ?? "").not.toContain("cmp-ejemplo");
    expect(TEXTOS_CAMPANA.es.cpEjemplo).toBe("Demo");
    expect(TEXTOS_CAMPANA.en.cpEjemplo).toBe("Demo");
    expect(TEXTOS_CAMPANA.es.cpEjemploAnotar).toBe("Es una demostración: nadie queda anotado.");
    expect(cabecera).toContain('data-i-title="cpEjemploAnotar"');
  });

  it("la marca de la cabecera no lleva a la portada y deja a la persona en la campaña", () => {
    const cabecera = /<header[\s\S]*<\/header>/.exec(html)?.[0] ?? "";
    const marca = /<a class="wordmark"[^>]*>/u.exec(cabecera)?.[0] ?? "";
    expect(marca).not.toContain("href");
  });

  it("mantiene un único aviso accesible como hijo fijo de la pantalla", () => {
    const avisos = html.match(/<p id="cmp-mensaje"/gu) ?? [];
    expect(avisos).toHaveLength(1);
    expect(html).toMatch(/<main class="cmp">[\s\S]*<p id="cmp-mensaje"[^>]*role="status"/u);
    expect(html).toMatch(/<p id="cmp-mensaje"[^>]*aria-live="polite"/u);
  });
});
