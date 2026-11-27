import { describe, expect, it } from "vitest";
import { type PasoDelPuente, avisosPendientes, botonDelPaso, lineaDelPaso } from "./puente";
import { TEXTOS_SALA_CAMPANA } from "./textos-sala";

/**
 * El paso de una lista que la sala devuelve mezclada, con cuentas y líneas de persona juntas: no se puede sortear y
 * reintentar no lo cambia. La línea lo dice y no hay botón de reintentar.
 */

const LISTA_RARA: PasoDelPuente = { paso: "lista-rara" };

describe("el paso lista-rara", () => {
  it("dice cpoListaRara, sin nada que reemplazar", () => {
    expect(lineaDelPaso(LISTA_RARA)).toEqual({ clave: "cpoListaRara", vars: {} });
  });

  it("no lleva botón: ni reintentar ni nada", () => {
    expect(botonDelPaso(LISTA_RARA)).toBeNull();
  });

  it("el texto existe en los dos idiomas y manda a avisar a Tinkazo", () => {
    expect(TEXTOS_SALA_CAMPANA.es.cpoListaRara).toBe("La lista de la sala no se puede sortear. Avisale a Tinkazo.");
    expect(TEXTOS_SALA_CAMPANA.en.cpoListaRara).toBe("The list on the server can't be drawn. Let Tinkazo know.");
  });

  it("no ofrece reintentar como lo hace una lectura que falló", () => {
    expect(botonDelPaso({ paso: "no-leyo" })).toEqual({ clave: "cpoReintentar", accion: "reintentarPaso" });
    expect(botonDelPaso(LISTA_RARA)?.accion).not.toBe("reintentarPaso");
  });

  it("antes y después del sorteo deja la pregunta de dejar la campaña, como cualquier paso que no confirma nada", () => {
    expect(avisosPendientes(LISTA_RARA, false)).toBe(true);
    expect(avisosPendientes(LISTA_RARA, true)).toBe(true);
  });

  it("los demás pasos dicen lo mismo que antes", () => {
    expect(lineaDelPaso({ paso: "no-leyo" })).toEqual({ clave: "cpoNoLeyo", vars: {} });
    expect(lineaDelPaso({ paso: "sala-borrada" })).toEqual({ clave: "cpoSeBorro", vars: {} });
  });
});
