import { network, type NetworkName } from "./config";

/**
 * Apagar el grifo de testnet, para probar con una cuenta de verdad vacía.
 *
 * El grifo regala 10.000 XLM de prueba, y la interfaz lo ofrece en varios
 * lugares (el paso de fondos, la caja de la página, el panel de la cuenta) y lo
 * pide sola cuando una cuenta de Pollar no puede pagar la comisión. Eso es lo
 * que se quiere en el uso de todos los días y lo que tapa la prueba que importa:
 * sellar con una cuenta que tiene 0 XLM y ver quién paga la comisión.
 *
 * Con `?grifo=0` en la dirección, en testnet, el grifo queda apagado en toda la
 * interfaz: ningún botón lo ofrece, `fundWithFriendbot` no llama a la red y el
 * reintento automático no lo usa. En mainnet el parámetro se ignora, porque ahí
 * nunca hay grifo.
 *
 * Se lee una sola vez, al cargar. Y se recuerda mientras dure la pestaña
 * (`sessionStorage`), porque volver del ingreso con Google recarga la página sin
 * el parámetro, y lo mismo pasa al ir a otra página del sitio y volver: sin
 * recordarlo, el grifo se prendería a mitad de la prueba. `?grifo=1` (o
 * cualquier otro valor) lo vuelve a prender, y una pestaña nueva arranca con el
 * grifo prendido: así nadie lo deja apagado sin querer.
 */

/** Dónde se recuerda, mientras dure la pestaña. */
export const GRIFO_KEY = "tinkazo.grifo";

/** Qué hacer con lo recordado después de leer la dirección. */
export type AccionGrifo = "guardar" | "olvidar" | "nada";

export interface LecturaGrifo {
  /** El grifo está apagado en esta pestaña. */
  apagado: boolean;
  accion: AccionGrifo;
}

/**
 * Decide si el grifo está apagado, a partir de la dirección y de lo que se
 * recordó de antes. Es pura: no toca la página ni el almacenamiento.
 *
 * - Mainnet: el parámetro se ignora, y no se guarda nada.
 * - `?grifo=0`: apagado, y se recuerda.
 * - `?grifo=<otra cosa>`: prendido, y se olvida lo recordado.
 * - Sin el parámetro: queda como estaba.
 */
export function leerGrifo(search: string, recordado: boolean, red: NetworkName): LecturaGrifo {
  if (red !== "testnet") return { apagado: false, accion: "nada" };
  const valor = new URLSearchParams(search).get("grifo");
  if (valor === null) return { apagado: recordado, accion: "nada" };
  return valor === "0" ? { apagado: true, accion: "guardar" } : { apagado: false, accion: "olvidar" };
}

/**
 * Hay grifo para usar ahora: solo en testnet, solo si la red tiene uno
 * configurado y solo si nadie lo apagó.
 */
export const hayGrifo = (red: NetworkName, friendbotUrl: string | null, apagado: boolean): boolean =>
  red === "testnet" && !!friendbotUrl && !apagado;

/**
 * La ayuda que ofrece la interfaz a una cuenta de Pollar sin saldo cuando la
 * comisión no la paga la app, que es la caja de fondos con el grifo: solo en
 * testnet con el grifo prendido. En mainnet no existe, y con el grifo apagado
 * tampoco, porque quien apagó el grifo quiere ver el error tal cual.
 */
export const hayAyudaDeFondos = (red: NetworkName, apagado: boolean): boolean => red === "testnet" && !apagado;

/** Lo recordado en esta pestaña, o `false` si no se puede leer. */
function recordadoEnLaPestana(): boolean {
  try {
    return sessionStorage.getItem(GRIFO_KEY) === "0";
  } catch {
    return false;
  }
}

function anotar(accion: AccionGrifo): void {
  if (accion === "nada") return;
  try {
    if (accion === "guardar") sessionStorage.setItem(GRIFO_KEY, "0");
    else sessionStorage.removeItem(GRIFO_KEY);
  } catch {
    /* sin almacenamiento, vale para esta carga nada más */
  }
}

const lectura = leerGrifo(typeof location === "undefined" ? "" : location.search, recordadoEnLaPestana(), network.name);
anotar(lectura.accion);

/** El grifo está apagado en esta pestaña (`?grifo=0` en testnet). Se lee una sola vez. */
export const grifoApagado: boolean = lectura.apagado;

/** Hay grifo para usar ahora, con la red de esta carga y el parámetro de esta pestaña. */
export const grifoDisponible = (): boolean => hayGrifo(network.name, network.friendbotUrl, grifoApagado);
