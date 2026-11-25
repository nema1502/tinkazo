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
  const sellada = (p: PasoDelPuente): boolean => avisosPendientes(p, false);
  const sorteada = (p: PasoDelPuente): boolean => avisosPendientes(p, true);
  const TODOS: PasoDelPuente[] = [
    { paso: "nada" },
    { paso: "leyendo" },
    { paso: "no-leyo" },
    { paso: "lista-sellada", soltable: false },
    { paso: "avisando" },
    { paso: "no-avisamos" },
    { paso: "comprobando" },
    { paso: "avisada" },
    { paso: "sala-borrada" },
    { paso: "otro-sorteo" },
    { paso: "sorteo-pendiente" },
    { paso: "tomada" },
    { paso: "sello-por-confirmar" },
    { paso: "tarde" },
    { paso: "lista-cambio" },
    { paso: "otra-lista" },
    { paso: "ganadoras", n: 2 },
    { paso: "no-comprobo" },
    { paso: "aviso-roto" },
    { paso: "boton-avisar" },
    { paso: "mandando" },
    { paso: "boton-resultado" },
    { paso: "guardar-sorteo" },
  ];

  it("con la lista sellada y el sorteo sin hacer, los debe en cualquier paso", () => {
    for (const p of TODOS) expect(sellada(p), p.paso).toBe(true);
  });

  it("con el sorteo hecho, los debe en cualquier paso salvo con la sala ya borrada", () => {
    for (const p of TODOS) expect(sorteada(p), p.paso).toBe(p.paso !== "sala-borrada");
  });

  it("con el resultado, los debe mientras quede alguien sin avisar", () => {
    const una = { ...fila("esperando"), avisada: true };
    expect(sorteada({ paso: "resultado", filas: [fila("esperando"), una], otraBilletera: false })).toBe(true);
    expect(sorteada({ paso: "resultado", filas: [una], otraBilletera: false })).toBe(false);
    // Con la lista sellada el resultado todavía no salió: nada de lo que diga el paso lo da por mandado.
    expect(sellada({ paso: "resultado", filas: [una], otraBilletera: false })).toBe(true);
  });
});
