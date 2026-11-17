import { describe, expect, it } from "vitest";
import { T } from "../i18n";
import { JUEGOS_DE_TURNOS, JUEGO_DE_SIEMPRE, RANGOS, SELECTOR, juegoPorDefecto, recomendar } from "./recomendar";

/**
 * El juego por defecto de un orden de turnos: la ruleta, cuando la lista entra en la ruleta. Con más personas que su tope
 * (200), el que ya elige el código de siempre. Los carteles de cada juego no se tocan: eso se mira con un navegador.
 */

describe("juegoPorDefecto con un orden de turnos", () => {
  it("la ruleta, con 2, 12, 50 y hasta 200 personas", () => {
    for (const n of [2, 8, 12, 30, 50, 100, 200]) expect(juegoPorDefecto(n, n, true), `con ${n}`).toBe("wheel");
  });

  it("el tope de la ruleta es el de la tabla de rangos (200): con 201 y 300 queda el que ya elige el código", () => {
    expect(RANGOS.wheel?.maximo).toBe(200);
    for (const n of [201, 250, 300]) {
      const sinModo = juegoPorDefecto(n, n);
      expect(sinModo, `con ${n}`).not.toBe("wheel");
      expect(juegoPorDefecto(n, n, true), `con ${n}`).toBe(sinModo);
    }
  });

  it("sin el modo, nada cambia: ni con muchos premios ni sin pasar el tercer argumento", () => {
    for (const n of [2, 4, 8, 12, 20, 31, 50, 120, 200, 300]) {
      for (const premios of [1, 2, 3, n]) {
        expect(juegoPorDefecto(n, premios, false), `${n} personas, ${premios} premios`).toBe(juegoPorDefecto(n, premios));
      }
    }
    // La carrera sigue siendo el juego de siempre para listas chicas, y la ruleta no se cuela sola.
    expect(juegoPorDefecto(6)).toBe(JUEGO_DE_SIEMPRE);
    expect(juegoPorDefecto(12, 12)).not.toBe("wheel");
    expect(juegoPorDefecto(50, 50)).not.toBe("wheel");
  });

  it("con menos de dos personas no hay orden: no fuerza la ruleta", () => {
    expect(juegoPorDefecto(1, 1, true)).toBe(juegoPorDefecto(1, 1));
    expect(juegoPorDefecto(0, 1, true)).toBe(juegoPorDefecto(0, 1));
  });
});

/**
 * En un orden de turnos solo se ofrecen los juegos que lo cuentan bien: la ruleta, la chovena, el Guajojó y la carrera. Los
 * otros hablan de premios en medio del show (la piñata, el teleférico, el trompo, el Toborochi, La Entrada) o no cuentan
 * el orden, y se ven apagados con su motivo. Si ninguno de los que sirven puede con la lista (más de doscientos turnos),
 * no se apaga nada: sortear tiene que seguir siendo posible.
 */
describe("los juegos de un orden de turnos", () => {
  const de = (n: number, turnos = true) => recomendar(n, n, turnos).games;
  const juego = (n: number, g: string) => de(n).find((r) => r.game === g);

  it("son la ruleta, la chovena, el Guajojó y la carrera", () => {
    expect([...JUEGOS_DE_TURNOS].sort()).toEqual(["chovena", "guajojo", "race", "wheel"]);
    for (const g of JUEGOS_DE_TURNOS) expect(SELECTOR, g).toContain(g);
  });

  it("con 18 turnos se apagan los que hablan de premios, y no la ruleta, la chovena ni el Guajojó", () => {
    for (const g of ["pinata", "teleferico", "trompo", "toborochi", "oruro", "sapo"]) {
      const r = juego(18, g);
      expect(r?.apagado, g).toBe(true);
      expect(r?.fits, g).toBe(false);
      expect(r?.note, g).toMatch(/^rec\.(sinTurnos|[a-z]+\.turnos)$/);
    }
    for (const g of ["wheel", "chovena", "guajojo"]) {
      expect(juego(18, g)?.apagado, g).toBeFalsy();
      expect(juego(18, g)?.fits, g).not.toBe(false);
    }
  });

  it("la carrera con más turnos que carriles (8) también se apaga, con su propia nota; con 8 o menos sigue", () => {
    expect(juego(18, "race")?.apagado).toBe(true);
    expect(juego(18, "race")?.note).toBe("rec.race.turnos");
    expect(juego(8, "race")?.apagado).toBeFalsy();
    expect(juego(5, "race")?.apagado).toBeFalsy();
    expect(juego(5, "race")?.fits).toBe(true);
  });

  it("el sapo conserva su nota de agujeros cuando no entra, y los demás dicen que hablan de premios", () => {
    expect(juego(18, "sapo")?.note).toBe("rec.sapo.turnos");
    expect(juego(10, "sapo")?.note).toBe("rec.sinTurnos");
    expect(juego(40, "pinata")?.note).toBe("rec.sinTurnos");
    expect(juego(40, "trompo")?.apagado).toBe(true);
  });

  it("lo apagado va al final de la lista, y lo que se ofrece antes", () => {
    const orden = de(18).map((r) => r.apagado === true);
    expect(orden).toEqual([...orden].sort((a, b) => Number(a) - Number(b)));
    expect(orden.filter(Boolean).length).toBeGreaterThanOrEqual(6);
  });

  it("de 2 a 200 siempre queda la ruleta ofrecida: nunca se apaga todo", () => {
    for (const n of [2, 3, 8, 9, 30, 81, 150, 200]) {
      expect(juego(n, "wheel")?.apagado, `${n}`).toBeFalsy();
      expect(de(n).some((r) => !r.apagado), `${n}`).toBe(true);
    }
  });

  it("con más de 200 turnos ninguno de los cuatro puede con la lista: no se apaga nada y queda como siempre", () => {
    for (const n of [201, 250, 300]) {
      expect(de(n).some((r) => r.apagado), `${n}`).toBe(false);
      const fits = (rs: ReturnType<typeof de>): Array<[string, boolean | null]> => rs.map((r) => [r.game, r.fits]).sort() as Array<[string, boolean | null]>;
      expect(fits(de(n)), `${n}`).toEqual(fits(recomendar(n, n).games));
    }
  });

  it("sin el modo, nada se apaga ni cambia: ni con muchos premios", () => {
    for (const n of [2, 8, 18, 60, 200]) {
      for (const premios of [1, 3, n]) {
        expect(recomendar(n, premios).games.some((r) => r.apagado), `${n} personas, ${premios} premios`).toBe(false);
        expect(recomendar(n, premios, false).games).toEqual(recomendar(n, premios).games);
      }
    }
  });

  it("los motivos se leen en los dos idiomas, sin hablar de premios ganados ni de apuestas, y sin comillas angulares ni punto y coma", () => {
    for (const l of ["es", "en"] as const) {
      const v = T[l]["rec.sinTurnos"];
      expect(typeof v, l).toBe("string");
      expect(String(v).length, l).toBeGreaterThan(10);
      expect(String(v), l).not.toMatch(/[;\u00ab\u00bb]|rifa|loter[ií]a|raffle|ticket|boleto|apuesta|\bbet\b/i);
    }
    expect(T.es["rec.sinTurnos"]).toBe("Este juego es para premios.");
    expect(T.en["rec.sinTurnos"]).toBe("This game is for prizes.");
  });
});
