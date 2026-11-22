/**
 * Los eventos de una campaña. Todo lo que la empresa elige con clics y nada con
 * el teclado de números: los nueve departamentos de Bolivia más otra, el lugar
 * escrito a mano sin números que interpretar, el día de un calendario y la hora
 * de cierre en pasos de quince minutos, y el cupo con botones de más y menos.
 *
 * Puro, como el formulario de `src/campana/crear/estado.ts`: las funciones de
 * cambio devuelven una lista nueva y no tocan el DOM ni el reloj.
 */

import type { Lang } from "../idioma";
import { stripInvisibles } from "../invisibles";
import { fechaYHoraDe, sumarDias } from "../campana/crear/horas";

export const DEPARTAMENTOS = ["Beni", "Chuquisaca", "Cochabamba", "La Paz", "Oruro", "Pando", "Potosí", "Santa Cruz", "Tarija"] as const;

/** La ciudad que no es un departamento: ahí el lugar dice de más el barrio. */
export const OTRA_CIUDAD = "otra";

export const MAXIMO_DE_EVENTOS = 5;
export const CUPO_MINIMO = 10;
export const CUPO_MAXIMO = 500;
export const PASO_DEL_CUPO = 5;
/** La hora con la que nace un evento y ninguna elige por si sola salvo esta. */
export const CIERRE_INICIAL = "18:00";
export const CUPO_INICIAL = 100;

export interface EventoDeEmpresa {
  ciudad: string;
  lugar: string;
  /** "AAAA-MM-DD", del calendario. Sin día todavía: null. */
  dia: string | null;
  /** "HH:MM" en pasos de 15 minutos. */
  cierre: string;
  /** Cuántas personas caben. */
  cupo: number;
}

export type AccionDeEvento =
  | { tipo: "agregar" }
  | { tipo: "quitar"; n: number }
  | { tipo: "ciudad"; n: number; v: string }
  | { tipo: "lugar"; n: number; v: string }
  | { tipo: "dia"; n: number; v: string | null }
  | { tipo: "cierre"; n: number; v: string }
  | { tipo: "cupo-mas"; n: number }
  | { tipo: "cupo-menos"; n: number };

/** La hora de cierre va a saltos de quince minutos: 96 por día, del 00:00 al 23:45. */
export const HORAS_DE_CIERRE: readonly string[] = Array.from({ length: 96 }, (_, i) => {
  const horas = Math.floor(i / 4);
  const minutos = (i % 4) * 15;
  return `${String(horas).padStart(2, "0")}:${String(minutos).padStart(2, "0")}`;
});

const formaDeHora = /^([01]\d|2[0-3]):(00|15|30|45)$/u;
const citaDeFecha = /^(\d{4})-(\d{2})-(\d{2})$/u;

const eventoInicial = (): EventoDeEmpresa => ({ ciudad: "", lugar: "", dia: null, cierre: CIERRE_INICIAL, cupo: CUPO_INICIAL });

/** La lista con un solo evento, listo para elegir. */
export function eventosIniciales(): EventoDeEmpresa[] {
  return [eventoInicial()];
}

const con = (eventos: readonly EventoDeEmpresa[], n: number, cambio: (e: EventoDeEmpresa) => EventoDeEmpresa): EventoDeEmpresa[] =>
  eventos.map((e, i) => (i === n ? cambio(e) : e));

/** Lo que queda después de un gesto: agrega, saca o cambia un evento, siempre sin tocar la lista que le entra. */
export function reducirEventos(eventos: readonly EventoDeEmpresa[], accion: AccionDeEvento | readonly AccionDeEvento[]): EventoDeEmpresa[] {
  let lista: EventoDeEmpresa[] = [...eventos];
  for (const a of Array.isArray(accion) ? accion : [accion]) {
    lista = reducirUno(lista, a);
  }
  return lista;
}

function reducirUno(eventos: readonly EventoDeEmpresa[], a: AccionDeEvento): EventoDeEmpresa[] {
  switch (a.tipo) {
    case "agregar":
      return eventos.length < MAXIMO_DE_EVENTOS ? [...eventos, eventoInicial()] : [...eventos];
    case "quitar":
      return eventos.length > 1 ? eventos.filter((_, i) => i !== a.n) : [...eventos];
    case "ciudad":
      return DEPARTAMENTOS.includes(a.v as (typeof DEPARTAMENTOS)[number]) || a.v === OTRA_CIUDAD
        ? con(eventos, a.n, (e) => ({ ...e, ciudad: a.v }))
        : [...eventos];
    case "lugar":
      return con(eventos, a.n, (e) => ({ ...e, lugar: clampDelLugar(a.v) }));
    case "dia":
      return a.v === null || citaDeFecha.test(a.v)
        ? con(eventos, a.n, (e) => ({ ...e, dia: a.v }))
        : [...eventos];
    case "cierre":
      return formaDeHora.test(a.v) ? con(eventos, a.n, (e) => ({ ...e, cierre: a.v })) : [...eventos];
    case "cupo-mas":
      return con(eventos, a.n, (e) => ({ ...e, cupo: Math.min(e.cupo + PASO_DEL_CUPO, CUPO_MAXIMO) }));
    case "cupo-menos":
      return con(eventos, a.n, (e) => ({ ...e, cupo: Math.max(e.cupo - PASO_DEL_CUPO, CUPO_MINIMO) }));
  }
}

/** Lo que se queda del lugar escrito a mano: menos de lo que cabe y sin caracteres que no se ven. */
export function clampDelLugar(v: string): string {
  const limpio = stripInvisibles(v).replace(/\s+/gu, " ").trim();
  return limpio.length > 60 ? limpio.slice(0, 60).trim() : limpio;
}

/**
 * Los días del calendario: hoy en la zona del evento y los trece que siguen.
 * Vuelven "AAAA-MM-DD", igual que los selectores de fecha de `src/campana/crear/horas.ts`.
 */
export function diasDelCalendario(ahora: number, zona: string): string[] {
  const hoy = fechaYHoraDe(ahora, zona).fecha;
  return Array.from({ length: 14 }, (_, i) => sumarDias(hoy, i));
}

/** La ciudad para leerse, en el idioma de la vista previa. */
export function ciudadTexto(c: EventoDeEmpresa, idioma: Lang): string {
  if (c.ciudad === OTRA_CIUDAD) return idioma === "es" ? "Otra ciudad" : "Another city";
  return c.ciudad;
}

/** El lugar completo que sale en la campaña: lo escrito más la ciudad, y si la ciudad es otra, solo lo escrito. */
export function lugarTexto(c: EventoDeEmpresa): string {
  const lugar = clampDelLugar(c.lugar);
  if (c.ciudad === "" || c.ciudad === OTRA_CIUDAD) return lugar;
  return lugar === "" ? c.ciudad : `${lugar}, ${c.ciudad}`;
}
