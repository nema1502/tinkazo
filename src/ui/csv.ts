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
