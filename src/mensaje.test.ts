import { describe, expect, it } from "vitest";
import { T } from "./i18n";

const enlace = "https://tinkazo.app/verificar.html#rEJEMPLO";
const pie = { es: "Sorteado con Tinkazo · https://tinkazo.app", en: "Drawn with Tinkazo · https://tinkazo.app" } as const;

/**
 * El mensaje que se pega en el grupo. Lo dice quién ganó, entre cuántos, el
 * enlace para verificarlo y el pie de la marca, en los dos idiomas.
 */
describe("mensaje del resultado", () => {
  it("es: con premio y un ganador, palabra por palabra", () => {
    expect(T.es.summary("Ana", 12, "Pizza", enlace, false)).toBe(
      `Sorteo de Pizza: ganó Ana, entre 12 personas.\nNadie eligió este nombre.\nSi querés verificarlo, entrá acá: ${enlace}\n\n${pie.es}`,
    );
  });

  it("es: sin premio, con la primera letra en mayúscula", () => {
    const m = T.es.summary("Ana", 12, "", enlace, false);
    expect(m.startsWith("Ganó Ana, entre 12 personas.\n")).toBe(true);
    expect(m).not.toContain("Sorteo de");
  });

  it("es: varios ganadores, en plural", () => {
    const m = T.es.summary("Ana y Beto", 12, "Pizza", enlace, true);
    expect(m.startsWith("Sorteo de Pizza: ganaron Ana y Beto, entre 12 personas.\n")).toBe(true);
    expect(m).toContain("Nadie eligió estos nombres.");
  });

  it("en: con premio y un ganador", () => {
    expect(T.en.summary("Ana", 12, "Pizza", enlace, false)).toBe(
      `Pizza draw: the winner is Ana, out of 12 people.\nNobody picked this name.\nIf you want to verify it, open this link: ${enlace}\n\n${pie.en}`,
    );
  });

  it("en: sin premio y con varios ganadores", () => {
    const m = T.en.summary("Ana and Beto", 12, "", enlace, true);
    expect(m.startsWith("The winners are Ana and Beto, out of 12 people.\n")).toBe(true);
    expect(m).toContain("Nobody picked these names.");
  });

  it("todo mensaje trae el enlace y el pie, en cualquiera de sus formas", () => {
    for (const lang of ["es", "en"] as const) {
      for (const premio of ["", "Pizza"]) {
        for (const varios of [false, true]) {
          const m = T[lang].summary("Ana", 5, premio, enlace, varios);
          expect(m).toContain(enlace);
          expect(m.endsWith(pie[lang])).toBe(true);
        }
      }
    }
  });
});

describe("mensaje del evento", () => {
  it("es: cuántos sorteos hay, verificables, con el enlace y el pie", () => {
    expect(T.es.summaryEvento("20 de octubre de 2026", 3, enlace)).toBe(
      `Sorteos del 20 de octubre de 2026 (3 sorteos), todos verificables.\nSi querés verificarlos, entrá acá: ${enlace}\n\n${pie.es}`,
    );
  });

  it("es: un solo sorteo en singular", () => {
    expect(T.es.summaryEvento("20 de octubre de 2026", 1, enlace)).toContain("(1 sorteo), todos verificables.");
  });

  it("en: cuántos sorteos hay, con el enlace y el pie", () => {
    const m = T.en.summaryEvento("October 20, 2026", 3, enlace);
    expect(m.startsWith("Draws from October 20, 2026 (3 draws), all verifiable.\n")).toBe(true);
    expect(m).toContain(`If you want to verify them, open this link: ${enlace}`);
    expect(m.endsWith(pie.en)).toBe(true);
  });

  it("en: un solo sorteo en singular", () => {
    expect(T.en.summaryEvento("October 20, 2026", 1, enlace)).toContain("(1 draw), all verifiable.");
  });
});
