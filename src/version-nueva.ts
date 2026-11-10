import { esDeCargaOpcional } from "./carga-opcional";
import { onLangChange, texto } from "./idioma";

export { cargaOpcional } from "./carga-opcional";

/**
 * El aviso de versión nueva.
 *
 * El sitio carga partes a pedido con import dinámico. Cuando se publica una
 * versión nueva, los archivos cambian de nombre y una pestaña abierta desde
 * antes apunta a los viejos: el navegador falla y en pantalla no pasa nada.
 * Este módulo escucha ese fallo y muestra una cinta arriba de la página, que
 * nunca recarga sola: en medio de un sorteo, una recarga sorpresa es peor que
 * el aviso. La cinta no tapa nada: ocupa su lugar arriba de todo, dentro de la
 * cabecera fija si la hay, o pegada arriba en el celular (así se ve con la
 * página bajada), por debajo de todas las capas; no aparece mientras están a la vista
 * el show, la espera en grande, la cortina o una ventana (espera a que se
 * cierren) y se puede cerrar.
 *
 * El navegador da el mismo error si el archivo ya no existe y si se cortó el
 * wifi, así que el fallo solo despierta una comprobación: sin conexión no se
 * pide nada; con conexión se pide la página de nuevo, sin caché, y la cinta
 * sale solo si su script de entrada cambió de nombre, es decir, si de verdad
 * se publicó otra versión. Si el pedido falla, no se avisa nada: un aviso
 * falso en medio de un sorteo es peor que no avisar.
 */

export const VERSION_NOTICE_ID = "version-nueva";

/** Lo que hace el botón. Se inyecta en las pruebas; en el sitio recarga. */
let reloadPage: () => void = () => window.location.reload();
let installed = false;
/** Ya se confirmó que hay otra versión publicada: no hace falta volver a pedir la página. */
let confirmada = false;
/** La comprobación en curso, para no pedir la página dos veces a la vez. */
let consultando: Promise<boolean> | null = null;
/** Quien la vio eligió "Ahora no": no vuelve en esta página. */
let cerrada = false;
/** Mira la página mientras una capa a pantalla completa hace esperar a la cinta. */
let esperando: MutationObserver | null = null;

/**
 * Lo que va a pantalla completa por encima de la página: el estadio, la tarjeta
 * del juego, la cortina, la espera en grande, la sala y la pantalla de
 * ganadores, la sala del stand en grande y las ventanas. Con alguna a la vista
 * la cinta espera: no se mete en el show ni en lo que mira la sala.
 */
const CAPAS = ".modal-back, .game-card, .cortina, .espera, .sala, .stand-sala.grande, dialog[open]";

function hayCapa(): boolean {
  return document.getElementById("stadium")?.style.display === "block" || document.querySelector(CAPAS) !== null;
}

/** Muestra la cinta ahora o, si hay una capa a la vista, cuando se cierre. */
function avisar(): void {
  if (cerrada) return;
  if (!hayCapa()) {
    showVersionNotice();
    return;
  }
  if (esperando) return;
  esperando = new MutationObserver(() => {
    if (hayCapa()) return;
    esperando?.disconnect();
    esperando = null;
    if (!cerrada) showVersionNotice();
  });
  esperando.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["style", "class", "open"] });
}

/**
 * Cómo dice cada navegador que el trozo ya no está, en minúsculas.
 *
 * Chrome y Edge: "Failed to fetch dynamically imported module". Firefox:
 * "error loading dynamically imported module". Safari: "Importing a module
 * script failed". Los tres nombran el módulo importado de forma dinámica.
 */
const STALE_PATTERNS = [
  "dynamically imported module",
  "importing a module script failed",
  "error loading dynamically imported module",
];

/** Si el motivo de un rechazo es el trozo viejo de una versión anterior. */
export function isStaleChunkError(reason: unknown): boolean {
  let message = "";
  if (typeof reason === "string") message = reason;
  else if (reason instanceof Error) message = reason.message;
  else if (typeof reason === "object" && reason !== null && typeof (reason as { message?: unknown }).message === "string") {
    message = (reason as { message: string }).message;
  }
  const lower = message.toLowerCase();
  return STALE_PATTERNS.some((pattern) => lower.includes(pattern));
}

/** El script de entrada de una página: el build le pone el hash del código en el nombre. */
function entradaDe(doc: ParentNode): string | null {
  return doc.querySelector('script[type="module"][src]')?.getAttribute("src") ?? null;
}

