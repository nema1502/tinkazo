import { t } from "../i18n";
import { app } from "../state";
import { changeMode, hayModoOficial, modeNameKey, network, type NetworkName } from "../stellar/config";
import { hayCuentaGuardada } from "../stellar/cuenta-guardada";
import { cuponDelFragmento } from "../stellar/cupon-guardado";
import { limpiarPasoDelCupon } from "../stellar/cupon-paso-guardado";
import { activeWallet } from "../stellar/wallet-lite";
import { abrirDialogo, botonPrincipal } from "./dialogo";
import { MARCA_INGRESAR } from "./cuenta-estado";
import { pedirPasoDelCupon } from "./cupon-paso";

/**
 * La hoja para cambiar de modo.
 *
 * Tocar la marca no cambia nada todavía: explica los dos modos, marca el
 * actual y recién el botón recarga la página en el otro. Mientras se sella o
 * hay un sorteo sellado esperando su número, los botones quedan apagados y la
 * hoja dice por qué. Sin contrato oficial, esta hoja no existe.
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

/** Pide la puerta de entrar en la próxima carga. Su destino siempre es `#sortear`. */
function pedirIngresar(): void {
  try {
    sessionStorage.setItem(MARCA_INGRESAR, "1");
  } catch {
    /* sin almacenamiento, la herramienta conserva su botón de entrar */
  }
}

/** La cuenta abierta, distinguida por su billetera y no por su dirección. */
type CuentaParaElModo = "sitio" | "propia" | "prueba" | null;

function cuentaParaElModo(): CuentaParaElModo {
  const w = activeWallet();
  if (!w?.address) return null;
  if (w.kind === "guest") return "prueba";
  return (w as unknown as { submitsItself?: unknown }).submitsItself === true ? "sitio" : "propia";
}

/** El aviso de que cada modo retoma su propia cuenta, con los nombres visibles del idioma vigente. */
export function textoCuentaAlCambiar(actual: NetworkName, otro: NetworkName): string {
  return t("modeSwitchAccount").replace("{otro}", t(modeNameKey(otro))).replace("{actual}", t(modeNameKey(actual)));
}

/**
 * Cambia de modo si la guarda lo deja (`changeMode` recarga la página). Devuelve si se pidió el cambio.
 * Sin cuenta en el destino, abre `#sortear` y, si la cuenta abierta lo necesita, deja la marca de entrar después de
 * confirmar el cambio. Tengo un cupón conserva un cupón válido del fragmento: ese enlace ya tiene su propia puerta.
 */
export function pasarAModo(target: NetworkName, o: { cupon?: boolean } = {}): boolean {
  if (!puedeCambiarDeModo()) return false;
  const conCupon = target === "mainnet" && o.cupon === true;
  let conservarCupon = false;
  if (conCupon) {
    try {
      conservarCupon = cuponDelFragmento(location.hash).codigo !== null;
    } catch {
      conservarCupon = false;
    }
  }
  const cuentaEnDestino = hayCuentaGuardada(target);
  const destino = conservarCupon ? undefined : conCupon || !cuentaEnDestino ? "sortear" : undefined;
  const cambia = changeMode(target, destino);
  if (!cambia) return false;
  if (target === "testnet") limpiarPasoDelCupon();
  const cuenta = cuentaParaElModo();
  // Sin cuenta abierta sigue la puerta de siempre. Una billetera propia sirve en los dos modos y no la necesita.
  // La Cuenta de prueba solo la necesita al pasar a Oficial, donde hay que entrar con Google o con correo.
  const porLaCuenta = cuenta === null || cuenta === "sitio" || (cuenta === "prueba" && target === "mainnet");
  const ingresar = porLaCuenta && !cuentaEnDestino && !conservarCupon;
  if (conCupon) pedirPasoDelCupon(ingresar);
  else if (ingresar) pedirIngresar();
  return true;
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

export function marcarPrimerOficial(): void {
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

  const cuenta = cuentaParaElModo();
  if (cuenta === "sitio" || (cuenta === "prueba" && network.name === "testnet" && otro === "mainnet")) {
    const aviso = document.createElement("p");
    aviso.className = "modo-cuenta";
    aviso.textContent = cuenta === "prueba" ? t("modeSwitchGuestAccount") : textoCuentaAlCambiar(network.name, otro);
    card.appendChild(aviso);
  }

  if (network.name === "testnet") {
    const cupon = document.createElement("button");
    cupon.type = "button";
    cupon.className = "ghost modo-cupon";
    cupon.textContent = t("modeHaveCoupon");
    cupon.disabled = bloqueado;
    cupon.addEventListener("click", () => pasarAModo("mainnet", { cupon: true }));
    card.appendChild(cupon);
  }

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
