import { describe, expect, it } from "vitest";
import { type FilaDeGanadora, type PasoDelPuente, avisosPendientes, botonDelPaso, lineaDelPaso } from "./puente";
import { TEXTOS_SALA_CAMPANA } from "./textos-sala";

/**
 * El resultado de una campaña con el premio en mano: se entrega en persona, así que la línea es una sola y verdadera en todos
 * los estados, y nunca habla de recibir, de pagar ni de avisarle a Tinkazo. Una campaña de cuentas dice lo de siempre.
 */

const fila = (cuenta: string, cambios: Partial<FilaDeGanadora> = {}): FilaDeGanadora => ({
  cuenta,
  nombre: "Ganadora",
  avisada: false,
  alta: "esperando",
  ...cambios,
});

const enMano = (filas: FilaDeGanadora[], otraBilletera = false): PasoDelPuente => ({ paso: "resultado", filas, otraBilletera, enMano: true });

describe("la línea del resultado en mano", () => {
  it("sin códigos todavía dice que se entrega en mano", () => {
    expect(lineaDelPaso(enMano([fila("A"), fila("B")]))).toEqual({ clave: "cpoEntregaEnMano", vars: {} });
  });

  it("con todos los códigos dice que se entrega a quien muestre el suyo", () => {
    const paso = enMano([fila("A", { codigo: "0042" }), fila("B", { codigo: "7310" })]);
    expect(lineaDelPaso(paso)).toEqual({ clave: "cpoEntregaConCodigo", vars: {} });
  });

  it("con un código que falta, la línea sigue siendo la de en mano: no promete lo que no tiene", () => {
    const paso = enMano([fila("A", { codigo: "0042" }), fila("B")]);
    expect(lineaDelPaso(paso)).toEqual({ clave: "cpoEntregaEnMano", vars: {} });
  });

  it("sin filas no hay códigos que mostrar y dice lo de en mano", () => {
    expect(lineaDelPaso(enMano([]))).toEqual({ clave: "cpoEntregaEnMano", vars: {} });
  });

  it("nunca dice avisarle a Tinkazo, ni con otra billetera ni con un alta que falló", () => {
    const fallida = fila("A", { alta: { estado: "fallo", motivo: "sin-acceso", final: true } });
    expect(lineaDelPaso(enMano([fallida], true))?.clave).toBe("cpoEntregaEnMano");
    expect(lineaDelPaso(enMano([fallida, fila("B", { codigo: "1234" })], true))?.clave).toBe("cpoEntregaEnMano");
  });

  it("no lleva botón: avisar a cada ganadora va en su fila", () => {
    expect(botonDelPaso(enMano([fila("A", { codigo: "0042" })]))).toBeNull();
  });

  it("deja la pregunta de dejar la campaña mientras alguna ganadora no esté marcada, como con cuentas", () => {
    expect(avisosPendientes(enMano([fila("A", { avisada: true }), fila("B")]), true)).toBe(true);
    expect(avisosPendientes(enMano([fila("A", { avisada: true }), fila("B", { avisada: true })]), true)).toBe(false);
  });
});

describe("el resultado de cuentas dice lo de siempre", () => {
  it("sin la marca de en mano, la línea es la de los celulares o la de avisarle a Tinkazo", () => {
    const sinMarca = (filas: FilaDeGanadora[], otraBilletera: boolean): PasoDelPuente => ({ paso: "resultado", filas, otraBilletera });
    expect(lineaDelPaso(sinMarca([fila("A")], false))).toEqual({ clave: "cpoCelularesResultado", vars: {} });
    expect(lineaDelPaso(sinMarca([fila("A")], true))).toEqual({ clave: "cpoAvisaleATinkazo", vars: {} });
    expect(lineaDelPaso(sinMarca([fila("A", { codigo: "0042" })], false))).toEqual({ clave: "cpoCelularesResultado", vars: {} });
  });
});

describe("los textos del premio en mano", () => {
  it("dicen lo que corresponde en los dos idiomas", () => {
    const es = TEXTOS_SALA_CAMPANA.es;
    const en = TEXTOS_SALA_CAMPANA.en;
    expect(es.cpoEntregaEnMano).toBe("Entregá cada premio en mano.");
    expect(en.cpoEntregaEnMano).toBe("Hand each prize over in person.");
    expect(es.cpoEntregaConCodigo).toBe("Entregá cada premio a quien te muestre su código.");
    expect(en.cpoEntregaConCodigo).toBe("Hand each prize to whoever shows you their code.");
    expect(es.cpoGanadoraN).toBe("Ganadora {n}");
    expect(en.cpoGanadoraN).toBe("Winner {n}");
    expect(es.cpoRepetidaPersona).toBe("Persona repetida");
    expect(en.cpoRepetidaPersona).toBe("Duplicate person");
    expect(es.cpoCodigoDeEntrega).toBe("Código {codigo}");
    expect(en.cpoCodigoDeEntrega).toBe("Code {codigo}");
    expect(es.cpoVerCodigos).toBe("Ver los códigos");
    expect(en.cpoVerCodigos).toBe("Show the codes");
    expect(es.cpoMarcadaAvisada).toBe("Marcada como avisada.");
    expect(en.cpoMarcadaAvisada).toBe("Marked as notified.");
  });

  it("ninguno lleva comillas angulares, punto y coma ni nada técnico", () => {
    const claves = [
      "cpoEntregaEnMano",
      "cpoEntregaConCodigo",
      "cpoGanadoraN",
      "cpoRepetidaPersona",
      "cpoCodigoDeEntrega",
      "cpoVerCodigos",
      "cpoMarcadaAvisada",
      "cpoNoSeMarco",
    ];
    for (const lengua of ["es", "en"] as const) {
      for (const clave of claves) {
        const texto = TEXTOS_SALA_CAMPANA[lengua][clave] ?? "";
        expect(texto, `${lengua}.${clave}`).not.toBe("");
        expect(texto, `${lengua}.${clave}`).not.toMatch(/[;«»]|token|hash|p1:/i);
      }
    }
  });

  it("todas las claves nuevas existen en los dos idiomas", () => {
    for (const clave of ["cpoEntregaEnMano", "cpoEntregaConCodigo", "cpoGanadoraN", "cpoRepetidaPersona", "cpoCodigoDeEntrega", "cpoVerCodigos", "cpoMarcadaAvisada", "cpoNoSeMarco"]) {
      expect(TEXTOS_SALA_CAMPANA.es[clave], clave).toBeDefined();
      expect(TEXTOS_SALA_CAMPANA.en[clave], clave).toBeDefined();
    }
  });
});
