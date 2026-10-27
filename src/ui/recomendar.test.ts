import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CARRILES_CARRERA, JUEGO_DE_SIEMPRE, SELECTOR, juegoPorDefecto, juegoSiguiente, rangoParaLeer, rangoVisible, recomendar, type Recomendacion } from "./recomendar";
import { T } from "../i18n";
import { JUEGOS } from "../games/pixi/kit/catalogo";
import { FINALISTAS } from "../games/llamas/carrera-base";
import type { Game } from "../state";

describe("los textos de la recomendación, en es y en en", () => {
  it("cada nota que puede salir tiene su frase en los dos idiomas", () => {
    const claves = new Set<string>(["recBadge", "recHead"]);
    for (let n = 1; n <= 210; n++) for (const premios of [1, 9]) for (const r of recomendar(n, premios).games) if (r.note) claves.add(r.note);
    for (const l of ["es", "en"] as const) {
      const faltan = [...claves].filter((k) => {
        const v = T[l][k];
        return typeof v !== "string" && typeof v !== "function";
      });
      expect(faltan, l).toEqual([]);
    }
  });

  it("no usa palabras de apuesta, rifa, boleto, lotería ni casino", () => {
    for (const l of ["es", "en"] as const) {
      const textos = Object.entries(T[l])
        .filter(([k]) => k.startsWith("rec"))
        .map(([, v]) => (typeof v === "function" ? (v as (...a: number[]) => string)(3, 2, 8) : String(v)));
      expect(textos.filter((x) => /apuest|rifa|boleto|loter|casino|\bbet|raffle|lotter|ticket/i.test(x)), l).toEqual([]);
    }
  });
});

describe("el selector y su recomendación hablan de los mismos juegos", () => {
  it("SELECTOR son los botones de GAME_BUTTONS en freeze.ts, en el mismo orden", () => {
    const fuente = readFileSync(new URL("./freeze.ts", import.meta.url), "utf8");
    const botones = [...fuente.matchAll(/\["g-[a-z]+", "([a-z]+)"\]/g)].map((m) => m[1] as string);
    // De pie y El Trueque (26 de octubre de 2026) siguen en GAME_BUTTONS: sus botones quedan en el HTML, apagados.
    // Más los del kit ya encendidos, que freeze.ts y recomendar.ts suman del catálogo.
    const encendidos = JUEGOS.filter((j) => j.selector && !botones.includes(j.id)).map((j) => j.id as string);
    expect([...botones.filter((b) => b !== "quien" && b !== "trueque"), ...encendidos]).toEqual([...SELECTOR]);
  });

  it("la tómbola sale del selector: sigue existiendo, pero sin botón", () => {
    expect(SELECTOR).not.toContain("tombola");
  });

  it("son los ocho que quedaron el 26 de octubre de 2026 (De pie y El Trueque salieron), de las salas chicas a las grandes", () => {
    expect([...SELECTOR]).toEqual(["race", "sapo", "trompo", "chovena", "pinata", "wheel", "teleferico", "oruro"]);
  });

  it("el Aguayo y la Constelación salen del selector, y el 26 de octubre de 2026 también De pie y El Trueque", () => {
    expect(SELECTOR).not.toContain("pasanaku");
    expect(SELECTOR).not.toContain("stellar");
    expect(SELECTOR).not.toContain("trueque");
    expect(SELECTOR).not.toContain("quien");
  });

  it("los botones g-* de index.html son los mismos, en el mismo orden", () => {
    const html = readFileSync(new URL("../../index.html", import.meta.url), "utf8");
    const selector = html.slice(html.indexOf('id="gamepick"'), html.indexOf("</div>", html.indexOf('id="gamepick"')));
    const botones = [...selector.matchAll(/<button id="g-([a-z]+)"/g)].map((m) => m[1]);
    // Los dos que salieron (De pie y El Trueque) quedan en el HTML, apagados (`hidden`): audit-game los marca así.
    const apagados = [...selector.matchAll(/<button id="g-([a-z]+)"( hidden)?/g)].filter((m) => m[2]).map((m) => m[1]);
    expect(apagados).toEqual(["quien", "trueque"]);
    expect(botones.filter((b) => !apagados.includes(b))).toEqual([...SELECTOR]);
  });
});

/** Los juegos de cada grupo, en el orden en que `recomendar` los da. */
function grupos(n: number) {
  const { games } = recomendar(n);
  const de = (f: (r: Recomendacion) => boolean): Game[] => games.filter(f).map((r) => r.game);
  return {
    encajan: de((r) => r.fits === true),
    neutral: de((r) => r.fits === null),
    no: de((r) => r.fits === false),
  };
}

