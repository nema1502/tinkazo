import { describe, expect, it } from "vitest";

describe("la vista previa del celular", () => {
  it("muestra la empresa, el premio y los pasos en el idioma pedido", async () => {
    const { vistaDelCelular } = await import("./vista");
    const lineas = vistaDelCelular(
      {
        empresa: "Café del Sol",
        cuando: "14 de marzo de 2027",
        lugar: "Parque de las aguas",
        cierre: "15:45",
        premio: "10 dólares para 5 personas",
        premios: "50 dólares",
        pasos: [{ texto: { es: "Seguí a @cafesol en Instagram", en: "Follow @cafesol on Instagram" } }, { texto: { es: "Etiquetá dos amigos en X", en: "Tag two friends on X" } }],
      },
      "es",
    );
    expect(lineas.join("\n")).toContain("Café del Sol");
    expect(lineas.join("\n")).toContain("10 dólares para 5 personas");
    expect(lineas.join("\n")).toContain("Seguí a @cafesol en Instagram");
    expect(lineas).toContain("1. Seguí a @cafesol en Instagram");
    expect(lineas).toContain("2. Etiquetá dos amigos en X");
    expect(lineas.join("\n")).not.toContain("Follow @cafesol");
  });

  it("en inglés no queda ninguna línea en español", async () => {
    const { vistaDelCelular } = await import("./vista");
    const lineas = vistaDelCelular(
      {
        empresa: "Café del Sol",
        cuando: "March 14, 2027",
        lugar: "Parque de las aguas",
        cierre: "15:45",
        premio: "10 dollars for 5 people",
        premios: "50 dollars",
        pasos: [{ texto: { es: "Seguí a @cafesol en Instagram", en: "Follow @cafesol on Instagram" } }],
      },
      "en",
    );
    expect(lineas).toContain("1. Follow @cafesol on Instagram");
    expect(lineas.join("\n")).not.toContain("Seguí a @cafesol");
  });

  it("lo que no se eligió todavía no aparece: sin lugar y sin premios, la vista sigue sana", async () => {
    const { vistaDelCelular } = await import("./vista");
    const lineas = vistaDelCelular(
      { empresa: "Mi empresa", cuando: null, lugar: null, cierre: null, premio: null, premios: null, pasos: [] },
      "es",
    );
    expect(lineas.join("\n")).toContain("Mi empresa");
    expect(lineas.length).toBeGreaterThan(0);
  });
});
