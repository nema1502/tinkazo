import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { T } from "../../../i18n";
import { SELECTOR } from "../../../ui/recomendar";
import { JUEGOS, clavesDe, entradaDe, esDelKit } from "./catalogo";
import { problemasDeLeyenda } from "./leyenda";

const publico = (id: string): string => new URL(`../../../../public/juegos/${id}.webp`, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

describe("el catálogo del kit: la convención de claves", () => {
  it("las claves de texto del sitio salen del id", () => {
    expect(clavesDe("guajojo")).toEqual({ boton: "gameGuajojo", nombre: "jgGuajojoN", regla: "gcGuajojo", varios: "gcGuajojoMany" });
  });

  it("encuentra los juegos por id", () => {
    expect(entradaDe("inexistente")).toBeUndefined();
    expect(esDelKit("inexistente")).toBe(false);
    for (const j of JUEGOS) {
      expect(entradaDe(j.id)).toBe(j);
      expect(esDelKit(j.id)).toBe(true);
    }
  });

  it("los ids son únicos y de tres a doce letras minúsculas", () => {
    const ids = JUEGOS.map((j) => j.id as string);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z]{3,12}$/);
  });
});

describe("el catálogo del kit: cada juego trae lo que el sitio le pide", () => {
  it("se revisa cada entrada del catálogo (sin juegos, no hay nada que revisar)", () => {
    expect(JUEGOS.length).toBeGreaterThanOrEqual(0);
  });

  for (const j of JUEGOS) {
    const c = clavesDe(j.id);

    it(`${j.id}: el botón, el nombre y la regla están en español y en inglés`, () => {
      for (const clave of [c.boton, c.nombre, c.regla]) {
        expect(typeof T.es[clave], `es.${clave}`).toBe("string");
        expect(typeof T.en[clave], `en.${clave}`).toBe("string");
      }
      // La regla con varios premios, si existe en un idioma, existe en los dos.
      expect(c.varios in T.es).toBe(c.varios in T.en);
    });

    it(`${j.id}: la historia, si la trae, tiene sus dos frases y su fuente https`, () => {
      if (!j.historia) return;
      for (const clave of [j.historia.q, j.historia.a]) {
        expect(typeof T.es[clave], `es.${clave}`).toBe("string");
        expect(typeof T.en[clave], `en.${clave}`).toBe("string");
      }
      expect(j.historia.href).toMatch(/^https:\/\//);
    });

    it(`${j.id}: la leyenda, si la trae, cumple las reglas`, () => {
      if (j.leyenda) expect(problemasDeLeyenda(j.leyenda)).toEqual([]);
    });

    it(`${j.id}: un juego apagado no está en el selector, y uno encendido está completo`, () => {
      if (!j.selector) {
        expect(SELECTOR).not.toContain(j.id);
        return;
      }
      expect(SELECTOR).toContain(j.id);
      expect(j.captura, "una captura para la tarjeta").toBe(true);
      expect(j.historia?.borrador ?? false, "la historia sin borrador").toBe(false);
      expect(j.rango.maximo ?? j.rango.minimo, "un rango").toBeDefined();
    });

    it(`${j.id}: si declara captura, el archivo existe`, () => {
      if (j.captura) expect(existsSync(publico(j.id))).toBe(true);
    });
  }
});
