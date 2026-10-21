/**
 * Lectura de CSV, antes de la lista canónica.
 *
 * Importa: esto **no** toca `src/protocol/canonical.ts`. El paso 2 del
 * protocolo ("tomar el texto antes de la primera coma") es normativo y tiene
 * vectores compartidos con el contrato en Rust. Cambiarlo rompería el
 * determinismo entre las dos implementaciones.
 *
 * Lo que hace esta capa es traducir: toma el archivo que exportó Luma, Meetup,
 * Eventbrite o una hoja de cálculo, deja elegir qué columna tiene los nombres,
 * y entrega texto plano de un nombre por línea. Recién ahí entra el protocolo.
 *
 * Sin esto, un export real se rompía de dos formas: la primera columna suele
 * ser un identificador de orden, y un nombre como "Mejía, Nicolás" se partía
 * en la coma.
 */

import { stripInvisibles, withoutInvisibles } from "../invisibles";

export interface Table {
  /** Nombres de las columnas, o `Columna 1`, `Columna 2`… si no hay cabecera. */
  columns: string[];
  /** Filas de datos, ya sin la cabecera. */
  rows: string[][];
  headerDetected: boolean;
  /** Índice de la columna que probablemente tenga los nombres. */
  suggested: number;
  /**
   * Las líneas del archivo (desde 1) con filas que no se pudieron leer: más
   * celdas que columnas y ninguna forma segura de arreglarlas. No entran, y
   * la ventana dice cuántas son y dónde están.
   */
  skipped: number[];
}

/** Separadores que usan las herramientas más comunes, en orden de probabilidad. */
const DELIMITERS = [",", ";", "\t"] as const;

/** Cabeceras que suelen contener el nombre de la persona, en varios idiomas. */
const NAME_HINTS = [
  "name", "full name", "attendee name", "guest name", "display name",
  "nombre", "nombre completo", "nombres", "participante", "asistente", "invitado",
  "first name", "nome", "nom",
];

/** Cabeceras que nunca son el nombre, aunque queden primeras. */
const NOT_NAME = ["id", "order", "ticket", "email", "correo", "mail", "phone", "teléfono", "telefono", "date", "fecha", "status", "estado", "amount", "monto", "url", "código", "codigo"];