describe("recomendar: qué juegos sirven para cuántas personas (auditoría, sección 6)", () => {
  // Las listas salen de la sección 6 y de la regla de la 8.1: los que encajan
  // primero (los del ideal antes), los neutrales (sin rango claro) en medio, y
  // los que no encajan al final, atenuados.

  it("con 1 persona no encaja nadie que tenga rango; la piñata y la ruleta, que solo tienen tope, quedan neutrales", () => {
    expect(grupos(1)).toEqual({
      encajan: [],
      neutral: ["pinata", "wheel"],
      no: ["race", "sapo", "trompo", "chovena", "teleferico", "oruro"],
    });
  });

  it("con 2, la mesa y la carrera y el trompo encajan (ninguno ideal); chovena, De pie, El Trueque, teleférico y La Entrada no llegan", () => {
    expect(grupos(2)).toEqual({
      encajan: ["sapo", "race", "trompo"],
      neutral: ["pinata", "wheel"],
      no: ["chovena", "teleferico", "oruro"],
    });
  });

  it("con 8, el ideal de la carrera, el sapo y el trompo va primero, y chovena y De pie encajan justo en el mínimo", () => {
    expect(grupos(8)).toEqual({
      encajan: ["sapo", "race", "trompo", "chovena"],
      neutral: ["pinata", "wheel"],
      no: ["teleferico", "oruro"],
    });
  });

  it("con 12, chovena, el sapo, la carrera (el pelotón) y el trompo están en su ideal, y El Trueque entra por su mínimo", () => {
    expect(grupos(12)).toEqual({
      encajan: ["chovena", "sapo", "race", "trompo"],
      neutral: ["pinata", "wheel"],
      no: ["teleferico", "oruro"],
    });
  });

  it("con 16, teleférico entra por su mínimo, y el sapo por la clasificatoria; El Trueque los pasa por puntaje", () => {
    expect(grupos(16)).toEqual({
      encajan: ["chovena", "race", "sapo", "teleferico"],
      neutral: ["pinata", "wheel"],
      no: ["trompo", "oruro"],
    });
  });

  it("con 30, El Trueque, chovena, teleférico y la carrera (el pelotón entero) están en su ideal; La Entrada entra por su mínimo y va al final; la ruleta sigue, neutral, hasta 200", () => {
    expect(grupos(30)).toEqual({
      encajan: ["chovena", "teleferico", "race", "sapo", "oruro"],
      neutral: ["pinata", "wheel"],
      no: ["trompo"],
    });
  });

  it("con 50, chovena y teleférico están en su ideal, y la carrera y La Entrada también encajan; el sapo pasa de su clasificatoria", () => {
    expect(grupos(50)).toEqual({
      encajan: ["chovena", "teleferico", "race", "oruro"],
      neutral: ["pinata", "wheel"],
      no: ["sapo", "trompo"],
    });
  });

  it("con 100, teleférico en su ideal; la carrera, con sus tandas, y La Entrada también encajan; chovena ya pasa de sus 80", () => {
    expect(grupos(100)).toEqual({
      encajan: ["teleferico", "race", "oruro"],
      neutral: ["pinata", "wheel"],
      no: ["sapo", "trompo", "chovena"],
    });
  });

  it("con 200, teleférico, la carrera y La Entrada llegan justo a su máximo, y la piñata y la ruleta también", () => {
    expect(grupos(200)).toEqual({
      encajan: ["teleferico", "race", "oruro"],
      neutral: ["pinata", "wheel"],
      no: ["sapo", "trompo", "chovena"],
    });
  });

  it("Piñata solo tiene tope (200) y La Entrada va de 30 a 200 (docs/juegos.md)", () => {
    const juego = (g: Game, n: number) => recomendar(n).games.find((r) => r.game === g);
    for (const n of [1, 2, 30, 200]) expect(juego("pinata", n), `pinata ${n}`).toMatchObject({ fits: null, note: null });
    expect(juego("pinata", 201)).toMatchObject({ fits: false, note: "rec.pinata.largo" });
    expect(juego("oruro", 29)).toMatchObject({ fits: false, note: "rec.oruro.corto" });
    expect(juego("oruro", 30)).toMatchObject({ fits: true, ideal: false, note: "rec.oruro.alto" });
    expect(juego("oruro", 200)).toMatchObject({ fits: true, ideal: false, note: "rec.oruro.alto" });
    expect(juego("oruro", 201)).toMatchObject({ fits: false, note: "rec.oruro.largo" });
  });

  it("La Entrada, sin ideal ni puntaje, va al final de los recomendados y nunca es el primero si otro encaja", () => {
    for (let n = 2; n <= 200; n++) {
      const encajan = recomendar(n).games.filter((r) => r.fits === true).map((r) => r.game);
      const finales = encajan.filter((g) => g === "oruro");
      expect(encajan.slice(encajan.length - finales.length), `n=${n}`).toEqual(finales);
      if (encajan.length > finales.length) expect(finales, `n=${n}`).not.toContain(encajan[0]);
    }
  });

  it("nunca pierde ni repite un juego del selector", () => {
    for (const n of [1, 2, 8, 12, 16, 30, 50, 100, 200]) {
      const nombres = recomendar(n).games.map((r) => r.game);
      expect([...nombres].sort()).toEqual([...SELECTOR].sort());
    }
  });

  it("pone los que encajan primero, después los neutrales y al final los que no encajan", () => {
    for (const n of [1, 2, 8, 12, 16, 30, 50, 100, 200]) {
      const { encajan, neutral, no } = grupos(n);
      expect(recomendar(n).games.map((r) => r.game)).toEqual([...encajan, ...neutral, ...no]);
    }
  });

  it("entre los que encajan, los del ideal van antes que los que solo entran en el rango", () => {
    for (let n = 2; n <= 200; n++) {
      const encajan = recomendar(n).games.filter((r) => r.fits === true);
      const primeroNoIdeal = encajan.findIndex((r) => !r.ideal);
      if (primeroNoIdeal >= 0) expect(encajan.slice(primeroNoIdeal).some((r) => r.ideal), `n=${n}`).toBe(false);
    }
  });

  it("solo los que encajan y los que no encajan llevan nota; los neutrales no", () => {
    for (const n of [1, 2, 8, 12, 16, 30, 50, 100, 200]) {
      for (const r of recomendar(n).games) {
        if (r.fits === null) expect(r.note, `${r.game} n=${n}`).toBeNull();
        else expect(r.note, `${r.game} n=${n}`).toMatch(/^rec\.[a-z]+\.(ideal|bajo|alto|largo|corto)$/);
      }
    }
  });

  it("la ruleta solo se atenúa por encima de 200, y nunca se recomienda", () => {
    expect(recomendar(200).games.find((r) => r.game === "wheel")?.fits).toBeNull();
    expect(recomendar(201).games.find((r) => r.game === "wheel")?.fits).toBe(false);
    for (const n of [2, 24, 25, 100, 200, 201]) {
      expect(recomendar(n).games.some((r) => r.game === "wheel" && r.fits === true), `n=${n}`).toBe(false);
    }
  });

  it("el tope de la ruleta es el mismo WHEEL_MAX de state.ts", () => {
    const fuente = readFileSync(new URL("../state.ts", import.meta.url), "utf8");
    const tope = Number(/export const WHEEL_MAX = (\d+);/.exec(fuente)?.[1]);
    expect(tope).toBeGreaterThan(0);
    expect(recomendar(tope).games.find((r) => r.game === "wheel")?.fits).toBeNull();
    expect(recomendar(tope + 1).games.find((r) => r.game === "wheel")?.fits).toBe(false);
  });

  it("la nota dice bajo, alto, largo o corto según de qué lado cae la cantidad", () => {
    const nota = (g: Game, n: number) => recomendar(n).games.find((r) => r.game === g)?.note;
    expect(nota("race", 4)).toBe("rec.race.ideal");
    expect(nota("race", 2)).toBe("rec.race.bajo");
    expect(nota("race", 9)).toBe("rec.race.ideal");
    expect(nota("race", 31)).toBe("rec.race.alto");
    expect(nota("race", 200)).toBe("rec.race.alto");
    expect(nota("race", 201)).toBe("rec.race.largo");
    expect(nota("race", 1)).toBe("rec.race.corto");
    expect(nota("sapo", 20)).toBe("rec.sapo.alto");
    expect(nota("chovena", 70)).toBe("rec.chovena.alto");
    expect(nota("teleferico", 170)).toBe("rec.teleferico.alto");
  });

  it("los que salieron del selector no se ofrecen nunca, para ninguna cantidad", () => {
    for (let n = 0; n <= 210; n++) {
      const nombres = recomendar(n).games.map((r) => r.game);
      for (const fuera of ["tombola", "pasanaku", "stellar", "luz", "ledger", "rockets", "totora"]) {
        expect(nombres, `${fuera} con ${n}`).not.toContain(fuera);
      }
    }
  });

  it("los números de la nota son la cantidad, el mínimo y el máximo", () => {
    const r = recomendar(50).games.find((x) => x.game === "sapo");
    expect(r?.args).toEqual([50, 2, 40]);
  });
});

