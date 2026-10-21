import { $, esc } from "../dom";
import { SAMPLE, app, avatar, params } from "../state";
import { canonicalList } from "../protocol/canonical";
import { type Dict, T, getLang, onLangChange, t } from "../i18n";
import { decodeText, dropListHeader, parseTable } from "./csv";
import { type ImportResult, type ImportState, initialState, openImporter } from "./importer";
import { stripInvisibles, stripInvisiblesByLine } from "../invisibles";
import { ponerPremio, sincronizarPremios } from "./premios";

/** Lista canónica a partir del textarea (protocolo §1). */
export function parseNames(): string[] {
  return canonicalList($<HTMLTextAreaElement>("ta").value);
}

/** La lista se está sellando: lo que se sella ya se tomó del cuadro (ver `cerrarLista`). */
let cerrada = false;

/** La lista no se puede tocar: se está sellando o ya está sellada. */
const listaCerrada = (): boolean => cerrada || !!app.frozen;

/**
 * Cierra la lista a los cambios, o la vuelve a abrir.
 *
 * El sello fija lo que dice el cuadro al apretar "Sellar". Hasta el 21 de
 * octubre de 2026, con la lista ya sellada, "Cargar ejemplo", "Editar
 * selección" y los botones de origen seguían andando: un toque cambiaba el
 * cuadro y los nombres de abajo, y la pantalla decía "Lista sellada ✓" con otra
 * lista, en la que a veces no estaba quien ganó (buscador de detalles, D01). Y
 * mientras se sellaba con cuenta, unos doce segundos, el cuadro, el premio y
 * "Cuántos ganan" seguían editables, cuando lo que se sella ya estaba tomado.
 *
 * Lo llama `freeze.ts`: al empezar a sellar con cuenta, al sellar, si el sello
 * falla y al soltar el sello para otro sorteo.
 */
export function cerrarLista(si: boolean): void {
  cerrada = si;
  $<HTMLTextAreaElement>("ta").disabled = si;
  $<HTMLInputElement>("prize").disabled = si;
  $<HTMLSelectElement>("nw").disabled = si;
  for (const id of ["csv", "csv-luma"]) $<HTMLInputElement>(id).disabled = si;
  $<HTMLButtonElement>("btn-recuperar").disabled = si;
  // Los orígenes se ven apagados: ya no cargan nada (styles.css).
  $("sec-participants").classList.toggle("lista-cerrada", si);
  // Los botones de premios escriben en el cuadro: se apagan con él.
  sincronizarPremios();
  renderNames();
}

export function renderNames(): void {
  const names = parseNames();
  $("names").innerHTML = names
    .map((n) => `<i><img src="${avatar(n, 44)}" alt="" loading="lazy" />${esc(n)}</i>`)
    .join("");
  $<HTMLButtonElement>("btn-freeze").disabled = names.length < 2 || listaCerrada();
  // Un boton apagado sin explicacion es lo que mas frena a quien recien llega.
  $("freeze-hint").style.display = names.length < 2 && !app.frozen ? "block" : "none";
  $("free-rule").style.display = app.frozen ? "none" : "block";
  // Con la lista cerrada, nada la reemplaza: ni el ejemplo ni la selección del archivo.
  $("btn-sample").style.display = listaCerrada() ? "none" : "";
  $("csv-edit").style.display = listaCerrada() ? "none" : "";
}

