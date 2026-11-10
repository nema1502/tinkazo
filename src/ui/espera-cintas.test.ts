// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { ponerEtiquetas } from "../equipos/etiquetas";
import { cintas } from "./espera";

/**
 * La cinta de nombres de la espera, con equipos con cupón. La lista sellada son las cuentas de los equipos; en la
 * pantalla grande, mientras se espera el número, la sala tiene que leer el nombre de su equipo, como en el show.
 */

const A = "GDYJKYC2B6NPRPQ2U7SDJTAUM6AKUEIXT4W7OTSELD3RU2PU2N2DPPBC";
const B = "GADSU2KBFHZIXKLDWXO2U63BZWVXHAFSTRSRM2E5IOIJ72YVLTZINIGZ";

afterEach(() => ponerEtiquetas(new Map()));

describe("la cinta de la espera", () => {
  it("con equipos, muestra el nombre de cada equipo y no su cuenta", () => {
    ponerEtiquetas(new Map([[A, "Los Cóndores"], [B, "Las Wawas"]]));
    const html = cintas([A, B]);
    expect(html).toContain("Los Cóndores");
    expect(html).toContain("Las Wawas");
    expect(html).not.toContain(A);
    expect(html).not.toContain(B);
  });

  it("sin equipos, los nombres van tal cual", () => {
    const html = cintas(["Ana", "Beto"]);
    expect(html).toContain("Ana");
    expect(html).toContain("Beto");
  });

  it("una línea que no es de ningún equipo queda como está", () => {
    ponerEtiquetas(new Map([[A, "Los Cóndores"]]));
    const html = cintas([A, "Carla"]);
    expect(html).toContain("Los Cóndores");
    expect(html).toContain("Carla");
  });
});
