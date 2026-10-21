import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SELECTOR, recomendar, type Recomendacion } from "./recomendar";
import { T } from "../i18n";
import type { Game } from "../state";

describe("los textos de la recomendación, en es y en en", () => {
  it("cada nota que puede salir tiene su frase en los dos idiomas", () => {
    const claves = new Set<string>(["recBadge", "recHead"]);
    for (let n = 1; n <= 210; n++) for (const r of recomendar(n).games) if (r.note) claves.add(r.note);
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
    const botones = [...fuente.matchAll(/\["g-[a-z]+", "([a-z]+)"\]/g)].map((m) => m[1]);
    expect(botones).toEqual([...SELECTOR]);
  });

  it("la tómbola sale del selector: sigue existiendo, pero sin botón", () => {
    expect(SELECTOR).not.toContain("tombola");
  });

  it("son los diez que decidió el autor el 21 de octubre de 2026, de las salas chicas a las grandes", () => {
    expect([...SELECTOR]).toEqual(["race", "sapo", "trompo", "chovena", "pinata", "wheel", "quien", "trueque", "teleferico", "oruro"]);
  });

  it("el Aguayo y la Constelación salen del selector: El Trueque los reemplaza", () => {
    expect(SELECTOR).not.toContain("pasanaku");
    expect(SELECTOR).not.toContain("stellar");
    expect(SELECTOR).toContain("trueque");
  });

  it("los botones g-* de index.html son los mismos, en el mismo orden", () => {
    const html = readFileSync(new URL("../../index.html", import.meta.url), "utf8");
    const selector = html.slice(html.indexOf('id="gamepick"'), html.indexOf("</div>", html.indexOf('id="gamepick"')));
    const botones = [...selector.matchAll(/<button id="g-([a-z]+)"/g)].map((m) => m[1]);
    expect(botones).toEqual([...SELECTOR]);
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

  it("con 1 persona no encaja nadie que tenga rango", () => {
    expect(grupos(1)).toEqual({
      encajan: [],
      neutral: ["pinata", "wheel", "quien", "trueque", "oruro"],
      no: ["race", "sapo", "trompo", "chovena", "teleferico"],
    });
  });

  it("con 2, la mesa y la carrera y el trompo encajan (ninguno ideal); chovena y teleférico no llegan", () => {
    expect(grupos(2)).toEqual({
      encajan: ["sapo", "race", "trompo"],
      neutral: ["pinata", "wheel", "quien", "trueque", "oruro"],
      no: ["chovena", "teleferico"],
    });
  });

  it("con 8, el ideal de la carrera, el sapo y el trompo va primero, y chovena encaja justo en el mínimo", () => {
    expect(grupos(8)).toEqual({
      encajan: ["sapo", "race", "trompo", "chovena"],
      neutral: ["pinata", "wheel", "quien", "trueque", "oruro"],
      no: ["teleferico"],
    });
  });

  it("con 12, chovena, el sapo y el trompo están en su ideal; la carrera ya es muy chica", () => {
    expect(grupos(12)).toEqual({
      encajan: ["chovena", "sapo", "trompo"],
      neutral: ["pinata", "wheel", "quien", "trueque", "oruro"],
      no: ["race", "teleferico"],
    });
  });

  it("con 16, teleférico entra por su mínimo, y el sapo por la clasificatoria", () => {
    expect(grupos(16)).toEqual({
      encajan: ["chovena", "sapo", "teleferico"],
      neutral: ["pinata", "wheel", "quien", "trueque", "oruro"],
      no: ["race", "trompo"],
    });
  });

  it("con 30, chovena y teleférico están en su ideal; la ruleta sigue, neutral, hasta 200", () => {
    expect(grupos(30)).toEqual({
      encajan: ["chovena", "teleferico", "sapo"],
      neutral: ["pinata", "wheel", "quien", "trueque", "oruro"],
      no: ["race", "trompo"],
    });
  });

  it("con 50, solo chovena y teleférico; el sapo pasa de su clasificatoria", () => {
    expect(grupos(50)).toEqual({
      encajan: ["chovena", "teleferico"],
      neutral: ["pinata", "wheel", "quien", "trueque", "oruro"],
      no: ["race", "sapo", "trompo"],
    });
  });

  it("con 100, solo teleférico; chovena ya pasa de sus 80", () => {
    expect(grupos(100)).toEqual({
      encajan: ["teleferico"],
      neutral: ["pinata", "wheel", "quien", "trueque", "oruro"],
      no: ["race", "sapo", "trompo", "chovena"],
    });
  });

  it("con 200, teleférico llega justo a su máximo, y la ruleta también", () => {
    expect(grupos(200)).toEqual({
      encajan: ["teleferico"],
      neutral: ["pinata", "wheel", "quien", "trueque", "oruro"],
      no: ["race", "sapo", "trompo", "chovena"],
    });
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
    expect(nota("race", 9)).toBe("rec.race.largo");
    expect(nota("race", 1)).toBe("rec.race.corto");
    expect(nota("sapo", 20)).toBe("rec.sapo.alto");
    expect(nota("chovena", 70)).toBe("rec.chovena.alto");
    expect(nota("teleferico", 170)).toBe("rec.teleferico.alto");
  });

  it("los números de la nota son la cantidad, el mínimo y el máximo", () => {
    const r = recomendar(50).games.find((x) => x.game === "sapo");
    expect(r?.args).toEqual([50, 2, 40]);
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
