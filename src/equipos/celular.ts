import type { NetworkName } from "../stellar/config";
import type { DatosDeEquipo } from "./modelo";

/**
 * Lo que el celular del encargado recuerda de su equipo y de su primer sorteo, sin red.
 *
 * El equipo que anotó queda en este navegador (el nombre y los integrantes que escribió, y la cuenta con que se
 * anotó): ahí no hay nada que ocultar y evita pedirlos de nuevo. En ningún caso se manda a un servidor en claro.
 *
 * «Hacé tu primer sorteo con Tinkazo»: el botón arma una lista con los integrantes y el premio «¿Quién presenta
 * primero?» como borrador de esta pestaña (el mismo `tinkazo.borrador` que ya repone la herramienta), y la
 * herramienta se abre con la sesión de la cuenta. Es solo una sugerencia, editable: lo que cuenta para el cupón es
 * el sello en la cadena, que lee la pantalla de quien organiza.
 */

export interface EquipoLocal extends DatosDeEquipo {
  cuenta: string;
  /** La sala en que se anotó (su identificador), para no mezclar un evento con otro. */
  sala: string;
}

const CLAVE_EQUIPO = "tinkazo.equipo";

export function guardarEquipoLocal(e: EquipoLocal, almacen: Pick<Storage, "setItem"> = localStorage): void {
  try {
    almacen.setItem(CLAVE_EQUIPO, JSON.stringify(e));
  } catch {
    /* sin almacenamiento, hay que escribirlo otra vez: nada más */
  }
}

export function leerEquipoLocal(sala: string, almacen: Pick<Storage, "getItem"> = localStorage): EquipoLocal | null {
  try {
    const x = JSON.parse(almacen.getItem(CLAVE_EQUIPO) ?? "null") as Partial<EquipoLocal> | null;
    if (!x || x.sala !== sala || typeof x.cuenta !== "string" || typeof x.nombre !== "string" || !Array.isArray(x.integrantes)) return null;
    return { cuenta: x.cuenta, nombre: x.nombre, integrantes: x.integrantes.filter((s): s is string => typeof s === "string"), sala };
  } catch {
    return null;
  }
}

const CLAVE_LLAVES = "tinkazo.equipo.llaves";
/** Cuántas salas recuerda: una sala vive 10 horas, así que alcanza con las últimas. */
const MAX_LLAVES = 8;

/**
 * La llave de este celular para una sala: 16 bytes al azar, en base64url. Va con cada alta del equipo y la sala
 * guarda solo su huella: después, solo quien la tiene puede cambiar los datos de esa cuenta. Es una por sala y no por
 * cuenta, así que el mismo celular puede anotar otra cuenta en la misma sala y volver a la primera.
 *
 * Se guarda antes de mandar el alta: si la respuesta se pierde, el reintento lleva la misma. Sin almacenamiento
 * devuelve una nueva cada vez; quien la pide la conserva mientras la página esté abierta.
 */
export function llaveDelCelular(sala: string, almacen: Pick<Storage, "getItem" | "setItem"> = localStorage): string {
  let lista: [string, string][] = [];
  try {
    const x = JSON.parse(almacen.getItem(CLAVE_LLAVES) ?? "[]") as unknown;
    if (Array.isArray(x)) lista = x.filter((e): e is [string, string] => Array.isArray(e) && typeof e[0] === "string" && typeof e[1] === "string");
  } catch {
    /* sin almacenamiento o con algo roto: se empieza de nuevo */
  }
  const hay = lista.find(([s]) => s === sala)?.[1];
  if (hay) return hay;
  let bin = "";
  for (const b of crypto.getRandomValues(new Uint8Array(16))) bin += String.fromCharCode(b);
  const llave = btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  try {
    almacen.setItem(CLAVE_LLAVES, JSON.stringify([...lista, [sala, llave]].slice(-MAX_LLAVES)));
  } catch {
    /* sin almacenamiento: vale mientras la página esté abierta */
  }
  return llave;
}

/** El premio con que se sugiere el primer sorteo del equipo. */
export const PREMIO_SUGERIDO = "¿Quién presenta primero?";

/** El borrador de la herramienta (`tinkazo.borrador`, en `ui/participants.ts`): el texto, el premio y cuántos ganan. */
export function borradorDelPrimerSorteo(e: DatosDeEquipo, premio: string = PREMIO_SUGERIDO): { texto: string; premio: string; nw: string } {
  return { texto: e.integrantes.join("\n"), premio, nw: "1" };
}

/**
 * Deja el borrador y el pedido de abrir la herramienta en esta pestaña. `false` si el navegador no deja guardar
 * (entonces el botón lleva igual a la herramienta, y el equipo escribe su lista).
 */
export function prepararPrimerSorteo(e: DatosDeEquipo, premio: string, almacen: Pick<Storage, "setItem">): boolean {
  try {
    almacen.setItem("tinkazo.borrador", JSON.stringify(borradorDelPrimerSorteo(e, premio)));
    almacen.setItem("tinkazo.abrir", "app");
    return true;
  } catch {
    return false;
  }
}

/** Un sorteo de esta cuenta que el navegador recuerda. */
export interface SorteoLocal {
  /** El enlace del comprobante, si lo tiene. */
  proof?: string;
  id?: string;
  sealedAt: number;
}

/**
 * El sorteo más nuevo que esta cuenta selló desde este navegador, en la red del evento, o `null`. Lee el historial
 * de Mis sorteos (`tinkazo.history.<red>`). Que lo recuerde el navegador no lo prueba: eso lo prueba la cadena, que
 * es lo que lee la pantalla de quien organiza. Acá solo sirve para decir «Listo» enseguida y mostrar el comprobante.
 */
export function sorteoPropioLocal(cuenta: string, red: NetworkName, almacen: Pick<Storage, "getItem">): SorteoLocal | null {
  try {
    const lista = JSON.parse(almacen.getItem(`tinkazo.history.${red}`) ?? "[]") as unknown;
    if (!Array.isArray(lista)) return null;
    let mejor: SorteoLocal | null = null;
    for (const e of lista as { organizer?: unknown; id?: unknown; proof?: unknown; sealedAt?: unknown; sealTx?: unknown; sinSello?: unknown }[]) {
      if (e?.organizer !== cuenta || e.sinSello === true) continue;
      // Sin número de sorteo ni transacción, nunca llegó a sellarse en la cadena.
      if (typeof e.id !== "string" && typeof e.sealTx !== "string") continue;
      const sealedAt = Number(e.sealedAt ?? 0);
      if (!mejor || sealedAt >= mejor.sealedAt) {
        mejor = { sealedAt, ...(typeof e.id === "string" ? { id: e.id } : {}), ...(typeof e.proof === "string" && e.proof ? { proof: e.proof } : {}) };
      }
    }
    return mejor;
  } catch {
    return null;
  }
}
