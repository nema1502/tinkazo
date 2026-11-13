import { $, esc } from "../dom";
import { SAMPLE, app, avatar } from "../state";
import { anchoringAvailable, topeDeGanadores } from "../stellar/config";
import { enEnsayo, enPractica, sinGrabar } from "../ensayo-modo";
import { canonicalList } from "../protocol/canonical";
import { MAX_WINNERS } from "../protocol/select";
import { type Dict, T, getLang, onLangChange, t } from "../i18n";
import { type Table, cleanName, decodeText, dropListHeader, igualesQuitados, parseTable, quitarNumeracion } from "./csv";
import { type ImportResult, type ImportState, initialState, openImporter } from "./importer";
import { stripInvisibles, stripInvisiblesByLine } from "../invisibles";
import { parecidos } from "../buscar";
import { ponerPremio, sincronizarPremios } from "./premios";
import { isTurnOrder } from "../modos/turnos";
import { modesVisible, modoVigente, recordarModo } from "../modos/bandera";
import { TOPE_POR_PERSONA, contar, cuentaParaMostrar as cuentaParaMostrarSinSellar, nombreDePersona, personasDelCuadro, ponerParticipaciones, repartir, seCuentaPorPersona, terminaEnNumero } from "../participaciones";
import { bloquearGanadores, ganadoresPedidos, ponerGanadores } from "./ganadores";
import { bloquearTurnos, modoTurnosActivo, ordenNoCabe, ponerModoTurnos, seguirLaLista } from "./turnos";
import { contarUnaVez } from "../contar";
import { cuadroEsDeEquipos, etiquetaDe } from "../equipos/etiquetas";
import { tamanoDe } from "../../workers/enlaces/src/conteo";

/** Lista canónica a partir del textarea (protocolo §1). */
export function parseNames(): string[] {
  return canonicalList($<HTMLTextAreaElement>("ta").value);
}

/** La lista se está sellando: lo que se sella ya se tomó del cuadro (ver `cerrarLista`). */
let cerrada = false;

/** La lista no se puede tocar: se está sellando o ya está sellada. */
const listaCerrada = (): boolean => cerrada || !!app.frozen;

/** Lo mismo, para quien la cambia desde afuera: el panel de equipos mira esto antes de tocar los nombres que se muestran. */
export const listaBloqueada = (): boolean => listaCerrada();

/**
 * "Lista de 20 personas", junto al cuadro. Con varias participaciones por persona, dice las dos cuentas; en un
 * orden de turnos repartido, personas y turnos, como el resumen y la barra.
 */
const cuentaDeLista = (n: number, k = n): string =>
  k === n
    ? n === 1
      ? t("listaCuentaUna")
      : t("listaCuenta").replace("{n}", String(n))
    : modoTurnosActivo()
      ? T[getLang()].listaCuentaTurnos(n, k)
      : T[getLang()].listaCuentaPart(n, k);

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
  bloquearGanadores(si);
  bloquearTurnos(si);
  for (const id of ["csv", "csv-luma", "btn-pegar"]) $<HTMLInputElement>(id).disabled = si;
  $<HTMLButtonElement>("btn-recuperar").disabled = si;
  $<HTMLButtonElement>("btn-varias").disabled = si;
  // Los orígenes se ven apagados: ya no cargan nada (styles.css).
  $("sec-participants").classList.toggle("lista-cerrada", si);
  // Los botones de premios escriben en el cuadro: se apagan con él.
  sincronizarPremios();
  renderNames();
}

/**
 * Lo que dice la cuenta de la lista antes de sellar. Con los modos a la vista, por persona, como siempre (una marca
 * que todavía no cierra se renumera al sellar). Sin ellos, por persona solo si la lista es un reparto entero
 * (`seCuentaPorPersona` sin modos): la cabecera del selector y el resultado después de sellar leen así una lista
 * hecha toda de marcas que cierran («Mesa 1 (1/3)» a «Mesa 2 (2/2)»), y antes decía «5 personas» y después
 * «2 personas, 5 participaciones». Para habilitar «Sellar» se sigue contando como siempre.
 */
const cuentaParaMostrar = (names: readonly string[]): { personas: number; participaciones: number } =>
  cuentaParaMostrarSinSellar(names, modesVisible());