describe("rangoVisible: lo que dice la tarjeta del selector bajo el nombre", () => {
  it("va del mínimo (2 si el juego no tiene) al máximo", () => {
    expect(Object.fromEntries(SELECTOR.map((g) => [g, rangoVisible(g)]))).toEqual({
      race: "2–200", sapo: "2–40", trompo: "2–14", chovena: "8–80", pinata: "2–200", wheel: "2–200", teleferico: "16–200", oruro: "30–200",
    });
  });

  it("una tarjeta con estrella nunca muestra un rango que no incluye a la lista (de 2 a 200 personas)", () => {
    const rango = (g: Game): [number, number] => {
      const [a, b] = (rangoVisible(g) ?? "0–0").split("–").map(Number);
      return [a as number, b as number];
    };
    let estrellas = 0;
    for (let n = 2; n <= 200; n++) {
      for (const r of recomendar(n).games.filter((x) => x.fits === true)) {
        const [desde, hasta] = rango(r.game);
        expect(n >= desde && n <= hasta, `${r.game} con ${n}: «${rangoVisible(r.game)}»`).toBe(true);
        estrellas++;
      }
    }
    expect(estrellas).toBeGreaterThan(300);
  });

  it("y un juego atenuado (que no encaja) tampoco incluye a la lista en su rango", () => {
    for (let n = 2; n <= 200; n++) {
      for (const r of recomendar(n).games.filter((x) => x.fits === false)) {
        const [a, b] = (rangoVisible(r.game) ?? "0–0").split("–").map(Number);
        expect(n >= (a as number) && n <= (b as number), `${r.game} con ${n}`).toBe(false);
      }
    }
  });
});