/** Una celda de encabezado, para comparar: sin tildes, mayúsculas, comillas ni dos puntos. */
const headerKey = (s: string): string => nameKey(s.replace(/\uFEFF/g, "")).replace(/^["'\s]+|["'\s:*]+$/g, "");

/**
 * Lo que dice una primera fila que es encabezado y no una persona: las pistas
 * de arriba y otras formas que se ven en planillas hechas a mano. Sin esto,
 * "Participantes" o "Nombres y apellidos" entraban al sorteo como una persona
 * más. Van solo palabras que nunca son el dato de una celda: "Guest" o
 * "Attendee" pueden ser el tipo de entrada de alguien, y no están.
 */
const HEADERS = new Set(
  [
    ...NAME_HINTS, ...NOT_NAME,
    "names", "nombre y apellido", "nombre y apellidos", "nombres y apellidos", "apellidos y nombres",
    "apellido", "apellidos", "last name", "surname", "participantes", "asistentes", "invitados", "invitadas",
    "participants", "attendees", "guests", "e-mail", "email address", "correo electrónico",
  ].map(headerKey),
);

/** Palabras que, en la primera línea de una lista suelta, dicen que es el encabezado. */
const HEADER_WORDS = new Set([
  "nombre", "nombres", "name", "names", "apellido", "apellidos",
  "participante", "participantes", "participant", "participants",
  "asistente", "asistentes", "attendee", "attendees",
]);

const isHeaderCell = (c: string): boolean => HEADERS.has(headerKey(c));

/**
 * ¿Este texto es una tabla y no una lista de nombres?
 *
 * Con una sola columna no hay nada que elegir, así que se trata como lista
 * suelta y el flujo de siempre alcanza.
 */
export function looksTabular(text: string): boolean {
  const table = parseTable(text);
  return table !== null && table.columns.length > 1;
}

/**
 * Lee el texto como tabla. Devuelve `null` si no hay nada escrito.
 *
 * Una fila con otro ancho ya no descarta la tabla entera: hasta el QA del 16
 * de octubre de 2026, una sola coma sin comillas ("Mejía, Nicolás" escrito a
 * mano) hacía que el archivo entrara como texto suelto, con el encabezado de
 * participante y los nombres cortados en la coma. Ahora el ancho lo da el
 * encabezado (o el de la mayoría de las filas), una fila corta se completa con
 * celdas vacías, que es lo que hace cualquier planilla, y una larga se arregla
 * si hay una sola forma segura de hacerlo. Si no, se salta y queda anotada.
 */
export function parseTable(text: string): Table | null {
  const clean = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  if (!clean.trim()) return null;

  const delimiter = pickDelimiter(clean);
  const grid = parseRows(clean, delimiter).filter(filled);
  const first = grid[0];
  if (!first) return null;

  const width = expectedWidth(grid);
  const headerDetected = first.cells.length === width && looksLikeHeader(first.cells, grid.slice(1).map((r) => r.cells));
  const data = headerDetected ? grid.slice(1) : grid;
  const kinds = columnKinds(data, width, headerDetected ? nameHintColumn(first.cells) : -1);

  const rows: string[][] = [];
  const skipped: number[] = [];
  for (const r of data) {
    if (r.cells.length === width) rows.push(r.cells);
    // La que no escribió las celdas vacías del final.
    else if (r.cells.length < width) rows.push([...r.cells, ...new Array<string>(width - r.cells.length).fill("")]);
    else {
      const mended = mend(r.cells, width, kinds, delimiter);
      if (mended) rows.push(mended);
      else skipped.push(r.line);
    }
  }

  const columns = Array.from({ length: width }, (_, i) =>
    (headerDetected ? first.cells[i]?.trim() : "") || `Columna ${i + 1}`);
  return { columns, rows, headerDetected, suggested: suggestColumn(columns, rows, headerDetected), skipped };
}

/** Una columna, como texto de una entrada por línea, listo para el protocolo. */
export function columnToText(table: Table, index: number): string {
  return table.rows
    .map((r) => (r[index] ?? "").trim())
    // Las comas dentro de un nombre se cambian por un espacio: el protocolo
    // corta en la primera coma, así que dejarlas perdería medio nombre.
    .map((v) => v.replace(/,/g, " ").replace(/\s+/g, " ").trim())
    .filter((v) => v !== "")
    .join("\n");
}

/**
 * Qué filas entran al sorteo.
 *
 * Un export de Luma trae a todos los inscritos, y el sorteo suele ser entre
 * los que fueron. El filtro elige filas por una columna: las que tienen algo
 * escrito (la hora del check-in) o las que tienen un valor exacto ("approved",
 * "Checked In"). Todo pasa en el navegador, como el resto del archivo.
 */
export interface RowFilter {
  column: number;
  /** El valor que tiene que tener la celda, o `null` para "tiene algo escrito". */
  value: string | null;
}

/** Cabeceras que dicen si la persona fue: el check-in de Luma, la asistencia de otras. */
const PRESENT_HINTS = [
  "checked_in_at", "checked in", "checked_in", "check-in", "check in", "checkin",
  "attended", "attendance", "attendee status", "asistió", "asistio", "asistencia", "presente",
];
/** Valores de una columna de estado que quieren decir que sí fue. */
const PRESENT_VALUE = /^(yes|s[ií]|true|1|x|checked[ _-]?in|attended|presente|asisti[óo])$/i;

const cell = (row: string[], i: number): string => (row[i] ?? "").trim();

/**
 * Los valores de una columna de categorías, como el estado de la inscripción:
 * pocos y repetidos. Una columna de correos o de fechas tiene un valor por
 * fila, y ofrecer cada uno como filtro llenaba el selector de ruido.
 */
function categories(vals: string[]): string[] {
  const filled = vals.filter(Boolean);
  const distinct = [...new Set(filled)];
  return distinct.length >= 2 && distinct.length <= 6 && distinct.length < filled.length ? distinct : [];
}

export function rowPasses(row: string[], f: RowFilter): boolean {
  const v = cell(row, f.column);
  return f.value === null ? v !== "" : v === f.value;
}

/** La misma tabla, con las filas que pasan el filtro. Sin filtro, entera. */
export function filterRows(table: Table, f: RowFilter | null): Table {
  return f ? { ...table, rows: table.rows.filter((r) => rowPasses(r, f)) } : table;
}

/**
 * El filtro que conviene proponer: el de asistencia, si la tabla tiene una
 * columna que lo diga y esa columna de verdad separa a unos de otros. Si todos
 * pasan no hace nada, y si no pasa nadie (el evento todavía no empezó, o nadie
 * usó el check-in) dejaría la lista vacía: en los dos casos, no se propone.
 */
export function suggestFilter(table: Table): RowFilter | null {
  if (!table.headerDetected) return null;
  const col = table.columns.findIndex((c) => PRESENT_HINTS.includes(c.trim().toLowerCase()));
  if (col < 0) return null;
  let f: RowFilter = { column: col, value: null };
  // Una columna de estado ("Attending", "Checked In") tiene pocos valores:
  // se elige el que dice que fue.
  const yes = categories(table.rows.map((r) => cell(r, col))).find((d) => PRESENT_VALUE.test(d));
  if (yes) f = { column: col, value: yes };
  const pass = filterRows(table, f).rows.length;
  return pass > 0 && pass < table.rows.length ? f : null;
}

/**
 * Columnas que nunca sirven de filtro: los nombres, los datos de contacto, los
 * identificadores y el rastreo de campañas. Un export real de Luma trae 35
 * columnas y, sin esto, el selector ofrecía "con algo en first_name".
 */
const NOT_FILTER = /^(first|last|full|display|guest|attendee)?[ _]?name$|^nombres?( completo)?$|^apellidos?$|e-?mail|correo|phone|tel[eé]fono|_id$|^id$|url|click|utm_|amount|currency|coupon|address|survey|referred_by/i;

/**
 * Los filtros que tiene sentido ofrecer, fuera de la columna de nombres: "tiene
 * algo escrito" en las columnas que a veces están vacías, y cada valor en las
 * que tienen pocos distintos, como el estado de la inscripción.
 */
export function filterChoices(table: Table, except: number): RowFilter[] {
  const out: RowFilter[] = [];
  table.columns.forEach((name, c) => {
    if (c === except || (table.headerDetected && NOT_FILTER.test(name.trim()))) return;
    const vals = table.rows.map((r) => cell(r, c));
    const empties = vals.filter((v) => v === "").length;
    if (empties > 0 && empties < vals.length) out.push({ column: c, value: null });
    for (const v of categories(vals)) out.push({ column: c, value: v });
  });
  return out;
}

/* ------------------------------------------------ la ventana de importar */

/** Una columna por su cabecera, sin importar mayúsculas. -1 si no está. */
export function findColumn(table: Table, hints: readonly string[]): number {
  if (!table.headerDetected) return -1;
  return table.columns.findIndex((c) => hints.includes(c.trim().toLowerCase()));
}

/** La columna que dice si la persona fue (el check-in de Luma). */
export const presentColumn = (t: Table): number => findColumn(t, PRESENT_HINTS);
/** El estado de la inscripción: aprobado, pendiente, invitado, rechazado. */
export const statusColumn = (t: Table): number =>
  findColumn(t, ["approval_status", "status", "estado", "registration status", "rsvp"]);
/** El correo: solo para distinguir dos personas con el mismo nombre. */
export const emailColumn = (t: Table): number =>
  findColumn(t, ["email", "e-mail", "email address", "correo", "correo electrónico", "mail"]);

/** De dónde parece venir el archivo, para decirlo en la ventana. */
export function detectSource(t: Table): "luma" | null {
  if (presentColumn(t) < 0 || findColumn(t, ["checked_in_at"]) < 0) return null;
  return findColumn(t, ["guest_id", "api_id", "approval_status", "qr_code_url"]) >= 0 ? "luma" : null;
}

/** Los valores del estado que quieren decir que la inscripción vale. */
const APPROVED_VALUE = /^(approved|aprobad[oa]|confirmed|confirmad[oa]|going|attending)$/i;

/** Los atajos de "¿quiénes entran?", con cuántas filas deja cada uno. */
export interface Preset {
  id: "came" | "approved" | "all";
  filter: RowFilter | null;
  count: number;
}

export function presets(t: Table): Preset[] {
  const out: Preset[] = [];
  const came = suggestFilter(t);
  if (came) out.push({ id: "came", filter: came, count: filterRows(t, came).rows.length });
  const st = statusColumn(t);
  if (st >= 0) {
    const yes = categories(t.rows.map((r) => cell(r, st))).find((v) => APPROVED_VALUE.test(v));
    if (yes) {
      const f: RowFilter = { column: st, value: yes };
      const n = filterRows(t, f).rows.length;
      if (n > 0 && n < t.rows.length) out.push({ id: "approved", filter: f, count: n });
    }
  }
  out.push({ id: "all", filter: null, count: t.rows.length });
  return out;
}

/** Partículas que van en minúscula en medio de un nombre. */
const PARTICLES = new Set(["de", "del", "la", "las", "los", "y", "e", "da", "das", "do", "dos", "van", "von", "di"]);

/**
 * Mayúsculas de nombre para lo que llegó todo en minúsculas o todo en
 * mayúsculas ("juan perez", "MARIA QUISPE"), que en la pantalla grande se ve
 * descuidado. Un nombre con mayúsculas mezcladas se deja como está: "McDonald"
 * o "de la Cruz" los escribió así la persona.
 */
export function fixCase(name: string): string {
  const letters = name.replace(/[^\p{L}]/gu, "");
  if (letters.length < 2) return name;
  const low = name.toLocaleLowerCase("es");
  if (name !== low && name !== name.toLocaleUpperCase("es")) return name;
  let first = true;
  return low
    .split(/(\s+|-)/)
    .map((w) => {
      if (!/\p{L}/u.test(w)) return w;
      const keep = !first && PARTICLES.has(w);
      first = false;
      return keep ? w : w.charAt(0).toLocaleUpperCase("es") + w.slice(1);
    })
    .join("");
}

/**
 * Una celda de nombre, limpia: sin los caracteres que no se ven, sin comas
 * (el protocolo corta ahí) ni espacios de más.
 */
export function cleanName(raw: string): string {
  return stripInvisibles(raw).replace(/,/g, " ").replace(/\s+/g, " ").trim();
}

/** Para comparar nombres: sin invisibles, sin tildes, sin mayúsculas, sin espacios de más. */
export function nameKey(name: string): string {
  return withoutInvisibles(name).normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
}

export interface Built {
  /** Los nombres que entran, uno por participante, en el orden del archivo. */
  names: string[];
  /** Por fila: el nombre con que entra, o "" si no entra. */
  final: string[];
  /** Grupos de filas marcadas que tienen el mismo nombre (por `nameKey`). */
  dupes: number[][];
  /** Cuántas filas cambiaron por las mayúsculas. */
  cased: number;
  /** De cuántas filas marcadas se sacaron caracteres que no se ven. */
  invisibles: number;
}

/**
 * La lista que sale de la ventana. Dos filas marcadas con el mismo nombre son,
 * casi siempre, la misma persona inscrita dos veces: por defecto entra una. Si
 * quien organiza dice que son dos personas, se numeran ("Ana Quispe (2)"),
 * porque la lista canónica funde los duplicados exactos (protocolo §1).
 *
 * Se decide por nombre y no para toda la lista: en un mismo archivo puede
 * haber dos "Diego Rojas" que son dos personas y una "Ana Quispe" inscrita dos
 * veces. `numberDupes` dice cuáles se numeran: todos, ninguno, o los nombres
 * de ese conjunto (por `nameKey`).
 */
export function buildList(
  t: Table,
  nameCol: number,
  picked: readonly boolean[],
  opts: { fixCase: boolean; numberDupes: boolean | ReadonlySet<string> },
): Built {
  const final = t.rows.map(() => "");
  const groups = new Map<string, number[]>();
  let cased = 0;
  let invisibles = 0;
  t.rows.forEach((r, i) => {
    if (!picked[i]) return;
    const raw = cell(r, nameCol);
    if (stripInvisibles(raw) !== raw) invisibles++;
    let n = cleanName(raw);
    if (opts.fixCase) {
      const f = fixCase(n);
      if (f !== n) cased++;
      n = f;
    }
    if (n.length < 2) return;
    final[i] = n;
    const k = nameKey(n);
    const g = groups.get(k);
    if (g) g.push(i);
    else groups.set(k, [i]);
  });
  const dupes: number[][] = [];
  for (const [k, g] of groups) {
    if (g.length < 2) continue;
    dupes.push(g);
    const split = opts.numberDupes === true || (opts.numberDupes !== false && opts.numberDupes.has(k));
    const base = final[g[0] as number] as string;
    g.slice(1).forEach((i, n) => {
      final[i] = split ? `${base} (${n + 2})` : "";
    });
  }
  return { names: final.filter(Boolean), final, dupes, cased, invisibles };
}

/** "ana@example.org" → "a•••@example.org": alcanza para distinguir a dos Anas. */
export function maskEmail(email: string): string {
  const [user, domain] = email.trim().split("@");
  if (!user || !domain) return "";
  return `${user.charAt(0)}•••@${domain}`;
}

/**
 * Dos personas con el mismo nombre suelen tener el mismo correo enmascarado:
 * "diego.rojas@example.com" y "drojas@example.com" quedan los dos en
 * "d•••@example.com", y en la ventana parecían la misma persona (QA, 16 de
 * octubre de 2026). Para cada fila repetida cuyo correo enmascarado es igual
 * al de la primera de su grupo, dice si el correo completo es el mismo o es
 * otro. Se compara en el navegador y del correo no se muestra nada más.
 *
 * No decide nada: una persona puede inscribirse con dos correos, y una
 * familia puede compartir uno. Lo decide quien organiza.
 */
export function mailNotes(t: Table, emailCol: number, dupes: readonly number[][]): Map<number, "same" | "other"> {
  const out = new Map<number, "same" | "other">();
  if (emailCol < 0) return out;
  const mail = (i: number): string => cell(t.rows[i] ?? [], emailCol).toLowerCase();
  for (const g of dupes) {
    const first = mail(g[0] as number);
    const mask = maskEmail(first);
    if (!mask) continue;
    for (const i of g.slice(1)) {
      if (maskEmail(mail(i)) === mask) out.set(i, mail(i) === first ? "same" : "other");
    }
  }
  return out;
}

/* ------------------------------------------------ el archivo, antes de la tabla */

/** Firmas de archivos que no son texto: zip (xlsx, ods), Office viejo (xls) y PDF. */
const BINARY = [
  [0x50, 0x4b, 0x03, 0x04],
  [0xd0, 0xcf, 0x11, 0xe0],
  [0x25, 0x50, 0x44, 0x46],
];

/**
 * El texto de un archivo, en la codificación que traiga.
 *
 * Excel en Windows guarda el CSV en ANSI (Windows-1252) salvo que se elija
 * "CSV UTF-8", y leerlo como UTF-8 dejaba "Mar�a" en vez de "María" (QA, 16
 * de octubre de 2026). Con la marca del principio (BOM) no hay que adivinar:
 * UTF-8, o UTF-16, que es lo que guarda Excel como "Texto Unicode". Sin marca,
 * UTF-16 se reconoce por los ceros. Si no, es UTF-8 solo si es UTF-8 válido,
 * y si no, Windows-1252, que para el castellano tiene las mismas tildes y
 * eñes que Latin-1. Los finales de línea quedan en `\n`: Excel en Mac
 * separaba las filas con un retorno de carro solo.
 *
 * Devuelve `null` si no es texto: una planilla de Excel o un PDF soltados
 * sobre la sección llenaban la lista de basura.
 */
export function decodeText(bytes: Uint8Array): string | null {
  const b = bytes;
  const decode = (encoding: string, from = 0): string => new TextDecoder(encoding).decode(b.subarray(from));
  let text: string;
  if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) text = decode("utf-8", 3);
  else if (b[0] === 0xff && b[1] === 0xfe) text = decode("utf-16le", 2);
  else if (b[0] === 0xfe && b[1] === 0xff) text = decode("utf-16be", 2);
  else if (BINARY.some((sig) => sig.every((x, i) => b[i] === x))) return null;
  else {
    const wide = utf16Order(b);
    if (wide) text = decode(wide);
    // Un cero que no es de UTF-16 es de un archivo binario.
    else if (b.includes(0)) return null;
    else {
      try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(b);
      } catch {
        text = windows1252(b);
      }
    }
  }
  return text.replace(/\r\n?/g, "\n");
}