export function renderNames(): void {
  const names = parseNames();
  // Para sellar hacen falta dos personas distintas: una lista repartida puede tener muchas líneas de una sola.
  // Sin la bandera de los modos ni `?modo=`, la lista es la de siempre: cada línea, una persona.
  const personas = contar(names, modesVisible()).personas;
  $("names").innerHTML = names
    .map((n) => `<i><img src="${avatar(etiquetaDe(n), 44)}" alt="" loading="lazy" />${esc(etiquetaDe(n))}</i>`)
    .join("");
  // En el modo «Orden de turnos» la cantidad sigue a la lista, y si la lista pasa de lo que admite la red no se sella.
  seguirLaLista(names.length);
  $<HTMLButtonElement>("btn-freeze").disabled = personas < 2 || listaCerrada() || ordenNoCabe(names.length);
  // Un boton apagado sin explicacion es lo que mas frena a quien recien llega.
  const hint = $("freeze-hint");
  hint.style.display = personas < 2 && !app.frozen ? "block" : "none";
  // Con los modos a la vista se cuentan personas, no renglones: tres participaciones de Ana son tres nombres y una persona.
  const claveHint = modesVisible() ? "freezeHintPersonas" : "freezeHint";
  if (hint.dataset.i !== claveHint) {
    hint.dataset.i = claveHint;
    hint.textContent = t(claveHint);
  }
  $("free-rule").style.display = app.frozen ? "none" : "block";
  // Las bases de antes de sellar: con lista y sin sellar. Después las reemplazan las de siempre.
  $("rules-pre-row").style.display = personas >= 2 && !listaCerrada() ? "" : "none";
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
  if (ensayo) ensayo.style.display = anchoringAvailable && vacia && !enPractica() ? "" : "none";
  // Con la lista vacía, lo único de color es "Pegar lista": es lo que toca. Con
  // la lista ya cargada vuelve a ser un origen más y lo de color es "Sellar",
  // que mientras falten nombres queda apagado y sin color (diseño del onboarding).
  $("btn-pegar").classList.toggle("primary", vacia && !enEnsayo());
  const sellar = $("btn-freeze");
  const alcanza = personas >= 2 || listaCerrada();
  sellar.classList.toggle("primary", alcanza);
  sellar.classList.toggle("ghost", !alcanza);
  const ayuda = document.getElementById("pegar-ayuda");
  if (ayuda) ayuda.style.display = vacia && !enEnsayo() ? "" : "none";
  // "20 personas", en grande junto al cuadro: que pegó se ve de un vistazo.
  const cuenta = document.getElementById("lista-cuenta");
  if (cuenta) {
    cuenta.textContent = names.length ? cuentaDeLista(cuentaParaMostrar(names).personas, names.length) : "";
    cuenta.style.display = names.length ? "" : "none";
  }
  // "Ya entraste. Sellá tu lista…" vale para la lista con que se entró: si cambia, o al sellarla, se va.
  const ya = document.getElementById("ya-entraste");
  if (ya && (ya.dataset.n !== String(names.length) || listaCerrada())) ya.style.display = "none";
  $("csv-edit").style.display = listaCerrada() ? "none" : "";
  pintarResumen();
  pintarVarias();
  pintarListaDeEquipos();
}

/**
 * Lo que cambia en la pantalla cuando la lista del cuadro es de equipos con cupón (cada línea, la cuenta de un equipo):
 * - cada cuenta, de 56 letras, ocupa un solo renglón del cuadro. Partidas en dos, en el celular se veían diez renglones
 *   de letras sueltas para cinco equipos, y el cuadro no decía que eran los equipos;
 * - una nota junto a la cuenta dice qué es cada renglón y dónde están los nombres;
 * - debajo del resumen, en vez de que la gente no necesita cuenta, dice que cada equipo ya se anotó con la de su encargado.
 * Con otra lista, todo queda como siempre. Se decide por lo que hay en el cuadro, no por la memoria.
 */
