import { describe, expect, it } from "vitest";
import { stripInvisibles, stripInvisiblesByLine, withoutInvisibles } from "./invisibles";
import { buscar, repetidos, vecesExacto } from "./buscar";
import { canonicalList, listHash } from "./protocol/canonical";
import { bytesToHex } from "./protocol/quicknet";
import { buildList, decodeText, nameKey, parseTable, presets, rowPasses } from "./ui/csv";

/**
 * Los caracteres van por su número y no escritos: en el código fuente
 * tampoco tiene que haber nada que no se vea.
 */
const ch = (...cps: number[]): string => String.fromCodePoint(...cps);

/** Los tres que encontró el stream de diseño. */
const TRES: [string, string][] = [
  ["el espacio de ancho cero (U+200B)", ch(0x200b)],
  ["el word joiner (U+2060)", ch(0x2060)],
  ["el guion blando (U+00AD)", ch(0x00ad)],
];
/** Los controles de dirección: la marca árabe, las marcas, las incrustaciones, los forzados y los aislados. */
const DIRECCION: [string, string][] = [0x061c, 0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069]
  .map((c) => [`U+${c.toString(16).toUpperCase().padStart(4, "0")}`, ch(c)]);
const TODOS: [string, string][] = [...TRES, ...DIRECCION, ["la marca de orden de bytes (U+FEFF)", ch(0xfeff)]];

const ZWNJ = ch(0x200c);
const ZWJ = ch(0x200d);

/** "Ana Quispe" con el invisible metido en el apellido, que es donde no se nota. */
const conInvisible = (c: string): string => `Ana Qui${c}spe`;

describe("stripInvisibles: lo que sale al cargar la lista", () => {
  it.each(TODOS)("saca %s, en el medio, al principio y al final", (_, c) => {
    expect(stripInvisibles(conInvisible(c))).toBe("Ana Quispe");
    expect(stripInvisibles(`${c}Ana Quispe${c}`)).toBe("Ana Quispe");
    expect(stripInvisibles(`${c}${c}Ana${c} Quispe`)).toBe("Ana Quispe");
  });

  it("un nombre forzado de derecha a izquierda se ve como se escribió", () => {
    // Con U+202E, "epsiuQ" se veía "Quispe": otro nombre en la pantalla.
    expect(stripInvisibles(`Ana ${ch(0x202e)}epsiuQ${ch(0x202c)}`)).toBe("Ana epsiuQ");
  });

  it("saca los operadores invisibles, el separador mongol y los formatos desusados", () => {
    for (const c of [0x2061, 0x2062, 0x2063, 0x2064, 0x180e, 0x206a, 0x206f]) {
      expect(stripInvisibles(conInvisible(ch(c)))).toBe("Ana Quispe");
    }
  });

  it("saca el ZWJ y el ZWNJ entre letras latinas, donde no hacen nada", () => {
    expect(stripInvisibles(conInvisible(ZWJ))).toBe("Ana Quispe");
    expect(stripInvisibles(conInvisible(ZWNJ))).toBe("Ana Quispe");
    expect(stripInvisibles(`${ZWJ}Ana Quispe${ZWNJ}`)).toBe("Ana Quispe");
    // Pegado a un emoji pero sin otro emoji del otro lado, tampoco se ve.
    expect(stripInvisibles(`Ana ${ch(0x1f469)}${ZWJ}`)).toBe(`Ana ${ch(0x1f469)}`);
    expect(stripInvisibles(`Ana${ZWJ}${ch(0x1f469)}`)).toBe(`Ana${ch(0x1f469)}`);
  });

  it("deja el ZWJ que arma un emoji y el que enlaza letras en otras escrituras: ahí se ve", () => {
    const visibles = [
      ch(0x1f469, 0x200d, 0x1f4bb), // la programadora
      ch(0x1f468, 0x1f3fd, 0x200d, 0x1f4bb), // con tono de piel
      ch(0x1f3f3, 0xfe0f, 0x200d, 0x1f308), // la bandera del arcoíris
      ch(0x0dc1, 0x0dca, 0x200d, 0x0dbb, 0x0dd3), // "Sri" en cingalés
      ch(0x0915, 0x094d, 0x200d, 0x0937), // un conjunto en devanagari
      ch(0x0645, 0x06cc, 0x200c, 0x062e, 0x0648, 0x0627, 0x0647, 0x0645), // persa, con ZWNJ
    ];
    for (const v of visibles) expect(stripInvisibles(`Valeria ${v}`)).toBe(`Valeria ${v}`);
  });

  it("no toca un nombre limpio", () => {
    for (const n of ["María Quispe", "Óscar Limachi", "Ñusta Mamani", "Ana-Lucía de la Cruz", `José ${ch(0x2764, 0xfe0f)}`, "李小龍", `Nico ${ch(0x1f1e7, 0x1f1f4)}`]) {
      expect(stripInvisibles(n)).toBe(n);
    }
  });
});

