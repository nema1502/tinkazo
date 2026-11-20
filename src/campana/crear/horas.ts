/**
 * Días y horas del evento. Los selectores del navegador ya devuelven "AAAA-MM-DD" y "HH:MM" sin importar el idioma, así
 * que nada de lo escrito se interpreta. Todo se calcula en la zona del evento y no en la de la máquina que corre el código,
 * para que un evento de La Paz armado desde otra ciudad (o corrido en una prueba) viaje con las horas de La Paz.
 */

const MINUTO = 60_000;
const HORA = 60 * MINUTO;
/** Entre abrir y el sorteo no pueden pasar más de 12 horas: la sala vive 24 y el evento es de un solo rato. */
export const MAXIMO_HASTA_EL_SORTEO_MS = 12 * HORA;

const FECHA = /^(\d{4})-(\d{2})-(\d{2})$/u;
const HORA_DEL_DIA = /^(\d{2}):(\d{2})$/u;

/** La zona del navegador, o UTC si no hay o Intl la rechaza. */
export function zonaDelNavegador(): string {
  try {
    const zona = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!zona) return "UTC";
    new Intl.DateTimeFormat("es", { timeZone: zona }).format(0);
    return zona;
  } catch {
    return "UTC";
  }
}

/** Lo que marca el reloj de una zona en un instante, leído como si fuera UTC. */
function relojComoUtc(zona: string, t: number): number {
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: zona,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(t);
  const valor = (tipo: string): number => Number(partes.find((p) => p.type === tipo)?.value ?? "0");
  return Date.UTC(valor("year"), valor("month") - 1, valor("day"), valor("hour") % 24, valor("minute"), valor("second"));
}

/** Cuánto se adelanta el reloj de la zona sobre UTC en un instante. */
function desfase(zona: string, t: number): number {
  return relojComoUtc(zona, t) - (t - (t % 1000));
}

/** El instante de un día y una hora vistos en una zona, o null si no tienen la forma. */
export function instanteDe(fecha: string, hora: string, zona: string): number | null {
  const f = FECHA.exec(fecha);
  const h = HORA_DEL_DIA.exec(hora);
  if (!f || !h) return null;
  const [anio, mes, dia, horas, minutos] = [f[1], f[2], f[3], h[1], h[2]].map(Number) as [number, number, number, number, number];
  if (horas > 23 || minutos > 59) return null;
  const supuesto = Date.UTC(anio, mes - 1, dia, horas, minutos);
  const comprobacion = new Date(supuesto);
  if (comprobacion.getUTCMonth() !== mes - 1 || comprobacion.getUTCDate() !== dia) return null;
  try {
    const primero = supuesto - desfase(zona, supuesto);
    const otro = desfase(zona, primero);
    // El día del cambio de horario el desfase de la primera cuenta puede no ser el de ese instante: se corrige una vez.
    return otro === desfase(zona, supuesto) ? primero : supuesto - otro;
  } catch {
    return null;
  }
}

/** Lo inverso: el día y la hora que marca el reloj de la zona en un instante. */
export function fechaYHoraDe(ms: number, zona: string): { fecha: string; hora: string } {
  const instante = new Date(relojComoUtc(zona, ms));
  const dos = (n: number): string => String(n).padStart(2, "0");
  return {
    fecha: `${instante.getUTCFullYear()}-${dos(instante.getUTCMonth() + 1)}-${dos(instante.getUTCDate())}`,
    hora: `${dos(instante.getUTCHours())}:${dos(instante.getUTCMinutes())}`,
  };
}

/** El día de una fecha más n días, sin mirar ninguna zona. */
export function sumarDias(fecha: string, n: number): string {
  const f = FECHA.exec(fecha);
  if (!f) return fecha;
  const t = new Date(Date.UTC(Number(f[1]), Number(f[2]) - 1, Number(f[3]) + n));
  const dos = (x: number): string => String(x).padStart(2, "0");
  return `${t.getUTCFullYear()}-${dos(t.getUTCMonth() + 1)}-${dos(t.getUTCDate())}`;
}

/** El día de hoy en la zona. */
export function hoyEn(ahora: number, zona: string): string {
  return fechaYHoraDe(ahora, zona).fecha;
}

/** Cuántos minutos del día es una hora "HH:MM", o null. */
function minutosDe(hora: string): number | null {
  const h = HORA_DEL_DIA.exec(hora);
  return h ? Number(h[1]) * 60 + Number(h[2]) : null;
}

