import { afterEach, describe, expect, it } from "vitest";
import { corto, planCarrera } from "./llamas/carrera-show";
import { ctxDe } from "./llamas/carrera-prueba";
import { formasDe, planNombres } from "./nombres";
import { esNombreEntero, ponerNombresEnteros } from "./nombres-enteros";

/**
 * Los nombres de equipo no se acortan: «¡Vamos, Las Wawas!», nunca «¡Vamos, Las W.!» (ensayo del stand, 6 de
 * noviembre de 2026). Sin equipos todo queda como siempre.
 */

const EQUIPOS = ["Las Wawas", "Los Cóndores", "Team Rocket Andino", "Byte Club", "Las Chicas del Código", "Pumas", "Los Tarijeños de la Luna", "Equipo 7"];

afterEach(() => ponerNombresEnteros([]));

describe("nombres enteros", () => {
  it("sin equipos, el nombre de dos palabras se sigue acortando como el de una persona", () => {
    expect(esNombreEntero("Las Wawas")).toBe(false);
    expect(corto("Las Wawas")).toBe("Las W.");
    expect(formasDe("María Quispe")).toEqual(["M", "María", "María Q.", "María Quispe"]);
  });

  it("el nombre de un equipo va entero en el relator y en las fichas, menos en la inicial", () => {
    ponerNombresEnteros(EQUIPOS);
    expect(corto("Las Wawas")).toBe("Las Wawas");
    expect(corto("Los Tarijeños de la Luna")).toBe("Los Tarijeños de la Luna");
    expect(formasDe("Las Wawas")).toEqual(["L", "Las Wawas", "Las Wawas", "Las Wawas"]);
    // Una persona que no es un equipo se acorta igual que siempre.
    expect(corto("María Quispe Mamani")).toBe("María M.");
  });

  it("el plan de nombres no les cambia el nivel 3 por distinguirlos", () => {
    ponerNombresEnteros(["Las Wawas", "Las Wawitas"]);
    const p = planNombres(["Las Wawas", "Las Wawitas"]);
    expect(p.formas[0]?.[2]).toBe("Las Wawas");
    expect(p.formas[1]?.[2]).toBe("Las Wawitas");
  });

  it("el show siguiente reemplaza a los del anterior", () => {
    ponerNombresEnteros(["Las Wawas"]);
    ponerNombresEnteros(["Los Cóndores"]);
    expect(esNombreEntero("Las Wawas")).toBe(false);
    expect(esNombreEntero("Los Cóndores")).toBe(true);
  });

  it("en la carrera con equipos ninguna línea del relator abrevia un nombre de equipo", () => {
    ponerNombresEnteros(EQUIPOS);
    let nombradas = 0;
    for (const n of [2, 3, 8]) {
      for (let s = 1; s <= 12; s++) {
        const ctx = { ...ctxDe(n, s), nombres: EQUIPOS.slice(0, n) };
        const plan = planCarrera(ctx);
        const textos = plan.guion.filter((l) => l.texto !== undefined).map((l) => (typeof l.texto === "function" ? l.texto() : (l.texto as string)));
        for (const t of textos) {
          // «Las W.», «Los C.»: una palabra de equipo seguida de una inicial con punto.
          for (const eq of EQUIPOS) {
            const primera = eq.split(" ")[0] as string;
            expect(t, `n=${n} s=${s}`).not.toMatch(new RegExp(`${primera} \\p{Lu}\\.`, "u"));
          }
        }
        nombradas += textos.filter((t) => EQUIPOS.some((eq) => t.includes(eq) && eq.includes(" "))).length;
      }
    }
    // Y el relator sí nombra equipos de varias palabras, enteros: si no, la prueba no probaría nada.
    expect(nombradas).toBeGreaterThan(0);
  });
});