describe("withoutInvisibles: lo que no se mira al comparar", () => {
  it("saca todo lo que no se dibuja, también lo que se deja al cargar", () => {
    for (const [, c] of TODOS) expect(withoutInvisibles(conInvisible(c))).toBe("Ana Quispe");
    expect(withoutInvisibles(ch(0x1f469, 0x200d, 0x1f4bb))).toBe(ch(0x1f469, 0x1f4bb));
    expect(withoutInvisibles(`José ${ch(0x2764, 0xfe0f)}`)).toBe(`José ${ch(0x2764)}`);
    // El relleno coreano, que se usa para nombres "en blanco".
    expect(withoutInvisibles(`Ana Quispe${ch(0x3164)}`)).toBe("Ana Quispe");
  });

  it("deja lo que se ve", () => {
    expect(withoutInvisibles("María Quispe")).toBe("María Quispe");
  });
});

describe("stripInvisiblesByLine: el texto y cuántos nombres cambiaron", () => {
  it("cuenta las líneas con algo escrito de las que sacó algo", () => {
    const raw = [conInvisible(ch(0x200b)), "Luis Choque", `${ch(0x200e)}Jorge Mamani${ch(0x200f)}`, "", ch(0x2060, 0x2060)].join("\n");
    const { text, lines } = stripInvisiblesByLine(raw);
    expect(text).toBe(["Ana Quispe", "Luis Choque", "Jorge Mamani", "", ""].join("\n"));
    // La última era un nombre que no se veía: también cuenta.
    expect(lines).toBe(3);
  });

  it("sin nada que sacar, el mismo texto y cero", () => {
    const raw = "Ana Quispe\r\nLuis Choque\r\n";
    expect(stripInvisiblesByLine(raw)).toEqual({ text: raw, lines: 0 });
  });
});

describe("la lista canónica no cambia (docs/protocolo.md §1)", () => {
  it("sigue sin normalizar: el arreglo va antes de sellar, no en el sello", () => {
    const pegado = ["Ana Quispe", conInvisible(ch(0x200b))].join("\n");
    // Lo que llega al protocolo tal cual son dos entradas: la huella de los comprobantes de antes no cambia.
    expect(canonicalList(pegado)).toHaveLength(2);
    expect(canonicalList(pegado)[1]).toBe(conInvisible(ch(0x200b)));
    // Limpio al cargar, es una sola persona y su huella es la de la lista limpia.
    const limpio = canonicalList(stripInvisiblesByLine(pegado).text);
    expect(limpio).toEqual(["Ana Quispe"]);
    expect(bytesToHex(listHash(limpio))).toBe(bytesToHex(listHash(["Ana Quispe"])));
  });
});

describe("la marca de repetidos ve lo que ve la sala", () => {
  it.each(TODOS)("marca a Ana Quispe dos veces aunque una traiga %s", (_, c) => {
    // Como llega una lista sellada antes de este arreglo o escrita a mano: sin limpiar.
    const lista = canonicalList(["Ana Quispe", "Luis Choque", conInvisible(c)].join("\n"));
    expect(lista).toHaveLength(3);
    expect([...repetidos(lista)].sort()).toEqual([0, 2]);
    expect(buscar(lista, "ana quispe")).toEqual([1, 3]);
    expect(vecesExacto(lista, "Ana Quispe")).toBe(2);
    expect(nameKey(conInvisible(c))).toBe(nameKey("Ana Quispe"));
  });

  it("también con el ZWJ y el ZWNJ que se dejan al cargar", () => {
    const lista = [`Valeria ${ch(0x1f469, 0x200d, 0x1f4bb)}`, `Valeria ${ch(0x1f469, 0x1f4bb)}`, `Ana${ZWNJ} Quispe`, "Ana Quispe"];
    expect([...repetidos(lista)].sort()).toEqual([0, 1, 2, 3]);
  });
});

/** Las tres maneras de cargar la lista, con los tres invisibles y los de dirección. */
const VARIANTES = TODOS.map(([, c]) => conInvisible(c));

