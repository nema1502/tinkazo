import { t } from "../i18n";
import { app } from "../state";
import { changeMode, hayModoOficial, modeNameKey, network, type NetworkName } from "../stellar/config";
import { abrirDialogo, botonPrincipal } from "./dialogo";

/**
 * La hoja para cambiar de modo.
 *
 * Tocar la marca no cambia nada todavía: explica los dos modos, marca el
 * actual y recién el botón recarga la página en el otro. Mientras se sella o
 * hay un sorteo sellado esperando su número, el botón queda apagado y dice por
 * qué. Sin contrato oficial, esta hoja no existe.
 */

/** Si un sorteo sellado sin sortear bloquea el cambio de modo. */
export const cambioBloqueado = (frozen: unknown, drawn: unknown): boolean => !!frozen && !drawn;

/** Se está sellando ahora (`freeze.ts`): el sello todavía no entró, pero la recarga del cambio de modo lo cortaría. */
let sellandoAhora = false;

/** `freeze.ts` avisa cuando empieza a mandar el sello y cuando termina, bien o mal. */
export function marcarSellandoAhora(v: boolean): void {
  sellandoAhora = v;
}

/**
 * La guarda del cambio de modo, en un solo lugar: la usan la hoja, el pie de Mis sorteos, la confirmación del primer
 * sello y el aviso de la billetera en otra red. No se cambia mientras se sella ni con un sorteo sellado sin sortear.
 */
export const puedeCambiarDeModo = (): boolean => !sellandoAhora && !cambioBloqueado(app.frozen, app.drawn);

/** Cambia de modo si la guarda lo deja (`changeMode` recarga la página). Devuelve si se pidió el cambio. */
export function pasarAModo(target: NetworkName): boolean {
  if (!puedeCambiarDeModo()) return false;
  return changeMode(target);
}

/** El otro modo al que se puede pasar desde el vigente. */
export const otroModo = (name: NetworkName): NetworkName => (name === "mainnet" ? "testnet" : "mainnet");

/** La marca de que en este navegador ya se confirmó el primer sello en Oficial. */
export const FIRST_OFFICIAL_KEY = "tinkazo.oficial.confirmado";

/** Si hace falta confirmar: solo en Oficial y solo la primera vez. */
export const haceFaltaConfirmar = (name: NetworkName, visto: boolean): boolean => name === "mainnet" && !visto;

/** Si este navegador ya confirmó su primer sello en Oficial. Sin almacenamiento, se confirma cada vez. */
export function yaConfirmoPrimerOficial(): boolean {
  try {
    return localStorage.getItem(FIRST_OFFICIAL_KEY) !== null;
  } catch {
    return false;
  }
}

function marcarPrimerOficial(): void {
  try {
    localStorage.setItem(FIRST_OFFICIAL_KEY, "1");
  } catch {
    /* sin almacenamiento, la próxima vez se vuelve a preguntar */
  }
}

/**
 * La confirmación de la primera vez que se sella en Oficial en este navegador.
 * Devuelve verdadero si la persona elige sellar; si pasa a Prueba o cierra, falso.
 */
export function confirmarPrimerSelloOficial(): Promise<boolean> {
  if (!haceFaltaConfirmar(network.name, yaConfirmoPrimerOficial())) return Promise.resolve(true);
  return new Promise((resolve) => {
    let listo = false;
    const terminar = (sellar: boolean): void => {
      if (listo) return;
      listo = true;
      resolve(sellar);
    };
    const dlg = abrirDialogo({ titulo: t("firstOfficialTitle"), onCerrar: () => terminar(false) });
    const cuerpo = document.createElement("p");
    cuerpo.textContent = t("firstOfficialBody");
    dlg.cuerpo.appendChild(cuerpo);
    const sellarBtn = botonPrincipal(t("firstOfficialSeal"));
    sellarBtn.addEventListener("click", () => {
      marcarPrimerOficial();
      terminar(true);
      dlg.cerrar();
    });
    const aPrueba = document.createElement("button");
    aPrueba.type = "button";
    aPrueba.className = "mini ghost";
    aPrueba.textContent = t("firstOfficialToTest");
    aPrueba.addEventListener("click", () => {
      terminar(false);
      dlg.cerrar();
      pasarAModo("testnet");
    });
    dlg.pie.append(sellarBtn, aPrueba);
  });
}

/** Abre la hoja del modo. Sin modo Oficial para ofrecer, no hace nada. */
export function abrirHojaDeModo(): void {
  if (!hayModoOficial || typeof document === "undefined") return;
  document.querySelector(".modo-back")?.remove();
  const otro = otroModo(network.name);
  const bloqueado = !puedeCambiarDeModo();

  const back = document.createElement("div");
  back.className = "modal-back modo-back";
  const card = document.createElement("div");
  card.className = "modal-card modo-card";
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-modal", "true");
  card.setAttribute("aria-label", t("modeSheetTitle"));
  card.tabIndex = -1;

  const title = document.createElement("h3");
  title.textContent = t("modeSheetTitle");
  card.appendChild(title);

  for (const name of ["mainnet", "testnet"] as const) {
    const opcion = document.createElement("section");
    opcion.className = `modo-opcion${name === network.name ? " actual" : ""}`;
    const nombre = document.createElement("h4");
    nombre.textContent = t(modeNameKey(name));
    const cuerpo = document.createElement("p");
    cuerpo.textContent = t(name === "mainnet" ? "modeOfficialBody" : "modeTestBody");
    opcion.append(nombre, cuerpo);
    if (name === network.name) {
      const actual = document.createElement("p");
      actual.className = "modo-actual";
      actual.textContent = t("modeCurrent");
      opcion.appendChild(actual);
    }
    card.appendChild(opcion);
  }

  const boton = document.createElement("button");
  boton.type = "button";
  boton.className = "primary modo-cambiar";
  boton.textContent = t(otro === "mainnet" ? "modeSwitchToOfficial" : "modeSwitchToTest");
  boton.disabled = bloqueado;
  boton.addEventListener("click", () => pasarAModo(otro));
  card.appendChild(boton);

  if (bloqueado) {
    const aviso = document.createElement("p");
    aviso.className = "modo-bloqueo";
    aviso.textContent = t("modeSwitchBlocked");
    card.appendChild(aviso);
  }

  const cerrar = document.createElement("button");
  cerrar.type = "button";
  cerrar.className = "mini ghost";
  cerrar.textContent = t("impClose");
  cerrar.addEventListener("click", () => back.remove());
  card.appendChild(cerrar);

  back.appendChild(card);
  back.addEventListener("click", (e) => {
    if (e.target === back) back.remove();
  });
  document.body.appendChild(back);
  card.focus({ preventScroll: true });
}
