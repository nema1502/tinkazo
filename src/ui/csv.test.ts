import { describe, expect, it } from "vitest";
import {
  buildList, columnToText, decodeText, detectSource, dropListHeader, filterChoices, filterRows, fixCase, igualesQuitados, looksTabular,
  mailNotes, maskEmail, nameKey, parseTable, presets, quitarNumeracion, suggestFilter,
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

  it("con «Nombre» y «Apellido» separados (Google Forms), propone la columna que los une (D10)", () => {
    const forms = "Marca temporal,Nombre,Apellido,Correo,Carrera\n" +
      "21/10/2026 18:01,Ana,Quispe,ana@example.org,Sistemas\n" +
      "21/10/2026 18:02,Luis,Mamani,luis@example.org,Industrial\n" +
      "21/10/2026 18:03,Ana,Flores,anaf@example.org,Sistemas\n" +
      "21/10/2026 18:04,Carla,,carla@example.org,Civil";
    const t = parseTable(forms)!;
    expect(t.columns[t.suggested]).toBe("Nombre + Apellido");
    expect(t.unida).toBe(t.suggested);
    expect(columnToText(t, t.suggested)).toBe("Ana Quispe\nLuis Mamani\nAna Flores\nCarla");
    const b = buildList(t, t.suggested, t.rows.map(() => true), { fixCase: true, numberDupes: false });
    expect(b.names).toEqual(["Ana Quispe", "Luis Mamani", "Ana Flores", "Carla"]);
    // No es un filtro, y no cuenta como columna del archivo.
    expect(filterChoices(t, t.suggested).some((f) => f.column === t.unida)).toBe(false);
    expect(t.columns.slice(0, -1)).toEqual(["Marca temporal", "Nombre", "Apellido", "Correo", "Carrera"]);
  });

  it("también con el apellido paterno y el materno, en su orden", () => {
    const t = parseTable("Nombres;Apellido paterno;Apellido materno\nMaría José;Quispe;Mamani\nJuan;Choque;")!;
    expect(t.columns[t.suggested]).toBe("Nombres + Apellido paterno + Apellido materno");
    expect(columnToText(t, t.suggested)).toBe("María José Quispe Mamani\nJuan Choque");
  });

  it("con un nombre completo en el archivo no se agrega nada: Luma sigue igual", () => {
    const luma = "api_id,name,first_name,last_name,email\nevt-1,Ana Quispe,Ana,Quispe,ana@example.org\nevt-2,Luis Mamani,Luis,Mamani,luis@example.org";
    const t = parseTable(luma)!;
    expect(t.unida).toBeUndefined();
    expect(t.columns[t.suggested]).toBe("name");
    expect(parseTable(LUMA)!.unida).toBeUndefined();
  });

  it("si ninguna fila trae el apellido, no hay nada que unir", () => {
    const t = parseTable("Nombre,Apellido,Correo\nAna Quispe,,ana@example.org\nLuis Mamani,,luis@example.org")!;
    expect(t.unida).toBeUndefined();
    expect(t.columns[t.suggested]).toBe("Nombre");
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

/* Lo que encontró el QA del 16 de octubre de 2026 al importar CSV de verdad. */

/** Bytes de un texto en una codificación de un byte por letra (Latin-1 y la mayor parte de Windows-1252). */
const latin1 = (s: string): number[] => [...s].map((c) => c.charCodeAt(0));
const utf8 = (s: string): number[] => [...new TextEncoder().encode(s)];
const utf16 = (s: string, bigEndian = false): number[] =>
  [...s].flatMap((c) => {
    const n = c.charCodeAt(0);
    return bigEndian ? [n >> 8, n & 0xff] : [n & 0xff, n >> 8];
  });
const bytes = (...parts: number[][]): Uint8Array => Uint8Array.from(parts.flat());

describe("la codificación del archivo", () => {
  it("lee un CSV de Excel en Windows (ANSI) sin dejar «Mar�a»", () => {
    const text = decodeText(bytes(latin1("Nombre;Correo\nMaría Peña;maria@example.org\nÓscar Limachi;oscar@example.org")))!;
    expect(text).not.toContain("\uFFFD");
    const t = parseTable(text)!;
    expect(t.rows.map((r) => r[0])).toEqual(["María Peña", "Óscar Limachi"]);
  });

  it("en Windows-1252, lo de 0x80 a 0x9F son letras y no controles", () => {
    // 0x92 es el apóstrofo tipográfico que Excel pone en "O’Brien".
    expect(decodeText(bytes(latin1("Pat O"), [0x92], latin1("Brien")))).toBe("Pat O’Brien");
  });

  it("UTF-8, con o sin BOM, queda igual y sin el BOM", () => {
    expect(decodeText(bytes(utf8("nombre\nSofía Aguilar")))).toBe("nombre\nSofía Aguilar");
    expect(decodeText(bytes([0xef, 0xbb, 0xbf], utf8("nombre\nSofía Aguilar")))).toBe("nombre\nSofía Aguilar");
  });

  it("UTF-16 con BOM, que es el «Texto Unicode» de Excel, en los dos órdenes", () => {
    const tsv = "Nombre\tCorreo\nFranco Ibáñez\tfranco@example.org";
    expect(decodeText(bytes([0xff, 0xfe], utf16(tsv)))).toBe(tsv);
    expect(decodeText(bytes([0xfe, 0xff], utf16(tsv, true)))).toBe(tsv);
  });

  it("UTF-16 sin BOM, por los ceros", () => {
    expect(decodeText(bytes(utf16("Camila Suárez\nAndrés Villca")))).toBe("Camila Suárez\nAndrés Villca");
  });

  it("una planilla de Excel, un PDF o algo binario no son texto", () => {
    expect(decodeText(bytes([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x06, 0x00]))).toBeNull();
    expect(decodeText(bytes(latin1("%PDF-1.7\n")))).toBeNull();
    expect(decodeText(bytes(latin1("Ana"), [0x00, 0x00, 0x00, 0x01, 0xff], latin1("Luis")))).toBeNull();
  });

  it("los finales de línea de Windows y de Mac quedan en \\n", () => {
    expect(decodeText(bytes(latin1("Ana Vargas\r\nDiego Rojas\rElena Condori")))).toBe("Ana Vargas\nDiego Rojas\nElena Condori");
  });

  it("un archivo vacío es texto vacío", () => {
    expect(decodeText(new Uint8Array())).toBe("");
  });
});

describe("el encabezado no es un participante", () => {
  it("en una lista de una columna, la primera línea «Nombre» no entra", () => {
    const { text, header } = dropListHeader("Nombre\nMaría Quispe\nJorge Mamani");
    expect(header).toBe("Nombre");
    expect(canonicalList(text)).toEqual(["María Quispe", "Jorge Mamani"]);
  });

  it("reconoce las formas de siempre del encabezado", () => {
    for (const h of [
      "Name", "NOMBRE COMPLETO", "Participante", "Participantes", "Nombres y apellidos",
      "Nombre del participante", "Nombre:", '"Nombre"', "Full name", "Asistentes",
    ]) {
      expect(dropListHeader(`${h}\nLucía Flores\nCarlos Choque`).header, h).not.toBeNull();
    }
  });

  it("una lista que empieza con un nombre queda como estaba", () => {
    const list = "Diego Rojas\nLucía Flores\nCarlos Choque";
    expect(dropListHeader(list)).toEqual({ text: list, header: null });
  });

  it("con un número no es encabezado: «Participante 1» es un nombre de prueba", () => {
    expect(dropListHeader("Participante 1\nParticipante 2").header).toBeNull();
  });
});

describe("una lista numerada de WhatsApp entra sin los números (D09)", () => {
  it("«1. Ana Quispe» y «9. Ana Quispe» quedan como una sola persona", () => {
    const pegado = "1. Ana Quispe\n2. Luis Mamani\n3. Carla Flores\n9. Ana Quispe";
    const r = quitarNumeracion(pegado);
    expect(r.lineas).toBe(4);
    expect(canonicalList(r.text)).toEqual(["Ana Quispe", "Luis Mamani", "Carla Flores"]);
    expect(r).toMatchObject({ antes: "1. Ana Quispe", despues: "Ana Quispe", sueltas: [] });
  });

  it("acepta las formas de siempre: 1. 1.- 1) (1) 1º 1 1.Ana, viñetas y números de emoji", () => {
    const formas = ["1. Ana", "2.- Luis", "3) Carla", "(4) Diego", "5º Elena", "6 Franco", "7.Gabriela", "• Hugo", "- Inés", "* Juan", "8️⃣ Karen", "🔟 Lucía", "1⃣ Mario"];
    const r = quitarNumeracion(formas.join("\n"));
    expect(r.lineas).toBe(formas.length);
    expect(r.text.split("\n")).toEqual(["Ana", "Luis", "Carla", "Diego", "Elena", "Franco", "Gabriela", "Hugo", "Inés", "Juan", "Karen", "Lucía", "Mario"]);
  });

  it("los lugares libres de la lista («5.») quedan vacíos y no entran", () => {
    const r = quitarNumeracion("1. Ana Quispe\n2. Luis Mamani\n3.\n4.\n5.");
    expect(canonicalList(r.text)).toEqual(["Ana Quispe", "Luis Mamani"]);
  });

  it("el título sin número no se toca, y se avisa", () => {
    const r = quitarNumeracion("*Sorteo del meetup* 🎁\n1. Ana Quispe\n2. Luis Mamani\n3. Carla Flores");
    expect(r.text.split("\n")[0]).toBe("*Sorteo del meetup* 🎁");
    expect(r.sueltas).toEqual(["*Sorteo del meetup* 🎁"]);
  });

  it("si la mayoría no está numerada, no se toca nada: hay nombres que empiezan con un número", () => {
    const lista = "3 Marías Café\nAna Quispe\nLuis Mamani";
    expect(quitarNumeracion(lista)).toEqual({ text: lista, lineas: 0, antes: "", despues: "", sueltas: [] });
    // Mitad y mitad tampoco: hace falta la mayoría.
    expect(quitarNumeracion("1. Ana\nLuis Mamani").lineas).toBe(0);
    // Un solo número no alcanza.
    expect(quitarNumeracion("1. Ana").lineas).toBe(0);
  });

  it("la negrita de WhatsApp («*Ana*») no es una viñeta", () => {
    expect(quitarNumeracion("*Ana Quispe*\n*Luis Mamani*").lineas).toBe(0);
  });

  it("una lista sin numerar queda exactamente como estaba", () => {
    const lista = "Diego Rojas\nLucía Flores\nCarlos Choque";
    expect(quitarNumeracion(lista).text).toBe(lista);
  });
});

describe("cuántos repetidos iguales deja afuera la lista canónica", () => {
  it("cuenta las líneas que repiten un nombre escrito exactamente igual", () => {
    const texto = "Ana Quispe\nLuis Mamani\nAna Quispe\n  Ana Quispe  \nana quispe\n\nX";
    expect(igualesQuitados(texto)).toBe(2);
  });

  it("coincide con lo que de verdad hace la lista canónica", () => {
    for (const texto of ["Ana\nAna\nLuis", "Ana, ingeniera\nAna, abogada\nLuis", "a\nb\nAna\nAna", "Ana\nana\nANA"]) {
      const validas = texto.split("\n").filter((l) => (l.split(",")[0] ?? "").trim().length >= 2).length;
      expect(igualesQuitados(texto), texto).toBe(validas - canonicalList(texto).length);
    }
  });

  it("en una tabla, «Participantes» también es encabezado aunque no haya números", () => {
    const t = parseTable("Participantes;Carrera\nMaría Quispe;Sistemas\nJorge Mamani;Civil")!;
    expect(t.headerDetected).toBe(true);
    expect(t.rows.map((r) => r[0])).toEqual(["María Quispe", "Jorge Mamani"]);
  });

  it("un archivo con solo el encabezado no tiene a nadie", () => {
    const t = parseTable("Nombre,Correo\n")!;
    expect(t.headerDetected).toBe(true);
    expect(t.rows).toEqual([]);
    expect(canonicalList(dropListHeader("Nombre\n").text)).toEqual([]);
  });
});

describe("una fila que no encaja no descarta la tabla", () => {
  it("una coma sin comillas en el nombre se arregla", () => {
    const t = parseTable("Nombre,Correo\nAna Vargas,ana@example.org\nMejía, Nicolás,nico@example.org\nPablo Gutiérrez,pablo@example.org")!;
    expect(t.columns).toEqual(["Nombre", "Correo"]);
    expect(t.rows).toEqual([
      ["Ana Vargas", "ana@example.org"],
      ["Mejía, Nicolás", "nico@example.org"],
      ["Pablo Gutiérrez", "pablo@example.org"],
    ]);
    expect(t.skipped).toEqual([]);
  });

  it("en un export de Luma, también: la coma estaba en el nombre y no en el código", () => {
    const t = parseTable(LUMA.replace('"Mejía, Nicolás"', "Mejía, Nicolás"))!;
    expect(t.skipped).toEqual([]);
    expect(t.rows[1]?.slice(0, 3)).toEqual(["evt-guest-b2", "Mejía, Nicolás", "nico@example.org"]);
    expect(columnToText(t, t.suggested)).toBe("Ana Quispe\nMejía Nicolás\nRodrigo Mamani");
  });

  it("si la coma pudo estar en dos columnas, no adivina: salta la fila y dice en qué línea está", () => {
    const t = parseTable(
      "Nombre,Dirección,Correo\nAna Vargas,Calle 1,ana@example.org\nLuis Choque,Calle 2, Zona Sur,luis@example.org\nRodrigo Peña,Calle 3,rodrigo@example.org",
    )!;
    expect(t.rows.map((r) => r[0])).toEqual(["Ana Vargas", "Rodrigo Peña"]);
    expect(t.skipped).toEqual([3]);
  });

  it("las líneas se cuentan bien aunque una celda entre comillas tenga saltos de línea", () => {
    const t = parseTable(
      'Nombre,Dirección,Correo\nAna Vargas,"Calle 1\nZona Sur",ana@example.org\nLuis Choque,Calle 2, Zona Sur,luis@example.org',
    )!;
    expect(t.rows).toHaveLength(1);
    expect(t.skipped).toEqual([4]);
  });

  it("una fila corta se completa con celdas vacías, como en cualquier planilla", () => {
    const t = parseTable("nombre,correo\nAna Vargas,ana@example.org\nLuis Choque\nRodrigo Peña,rodrigo@example.org")!;
    expect(t.rows[1]).toEqual(["Luis Choque", ""]);
    expect(t.skipped).toEqual([]);
  });

  it("una comilla que nunca cierra no se traga el resto del archivo", () => {
    const t = parseTable('nombre,correo\n"Ana Vargas,ana@example.org\nLuis Choque,luis@example.org\nRodrigo Peña,rodrigo@example.org')!;
    expect(t.rows.map((r) => r[0])).toEqual(["Ana Vargas", "Luis Choque", "Rodrigo Peña"]);
  });

  it("una lista con alguna coma suelta sigue siendo una lista", () => {
    expect(looksTabular("Mejía, Nicolás\nAna Vargas\nLuis Choque")).toBe(false);
  });

  it("el punto y coma de Excel en español gana aunque los nombres tengan comas", () => {
    const t = parseTable("Nombre;Correo\nMejía, Nicolás;nico@example.org\nQuispe, María;maria@example.org")!;
    expect(t.columns).toEqual(["Nombre", "Correo"]);
    expect(t.rows.map((r) => r[0])).toEqual(["Mejía, Nicolás", "Quispe, María"]);
  });
});

describe("homónimos", () => {
  const T2 = parseTable(
    "name,email\nDiego Rojas,diego.rojas@example.org\nAna Quispe,ana@example.org\nDiego Rojas,drojas@example.org\n" +
    "Ana Quispe,ana.q@example.org\nElena Condori,elena@example.org\nElena Condori,elena@example.org",
  )!;
  const all = T2.rows.map(() => true);

  it("se decide por nombre: dos Diego Rojas distintos y las demás, una vez", () => {
    const b = buildList(T2, 0, all, { fixCase: false, numberDupes: new Set([nameKey("Diego Rojas")]) });
    expect(b.names).toEqual(["Diego Rojas", "Ana Quispe", "Diego Rojas (2)", "Elena Condori"]);
    expect(b.dupes).toHaveLength(3);
  });

  it("con el mismo correo enmascarado, dice si el completo es el mismo u otro, sin mostrarlo", () => {
    const { dupes } = buildList(T2, 0, all, { fixCase: false, numberDupes: false });
    const notes = mailNotes(T2, 1, dupes);
    // "diego.rojas@" y "drojas@" son los dos "d•••@example.org".
    expect(maskEmail("diego.rojas@example.org")).toBe(maskEmail("drojas@example.org"));
    expect(notes.get(2)).toBe("other");
    expect(notes.get(3)).toBe("other");
    expect(notes.get(5)).toBe("same");
    expect(notes.has(0)).toBe(false);
  });

  it("si los correos enmascarados ya se distinguen, no agrega nada", () => {
    const t = parseTable("name,email\nAna Quispe,ana@example.org\nAna Quispe,quispe.ana@example.org")!;
    const { dupes } = buildList(t, 0, [true, true], { fixCase: false, numberDupes: false });
    expect(mailNotes(t, 1, dupes).size).toBe(0);
  });

  it("sin columna de correo, no hay nada que comparar", () => {
    const t = parseTable("name,city\nDiego Rojas,La Paz\nDiego Rojas,Sucre")!;
    const { dupes } = buildList(t, 0, [true, true], { fixCase: false, numberDupes: false });
    expect(mailNotes(t, -1, dupes).size).toBe(0);
  });
});
