import { afterEach, describe, expect, it } from "vitest";
import { marcarStand } from "./ensayo-modo";
import { T, setPickSeed } from "./i18n";
import { TEXTOS as TEXTOS_AUTOS } from "./games/pixi/autos-textos";
import { TEXTOS as TEXTOS_BOLILLAS } from "./games/pixi/bolillas-textos";
import { TEXTOS as TEXTOS_GUAJOJO } from "./games/pixi/guajojo-textos";
import { TEXTOS as TEXTOS_TOBOROCHI } from "./games/pixi/toborochi-textos";
import { TEXTOS_CARRERA } from "./games/llamas/carrera-textos";

/**
 * Lo que dice el relator dentro del estadio en una ronda del stand. En el stand nadie gana ni se lleva un premio y nada se
 * sella: sale gente. Los subtítulos de cada juego que hablan de premios (el sapo, la chovena, el trompo, la piñata, La
 * Entrada, el teleférico, Guajojó y El Toborochi) cuentan lo mismo con las palabras del stand, igual que el cartel final
 * (`cWin`). Esta prueba llama a cada uno con el stand puesto y con cada variante que el azar puede elegir.
 */

/** Lo que el stand no dice: ganar, premio ni sello. Palabras enteras, para no tomar «llegan» ni «wind». */
const PROHIBIDO = /\bgan\p{L}*|premio|sell|\bwin(s|ner|ners|ning)?\b|prize|seal/iu;
/** Lo que no se escribe en ninguna cadena visible. */
const SIGNOS = /[;·—«»]/;

/** Una vuelta por cada variante que `pick` puede elegir. */
const AZARES = [0, 0.34, 0.67, 0.99];

type Funcion = (...args: unknown[]) => unknown;

/** Cada subtítulo con los argumentos con que lo llaman los juegos, uno por caso que cambia la frase. */
const CASOS: ReadonlyArray<[string, unknown[][]]> = [
  ["cTelPrize", [["Ana"]]],
  ["cTroWin", [["Ana, Beto y Nora", true], ["Ana", false]]],
  ["cSapNext", [[2, 3], [1, 3]]],
  ["cSapDone", [[1], [2]]],
  ["cSapTally", [[2, 3], [1, 2]]],
  ["cChoPrize", [["Ana"]]],
  ["cPinPrize", [[1], [2], [3]]],
  ["cOruFratStay", [[2, "los", "Caporales", 0], [2, "los", "Caporales", 1], [2, "las", "Morenadas", 3]]],
  ["cOruMemPrize", [[3, 1, 1], [3, 4, 1], [3, 4, 2]]],
  ["cPrizeOut", [[["Ana"]], [["Ana", "Beto"]], [["Ana", "Beto", "Nora"]]]],
];

function variantes(lang: "es" | "en", clave: string, args: unknown[]): string[] {
  const v = (T[lang] as unknown as Record<string, unknown>)[clave] as Funcion;
  const dichas: string[] = [];
  for (const azar of AZARES) {
    setPickSeed(() => azar);
    dichas.push(String(v(...args)));
  }
  setPickSeed(null);
  return dichas;
}

afterEach(() => {
  marcarStand(false);
  setPickSeed(null);
});

describe("los subtítulos del estadio en el stand", () => {
  for (const lang of ["es", "en"] as const) {
    for (const [clave, llamadas] of CASOS) {
      it(`${lang}.${clave} no habla de ganar, de premios ni de sellar`, () => {
        marcarStand(true);
        const mal: string[] = [];
        for (const args of llamadas) {
          for (const dicho of variantes(lang, clave, args)) {
            if (!dicho.trim() || PROHIBIDO.test(dicho) || SIGNOS.test(dicho)) mal.push(`${JSON.stringify(args)} dice: ${dicho}`);
          }
        }
        expect(mal, `${lang}.${clave}`).toEqual([]);
      });
    }
  }

  it("dicen quién sale, con el número de la persona o con su nombre", () => {
    marcarStand(true);
    expect(T.es.cSapNext(2, 3)).toBe("¡Va la persona 2!");
    expect(T.es.cSapTally(2, 3)).toBe("Persona 2 de 3");
    expect(T.en.cSapTally(2, 3)).toBe("Person 2 of 3");
    expect(variantes("es", "cChoPrize", ["Ana"])[0]).toContain("Ana");
    expect(variantes("en", "cTroWin", ["Ana, Beto y Nora", true]).every((t) => t.includes("Ana, Beto y Nora"))).toBe(true);
    expect(variantes("es", "cPrizeOut", [["Ana", "Beto"]]).every((t) => t.includes("Ana y Beto"))).toBe(true);
    expect(T.es.cOruMemPrize(3, 4, 2)).toContain("2");
    expect(T.es.cOruFratStay(2, "los", "Caporales", 2)).toContain("2");
  });

  it("una sola persona en el trompo sigue con sus frases de siempre", () => {
    marcarStand(true);
    for (const t of variantes("es", "cTroWin", ["Ana", false])) expect(t).toContain("Ana");
    expect(T.es.cOruFratStay(2, "los", "Caporales", 0)).toBe("¡Cuadra 2! Se quedan los Caporales");
  });
});

