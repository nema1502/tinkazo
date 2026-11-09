import { type Evidencias, estadoEfectivo } from "./estado";
import type { Equipo, ModoEquipos } from "./modelo";

/**
 * Lo que decide la pantalla del stand (`src/ui/pantalla-stand.ts`), sin DOM: la cuenta regresiva hasta la hora del
 * sorteo, qué dice cada equipo y cómo se reparten los equipos en el proyector para que se lean desde el fondo del
 * salón sin hacer scroll.
 */

/* ------------------------------------------------------------ la hora del sorteo */

/** Una hora del día, como la escribe un `<input type="time">`: «18:30». */
const ES_HORA = /^([01]\d|2[0-3]):([0-5]\d)$/;

export const horaValida = (hora: string): boolean => ES_HORA.test(hora);

/** Si la hora fijada quedó más atrás que esto, es la de mañana (un sorteo a las 00:30 fijado a las 23:00). */
const ATRAS_MAXIMO_MS = 12 * 3_600_000;

/**
 * El instante del sorteo, en milisegundos, para una hora del día en la hora de este equipo: hoy a esa hora, o mañana
 * si la de hoy quedó más de doce horas atrás. `null` si no hay hora o no sirve.
 */
export function instanteDelSorteo(hora: string, ahora: number): number | null {
  const m = ES_HORA.exec(hora);
  if (!m) return null;
  const d = new Date(ahora);
  d.setHours(Number(m[1]), Number(m[2]), 0, 0);
  let t = d.getTime();
  if (t < ahora - ATRAS_MAXIMO_MS) {
    d.setDate(d.getDate() + 1);
    t = d.getTime();
  }
  return t;
}

export type Regresiva = { llego: false; texto: string; segundos: number } | { llego: true };

const dos = (n: number): string => String(n).padStart(2, "0");

/**
 * Cuánto falta, como se lee en un reloj: «4:05» (minutos y segundos) o, desde una hora, «1:04:05». Se redondea para
 * arriba: con 0,3 s todavía dice «0:01», y llega a la hora justo cuando el reloj marca cero.
 */
export function regresiva(objetivo: number, ahora: number): Regresiva {
  const s = Math.ceil((objetivo - ahora) / 1000);
  if (s <= 0) return { llego: true };
  const h = Math.floor(s / 3600);
  const min = Math.floor((s % 3600) / 60);
  const seg = s % 60;
  return { llego: false, segundos: s, texto: h > 0 ? `${h}:${dos(min)}:${dos(seg)}` : `${min}:${dos(seg)}` };
}

/* --------------------------------------------------------------- los equipos */

/** Lo que dice cada equipo en el proyector: tres palabras que se leen de lejos. */
export type EstadoEnPantalla = "anotado" | "aceptado" | "sorteo" | "cupon";

/**
 * El punto de cada equipo, dicho para la sala. Pedir participar y estar anotado en el modo de reserva son lo mismo
 * para quien mira: el equipo está anotado. Aceptado, ya sorteó y con cupón son los pasos que siguen.
 */
export function estadoEnPantalla(modo: ModoEquipos, e: Equipo, evidencias: Evidencias): EstadoEnPantalla {
  const ef = estadoEfectivo(modo, e.guardado, evidencias.get(e.cuenta));
  if (ef === "cupon") return "cupon";
  if (ef === "sorteo") return "sorteo";
  if (ef === "aceptado" && modo === "sorteo") return "aceptado";
  return "anotado";
}

export interface FilaDePantalla {
  n: number;
  nombre: string;
  estado: EstadoEnPantalla;
}

/**
 * Los equipos que se muestran, en el orden en que se anotaron: así cada equipo se encuentra donde se vio la primera
 * vez. Los que quien organiza todavía tiene que revisar no salen en el proyector, y tampoco se cuentan: el total y los
 * que tienen cupón son los de las tarjetas que se ven («3 de 5 equipos ya tienen su cupón» tiene que coincidir con lo
 * que se lee en la pantalla). El cupón se cuenta igual que sus etiquetas: lo que dice la red, o la sala si la red
 * todavía no se leyó.
 */
export function filasDePantalla(modo: ModoEquipos, equipos: readonly Equipo[], evidencias: Evidencias): { filas: FilaDePantalla[]; conCupon: number; total: number } {
  const orden = [...equipos].sort((a, b) => a.n - b.n);
  const filas = orden.filter((e) => !e.revisar).map((e) => ({ n: e.n, nombre: e.nombre, estado: estadoEnPantalla(modo, e, evidencias) }));
  const conCupon = filas.filter((f) => f.estado === "cupon").length;
  return { filas, conCupon, total: filas.length };
}

/* --------------------------------------------------------------- la grilla */

export interface Disposicion {
  columnas: number;
  filas: number;
  /** Cuántos equipos entran en una página. */
  porPagina: number;
  paginas: number;
  /** El tamaño de la letra de los nombres, en px. */
  letra: number;
}

/** Cuánto ocupa un equipo, en veces la letra: el nombre, su estado debajo y el aire; y el ancho de unas once letras. */
export const ALTO_EN_LETRAS = 3.4;
export const ANCHO_EN_LETRAS = 11;
/** Más de cuatro columnas no se leen desde el fondo: se pasa de página. */
const COLUMNAS_MAX = 4;

/**
 * Cómo repartir `n` equipos en un lugar de `ancho` × `alto` px: la letra más grande, entre `letraMin` y `letraMax`,
 * con la que entran todos sin scroll. Si ni con la mínima entran, se queda en la mínima y los equipos pasan en páginas.
 */
export function disposicion(n: number, ancho: number, alto: number, letraMin: number, letraMax: number): Disposicion {
  const capacidad = (letra: number): { columnas: number; filas: number } => ({
    columnas: Math.max(1, Math.min(COLUMNAS_MAX, Math.floor(ancho / (letra * ANCHO_EN_LETRAS)))),
    filas: Math.max(1, Math.floor(alto / (letra * ALTO_EN_LETRAS))),
  });
  const total = Math.max(1, n);
  let letra = Math.max(letraMin, letraMax);
  for (; letra > letraMin; letra -= 1) {
    const c = capacidad(letra);
    if (c.columnas * c.filas >= total) break;
  }
  letra = Math.max(letra, letraMin);
  const c = capacidad(letra);
  // Con pocos equipos no hace falta llenar columnas: tantas como hagan falta para que entren con las filas que hay.
  const columnas = Math.min(c.columnas, Math.max(1, Math.ceil(total / c.filas)));
  const filas = Math.min(c.filas, Math.ceil(total / columnas));
  const porPagina = columnas * c.filas;
  return { columnas, filas, porPagina, paginas: Math.max(1, Math.ceil(n / porPagina)), letra: Math.floor(letra) };
}

/** Los de la página `p` (desde 0), que da la vuelta. */
export function deLaPagina<T>(xs: readonly T[], porPagina: number, p: number): T[] {
  const paginas = Math.max(1, Math.ceil(xs.length / porPagina));
  const i = ((p % paginas) + paginas) % paginas;
  return xs.slice(i * porPagina, (i + 1) * porPagina);
}
