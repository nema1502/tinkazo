import { onLangChange, t } from "../i18n";
import { modesVisible, requestedMode } from "../modos/bandera";
import { isTurnPrize, turnPrize } from "../modos/turnos";
import { topeDeGanadores } from "../stellar/config";
import { fijarGanadores, ponerGanadores } from "./ganadores";
import { ponerPremio } from "./premios";

/**
 * La opción «Orden de turnos», dentro del pliegue de «Cuántos ganan» (`#turnos-opcion` de `index.html`).
 *
 * Prendida, la herramienta sortea a todas las personas de la lista, en orden, y ese orden son los turnos. No hay un sorteo
 * distinto por debajo: es el de siempre con tantos premios como personas, así que el sello, el contrato y el comprobante
 * quedan como están (ver `src/modos/turnos.ts`). Lo que cambia es cómo se elige:
 *
 * - La cantidad es la de la lista y no se toca: sigue a la lista mientras se agrega o se saca gente (`seguirLaLista`).
 * - El nombre queda en «Turnos», editable. Tiene que empezar con «Turnos» o «Turns» para que el resultado se reconozca como
 *   orden; si la persona lo cambia por otra cosa, la palabra se le pone por delante y se ve en el cuadro.
 * - Si la lista pasa de lo que admite el contrato de esta red, no se puede sellar: un orden incompleto nunca se presenta
 *   como un orden de turnos. No es un aviso, es que el botón de sellar queda apagado (`ordenNoCabe`).
 *
 * Está escondida salvo con la bandera `VITE_MODOS` o con `?modo=turnos` en la dirección (`src/modos/bandera.ts`). Sin
 * ninguna de las dos, la herramienta es la de siempre: nada de esto se ve ni cambia.
 *
 * El estado vive acá y no en el campo: el campo sigue siendo la fuente de verdad de la cantidad (`ganadoresPedidos`) y el
 * del nombre (`#prize`), como siempre. Este módulo solo los escribe. Cuando cambia el modo avisa con `tinkazo:modo`, en la
 * propia opción (`#turnos-opcion`), para que la lista (`participants.ts`) vuelva a pintarse y guarde el borrador.
 */

let encendido = false;
/** Cuántas personas hay en la lista, la última vez que se miró. */
let personas = 0;
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

/** Los rótulos que cambian con el modo: se cambia la clave (`data-i`) y el cambio de idioma los sigue traduciendo. */
const ROTULOS: ReadonlyArray<readonly [selector: string, apagado: string, prendido: string]> = [
  ['label[for="nw"]', "winners", "turnsCount"],
  ["#prize-etiqueta", "prizeLabel", "turnsPrizeLabel"],
  ["#mas-opciones > summary", "masOpciones", "turnsMas"],
];

/** Pone en pantalla lo que depende del modo: el botón, los rótulos, lo que sobra y el aviso del tope. */
function pintar(): void {
  const boton = $id("btn-turnos");
  boton?.setAttribute("aria-pressed", String(encendido));
  for (const [selector, apagado, prendido] of ROTULOS) {
    const el = document.querySelector<HTMLElement>(selector);
    if (!el) continue;
    el.dataset.i = encendido ? prendido : apagado;
    el.textContent = t(el.dataset.i);
  }
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
  // Con el modo prendido la opción se ve aunque la dirección ya no traiga `?modo=` (volver de entrar con Google).
  const opcion = $id("turnos-opcion");
  if (opcion) opcion.hidden = !(encendido || modesVisible());
  pintarAviso();
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
 * La cantidad sigue a la lista. La llama `renderNames` cada vez que la lista cambia. Con el modo apagado solo anota
 * cuántas personas hay.
 */
export function seguirLaLista(n: number): void {
  personas = n;
  if (!encendido) return;
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
    // La opción está dentro del pliegue: si se prendió por la dirección, se abre para que se vea qué quedó elegido.
    const mas = $id<HTMLDetailsElement>("mas-opciones");
    if (mas) mas.open = true;
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

/** Con la lista cerrada (sellando o ya sellada) el modo no se cambia. */
export function bloquearTurnos(si: boolean): void {
  const boton = $id<HTMLButtonElement>("btn-turnos");
  if (boton) boton.disabled = si;
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
 * Arma la opción: la muestra si la bandera o la dirección lo piden, la escucha y vuelve a escribir lo que depende del
 * idioma. Se llama una vez al cargar. No prende nada: eso lo hace `abrirConElModoPedido` o el borrador.
 */
export function montarTurnos(): void {
  const opcion = $id("turnos-opcion");
  const boton = $id<HTMLButtonElement>("btn-turnos");
  if (!opcion || !boton || montado) return;
  montado = true;
  opcion.hidden = !modesVisible();
  boton.addEventListener("click", () => {
    if (!boton.disabled) ponerModoTurnos(!encendido);
  });
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
