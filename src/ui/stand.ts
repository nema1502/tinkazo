import { $ } from "../dom";
import { onLangChange, t } from "../i18n";
import { app, forzarRitmo, params } from "../state";
import { enEnsayo, enStand, marcarStand, pedirSalidaDelStand } from "../ensayo-modo";
import { CLAVE_LISTA_STAND, borradorConNombres, guardarAntesDelStand, listaBloqueada, parseNames, renderNames, reponerBorrador, setList } from "./participants";
import { ponerContadorDelStand } from "./ganadores";
import { abrirConElModoPedido, ponerModoTurnos } from "./turnos";
import { ponerPremio } from "./premios";
import { MARCA_INGRESAR, currentSession, refrescarPuerta } from "./wallet-ui";
import { GUARDA_DESPUES_DE_SOLTAR_MS, refreshFreezeLabel, rotarJuego, unfreeze } from "./freeze";
import { newDraw } from "./draw";
import { actualizarPaso } from "./siguiente";
import { abrirDialogo, botonPrincipal } from "./dialogo";
import { campanaNoSePisa } from "./campana-no-pisa";

/**
 * El modo stand, en la página: rondas de ejemplo con los nombres de quienes
 * pasan por un stand. Es la herramienta de verdad, pero:
 *
 * - nunca graba nada ni pide el número a la red (`ensayo-modo.ts`, `faroDeStand`):
 *   funciona con internet, con datos lentos y sin nada de red;
 * - la ronda arranca sola a los 3 segundos de empezar, en el ritmo rápido, y no
 *   hay cuenta, ni premio, ni comprobación, ni compartir;
 * - una banda fija dice que es el modo stand, y el rótulo dentro del estadio dice
 *   Ronda de ejemplo: no se puede comprobar, que así aparece en cualquier foto o video;
 * - los nombres se escriben en la compu o llegan de la sala por QR (`stand-sala.ts`).
 *
 * Se entra por Tengo un stand (en la portada y arriba del cuadro) o con el atajo ?stand, que se borra de la dirección
 * enseguida. El modo se marca en la pestaña, no en la dirección (igual que el ensayo). Salir recarga la página para
 * soltar el juego. La lista del stand solo pasa al sorteo si quien atiende lo elige; si no, vuelve la de antes.
 */

/** Cambia la clave de un texto de la página y lo escribe: el cambio de idioma lo sigue traduciendo. */
function ponerClave(el: HTMLElement | null, clave: string): void {
  if (!el) return;
  el.dataset.i = clave;
  el.textContent = t(clave);
}

/** Monta el modo stand en la herramienta. */
function montar(): void {
  document.body.dataset.stand = "1";
  medirCabecera();
  addEventListener("resize", medirCabecera, { passive: true });
  // Ritmo rápido sin cambiar el que eligió la persona para sus sorteos.
  forzarRitmo("rapido");
  const ritmo = document.getElementById("pace");
  if (ritmo instanceof HTMLSelectElement) ritmo.value = "rapido";
  // Sin cuenta también se sortea: no se graba nada.
  refrescarPuerta();
  refreshFreezeLabel();
  // El stand no tiene orden de turnos ni premio: sus rondas dicen quién salió. Lo que se había elegido para el sorteo de
  // verdad quedó guardado al entrar y vuelve al salir. La cantidad es la suya, Cuántos salen: desde 1 y sin pasar de la lista.
  ponerModoTurnos(false);
  ponerPremio("");
  ponerContadorDelStand();
  // El pliegue de las opciones solo guarda el CSV: sin el premio, su rótulo no puede nombrarlo.
  const pliegue = document.querySelector<HTMLElement>("#mas-opciones > summary");
  if (pliegue) {
    pliegue.dataset.i = "srcCsv";
    pliegue.textContent = t("srcCsv");
  }
  // Los títulos dicen dónde se está. Salir recarga la página y vuelven los de siempre.
  ponerClave(document.querySelector<HTMLElement>(".appbar-t h2.tab-nuevo"), "standTitulo");
  ponerClave(document.getElementById("p1-titulo"), "standP1");
  ponerClave(document.querySelector<HTMLElement>("#sec-draw .head h2 [data-i]"), "standP3");
  renderNames();
  rotular();
  guiar();
  actualizarPaso();
  document.dispatchEvent(new CustomEvent("tinkazo:stand"));
}

