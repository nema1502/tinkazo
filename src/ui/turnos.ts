import { onLangChange, t } from "../i18n";
import { modesVisible, requestedMode } from "../modos/bandera";
import { isSecretSantaPrize, noHaySecreto, secretPrize } from "../modos/amigo";
import { isTurnPrize, turnPrize } from "../modos/turnos";
import { topeDeGanadores } from "../stellar/config";
import { fijarGanadores, ponerGanadores } from "./ganadores";
import { actualizarLugares, bloquearLugares, ponerPremio } from "./premios";

/**
 * El modo del sorteo, elegido a la vista: el selector de arriba de la lista (`#turnos-opcion` de `index.html`), con tres
 * botones grandes: Sortear premios (`#btn-modo-sorteo`), Orden de turnos (`#btn-turnos`) y Amigo secreto (`#btn-amigo`,
 * armado acá, issue #99). Hasta el 13 de noviembre de 2026 el orden era un renglón dentro del pliegue de las opciones y
 * casi nadie lo encontraba. Es una elección previa: no lleva el color de las acciones y no compite con Pegar lista ni
 * con Sellar la lista.
 *
 * El orden y el Amigo secreto usan el mismo sorteo: ganan todas las personas y el resultado es una permutación completa
 * de la lista. No hay un sorteo distinto por debajo: es el de siempre con tantos premios como personas, así que el sello,
 * el contrato y el comprobante quedan como están (ver `src/modos/turnos.ts` y `src/modos/amigo.ts`). Lo que cambia es
 * cómo se elige y cómo se muestra:
 *
 * - La cantidad es la de la lista y no se toca: sigue a la lista mientras se agrega o se saca gente (`seguirLaLista`).
 * - El nombre queda en «Turnos» o en «Amigo secreto», editable. Tiene que empezar con la frase de su modo para que el
 *   resultado se reconozca; si la persona lo cambia por otra cosa, la frase se le pone por delante y se ve en el cuadro.
 * - Si la lista pasa de lo que admite el contrato de esta red, no se puede sellar: un orden incompleto nunca se presenta
 *   como un orden, ni un Amigo secreto a medias como un Amigo secreto. No es un aviso, es que el botón de sellar queda
 *   apagado (`ordenNoCabe`).
 * - El título del paso y la ayuda de debajo del selector dicen lo que va a pasar. En el Amigo secreto, una línea más
 *   (`#amigo-privacidad`) dice lo que se decidió sobre la privacidad: quien tenga la lista y el número podría calcular
 *   el reparto, y con 2 o 3 personas no hay secreto (S3).
 *
 * El botón del Amigo secreto se arma acá y no en el HTML porque el selector vive en `index.html`, que es de producción:
 * así el markup de siempre no cambia y el modo entra con su propia pieza.
 *
 * Está escondido salvo con la bandera `VITE_MODOS` o con `?modo=turnos` en la dirección (`src/modos/bandera.ts`). Sin
 * ninguna de las dos, la herramienta es la de siempre: nada de esto se ve ni cambia.
 *
 * El estado vive acá y no en el campo: el campo sigue siendo la fuente de verdad de la cantidad (`ganadoresPedidos`) y
 * el del nombre (`#prize`), como siempre. Este módulo solo los escribe. Cuando cambia el modo avisa con `tinkazo:modo`,
 * en el propio selector (`#turnos-opcion`), para que la lista (`participants.ts`) vuelva a pintarse y guarde el borrador.
 */

let encendido = false;
/** El sub-modo elegido con la lista que sigue: un orden de turnos o un Amigo secreto. Solo importa con `encendido`. */
let amigo = false;
/** Cuántas personas hay en la lista, la última vez que se miró. */
let personas = 0;
/** La lista está cerrada (sellando o ya sellada, `bloquearTurnos`): la cantidad es la sellada y ya no sigue a la lista. */
let cerrada = false;
/** Lo que decían el campo de la cantidad y el nombre antes de prender el modo, para devolverlos al apagarlo. */
let cantidadAntes = "";
let premioAntes = "";

const $id = <T extends HTMLElement>(id: string): T | null => document.getElementById(id) as T | null;

/** ¿Está prendido el modo de la lista que sigue (orden o Amigo secreto)? La usa la lista y el borrador. */
export const modoTurnosActivo = (): boolean => encendido;

/** ¿Está prendido el Amigo secreto? La usan el resultado y el mensaje (`draw.ts`). */
export const modoAmigoActivo = (): boolean => encendido && amigo;