function horaDeMinutos(minutos: number): string {
  const m = ((minutos % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

export type ProblemaDeHora = "falta-dia" | "falta-hora" | "abre-pasada" | "cierra-antes" | "cierra-lejos" | "sorteo-antes" | "sorteo-lejos";
export type DondeDeHora = "ccp-dia" | "ccp-abre" | "ccp-cierra" | "ccp-sorteo";

export interface DiaYHoras {
  fecha: string;
  abre: string;
  cierra: string;
  sorteo: string;
  zona: string;
}

export interface InstantesDelEvento {
  abreMs: number;
  cierraMs: number;
  sorteoMs: number;
  /** Si el cierre cae al día siguiente (abre 22:00 y cierra 01:00), para mostrar la marca +1 día. */
  cierraMasUno: boolean;
  sorteoMasUno: boolean;
  /** Si el sorteo, escrito en el día del cierre, quedaba antes del cierre y hubo que pasarlo al día siguiente. */
  sorteoGiro: boolean;
}

/**
 * Los tres instantes del evento. Si el cierre queda antes de abrir en el reloj, es del día siguiente, y lo mismo el
 * sorteo contra el cierre. Null si falta algo o no tiene la forma.
 */
export function instantesDe(f: DiaYHoras): InstantesDelEvento | null {
  const abreMs = instanteDe(f.fecha, f.abre, f.zona);
  if (abreMs === null) return null;
  let cierraMs = instanteDe(f.fecha, f.cierra, f.zona);
  if (cierraMs === null) return null;
  let cierraMasUno = false;
  if (cierraMs < abreMs) {
    const otro = instanteDe(sumarDias(f.fecha, 1), f.cierra, f.zona);
    if (otro === null) return null;
    cierraMs = otro;
    cierraMasUno = true;
  }
  let sorteoMs = instanteDe(cierraMasUno ? sumarDias(f.fecha, 1) : f.fecha, f.sorteo, f.zona);
  if (sorteoMs === null) return null;
  let sorteoMasUno = cierraMasUno;
  let sorteoGiro = false;
  if (sorteoMs < cierraMs) {
    sorteoGiro = true;
    const otro = instanteDe(sumarDias(f.fecha, cierraMasUno ? 2 : 1), f.sorteo, f.zona);
    if (otro === null) return null;
    sorteoMs = otro;
    sorteoMasUno = true;
  }
  return { abreMs, cierraMs, sorteoMs, cierraMasUno, sorteoMasUno, sorteoGiro };
}

/**
 * El primer problema de las horas, con el campo que hay que corregir. Rechaza que cierre y abra sean la misma hora, que
 * el sorteo quede antes del cierre sin ser del día siguiente (más de 12 horas después de abrir) y que entre abrir y el
 * sorteo pasen más de 12 horas. Abrir tiene que ser en el futuro.
 */
export function revisarHoras(f: DiaYHoras, ahora: number): { problema: ProblemaDeHora; donde: DondeDeHora } | null {
  if (!f.fecha || instanteDe(f.fecha, "00:00", f.zona) === null) return { problema: "falta-dia", donde: "ccp-dia" };
  if (!f.abre || !f.cierra || !f.sorteo) return { problema: "falta-hora", donde: !f.abre ? "ccp-abre" : !f.cierra ? "ccp-cierra" : "ccp-sorteo" };
  const abreMs = instanteDe(f.fecha, f.abre, f.zona);
  if (abreMs === null) return { problema: "falta-hora", donde: "ccp-abre" };
  if (abreMs <= ahora) return { problema: "abre-pasada", donde: "ccp-abre" };
  if (f.cierra === f.abre) return { problema: "cierra-antes", donde: "ccp-cierra" };
  const t = instantesDe(f);
  if (!t) return { problema: "falta-hora", donde: "ccp-cierra" };
  // Un cierre a más de 12 horas de abrir (por ejemplo 18:00 abriendo a las 20:00, que ya es del día siguiente) no es una noche
  // larga: se dice que queda lejos y no que sea antes de abrir, porque la persona ve +1 día y el mensaje se contradiría.
  if (t.cierraMs - t.abreMs > MAXIMO_HASTA_EL_SORTEO_MS) return { problema: "cierra-lejos", donde: "ccp-cierra" };
  if (t.sorteoMs - t.abreMs > MAXIMO_HASTA_EL_SORTEO_MS) {
    // Un sorteo escrito antes del cierre que dio la vuelta al día es un error de la hora del sorteo, no un plazo largo.
    return { problema: t.sorteoGiro ? "sorteo-antes" : "sorteo-lejos", donde: "ccp-sorteo" };
  }
  return null;
}

/** La próxima hora que cae en múltiplo de 5 minutos, en la zona (la hora justa no cuenta: ya pasó). */
export function proximaHoraDeCinco(ahora: number, zona: string): string {
  const siguiente = Math.floor(ahora / (5 * MINUTO)) * 5 * MINUTO + 5 * MINUTO;
  return fechaYHoraDe(siguiente, zona).hora;
}

/**
 * Si el día es hoy y la hora de abrir ya pasó, pone la de abrir en la próxima de 5 minutos y corre el cierre y el sorteo
 * lo mismo, para que sigan en orden con sus mismas separaciones. Sin cambio, devuelve las mismas horas.
 */
export function ajustarHoras(f: DiaYHoras, ahora: number): { abre: string; cierra: string; sorteo: string; ajustada: boolean } {
  const igual = { abre: f.abre, cierra: f.cierra, sorteo: f.sorteo, ajustada: false };
  if (!f.fecha || f.fecha !== hoyEn(ahora, f.zona)) return igual;
  const abreMs = instanteDe(f.fecha, f.abre, f.zona);
  if (abreMs === null || abreMs > ahora) return igual;
  const abre = proximaHoraDeCinco(ahora, f.zona);
  const [a, c, s] = [minutosDe(f.abre), minutosDe(f.cierra), minutosDe(f.sorteo)];
  const nueva = minutosDe(abre);
  if (a === null || c === null || s === null || nueva === null) return igual;
  const hastaCierre = (c - a + 1440) % 1440 || 480;
  const hastaSorteo = (s - c + 1440) % 1440;
  return {
    abre,
    cierra: horaDeMinutos(nueva + hastaCierre),
    sorteo: horaDeMinutos(nueva + hastaCierre + hastaSorteo),
    ajustada: true,
  };
}

/** El nombre corto de una zona para decirlo en pantalla: lo que va después de la barra, con espacios. */
export function nombreCortoDeZona(zona: string): string {
  const resto = zona.includes("/") ? zona.slice(zona.lastIndexOf("/") + 1) : zona;
  return resto.replace(/_/gu, " ");
}