/** El alto de la cabecera y de la banda, para que la banda quede debajo y lo que se lleva a la vista no quede detrás. */
function medirCabecera(): void {
  const raiz = document.documentElement.style;
  const cab = document.querySelector("body > header");
  if (cab) raiz.setProperty("--cab-alto", `${Math.ceil(cab.getBoundingClientRect().height)}px`);
  const banda = document.getElementById("stand-banda");
  if (banda) raiz.setProperty("--banda-alto", `${Math.ceil(banda.getBoundingClientRect().height)}px`);
}

/** El rótulo del estadio, donde iría el número público, en el idioma de ahora. */
function rotular(): void {
  $("st-round").dataset.ens = t("standBanda");
}

/** El botón apagado del resultado dice que la ronda terminó, sin usar las palabras de un sorteo con sello. */
function rotularFin(): void {
  if (!enStand() || !app.drawn) return;
  ponerClave(document.getElementById("btn-draw"), "standRondaLista");
}

/** La línea que guía, debajo de los pasos (la misma del ensayo): solo antes de empezar la ronda. */
function guiar(): void {
  // Fuera del modo stand la línea es del ensayo (`ensayo.ts`).
  if (!enStand()) return;
  const el = document.getElementById("ensayo-guia");
  if (!el) return;
  const clave = hayQrAbierto() ? "standGuiaSala" : "standGuia1";
  // Con la lista vacía el botón apagado ya explica que faltan dos nombres: no hace falta otra guía.
  const texto = parseNames().length > 0 && !app.frozen && !app.drawn ? t(clave) : "";
  if (el.textContent !== texto) el.textContent = texto;
  el.hidden = !texto;
}

/** Avisa fuera del stand por qué no se pudo entrar, sin abrir una ventana ni cambiar el sorteo que estaba. */
function avisarQueNoSeEntra(clave: string): void {
  const aviso = document.getElementById("stand-aviso");
  if (!aviso) return;
  aviso.textContent = t(clave);
  aviso.hidden = false;
}

/** Entra al modo stand. Nunca con un sorteo sellado esperando ni en camino, ni en la demo, ni en el ensayo. */
export function entrarAlStand(): void {
  if (enStand()) return;
  // Con una campaña viva el cuadro es el suyo: el stand lo vaciaría (campana-no-pisa.ts).
  if (campanaNoSePisa()) return;
  if (app.frozen || listaBloqueada()) {
    avisarQueNoSeEntra("standNoSorteo");
    return;
  }
  if (enEnsayo() || params.has("demo")) {
    avisarQueNoSeEntra("standNoEjemplo");
    return;
  }
  const avisoAnterior = document.getElementById("stand-aviso");
  if (avisoAnterior) avisoAnterior.hidden = true;
  // Lo que se estaba armando queda guardado tal cual, también con el cuadro vacío: vuelve al salir.
  guardarAntesDelStand();
  marcarStand(true);
  history.replaceState(null, "", `${location.pathname}${location.search}#sortear`);
  dispatchEvent(new HashChangeEvent("hashchange"));
  // El cuadro empieza vacío: en un stand se escribe lo de quienes están ahí.
  setList("");
  montar();
  scrollTo(0, 0);
  medirCabecera();
  // Lo primero que toca es mostrar el QR. Sin la tarjeta de la sala, el cuadro.
  const qr = document.getElementById("sala-crear");
  (qr ?? $<HTMLTextAreaElement>("ta")).focus({ preventScroll: true });
}

