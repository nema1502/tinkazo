import { describe, expect, it } from "vitest";
import type { Leyenda } from "../games/pixi/kit/leyenda";
import { htmlDeLeyenda, pintarLeyenda } from "./leyenda";

const LEYENDA: Leyenda = {
  es: ["Dicen que canta de noche.", "Lo oyen los viajeros.", "Nadie lo vio de cerca."],
  en: ["They say it sings at night.", "Travelers hear it.", "Nobody saw it up close."],
  fuente: { titulo: "Tradición oral del Oriente", url: "https://example.org/guajojo" },
};
const ROTULOS = { titulo: "¿De dónde viene este juego?", fuente: "Fuente" };

describe("la leyenda del juego, después del resultado", () => {
  it("sin leyenda no hay tarjeta", () => {
    expect(htmlDeLeyenda(undefined, "es", ROTULOS)).toBeNull();
  });

  it("es una tarjeta plegada con el título, las líneas y la fuente", () => {
    const html = htmlDeLeyenda(LEYENDA, "es", ROTULOS) as string;
    expect(html).toContain("<details");
    expect(html).not.toContain(" open");
    expect(html).toContain("<summary>¿De dónde viene este juego?</summary>");
    expect(html.match(/<p>/g)).toHaveLength(3);
    expect(html).toContain('href="https://example.org/guajojo"');
    expect(html).toContain('rel="noopener"');
    expect(html).toContain("Fuente: Tradición oral del Oriente");
  });

  it("sale en el idioma pedido", () => {
    const html = htmlDeLeyenda(LEYENDA, "en", { titulo: "Where does this game come from?", fuente: "Source" }) as string;
    expect(html).toContain("They say it sings at night.");
    expect(html).not.toContain("Dicen que");
    expect(html).toContain("Source: ");
  });

  it("escapa lo que viene del catálogo", () => {
    const html = htmlDeLeyenda({ ...LEYENDA, es: ['<img src=x onerror="alert(1)">'], en: ["x"] }, "es", ROTULOS) as string;
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  it("pintarLeyenda esconde la caja si el juego no trae leyenda o no existe", () => {
    const caja = { innerHTML: "algo", style: { display: "block" } } as unknown as HTMLElement;
    pintarLeyenda(caja, "inexistente", "es", ROTULOS);
    expect(caja.innerHTML).toBe("");
    expect(caja.style.display).toBe("none");
    pintarLeyenda(caja, null, "es", ROTULOS);
    expect(caja.style.display).toBe("none");
  });
});
