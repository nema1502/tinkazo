import { $ } from "../dom";
import { onLangChange, t } from "../i18n";
import { app, forzarRitmo, params } from "../state";
import { enEnsayo, enStand, marcarStand, pedirSalidaDelStand } from "../ensayo-modo";
import { CLAVE_LISTA_STAND, borradorConNombres, guardarBorrador, parseNames, renderNames, setList } from "./participants";
import { MARCA_INGRESAR, currentSession, refrescarPuerta } from "./wallet-ui";
import { refreshFreezeLabel, rotarJuego } from "./freeze";
import { newDraw } from "./draw";
import { actualizarPaso } from "./siguiente";
import { abrirDialogo, botonPrincipal } from "./dialogo";

/**
 * El modo stand, en la página: rondas de ejemplo con los nombres de quienes
 * pasan por un stand. Es la herramienta de verdad, pero:
 *
 * - nunca graba nada ni pide el número a la red (`ensayo-modo.ts`, `faroDeStand`):
 *   funciona con internet, con datos lentos y sin nada de red;
 * - la ronda arranca sola a los 3 segundos de empezar, en el ritmo rápido, y no
 *   hay cuenta, ni premio, ni comprobación, ni compartir;
 * - una banda fija que no se cierra y el mismo rótulo dentro del estadio dicen
 *   «Ronda de ejemplo: no se puede comprobar», para que aparezca en cualquier
 *   foto o video;
 * - los nombres se escriben en la compu o llegan de la sala por QR (`stand-sala.ts`).
 *
 * Se entra por un botón y se marca en la pestaña, no en la dirección (igual que
 * el ensayo). Salir recarga la página para soltar el juego. La lista del stand
 * solo pasa al sorteo si quien atiende lo elige; si no, vuelve la de antes.
 */

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

/** La línea que guía, debajo de los pasos (la misma del ensayo): solo antes de empezar la ronda. */
function guiar(): void {
  // Fuera del modo stand la línea es del ensayo (`ensayo.ts`).
  if (!enStand()) return;
  const el = document.getElementById("ensayo-guia");
  if (!el) return;
  const texto = !app.frozen && !app.drawn ? t("standGuia1") : "";
  if (el.textContent !== texto) el.textContent = texto;
  el.hidden = !texto;
}

/** Entra al modo stand. Nunca con un sorteo sellado esperando, ni en la demo, ni en el ensayo. */
export function entrarAlStand(): void {
  if (app.frozen || enStand() || enEnsayo() || params.has("demo")) return;
  // Lo que se estaba armando queda guardado tal cual: vuelve al salir.
  guardarBorrador();
  marcarStand(true);
  history.replaceState(null, "", `${location.pathname}${location.search}#sortear`);
  dispatchEvent(new HashChangeEvent("hashchange"));
  // El cuadro empieza vacío: en un stand se escribe lo de quienes están ahí.
  setList("");
  montar();
  scrollTo(0, 0);
  medirCabecera();
  $<HTMLTextAreaElement>("ta").focus({ preventScroll: true });
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
    const dlg = abrirDialogo({ titulo: t("standLlevarT"), onCerrar: () => terminar(null) });
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

/** Sale del modo stand: «Hacer un sorteo de verdad». Sin cuenta, la página nueva abre la entrada. */
export async function salirDelStand(): Promise<void> {
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
  if (!currentSession()) {
    try {
      sessionStorage.setItem(MARCA_INGRESAR, "1");
    } catch {
      /* sin almacenamiento, la línea de la cuenta tiene su botón */
    }
  }
  history.replaceState(null, "", `${location.pathname}${location.search}#sortear`);
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

/** «Otra ronda»: la misma lista, con quienes llegaron durante la ronda, y otro juego, sin recargar la página. */
export function otraRonda(): void {
  const f = app.frozen;
  if (!f || !app.drawn) return;
  const { quitar, sumar } = cambiosDeLaSala();
  const lista = [...f.names];
  for (const q of quitar) {
    const i = lista.indexOf(q);
    if (i >= 0) lista.splice(i, 1);
  }
  rotarJuego();
  newDraw("otraLista");
  setList([...lista, ...sumar].join("\n"));
  guiar();
}

/** Se llama una vez, con la herramienta y la cuenta ya armadas. */
export function initStand(): void {
  document.getElementById("btn-stand")?.addEventListener("click", entrarAlStand);
  document.getElementById("stand-salir-banda")?.addEventListener("click", () => void salirDelStand());
  document.getElementById("stand-salir")?.addEventListener("click", () => void salirDelStand());
  document.getElementById("stand-otra")?.addEventListener("click", () => otraRonda());
  document.addEventListener("tinkazo:paso", () => {
    guiar();
    // El enlace de entrada solo se ve antes de sellar y fuera del modo.
    const entrada = document.getElementById("btn-stand");
    if (entrada) entrada.hidden = !!app.frozen || enStand();
  });
  onLangChange(() => {
    if (!enStand()) return;
    rotular();
    guiar();
  });
  // Al cargar: si se recargó en la herramienta durante el modo stand, sigue; si no, se termina.
  if (!enStand()) return;
  if (location.hash === "#sortear" && !params.has("demo") && !app.frozen) montar();
  else marcarStand(false);
}
