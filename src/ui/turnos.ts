import { onLangChange, t } from "../i18n";
import { modesVisible, requestedMode } from "../modos/bandera";
import { isTurnPrize, turnPrize } from "../modos/turnos";
import { topeDeGanadores } from "../stellar/config";
import { fijarGanadores, ponerGanadores } from "./ganadores";
import { ponerPremio } from "./premios";

/**
 * El modo del sorteo, elegido a la vista: el selector de arriba de la lista (`#turnos-opcion` de `index.html`), con dos
 * botones grandes, Sortear premios (`#btn-modo-sorteo`) y Orden de turnos (`#btn-turnos`). Hasta el 13 de noviembre de
 * 2026 el orden era un renglón dentro del pliegue de las opciones y casi nadie lo encontraba. Es una elección previa: no
 * lleva el color de las acciones y no compite con Pegar lista ni con Sellar la lista.
 *
 * Con el orden elegido, la herramienta sortea a todas las personas de la lista, en orden, y ese orden son los turnos. No
 * hay un sorteo distinto por debajo: es el de siempre con tantos premios como personas, así que el sello, el contrato y el
 * comprobante quedan como están (ver `src/modos/turnos.ts`). Lo que cambia es cómo se elige:
 *
 * - La cantidad es la de la lista y no se toca: sigue a la lista mientras se agrega o se saca gente (`seguirLaLista`).
 * - El nombre queda en «Turnos», editable. Tiene que empezar con «Turnos» o «Turns» para que el resultado se reconozca como
 *   orden; si la persona lo cambia por otra cosa, la palabra se le pone por delante y se ve en el cuadro.
 * - Si la lista pasa de lo que admite el contrato de esta red, no se puede sellar: un orden incompleto nunca se presenta
 *   como un orden de turnos. No es un aviso, es que el botón de sellar queda apagado (`ordenNoCabe`).
 * - El título del paso y la ayuda de debajo del selector dicen lo que va a pasar: que salen todos, en orden.
 *
 * Está escondido salvo con la bandera `VITE_MODOS` o con `?modo=turnos` en la dirección (`src/modos/bandera.ts`). Sin
 * ninguna de las dos, la herramienta es la de siempre: nada de esto se ve ni cambia.
 *
 * El estado vive acá y no en el campo: el campo sigue siendo la fuente de verdad de la cantidad (`ganadoresPedidos`) y el
 * del nombre (`#prize`), como siempre. Este módulo solo los escribe. Cuando cambia el modo avisa con `tinkazo:modo`, en el
 * propio selector (`#turnos-opcion`), para que la lista (`participants.ts`) vuelva a pintarse y guarde el borrador.
 */

let encendido = false;
/** Cuántas personas hay en la lista, la última vez que se miró. */
let personas = 0;
/** La lista está cerrada (sellando o ya sellada, `bloquearTurnos`): la cantidad es la sellada y ya no sigue a la lista. */
let cerrada = false;
/** Lo que decían el campo de la cantidad y el nombre antes de prender el modo, para devolverlos al apagarlo. */
let cantidadAntes = "";
let premioAntes = "";

const $id = <T extends HTMLElement>(id: string): T | null => document.getElementById(id) as T | null;

/** ¿Está prendido el modo? */
export const modoTurnosActivo = (): boolean => encendido;

/** ¿La lista pasa de lo que esta red admite en un orden? Con el modo apagado nunca: ahí manda el tope de siempre. */
export const ordenNoCabe = (n: number = personas): boolean => encendido && n > topeDeGanadores();

/** El nombre por defecto del orden, en el idioma de ahora. */
const premioPorDefecto = (): string => t("turnsPrize");

/** ¿El nombre es justo el de por defecto, en cualquiera de los dos idiomas? */
const esElDeSiempre = (premio: string): boolean => ["Turnos", "Turns"].includes(premio.trim());

/**
 * Los rótulos que cambian con el modo: se cambia la clave (`data-i`) y el cambio de idioma los sigue traduciendo. El título
 * del paso y la ayuda de debajo del selector dicen lo que va a pasar.
 */
