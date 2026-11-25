import { describe, expect, it } from "vitest";
import { type FilaDeGanadora, type PasoDelPuente, avisoQueFalta, avisosPendientes, lineaDelPaso } from "./puente";

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

describe("cuál de los dos avisos le falta a los celulares", () => {
  const una = { ...fila("esperando"), avisada: true };

  it("con la lista sellada y el sorteo sin hacer, falta el sello mientras no se haya avisado", () => {
    const pasos: PasoDelPuente[] = [
      { paso: "nada" },
      { paso: "leyendo" },
      { paso: "lista-sellada", soltable: false },
      { paso: "boton-avisar" },
      { paso: "avisando" },
      { paso: "no-avisamos" },
      { paso: "comprobando" },
      { paso: "no-comprobo" },
    ];
    for (const p of pasos) expect(avisoQueFalta(p, false), p.paso).toBe("sello");
  });

  it("con el sello ya avisado y el sorteo sin hacer, lo que falta es el resultado", () => {
    expect(avisoQueFalta({ paso: "avisada" }, false)).toBe("resultado");
    expect(avisoQueFalta({ paso: "sorteo-pendiente" }, false)).toBe("resultado");
  });

  it("con el sorteo hecho, falta el resultado, salvo con la sala borrada o todas avisadas", () => {
    expect(avisoQueFalta({ paso: "boton-resultado" }, true)).toBe("resultado");
    expect(avisoQueFalta({ paso: "resultado", filas: [fila("esperando"), una], otraBilletera: false }, true)).toBe("resultado");
    expect(avisoQueFalta({ paso: "resultado", filas: [una], otraBilletera: false }, true)).toBeNull();
    expect(avisoQueFalta({ paso: "sala-borrada" }, true)).toBeNull();
  });

  it("es la misma regla que decide si se pregunta", () => {
    const pasos: PasoDelPuente[] = [{ paso: "nada" }, { paso: "avisada" }, { paso: "sala-borrada" }, { paso: "resultado", filas: [una], otraBilletera: false }];
    for (const hecho of [false, true]) for (const p of pasos) expect(avisosPendientes(p, hecho), `${p.paso} ${hecho}`).toBe(avisoQueFalta(p, hecho) !== null);
  });
});