/**
 * Windows-1252 se parece a Latin-1 salvo de 0x80 a 0x9F, donde trae el euro,
 * las comillas tipográficas y la raya que pone Excel. Va a mano porque
 * `TextDecoder("windows-1252")` en Node lo lee como Latin-1, y las pruebas
 * tienen que decodificar lo mismo que el navegador.
 */
const CP1252 = [
  0x20ac, 0x81, 0x201a, 0x192, 0x201e, 0x2026, 0x2020, 0x2021, 0x2c6, 0x2030, 0x160, 0x2039, 0x152, 0x8d, 0x17d, 0x8f,
  0x90, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x2dc, 0x2122, 0x161, 0x203a, 0x153, 0x9d, 0x17e, 0x178,
];

function windows1252(b: Uint8Array): string {
  const codes = Array.from(b, (x) => (x >= 0x80 && x < 0xa0 ? (CP1252[x - 0x80] as number) : x));
  let s = "";
  for (let i = 0; i < codes.length; i += 8192) s += String.fromCharCode(...codes.slice(i, i + 8192));
  return s;
}

/** UTF-16 sin BOM: en texto latino, uno de cada dos bytes es cero. */
function utf16Order(b: Uint8Array): "utf-16le" | "utf-16be" | null {
  const n = Math.min(b.length, 4096) & ~1;
  if (n < 4) return null;
  let even = 0;
  let odd = 0;
  for (let i = 0; i < n; i += 2) {
    if (b[i] === 0) even++;
    if (b[i + 1] === 0) odd++;
  }
  const pairs = n / 2;
  if (odd > pairs * 0.6 && even < pairs * 0.1) return "utf-16le";
  if (even > pairs * 0.6 && odd < pairs * 0.1) return "utf-16be";
  return null;
}

