// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { T } from "../i18n";
import { ponerEtiquetas } from "../equipos/etiquetas";

/**
 * Los textos que hablan de la lista dicen «persona(s)» con una lista común y «equipo(s)» cuando la lista viene de los
 * equipos con cupón (issue #25). Una sola fuente por frase: la palabra la elige el texto según `hayEtiquetas()`.
 */

const ENLACE = "https://tinkazo.app/c/abc";

const etiquetas = (): Map<string, string> =>
  new Map([
    ["GAAA1111111111111111111111111111111111111111111111111111111111", "Los Cóndores"],
    ["GBBB2222222222222222222222222222222222222222222222222222222222", "Las Vicuñas"],
  ]);

beforeEach_done();

function beforeEach_done(): void {
  afterEach(() => {
    // Las etiquetas son estado global del módulo: sin esto, una prueba contamina a la siguiente.
    ponerEtiquetas(new Map());
  });
}

describe("los textos de la lista con una lista común (sin equipos)", () => {
  it("againLeft cuenta personas, en los dos idiomas", () => {
    expect(T.es.againLeft(1)).toBe("Queda 1 persona sin premio.");
    expect(T.es.againLeft(3)).toBe("Quedan 3 personas sin premio.");
    expect(T.en.againLeft(1)).toBe("1 person is left without a prize.");
    expect(T.en.againLeft(3)).toBe("3 people are left without a prize.");
  });

  it("againFew habla de una sola persona, en los dos idiomas", () => {
    expect(T.es.againFew(1)).toBe("Queda una sola persona sin premio: para otro sorteo, usá otra lista.");
    expect(T.en.againFew(1)).toBe("Only one person is left without a prize: for another draw, use another list.");
  });

  it("el mensaje para quien salió dice entre cuántas personas, en los dos idiomas", () => {
    expect(T.es.tellBody("Ana", "", 12, ENLACE, false)).toContain("entre 12 personas");
    expect(T.en.tellBody("Ana", "", 12, ENLACE, false)).toContain("out of 12 people");
  });

  it("el resumen del sello cuenta personas, en los dos idiomas", () => {
    expect(T.es.sellarResumen(18, 1, "Termo")).toContain("18 personas, 1 ganador");
    expect(T.en.sellarResumen(18, 1, "Termo")).toContain("18 people, 1 winner");
  });

  it("la barra dice lista de personas, en los dos idiomas", () => {
    expect(T.es.sigLista).toBe("lista de {n} personas");
    expect(T.en.sigLista).toBe("list of {n} people");
  });

  it("el aviso de que ya entraste habla de la lista de personas, en los dos idiomas", () => {
    expect(T.es.yaEntraste).toBe("Ya entraste. Sellá tu lista de {n} personas.");
    expect(T.en.yaEntraste).toBe("You're in. Seal your list of {n} people.");
  });

  it("el motivo para entrar habla de la lista de personas, en los dos idiomas", () => {
    expect(T.es.loginParaSellar).toContain("Para sellar tu lista de {n} personas");
    expect(T.en.loginParaSellar).toContain("To seal your list of {n} people");
  });
});

describe("los textos de la lista con equipos (etiquetas cargadas)", () => {
  it("againLeft cuenta equipos, en los dos idiomas", () => {
    ponerEtiquetas(etiquetas());
    expect(T.es.againLeft(1)).toBe("Queda 1 equipo sin premio.");
    expect(T.es.againLeft(3)).toBe("Quedan 3 equipos sin premio.");
    expect(T.en.againLeft(1)).toBe("1 team is left without a prize.");
    expect(T.en.againLeft(3)).toBe("3 teams are left without a prize.");
  });

  it("againFew habla de un solo equipo, en los dos idiomas", () => {
    ponerEtiquetas(etiquetas());
    expect(T.es.againFew(1)).toBe("Queda un solo equipo sin premio: para otro sorteo, usá otra lista.");
    expect(T.en.againFew(1)).toBe("Only one team is left without a prize: for another draw, use another list.");
  });

  it("el mensaje para quien salió dice entre cuántos equipos, en los dos idiomas", () => {
    ponerEtiquetas(etiquetas());
    expect(T.es.tellBody("Los Cóndores", "", 12, ENLACE, false)).toContain("entre 12 equipos");
    expect(T.es.tellBody("Los Cóndores", "", 12, ENLACE, false)).not.toContain("personas");
    expect(T.en.tellBody("Los Cóndores", "", 12, ENLACE, false)).toContain("out of 12 teams");
    expect(T.en.tellBody("Los Cóndores", "", 12, ENLACE, false)).not.toContain("people");
  });

  it("el resumen del sello cuenta equipos, en los dos idiomas", () => {
    ponerEtiquetas(etiquetas());
    expect(T.es.sellarResumen(18, 1, "Termo")).toContain("18 equipos, 1 ganador");
    expect(T.es.sellarResumen(18, 1, "Termo")).not.toContain("personas");
    expect(T.en.sellarResumen(18, 1, "Termo")).toContain("18 teams, 1 winner");
    expect(T.en.sellarResumen(18, 1, "Termo")).not.toContain("people");
  });

  it("la barra dice lista de equipos, en los dos idiomas", () => {
    ponerEtiquetas(etiquetas());
    expect(T.es.sigLista).toBe("lista de {n} equipos");
    expect(T.en.sigLista).toBe("list of {n} teams");
  });

  it("el aviso de que ya entraste habla de la lista de equipos, en los dos idiomas", () => {
    ponerEtiquetas(etiquetas());
    expect(T.es.yaEntraste).toBe("Ya entraste. Sellá tu lista de {n} equipos.");
    expect(T.en.yaEntraste).toBe("You're in. Seal your list of {n} teams.");
  });

  it("el motivo para entrar habla de la lista de equipos, en los dos idiomas", () => {
    ponerEtiquetas(etiquetas());
    expect(T.es.loginParaSellar).toContain("Para sellar tu lista de {n} equipos");
    expect(T.es.loginParaSellar).not.toContain("personas");
    expect(T.en.loginParaSellar).toContain("To seal your list of {n} teams");
    expect(T.en.loginParaSellar).not.toContain("people");
  });
});
