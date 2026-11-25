// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cuentaDePrueba, lineaDePrueba } from "../campana/cuentas-de-prueba";
import { ponerEtiquetas } from "../equipos/etiquetas";
import { setLang } from "../idioma";
import { depsDelResultadoReales } from "./campana-resultado-real";

/**
 * Cómo se llama a quien ganó en la fila del panel. Una cuenta se llama como siempre. Una línea de persona nunca sale tal cual:
 * si la pestaña conoce el nombre, el nombre, y si no, Ganadora y su puesto (Winner y su puesto en inglés).
 */

const L1 = lineaDePrueba(1);
const L2 = lineaDePrueba(2);

beforeEach(() => {
  sessionStorage.clear();
  setLang("es");
  ponerEtiquetas(new Map());
});
afterEach(() => {
  sessionStorage.clear();
  setLang("es");
  ponerEtiquetas(new Map());
});

describe("el nombre de quien ganó en el panel", () => {
  it("una línea de persona sin nombre es Ganadora y su puesto, contando desde 1", () => {
    const d = depsDelResultadoReales();
    expect(d.nombreDe(L1, 0)).toBe("Ganadora 1");
    expect(d.nombreDe(L2, 2)).toBe("Ganadora 3");
  });

  it("en inglés es Winner y su puesto", () => {
    setLang("en");
    expect(depsDelResultadoReales().nombreDe(L1, 1)).toBe("Winner 2");
  });

  it("una línea de persona con nombre se llama por su nombre", () => {
    ponerEtiquetas(new Map([[L1, "Ana"]]), "personas");
    const d = depsDelResultadoReales();
    expect(d.nombreDe(L1, 0)).toBe("Ana");
    expect(d.nombreDe(L2, 1)).toBe("Ganadora 2");
  });

  it("ningún nombre de una línea de persona la deja a la vista", () => {
    const d = depsDelResultadoReales();
    for (const [i, linea] of [L1, L2].entries()) expect(d.nombreDe(linea, i)).not.toContain("p1:");
  });

  it("una cuenta sin nombre sigue siendo sus cuatro primeras y sus cuatro últimas letras, sin importar el puesto", () => {
    const cuenta = cuentaDePrueba(1);
    const esperado = `${cuenta.slice(0, 4)}…${cuenta.slice(-4)}`;
    const d = depsDelResultadoReales();
    expect(d.nombreDe(cuenta, 0)).toBe(esperado);
    expect(d.nombreDe(cuenta, 5)).toBe(esperado);
  });

  it("una cuenta con nombre se llama por su nombre", () => {
    const cuenta = cuentaDePrueba(1);
    ponerEtiquetas(new Map([[cuenta, "Beto"]]), "personas");
    expect(depsDelResultadoReales().nombreDe(cuenta, 0)).toBe("Beto");
  });
});
