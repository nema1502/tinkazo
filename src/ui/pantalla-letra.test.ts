// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { letraDeLosNombres, letraQueEntra, PISO_UN_RENGLON } from "./pantalla";

/**
 * La letra de la pantalla grande en el orden de turnos del celular (`letraDeLosNombres`, `pantalla.ts`). jsdom no
 * calcula tamaños: la prueba mide con un modelo de la fila, cada letra de un ancho fijo y los renglones partidos por
 * los espacios como el navegador. Cómo se ve de verdad lo mira el ensayo con un navegador.
 */

vi.mock("../enlace-corto", () => ({ acortar: async () => null, enlaceParaElQr: async () => ({ ahora: "", despues: Promise.resolve(null) }) }));
vi.mock("./qr", () => ({ pintarQrDelComprobante: async () => false }));
vi.mock("./logo-sorteo", () => ({ piezaParaLaSala: () => null }));

/** Lo que ocupa a lo ancho un texto con esa letra: 0,55 de la letra por carácter. */
const ancho = (texto: string, letra: number): number => Array.from(texto).length * 0.55 * letra;

/** En cuántos renglones sale un nombre en una fila de `fila` px, partiendo por los espacios. */
function renglones(nombre: string, letra: number, fila: number): number {
  let n = 1;
  let linea = "";
  for (const palabra of nombre.split(" ")) {
    const con = linea ? `${linea} ${palabra}` : palabra;
    if (!linea || ancho(con, letra) <= fila) linea = con;
    else {
      n++;
      linea = palabra;
    }
  }
  return n;
}

/** Lo que mide `encajar` en una fila de 300 px: ninguna palabra se sale, y cada nombre de `exigidos` en un renglón. */
const medir =
  (nombres: string[], fila = 300) =>
  (letra: number, exigidos: readonly string[]): boolean =>
    nombres.every((n) => n.split(" ").every((p) => ancho(p, letra) <= fila)) &&
    exigidos.every((n) => renglones(n, letra, fila) === 1);

/** Si el nombre sale en un renglón con esa letra, en la misma fila. */
const enUno = (fila = 300) => (letra: number, nombre: string): boolean => renglones(nombre, letra, fila) === 1;

const TOPE = 52;
const PISO = 14;
const turnos = (nombres: string[]): number =>
  letraDeLosNombres({ tope: TOPE, piso: PISO, pisoUnRenglon: PISO_UN_RENGLON, nombres, cabe: medir(nombres), enUnRenglon: enUno() });

describe("la letra de la pantalla grande en el orden de turnos del celular", () => {
  const cortos = ["Ana Quispe", "Beto Mamani", "Carla Flores", "Diego Rojas", "Eva Choque", "Fede Vargas"];

  it("un nombre largo entre doce turnos no achica la lista: la letra queda en 22 px o más y ese nombre se parte", () => {
    const largo = "María Fernanda Rodríguez López";
    const lista = [...cortos, largo, ...cortos.slice(0, 5)];
    const letra = turnos(lista);
    expect(letra).toBeGreaterThanOrEqual(PISO_UN_RENGLON);
    // Ninguna palabra se sale de la fila; el nombre largo va en más de un renglón, partido por sus espacios.
    expect(medir(lista)(letra, [])).toBe(true);
    expect(renglones(largo, letra, 300)).toBeGreaterThan(1);
    // Solo el largo se parte: los demás, que entraban en un renglón, siguen en uno.
    expect(lista.filter((n) => n !== largo).every((n) => renglones(n, letra, 300) === 1)).toBe(true);
    // Con una sola pasada que exige un renglón la lista entera bajaba a unos 18 px.
    expect(letraQueEntra(TOPE, PISO, (l) => medir(lista)(l, lista))).toBeLessThan(PISO_UN_RENGLON);
    // Y sin exigirle un renglón a nadie la letra subía al tope y partía también los de dos palabras.
    const sinExigir = letraQueEntra(TOPE, PISO, (l) => medir(lista)(l, []));
    expect(lista.filter((n) => n !== largo).some((n) => renglones(n, sinExigir, 300) > 1)).toBe(true);
  });

  it("si con 22 px entran todos en un renglón, cada nombre queda en el suyo con la letra más grande que se pueda", () => {
    const lista = [...cortos, "Gabriela Montaño Suárez"];
    const letra = turnos(lista);
    expect(letra).toBeGreaterThanOrEqual(PISO_UN_RENGLON);
    expect(letra).toBeLessThan(TOPE);
    expect(lista.every((n) => renglones(n, letra, 300) === 1)).toBe(true);
    // Un punto más y alguno ya no entra en un renglón.
    expect(lista.every((n) => renglones(n, letra + 1, 300) === 1)).toBe(false);
  });

  it("con nombres cortos queda el tope", () => {
    expect(turnos(["Ana", "Beto", "Carla", "Diego", "Eva", "Fede"])).toBe(TOPE);
  });

  it("fuera del orden de turnos del celular, la búsqueda de siempre: no se exige un renglón", () => {
    const lista = [...cortos, "María Fernanda Rodríguez López"];
    const pedidos: number[] = [];
    const letra = letraDeLosNombres({
      tope: TOPE,
      piso: PISO,
      pisoUnRenglon: null,
      nombres: lista,
      cabe: (l, exigidos) => {
        pedidos.push(exigidos.length);
        return medir(lista)(l, exigidos);
      },
      enUnRenglon: enUno(),
    });
    expect(letra).toBe(TOPE);
    expect(pedidos.every((u) => u === 0)).toBe(true);
  });

  it("una palabra que no entra ni con el piso deja el piso, como siempre", () => {
    const lista = ["Wolfeschlegelsteinhausenbergerdorffvoralternwarengewissenhaft"];
    expect(turnos(lista)).toBe(PISO);
  });
});