/** El atajo para mandarle a quien atiende: `tinkazo.app/?stand`. */
const ATAJO_STAND = `stand`;
function pidioElAtajo(): boolean {
  return new URLSearchParams(location.search).has(ATAJO_STAND);
}

/** Saca `stand` de la dirección, deja los demás parámetros y abre la herramienta (`#sortear`). */
function borrarElAtajo(): void {
  const resto = new URLSearchParams(location.search);
  resto.delete(ATAJO_STAND);
  const busqueda = resto.toString();
  history.replaceState(null, "", `${location.pathname}${busqueda ? `?${busqueda}` : ""}#sortear`);
  dispatchEvent(new HashChangeEvent("hashchange"));
}

/** Tengo un stand, en la portada: entra al modo, o lleva a la herramienta si ya está adentro o no se puede entrar. */
function irAlStand(): void {
  if (!enStand()) entrarAlStand();
  // Ya adentro, o sin poder entrar (un sorteo sellado esperando): la herramienta, que dice por qué.
  if (location.hash === "#sortear") return;
  history.replaceState(null, "", `${location.pathname}${location.search}#sortear`);
  dispatchEvent(new HashChangeEvent("hashchange"));
}

/** La elección de quien atiende: las rondas no se guardan, pero puede llevar los nombres al sorteo de cierre. */
function confirmarLlevarLista(): Promise<boolean | null> {
  return new Promise((resolve) => {
    let listo = false;
    const terminar = (llevar: boolean | null): void => {
      if (listo) return;
      listo = true;
      resolve(llevar);
    };
    const titulo = t("standLlevarT").replace("{n}", String(parseNames().length));
    const dlg = abrirDialogo({ titulo, onCerrar: () => terminar(null) });
    const cuerpo = document.createElement("p");
    cuerpo.textContent = t("standLlevarB");
    dlg.cuerpo.appendChild(cuerpo);
    if (borradorConNombres()) {
      const reemplazo = document.createElement("p");
      reemplazo.textContent = t("standLlevarReemplaza");
      dlg.cuerpo.appendChild(reemplazo);
    }
    const llevarBtn = botonPrincipal(t("standLlevarSi"));
    llevarBtn.addEventListener("click", () => {
      terminar(true);
      dlg.cerrar();
    });
    const sinListaBtn = document.createElement("button");
    sinListaBtn.type = "button";
    sinListaBtn.className = "mini ghost";
    sinListaBtn.textContent = t("standLlevarNo");
    sinListaBtn.addEventListener("click", () => {
      terminar(false);
      dlg.cerrar();
    });
    dlg.pie.append(llevarBtn, sinListaBtn);
  });
}

/** Sale del stand. Solo la salida para hacer un sorteo de verdad puede pedir abrir la entrada en la página nueva. */
export async function salirDelStand(abrirIngreso = false): Promise<void> {
  frenarArranque();
  let llevarLista = false;
  if (parseNames().length >= 2) {
    const decision = await confirmarLlevarLista();
    if (decision === null) return;
    llevarLista = decision;
  }
  // Si la sala no se pudo cerrar, la primera vez no se sale: se avisa (`stand-sala.ts`) y quien atiende decide.
  // La segunda vez se sale igual, y la sala se borra sola a las 10 horas.
  const cerrada = await antesDeSalir().catch(() => false);
  if (!cerrada && !salidaAvisada) {
    salidaAvisada = true;
    return;
  }
  // Se guarda solo la lista, nunca la ronda ni su resultado. La página nueva la consume una sola vez.
  if (llevarLista && enStand()) {
    try {
      sessionStorage.setItem(CLAVE_LISTA_STAND, $<HTMLTextAreaElement>("ta").value);
    } catch {
      // Sin el paso por el almacenamiento no se recarga: la lista sigue en el cuadro para copiarla a mano.
      mostrarAviso(t("standLlevarError"));
      return;
    }
  }
  // El modo sigue puesto hasta que la página nueva lo apague: así el borrador
  // de la lista que se guarda al irse (`pagehide`) no se pisa con el del stand.
  pedirSalidaDelStand();
  forzarRitmo(null);
  if (abrirIngreso && !currentSession()) {
    try {
      sessionStorage.setItem(MARCA_INGRESAR, "1");
    } catch {
      /* sin almacenamiento, la línea de la cuenta tiene su botón */
    }
  }
  history.replaceState(null, "", `${location.pathname}${location.search}#sortear`);
  // La página nueva arranca arriba. La invitación a entrar solo se deja marcada desde Hacer un sorteo de verdad.
  history.scrollRestoration = "manual";
  scrollTo(0, 0);
  location.reload();
}