const ROTULOS: ReadonlyArray<readonly [selector: string, apagado: string, prendido: string]> = [
  ['label[for="nw"]', "winners", "turnsCount"],
  ["#prize-etiqueta", "prizeLabel", "turnsPrizeLabel"],
  ["#p1-titulo", "p1", "turnsTitulo"],
  ["#turnos-ayuda", "modoSorteoAyuda", "turnsHelp"],
];

/**
 * El rótulo del pliegue de las opciones dice lo que guarda: en el sorteo común, el premio, cuántos ganan y el CSV; con el
 * orden elegido, el nombre de los turnos y el CSV. El modo ya no se elige ahí adentro.
 */
const claveDelPliegue = (): string => (encendido ? "turnsMas" : "masOpciones");

function rotularElPliegue(): void {
  const el = document.querySelector<HTMLElement>("#mas-opciones > summary");
  if (!el) return;
  el.dataset.i = claveDelPliegue();
  el.textContent = t(el.dataset.i);
}

/** Pone en pantalla lo que depende del modo: los dos botones, los rótulos, lo que sobra y el aviso del tope. */
function pintar(): void {
  $id("btn-turnos")?.setAttribute("aria-pressed", String(encendido));
  $id("btn-modo-sorteo")?.setAttribute("aria-pressed", String(!encendido));
  // La marca del elegido se desliza de un botón al otro (styles.css, `.modo-botones`).
  const grupo = $id("modo-botones");
  if (grupo) grupo.dataset.modo = encendido ? "turnos" : "sorteo";
  for (const [selector, apagado, prendido] of ROTULOS) {
    const el = document.querySelector<HTMLElement>(selector);
    if (!el) continue;
    el.dataset.i = encendido ? prendido : apagado;
    el.textContent = t(el.dataset.i);
  }
  rotularElPliegue();
  // El texto flotante de «Copiar las bases» no dice quién gana: se cambia la clave y el cambio de idioma la sigue.
  const bases = $id("btn-rules");
  if (bases) {
    bases.dataset.iTitle = encendido ? "turnsRulesNote" : "rulesNote";
    bases.title = t(bases.dataset.iTitle);
  }
  // Los premios sugeridos («Termo», «Polera») y los atajos de cuántos ganan no tienen sentido en un orden.
  for (const id of ["prize-chips", "nw-atajos"]) {
    const el = $id(id);
    if (el) el.style.display = encendido ? "none" : "";
  }
  // Con el modo prendido el selector se ve aunque la dirección ya no traiga `?modo=` (volver de entrar con Google).
  const opcion = $id("turnos-opcion");
  if (opcion) opcion.hidden = !(encendido || modesVisible());
  pintarAviso();
}

/**
 * Lo que cambia al tocar un modo se nota: el título del paso y la ayuda entran con un movimiento corto (styles.css,
 * `.modo-cambia`, apagado con `prefers-reduced-motion`). Se vuelve a disparar en cada cambio.
 */
function animarElCambio(): void {
  for (const id of ["p1-titulo", "turnos-ayuda"]) {
    const el = $id(id);
    if (!el) continue;
    el.classList.remove("modo-cambia");
    void el.offsetWidth;
    el.classList.add("modo-cambia");
  }
}

/** «En esta red el orden llega hasta N turnos», solo cuando la lista no entra: lo que cuenta son las líneas, no las personas. */
function pintarAviso(): void {
  const nota = $id("turnos-nota");
  if (!nota) return;
  const excede = ordenNoCabe();
  nota.textContent = excede ? t("turnsLimit").replace("{n}", String(topeDeGanadores())) : "";
  nota.hidden = !excede;
}

/**
 * La cantidad sigue a la lista. La llama `renderNames` cada vez que la lista cambia. Con el modo apagado, o con la lista
 * cerrada, solo anota cuántas personas hay: lo sellado no se reescribe (al retomar un sorteo común con el modo prendido,
 * la lista que se vuelve a pintar ponía todos como ganadores).
 */
