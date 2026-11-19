import { describe, expect, it } from "vitest";
import { T } from "../i18n";
import { fotoDeSorteo, mensajeDeSorteo } from "./compartir";

/**
 * Con una lista de equipos, lo que se pega en el grupo y el texto de la foto dicen equipos y no personas. Quien
 * llama sabe si la lista sellada es de equipos y lo avisa con `equipos`. Sin ese dato, todo sigue igual que antes.
 */

const enlace = "https://tinkazo.app/verificar.html#rEJEMPLO";
const lista = (lang: "es" | "en", nombres: string[]): string => new Intl.ListFormat(lang === "es" ? "es" : "en", { type: "conjunction" }).format(nombres);

const casos = [
  { ganadores: ["Los Cóndores"], premio: "Pizza" },
  { ganadores: ["Los Cóndores"], premio: "" },
  { ganadores: ["Los Cóndores", "Pumas"], premio: "Pizza" },
  { ganadores: ["Los Cóndores", "Pumas", "Halcones"], premio: "" },
];

describe("el mensaje del sorteo con una lista de equipos", () => {
  for (const lang of ["es", "en"] as const) {
    for (const c of casos) {
      it(`${lang}: ${c.ganadores.length} ganador(es), premio "${c.premio}", igual a T.${lang}.summary con equipos`, () => {
        const varios = c.ganadores.length > 1;
        const esperado = T[lang].summary(lista(lang, c.ganadores), 12, c.premio, enlace, varios, undefined, undefined, true);
        const mensaje = mensajeDeSorteo(lang, { ganadores: c.ganadores, total: 12, premio: c.premio, enlace, equipos: true });
        expect(mensaje).toBe(esperado);
        expect(mensaje).toContain(lang === "es" ? "entre 12 equipos" : "out of 12 teams");
        expect(mensaje).not.toMatch(/personas|people/);
      });
    }
  }

  it("sin el dato de equipos sigue diciendo personas", () => {
    expect(mensajeDeSorteo("es", { ganadores: ["Ana"], total: 12, premio: "", enlace })).toContain("entre 12 personas");
    expect(mensajeDeSorteo("en", { ganadores: ["Ana"], total: 12, premio: "", enlace })).toContain("out of 12 people");
    expect(T.es.summary("Ana", 12, "", enlace, false)).toContain("entre 12 personas");
    expect(T.en.summary("Ana", 12, "", enlace, false)).toContain("out of 12 people");
  });

  it("con varias participaciones por persona se queda con las dos cuentas de personas", () => {
    const d = { ganadores: ["Ana"], total: 5, personas: 2, premio: "", enlace, equipos: true };
    expect(mensajeDeSorteo("es", d)).toContain("entre 5 participaciones de 2 personas");
    expect(mensajeDeSorteo("en", d)).toContain("out of 5 entries from 2 people");
  });
});

describe("la foto del sorteo con una lista de equipos", () => {
  it("dice equipos, en singular y en plural, en los dos idiomas", () => {
    const uno = { ganadores: ["Los Cóndores"], total: 12, premio: "", enlace, equipos: true };
    const varios = { ganadores: ["Los Cóndores", "Pumas"], total: 12, premio: "", enlace, equipos: true };
    expect(fotoDeSorteo("es", uno, enlace).lineas).toContain("Salió entre 12 equipos");
    expect(fotoDeSorteo("es", varios, enlace).lineas).toContain("Salieron entre 12 equipos");
    expect(fotoDeSorteo("en", uno, enlace).lineas).toContain("Drawn from 12 teams");
    expect(fotoDeSorteo("en", varios, enlace).lineas).toContain("Drawn from 12 teams");
  });

  it("sin el dato de equipos sigue diciendo personas", () => {
    const d = { ganadores: ["Ana"], total: 12, premio: "", enlace };
    expect(fotoDeSorteo("es", d, enlace).lineas).toContain("Salió entre 12 personas");
    expect(fotoDeSorteo("en", d, enlace).lineas).toContain("Drawn from 12 people");
  });
});

describe("la nota de No está, con equipos", () => {
  it("cuenta equipos en los dos idiomas y personas por omisión", () => {
    expect(T.es.ausenteNota("Pumas", 5, false, 1, true)).toContain("entre los 5 equipos que quedan");
    expect(T.en.ausenteNota("Pumas", 5, false, 1, true)).toContain("among the 5 teams left");
    expect(T.es.ausenteNota("Ana", 5, false, 1, false)).toContain("entre las 5 personas que quedan");
    expect(T.en.ausenteNota("Ana", 5, false, 1, false)).toContain("among the 5 people left");
  });
});
