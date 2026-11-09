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
  "Quirquincho Quique", "Oso Olga", "Guacamaya Gaby", "Taruca Tere", "Chinchilla Chela", "Picaflor Pía",
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
export function conDemo(): boolean {
  try {
    return typeof location !== "undefined" && new URLSearchParams(location.search).has("demo");
  } catch {
    return false;
  }
}

/**
 * Nada de lo que pasa en esta pestaña se graba: ni el sello ni el sorteo en la
 * cadena, ni Mis sorteos, ni el premio recordado, ni el enlace corto, ni el
 * borrador de la lista. Es la demo, el ensayo o el modo stand.
 */
export function sinGrabar(): boolean {
  return conDemo() || enEnsayo() || enStand();
}

/* ------------------------------------------------------------------ modo stand */

const CLAVE_STAND = "tinkazo.stand";

/**
 * La espera del modo stand, en segundos: «Arranca en 3». No hay número público
 * que esperar, así que no se finge una cuenta regresiva más larga.
 */
export const STAND_ESPERA_S = 3;

let standEnMemoria = false;

/**
 * Si esta pestaña está en el modo stand: rondas de ejemplo para una feria, con
 * los nombres de quienes están ahí. Se marca en la pestaña y no en la dirección,
 * como el ensayo, para que el navegador no lo autocomplete el día en que se
 * sortea en serio desde la misma compu. Nunca toca la red para elegir.
 */
export function enStand(): boolean {
  if (standEnMemoria) return true;
  try {
    return sessionStorage.getItem(CLAVE_STAND) === "1";
  } catch {
    return false;
  }
}

/** Entra al modo stand o sale de él, en esta pestaña. */
export function marcarStand(si: boolean): void {
  standEnMemoria = si;
  try {
    if (si) sessionStorage.setItem(CLAVE_STAND, "1");
    else sessionStorage.removeItem(CLAVE_STAND);
  } catch {
    /* sin almacenamiento, el modo stand dura lo que la página, y nunca graba */
  }
}

const CLAVE_SALIDA = "tinkazo.stand-salir";

/**
 * «Salir» del modo stand, en dos tiempos. La página se recarga, y al irse
 * (`pagehide`) la herramienta guarda el borrador de la lista, salvo que la
 * pestaña siga en el modo: si el modo se apagara antes de recargar, esa
 * escritura guardaría los nombres del stand como si fueran el borrador de un
 * sorteo de verdad, o borraría el que quien organiza tenía armado. Por eso
 * antes de recargar solo se deja una marca y el modo sigue puesto; la página
 * nueva lo apaga (`cerrarSalidaDelStand`) antes de reponer ningún borrador.
 */
export function pedirSalidaDelStand(): void {
  try {
    sessionStorage.setItem(CLAVE_SALIDA, "1");
  } catch {
    /* sin almacenamiento, recargar tira también el modo, que vive en la memoria de la página */
  }
}

/**
 * Se llama al arrancar, antes de reponer el borrador: si la página anterior
 * pidió salir del modo stand, lo apaga y borra la marca. Devuelve si salió.
 * Cerrar la pestaña o recargarla sin haber pedido salir no deja marca: el modo
 * sigue, y el borrador sigue sin tocarse.
 */
export function cerrarSalidaDelStand(): boolean {
  let pidio = false;
  try {
    pidio = sessionStorage.getItem(CLAVE_SALIDA) === "1";
    if (pidio) sessionStorage.removeItem(CLAVE_SALIDA);
  } catch {
    return false;
  }
  if (pidio) marcarStand(false);
  return pidio;
}

/** El ensayo o el modo stand: rondas que no se graban, sin cuenta y sin número público. */
export function enPractica(): boolean {
  return enEnsayo() || enStand();
}

/** Lo que llega de la ronda de ejemplo: lo mismo que un faro de verdad, sin serlo. */
export interface FaroDeStand {
  round: number;
  randomness: string;
  signature: string;
}

/**
 * El «número» de una ronda de stand: 32 bytes de `crypto.getRandomValues`, sin
 * red y sin `Math.random`. Elige con el mismo `select` que un sorteo de verdad
 * (ver `playGame` en src/ui/draw.ts), pero no es público ni se puede comprobar:
 * no hay firma. La firma va en ceros para que nadie la tome por una de verdad.
 */
export function faroDeStand(round: number, bytes: Uint8Array = crypto.getRandomValues(new Uint8Array(32))): FaroDeStand {
  let hex = "";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return { round, randomness: hex, signature: "0".repeat(96) };
}
