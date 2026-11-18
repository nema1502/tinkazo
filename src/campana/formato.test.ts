import { describe, expect, it } from "vitest";
import { TEXTOS_CAMPANA } from "./textos";
import { fechaTexto, horaTexto, montoTexto, premiosTexto } from "./formato";

const DIA = Date.UTC(2025, 10, 30, 2, 30);
const CIERRE = Date.UTC(2025, 10, 30, 1, 0);
const MEDIANOCHE = Date.UTC(2025, 10, 30, 4, 0);
const ZONA = "America/La_Paz";

describe("montoTexto", () => {
  it("formatea un entero en español", () => {
    expect(montoTexto(400000000n, "es")).toBe("40");
  });

  it("formatea un entero en inglés", () => {
    expect(montoTexto(400000000n, "en")).toBe("40");
  });

  it("trunca y separa los centavos en español", () => {
    expect(montoTexto(125000000n, "es")).toBe("12,50");
  });

  it("trunca y separa los centavos en inglés", () => {
    expect(montoTexto(125000000n, "en")).toBe("12.50");
  });

  it("nunca redondea para arriba: lo que no llega a un centavo más no lo suma", () => {
    expect(montoTexto(125990000n, "es")).toBe("12,59");
    expect(montoTexto(125990000n, "en")).toBe("12.59");
  });

  it("un centavo exacto se muestra como un centavo", () => {
    expect(montoTexto(100000n, "es")).toBe("0,01");
    expect(montoTexto(100000n, "en")).toBe("0.01");
  });
});

describe("premiosTexto", () => {
  it("fija el texto de un premio", () => {
    expect(premiosTexto([400000000n], "es")).toBe("40 dólares digitales");
  });

  it("fija el texto de varios premios iguales", () => {
    expect(premiosTexto([400000000n, 400000000n], "en")).toBe(
      "2 prizes of 40 digital dollars",
    );
  });

  it("lista premios distintos en inglés sin coma antes de and", () => {
    const premios = [400000000n, 200000000n, 100000000n];
    expect(premiosTexto(premios, "en")).toBe("Prizes for 3 people: 40, 20 and 10 digital dollars.");
  });

  it("lista premios distintos en español", () => {
    const premios = [400000000n, 200000000n, 100000000n];
    expect(premiosTexto(premios, "es")).toBe("Premios para 3 personas: 40, 20 y 10 dólares digitales.");
  });

  it("separa con barras una lista española que tiene decimales", () => {
    const premios = [125000000n, 200000000n, 100000000n];
    expect(premiosTexto(premios, "es")).toBe(
      "Premios para 3 personas: 12,50 / 20 / 10 dólares digitales.",
    );
  });
});

describe("fechaTexto", () => {
  it("usa la zona del evento y omite el año en español", () => {
    expect(fechaTexto(DIA, ZONA, "es")).toBe("29 de noviembre");
  });

  it("usa la zona del evento y omite el año en inglés", () => {
    expect(fechaTexto(DIA, ZONA, "en")).toBe("November 29");
  });

  it("incluye el año en español cuando se pide para un plazo", () => {
    expect(fechaTexto(DIA, ZONA, "es", true)).toBe("29 de noviembre de 2025");
  });

  it("incluye el año en inglés cuando se pide para un plazo", () => {
    expect(fechaTexto(DIA, ZONA, "en", true)).toBe("November 29, 2025");
  });
});

describe("horaTexto", () => {
  it("fija una hora de la noche en español", () => {
    expect(horaTexto(CIERRE, ZONA, "es")).toBe("21:00");
  });

  it("fija una hora de la noche en inglés", () => {
    expect(horaTexto(CIERRE, ZONA, "en")).toBe("21:00");
  });

  it("escribe la medianoche como 00:00", () => {
    expect(horaTexto(MEDIANOCHE, ZONA, "es")).toBe("00:00");
    expect(horaTexto(MEDIANOCHE, ZONA, "en")).toBe("00:00");
  });
});

describe("TEXTOS_CAMPANA", () => {
  it("tiene las mismas claves no vacías en los dos idiomas", () => {
    expect(Object.keys(TEXTOS_CAMPANA.es).sort()).toEqual(Object.keys(TEXTOS_CAMPANA.en).sort());
    for (const clave of Object.keys(TEXTOS_CAMPANA.es)) {
      const textoEs = TEXTOS_CAMPANA.es[clave] ?? "";
      const textoEn = TEXTOS_CAMPANA.en[clave] ?? "";
      expect(textoEs).not.toBe("");
      expect(textoEn).not.toBe("");
      expect(textoEs.match(/\{[^}]+\}/gu)?.sort()).toEqual(textoEn.match(/\{[^}]+\}/gu)?.sort());
    }
  });

  it("explica los pasos con vocabulario cotidiano en español", () => {
    expect(TEXTOS_CAMPANA.es.cpPasosNota).toBe(
      "Es un pedido. No cambia quién gana.",
    );
  });

  it("explica en inglés que cada persona puede rehacer el cálculo", () => {
    expect(TEXTOS_CAMPANA.en.cpComoSeEligeDetalle).toContain("anyone can work out who won for themselves");
  });

  it("no usa tecnicismos para explicar qué datos se guardan", () => {
    expect(TEXTOS_CAMPANA.es.cpQueGuardamos).not.toContain("cifrado");
    expect(TEXTOS_CAMPANA.en.cpQueGuardamos).not.toContain("encrypted");
  });
});