/**
 * Una lista suelta, de un nombre por línea, que trae arriba el encabezado de
 * su columna: "Nombre", "Participantes", "Nombres y apellidos". Sin esto el
 * encabezado entraba al sorteo como una persona más (QA, 16 de octubre de
 * 2026). Devuelve la lista sin esa línea y lo que decía, o la lista como
 * estaba y `null` si la primera línea es un nombre.
 */
export function dropListHeader(text: string): { text: string; header: string | null } {
  const lines = text.split(/\r\n?|\n/);
  const at = lines.findIndex((l) => l.trim() !== "");
  const first = lines[at];
  if (first === undefined || !isHeaderLine(first)) return { text, header: null };
  const header = first.replace(/\uFEFF/g, "").trim().replace(/^"(.*)"$/, "$1").trim();
  return { text: lines.slice(at + 1).join("\n"), header };
}

/**
 * ¿Esta línea es el encabezado de una columna de nombres? Lo es si dice
 * exactamente uno de los encabezados conocidos o, en pocas palabras y sin
 * números, nombra la columna ("Nombre del participante"). Con un número no:
 * "Participante 1" es un nombre de prueba, no un encabezado.
 */
function isHeaderLine(line: string): boolean {
  const k = headerKey(line);
  if (!k || /\d/.test(k)) return false;
  if (HEADERS.has(k)) return true;
  const words = k.split(/[^\p{L}]+/u).filter(Boolean);
  return words.length <= 6 && words.some((w) => HEADER_WORDS.has(w));
}