export function loadSample(): void {
  if (listaCerrada()) return;
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
    guardarPronto();
  });
  // El borrador sigue al premio y a la cantidad de ganadores, y se escribe del
  // todo al irse de la página: una recarga, o el viaje a Google para entrar.
  $("prize").addEventListener("input", guardarPronto);
  $("prize-chips").addEventListener("click", guardarPronto);
  $("nw").addEventListener("change", guardarPronto);
  addEventListener("pagehide", guardarBorrador);
  // Pegar una tabla entera es lo mismo que subirla: abre la ventana de
  // importar. Y una columna copiada de una planilla con su encabezado entra
  // sin el encabezado. Solo cuando lo pegado es toda la lista: con algo ya
  // escrito, pegar agrega como siempre, y una lista suelta se pega igual que
  // antes, y se puede deshacer. Lo que se pega como siempre entra sin los
  // caracteres que no se ven, y si traía alguno, lo dice.
  ta.addEventListener("paste", (e) => {
    const text = e.clipboardData?.getData("text/plain") ?? "";
    if (listaCerrada() || !text.trim()) return;
    const toda = !ta.value.trim() || (ta.selectionStart === 0 && ta.selectionEnd === ta.value.length);
    if (toda && pideImportar(text)) {
      e.preventDefault();
      loadFile(text, "");
      return;
    }
    const limpio = stripInvisiblesByLine(text);
    if (limpio.text === text) return;
    e.preventDefault();
    insertar(ta, limpio.text);
    if (limpio.lines) avisar((L) => L.impInvisibles(limpio.lines));
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
    if (!file || listaCerrada()) return;
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
    if (imported && !listaCerrada()) openImporter(imported, apply);
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
  if (listaCerrada()) return;
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
  // Los caracteres que no se ven salen antes de sellar (src/invisibles.ts).
  const limpio = stripInvisiblesByLine(text);
  if (canonicalList(limpio.text).length === 0) {
    avisar((L) => L.impNoNames(fileName));
    return;
  }
  setList(limpio.text);
  if (!header && !limpio.lines) return;
  avisar((L) =>
    [header ? L.impHeaderOut(stripInvisibles(header)) : "", limpio.lines ? L.impInvisibles(limpio.lines) : ""]
      .filter(Boolean)
      .join(" "));
}

/** ¿Lo pegado es una tabla o trae el encabezado de la columna? Si no, se pega como siempre. */
function pideImportar(text: string): boolean {
  const parsed = parseTable(text);
  return (parsed !== null && parsed.columns.length > 1) || dropListHeader(text).header !== null;
}

/**
 * Escribe lo pegado, ya limpio, donde estaba el cursor. Con `execCommand`
 * queda en el historial del cuadro y se deshace con Ctrl+Z, como cualquier
 * pegar; donde no existe, se escribe a mano y se avisa del cambio igual.
 */
function insertar(ta: HTMLTextAreaElement, text: string): void {
  const plano = text.replace(/\r\n?/g, "\n");
  ta.focus();
  if (document.execCommand("insertText", false, plano)) return;
  ta.setRangeText(plano, ta.selectionStart, ta.selectionEnd, "end");
  ta.dispatchEvent(new Event("input", { bubbles: true }));
}

/** Lo que eligió en la ventana, al texto, con un resumen para volver a abrirla. */
function apply(r: ImportResult): void {
  if (listaCerrada()) return;
  lastResult = r;
  setList(r.names.join("\n"), false);
  showSummary();
  // `setList` calla los avisos: el de los invisibles va después.
  if (r.invisibles) avisar((L) => L.impInvisibles(r.invisibles));
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

/** Pone una lista en el cuadro. Con la lista cerrada no hace nada: lo que se ve tiene que ser lo que se selló. */
export function setList(text: string, clearSummary = true): void {
  if (listaCerrada()) return;
  if (clearSummary) hideSummary();
  quitarAvisos();
  $<HTMLTextAreaElement>("ta").value = text;
  renderNames();
  guardarPronto();
}

/* ------------------------------------------------------------ el borrador */

/**
 * La lista que se está armando, guardada en esta pestaña hasta que se sella.
 *
 * Entrar con Google es irse del sitio y volver: Pollar hace un redirect de
 * página entera. Y desde el 21 de octubre de 2026 "Sellar" sin cuenta abre la
 * ventana para entrar, así que el camino de la primera vez es pegar la lista,
 * tocar "Sellar", entrar con Google y volver... con el cuadro vacío. Una
 * recarga hacía lo mismo, y con un CSV de Luma había que volver a bajarlo y a
 * elegir "los que vinieron" (buscador de detalles, D03).
 *
 * Se guarda en `sessionStorage`, como `tinkazo.abrir`: vive en esta pestaña,
 * no sale del navegador y se borra al sellar (`freeze.ts`). Lo que se recupera
 * es el texto, el premio y la cantidad de ganadores; la selección del
 * importador no. La demo no guarda ni repone nada.
 */
const BORRADOR = "tinkazo.borrador";
let guardarLuego = 0;

/** Guarda ya lo que hay en el cuadro, el premio y la cantidad. Lo llama también la ventana de ingreso, antes de irse a Google. */
export function guardarBorrador(): void {
  window.clearTimeout(guardarLuego);
  if (params.has("demo") || listaCerrada()) return;
  try {
    const texto = $<HTMLTextAreaElement>("ta").value;
    const premio = $<HTMLInputElement>("prize").value;
    if (!texto.trim() && !premio.trim()) sessionStorage.removeItem(BORRADOR);
    else sessionStorage.setItem(BORRADOR, JSON.stringify({ texto, premio, nw: $<HTMLSelectElement>("nw").value }));
  } catch {
    /* sin almacenamiento, no se recupera: nada más */
  }
}

/** Al escribir no se guarda en cada tecla: un momento después. */
function guardarPronto(): void {
  window.clearTimeout(guardarLuego);
  guardarLuego = window.setTimeout(guardarBorrador, 400);
}

/** Se selló (o se retomó un sorteo sellado): no queda nada por recuperar. La demo no lo toca: es otra lista. */
export function olvidarBorrador(): void {
  window.clearTimeout(guardarLuego);
  if (params.has("demo")) return;
  try {
    sessionStorage.removeItem(BORRADOR);
  } catch {
    /* sin almacenamiento, no había nada */
  }
}

/**
 * Al abrir la herramienta, si el cuadro está vacío, repone lo que se estaba
 * armando en esta pestaña, y lo dice. Nunca encima de una lista ni de un sello.
 */
export function reponerBorrador(): void {
  if (params.has("demo") || listaCerrada() || $<HTMLTextAreaElement>("ta").value.trim()) return;
  type Guardado = { texto?: unknown; premio?: unknown; nw?: unknown } | null;
  let b: Guardado;
  try {
    b = JSON.parse(sessionStorage.getItem(BORRADOR) ?? "null") as Guardado;
  } catch {
    return;
  }
  if (!b || typeof b.texto !== "string") return;
  setList(b.texto);
  if (typeof b.premio === "string" && b.premio.trim()) ponerPremio(b.premio);
  const nw = Number(b.nw);
  if (Number.isInteger(nw) && nw >= 1 && nw <= 32) $<HTMLSelectElement>("nw").value = String(nw);
  if (canonicalList(b.texto).length) avisar(() => t("borradorRepuesto"));
}

function hideSummary(): void {
  lastResult = null;
  $("csv-pick").style.display = "none";
}