/** La carpeta de un script, para que una página ajena (un portal del wifi) no cuente como versión nueva. */
const carpetaDe = (src: string): string => src.slice(0, src.lastIndexOf("/") + 1);

/**
 * Si hay otra versión publicada. Pide esta misma página sin caché y compara
 * su script de entrada con el de la pestaña. Sin conexión, si el pedido
 * falla, si la respuesta no es una página o si no trae una entrada en la misma
 * carpeta, dice que no: ante la duda, no se avisa.
 */
export async function hayVersionNueva(): Promise<boolean> {
  if (navigator.onLine === false) return false;
  const actual = entradaDe(document);
  if (!actual) return false;
  try {
    const respuesta = await fetch(window.location.pathname, { cache: "no-store", credentials: "same-origin" });
    if (!respuesta.ok) return false;
    if (!(respuesta.headers.get("content-type") ?? "").toLowerCase().includes("text/html")) return false;
    const nueva = entradaDe(new DOMParser().parseFromString(await respuesta.text(), "text/html"));
    return nueva !== null && nueva !== actual && carpetaDe(nueva) === carpetaDe(actual);
  } catch {
    return false;
  }
}

/** Un fallo de carga: comprueba (una vez a la vez) y, si hay otra versión, muestra la cinta. */
function revisar(): void {
  if (cerrada) return;
  if (confirmada) {
    avisar();
    return;
  }
  if (consultando) return;
  consultando = hayVersionNueva();
  void consultando.then((nueva) => {
    consultando = null;
    if (!nueva) return;
    confirmada = true;
    avisar();
  });
}

/**
 * Muestra la cinta, una sola vez por página aunque se llame más veces. Los
 * textos salen del diccionario de la página, en su idioma, y se repintan si
 * el idioma cambia con la cinta a la vista.
 */
export function showVersionNotice(): HTMLElement {
  const existing = document.getElementById(VERSION_NOTICE_ID);
  if (existing) return existing;
  const bar = document.createElement("div");
  bar.id = VERSION_NOTICE_ID;
  bar.setAttribute("role", "alert");
  // En el flujo: empuja la página en vez de taparla, y las capas a pantalla
  // completa (z-index 40 a 80) quedan siempre encima. Dónde va, en `colocar`.
  bar.style.display = "flex";
  bar.style.flexWrap = "wrap";
  bar.style.alignItems = "center";
  bar.style.justifyContent = "center";
  bar.style.gap = "8px 16px";
  bar.style.padding = "10px 16px";
  // Amarillo con tinta encima: el par más fuerte de la marca (11,19 a 1 en
  // docs/marca.md) y vale igual en los dos temas, porque la cinta es opaca.
  bar.style.backgroundColor = "#ffc629";
  bar.style.color = "#191919";
  bar.style.borderBottom = "3px solid #191919";
  bar.style.fontSize = "16px";
  bar.style.lineHeight = "1.4";
  bar.style.textAlign = "center";
  const message = document.createElement("span");
  message.style.fontWeight = "700";
  const button = document.createElement("button");
  button.type = "button";
  button.style.minHeight = "44px";
  button.style.padding = "0 20px";
  button.style.fontSize = "16px";
  button.style.fontWeight = "800";
  button.style.color = "#191919";
  button.style.backgroundColor = "#ffffff";
  button.style.border = "3px solid #191919";
  button.style.boxShadow = "3px 3px 0 #191919";
  button.style.cursor = "pointer";
  // "Ahora no": sin relleno ni sombra, para que la acción principal siga siendo recargar.
  const close = document.createElement("button");
  close.type = "button";
  close.dataset.cerrar = "";
  close.style.minHeight = "44px";
  close.style.minWidth = "44px";
  close.style.padding = "0 16px";
  close.style.fontSize = "16px";
  close.style.fontWeight = "700";
  close.style.color = "#191919";
  close.style.backgroundColor = "transparent";
  close.style.border = "3px solid #191919";
  close.style.cursor = "pointer";
  const paint = (): void => {
    // Las claves van entre comillas: así entran en los textos de cada página.
    message.textContent = texto("nuevaVersionAviso");
    button.textContent = texto("nuevaVersionBoton");
    close.textContent = texto("nuevaVersionCerrar");
  };
  paint();
  // Cerrada, la cinta ya no está en la página y su callback de idioma no la toca.
  onLangChange(() => {
    if (bar.isConnected) paint();
  });
  button.addEventListener("click", () => reloadPage());
  close.addEventListener("click", () => {
    cerrada = true;
    esperando?.disconnect();
    esperando = null;
    const habia = lugar;
    const alto = bar.getBoundingClientRect().height;
    soltar();
    bar.remove();
    if (habia !== "pagina") avisarAlto();
    if (habia === "pegada") compensarSinAnclaje(-alto);
  });
  // Los dos botones van juntos: si no entran al lado del texto, bajan los dos
  // (sin el grupo, a 768 px "Ahora no" bajaba solo y quedaba desparejo). La
  // separación es la de siempre entre ellos; solo en un ancho que no los deja
  // ni de a dos se apilan.
  const botones = document.createElement("div");
  botones.style.display = "flex";
  botones.style.flexWrap = "wrap";
  botones.style.alignItems = "center";
  botones.style.justifyContent = "center";
  botones.style.gap = "8px 16px";
  botones.append(button, close);
  bar.append(message, botones);
  colocar(bar);
  // Solo mientras la cinta está a la vista: si la ventana cruza los 1100 px, la
  // cabecera cambia de fija a quieta (o al revés) y la cinta se muda con ella.
  alCambiarTamano = () => {
    if (colocar(bar)) avisarAlto();
  };
  window.addEventListener("resize", alCambiarTamano);
  // Si cambia de alto (otro idioma, el celular girado), lo que se apila debajo se vuelve a medir.
  // Pegada, con la página bajada, lo de abajo se correría la diferencia: se compensa como al aparecer.
  if (typeof ResizeObserver !== "undefined") {
    let alto = bar.getBoundingClientRect().height;
    alCambiarAlto = new ResizeObserver(() => {
      const nuevo = bar.getBoundingClientRect().height;
      if (nuevo === alto) return;
      const diferencia = nuevo - alto;
      alto = nuevo;
      if (lugar === "pegada") {
        publicarAlto(bar, "--cinta-alto");
        compensarSinAnclaje(diferencia);
      } else if (lugar === "cabecera") {
        publicarAlto(bar, "--cinta-cabecera-alto");
      }
      if (lugar !== "pagina") avisarAlto();
    });
    alCambiarAlto.observe(bar);
  }
  if (lugar !== "pagina") avisarAlto();
  if (lugar === "pegada") compensarSinAnclaje(bar.getBoundingClientRect().height);
  return bar;
}