describe("fuera del stand los subtítulos son los de siempre", () => {
  it("siguen hablando de premios, como antes", () => {
    expect(T.es.cSapNext(2, 3)).toBe("¡Va el premio 2!");
    expect(T.es.cSapTally(2, 3)).toBe("Premio 2 de 3");
    expect(T.en.cSapNext(2, 3)).toBe("Prize 2, here it goes!");
    expect(T.es.cChoPrize("Ana")).toBe("¡Ana sale con premio!");
    expect(T.en.cChoPrize("Ana")).toBe("Ana goes out with a prize!");
    expect(T.es.cOruMemPrize(3, 4, 2)).toBe("¡Cuadra 3! Se quedan 4, 2 con premio");
    expect(T.es.cOruFratStay(2, "los", "Caporales", 2)).toBe("¡Cuadra 2! Se quedan los Caporales, con 2 premios");
    expect(T.en.cOruMemPrize(3, 4, 2)).toBe("Block 3! 4 stay, 2 with prizes");
    for (const t of variantes("es", "cTelPrize", ["Ana"])) expect(t).toMatch(/premio/);
    for (const t of variantes("es", "cPinPrize", [2])) expect(t).toMatch(/premio/);
    for (const t of variantes("en", "cPrizeOut", [["Ana"]])) expect(t).toMatch(/prize/);
    for (const t of variantes("es", "cTroWin", ["Ana y Beto", true])) expect(t).toMatch(/premios|llevan/);
  });
});

describe("el diccionario no deja un subtítulo de premios sin su versión del stand", () => {
  /** Los de los juegos que ya no se eligen en el selector: no se abren desde el stand (solo con `?demo=`). */
  const FUERA_DEL_STAND = new Set(["cQuiNext", "cQuiDone", "cLedgerHover", "cLedgerFinal"]);

  it("cada subtítulo c... que nombra premios, gana o sellos pregunta por el stand", () => {
    const sin: string[] = [];
    for (const lang of ["es", "en"] as const) {
      for (const [clave, v] of Object.entries(T[lang] as unknown as Record<string, unknown>)) {
        if (!/^c[A-Z]/.test(clave) || FUERA_DEL_STAND.has(clave)) continue;
        const fuente = typeof v === "function" ? String(v) : Array.isArray(v) ? v.join(" | ") : String(v);
        if (PROHIBIDO.test(fuente) && !/enStand/.test(fuente)) sin.push(`${lang}.${clave}`);
      }
    }
    expect(sin).toEqual([]);
  });
});

describe("los textos propios de cada juego en el stand", () => {
  const MODULOS: ReadonlyArray<[string, Record<"es" | "en", Readonly<Record<string, unknown>>>]> = [
    ["la carrera", TEXTOS_CARRERA as never],
    ["Guajojó", TEXTOS_GUAJOJO as never],
    ["El Toborochi", TEXTOS_TOBOROCHI as never],
    ["los autos", TEXTOS_AUTOS as never],
    ["las bolillas", TEXTOS_BOLILLAS as never],
  ];

  for (const [juego, textos] of MODULOS) {
    for (const lang of ["es", "en"] as const) {
      it(`${juego}, ${lang}: nada habla de ganar, de premios ni de sellar`, () => {
        marcarStand(true);
        const mal: string[] = [];
        for (const [clave, v] of Object.entries(textos[lang])) {
          const dichos = typeof v === "function" ? [String((v as Funcion)("Ana", 0, 1)), String((v as Funcion)("Ana", 1, 2))] : [String(v)];
          for (const dicho of dichos) if (PROHIBIDO.test(dicho) || SIGNOS.test(dicho)) mal.push(`${clave}: ${dicho}`);
        }
        expect(mal).toEqual([]);
      });
    }
  }
});