/**
 * Lo que cambia en la lista entre una ronda y la siguiente (`stand-sala.ts`):
 * quienes llegaron por la sala mientras corría la ronda entran, y a quienes se
 * quitó con la lista ya cerrada no se los vuelve a poner.
 */
type Cambios = { quitar: string[]; sumar: string[] };
let cambiosDeLaSala: () => Cambios = () => ({ quitar: [], sumar: [] });
export function nombresParaLaSiguiente(f: () => Cambios): void {
  cambiosDeLaSala = f;
}

/** Si hay un QR abierto ahora: lo dice `stand-sala.ts`. Sin esa parte de la página, nunca. */
let hayQrAbierto: () => boolean = () => false;
export function alPreguntarPorElQr(f: () => boolean): void {
  hayQrAbierto = f;
}

/** Vuelve a escribir la línea que guía: la llama `stand-sala.ts` cuando el QR se abre o se cierra. */
export function repintarGuia(): void {
  guiar();
}

/** Lo que hace falta antes de salir (cerrar la sala): `stand-sala.ts`. Dice si quedó cerrada. */
let antesDeSalir: () => Promise<boolean> = async () => true;
let salidaAvisada = false;
export function alSalirDelStand(f: () => Promise<boolean>): void {
  antesDeSalir = f;
}

/** La línea de avisos la pinta `stand-sala.ts`. La alternativa basta para usar la salida sin esa parte de la página. */
let mostrarAviso: (texto: string) => void = (texto) => {
  const el = document.getElementById("sala-error");
  if (!el) return;
  el.textContent = texto;
  el.hidden = !texto;
};
export function alAvisarEnStand(f: (texto: string) => void): void {
  mostrarAviso = f;
}

/**
 * Lo que espera Otra ronda antes de empezar sola: lo que Empezar la ronda no responde después de soltar la anterior
 * (`GUARDA_DESPUES_DE_SOLTAR_MS`, freeze.ts), y un poco más. Después corre la cuenta de siempre, Arranca en 3.
 */
const ESPERA_ANTES_DE_ARRANCAR_MS = GUARDA_DESPUES_DE_SOLTAR_MS + 100;
let arranque = 0;

/** La lista de la ronda que sigue: la de la que pasó, sin los que se quitaron y con los que llegaron por el QR. */
function listaDeLaSiguiente(nombres: readonly string[]): string {
  const { quitar, sumar } = cambiosDeLaSala();
  const lista = [...nombres];
  for (const q of quitar) {
    const i = lista.indexOf(q);
    if (i >= 0) lista.splice(i, 1);
  }
  return [...lista, ...sumar].join("\n");
}

/** Frena el arranque automático y esconde su control: la persona tomó la lista o salió del stand. */
function frenarArranque(): void {
  // La espera terminó por una decisión de quien atiende: la herramienta vuelve a verse y a moverse con normalidad.
  delete document.body.dataset.standArrancando;
  if (!arranque) return;
  window.clearTimeout(arranque);
  arranque = 0;
  pintarCambiar();
}

/** Un diálogo abierto manda: ninguna ronda empieza detrás de una decisión que todavía no se tomó. */
function hayDialogoAbierto(): boolean {
  return document.querySelector('[role="dialog"][aria-modal="true"]') !== null;
}