describe("al pegar una lista", () => {
  it("entra limpia: cada copia invisible de Ana Quispe se funde con ella, y el aviso las cuenta", () => {
    // Como sale de un chat: marcas de dirección alrededor de un nombre y un invisible en cada copia.
    const pegado = ["Ana Quispe", `${ch(0x202a)}Luis Choque${ch(0x202c)}`, ...VARIANTES, "Jorge Mamani"].join("\n");
    const { text, lines } = stripInvisiblesByLine(pegado);
    expect(canonicalList(text)).toEqual(["Ana Quispe", "Luis Choque", "Jorge Mamani"]);
    expect(lines).toBe(VARIANTES.length + 1);
    expect(repetidos(canonicalList(text)).size).toBe(0);
  });
});

describe("al subir un CSV", () => {
  it("los nombres entran sin invisibles, la copia queda marcada como repetida y entra una", () => {
    const csv = ["Nombre;Correo", "Ana Quispe;ana@example.org", ...VARIANTES.map((v, i) => `${v};ana${i}@example.org`), "Luis Choque;luis@example.org"].join("\r\n");
    // Con la marca del principio, como guarda Excel un "CSV UTF-8".
    const t = parseTable(decodeText(Uint8Array.from([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(csv)])) as string)!;
    expect(t.columns).toEqual(["Nombre", "Correo"]);
    const b = buildList(t, t.suggested, t.rows.map(() => true), { fixCase: false, numberDupes: false });
    expect(b.names).toEqual(["Ana Quispe", "Luis Choque"]);
    expect(b.dupes).toEqual([[0, ...VARIANTES.map((_, i) => i + 1)]]);
    expect(b.invisibles).toBe(VARIANTES.length);
  });

  it("una lista suelta en un archivo, sin columnas, también", () => {
    const text = decodeText(new TextEncoder().encode(["Ana Quispe", ...VARIANTES].join("\n"))) as string;
    expect(canonicalList(stripInvisiblesByLine(text).text)).toEqual(["Ana Quispe"]);
  });
});

describe("con un export de Luma", () => {
  /** Ana se inscribió tres veces; las otras dos con un invisible en el nombre. Las tres vinieron. */
  const LUMA = [
    "api_id,name,first_name,last_name,email,approval_status,checked_in_at",
    "gst-1,Ana Quispe,Ana,Quispe,ana@example.org,approved,2026-10-17T15:05:39Z",
    `gst-2,${conInvisible(ch(0x200b))},Ana,Quispe,ana.q@example.org,approved,2026-10-17T15:06:10Z`,
    `gst-3,${ch(0x200e)}Ana Quispe${ch(0x200f)},Ana,Quispe,aq@example.org,approved,2026-10-17T15:07:00Z`,
    `gst-4,Luis Choque${ch(0x2060)},Luis,Choque,luis@example.org,approved,2026-10-17T15:09:42Z`,
    `gst-5,Ro${ch(0x00ad)}sa Villca,Rosa,Villca,rosa@example.org,approved,`,
    "gst-6,Elena Condori,Elena,Condori,elena@example.org,approved,2026-10-17T16:03:44Z",
  ].join("\n");

  it("con los que vinieron: entran limpios, Ana una sola vez, y el aviso cuenta los tres que se limpiaron", () => {
    const t = parseTable(LUMA)!;
    expect(t.columns[t.suggested]).toBe("name");
    const came = presets(t).find((p) => p.id === "came")!;
    const picked = t.rows.map((r) => rowPasses(r, came.filter!));
    const b = buildList(t, t.suggested, picked, { fixCase: true, numberDupes: false });
    expect(b.names).toEqual(["Ana Quispe", "Luis Choque", "Elena Condori"]);
    expect(b.dupes).toEqual([[0, 1, 2]]);
    // Rosa no vino: su guion blando no entra en la cuenta.
    expect(b.invisibles).toBe(3);
  });

  it("si quien organiza dice que son personas distintas, se numeran sin invisibles", () => {
    const t = parseTable(LUMA)!;
    const b = buildList(t, t.suggested, t.rows.map(() => true), { fixCase: false, numberDupes: true });
    expect(b.names).toEqual(["Ana Quispe", "Ana Quispe (2)", "Ana Quispe (3)", "Luis Choque", "Rosa Villca", "Elena Condori"]);
    expect(b.names.every((n) => n === stripInvisibles(n))).toBe(true);
    expect(b.invisibles).toBe(4);
  });
});