/** ¿La lista pasa de lo que esta red admite en un orden o un Amigo secreto? Con el modo apagado nunca: ahí manda el tope de siempre. */
export const ordenNoCabe = (n: number = personas): boolean => encendido && n > topeDeGanadores();

/** El nombre por defecto del modo elegido, en el idioma de ahora. */
const premioPorDefecto = (): string => t(amigo ? "amigoPrize" : "turnsPrize");

/** ¿El nombre es justo el de por siempre de alguno de los dos modos, en cualquiera de los dos idiomas? */
const esElDeSiempre = (premio: string): boolean =>
  ["Turnos", "Turns", "Amigo secreto", "Secret Santa"].includes(premio.trim());

/** ¿El nombre ya empieza con la frase de alguno de los dos modos? */
const esDeAlgunModo = (premio: string): boolean => isTurnPrize(premio) || isSecretSantaPrize(premio);

/** El nombre que queda en el modo elegido: el que escribió la persona si ya empieza con la frase, la frase sola si no escribió nada, y la frase por delante si no. */
const nombreDelModo = (texto: string): string => (amigo ? secretPrize(texto, t("amigoPrize")) : turnPrize(texto, t("turnsPrize")));

/**
 * Los rótulos que cambian con el modo: se cambia la clave (`data-i`) y el cambio de idioma los sigue traduciendo. El
 * título del paso y la ayuda de debajo del selector dicen lo que va a pasar. [selector, apagado, turnos, amigo].
 */
const ROTULOS: ReadonlyArray<readonly [selector: string, apagado: string, turnos: string, amigo: string]> = [
  ['label[for="nw"]', "winners", "turnsCount", "amigoCount"],
  ["#prize-etiqueta", "prizeLabel", "turnsPrizeLabel", "amigoPrizeLabel"],
  ["#p1-titulo", "p1", "turnsTitulo", "amigoTitulo"],
  ["#turnos-ayuda", "modoSorteoAyuda", "turnsHelp", "amigoHelp"],
];

/** El rótulo del pliegue de las opciones dice lo que guarda: en el sorteo común, el premio, cuántos ganan y el CSV; con el orden, el nombre de los turnos y el CSV; con el Amigo secreto, el suyo y el CSV. */
const claveDelPliegue = (): string => (!encendido ? "masOpciones" : amigo ? "amigoMas" : "turnsMas");

/** El texto flotante de «Copiar las bases», que no dice quién gana en ninguno de los tres modos. */
const claveDeLasBases = (): string => (!encendido ? "rulesNote" : amigo ? "amigoRulesNote" : "turnsRulesNote");

function rotularElPliegue(): void {
  const el = document.querySelector<HTMLElement>("#mas-opciones > summary");
  if (!el) return;
  el.dataset.i = claveDelPliegue();
  el.textContent = t(el.dataset.i);
}

/**
 * El tercer botón del selector, Amigo secreto. Se arma acá la primera vez que los modos están a la vista: el markup de
 * `index.html` no cambia, y sin la bandera ni el parámetro no existe.
 */
function armarBotonAmigo(): HTMLButtonElement | null {
  const ya = $id<HTMLButtonElement>("btn-amigo");
  if (ya) return ya;
  const grupo = $id("modo-botones");
  if (!grupo || !(modesVisible() || encendido)) return null;
  const b = document.createElement("button");
  b.type = "button";
  b.id = "btn-amigo";
  b.className = "modo-op";
  b.setAttribute("aria-pressed", "false");
  b.setAttribute("aria-describedby", "turnos-ayuda");
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "modo-ico");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute(
    "d",
    "M4 10h16v4H4zM6 14h12v7H6zM12 10v11M12 10c-2 0-4-.8-4-2.5S10.5 5 12 7c1.5-2 4.5-1.2 4.5.5S14 10 12 10z",
  );
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", "currentColor");
  path.setAttribute("stroke-width", "2");
  path.setAttribute("stroke-linejoin", "round");
  svg.appendChild(path);
  b.appendChild(svg);
  const tit = document.createElement("span");
  tit.className = "modo-tit";
  tit.dataset.i = "amigoOption";
  tit.textContent = t("amigoOption");
  const sub = document.createElement("span");
  sub.className = "modo-sub";
  sub.dataset.i = "amigoSub";
  sub.textContent = t("amigoSub");
  b.append(tit, sub);
  grupo.appendChild(b);
  b.addEventListener("click", () => elegirAmigo(b));
  return b;
}

