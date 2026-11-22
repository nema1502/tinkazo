import { describe, expect, it } from "vitest";
import { DIRECCION_DE_LA_CAMPANA, direccionDelPanel } from "./direccion-del-panel";

describe("la dirección del panel de la campaña", () => {
  it("sin idioma ni tema en la dirección de origen es la de siempre", () => {
    expect(DIRECCION_DE_LA_CAMPANA).toBe("/?campana&red=oficial");
    expect(direccionDelPanel("")).toBe("/?campana&red=oficial");
    expect(direccionDelPanel("?demo=1")).toBe("/?campana&red=oficial");
  });

  it("el idioma y el tema del armado pasan al panel", () => {
    expect(direccionDelPanel("?lang=en&theme=light")).toBe("/?campana&red=oficial&lang=en&theme=light");
    expect(direccionDelPanel("theme=dark")).toBe("/?campana&red=oficial&theme=dark");
    expect(direccionDelPanel("?lang=es")).toBe("/?campana&red=oficial&lang=es");
  });

  it("lo que no es un idioma ni un tema conocido no se pasa", () => {
    expect(direccionDelPanel("?lang=fr&theme=rosa")).toBe("/?campana&red=oficial");
    expect(direccionDelPanel("?lang=en%26red%3Dprueba")).toBe("/?campana&red=oficial");
  });
});