/**
 * La cinta pegada ocupa su alto en el flujo, arriba de todo: al ponerla,
 * quitarla o cambiar de alto con la página bajada, el contenido se correría
 * ese alto (con signo: negativo si se achica o se va). Los
 * navegadores con anclaje de scroll (overflow-anchor) ya lo compensan solos;
 * en los que no lo tienen (Safari de iOS) se compensa a mano. Arriba de todo
 * no hace falta: no hay nada que mover.
 */
function compensarSinAnclaje(alto: number): void {
  if (!(window.scrollY > 0) || alto === 0) return;
  const css = (window as unknown as { CSS?: { supports?: (propiedad: string, valor: string) => boolean } }).CSS;
  if (typeof css?.supports === "function" && css.supports("overflow-anchor", "auto")) return;
  window.scrollBy(0, alto);
}

/**
 * Dónde está la cinta:
 * - "cabecera": dentro de la cabecera fija (escritorio, más de 1100 px). Baja con
 *   la página sin posición ni z-index propios: no tapa nada más que la cabecera
 *   misma, que ya queda debajo de todas las capas. Publica su alto en
 *   `--cinta-cabecera-alto`: la cabecera crece lo que mide la cinta y el
 *   scroll-padding-top de html lo suma para no dejar lo que se lleva a la vista
 *   detrás de ella.
 * - "pegada": arriba de la página, pegada al borde de arriba mientras se baja
 *   (celular y tableta, donde la cabecera se queda en su lugar y, sin esto, con
 *   la página bajada nadie la vería). Va por encima de la página y de la banda
 *   del ensayo (12), y por debajo de la barra de lo que sigue y el menú (30) y
 *   de todas las capas (40 a 80). Publica su alto en `--cinta-alto`: la banda
 *   del ensayo se apila debajo, lo que se lleva a la vista queda debajo (el
 *   scroll-padding-top de html, en styles.css) y la barra de lo que sigue no
 *   cuenta como visible un botón que quedó detrás.
 * - "pagina": arriba de la página, en el flujo (una página sin cabecera).
 */
type Lugar = "cabecera" | "pegada" | "pagina";
let lugar: Lugar = "pagina";
let alCambiarTamano: (() => void) | null = null;
let alCambiarAlto: ResizeObserver | null = null;

