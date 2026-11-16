import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { roundTime } from "../protocol/quicknet";
import { AVISO_TARDE_MS, LARGA_IGUAL_TRAS_MS, MARGEN_DE_LA_CADENA_S, horaDeBuscarElNumero, reglaDelShow } from "./espectador-regla";

/**
 * La regla de cuándo arranca el show del espectador (`espectador-regla.ts`) tiene que ser la de la sala. Esta prueba
 * lee el código de la sala: si la sala cambia cuándo arranca, falla acá, y la regla se cambia en ese mismo cambio.
 */

const freeze = readFileSync(new URL("./freeze.ts", import.meta.url), "utf8");
const draw = readFileSync(new URL("./draw.ts", import.meta.url), "utf8");

describe("cuándo arranca el show del espectador", () => {
  it("con el sorteo sellado espera el margen de la sala, el mismo número que freeze.ts", () => {
    expect(freeze).toContain(`const CHAIN_MARGIN_SECONDS = ${MARGEN_DE_LA_CADENA_S};`);
    // La sala solo suma el margen con el sorteo sellado.
    expect(freeze).toContain("const margin = app.frozen.raffleId !== undefined ? CHAIN_MARGIN_SECONDS : 0;");
    expect(reglaDelShow(true).margenS).toBe(MARGEN_DE_LA_CADENA_S);
    expect(horaDeBuscarElNumero(1000, true)).toBe(roundTime(1000) + MARGEN_DE_LA_CADENA_S);
  });

  it("con el sorteo sellado, el juego espera lo grabado, porque la sala también lo espera", () => {
    // En la sala, la tarjeta del juego sale con la espera de lo grabado y el juego arranca después de `grabado()`.
    expect(draw).toContain("const card = abrirTarjeta(juego, names.length, nWinners, espera);");
    expect(draw).toMatch(/grabado\(\);[\s\S]*?playGame\(names, winners, beacon, finish, tarjeta\);/);
    expect(reglaDelShow(true).esperaLoGrabado).toBe(true);
  });

  it("sin sello no hay margen ni nada que esperar: la sala juega apenas trae el número", () => {
    expect(reglaDelShow(false)).toMatchObject({ margenS: 0, esperaLoGrabado: false });
    expect(horaDeBuscarElNumero(1000, false)).toBe(roundTime(1000));
  });

  it("si lo grabado no aparece, juega igual a los dos minutos y avisa antes que la sala no lo lanzó", () => {
    expect(reglaDelShow(true).largaIgualTrasMs).toBe(LARGA_IGUAL_TRAS_MS);
    expect(LARGA_IGUAL_TRAS_MS).toBe(120_000);
    expect(AVISO_TARDE_MS).toBeLessThan(LARGA_IGUAL_TRAS_MS);
  });
});
