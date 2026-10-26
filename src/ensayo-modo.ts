/**
 * El ensayo y lo que nunca se graba.
 *
 * El ensayo es la herramienta de verdad con una lista de ejemplo: la persona
 * toca "Sellar la lista" y "Lanzar el sorteo" en sus lugares de siempre, y nada
 * de eso se graba, aunque tenga una cuenta abierta. Reemplaza a "Cargar
 * ejemplo": hasta el 22 de octubre de 2026, con una cuenta abierta, cargar el
 * ejemplo y sellar grababa en la cadena, a nombre de quien probaba y con
 * comisión, un sorteo de dieciocho nombres inventados que además le quedaba en
 * Mis sorteos (diseño del onboarding, 22 de octubre de 2026).
 *
 * Vive en la pestaña (`sessionStorage`) y no en la dirección, a propósito: el
 * navegador no lo autocompleta cuando alguien tipea "tinkazo" en el evento.
 * También en la memoria de la página: si el almacenamiento no responde (una
 * ventana privada con todo bloqueado), el ensayo igual nunca graba.
 *
 * Este archivo no toca la página ni importa nada: lo usan el sello, el sorteo y
 * la capa que habla con la cadena, y sus pruebas corren en Node.
 */

const CLAVE = "tinkazo.ensayo";

/** La espera del número en el ensayo, en segundos. En un sorteo de verdad son unos 45. */
export const ENSAYO_ESPERA_S = 15;

/**
 * La lista del ensayo: dieciocho nombres de la fauna de Bolivia, que no se
 * pueden confundir con nadie de la sala. La demo sigue con su lista de siempre
 * (`SAMPLE` en state.ts): los auditores dependen de ella.
 */
export const LISTA_ENSAYO: readonly string[] = [
  "Llama Lupe", "Cóndor Beto", "Vicuña Vale", "Alpaca Ana", "Puma Pepe", "Zorro Zoe",
  "Quirquincho Quique", "Jucumari Juana", "Paraba Paula", "Taruca Tere", "Chinchilla Chela", "Picaflor Pía",
  "Suri Susi", "Vizcacha Vico", "Tunqui Toto", "Parihuana Pili", "Jaguar Jacinto", "Capibara Cata",
];

let enMemoria = false;

/** Si esta pestaña está en el ensayo. */
export function enEnsayo(): boolean {
  if (enMemoria) return true;
  try {
    return sessionStorage.getItem(CLAVE) === "1";
  } catch {
    return false;
  }
}

/** Entra al ensayo o sale de él, en esta pestaña. */
export function marcarEnsayo(si: boolean): void {
  enMemoria = si;
  try {
    if (si) sessionStorage.setItem(CLAVE, "1");
    else sessionStorage.removeItem(CLAVE);
  } catch {
    /* sin almacenamiento, el ensayo dura lo que la página, y nunca graba */
  }
}

/** La demo: `?demo=` en la dirección. Se mira en cada llamada, sin `state.ts`, que lee la dirección al cargarse. */
function conDemo(): boolean {
  try {
    return typeof location !== "undefined" && new URLSearchParams(location.search).has("demo");
  } catch {
    return false;
  }
}

/**
 * Nada de lo que pasa en esta pestaña se graba: ni el sello ni el sorteo en la
 * cadena, ni Mis sorteos, ni el premio recordado, ni el enlace corto, ni el
 * borrador de la lista. Es la demo o el ensayo.
 */
export function sinGrabar(): boolean {
  return conDemo() || enEnsayo();
}