/** Pone la cinta donde va según la cabecera de ahora. Devuelve si cambió de lugar. */
function colocar(bar: HTMLElement): boolean {
  const cabecera = document.querySelector<HTMLElement>("body > header");
  const posicion = cabecera ? getComputedStyle(cabecera).position : "";
  const nuevo: Lugar = !cabecera ? "pagina" : ["sticky", "fixed"].includes(posicion) ? "cabecera" : "pegada";
  const cambio = nuevo !== lugar || !bar.isConnected;
  lugar = nuevo;
  if (nuevo === "cabecera" && cabecera) {
    if (cabecera.firstElementChild !== bar) cabecera.prepend(bar);
  } else if (document.body.firstElementChild !== bar) {
    document.body.prepend(bar);
  }
  // La app instalada en un iPhone (viewport-fit=cover y la barra de estado
  // translúcida) se dibuja debajo de la hora y la batería, y con el teléfono
  // acostado, al lado de la muesca. Dentro de la cabecera, ella ya deja ese
  // lugar; fuera, lo deja la cinta. Sin muesca, env() vale 0 y el relleno es
  // el de siempre.
  const afuera = nuevo !== "cabecera";
  bar.style.paddingTop = afuera ? "max(10px, env(safe-area-inset-top, 0px))" : "10px";
  bar.style.paddingLeft = afuera ? "max(16px, env(safe-area-inset-left, 0px))" : "16px";
  bar.style.paddingRight = afuera ? "max(16px, env(safe-area-inset-right, 0px))" : "16px";
  const pegada = nuevo === "pegada";
  bar.style.position = pegada ? "sticky" : "";
  bar.style.top = pegada ? "0px" : "";
  bar.style.zIndex = pegada ? "20" : "";
  // Cada lugar publica su alto en su variable y quita la del otro.
  if (pegada) publicarAlto(bar, "--cinta-alto");
  else document.documentElement.style.removeProperty("--cinta-alto");
  if (nuevo === "cabecera") publicarAlto(bar, "--cinta-cabecera-alto");
  else document.documentElement.style.removeProperty("--cinta-cabecera-alto");
  return cambio;
}

function publicarAlto(bar: HTMLElement, variable: "--cinta-alto" | "--cinta-cabecera-alto"): void {
  document.documentElement.style.setProperty(variable, `${Math.ceil(bar.getBoundingClientRect().height)}px`);
}

/** La cinta se va: deja de escuchar la ventana y de publicar su alto. */
function soltar(): void {
  if (alCambiarTamano) window.removeEventListener("resize", alCambiarTamano);
  alCambiarTamano = null;
  alCambiarAlto?.disconnect();
  alCambiarAlto = null;
  document.documentElement.style.removeProperty("--cinta-alto");
  document.documentElement.style.removeProperty("--cinta-cabecera-alto");
  lugar = "pagina";
}

/**
 * Cambió el alto de lo que hay arriba (la cabecera fija con la cinta adentro, o
 * la cinta pegada): el ensayo, el stand y la barra de "lo que sigue" lo miden al
 * cambiar el tamaño de la ventana para dejar lo suyo debajo.
 */
function avisarAlto(): void {
  window.dispatchEvent(new Event("resize"));
}

/**
 * Escucha el fallo en la ventana: el aviso de Vite para ese error y, por si
 * algún rechazo no pasa por ese evento, los rechazos sin atrapar cuyo mensaje
 * sea el del módulo importado de forma dinámica. Solo se instala una vez.
 */
export function installVersionNotice(options: { reload?: () => void } = {}): void {
  if (options.reload) reloadPage = options.reload;
  if (installed) return;
  installed = true;
  window.addEventListener("vite:preloadError", (event) => {
    const motivo = (event as Event & { payload?: unknown }).payload;
    // Un turno después: `cargaOpcional` atrapa el error cuando el evento ya salió.
    window.setTimeout(() => {
      if (esDeCargaOpcional(motivo)) return;
      revisar();
    }, 0);
  });
  window.addEventListener("unhandledrejection", (event) => {
    if (isStaleChunkError(event.reason)) {
      event.preventDefault();
      revisar();
    }
  });
}

/** Vuelve a cero: sin cinta, sin comprobación confirmada ni en curso. Para las pruebas. */
export function resetVersionNotice(): void {
  soltar();
  document.getElementById(VERSION_NOTICE_ID)?.remove();
  esperando?.disconnect();
  esperando = null;
  confirmada = false;
  consultando = null;
  cerrada = false;
}

installVersionNotice();
