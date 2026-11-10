import { Keypair } from "@stellar/stellar-sdk";
import { beforeEach, describe, expect, it } from "vitest";
import { etiquetaConCuenta, etiquetaDe, paraMostrar, ponerEtiquetas } from "./etiquetas";
import { cuentaCorta } from "./modelo";

const cuenta = (): string => Keypair.random().publicKey();

/** Dos equipos con el mismo nombre y uno distinto: como en el issue #28. */
function tresEquipos(): { a: string; b: string; c: string } {
  const a = cuenta();
  const b = cuenta();
  const c = cuenta();
  ponerEtiquetas(
    new Map([
      [a, "Equipo 7"],
      [b, "Equipo 7"],
      [c, "Pumas"],
    ]),
  );
  return { a, b, c };
}

describe("equipos con el mismo nombre en el show y la pantalla grande", () => {
  beforeEach(() => ponerEtiquetas(new Map()));

  it("solo los nombres repetidos llevan la cuenta corta; los demás quedan igual", () => {
    const { a, b, c } = tresEquipos();
    expect(paraMostrar(["Ana", a, b, c])).toEqual(["Ana", `Equipo 7 (${cuentaCorta(a)})`, `Equipo 7 (${cuentaCorta(b)})`, "Pumas"]);
  });

  it("los dos repetidos se distinguen entre sí: cada uno lleva su propia cuenta", () => {
    const { a, b } = tresEquipos();
    const [primero, segundo] = paraMostrar([a, b]);
    expect(primero).not.toBe(segundo);
    expect(primero).toContain(cuentaCorta(a));
    expect(segundo).toContain(cuentaCorta(b));
  });

  it("con nombres únicos no se suma nada", () => {
    const { c } = tresEquipos();
    expect(paraMostrar([c])).toEqual(["Pumas"]);
    const solo = cuenta();
    ponerEtiquetas(new Map([[solo, "Las Wawas"]]));
    expect(paraMostrar([solo])).toEqual(["Las Wawas"]);
  });

  it("sin etiquetas, las líneas quedan tal cual", () => {
    const linea = cuenta();
    expect(paraMostrar(["Ana", linea])).toEqual(["Ana", linea]);
  });

  it("la etiqueta de una línea sigue siendo el nombre solo, y con cuenta como la tarjeta del resultado", () => {
    const { a } = tresEquipos();
    expect(etiquetaDe(a)).toBe("Equipo 7");
    expect(etiquetaDe("Ana")).toBe("Ana");
    expect(etiquetaConCuenta(a)).toBe(`Equipo 7 (${cuentaCorta(a)})`);
  });
});
