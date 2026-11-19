import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { T } from "../i18n";

/**
 * Dos textos de la herramienta de siempre, que se ven sin bandera.
 * `salaBtn` nombra lo que hace el botón (agrandar la lista) y
 * `againQuitados` une los nombres como se habla, con `Intl.ListFormat`.
 */

describe("el botón de la lista en grande", () => {
  it("dice que la muestra en grande, en español y en inglés", () => {
    expect(T.es.salaBtn).toBe("Mostrar la lista en grande");
    expect(T.en.salaBtn).toBe("Show the list on the big screen");
  });

  it("la guía del meetup lo nombra con el texto exacto del botón en cada idioma", () => {
    const guia = readFileSync(new URL("../../sorteo-para-meetup.html", import.meta.url), "utf8");
    expect(guia).toContain(`<strong>${T.es.salaBtn}</strong>`);
    expect(guia).toContain(`<strong>${T.en.salaBtn}</strong>`);
    // Ningún nombre viejo del botón queda en la guía.
    for (const viejo of ["Mostrar la lista a la pantalla", "Mostrar la lista a la sala", "Show the list on the screen", "Show the list big", "Show the list to the room"]) {
      expect(guia).not.toContain(viejo);
    }
  });
});

describe("quién salió, arriba del cuadro", () => {
  it("une dos nombres con «y» en español y con «and» en inglés", () => {
    expect(T.es.againQuitados(["Carlos Choque", "María Quispe"], 5)).toBe(
      "Carlos Choque y María Quispe ya ganaron y no están en esta lista. Quedan 5.",
    );
    expect(T.en.againQuitados(["Carlos Choque", "María Quispe"], 5)).toBe(
      "Carlos Choque and María Quispe already won and are off this list. 5 left.",
    );
  });

  it("une tres nombres como se habla, sin comas solas", () => {
    expect(T.es.againQuitados(["Ana", "Beto", "Carla"], 4)).toBe(
      "Ana, Beto y Carla ya ganaron y no están en esta lista. Quedan 4.",
    );
    expect(T.en.againQuitados(["Ana", "Beto", "Carla"], 4)).toBe(
      "Ana, Beto, and Carla already won and are off this list. 4 left.",
    );
  });

  it("con uno o con más de tres queda como siempre", () => {
    expect(T.es.againQuitados(["Ana"], 4)).toBe("Ana ya ganó y no está en esta lista. Quedan 4.");
    expect(T.es.againQuitados(["Ana", "Beto", "Carla", "Dora"], 3)).toBe(
      "4 personas ya ganaron y no están en esta lista. Quedan 3.",
    );
    expect(T.en.againQuitados(["Ana"], 4)).toBe("Ana already won and is off this list. 4 left.");
    expect(T.en.againQuitados(["Ana", "Beto", "Carla", "Dora"], 3)).toBe(
      "4 people already won and are off this list. 3 left.",
    );
  });
});