/**
 * El separador que mejor parte el texto en columnas: el que deja más filas
 * del mismo ancho y, entre esos, el que da más columnas. Que una fila tenga
 * otro ancho ya no lo descarta. Sin separador que dé más de una columna,
 * sigue siendo una lista de nombres, y la coma es tan buena como cualquiera.
 */
function pickDelimiter(text: string): string {
  let best: { d: string; width: number; fit: number } | null = null;
  for (const d of DELIMITERS) {
    const rows = parseRows(text, d).filter(filled);
    const width = expectedWidth(rows);
    if (width < 2) continue;
    const fit = rows.filter((r) => r.cells.length === width).length / rows.length;
    if (!best || fit > best.fit || (fit === best.fit && width > best.width)) best = { d, width, fit };
  }
  return best?.d ?? ",";
}

/** Una fila del archivo, con la línea donde empieza (desde 1) para poder decir cuál falló. */
interface Row {
  cells: string[];
  line: number;
}

const filled = (r: Row): boolean => r.cells.some((c) => c.trim() !== "");

/**
 * Parser de CSV según RFC 4180: campos entre comillas pueden tener el
 * separador adentro, y `""` es una comilla literal.
 *
 * Una comilla que abre y nunca cierra se tragaba el resto del archivo en una
 * sola celda: se vuelve a leer tomándola como una comilla suelta.
 */
