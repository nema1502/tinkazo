// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { JUEGOS } from "../games/pixi/kit/catalogo";
import { T, setLang } from "../i18n";
import type { Game } from "../state";
import { NOMBRE, REGLA, showGameCard } from "./gamecard";
import { SELECTOR } from "./recomendar";

/**
 * La tarjeta de cómo se juega con uno, dos y cinco premios, en los dos idiomas y para cada juego: lo que la sala lee
 * nunca puede ser una clave cruda ("gcRaceMany" en letra grande). La carrera, que es del catálogo del kit, traía la
 * clave de varios premios por convención y no tenía su texto: con dos premios o más la tarjeta la mostraba tal cual.
 */

/** Los diez del selector (y, además, todo lo que el sitio sabe abrir: la demo y los auditores abren los que salieron). */
const DIEZ: readonly Game[] = ["race", "chovena", "trompo", "pinata", "oruro", "wheel", "teleferico", "sapo", "guajojo", "toborochi"];
const TODOS: readonly Game[] = [...new Set<Game>([...DIEZ, ...SELECTOR, ...(Object.keys(NOMBRE) as Game[]), ...JUEGOS.map((j) => j.id)])];

/** Una clave cruda: empieza con gc o jg y no tiene un solo espacio. */
const esCruda = (texto: string): boolean => /^(gc|jg)\S*$/.test(texto);

interface Leido {
  nombre: string;
  regla: string;
  extras: string[];
}

/** Abre la tarjeta de verdad, lee lo que se ve y la cierra. */
function leer(juego: Game, premios: number): Leido {
  const tarjeta = showGameCard(juego, 18, premios);
  try {
    const texto = (css: string): string => document.querySelector(css)?.textContent ?? "";
    return { nombre: texto(".gc-nombre"), regla: texto(".gc-regla"), extras: [...document.querySelectorAll(".gc-extra")].map((e) => e.textContent ?? "") };
  } finally {
    tarjeta.hide();
    document.querySelectorAll(".game-card").forEach((e) => e.remove());
  }
}

afterEach(() => {
  setLang("es");
  document.body.style.overflow = "";
});

describe("la tarjeta de cómo se juega no muestra una clave cruda", () => {
  it("los diez del selector están entre los que se recorren", () => {
    for (const juego of DIEZ) {
      expect(SELECTOR, juego).toContain(juego);
      expect(TODOS, juego).toContain(juego);
    }
  });

  for (const lang of ["es", "en"] as const) {
    for (const premios of [1, 2, 5]) {
      it(`${lang}, ${premios} ${premios === 1 ? "premio" : "premios"}: el nombre, la regla y lo que se suma son texto de verdad`, () => {
        setLang(lang);
        const mal: string[] = [];
        for (const juego of TODOS) {
          const v = leer(juego, premios);
          for (const [que, texto] of [["nombre", v.nombre], ["regla", v.regla], ...v.extras.map((e) => ["extra", e])] as Array<[string, string]>) {
            if (texto.trim() === "" || esCruda(texto.trim())) mal.push(`${juego} ${que}: "${texto}"`);
          }
        }
        expect(mal).toEqual([]);
      });
    }
  }
});

describe("la regla de varios premios", () => {
  it("la carrera cuenta sus varios premios con texto propio, sin la nota general", () => {
    for (const lang of ["es", "en"] as const) {
      setLang(lang);
      const v = leer("race", 5);
      expect(v.regla).toBe(T[lang].gcRaceMany);
      expect(v.extras).toEqual([]);
      // Con un solo premio, la regla de siempre.
      expect(leer("race", 1).regla).toBe(T[lang].gcRace);
    }
  });

  it("un juego sin su texto de varios premios usa la regla de siempre y la nota general", () => {
    for (const lang of ["es", "en"] as const) {
      setLang(lang);
      const texto = T[lang].gcRaceMany;
      delete T[lang].gcRaceMany;
      try {
        const v = leer("race", 5);
        expect(v.regla).toBe(T[lang].gcRace);
        expect(v.extras).toEqual([T[lang].gcPrizesNote(5)]);
      } finally {
        T[lang].gcRaceMany = texto as string;
      }
    }
  });

  it("los que tienen su texto de varios premios lo siguen usando", () => {
    setLang("es");
    expect(leer("sapo", 2).regla).toBe(T.es.gcSapoMany);
    expect(leer("chovena", 2).regla).toBe(T.es.gcChovenaMany);
    expect(leer("teleferico", 2).regla).toBe(T.es.gcTelefericoMany);
    expect(leer("guajojo", 2).regla).toBe(T.es.gcGuajojoMany);
    expect(leer("toborochi", 2).regla).toBe(T.es.gcToborochiMany);
  });

  it("los que no tienen texto de varios premios dicen la regla y la nota general", () => {
    setLang("es");
    for (const juego of ["trompo", "pinata", "wheel", "oruro"] as const) {
      const v = leer(juego, 5);
      expect(v.regla, juego).toBe(T.es[REGLA[juego] as string]);
      expect(v.extras, juego).toEqual([T.es.gcPrizesNote(5)]);
    }
  });
});
