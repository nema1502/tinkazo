import { onLangChange, t } from "../i18n";
import { modesVisible, requestedMode } from "../modos/bandera";
import { isSecretSantaPrize, noHaySecreto, secretPrize } from "../modos/amigo";
import { isTurnPrize, turnPrize } from "../modos/turnos";
import { repetidos } from "../buscar";
import { canonicalList } from "../protocol/canonical";
import { nombreDePersona } from "../participaciones";
import { topeDeGanadores } from "../stellar/config";
import { fijarGanadores, ponerGanadores } from "./ganadores";
import { actualizarLugares, bloquearLugares, ponerPremio, premiosDeLosCampos, reponerLugares } from "./premios";

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
 * - El tope de la red se ve ya al elegir el modo (issue #95): la nota del selector lo dice con la cifra de esta red
 *   aunque la lista todavía entre, y cuando la lista lo pasa pasa a decir por qué no se puede sellar. La cifra se lee
 *   en cada pintado; un cambio de red recompone la página, así que no hay estado de la red que actualizar aparte.
 * - El título del paso dice lo que va a pasar. Lo que hace el modo elegido va plegado detrás de la i de debajo del
 *   selector (`#btn-modo-info`, desde el 20 de noviembre de 2026: dos párrafos a la vista eran demasiado texto en el
 *   celular). En el Amigo secreto el pliegue trae una línea más (`#amigo-privacidad`), lo que el modo no protege: quien
 *   organiza ve el reparto, y quien tenga la lista y el número del sorteo lo puede calcular. Que con 2 o 3 personas no
 *   hay secreto (S3) no se pliega: sale a la vista en la nota del selector (`#turnos-nota`), igual que el tope.
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
/** Los premios del 2.º lugar en adelante antes de prender el modo: el modo saca sus campos, y al apagarlo vuelven. */
let lugaresAntes: string[] = [];

const $id = <T extends HTMLElement>(id: string): T | null => document.getElementById(id) as T | null;

/** ¿Está prendido el modo de la lista que sigue (orden o Amigo secreto)? La usa la lista y el borrador. */
export const modoTurnosActivo = (): boolean => encendido;

/** ¿Está prendido el Amigo secreto? La usan el resultado y el mensaje (`draw.ts`). */
export const modoAmigoActivo = (): boolean => encendido && amigo;

/** ¿La lista pasa de lo que esta red admite en un orden o un Amigo secreto? Con el modo apagado nunca: ahí manda el tope de siempre. */
export const ordenNoCabe = (n: number = personas): boolean => encendido && n > topeDeGanadores();

/**
 * En un Amigo secreto, la primera persona que está dos veces en la lista, o null. El reparto va de renglón en renglón:
 * con dos renglones de la misma persona, uno puede caer justo antes del otro y esa persona se regala a sí misma. Se
 * compara sin tildes ni mayúsculas y sin la marca de una participación («Ana (1/2)» es Ana). Con una, no se sella
 * (`participants.ts` y `freeze.ts`) y la línea de junto a Sellar dice cuál. En los otros modos nunca.
 */
export function amigoRepetido(names: readonly string[]): string | null {
  if (!encendido || !amigo) return null;
  const deCadaUno = names.map(nombreDePersona);
  const dobles = repetidos(deCadaUno);
  return dobles.size ? (deCadaUno[Math.min(...dobles)] ?? null) : null;
}

/**
 * El repetido de la lista que está ahora en el cuadro (`#ta`), para quien no tiene la lista a mano: la red, al repintar
 * Sellar (`red.ts`), lo volvía a prender con un repetido y el toque no hacía nada.
 */
export function amigoRepetidoEnElCuadro(): string | null {
  const cuadro = $id<HTMLTextAreaElement>("ta");
  return cuadro ? amigoRepetido(canonicalList(cuadro.value)) : null;
}

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
 * título del paso y la ayuda del pliegue de la i dicen lo que va a pasar. [selector, apagado, turnos, amigo].
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
  // Dos personas y una flecha de una a la otra: cada uno le regala a otro. Era un regalo, igual al de Sortear premios.
  path.setAttribute(
    "d",
    "M7 4.5h10M14.5 2l2.5 2.5-2.5 2.5M8.5 11a2.5 2.5 0 1 1-5 0a2.5 2.5 0 1 1 5 0M20.5 11a2.5 2.5 0 1 1-5 0a2.5 2.5 0 1 1 5 0" +
      "M2 21a4 4 0 0 1 8 0M14 21a4 4 0 0 1 8 0",
  );
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", "currentColor");
  path.setAttribute("stroke-width", "2");
  path.setAttribute("stroke-linejoin", "round");
  path.setAttribute("stroke-linecap", "round");
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

/**
 * La línea de privacidad antes de sellar (S3). Se arma una vez, junto a la ayuda del selector y dentro de su pliegue:
 * es una explicación y no un aviso, así que no se anuncia sola (el de 2 o 3 personas va en `#turnos-nota`).
 */
function armarLineaDePrivacidad(): HTMLElement | null {
  let el = $id<HTMLElement>("amigo-privacidad");
  if (el) return el;
  const ayuda = $id("turnos-ayuda");
  if (!ayuda) return null;
  el = document.createElement("p");
  el.id = "amigo-privacidad";
  el.className = "note amigo-privacidad";
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
  // Con el tercer botón armado, tres columnas desde el primer pintado, con cualquier modo elegido (styles.css, `.con-amigo`).
  grupo?.classList.toggle("con-amigo", !!$id("btn-amigo"));
  // La marca del Amigo secreto en la página (styles.css, bloque «Amigo secreto»): en el paso 2 no se ofrecen juegos ni
  // el aviso del volumen, porque en este modo no se juega nada. Se va al cambiar de modo.
  if (encendido && amigo) document.documentElement.dataset.modoLista = "amigo";
  else delete document.documentElement.dataset.modoLista;
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

/**
 * La nota del selector, a la vista y nunca plegada, sale ya al elegir el modo y dice, en orden de urgencia: por qué la
 * lista no se puede sellar (el orden y el Amigo secreto llegan hasta N, cuenta las líneas, no las personas), que en un
 * Amigo secreto con 2 o 3 personas no hay secreto, o — issue #95 — el tope de esta red aunque la lista entre. Lo que el
 * modo no protege con 4 o más va en el pliegue de la i, junto a la ayuda.
 */
function pintarAviso(): void {
  const nota = $id("turnos-nota");
  if (nota) {
    const excede = ordenNoCabe();
    const sinSecreto = encendido && amigo && noHaySecreto(personas);
    const alElegir = encendido && !excede && !sinSecreto ? t(amigo ? "amigoCap" : "turnsCap").replace("{n}", String(topeDeGanadores())) : "";
    nota.textContent = excede
      ? t("turnsLimit").replace("{n}", String(topeDeGanadores()))
      : sinSecreto
        ? t("amigoPrivacidadPoca")
        : alElegir;
    nota.hidden = !excede && !sinSecreto && !alElegir;
  }
  // La línea de privacidad (S3), en el pliegue: con el Amigo secreto elegido, lo que se decidió.
  const linea = armarLineaDePrivacidad();
  if (linea) {
    linea.textContent = amigo ? t("amigoPrivacidad") : "";
    linea.hidden = !amigo;
  }
}

/**
 * La i de debajo del selector despliega y pliega lo que hace el modo elegido (`#modo-info`). Nace cerrada y no guarda
 * nada. El panel va debajo de la i: al abrirlo no se corre nada de lo que está arriba, ni la i misma. Abierto o
 * cerrado, al cambiar de modo los textos ya son los del modo nuevo (`ROTULOS` y `pintarAviso`). Escape lo cierra con
 * el foco en el selector, y el foco queda en la i.
 *
 * Al abrirlo, si el panel termina debajo de la pantalla o donde entra la barra de lo que sigue, la página baja lo justo
 * para verlo entero: el alto de la barra va en su `scroll-margin-bottom` (styles.css). A 320 px el panel empujaba
 * Pegar lista fuera de la pantalla, entraba la barra y lo tapaba entero: la i se llenaba y no se leía nada. Si ya se ve,
 * no se mueve nada.
 */
function montarLaI(opcion: HTMLElement): void {
  const i = $id<HTMLButtonElement>("btn-modo-info");
  const panel = $id("modo-info");
  if (!i || !panel) return;
  const poner = (abierto: boolean): void => {
    panel.hidden = !abierto;
    i.setAttribute("aria-expanded", String(abierto));
  };
  poner(false);
  i.addEventListener("click", () => {
    const abrir = panel.hasAttribute("hidden");
    poner(abrir);
    if (!abrir) return;
    const reducido = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    panel.scrollIntoView?.({ block: "nearest", behavior: reducido ? "auto" : "smooth" });
  });
  opcion.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || panel.hasAttribute("hidden")) return;
    poner(false);
    i.focus({ preventScroll: true });
  });
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
  // Lo de antes se guarda al entrar al modo, no al pasar de un modo al otro: para entonces sus campos ya no estaban, y
  // el nombre y la cantidad ya eran los del otro modo. Al apagar vuelve lo del sorteo de premios.
  if (!encendido) {
    lugaresAntes = premiosDeLosCampos().slice(1);
    cantidadAntes = campo?.value ?? "";
    premioAntes = premio?.value ?? "";
  }
  const actual = premio?.value ?? "";
  encendido = true;
  amigo = comoAmigo;
  fijarGanadores(true);
  // El modo elegido se ve en el selector, arriba de la lista: el pliegue de las opciones no se abre para mostrarlo.
  // Un nombre que ya empieza con la frase del modo se queda; el resto lo reemplaza el de por defecto. El nombre por
  // defecto del otro modo cuenta como vacío: de Turnos a Amigo secreto quedaba Amigo secreto: Turnos.
  ponerPremio(nombreDelModo(esDeAlgunModo(actual) && !esElDeSiempre(actual) ? actual : ""));
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
  const vuelve = premio !== null && esElDeSiempre(premio.value);
  if (vuelve) ponerPremio(esDeAlgunModo(premioAntes) ? "" : premioAntes);
  pintar();
  // Con el premio de antes vuelven también los de los lugares siguientes, ya con sus campos armados por `pintar`.
  if (vuelve) reponerLugares(lugaresAntes);
  lugaresAntes = [];
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
  montarLaI(opcion);
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