function parseRows(text: string, delimiter: string): Row[] {
  const rows: Row[] = [];
  let cells: string[] = [];
  let field = "";
  let quoted = false;
  let quoteAt = -1;
  let line = 1;
  let start = 1;

  for (let i = 0; i < text.length; i++) {
    const c = text[i] as string;
    if (c === "\n") line++;
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"' && field.trim() === "") {
      quoted = true;
      quoteAt = i;
      field = "";
    } else if (c === delimiter) {
      cells.push(field);
      field = "";
    } else if (c === "\n") {
      cells.push(field);
      rows.push({ cells, line: start });
      cells = [];
      field = "";
      start = line;
    } else if (c !== "\r") {
      field += c;
    }
  }
  if (quoted) return parseRows(text.slice(0, quoteAt) + text.slice(quoteAt + 1), delimiter);
  cells.push(field);
  rows.push({ cells, line: start });
  return rows;
}

/**
 * Cuántas columnas tiene la tabla: las del encabezado, si la primera fila lo
 * es, y si no, el ancho de la mayoría de las filas. Con empate, el menor: ante
 * la duda, menos columnas, que se parece más a una lista de nombres.
 */
function expectedWidth(rows: readonly Row[]): number {
  const first = rows[0]?.cells ?? [];
  if (first.length > 1 && first.some(isHeaderCell)) return first.length;
  const seen = new Map<number, number>();
  for (const r of rows) seen.set(r.cells.length, (seen.get(r.cells.length) ?? 0) + 1);
  let width = 0;
  let most = 0;
  for (const [w, n] of seen) {
    if (n > most || (n === most && w < width)) {
      width = w;
      most = n;
    }
  }
  return width;
}