function pintarListaDeEquipos(): void {
  const equipos = cuadroEsDeEquipos();
  const cuadro = document.getElementById("ta");
  if (cuadro) {
    if (equipos) cuadro.setAttribute("wrap", "off");
    else cuadro.removeAttribute("wrap");
  }
  const nota = document.getElementById("lista-cuenta-nota");
  if (nota) {
    nota.textContent = equipos ? t("listaCuentaNotaEquipos") : "";
    nota.style.display = equipos ? "" : "none";
  }
  const sinCuenta = document.getElementById("sellar-sin-cuenta");
  if (sinCuenta) {
    const clave = equipos ? "sellarSinCuentaEquipos" : "sellarSinCuenta";
    sinCuenta.dataset.i = clave;
    sinCuenta.textContent = t(clave);
  }
}

/**
 * Debajo de "Sellar la lista", lo que se va a sellar: "20 personas, 1 ganador,
 * Termo. Al sellar, la lista queda cerrada." Sellar es público y no se
 * deshace: que se lea antes (diseño del onboarding, pantalla 3). Lo vuelven a
 * escribir el premio, "Cuántos ganan" y el idioma.
 */
function pintarResumen(): void {
  const el = document.getElementById("sellar-resumen");
  if (!el) return;
  // Se muestra cuando se puede sellar (la cuenta de siempre) y dice las personas con la regla de la cuenta.
  const nombres = parseNames();
  const n = cuentaParaMostrar(nombres).personas;
  if (contar(nombres, modesVisible()).personas < 2 || listaCerrada()) {
    el.style.display = "none";
    return;
  }
  const L = T[getLang()];
  // Cuántos ganan se corta con las participaciones (las líneas de la lista), no con las personas.
  const entradas = parseNames().length;
  const k = Math.min(ganadoresPedidos(), entradas);
  const premio = $<HTMLInputElement>("prize").value.trim().replace(/\s+/g, " ");
  // En el ensayo no se nombra el premio que falta: nada se sella de verdad.
  // Un orden de turnos dice «12 personas, turnos del 1 al 12», no cuántos ganan. Se decide por las líneas
  // de la lista (lo que se sella: cada línea, un turno), no por las personas: una lista repartida de 2
  // personas y 4 líneas es un orden de 4. Y si la lista no entra en lo que la red admite, no se promete
  // el sello: no se va a poder sellar (`ordenNoCabe`).
  // Una lista de más de 300 líneas no entra en ninguna red: «Cuántos ganan» se recorta a 300 y `k` ya no es igual a
  // las líneas. Con el modo prendido eso se decide por el modo (`ordenNoCabe`) y no por el recorte: sigue siendo un
  // orden que no se puede sellar, y no un sorteo común con ganadores.
  el.textContent = ordenNoCabe(entradas)
    ? L.turnsSellarTope(entradas, n)
    : isTurnOrder(entradas, k, premio)
      ? L.turnsSellarResumen(entradas, n)
      : L.sellarResumen(n, k, enEnsayo() && !premio ? null : premio, entradas);
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
  refreshPlaceholder();
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
  // El campo es un número: se escribe (`input`) y se confirma al salir (`change`). Los atajos mandan `change`.
  for (const evento of ["input", "change"]) $("nw").addEventListener(evento, guardarPronto);
  // El resumen de debajo de "Sellar la lista" sigue al premio y a la cantidad de ganadores.
  $("prize").addEventListener("input", () => pintarResumen());
  $("prize").addEventListener("tinkazo:premio", () => pintarResumen());
  $("prize-chips").addEventListener("click", () => queueMicrotask(() => pintarResumen()));
  for (const evento of ["input", "change"]) $("nw").addEventListener(evento, () => pintarResumen());
  // Prender o apagar «Orden de turnos» cambia la cantidad y si se puede sellar: la lista se vuelve a pintar y se guarda el borrador.
  // El panel de contadores sigue a la vista y pasa a hablar de turnos.
  document.getElementById("turnos-opcion")?.addEventListener("tinkazo:modo", () => {
    renderNames();
    guardarPronto();
    refreshPlaceholder();
  });
  // El botón que abre el panel de contadores, el «Listo» que lo pliega, la pregunta por los números que ya
  // trae una lista pegada y el buscador del panel. Todo se pinta en `pintarVarias`, al cambiar la lista.
  const botonVarias = document.getElementById("btn-varias");
  if (botonVarias) {
    botonVarias.addEventListener("click", () => {
      panelAbierto = !panelAbierto;
      pintarVarias();
    });
    $("btn-varias-listo").addEventListener("click", () => {
      panelAbierto = false;
      pintarVarias();
      (botonVarias as HTMLButtonElement).focus();
    });
    $("btn-part-si").addEventListener("click", usarNumerosDeLaLista);
    $("btn-part-no").addEventListener("click", () => {
      listaSinUsarNumeros = $<HTMLTextAreaElement>("ta").value;
      pintarVarias();
    });
    $("varias-buscar").addEventListener("input", () => pintarFilasDelPanel());
  }
  onLangChange(() => {
    refreshPlaceholder();
    pintarResumen();
    pintarVarias();
    pintarListaDeEquipos();
    const cuenta = document.getElementById("lista-cuenta");
    const { personas, participaciones } = cuentaParaMostrar(parseNames());
    if (cuenta && participaciones) cuenta.textContent = cuentaDeLista(personas, participaciones);
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
/** Si la lista que se está sorteando vino de Luma: el resultado le dice qué sigue en Luma (draw.ts, showAgain). */
let vinoDeLuma = false;
export const listaVinoDeLuma = (): boolean => vinoDeLuma;

/**
 * Anota de dónde vino el último cambio de la lista. Una lista pegada o
 * subida llega entera y se cuenta ya; una escrita a mano, cuando se deja de
 * escribir, para contarla con su tamaño y no con los primeros dos nombres.
 */
function anotarOrigen(origen: OrigenLista, ya: boolean): void {
  origenLista = origen;
  vinoDeLuma = origen === "luma";
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
/**
 * ¿Esta tabla es un «Nombre, cuántas» plausible? Dos columnas, nada que se haya tenido que saltear y en la segunda
 * solo enteros de 1 en adelante. Puede ser cuántas participaciones tiene cada persona (o la edad, o la mesa: por eso
 * entra al cuadro como «Nombre, n» y la pregunta de debajo del cuadro decide). Sin los modos a la vista, no se
 * mira: la ventana de importar, como siempre.
 */
function tablaDeParticipaciones(t: Table): boolean {
  if (t.columns.length !== 2 || t.skipped.length > 0 || t.rows.length < 2) return false;
  return t.rows.every((r) => {
    const cuantas = (r[1] ?? "").trim();
    const n = Number(cuantas);
    return (r[0] ?? "").trim().length >= 2 && /^\d+$/.test(cuantas) && n >= 1;
  });
}

export function loadFile(raw: string, fileName = "lista.csv"): void {
  if (listaCerrada()) return;
  callarAviso();
  const parsed = parseTable(raw);
  if (parsed && parsed.columns.length > 1) {
    if (parsed.rows.length === 0) {
      avisar((L) => L.impNoNames(fileName));
      return;
    }
    // La tabla de dos columnas con números enteros al final es una oferta, no un cambio: la persona decide con el
    // botón del aviso. Sin repartir, lo que se sella es la lista de siempre (el nombre, sin el número).
    if (variasALaVista() && tablaDeParticipaciones(parsed)) {
      setList(parsed.rows.map((r) => `${cleanName(r[0] ?? "")}, ${(r[1] ?? "").trim()}`).join("\n"));
      anotarOrigen(origenArchivo, true);
      avisarCarga([]);
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
 * solo se veía en "Mostrar la lista en grande" (buscador de detalles, D09). No
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

/* ------------------------------------------------ varias participaciones */

/**
 * ¿Los modos están a la vista? Con la bandera de construcción o con `?modo=` en la dirección. Sin las dos
 * cosas no hay botón, ni panel, ni pregunta: la herramienta de siempre.
 */
const variasALaVista = (): boolean => modesVisible();

/** El texto de ayuda del cuadro vacío: un nombre por línea, como siempre. Las veces se eligen tocando. */
const refreshPlaceholder = (): void => {
  const ta = document.getElementById("ta") as HTMLTextAreaElement | null;
  if (ta) ta.placeholder = t("placeholder");
};

/** ¿El panel de contadores está abierto? Lo abren el botón de debajo de la cuenta y el «Sí» de la pregunta. */
let panelAbierto = false;

/** La lista exacta a la que ya se le dijo que no a usar sus números: por esa lista no se pregunta de nuevo. */
let listaSinUsarNumeros = "";

/** Quiénes pasaron del máximo al usar los números de una lista pegada, para decirlo en una línea del panel. */
let quedaronEnElTope: string[] = [];

/** Una lista de nombres en palabras: los primeros y «y N más». */
const listaDeNombres = (nombres: readonly string[]): string => {
  const mas = nombres.length - 3;
  return new Intl.ListFormat(getLang() === "es" ? "es" : "en", { type: "conjunction" }).format(
    mas > 0 ? [...nombres.slice(0, 3), t("fotoMas").replace("{n}", String(mas))] : [...nombres],
  );
};

/** Los números que una lista ya trae al lado de los nombres: una sola coma y un entero de 1 en adelante. */
function numerosDeLaLista(texto: string): Array<{ nombre: string; n: number }> {
  const salida: Array<{ nombre: string; n: number }> = [];
  for (const linea of texto.split(/\r?\n/)) {
    if (!terminaEnNumero(linea)) continue;
    const nombre = (linea.split(",")[0] ?? "").trim();
    const n = Number(linea.slice(linea.lastIndexOf(",") + 1).trim());
    if (nombre.length >= 2 && Number.isInteger(n) && n >= 1) salida.push({ nombre, n });
  }
  return salida;
}

/**
 * Pinta todo lo del modo: la pregunta por los números que ya trae la lista, el botón que abre el panel y,
 * si está abierto, el panel entero. Lo llama `renderNames`, así que cualquier cambio del cuadro (tocar un
 * contador, editar a mano, cambiar de idioma o de modo) lo deja al día.
 */
function pintarVarias(): void {
  pintarPreguntaDeNumeros();
  const boton = document.getElementById("btn-varias") as HTMLButtonElement | null;
  const panel = document.getElementById("varias-panel");
  if (!boton || !panel) return;
  const puede = variasALaVista() && !listaCerrada() && parseNames().length >= 2;
  const turnos = modoTurnosActivo();
  boton.hidden = !puede;
  boton.textContent = t(turnos ? "partAbrirTurnos" : "partAbrir");
  boton.setAttribute("aria-expanded", String(puede && panelAbierto));
  panel.hidden = !(puede && panelAbierto);
  if (!puede || !panelAbierto) return;
  const titulo = document.getElementById("varias-titulo");
  if (titulo) titulo.textContent = t(turnos ? "partTituloTurnos" : "partTitulo");
  const texto = $<HTMLTextAreaElement>("ta").value;
  const personas = personasDelCuadro(texto);
  const cuenta = contar(parseNames());
  const elCuenta = document.getElementById("varias-cuenta");
  if (elCuenta) elCuenta.textContent = turnos ? T[getLang()].partCuentaTurnos(cuenta.personas, cuenta.participaciones) : T[getLang()].partCuenta(cuenta.personas, cuenta.participaciones);
  const elTope = document.getElementById("varias-tope");
  if (elTope) {
    const enElTope = quedaronEnElTope.filter((nombre) => personas.some((p) => p.nombre === nombre && p.veces >= TOPE_POR_PERSONA));
    elTope.textContent = enElTope.length ? T[getLang()].partTopeAviso(listaDeNombres(enElTope), enElTope.length > 1) : "";
    elTope.hidden = !enElTope.length;
  }
  const buscar = document.getElementById("varias-buscar-fila");
  if (buscar) buscar.hidden = personas.length <= 10;
  pintarFilasDelPanel(personas);
}

/**
 * Las filas del panel: una por persona, con su contador para tocar. Con más de diez personas el buscador
 * filtra por lo que se escribe, sin tocar el cuadro.
 */
function pintarFilasDelPanel(personas = personasDelCuadro($<HTMLTextAreaElement>("ta").value)): void {
  const lista = document.getElementById("varias-lista");
  if (!lista) return;
  const buscado = ($<HTMLInputElement>("varias-buscar").value ?? "").trim().toLocaleLowerCase();
  const visibles = buscado ? personas.filter((p) => p.nombre.toLocaleLowerCase().includes(buscado)) : personas;
  const turnos = modoTurnosActivo();
  lista.textContent = "";
  for (const p of visibles) {
    const fila = document.createElement("div");
    fila.className = "varias-fila";
    const nombre = document.createElement("span");
    nombre.className = "varias-nombre";
    nombre.textContent = p.nombre;
    const control = document.createElement("span");
    control.className = "varias-control";
    const menos = document.createElement("button");
    menos.type = "button";
    menos.className = "varias-menos";
    menos.textContent = "−";
    menos.dataset.persona = p.nombre;
    menos.setAttribute("aria-label", t(turnos ? "partQuitarTurno" : "partQuitar").replace("{nombre}", p.nombre));
    menos.disabled = p.veces <= 1 || listaCerrada();
    menos.addEventListener("click", () => cambiarVeces(p.nombre, p.veces - 1, "menos"));
    const numero = document.createElement("span");
    numero.className = p.veces > 1 ? "varias-num varias" : "varias-num";
    const cifra = document.createElement("b");
    cifra.textContent = String(p.veces);
    numero.append(cifra);
    if (p.veces >= TOPE_POR_PERSONA) {
      const maximo = document.createElement("small");
      maximo.textContent = t("partMax");
      numero.append(maximo);
    }
    const mas = document.createElement("button");
    mas.type = "button";
    mas.className = "varias-mas";
    mas.textContent = "+";
    mas.dataset.persona = p.nombre;
    mas.setAttribute("aria-label", t(turnos ? "partSumarTurno" : "partSumar").replace("{nombre}", p.nombre));
    mas.disabled = p.veces >= TOPE_POR_PERSONA || listaCerrada();
    mas.addEventListener("click", () => cambiarVeces(p.nombre, p.veces + 1, "mas"));
    control.append(menos, numero, mas);
    fila.append(nombre, control);
    lista.append(fila);
  }
  const sin = document.getElementById("varias-sin");
  if (sin) sin.hidden = visibles.length > 0;
}

/** Un toque en el contador: reescribe el cuadro en el acto y el foco vuelve al mismo botón. */
function cambiarVeces(persona: string, veces: number, lado: "mas" | "menos"): void {
  if (listaCerrada()) return;
  const ta = $<HTMLTextAreaElement>("ta");
  const nuevo = ponerParticipaciones(ta.value, persona, veces);
  if (nuevo === ta.value) return;
  reemplazar(ta, nuevo);
  // El panel se repintó con el cuadro nuevo: el botón tocado es otro elemento, y el foco vuelve a él.
  const botones = [...document.querySelectorAll<HTMLButtonElement>("#varias-lista button")];
  const mismo = botones.find((b) => b.dataset.persona === persona && b.classList.contains(lado === "mas" ? "varias-mas" : "varias-menos"));
  const otro = botones.find((b) => b.dataset.persona === persona);
  (mismo && !mismo.disabled ? mismo : otro)?.focus();
}

/**
 * La pregunta de debajo del cuadro: una lista pegada que ya trae un número al lado de los nombres puede ser
 * las veces que participa cada uno, o la edad o la mesa. Por eso se pregunta y no se cambia nada hasta que
 * la persona responde. Con «No» no se pregunta de nuevo por esa misma lista.
 */
function pintarPreguntaDeNumeros(): void {
  const aviso = document.getElementById("participaciones-aviso");
  if (!aviso) return;
  const texto = $<HTMLTextAreaElement>("ta").value;
  const numeros = variasALaVista() && !listaCerrada() && texto !== listaSinUsarNumeros ? numerosDeLaLista(texto) : [];
  aviso.style.display = numeros.length ? "" : "none";
  if (!numeros.length) return;
  const pregunta = document.getElementById("part-pregunta-texto");
  if (pregunta) pregunta.textContent = T[getLang()].partPregunta(numeros.length);
}

/**
 * «Sí, usarlos»: los números de la lista pasan a ser una línea por participación, con el máximo de siempre
 * por persona, y el panel se abre para que se vea cómo quedó. Quién pasó del máximo queda dicho arriba del
 * panel, en una sola línea.
 */
function usarNumerosDeLaLista(): void {
  if (listaCerrada()) return;
  const ta = $<HTMLTextAreaElement>("ta");
  const numeros = numerosDeLaLista(ta.value);
  if (!numeros.length) return;
  const totales = new Map<string, number>();
  for (const { nombre, n } of numeros) totales.set(nombre, (totales.get(nombre) ?? 0) + n);
  quedaronEnElTope = [...totales.entries()].filter(([, total]) => total > TOPE_POR_PERSONA).map(([nombre]) => nombre);
  // Cada número se corta al máximo antes de repartir: `repartir` suma los repetidos y vuelve a cortar por persona.
  const ajustado = ta.value
    .split(/\r?\n/)
    .map((linea) => {
      if (!terminaEnNumero(linea)) return linea;
      const { nombre, n } = numerosDeLaLista(linea)[0] ?? { nombre: "", n: 0 };
      return nombre ? `${nombre}, ${Math.min(n, TOPE_POR_PERSONA)}` : linea;
    })
    .join("\n");
  const repartido = repartir(ajustado);
  panelAbierto = true;
  if (repartido !== null && repartido !== ta.value) reemplazar(ta, repartido);
  else pintarVarias();
  // Aplicados, los parecidos se siguen diciendo: «ana quispe» y «Ana Quispe» quedan como dos personas.
  const pares = parecidos([...new Set(parseNames().map(nombreDePersona))]);
  const [par] = pares;
  if (par) avisar((L) => L.pegParecidos(par[0], par[1], pares.length - 1));
}

/**
 * Reemplaza todo el texto del cuadro, deshacible con Ctrl+Z como cualquier pegar (ver `insertar`): se marca todo
 * y se escribe encima con `execCommand`, que lo deja en el historial del cuadro.
 */
function reemplazar(ta: HTMLTextAreaElement, text: string): void {
  const plano = text.replace(/\r\n?/g, "\n");
  ta.focus();
  ta.setSelectionRange(0, ta.value.length);
  // Solo con el foco en el cuadro: si no lo tomó, `execCommand` escribiría en otro lado. Donde no existe, se escribe a mano.
  if (document.activeElement === ta && typeof document.execCommand === "function" && document.execCommand("insertText", false, plano)) return;
  ta.setRangeText(plano, 0, ta.value.length, "end");
  ta.dispatchEvent(new Event("input", { bubbles: true }));
}

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
    (r.skipped ? `, ${L.impSkippedShort(r.skipped)}` : "");
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
    else sessionStorage.setItem(BORRADOR, JSON.stringify({ texto, premio, nw: ganadoresPedidos(), ...(modoTurnosActivo() ? { modo: "turnos" } : modoVigente() === "varias" ? { modo: "varias" } : {}) }));
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
  type Guardado = { texto?: unknown; premio?: unknown; nw?: unknown; modo?: unknown } | null;
  let b: Guardado;
  try {
    b = JSON.parse(sessionStorage.getItem(BORRADOR) ?? "null") as Guardado;
  } catch {
    return;
  }
  if (!b || typeof b.texto !== "string") return;
  // El modo de varias participaciones vuelve con la lista, antes de pintarla: sin él, la lista repartida se
  // contaría por líneas y «No está» sacaría una línea en vez de a la persona entera.
  if (b.modo === "varias") recordarModo("varias");
  setList(b.texto);
  if (typeof b.premio === "string" && b.premio.trim()) ponerPremio(b.premio);
  const nw = Number(b.nw);
  // Un borrador torcido (más que el protocolo) no se repone; y uno de más que lo que esta red admite baja a lo que admite.
  if (Number.isInteger(nw) && nw >= 1 && nw <= MAX_WINNERS) ponerGanadores(Math.min(nw, topeDeGanadores()));
  // El modo «Orden de turnos» vuelve con la lista (la cantidad pasa a ser la de la lista, no la que quedó guardada).
  if (b.modo === "turnos") ponerModoTurnos(true);
  if (canonicalList(b.texto).length) avisar(() => t("borradorRepuesto"));
}

function hideSummary(): void {
  lastResult = null;
  $("csv-pick").style.display = "none";
}
