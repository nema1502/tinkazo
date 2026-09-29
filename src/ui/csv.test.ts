import { describe, expect, it } from "vitest";
import {
  buildList, columnToText, detectSource, filterChoices, filterRows, fixCase, looksTabular, maskEmail, parseTable,
  presets, suggestFilter,
} from "./csv";
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

describe("quiénes entran", () => {
  it("en un export de Luma, propone a los que hicieron check-in", () => {
    const t = parseTable(LUMA)!;
    const f = suggestFilter(t)!;
    expect(t.columns[f.column]).toBe("checked_in_at");
    expect(f.value).toBeNull();
    expect(columnToText(filterRows(t, f), t.suggested)).toBe("Ana Quispe\nRodrigo Mamani");
  });

  it("si nadie hizo check-in, no propone nada: dejaría la lista vacía", () => {
    const t = parseTable("name,checked_in_at\nAna Quispe,\nLuis Choque,")!;
    expect(suggestFilter(t)).toBeNull();
  });

  it("si todos hicieron check-in, tampoco: no cambiaría nada", () => {
    const t = parseTable("name,checked_in_at\nAna Quispe,2026-09-03T18:10:00Z\nLuis Choque,2026-09-03T18:12:00Z")!;
    expect(suggestFilter(t)).toBeNull();
  });

  it("en una columna de estado, elige el valor que dice que fue", () => {
    const t = parseTable("Attendee name,Attendee Status\nAna Quispe,Checked In\nLuis Choque,Attending\nRodrigo Mamani,Checked In")!;
    const f = suggestFilter(t)!;
    expect(f.value).toBe("Checked In");
    expect(columnToText(filterRows(t, f), 0)).toBe("Ana Quispe\nRodrigo Mamani");
  });

  it("ofrece filtrar por lo que tiene sentido y no por la columna de nombres", () => {
    const t = parseTable("name,approval_status,checked_in_at\nAna,approved,x\nLuis,declined,\nRo,approved,x")!;
    const choices = filterChoices(t, 0);
    expect(choices.some((c) => c.column === 0)).toBe(false);
    expect(choices).toContainEqual({ column: 1, value: "approved" });
    expect(choices).toContainEqual({ column: 1, value: "declined" });
    expect(choices).toContainEqual({ column: 2, value: null });
  });

  it("sin filtro, entran todas las filas", () => {
    const t = parseTable(LUMA)!;
    expect(filterRows(t, null).rows).toHaveLength(3);
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

/**
 * Un export de Luma como el de verdad (septiembre de 2026): 35 columnas en el
 * original, acá las que importan. Los nombres son inventados; los casos no:
 * alguien inscrito dos veces que vino una sola, nombres en minúsculas o en
 * mayúsculas, y los cuatro estados de la inscripción.
 */
const LUMA_REAL = `guest_id,name,first_name,last_name,email,approval_status,checked_in_at,referrer,referred_by,ticket_name
gst-1,Ana Quispe,Ana,Quispe,ana@example.org,approved,2026-08-22T15:05:39Z,,,Standard
gst-2,Luis Choque,Luis,Choque,luis@example.org,approved,,GMail,,Standard
gst-3,Ana Quispe,Ana,Quispe,ana.q@example.org,approved,,,,Standard
gst-4,jorge mamani,jorge,mamani,jorge@example.org,approved,2026-08-22T15:59:42Z,,,Standard
gst-5,ELENA CONDORI,ELENA,CONDORI,elena@example.org,approved,2026-08-22T16:03:44Z,GMail,,Standard
gst-6,Rosa Villca,Rosa,Villca,rosa@example.org,pending_approval,,,,Standard
gst-7,Mario Apaza,Mario,Apaza,mario@example.org,invited,,,,
gst-8,Nina Rocha,Nina,Rocha,nina@example.org,declined,,,alguien@example.org,Standard`;

describe("la ventana de importar", () => {
  it("reconoce un export de Luma", () => {
    expect(detectSource(parseTable(LUMA_REAL)!)).toBe("luma");
    expect(detectSource(parseTable("nombre,correo\nAna,ana@example.org\nLuis,luis@example.org")!)).toBeNull();
  });

  it("propone los que vinieron, los aprobados y todos, con cuántos deja cada uno", () => {
    const ps = presets(parseTable(LUMA_REAL)!);
    expect(ps.map((p) => [p.id, p.count])).toEqual([["came", 3], ["approved", 5], ["all", 8]]);
  });

  it("no ofrece como filtro los nombres, los correos ni los identificadores", () => {
    const t = parseTable(LUMA_REAL)!;
    const cols = new Set(filterChoices(t, t.suggested).map((f) => t.columns[f.column]));
    for (const c of ["first_name", "last_name", "email", "guest_id", "referred_by"]) expect(cols.has(c)).toBe(false);
    expect(cols.has("approval_status")).toBe(true);
    expect(cols.has("checked_in_at")).toBe(true);
  });

  it("arregla las mayúsculas solo de lo que llegó todo igual", () => {
    expect(fixCase("jorge mamani")).toBe("Jorge Mamani");
    expect(fixCase("ELENA CONDORI")).toBe("Elena Condori");
    expect(fixCase("maría de la cruz")).toBe("María de la Cruz");
    expect(fixCase("ana-lucía flores")).toBe("Ana-Lucía Flores");
    // Mezcladas: así las escribió la persona.
    expect(fixCase("Ronald McDonald")).toBe("Ronald McDonald");
    expect(fixCase("de la Fuente")).toBe("de la Fuente");
  });

  it("con los que vinieron: tres nombres, dos arreglados", () => {
    const t = parseTable(LUMA_REAL)!;
    const came = presets(t)[0]!;
    const picked = t.rows.map((r) => filterRows({ ...t, rows: [r] }, came.filter).rows.length === 1);
    const b = buildList(t, t.suggested, picked, { fixCase: true, numberDupes: false });
    expect(b.names).toEqual(["Ana Quispe", "Jorge Mamani", "Elena Condori"]);
    expect(b.cased).toBe(2);
    expect(b.dupes).toEqual([]);
  });

  it("la misma persona inscrita dos veces entra una vez, salvo que se diga que son dos", () => {
    const t = parseTable(LUMA_REAL)!;
    const picked = [true, true, true, false, false, false, false, false];
    const una = buildList(t, t.suggested, picked, { fixCase: true, numberDupes: false });
    expect(una.names).toEqual(["Ana Quispe", "Luis Choque"]);
    expect(una.dupes).toEqual([[0, 2]]);
    const dos = buildList(t, t.suggested, picked, { fixCase: true, numberDupes: true });
    expect(dos.names).toEqual(["Ana Quispe", "Luis Choque", "Ana Quispe (2)"]);
    // Numerados, la lista canónica no los funde.
    expect(canonicalList(dos.names.join("\n"))).toHaveLength(3);
  });

  it("junta los repetidos aunque cambien las tildes o las mayúsculas", () => {
    const t = parseTable("name,email\nJosé Pérez,a@example.org\njose perez,b@example.org\nLuis Choque,c@example.org")!;
    const b = buildList(t, 0, [true, true, true], { fixCase: false, numberDupes: false });
    expect(b.names).toEqual(["José Pérez", "Luis Choque"]);
  });

  it("muestra del correo solo lo que alcanza para distinguir", () => {
    expect(maskEmail("ana.quispe@example.org")).toBe("a•••@example.org");
    expect(maskEmail("sin arroba")).toBe("");
  });
});