/**
 * Lo que suele tener cada columna, mirando las filas sanas: nada, correos,
 * palabras sueltas sin espacios (códigos, fechas, estados) o texto libre.
 */
type Kind = "empty" | "email" | "token" | "free";
const EMAIL = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;
const TOKEN = /^[^\s,;]+$/;

function kindOf(values: readonly string[]): Kind {
  const vals = values.map((v) => v.trim()).filter(Boolean);
  if (vals.length === 0) return "empty";
  if (vals.every((v) => EMAIL.test(v))) return "email";
  if (vals.every((v) => TOKEN.test(v))) return "token";
  return "free";
}

/** ¿Este valor puede ir en una columna de esa clase? Vacío puede ir en cualquiera. */
function fits(kind: Kind, value: string): boolean {
  const v = value.trim();
  if (kind === "free" || v === "") return true;
  if (kind === "empty") return false;
  return (kind === "email" ? EMAIL : TOKEN).test(v);
}

/**
 * La clase de cada columna. La de nombres, si el encabezado la nombra, es
 * siempre texto libre aunque las filas sanas tengan nombres de una palabra:
 * es justo donde suele estar la coma sin comillas ("Mejía, Nicolás").
 */
function columnKinds(rows: readonly Row[], width: number, names: number): Kind[] {
  const sane = rows.filter((r) => r.cells.length === width);
  return Array.from({ length: width }, (_, c) => (c === names ? "free" : kindOf(sane.map((r) => r.cells[c] ?? ""))));
}

