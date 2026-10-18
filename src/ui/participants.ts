import { $, esc } from "../dom";
import { SAMPLE, app, avatar } from "../state";
import { canonicalList } from "../protocol/canonical";
import { type Dict, T, getLang, onLangChange } from "../i18n";
import { decodeText, dropListHeader, parseTable } from "./csv";
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
  const ta = $<HTMLTextAreaElement>("ta");
  ta.addEventListener("input", () => {
    // Si edita a mano, manda lo que escribió: el resumen del archivo ya no aplica.
    hideSummary();
    quitarAvisos();
    renderNames();
  });
  // Pegar una tabla entera es lo mismo que subirla: abre la ventana de
  // importar. Y una columna copiada de una planilla con su encabezado entra
  // sin el encabezado. Solo cuando lo pegado es toda la lista: con algo ya
  // escrito, pegar agrega como siempre, y una lista suelta se pega igual que
  // antes, y se puede deshacer.
  ta.addEventListener("paste", (e) => {
    const text = e.clipboardData?.getData("text/plain") ?? "";
    const toda = !ta.value.trim() || (ta.selectionStart === 0 && ta.selectionEnd === ta.value.length);
    if (app.frozen || !toda || !text.trim() || !pideImportar(text)) return;
    e.preventDefault();
    loadFile(text, "");
  });
  // El aviso vive desde el principio, vacío: un lector de pantalla anuncia los
  // cambios de una región que ya estaba, no de una que aparece con el texto.
  const nota = document.createElement("p");
  nota.id = "csv-aviso";
  // El mismo recuadro con que "otro premio" dice quién salió de la lista.
  nota.className = "again-note";
  nota.setAttribute("role", "status");
  nota.style.display = "none";
  $("again-note").before(nota);

  const onFile = async (file: File | undefined): Promise<void> => {
    if (!file || app.frozen) return;
    // Los bytes y no `file.text()`, que lee todo como UTF-8: un CSV de Excel
    // en Windows llegaba con "Mar�a".
    const text = decodeText(new Uint8Array(await file.arrayBuffer()));
    if (text === null) avisar((L) => L.impNotText(file.name));
    else loadFile(text, file.name);
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
 * lista suelta, de un nombre por línea, va directo al texto como siempre, sin
 * el encabezado de la columna si lo trae. La lista canónica no cambia: sigue
 * recibiendo un nombre por línea.
 *
 * Un archivo sin nombres (vacío, o solo el encabezado) no toca la lista que
 * había: la borraba sin decir nada.
 *
 * `fileName` vacío es texto pegado.
 */
export function loadFile(raw: string, fileName = "lista.csv"): void {
  callarAviso();
  const parsed = parseTable(raw);
  if (parsed && parsed.columns.length > 1) {
    if (parsed.rows.length === 0) {
      avisar((L) => L.impNoNames(fileName));
      return;
    }
    imported = initialState(parsed, fileName);
    openImporter(imported, apply);
    return;
  }
  const { text, header } = dropListHeader(raw);
  if (canonicalList(text).length === 0) {
    avisar((L) => L.impNoNames(fileName));
    return;
  }
  setList(text);
  if (header) avisar((L) => L.impHeaderOut(header));
}

/** ¿Lo pegado es una tabla o trae el encabezado de la columna? Si no, se pega como siempre. */
function pideImportar(text: string): boolean {
  const parsed = parseTable(text);
  return (parsed !== null && parsed.columns.length > 1) || dropListHeader(text).header !== null;
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
  // Las filas que no se pudieron leer siguen a la vista después de cerrar la ventana.
  $("csv-note").textContent = L.impSummary(r.source === "luma", r.picked, r.total, r.mode, r.hand) +
    (r.skipped ? ` · ${L.impSkippedShort(r.skipped)}` : "");
  $("csv-pick").style.display = "";
}

/**
 * Lo que pasó con lo último que se cargó y no se ve en la lista: un archivo
 * sin nombres que no se usó, o el encabezado que quedó afuera. Se guarda como
 * función del idioma para volver a escribirlo si cambia.
 */
let aviso: ((L: Dict) => string) | null = null;

function avisar(texto: (L: Dict) => string): void {
  aviso = texto;
  const el = $("csv-aviso");
  el.textContent = texto(T[getLang()]);
  el.style.display = "";
}

function callarAviso(): void {
  aviso = null;
  const el = document.getElementById("csv-aviso");
  if (el) el.style.display = "none";
}

// El resumen y el aviso se vuelven a escribir al cambiar de idioma.
onLangChange(() => {
  if (lastResult) showSummary();
  if (aviso) $("csv-aviso").textContent = aviso(T[getLang()]);
});

/**
 * Lo que deja "otro premio" arriba del cuadro (quién salió de la lista y
 * "Recuperar la lista anterior") y el aviso del último archivo valen hasta
 * que la lista cambia.
 */
function quitarAvisos(): void {
  callarAviso();
  for (const id of ["again-note", "btn-recuperar"]) {
    const el = document.getElementById(id);
    if (el) el.style.display = "none";
  }
}

export function setList(text: string, clearSummary = true): void {
  if (clearSummary) hideSummary();
  quitarAvisos();
  $<HTMLTextAreaElement>("ta").value = text;
  renderNames();
}

function hideSummary(): void {
  lastResult = null;
  $("csv-pick").style.display = "none";
}
