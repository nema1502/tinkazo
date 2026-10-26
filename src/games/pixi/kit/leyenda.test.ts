import { describe, expect, it } from "vitest";
import { MAX_LINEAS, leyendaEn, problemasDeLeyenda, type Leyenda } from "./leyenda";

const BUENA: Leyenda = {
  es: ["Dicen que el guajojó canta de noche.", "Lo escuchan los viajeros del Oriente.", "Nadie lo ha visto de cerca."],
  en: ["They say the guajojó sings at night.", "Travelers in the lowlands hear it.", "Nobody has seen it up close."],
  fuente: { titulo: "Ejemplo, tradición oral recogida en el Oriente", url: "https://example.org/guajojo" },
};

describe("leyenda", () => {
  it("una leyenda con sus dos idiomas y su fuente se puede mostrar", () => {
    expect(problemasDeLeyenda(BUENA)).toEqual([]);
  });

  it("no pasa de cinco líneas ni queda vacía", () => {
    const seis = ["a", "b", "c", "d", "e", "f"];
    expect(problemasDeLeyenda({ ...BUENA, es: seis, en: seis }).length).toBeGreaterThan(0);
    expect(MAX_LINEAS).toBe(5);
    expect(problemasDeLeyenda({ ...BUENA, es: [], en: [] }).length).toBeGreaterThan(0);
    expect(problemasDeLeyenda({ ...BUENA, es: ["uno", " "], en: ["one", "two"] })).toContain("es: la línea 2 está vacía");
  });

  it("los dos idiomas tienen las mismas líneas", () => {
    expect(problemasDeLeyenda({ ...BUENA, en: BUENA.en.slice(0, 2) })).toContain("las líneas en español y en inglés no son las mismas");
  });

  it("una línea larga sin traducir se detecta", () => {
    expect(problemasDeLeyenda({ ...BUENA, en: [BUENA.es[0] as string, ...BUENA.en.slice(1)] }).join(" ")).toContain("falta traducirla");
  });

  it("sin fuente primaria no hay leyenda: hace falta el título y un enlace https", () => {
    expect(problemasDeLeyenda({ ...BUENA, fuente: { titulo: "", url: BUENA.fuente.url } })).toContain("falta el título de la fuente");
    expect(problemasDeLeyenda({ ...BUENA, fuente: { titulo: "x", url: "http://example.org/a" } })).toContain("la fuente tiene que ser un enlace https");
    expect(problemasDeLeyenda({ ...BUENA, fuente: { titulo: "x", url: "" } })).toContain("la fuente tiene que ser un enlace https");
  });

  it("una línea de más de 200 caracteres se marca", () => {
    const larga = "x".repeat(201);
    expect(problemasDeLeyenda({ ...BUENA, es: [larga], en: ["short line"] }).join(" ")).toContain("pasa de 200");
  });

  it("muestra el idioma pedido", () => {
    expect(leyendaEn(BUENA, "en").lineas[0]).toBe("They say the guajojó sings at night.");
    expect(leyendaEn(BUENA, "es").fuente.url).toBe("https://example.org/guajojo");
  });
});
