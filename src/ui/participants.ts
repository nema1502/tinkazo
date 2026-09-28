import { $, esc } from "../dom";
import { SAMPLE, app, avatar } from "../state";
import { canonicalList } from "../protocol/canonical";
import { T, getLang } from "../i18n";
import { type RowFilter, type Table, columnToText, filterChoices, filterRows, parseTable, suggestFilter } from "./csv";

/** Lista canónica a partir del textarea (protocolo §1). */
export function parseNames(): string[] {
  return canonicalList($<HTMLTextAreaElement>("ta").value);
}

export function renderNames(): void {
  const names = parseNames();
  $("names").innerHTML = names
    .map((n) => `<i><img src="${avatar(n, 44)}" alt="" loading="lazy" />${esc(n)}</i>`)
    .join("");
  $<HTMLButtonElement>("btn-freeze").disabled = names.length < 2 || !!app.frozen;
  // Un boton apagado sin explicacion es lo que mas frena a quien recien llega.
  $("freeze-hint").style.display = names.length < 2 && !app.frozen ? "block" : "none";
  $("free-rule").style.display = app.frozen ? "none" : "block";
}

export function loadSample(): void {
  setList(SAMPLE.join("\n"));
}

/** La tabla del último archivo, mientras el organizador elige la columna. */
let table: Table | null = null;
/** Qué columna tiene los nombres y qué filas entran. */
let nameCol = 0;
let filters: RowFilter[] = [];
let filter: RowFilter | null = null;

export function bindParticipants(): void {
  $("ta").addEventListener("input", () => {
    // Si edita a mano, manda lo que escribió: el selector ya no aplica.
    hidePicker();
    renderNames();
  });
  $("csv-col").addEventListener("change", (e) => {
    if (!table) return;
    nameCol = Number((e.target as HTMLSelectElement).value);
    // La columna de nombres no puede ser la del filtro.
    if (filter?.column === nameCol) filter = null;
    fillFilters(table);
    applyTable();
  });
  $("csv-filter").addEventListener("change", (e) => {
    if (!table) return;
    const i = Number((e.target as HTMLSelectElement).value);
    filter = i >= 0 ? (filters[i] ?? null) : null;
    applyTable();
  });
  $<HTMLInputElement>("csv").addEventListener("change", async (e) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    loadFile(await file.text());
    // Permite volver a subir el mismo archivo después de corregirlo.
    input.value = "";
  });
}

/**
 * Carga el contenido de un archivo, que rara vez es una lista limpia.
 *
 * Un export de Luma, Meetup o Eventbrite trae varias columnas y la primera
 * suele ser un identificador de orden, no el nombre. Acá se elige la columna,
 * se sacan las comas de adentro de los nombres, y recién entonces el texto
 * entra al protocolo. La lista canónica no cambia: sigue recibiendo un nombre
 * por línea, como siempre.
 */
export function loadFile(raw: string): void {
  const parsed = parseTable(raw);
  if (!parsed || parsed.columns.length < 2) {
    hidePicker();
    setList(raw);
    return;
  }
  table = parsed;
  nameCol = parsed.suggested;
  // Si el archivo dice quién fue, entran los que fueron.
  filter = suggestFilter(parsed);
  if (filter?.column === nameCol) filter = null;
  showPicker(parsed);
  applyTable();
}

/** La columna elegida, de las filas que entran, al textarea. */
function applyTable(): void {
  if (!table) return;
  const kept = filterRows(table, filter);
  const lang = T[getLang()];
  $("csv-note").textContent = filter
    ? `${lang.csvRows(table.rows.length)} · ${lang.csvIn(kept.rows.length)}`
    : lang.csvRows(table.rows.length);
  setList(columnToText(kept, nameCol), false);
}

/** Las opciones del filtro, con cuántas filas deja cada una. */
function fillFilters(t: Table): void {
  filters = filterChoices(t, nameCol);
  const lang = T[getLang()];
  const count = (f: RowFilter): number => filterRows(t, f).rows.length;
  const label = (f: RowFilter): string => {
    const col = t.columns[f.column] ?? "";
    return f.value === null ? lang.csvHas(col, count(f)) : lang.csvIs(col, f.value, count(f));
  };
  const select = $<HTMLSelectElement>("csv-filter");
  select.innerHTML =
    `<option value="-1">${esc(lang.csvAll(t.rows.length))}</option>` +
    filters.map((f, i) => `<option value="${i}">${esc(label(f))}</option>`).join("");
  const at = filter ? filters.findIndex((f) => f.column === filter?.column && f.value === filter?.value) : -1;
  if (at < 0) filter = null;
  select.value = String(at);
}

function setList(text: string, clearPicker = true): void {
  if (clearPicker) hidePicker();
  $<HTMLTextAreaElement>("ta").value = text;
  renderNames();
}

function showPicker(parsed: Table): void {
  const select = $<HTMLSelectElement>("csv-col");
  select.innerHTML = parsed.columns
    .map((c, i) => `<option value="${i}">${esc(c)}</option>`)
    .join("");
  select.value = String(parsed.suggested);
  fillFilters(parsed);
  $("csv-pick").style.display = "";
}

function hidePicker(): void {
  table = null;
  filter = null;
  $("csv-pick").style.display = "none";
}
