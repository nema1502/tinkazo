import { $, esc } from "../dom";
import { SAMPLE, app, avatar } from "../state";
import { canonicalList } from "../protocol/canonical";
import { T, getLang, onLangChange } from "../i18n";
import { parseTable } from "./csv";
import { type ImportResult, type ImportState, initialState, openImporter } from "./importer";

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

/**
 * El último archivo importado, con lo que se eligió en la ventana: así
 * "Editar selección" la vuelve a abrir como quedó.
 */
let imported: ImportState | null = null;
let lastResult: ImportResult | null = null;

export function bindParticipants(): void {
  $("ta").addEventListener("input", () => {
    // Si edita a mano, manda lo que escribió: el resumen del archivo ya no aplica.
    hideSummary();
    renderNames();
  });
  const onFile = async (file: File | undefined): Promise<void> => {
    if (!file || app.frozen) return;
    loadFile(await file.text(), file.name);
  };
  for (const id of ["csv", "csv-luma"]) {
    $<HTMLInputElement>(id).addEventListener("change", async (e) => {
      const input = e.target as HTMLInputElement;
      await onFile(input.files?.[0]);
      // Permite volver a subir el mismo archivo después de corregirlo.
      input.value = "";
    });
  }
  $("csv-edit").addEventListener("click", () => {
    if (imported) openImporter(imported, apply);
  });

  // Soltar el archivo sobre la sección, que es lo primero que se intenta.
  const zone = $("sec-participants");
  let depth = 0;
  zone.addEventListener("dragenter", (e) => {
    if (!e.dataTransfer?.types.includes("Files")) return;
    depth++;
    zone.classList.add("drop-on");
  });
  zone.addEventListener("dragleave", () => {
    depth = Math.max(0, depth - 1);
    if (!depth) zone.classList.remove("drop-on");
  });
  zone.addEventListener("dragover", (e) => {
    if (e.dataTransfer?.types.includes("Files")) e.preventDefault();
  });
  zone.addEventListener("drop", (e) => {
    const file = e.dataTransfer?.files?.[0];
    if (!file) return;
    e.preventDefault();
    depth = 0;
    zone.classList.remove("drop-on");
    void onFile(file);
  });
}

/**
 * Carga el contenido de un archivo, que rara vez es una lista limpia.
 *
 * Una tabla (Luma, Meetup, Eventbrite, una planilla) abre la ventana de
 * importar: ahí se elige la columna, quiénes entran y se marca a mano. Una
 * lista suelta, de un nombre por línea, va directo al texto como siempre. La
 * lista canónica no cambia: sigue recibiendo un nombre por línea.
 */
export function loadFile(raw: string, fileName = "lista.csv"): void {
  const parsed = parseTable(raw);
  if (!parsed || parsed.columns.length < 2) {
    hideSummary();
    setList(raw);
    return;
  }
  imported = initialState(parsed, fileName);
  openImporter(imported, apply);
}

/** Lo que eligió en la ventana, al texto, con un resumen para volver a abrirla. */
function apply(r: ImportResult): void {
  lastResult = r;
  setList(r.names.join("\n"), false);
  showSummary();
}

function showSummary(): void {
  if (!lastResult) return;
  const L = T[getLang()];
  const r = lastResult;
  $("csv-note").textContent = L.impSummary(r.source === "luma", r.picked, r.total, r.mode, r.hand);
  $("csv-pick").style.display = "";
}

// El resumen se vuelve a escribir al cambiar de idioma.
onLangChange(() => {
  if (lastResult) showSummary();
});

function setList(text: string, clearSummary = true): void {
  if (clearSummary) hideSummary();
  $<HTMLTextAreaElement>("ta").value = text;
  renderNames();
}

function hideSummary(): void {
  lastResult = null;
  $("csv-pick").style.display = "none";
}
