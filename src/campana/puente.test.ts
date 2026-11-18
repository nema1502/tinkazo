import { describe, expect, it } from "vitest";
import { type FilaDeGanadora, lineaDelPaso } from "./puente";

/** La línea de apoyo bajo las ganadoras: la de los celulares, o la de avisarle a Tinkazo cuando alguien no puede recibir. */
const fila = (alta: FilaDeGanadora["alta"]): FilaDeGanadora => ({ cuenta: "GUNO", nombre: "Una", avisada: false, alta });
const linea = (filas: FilaDeGanadora[], otraBilletera = false) => lineaDelPaso({ paso: "resultado", filas, otraBilletera })?.clave;

describe("la línea del resultado de la campaña", () => {
  it("con todas en espera o que pueden recibir dice lo de los celulares", () => {
    expect(linea([fila("esperando"), fila({ estado: "puede" })])).toBe("cpoCelularesResultado");
  });

  it("con otra billetera dice que se avise a Tinkazo", () => {
    expect(linea([fila({ estado: "puede" })], true)).toBe("cpoAvisaleATinkazo");
  });

  it("con la cuenta de Google y un no final del servicio, también dice que se avise a Tinkazo", () => {
    expect(linea([fila({ estado: "puede" }), fila({ estado: "fallo", motivo: "no-es-nuestro", final: true })])).toBe("cpoAvisaleATinkazo");
  });

  it("un fallo que se puede reintentar no cambia la línea", () => {
    expect(linea([fila({ estado: "fallo", motivo: "red" })])).toBe("cpoCelularesResultado");
  });
});