describe("recomendar: la duración de la sección 8.2 (Normal)", () => {
  it("sigue la tabla de la auditoría, tramo por tramo", () => {
    const d = (n: number) => recomendar(n).duracionNormal;
    expect(d(2)).toEqual({ desde: 24, hasta: 24 });
    expect(d(8)).toEqual({ desde: 24, hasta: 24 });
    expect(d(9)).toEqual({ desde: 26, hasta: 28 });
    expect(d(20)).toEqual({ desde: 26, hasta: 28 });
    expect(d(21)).toEqual({ desde: 28, hasta: 30 });
    expect(d(50)).toEqual({ desde: 28, hasta: 30 });
    expect(d(51)).toEqual({ desde: 30, hasta: 32 });
    expect(d(100)).toEqual({ desde: 30, hasta: 32 });
    expect(d(101)).toEqual({ desde: 32, hasta: 34 });
    expect(d(200)).toEqual({ desde: 32, hasta: 34 });
  });

  it("fuera de 2 a 200 no hay tramo", () => {
    expect(recomendar(1).duracionNormal).toBeNull();
    expect(recomendar(201).duracionNormal).toBeNull();
  });
});

describe("recomendar: entradas raras", () => {
  it("un número negativo, NaN o con decimales se toma como un entero no negativo", () => {
    expect(recomendar(-5)).toEqual(recomendar(0));
    expect(recomendar(Number.NaN)).toEqual(recomendar(0));
    expect(recomendar(8.9)).toEqual(recomendar(8));
  });
});

describe("el juego que queda elegido si nadie eligió otro (D02)", () => {
  it("el de siempre es el de app.game en state.ts", () => {
    const state = readFileSync(new URL("../state.ts", import.meta.url), "utf8");
    expect(state).toMatch(new RegExp(`game: "${JUEGO_DE_SIEMPRE}"`));
  });

  it("con pocas personas, el de siempre, que encaja", () => {
    for (const n of [2, 4, 8]) expect(juegoPorDefecto(n), String(n)).toBe(JUEGO_DE_SIEMPRE);
  });

  it("con 20, la carrera (llega hasta 30 con el pelotón): el de siempre sigue elegido porque encaja", () => {
    expect(juegoPorDefecto(20)).toBe("race");
    expect(juegoPorDefecto(30)).toBe("race");
  });

  it("con más de 30, el primero de los recomendados, no la carrera (con más pasa por tandas: encaja, pero no es lo ideal)", () => {
    const primero = recomendar(31).games.find((r) => r.fits === true)?.game;
    expect(juegoPorDefecto(31)).toBe(primero);
    expect(juegoPorDefecto(31)).not.toBe("race");
    for (const n of [9, 12, 20, 31, 50, 120, 200]) expect(recomendar(n).games.find((r) => r.game === juegoPorDefecto(n))?.fits, String(n)).toBe(true);
  });

  it("si ninguno encaja (más de doscientos), el de siempre", () => {
    expect(juegoPorDefecto(500)).toBe(JUEGO_DE_SIEMPRE);
  });
});