/** Tocar «Amigo secreto»: prende el modo con la lista que sigue, salvo que ya esté elegido. */
function elegirAmigo(desde: HTMLButtonElement): void {
  if (desde.disabled || (encendido && amigo)) return;
  ponerModoAmigo(true);
  animarElCambio();
}

/** La línea de privacidad antes de sellar (S3). Se arma una vez, junto a la ayuda del selector. */
function armarLineaDePrivacidad(): HTMLElement | null {
  let el = $id<HTMLElement>("amigo-privacidad");
  if (el) return el;
  const ayuda = $id("turnos-ayuda");
  if (!ayuda) return null;
  el = document.createElement("p");
  el.id = "amigo-privacidad";
  el.className = "note amigo-privacidad";
  el.setAttribute("role", "status");
  el.hidden = true;
  ayuda.after(el);
  return el;
}

/** Pone en pantalla lo que depende del modo: los tres botones, los rótulos, lo que sobra, el aviso del tope y la línea de privacidad. */
function pintar(): void {
  armarBotonAmigo();
  $id("btn-turnos")?.setAttribute("aria-pressed", String(encendido && !amigo));
  $id("btn-amigo")?.setAttribute("aria-pressed", String(encendido && amigo));
  $id("btn-modo-sorteo")?.setAttribute("aria-pressed", String(!encendido));
  // La marca del elegido se desliza de un botón al otro (styles.css, `.modo-botones`).
  const grupo = $id("modo-botones");
  if (grupo) grupo.dataset.modo = !encendido ? "sorteo" : amigo ? "amigo" : "turnos";
  for (const [selector, apagado, turnos, deAmigo] of ROTULOS) {
    const el = document.querySelector<HTMLElement>(selector);
    if (!el) continue;
    el.dataset.i = !encendido ? apagado : amigo ? deAmigo : turnos;
    el.textContent = t(el.dataset.i);
  }
  rotularElPliegue();
  // El texto flotante de «Copiar las bases» no dice quién gana: se cambia la clave y el cambio de idioma la sigue.
  const bases = $id("btn-rules");
  if (bases) {
    bases.dataset.iTitle = claveDeLasBases();
    bases.title = t(bases.dataset.iTitle);
  }
  // Los premios sugeridos («Termo», «Polera») y los atajos de cuántos ganan no tienen sentido cuando salen todos.
  for (const id of ["prize-chips", "nw-atajos"]) {
    const el = $id(id);
    if (el) el.style.display = encendido ? "none" : "";
  }
  // Tampoco los campos por lugar: un orden no tiene premios, y el nombre empieza con «Turnos» en el cuadro de siempre.
  bloquearLugares(encendido);
  actualizarLugares();
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

/** El orden y el Amigo secreto llegan hasta N en este modo. El aviso sale solo cuando la lista no entra: cuenta las líneas, no las personas. */
function pintarAviso(): void {
  const nota = $id("turnos-nota");
  if (nota) {
    const excede = ordenNoCabe();
    nota.textContent = excede ? t("turnsLimit").replace("{n}", String(topeDeGanadores())) : "";
    nota.hidden = !excede;
  }
  // La línea de privacidad (S3): con el Amigo secreto elegido, lo que se decidió. Con 2 o 3 personas, que no hay secreto.
  const linea = armarLineaDePrivacidad();
  if (linea) {
    linea.textContent = amigo ? t(noHaySecreto(personas) ? "amigoPrivacidadPoca" : "amigoPrivacidad") : "";
    linea.hidden = !amigo;
  }
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

/** Prende el modo de la lista que sigue: un orden de turnos o un Amigo secreto. Devuelve al campo lo que tenía si se apaga. */
function prender(comoAmigo: boolean): void {
  const campo = $id<HTMLInputElement>("nw");
  const premio = $id<HTMLInputElement>("prize");
  encendido = true;
  amigo = comoAmigo;
  fijarGanadores(true);
  cantidadAntes = campo?.value ?? "";
  premioAntes = premio?.value ?? "";
  // El modo elegido se ve en el selector, arriba de la lista: el pliegue de las opciones no se abre para mostrarlo.
  // Un nombre que ya empieza con la frase del modo se queda; el resto lo reemplaza el de por defecto.
  ponerPremio(nombreDelModo(esDeAlgunModo(premioAntes) ? premioAntes : ""));
  ponerGanadores(personas);
  pintar();
  $id("turnos-opcion")?.dispatchEvent(new CustomEvent("tinkazo:modo"));
}

function apagar(): void {
  const campo = $id<HTMLInputElement>("nw");
  encendido = false;
  amigo = false;
  fijarGanadores(false);
  ponerGanadores(Number(cantidadAntes) || 1);
  // El nombre que puso la persona se queda; el de por defecto se va y vuelve lo que había antes.
  const premio = $id<HTMLInputElement>("prize");
  if (premio && esElDeSiempre(premio.value)) ponerPremio(esDeAlgunModo(premioAntes) ? "" : premioAntes);
  pintar();
  $id("turnos-opcion")?.dispatchEvent(new CustomEvent("tinkazo:modo"));
}

/** Prende o apaga el modo Orden de turnos. */
export function ponerModoTurnos(si: boolean): void {
  if (si) {
    if (encendido && !amigo) return;
    prender(false);
    return;
  }
  if (!encendido) return;
  apagar();
}

/** Prende o apaga el modo Amigo secreto (issue #99). La cantidad sigue a la lista, como en el orden. */
export function ponerModoAmigo(si: boolean): void {
  if (si) {
    if (encendido && amigo) return;
    prender(true);
    return;
  }
  if (!encendido || !amigo) return;
  apagar();
}

/** Con la lista cerrada (sellando o ya sellada) el modo no se cambia: los tres botones se apagan y el selector se queda quieto. */
export function bloquearTurnos(si: boolean): void {
  cerrada = si;
  for (const id of ["btn-turnos", "btn-amigo", "btn-modo-sorteo"]) {
    const boton = $id<HTMLButtonElement>(id);
    if (boton) boton.disabled = si;
  }
}

/**
 * Antes de sellar: el nombre tiene que empezar con la frase del modo elegido. Devuelve el nombre que queda. La llama
 * el sello (`freeze.ts`) y el campo cuando se sale de él.
 */
export function ajustarPremioDeTurnos(): string {
  const premio = $id<HTMLInputElement>("prize");
  if (!encendido || !premio) return premio?.value.trim() ?? "";
  const queda = nombreDelModo(premio.value);
  if (queda !== premio.value) ponerPremio(queda);
  return queda;
}

/**
 * El nombre del campo decide el sub-modo cuando la herramienta abre con un borrador: el borrador guarda el modo de la
 * lista que sigue (`participants.ts`), y si lo guardado era un Amigo secreto, el nombre lo dice. Un nombre escrito por
 * la persona no se toca; solo se alinea el modo.
 */
function sincronizarModo(): void {
  if (!encendido) return;
  const premio = $id<HTMLInputElement>("prize");
  if (!premio) return;
  const valor = premio.value;
  if (amigo && isTurnPrize(valor)) {
    amigo = false;
    pintar();
  } else if (!amigo && isSecretSantaPrize(valor)) {
    amigo = true;
    pintar();
  }
}

let montado = false;

/**
 * Arma el selector: lo muestra si la bandera o la dirección lo piden, escucha los tres botones y vuelve a escribir lo
 * que depende del idioma. Se llama una vez al cargar. No prende nada: eso lo hace `abrirConElModoPedido` o el borrador.
 */
export function montarTurnos(): void {
  const opcion = $id("turnos-opcion");
  const boton = $id<HTMLButtonElement>("btn-turnos");
  if (!opcion || !boton || montado) return;
  montado = true;
  opcion.hidden = !modesVisible();
  armarLineaDePrivacidad();
  rotularElPliegue();
  // Cada botón elige su modo. Tocar el que ya está elegido no hace nada: no es un interruptor.
  const elegir = (modo: "turnos" | "amigo", desde: HTMLButtonElement): void => {
    if (desde.disabled) return;
    if (modo === "turnos" ? encendido && !amigo : encendido && amigo) return;
    if (modo === "turnos") ponerModoTurnos(true);
    else ponerModoAmigo(true);
    animarElCambio();
  };
  boton.addEventListener("click", () => elegir("turnos", boton));
  const sorteo = $id<HTMLButtonElement>("btn-modo-sorteo");
  sorteo?.addEventListener("click", () => {
    if (sorteo.disabled || !encendido) return;
    ponerModoTurnos(false);
    animarElCambio();
  });
  // Al salir del nombre, si no empieza con la frase del modo, se le pone por delante. Y un nombre que empieza con la
  // frase del otro modo alinea el modo (el borrador que vuelve).
  $id("prize")?.addEventListener("change", () => {
    sincronizarModo();
    void ajustarPremioDeTurnos();
  });
  $id("prize")?.addEventListener("tinkazo:premio", sincronizarModo);
  // El botón del Amigo secreto y la línea de privacidad se arman desde ya si los modos están a la vista: así el
  // selector tiene sus tres botones aunque todavía no se haya elegido ninguno.
  pintar();
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