/** Otra ronda arranca sola: aprieta Empezar la ronda, que cuenta Arranca en 3 y larga. Cambiar la lista la frena. */
function arrancarSola(): void {
  frenarArranque();
  if (hayDialogoAbierto()) return;
  // Mientras se prepara la ronda no se muestran la lista ni el selector, y no se mueve ni el foco ni el scroll.
  document.body.dataset.standArrancando = "1";
  arranque = window.setTimeout(() => {
    arranque = 0;
    pintarCambiar();
    const empezar = document.getElementById("btn-freeze");
    if (!enStand() || hayDialogoAbierto() || app.frozen) {
      frenarArranque();
      return;
    }
    if (!(empezar instanceof HTMLButtonElement) || empezar.disabled) {
      frenarArranque();
      return;
    }
    empezar.click();
  }, ESPERA_ANTES_DE_ARRANCAR_MS);
  pintarCambiar();
}

/** Cambiar la lista se ve durante la cuenta y la guarda: con el resultado a la vista ya no hay nada que frenar. */
function pintarCambiar(): void {
  const boton = document.getElementById("stand-cambiar");
  const esperando = app.frozen !== null || arranque !== 0;
  if (boton) boton.hidden = !(enStand() && esperando && app.drawn === null);
}

/** Otra ronda: la misma lista, con quienes llegaron durante la ronda, y otro juego, sin recargar. Arranca sola. */
export function otraRonda(): void {
  const f = app.frozen;
  if (!f || !app.drawn) return;
  // Se marca antes de soltar el resultado: `newDraw` no debe llevar el cuadro a la vista durante esta espera.
  document.body.dataset.standArrancando = "1";
  // Durante Ver de nuevo, `newDraw` no hace nada. Solo si soltó el resultado se consumen las llegadas y las quitas.
  newDraw("otraLista");
  if (app.frozen) {
    frenarArranque();
    return;
  }
  const lista = listaDeLaSiguiente(f.names);
  rotarJuego();
  setList(lista);
  guiar();
  arrancarSola();
}

/** Suelta un resultado para editar su lista, sin rotar el juego ni arrancar otra ronda. */
export function soltarResultadoDelStand(): boolean {
  const f = app.frozen;
  if (!enStand() || !f || !app.drawn) return false;
  frenarArranque();
  newDraw("otraLista");
  // Ver de nuevo todavía está abierto: la lista cerrada y su resultado no se tocan.
  if (app.frozen) return false;
  setList(listaDeLaSiguiente(f.names));
  guiar();
  pintarCambiar();
  return true;
}

/** Cambiar la lista: frena el arranque o suelta el resultado y vuelve al cuadro, sin arrancar otra ronda. */
export function cambiarLaLista(): void {
  const f = app.frozen;
  if (!enStand()) return;
  if (f && app.drawn) {
    if (!soltarResultadoDelStand()) return;
  } else {
    if (app.drawn || (!f && !arranque)) return;
    frenarArranque();
    if (f) unfreeze(listaDeLaSiguiente(f.names));
    guiar();
    pintarCambiar();
  }
  const cuadro = $<HTMLTextAreaElement>("ta");
  cuadro.focus({ preventScroll: true });
  cuadro.scrollIntoView?.({ block: "center" });
}

/** La lista del stand, guardada en la pestaña al irse la página: recargar sin querer en el celular no la borra. */
const CLAVE_CUADRO = "tinkazo.stand-cuadro";

/** Al irse la página en el modo stand, guarda lo que hay en el cuadro. */
function guardarCuadro(): void {
  if (!enStand()) return;
  try {
    sessionStorage.setItem(CLAVE_CUADRO, $<HTMLTextAreaElement>("ta").value);
  } catch {
    /* sin almacenamiento, la lista dura lo que la página */
  }
}

/** La lista guardada, una sola vez: se borra al leerla, así no queda para después de salir del stand. */
function leerCuadro(): string {
  try {
    const texto = sessionStorage.getItem(CLAVE_CUADRO) ?? "";
    sessionStorage.removeItem(CLAVE_CUADRO);
    return texto;
  } catch {
    return "";
  }
}

