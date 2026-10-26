import { $, esc } from "../dom";
import { SAMPLE, app, avatar } from "../state";
import { anchoringAvailable } from "../stellar/config";
import { enEnsayo, sinGrabar } from "../ensayo-modo";
import { canonicalList } from "../protocol/canonical";
import { type Dict, T, getLang, onLangChange, t } from "../i18n";
import { decodeText, dropListHeader, igualesQuitados, parseTable, quitarNumeracion } from "./csv";
import { type ImportResult, type ImportState, initialState, openImporter } from "./importer";
import { stripInvisibles, stripInvisiblesByLine } from "../invisibles";
import { parecidos } from "../buscar";
import { ponerPremio, sincronizarPremios } from "./premios";
import { contarUnaVez } from "../contar";
import { tamanoDe } from "../../workers/enlaces/src/conteo";

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
  for (const id of ["csv", "csv-luma", "btn-pegar"]) $<HTMLInputElement>(id).disabled = si;
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
  const vacia = names.length === 0 && !listaCerrada();
  // Con la lista cerrada, nada la reemplaza: ni el ejemplo ni la selección del archivo.
  // Y "Cargar ejemplo" es para quien llega sin lista: con nombres en el cuadro,
  // un toque pisaba la lista (la de Luma ya filtrada, también) y Ctrl+Z no la
  // devolvía, porque el cambio no es del teclado (buscador de detalles, D08).
  // Se esconde y no se quita: los auditores lo aprietan con el cuadro vacío.
  // En una red con contrato no se ve nunca: con una cuenta abierta, sellar el
  // ejemplo grababa en la cadena un sorteo de nombres inventados, con comisión.
  // En su lugar está el ensayo, que no graba nada (`#btn-ensayo`, ensayo.ts).
  $("btn-sample").style.display = anchoringAvailable || !vacia ? "none" : "";
  const ensayo = document.getElementById("btn-ensayo");
  if (ensayo) ensayo.style.display = anchoringAvailable && vacia && !enEnsayo() ? "" : "none";
  // Con la lista vacía, lo único de color es "Pegar lista": es lo que toca. Con
  // la lista ya cargada vuelve a ser un origen más y lo de color es "Sellar",
  // que mientras falten nombres queda apagado y sin color (diseño del onboarding).
  $("btn-pegar").classList.toggle("primary", vacia && !enEnsayo());
  const sellar = $("btn-freeze");
  const alcanza = names.length >= 2 || listaCerrada();
  sellar.classList.toggle("primary", alcanza);
  sellar.classList.toggle("ghost", !alcanza);
  const ayuda = document.getElementById("pegar-ayuda");
  if (ayuda) ayuda.style.display = vacia && !enEnsayo() ? "" : "none";
  // "20 personas", en grande junto al cuadro: que pegó se ve de un vistazo.
  const cuenta = document.getElementById("lista-cuenta");
  if (cuenta) {
    cuenta.textContent = names.length ? t("sigLista").replace("{n}", String(names.length)) : "";
    cuenta.style.display = names.length ? "" : "none";
  }
  // "Ya entraste. Sellá tu lista…" vale para la lista con que se entró: si cambia, o al sellarla, se va.
  const ya = document.getElementById("ya-entraste");
  if (ya && (ya.dataset.n !== String(names.length) || listaCerrada())) ya.style.display = "none";
  $("csv-edit").style.display = listaCerrada() ? "none" : "";
  pintarResumen(names.length);
}

/**
 * Debajo de "Sellar la lista", lo que se va a sellar: "20 personas · 1 ganador
 * · Termo. Al sellar, la lista queda cerrada." Sellar es público y no se
 * deshace: que se lea antes (diseño del onboarding, pantalla 3). Lo vuelven a
 * escribir el premio, "Cuántos ganan" y el idioma.
 */
