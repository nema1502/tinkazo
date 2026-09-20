import { $, esc } from "../dom";
import { SAMPLE, app, avatar } from "../state";
import { canonicalList } from "../protocol/canonical";
import { T, getLang } from "../i18n";
import { type Table, columnToText, parseTable } from "./csv";

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
}

export function loadSample(): void {
  setList(SAMPLE.join("\n"));
}

/** La tabla del último archivo, mientras el organizador elige la columna. */
let table: Table | null = null;

export function bindParticipants(): void {
  $("ta").addEventListener("input", () => {
    // Si edita a mano, manda lo que escribió: el selector ya no aplica.
    hidePicker();
    renderNames();
  });
  $("csv-col").addEventListener("change", (e) => {
    if (!table) return;
    setList(columnToText(table, Number((e.target as HTMLSelectElement).value)), false);
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
  showPicker(parsed);
  setList(columnToText(parsed, parsed.suggested), false);
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
  $("csv-note").textContent = T[getLang()].csvRows(parsed.rows.length);
  $("csv-pick").style.display = "";
}

function hidePicker(): void {
  table = null;
  $("csv-pick").style.display = "none";
}