/** Se llama una vez, con la herramienta y la cuenta ya armadas. */
export function initStand(): void {
  document.getElementById("btn-stand")?.addEventListener("click", entrarAlStand);
  for (const b of document.querySelectorAll<HTMLElement>("[data-entrar-stand]")) {
    b.addEventListener("click", (e) => {
      e.preventDefault();
      irAlStand();
    });
  }
  document.getElementById("stand-salir-banda")?.addEventListener("click", () => void salirDelStand());
  document.getElementById("stand-salir")?.addEventListener("click", () => void salirDelStand(true));
  document.getElementById("stand-otra")?.addEventListener("click", () => otraRonda());
  document.getElementById("stand-editar")?.addEventListener("click", () => cambiarLaLista());
  document.getElementById("stand-cambiar")?.addEventListener("click", () => cambiarLaLista());
  // El estadio, o el resultado directo con movimiento reducido, termina la espera sin mostrar la herramienta de por medio.
  const estadio = document.getElementById("stadium");
  const resultado = document.getElementById("winner-box");
  const observador = new MutationObserver(() => {
    if (estadio?.style.display === "block" || resultado?.style.display === "block") delete document.body.dataset.standArrancando;
  });
  for (const el of [estadio, resultado]) {
    if (el) observador.observe(el, { attributes: true, attributeFilter: ["style"] });
  }
  const areaDeNombres = $<HTMLTextAreaElement>("ta");
  // Tocar o escribir en el cuadro es elegir la lista: la ronda ya no puede arrancar sola.
  areaDeNombres.addEventListener("input", frenarArranque);
  areaDeNombres.addEventListener("focus", frenarArranque);
  document.addEventListener("focusin", () => {
    // Los diálogos de la página atrapan el foco al abrirse: desde ese momento la guarda queda cancelada.
    if (arranque && hayDialogoAbierto()) frenarArranque();
  });
  addEventListener("pagehide", guardarCuadro);
  // En el modo stand el logo no saca del modo sin avisar: lleva arriba de la página. Para salir está Salir del stand.
  document.querySelector<HTMLAnchorElement>("a.wordmark")?.addEventListener("click", (e) => {
    if (!enStand()) return;
    e.preventDefault();
    scrollTo(0, 0);
  });
  // La lista del stand de la página anterior: se lee y se borra en cada carga, y solo se usa si se sigue en el modo.
  const cuadro = leerCuadro();
  document.addEventListener("tinkazo:paso", () => {
    guiar();
    pintarCambiar();
    rotularFin();
    // El enlace de entrada solo se ve antes de sellar y fuera del modo. Con la lista cerrada (un sello en camino) no entra.
    const entrada = document.getElementById("btn-stand");
    if (entrada) entrada.hidden = !!app.frozen || enStand() || listaBloqueada();
  });
  onLangChange(() => {
    if (!enStand()) return;
    rotular();
    guiar();
    rotularFin();
  });
  // El atajo `?stand`: entra al modo y se borra de la dirección. Si ya estaba adentro, sigue como en una recarga.
  if (pidioElAtajo()) {
    const yaEstaba = enStand();
    borrarElAtajo();
    if (!yaEstaba) {
      entrarAlStand();
      return;
    }
  }
  // Al cargar: si se recargó en la herramienta durante el modo stand, sigue; si no, se termina.
  if (!enStand()) return;
  if (location.hash === "#sortear" && !params.has("demo") && !app.frozen) {
    if (cuadro.trim() && !$<HTMLTextAreaElement>("ta").value.trim()) setList(cuadro);
    montar();
    return;
  }
  // El stand se termina: lo que se estaba armando vuelve, en el mismo orden que al arrancar la página (`main.ts`).
  // Con la demo o un sello esperando no repone nada: `reponerBorrador` no pisa una lista ni un sello.
  marcarStand(false);
  ponerModoTurnos(false);
  reponerBorrador();
  abrirConElModoPedido();
}
