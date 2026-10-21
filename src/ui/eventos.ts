import { decodeProof } from "../protocol/proof";
import type { SorteoDelEvento } from "../protocol/evento";

/**
 * Los eventos con nombre de Mis sorteos.
 *
 * Un evento es una lista que arma quien organiza: un nombre, y los sorteos que
 * se le suman desde Mis sorteos. Vive en este equipo, igual que el historial,
 * y fuera de la cadena: el contrato no cambia y el enlace de evento lo arma la
 * página de evento a partir de los comprobantes. Cada sorteo se guarda con su
 * enlace de comprobante y sus ganadores, así que el evento no depende de que el
 * historial siga teniendo la fila.
 *
 * Las funciones de cambio son puras (devuelven una lista nueva) para que las
 * pruebas las recorran sin navegador. Lo que toca el almacenamiento está aparte.
 */

/** Un sorteo dentro de un evento: su enlace de comprobante y quién ganó. Lo demás sale del enlace. */
export interface SorteoGuardado {
  enlace: string;
  ganadores: string[];
}

export interface EventoGuardado {
  /** Identificador local, al azar. No sale de este equipo ni va al enlace. */
  id: string;
  nombre: string;
  /** La cuenta que lo armó: cada cuenta ve solo sus eventos. */
  organizer: string;
  sorteos: SorteoGuardado[];
}

const clave = (red: string): string => `tinkazo.eventos.${red}`;

/** Un valor guardado que no tiene la forma de un evento no entra. */
function esEvento(v: unknown): v is EventoGuardado {
  if (!v || typeof v !== "object") return false;
  const e = v as Partial<EventoGuardado>;
  return (
    typeof e.id === "string" &&
    typeof e.nombre === "string" &&
    typeof e.organizer === "string" &&
    Array.isArray(e.sorteos) &&
    e.sorteos.every((s) => !!s && typeof s.enlace === "string" && Array.isArray(s.ganadores))
  );
}

/** Los eventos de este equipo, en la red dada. Sin almacenamiento, no hay ninguno. */
export function leerEventos(red: string): EventoGuardado[] {
  try {
    const raw = localStorage.getItem(clave(red));
    if (!raw) return [];
    const lista = JSON.parse(raw) as unknown;
    return Array.isArray(lista) ? lista.filter(esEvento) : [];
  } catch {
    return [];
  }
}

/** Guarda la lista. Que no se pueda guardar no rompe nada: los eventos se ven hasta recargar. */
export function guardarEventos(red: string, lista: EventoGuardado[]): void {
  try {
    localStorage.setItem(clave(red), JSON.stringify(lista));
  } catch {
    /* sin espacio o sin almacenamiento: el historial tampoco se guarda entonces */
  }
}

/** Un identificador al azar, en hexadecimal. */
export function nuevoId(): string {
  const b = new Uint8Array(8);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

/** Los eventos de una cuenta. */
export function eventosDe(lista: EventoGuardado[], organizer: string): EventoGuardado[] {
  return lista.filter((e) => e.organizer === organizer);
}

/** Los enlaces de comprobante que ya están en algún evento de la cuenta: no se muestran sueltos. */
export function enlacesEnEventos(lista: EventoGuardado[], organizer: string): Set<string> {
  return new Set(eventosDe(lista, organizer).flatMap((e) => e.sorteos.map((s) => s.enlace)));
}

/** Agrega un evento vacío, al final. El nombre se recorta; uno vacío no se crea. */
export function crearEvento(lista: EventoGuardado[], organizer: string, nombre: string, id = nuevoId()): EventoGuardado[] {
  const limpio = nombre.trim();
  if (!limpio) return lista;
  return [...lista, { id, nombre: limpio, organizer, sorteos: [] }];
}

/** Cambia un evento por su identificador. Si no existe, la lista queda igual. */
function actualizar(lista: EventoGuardado[], id: string, cambio: (e: EventoGuardado) => EventoGuardado): EventoGuardado[] {
  return lista.map((e) => (e.id === id ? cambio(e) : e));
}

export function renombrarEvento(lista: EventoGuardado[], id: string, nombre: string): EventoGuardado[] {
  const limpio = nombre.trim();
  if (!limpio) return lista;
  return actualizar(lista, id, (e) => ({ ...e, nombre: limpio }));
}

/** Suma un sorteo al evento. Un sorteo que ya está no se repite. */
export function sumarAEvento(lista: EventoGuardado[], id: string, sorteo: SorteoGuardado): EventoGuardado[] {
  return actualizar(lista, id, (e) => (e.sorteos.some((s) => s.enlace === sorteo.enlace) ? e : { ...e, sorteos: [...e.sorteos, sorteo] }));
}

/** Saca un sorteo del evento. El sorteo sigue en Mis sorteos. */
export function quitarDeEvento(lista: EventoGuardado[], id: string, enlace: string): EventoGuardado[] {
  return actualizar(lista, id, (e) => ({ ...e, sorteos: e.sorteos.filter((s) => s.enlace !== enlace) }));
}

/** Borra el evento. Sus sorteos vuelven a verse en Mis sorteos. */
export function borrarEvento(lista: EventoGuardado[], id: string): EventoGuardado[] {
  return lista.filter((e) => e.id !== id);
}

/**
 * Lee el comprobante de un sorteo y lo junta con sus ganadores, como lo pide el
 * enlace de evento. Un enlace que no se lee devuelve null: ese sorteo no entra.
 */
export async function aSorteoDelEvento(enlace: string, ganadores: string[]): Promise<SorteoDelEvento | null> {
  try {
    const comprobante = await decodeProof(enlace.slice(enlace.indexOf("#")));
    return { ...comprobante, ganadores };
  } catch {
    return null;
  }
}

/** Los sorteos de un evento guardado, listos para armar su enlace. */
export async function sorteosDelEvento(ev: EventoGuardado): Promise<SorteoDelEvento[]> {
  const out: SorteoDelEvento[] = [];
  for (const s of ev.sorteos) {
    const sorteo = await aSorteoDelEvento(s.enlace, s.ganadores);
    if (sorteo) out.push(sorteo);
  }
  return out;
}