export function seguirLaLista(n: number): void {
  personas = n;
  if (!encendido || cerrada) return;
  // El campo es de 1 a 300 (el protocolo): una lista más larga que lo que admite la red se ve entera y no se puede sellar.
  ponerGanadores(n);
  pintarAviso();
}

/** Prende o apaga el modo. Devuelve al campo lo que tenía si se apaga. */
export function ponerModoTurnos(si: boolean): void {
  if (si === encendido) return;
  const campo = $id<HTMLInputElement>("nw");
  const premio = $id<HTMLInputElement>("prize");
  encendido = si;
  fijarGanadores(si);
  if (si) {
    cantidadAntes = campo?.value ?? "";
    premioAntes = premio?.value ?? "";
    // El modo elegido se ve en el selector, arriba de la lista: el pliegue de las opciones no se abre para mostrarlo.
    ponerPremio(turnPrize(isTurnPrize(premioAntes) ? premioAntes : "", premioPorDefecto()));
    ponerGanadores(personas);
  } else {
    ponerGanadores(Number(cantidadAntes) || 1);
    // El nombre que puso la persona se queda; el de por defecto se va y vuelve lo que había antes.
    if (premio && esElDeSiempre(premio.value)) ponerPremio(isTurnPrize(premioAntes) ? "" : premioAntes);
  }
  pintar();
  $id("turnos-opcion")?.dispatchEvent(new CustomEvent("tinkazo:modo"));
}

/** Con la lista cerrada (sellando o ya sellada) el modo no se cambia: los dos botones se apagan y el selector se queda quieto. */
export function bloquearTurnos(si: boolean): void {
  cerrada = si;
  for (const id of ["btn-turnos", "btn-modo-sorteo"]) {
    const boton = $id<HTMLButtonElement>(id);
    if (boton) boton.disabled = si;
  }
}

/** Antes de sellar: el nombre del orden tiene que empezar con «Turnos» o «Turns». Devuelve el nombre que queda. */
export function ajustarPremioDeTurnos(): string {
  const premio = $id<HTMLInputElement>("prize");
  if (!encendido || !premio) return premio?.value.trim() ?? "";
  const queda = turnPrize(premio.value, premioPorDefecto());
  if (queda !== premio.value) ponerPremio(queda);
  return queda;
}

let montado = false;

/**
 * Arma el selector: lo muestra si la bandera o la dirección lo piden, escucha los dos botones y vuelve a escribir lo que
 * depende del idioma. Se llama una vez al cargar. No prende nada: eso lo hace `abrirConElModoPedido` o el borrador.
 */
export function montarTurnos(): void {
  const opcion = $id("turnos-opcion");
  const boton = $id<HTMLButtonElement>("btn-turnos");
  if (!opcion || !boton || montado) return;
  montado = true;
  opcion.hidden = !modesVisible();
  rotularElPliegue();
  // Cada botón elige su modo. Tocar el que ya está elegido no hace nada: no es un interruptor.
  const elegir = (si: boolean, desde: HTMLButtonElement): void => {
    if (desde.disabled || si === encendido) return;
    ponerModoTurnos(si);
    animarElCambio();
  };
  boton.addEventListener("click", () => elegir(true, boton));
  const sorteo = $id<HTMLButtonElement>("btn-modo-sorteo");
  sorteo?.addEventListener("click", () => elegir(false, sorteo));
  // Al salir del nombre, si no empieza con «Turnos», se le pone la palabra por delante.
  $id("prize")?.addEventListener("change", () => void ajustarPremioDeTurnos());
  onLangChange(() => {
    // El nombre por defecto se traduce; uno escrito por la persona no se toca.
    const premio = $id<HTMLInputElement>("prize");
    if (encendido && premio && esElDeSiempre(premio.value)) ponerPremio(premioPorDefecto());
    pintarAviso();
  });
}

/** Si la dirección pide `?modo=turnos`, la herramienta abre con la opción ya elegida. */
export function abrirConElModoPedido(): void {
  if (requestedMode() === "turnos") ponerModoTurnos(true);
}