describe("el rango de personas dicho en voz alta (el aria-label del selector)", () => {
  it("en español se une con \"a\" y en inglés con \"to\": nunca \"For 4 a 30 people\"", () => {
    expect(rangoParaLeer("4–30", T.es.recRangoAria as string, T.es.recRangoUnion as string)).toBe("Para 4 a 30 personas");
    expect(rangoParaLeer("4–30", T.en.recRangoAria as string, T.en.recRangoUnion as string)).toBe("For 4 to 30 people");
  });

  it("para todos los juegos del selector, en inglés no queda ninguna \"a\" entre los números", () => {
    for (const g of SELECTOR) {
      const rango = rangoVisible(g);
      if (!rango) continue;
      expect(rangoParaLeer(rango, T.en.recRangoAria as string, T.en.recRangoUnion as string), g).not.toMatch(/\d\s+a\s+\d/);
      expect(rangoParaLeer(rango, T.es.recRangoAria as string, T.es.recRangoUnion as string), g).toMatch(/^Para \d+ a \d+ personas$/);
    }
  });
});

describe("el juego que sigue después de un premio", () => {
  it("es otro de los que encajan, el siguiente en el orden, y vuelve al primero", () => {
    for (const n of [12, 20, 40]) {
      const buenos = recomendar(n).games.filter((x) => x.fits === true).map((x) => x.game);
      expect(buenos.length, String(n)).toBeGreaterThan(1);
      buenos.forEach((g, i) => expect(juegoSiguiente(n, g), `${n} ${g}`).toBe(buenos[(i + 1) % buenos.length]));
      expect(juegoSiguiente(n, "tombola")).toBe(buenos[0]);
    }
  });
  it("con un juego que no encaja o sin ninguno que encaje, deja el que estaba", () => {
    expect(juegoSiguiente(1, "pinata")).toBe("pinata");
  });
  it("siempre da lo mismo con la misma entrada", () => {
    expect(juegoSiguiente(20, "race")).toBe(juegoSiguiente(20, "race"));
  });
});

describe("la carrera y los premios: cada premio es un carril de la recta", () => {
  const carrera = (n: number, premios?: number): Recomendacion => recomendar(n, premios).games.find((r) => r.game === "race") as Recomendacion;

  it("los carriles de acá son los de la carrera (este módulo no puede importar su medida: viaja con la portada)", () => {
    expect(CARRILES_CARRERA).toBe(FINALISTAS);
  });

  it("con ocho premios o menos la carrera encaja como siempre; con nueve o más, no, y dice por qué", () => {
    for (const n of [12, 20, 60, 200]) {
      for (const premios of [undefined, 1, 4, 8]) expect(carrera(n, premios).fits, `${n} personas, ${premios} premios`).toBe(true);
      for (const premios of [9, 12, 32]) {
        const r = carrera(n, premios);
        expect(r.fits, `${n} personas, ${premios} premios`).toBe(false);
        expect(r.note).toBe("rec.race.premios");
        expect(r.args).toEqual([n, premios, 8]);
      }
    }
    // Y la nota dice los números, en español y en inglés.
    expect((T.es["rec.race.premios"] as (...a: number[]) => string)(20, 9, 8)).toContain("9 premios");
    expect((T.en["rec.race.premios"] as (...a: number[]) => string)(20, 9, 8)).toContain("9 prizes");
  });

  it("los premios no cambian a ningún otro juego, y la carrera queda entre los que no encajan", () => {
    for (const g of SELECTOR) {
      if (g === "race") continue;
      expect(recomendar(20, 9).games.find((r) => r.game === g)?.fits, g).toBe(recomendar(20).games.find((r) => r.game === g)?.fits);
    }
    const orden = recomendar(20, 9).games;
    expect(orden.indexOf(orden.find((r) => r.game === "race") as Recomendacion)).toBeGreaterThanOrEqual(orden.filter((r) => r.fits !== false).length);
  });

  it("con nueve premios o más no queda elegida la carrera, ni de siempre ni de siguiente", () => {
    for (const n of [8, 9, 12, 20, 30]) {
      expect(juegoPorDefecto(n, 9), `${n} personas`).not.toBe("race");
      for (const actual of SELECTOR) expect(juegoSiguiente(n, actual, 9), `${n} personas, después de ${actual}`).not.toBe("race");
    }
    // Con uno, como siempre.
    expect(juegoPorDefecto(20)).toBe("race");
    expect(juegoPorDefecto(20, 8)).toBe("race");
  });
});