/** La columna que el encabezado llama nombre, sin adivinar por forma. -1 si ninguna. */
function nameHintColumn(header: readonly string[]): number {
  const keys = header.map(headerKey);
  for (const hint of NAME_HINTS) {
    const at = keys.indexOf(headerKey(hint));
    if (at >= 0) return at;
  }
  return -1;
}

/**
 * Una fila con más celdas que columnas casi siempre es una coma sin comillas
 * dentro de un campo. Se prueba juntar las celdas de más en cada columna de
 * texto libre, y se acepta solo si una única forma deja cada columna con lo
 * que suele tener: correos donde hay correos, códigos donde hay códigos. Si
 * hay dos formas posibles (el nombre y la dirección, los dos texto libre), no
 * se adivina: la fila se salta y la ventana lo avisa.
 */
function mend(cells: readonly string[], width: number, kinds: readonly Kind[], delimiter: string): string[] | null {
  const extra = cells.length - width;
  let found: string[] | null = null;
  for (let c = 0; c < width; c++) {
    if (kinds[c] !== "free") continue;
    const row = [...cells.slice(0, c), cells.slice(c, c + extra + 1).join(delimiter), ...cells.slice(c + extra + 1)];
    if (!row.every((v, i) => fits(kinds[i] ?? "free", v))) continue;
    if (found) return null;
    found = row;
  }
  return found;
}

/**
 * La primera fila es cabecera si nombra columnas en vez de contener datos.
 * Un archivo que solo trae el encabezado también: es una tabla sin filas, no
 * una fila con "Nombre" como participante.
 */
function looksLikeHeader(first: string[], rest: string[][]): boolean {
  if (first.some(isHeaderCell)) return true;
  if (rest.length === 0) return false;
  // Si la primera fila no tiene números y las siguientes sí, es cabecera.
  const hasDigits = (r: string[]): boolean => r.some((c) => /\d/.test(c));
  return !hasDigits(first) && rest.slice(0, 3).some(hasDigits);
}

/** Qué columna tiene los nombres: primero por cabecera, si no por forma. */
function suggestColumn(columns: string[], rows: string[][], headerDetected: boolean): number {
  if (headerDetected) {
    const lower = columns.map((c) => c.trim().toLowerCase());
    for (const hint of NAME_HINTS) {
      const exact = lower.indexOf(hint);
      if (exact >= 0) return exact;
    }
    const partial = lower.findIndex(
      (c) => NAME_HINTS.some((h) => c.includes(h)) && !NOT_NAME.some((n) => c === n),
    );
    if (partial >= 0) return partial;
  }
  // Sin pistas: la columna con más texto de aspecto humano y menos repetidos.
  let best = 0;
  let bestScore = -Infinity;
  for (let i = 0; i < columns.length; i++) {
    const values = rows.slice(0, 40).map((r) => (r[i] ?? "").trim()).filter(Boolean);
    if (values.length === 0) continue;
    const letters = values.filter((v) => /\p{L}{2,}/u.test(v) && !/@/.test(v)).length / values.length;
    const digits = values.filter((v) => /^\s*[\d.\-/]+\s*$/.test(v)).length / values.length;
    const unique = new Set(values).size / values.length;
    const score = letters * 2 + unique - digits * 3;
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
}
