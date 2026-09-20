import { describe, expect, it } from "vitest";
import { columnToText, looksTabular, parseTable } from "./csv";
import { canonicalList } from "../protocol/canonical";

/** Lo que exporta Luma: la primera columna es el identificador, no el nombre. */
const LUMA = `api_id,name,email,created_at,checked_in_at
evt-guest-a1,Ana Quispe,ana@example.org,2026-09-01T14:02:00Z,2026-09-03T18:10:00Z
evt-guest-b2,"Mejía, Nicolás",nico@example.org,2026-09-01T15:40:00Z,
evt-guest-c3,Rodrigo Mamani,rodrigo@example.org,2026-09-02T09:12:00Z,2026-09-03T18:22:00Z`;

describe("parseTable", () => {
  it("lee la cabecera y no la cuenta como participante", () => {
    const t = parseTable(LUMA)!;
    expect(t.headerDetected).toBe(true);
    expect(t.columns).toEqual(["api_id", "name", "email", "created_at", "checked_in_at"]);
    expect(t.rows).toHaveLength(3);
  });

  it("elige la columna de nombres, no la primera", () => {
    const t = parseTable(LUMA)!;
    expect(t.suggested).toBe(1);
    expect(t.columns[t.suggested]).toBe("name");
  });

  it("no parte un nombre que tiene una coma adentro", () => {
    const t = parseTable(LUMA)!;
    expect(t.rows[1]?.[1]).toBe("Mejía, Nicolás");
  });

  it("acepta punto y coma, que es lo que sale de Excel en español", () => {
    const t = parseTable("Nombre;Correo\nAna Quispe;ana@example.org\nLuis Choque;luis@example.org")!;
    expect(t.columns).toEqual(["Nombre", "Correo"]);
    expect(t.suggested).toBe(0);
    expect(t.rows).toHaveLength(2);
  });

  it("acepta tabulaciones, que es lo que sale de pegar una hoja de cálculo", () => {
    const t = parseTable("Ana Quispe\tana@example.org\nLuis Choque\tluis@example.org")!;
    expect(t.headerDetected).toBe(false);
    expect(t.columns).toEqual(["Columna 1", "Columna 2"]);
    expect(t.rows).toHaveLength(2);
  });

  it("sin cabecera, la deduce por la forma de los datos", () => {
    const t = parseTable("1001,Ana Quispe\n1002,Luis Choque\n1003,Rodrigo Mamani")!;
    expect(t.headerDetected).toBe(false);
    expect(t.suggested).toBe(1);
  });

  it("entiende las comillas dobles escapadas", () => {
    const t = parseTable('nombre,alias\nAna Quispe,"la ""Chola"" Quispe"\nLuis Choque,tuto')!;
    expect(t.rows[0]?.[1]).toBe('la "Chola" Quispe');
  });

  it("quita el BOM que pone Excel al inicio del archivo", () => {
    const t = parseTable("﻿nombre,correo\nAna Quispe,ana@example.org")!;
    expect(t.columns[0]).toBe("nombre");
  });

  it("una lista suelta de nombres no es una tabla", () => {
    expect(looksTabular("Ana Quispe\nLuis Choque\nRodrigo Mamani")).toBe(false);
  });

  it("un texto vacío no es una tabla", () => {
    expect(parseTable("   \n  ")).toBeNull();
  });

  it("filas de ancho distinto no son una tabla", () => {
    expect(looksTabular("a,b,c\nd,e\nf")).toBe(false);
  });
});

describe("columnToText", () => {
  it("entrega un nombre por línea, listo para el protocolo", () => {
    const t = parseTable(LUMA)!;
    expect(columnToText(t, t.suggested)).toBe("Ana Quispe\nMejía Nicolás\nRodrigo Mamani");
  });

  it("no deja comas, porque el protocolo corta en la primera", () => {
    const t = parseTable(LUMA)!;
    const text = columnToText(t, t.suggested);
    expect(text).not.toContain(",");
    // Sin esta capa, el protocolo se quedaba con "Mejía" y perdía el nombre.
    expect(canonicalList(text)).toEqual(["Ana Quispe", "Mejía Nicolás", "Rodrigo Mamani"]);
  });

  it("salta las celdas vacías en vez de sortear a un fantasma", () => {
    const t = parseTable("nombre,correo\nAna Quispe,ana@example.org\n,huerfano@example.org\nLuis Choque,luis@example.org")!;
    expect(columnToText(t, 0)).toBe("Ana Quispe\nLuis Choque");
  });

  it("deja elegir cualquier otra columna", () => {
    const t = parseTable(LUMA)!;
    expect(columnToText(t, 2)).toBe("ana@example.org\nnico@example.org\nrodrigo@example.org");
  });
});
