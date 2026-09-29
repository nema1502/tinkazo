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

export interface Table {
  /** Nombres de las columnas, o `Columna 1`, `Columna 2`… si no hay cabecera. */
  columns: string[];
  /** Filas de datos, ya sin la cabecera. */
  rows: string[][];
  headerDetected: boolean;
  /** Índice de la columna que probablemente tenga los nombres. */
  suggested: number;
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

/** Lee el texto como tabla. Devuelve `null` si no parece una. */
export function parseTable(text: string): Table | null {
  const clean = text.replace(/^﻿/, "").trim();
  if (!clean) return null;

  const delimiter = pickDelimiter(clean);
  if (!delimiter) return null;

  const grid = parseRows(clean, delimiter).filter((r) => r.some((c) => c.trim() !== ""));
  if (grid.length === 0) return null;

  // Todas las filas deben tener el mismo ancho; si no, no es una tabla.
  const width = grid[0]?.length ?? 0;
  if (width < 1 || !grid.every((r) => r.length === width)) return null;

  const first = grid[0] as string[];
  const headerDetected = looksLikeHeader(first, grid.slice(1));
  const columns = headerDetected
    ? first.map((c, i) => c.trim() || `Columna ${i + 1}`)
    : first.map((_, i) => `Columna ${i + 1}`);
  const rows = headerDetected ? grid.slice(1) : grid;

  return { columns, rows, headerDetected, suggested: suggestColumn(columns, rows, headerDetected) };
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

/** Una celda de nombre, limpia: sin comas (el protocolo corta ahí) ni espacios de más. */
export function cleanName(raw: string): string {
  return raw.replace(/,/g, " ").replace(/\s+/g, " ").trim();
}

/** Para comparar nombres: sin tildes, sin mayúsculas, sin espacios de más. */
export function nameKey(name: string): string {
  return name.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
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
}

/**
 * La lista que sale de la ventana. Dos filas marcadas con el mismo nombre son,
 * casi siempre, la misma persona inscrita dos veces: por defecto entra una. Si
 * quien organiza dice que son dos personas, se numeran ("Ana Quispe (2)"),
 * porque la lista canónica funde los duplicados exactos (protocolo §1).
 */
export function buildList(
  t: Table,
  nameCol: number,
  picked: readonly boolean[],
  opts: { fixCase: boolean; numberDupes: boolean },
): Built {
  const final = t.rows.map(() => "");
  const groups = new Map<string, number[]>();
  let cased = 0;
  t.rows.forEach((r, i) => {
    if (!picked[i]) return;
    let n = cleanName(cell(r, nameCol));
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
  const dupes = [...groups.values()].filter((g) => g.length > 1);
  for (const g of dupes) {
    const base = final[g[0] as number] as string;
    g.slice(1).forEach((i, k) => {
      final[i] = opts.numberDupes ? `${base} (${k + 2})` : "";
    });
  }
  return { names: final.filter(Boolean), final, dupes, cased };
}

/** "ana@example.org" → "a•••@example.org": alcanza para distinguir a dos Anas. */
export function maskEmail(email: string): string {
  const [user, domain] = email.trim().split("@");
  if (!user || !domain) return "";
  return `${user.charAt(0)}•••@${domain}`;
}

/** El separador que parte el texto en más columnas de forma consistente. */
function pickDelimiter(text: string): string | null {
  let best: { d: string; width: number } | null = null;
  for (const d of DELIMITERS) {
    const rows = parseRows(text, d).filter((r) => r.some((c) => c.trim() !== ""));
    if (rows.length === 0) continue;
    const width = rows[0]?.length ?? 0;
    if (width < 2) continue;
    if (!rows.every((r) => r.length === width)) continue;
    if (!best || width > best.width) best = { d, width };
  }
  // Sin separador que dé más de una columna, sigue siendo una lista de nombres.
  return best?.d ?? (parseRows(text, ",").length > 0 ? "," : null);
}

/**
 * Parser de CSV según RFC 4180: campos entre comillas pueden tener el
 * separador adentro, y `""` es una comilla literal.
 */
function parseRows(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i] as string;
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
      field = "";
    } else if (c === delimiter) {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c !== "\r") {
      field += c;
    }
  }
  row.push(field);
  rows.push(row);
  return rows;
}

/** La primera fila es cabecera si nombra columnas en vez de contener datos. */
function looksLikeHeader(first: string[], rest: string[][]): boolean {
  if (rest.length === 0) return false;
  const cells = first.map((c) => c.trim().toLowerCase());
  if (cells.some((c) => NAME_HINTS.includes(c) || NOT_NAME.includes(c))) return true;
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
