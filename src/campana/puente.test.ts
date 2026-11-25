import { describe, expect, it } from "vitest";
import { type FilaDeGanadora, type PasoDelPuente, avisosPendientes, lineaDelPaso } from "./puente";

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

describe("los avisos que el panel todavía le debe a los celulares", () => {
  const debe = (p: PasoDelPuente): boolean => avisosPendientes(p);

  it("mientras avisa, reintenta, no pudo avisar o espera el sorteo, los debe", () => {
    for (const paso of ["avisando", "no-avisamos", "comprobando", "no-comprobo", "aviso-roto", "boton-avisar", "boton-resultado", "mandando", "guardar-sorteo", "sorteo-pendiente"] as const) {
      expect(debe({ paso }), paso).toBe(true);
    }
  });

  it("con el resultado, los debe mientras quede alguien sin avisar", () => {
    expect(debe({ paso: "resultado", filas: [fila("esperando"), { ...fila("esperando"), avisada: true }], otraBilletera: false })).toBe(true);
    expect(debe({ paso: "resultado", filas: [{ ...fila("esperando"), avisada: true }], otraBilletera: false })).toBe(false);
  });

  it("sin nada en curso, con la lista ya avisada o con la sala borrada, no debe nada", () => {
    for (const p of [{ paso: "nada" }, { paso: "avisada" }, { paso: "sala-borrada" }, { paso: "otro-sorteo" }, { paso: "tomada" }] as const) {
      expect(debe(p), p.paso).toBe(false);
    }
  });
});