function pintarResumen(n = parseNames().length): void {
  const el = document.getElementById("sellar-resumen");
  if (!el) return;
  if (n < 2 || listaCerrada()) {
    el.style.display = "none";
    return;
  }
  const L = T[getLang()];
  const k = Math.min(parseInt($<HTMLSelectElement>("nw").value, 10) || 1, n);
  const premio = $<HTMLInputElement>("prize").value.trim().replace(/\s+/g, " ");
  el.textContent = L.sellarResumen(n, k, premio);
  el.style.display = "";
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
  ta.addEventListener("input", (e) => {
    // Si edita a mano, manda lo que escribió: el resumen del archivo ya no aplica.
    hideSummary();
    quitarAvisos();
    renderNames();
    guardarPronto();
    // Lo que se pegó tal cual (sin nada que limpiar): si trajo repetidos, se dice.
    const pegado = (e as InputEvent).inputType === "insertFromPaste";
    if (pegado) avisarCarga([]);
    // Para el contador, solo lo que hizo la persona: una lista puesta por el código (el ejemplo, el borrador, la demo) no cuenta.
    if (e.isTrusted) anotarOrigen(pegado ? "paste" : "typed", pegado);
  });
  // Una lista escrita a mano se cuenta cuando se deja de escribir; si la página se va antes (el viaje a Google), en ese momento.
  addEventListener("pagehide", contarLista);
  // El borrador sigue al premio y a la cantidad de ganadores, y se escribe del
  // todo al irse de la página: una recarga, o el viaje a Google para entrar.
  $("prize").addEventListener("input", guardarPronto);
  $("prize-chips").addEventListener("click", guardarPronto);
  $("nw").addEventListener("change", guardarPronto);
  // El resumen de debajo de "Sellar la lista" sigue al premio y a la cantidad de ganadores.
  $("prize").addEventListener("input", () => pintarResumen());
  $("prize").addEventListener("tinkazo:premio", () => pintarResumen());
  $("prize-chips").addEventListener("click", () => queueMicrotask(() => pintarResumen()));
  $("nw").addEventListener("change", () => pintarResumen());
  onLangChange(() => {
    pintarResumen();
    const cuenta = document.getElementById("lista-cuenta");
    const n = parseNames().length;
    if (cuenta && n) cuenta.textContent = t("sigLista").replace("{n}", String(n));
  });
  addEventListener("pagehide", guardarBorrador);
  // Pegar una tabla entera es lo mismo que subirla: abre la ventana de
  // importar. Y una columna copiada de una planilla con su encabezado entra
  // sin el encabezado. Solo cuando lo pegado es toda la lista: con algo ya
  // escrito, pegar agrega como siempre, y una lista suelta se pega igual que
  // antes, y se puede deshacer. Lo que se pega como siempre entra sin los
  // caracteres que no se ven y sin la numeración de una lista de WhatsApp
  // (`quitarNumeracion`), y si traía algo de eso, o repetidos, lo dice.
  ta.addEventListener("paste", (e) => {
    const text = e.clipboardData?.getData("text/plain") ?? "";
    if (listaCerrada() || !text.trim()) return;
    if (pegarTabla(ta, text)) {
      e.preventDefault();
      return;
    }
    const { pegar, avisos } = limpiarPegado(ta, text);
    if (pegar === text) return;
    e.preventDefault();
    insertar(ta, pegar);
    avisarCarga(avisos);
    anotarOrigen("paste", true);
  });
  // "Pegar lista" pega. Hasta el 21 de octubre de 2026 solo llevaba al cuadro
  // (D18), y en el celular había que mantener apretado y tocar "Pegar": dos
  // toques más en la acción del paso 1, y el nombre prometía otra cosa
  // (evaluación crítica de experiencia, hallazgo 6). Ahora lee el portapapeles
  // en el mismo toque (en iOS sale la burbuja "Pegar" del sistema; en Android y
  // en Chrome de escritorio, el permiso una sola vez) y lo pasa por el mismo
  // camino que un pegado. Si no hay permiso, no hay portapapeles o está vacío,
  // queda como antes: el cuadro con el foco y el cursor al final, listo para
  // pegar a mano.
  //
  // Si pegó, el cuadro no se queda con el foco en una pantalla táctil: el
  // teclado del celular tapaba el premio y "Sellar la lista", que es lo que
  // sigue (diseño del onboarding, 22 de octubre de 2026). El foco va al cuadro
  // solo si no pegó, para pegar a mano.
  $("btn-pegar").addEventListener("click", () => {
    if (listaCerrada() || enEnsayo()) return;
    const reducido = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    const aMano = (): void => {
      ta.focus({ preventScroll: true });
      ta.setSelectionRange(ta.value.length, ta.value.length);
      ta.scrollIntoView({ behavior: reducido ? "auto" : "smooth", block: "center" });
    };
    // En escritorio el foco no abre ningún teclado: va enseguida, como siempre, y Ctrl+V anda mientras se pide el permiso.
    if (!tactil()) aMano();
    const antes = ta.value;
    void leerPortapapeles().then((text) => {
      // Si mientras tanto se pegó a mano (el permiso tarda lo que tarde la persona), no se pega dos veces.
      if (listaCerrada() || ta.value !== antes) return;
      if (!text?.trim()) {
        if (tactil()) aMano();
        return;
      }
      ta.setSelectionRange(ta.value.length, ta.value.length);
      if (pegarTabla(ta, text)) return;
      const { pegar, avisos } = limpiarPegado(ta, text);
      insertar(ta, pegar, !tactil());
      avisarCarga(avisos);
      anotarOrigen("paste", true);
      // En el celular, lo que sigue a la vista: cuántas personas, el premio y "Sellar la lista".
      if (tactil()) document.getElementById("lista-cuenta")?.scrollIntoView({ behavior: reducido ? "auto" : "smooth", block: "start" });
    });
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

  const onFile = async (file: File | undefined, origen: "csv" | "luma"): Promise<void> => {
    if (!file || listaCerrada()) return;
    // Los bytes y no `file.text()`, que lee todo como UTF-8: un CSV de Excel
    // en Windows llegaba con "Mar�a".
    const text = decodeText(new Uint8Array(await file.arrayBuffer()));
    if (text === null) avisar((L) => L.impNotText(file.name));
    else {
      origenArchivo = origen;
      loadFile(text, file.name);
    }
  };
  for (const id of ["csv", "csv-luma"]) {
    $<HTMLInputElement>(id).addEventListener("change", async (e) => {
      const input = e.target as HTMLInputElement;
      await onFile(input.files?.[0], id === "csv-luma" ? "luma" : "csv");
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
    void onFile(file, "csv");
  });
}

/* ------------------------------------------------------------ el contador */

type OrigenLista = "paste" | "csv" | "luma" | "typed";

/** De dónde vino lo último que cambió la lista a mano (`list_ready` del contador, src/contar.ts). */
let origenLista: OrigenLista | null = null;
/** De dónde viene el archivo o la tabla que se está cargando: la ventana de importar no lo sabe. */
let origenArchivo: "paste" | "csv" | "luma" = "csv";
let contarLuego = 0;

/**
 * Anota de dónde vino el último cambio de la lista. Una lista pegada o
 * subida llega entera y se cuenta ya; una escrita a mano, cuando se deja de
 * escribir, para contarla con su tamaño y no con los primeros dos nombres.
 */
function anotarOrigen(origen: OrigenLista, ya: boolean): void {
  origenLista = origen;
  window.clearTimeout(contarLuego);
  if (ya) contarLista();
  else contarLuego = window.setTimeout(contarLista, 3000);
}

/**
 * La primera lista de dos o más de la pestaña, por su origen y en tramos de
 * tamaño. Nada de la lista sale: ni los nombres, ni su huella, ni cuántos son
 * exactamente.
 */
function contarLista(): void {
  window.clearTimeout(contarLuego);
  const origen = origenLista;
  const size = origen ? tamanoDe(parseNames().length) : null;
  if (!origen || !size) return;
  origenLista = null;
  contarUnaVez("list_ready", "list_ready", { source: origen, size });
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
  // Los caracteres que no se ven salen antes de sellar (src/invisibles.ts), y la numeración de una lista de WhatsApp también.
  const limpio = stripInvisiblesByLine(text);
  const num = quitarNumeracion(limpio.text);
  if (canonicalList(num.text).length === 0) {
    avisar((L) => L.impNoNames(fileName));
    return;
  }
  setList(num.text);
  anotarOrigen(origenArchivo, true);
  avisarCarga([
    ...(header ? [(L: Dict) => L.impHeaderOut(stripInvisibles(header))] : []),
    ...(limpio.lines ? [(L: Dict) => L.impInvisibles(limpio.lines)] : []),
    ...avisosDeNumeracion(num),
  ]);
}

/** Lo que dice el aviso de una lista que llegó numerada: cuántas líneas, cómo quedó la primera y las que no tenían número. */
function avisosDeNumeracion(num: ReturnType<typeof quitarNumeracion>): Array<(L: Dict) => string> {
  // Sin ningún nombre (solo lugares libres, "1.", "2."), no hay qué contar: el cuadro queda sin nombres y lo dice el paso.
  if (!num.lineas || !num.despues) return [];
  const partes: Array<(L: Dict) => string> = [(L) => L.pegNumeracion(num.lineas, num.antes, num.despues)];
  const [primera] = num.sueltas;
  if (primera) partes.push((L) => L.pegSueltas(num.sueltas.length, primera));
  return partes;
}

/**
 * Avisa lo que pasó con lo último que se cargó o se pegó (`partes`), y lo que
 * la lista canónica hace en silencio: un nombre escrito dos veces igual entra
 * una sola vez, y dos que parecen la misma persona escrita distinto ("Ana
 * Quispe" y "ana quispe") entran los dos. Hasta el 21 de octubre de 2026 eso
 * solo se veía en "Mostrar la lista a la sala" (buscador de detalles, D09). No
 * frena el sello: avisa.
 */
function avisarCarga(partes: Array<(L: Dict) => string>): void {
  const texto = $<HTMLTextAreaElement>("ta").value;
  const iguales = igualesQuitados(texto);
  const pares = parecidos(canonicalList(texto));
  const todo = [...partes];
  if (iguales) todo.push((L) => L.pegIguales(iguales));
  const [par] = pares;
  if (par) todo.push((L) => L.pegParecidos(par[0], par[1], pares.length - 1));
  if (todo.length) avisar((L) => todo.map((p) => p(L)).join(" "));
}

/** ¿Lo pegado es una tabla o trae el encabezado de la columna? Si no, se pega como siempre. */
function pideImportar(text: string): boolean {
  const parsed = parseTable(text);
  return (parsed !== null && parsed.columns.length > 1) || dropListHeader(text).header !== null;
}

/**
 * Pegar una tabla entera es lo mismo que subirla: abre la ventana de importar.
 * Solo cuando lo pegado es toda la lista (el cuadro vacío, o todo marcado).
 * Devuelve si la tomó.
 */
function pegarTabla(ta: HTMLTextAreaElement, text: string): boolean {
  const toda = !ta.value.trim() || (ta.selectionStart === 0 && ta.selectionEnd === ta.value.length);
  if (!toda || !pideImportar(text)) return false;
  origenArchivo = "paste";
  loadFile(text, "");
  return true;
}

/**
 * Lo pegado, sin los caracteres que no se ven ni la numeración de una lista de
 * WhatsApp, y lo que hay que avisar de eso. Una lista pegada al final de otra
 * empieza en un renglón nuevo: si no, el primer nombre se pegaba al último
 * ("Luis MamaniCarla Flores").
 */
function limpiarPegado(ta: HTMLTextAreaElement, text: string): { pegar: string; avisos: Array<(L: Dict) => string> } {
  const limpio = stripInvisiblesByLine(text);
  const num = quitarNumeracion(limpio.text);
  const alFinal = ta.selectionStart === ta.value.length && ta.selectionEnd === ta.value.length && /\S[ \t]*$/.test(ta.value);
  const pegar = alFinal && /\n/.test(num.text.trim()) ? `\n${num.text}` : num.text;
  return { pegar, avisos: [...(limpio.lines ? [(L: Dict) => L.impInvisibles(limpio.lines)] : []), ...avisosDeNumeracion(num)] };
}

/** El texto del portapapeles, si el navegador lo da. Sin permiso, sin portapapeles o con un error: null. */
async function leerPortapapeles(): Promise<string | null> {
  try {
    if (typeof navigator === "undefined" || !navigator.clipboard?.readText) return null;
    return await navigator.clipboard.readText();
  } catch {
    return null;
  }
}

/**
 * Escribe lo pegado, ya limpio, donde estaba el cursor. Con `execCommand`
 * queda en el historial del cuadro y se deshace con Ctrl+Z, como cualquier
 * pegar; donde no existe, se escribe a mano y se avisa del cambio igual.
 */
function insertar(ta: HTMLTextAreaElement, text: string, conFoco = true): void {
  const plano = text.replace(/\r\n?/g, "\n");
  if (conFoco) {
    ta.focus();
    // Solo con el foco en el cuadro: si no lo tomó (un toque que ya pasó), `execCommand` escribiría en otro lado.
    if (document.activeElement === ta && document.execCommand("insertText", false, plano)) return;
  }
  ta.setRangeText(plano, ta.selectionStart, ta.selectionEnd, "end");
  ta.dispatchEvent(new Event("input", { bubbles: true }));
}

/** Una pantalla táctil: el foco en un cuadro de texto abre el teclado. */
const tactil = (): boolean => typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;

/** Lo que eligió en la ventana, al texto, con un resumen para volver a abrirla. */
function apply(r: ImportResult): void {
  if (listaCerrada()) return;
  lastResult = r;
  setList(r.names.join("\n"), false);
  // Un archivo de Luma se reconoce aunque se haya subido o pegado por otro lado.
  anotarOrigen(r.source === "luma" ? "luma" : origenArchivo, true);
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
  // La lista del ensayo no pisa la que se estaba armando: al salir, vuelve esa.
  if (sinGrabar() || listaCerrada()) return;
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

/** Se selló (o se retomó un sorteo sellado): no queda nada por recuperar. La demo y el ensayo no lo tocan: son otra lista. */
export function olvidarBorrador(): void {
  window.clearTimeout(guardarLuego);
  if (sinGrabar()) return;
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
  if (sinGrabar() || listaCerrada() || $<HTMLTextAreaElement>("ta").value.trim()) return;
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
