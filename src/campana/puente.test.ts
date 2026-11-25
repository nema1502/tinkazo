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
  const TODOS: PasoDelPuente[] = [
    { paso: "nada" },
    { paso: "leyendo" },
    { paso: "en-el-sorteo", n: 3 },
    { paso: "no-leyo" },
    { paso: "pocos", n: 1 },
    { paso: "otra-cuenta", fin: "ABCD" },
    { paso: "lista-sellada", soltable: false },
    { paso: "otra-red", modo: "testnet" },
    { paso: "version-distinta" },
    { paso: "sin-conexion" },
    { paso: "avisando" },
    { paso: "no-avisamos" },
    { paso: "comprobando" },
    { paso: "avisada" },
    { paso: "sala-borrada" },
    { paso: "otro-sorteo" },
    { paso: "sorteo-pendiente" },
    { paso: "tomada" },
    { paso: "entrar-para-seguir" },
    { paso: "no-comprobo" },
    { paso: "aviso-roto" },
    { paso: "sello-por-confirmar" },
    { paso: "tarde" },
    { paso: "lista-cambio" },
    { paso: "otra-lista" },
    { paso: "ganadoras", n: 2 },
    { paso: "boton-avisar" },
    { paso: "mandando" },
    { paso: "boton-resultado" },
    { paso: "guardar-sorteo" },
    { paso: "resultado", filas: [fila("esperando")], otraBilletera: false },
    { paso: "resultado", filas: [una], otraBilletera: false },
  ];
  const conSala = TODOS.filter((p) => p.paso !== "sala-borrada");

  it("con la lista cerrada, todavía sin sellar, falta el aviso del sello en cualquier paso", () => {
    for (const p of conSala) expect(avisoQueFalta(p, "cerrada"), p.paso).toBe("sello");
  });

  it("con la lista sellada y el sorteo sin hacer, el sello ya llegó: falta el resultado en cualquier paso", () => {
    for (const p of conSala) expect(avisoQueFalta(p, "sellada"), p.paso).toBe("resultado");
    // Los pasos que antes decían que faltaba el sello por no ser del resultado.
    for (const paso of ["nada", "otro-sorteo", "sin-conexion", "otra-red", "leyendo", "tarde", "lista-cambio", "otra-lista"] as const) {
      const p = TODOS.find((x) => x.paso === paso) as PasoDelPuente;
      expect(avisoQueFalta(p, "sellada"), paso).toBe("resultado");
    }
  });

  it("con el sorteo hecho, falta el resultado, salvo con todas avisadas o con la sala ya borrada", () => {
    expect(avisoQueFalta({ paso: "boton-resultado" }, "sorteada")).toBe("resultado");
    expect(avisoQueFalta({ paso: "nada" }, "sorteada")).toBe("resultado");
    expect(avisoQueFalta({ paso: "resultado", filas: [fila("esperando"), una], otraBilletera: false }, "sorteada")).toBe("resultado");
    expect(avisoQueFalta({ paso: "resultado", filas: [una], otraBilletera: false }, "sorteada")).toBeNull();
    expect(avisoQueFalta({ paso: "sala-borrada" }, "sorteada")).toBeNull();
  });

  it("con la sala borrada y el sorteo sin hacer no hay qué decirles, pero la pregunta se mantiene", () => {
    expect(avisoQueFalta({ paso: "sala-borrada" }, "cerrada")).toBe("sin-sala");
    expect(avisoQueFalta({ paso: "sala-borrada" }, "sellada")).toBe("sin-sala");
    expect(avisosPendientes({ paso: "sala-borrada" }, false)).toBe(true);
  });

  it("la pregunta sale de esta misma regla y es la que había antes en todos los pasos", () => {
    // La regla de antes de separar los dos avisos: con el sorteo sin hacer siempre se preguntaba.
    const antes = (p: PasoDelPuente, hecho: boolean): boolean => (!hecho ? true : p.paso === "sala-borrada" ? false : p.paso === "resultado" ? p.filas.some((f) => !f.avisada) : true);
    for (const p of TODOS) {
      for (const hecho of [false, true]) {
        expect(avisosPendientes(p, hecho), `${p.paso} ${hecho}`).toBe(antes(p, hecho));
        expect(avisosPendientes(p, hecho), `${p.paso} ${hecho}`).toBe(avisoQueFalta(p, hecho ? "sorteada" : "sellada") !== null);
      }
      expect(avisoQueFalta(p, "cerrada") !== null, p.paso).toBe(true);
    }
  });
});
