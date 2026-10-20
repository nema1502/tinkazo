import { describe, expect, it } from "vitest";
import { T } from "../i18n";
import { claveDelPaso, lineaDelPaso, pasoDe, relojDe } from "./pasos";

describe("en qué paso está el sorteo", () => {
  it("sin dos nombres todavía es la lista", () => {
    expect(pasoDe({ nombres: 0, sellada: false, revelado: false })).toBe(1);
    expect(pasoDe({ nombres: 1, sellada: false, revelado: false })).toBe(1);
  });

  it("con la lista lista, lo que toca es sellar", () => {
    expect(pasoDe({ nombres: 2, sellada: false, revelado: false })).toBe(2);
    expect(pasoDe({ nombres: 200, sellada: false, revelado: false })).toBe(2);
  });

  it("sellada, lo que toca es sortear, y sigue siéndolo mientras corre el juego", () => {
    expect(pasoDe({ nombres: 18, sellada: true, revelado: false })).toBe(3);
  });

  it("el paso 4 empieza cuando el resultado se ve", () => {
    expect(pasoDe({ nombres: 18, sellada: true, revelado: true })).toBe(4);
  });

  it("el siguiente premio vuelve al sellado: la lista nueva ya no está sellada", () => {
    expect(pasoDe({ nombres: 16, sellada: false, revelado: false })).toBe(2);
  });
});

describe("de qué se trata cada paso", () => {
  const ok = { segundos: 0, apagado: false, ganadores: 1 };

  it("cada paso tiene su texto, y el de la cuenta no cambia con el reloj", () => {
    expect(claveDelPaso(1, ok)).toBe("");
    expect(claveDelPaso(2, ok)).toBe("sigLista");
    expect(claveDelPaso(2, { ...ok, apagado: true })).toBe("sigSellando");
    expect(claveDelPaso(3, { ...ok, segundos: 25, apagado: true })).toBe("sigEspera");
    expect(claveDelPaso(3, { ...ok, segundos: 24, apagado: true })).toBe("sigEspera");
    expect(claveDelPaso(3, ok)).toBe("sigRonda");
    expect(claveDelPaso(3, { ...ok, apagado: true })).toBe("sigSorteando");
    expect(claveDelPaso(4, ok)).toBe("sigGano");
    expect(claveDelPaso(4, { ...ok, ganadores: 2 })).toBe("sigGanaron");
  });

  it("todos esos textos existen en los dos idiomas", () => {
    const claves = ["sigLista", "sigSellando", "sigEspera", "sigRonda", "sigSorteando", "sigGano", "sigGanaron", "sigAvisoRonda"];
    const faltan = (["es", "en"] as const).flatMap((l) => claves.filter((k) => typeof T[l][k] !== "string" || !(T[l][k] as string).trim()).map((k) => `${l}.${k}`));
    expect(faltan).toEqual([]);
  });
});

describe("la línea de la barra", () => {
  it("el reloj sale con minutos y segundos de dos cifras", () => {
    expect(relojDe(0)).toBe("0:00");
    expect(relojDe(25)).toBe("0:25");
    expect(relojDe(65)).toBe("1:05");
    expect(relojDe(600)).toBe("10:00");
  });

  it("nombra el paso, de qué se trata y, si corre, la cuenta", () => {
    expect(lineaDelPaso("Paso 3 de 4", "Esperando la ronda", "0:25")).toBe("Paso 3 de 4 · Esperando la ronda · 0:25");
    expect(lineaDelPaso("Paso 4 de 4", "Ya salió el ganador")).toBe("Paso 4 de 4 · Ya salió el ganador");
  });

  it("los textos del indicador y de la barra existen en los dos idiomas, con su número", () => {
    for (const l of ["es", "en"] as const) {
      for (const k of ["paso1", "paso2", "paso3", "paso4", "pasosAria", "pasoHecho", "pasoActual", "sigRegion"]) {
        expect(typeof T[l][k], `${l}.${k}`).toBe("string");
      }
      expect(T[l].sigPaso, l).toContain("{n}");
      expect(T[l].sigLista, l).toContain("{n}");
    }
  });
});
