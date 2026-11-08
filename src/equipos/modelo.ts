import { stripInvisibles } from "../invisibles";

/**
 * Los equipos de un evento con cupón (Space Apps y parecidos).
 *
 * Cada equipo se anota desde el celular de su encargado con su cuenta de Stellar: la que recibe el cupón, entra a
 * la lista sellada y cobra el premio. El cupón es un pago de 1 stroop de XLM desde la cuenta del evento a la del
 * equipo, con una nota de texto fija. Recibirlo es tener el cupón; la lista que se sella son las cuentas con cupón,
 * en el orden en que lo recibieron.
 *
 * Este archivo es solo el modelo: los tipos, las notas y la forma de las cuentas. Nada de red ni de DOM.
 */

/** El evento del primer sorteo en mainnet (Space Apps Santa Cruz, noviembre de 2026). */
export const EVENTO_POR_DEFECTO = "space-apps-scz-2026";

/** Una nota de texto de Stellar mide, como mucho, 28 bytes. */
export const MAX_NOTA_BYTES = 28;

/** Un cupón vale un stroop de XLM: la unidad más chica de la red (0,0000001). */
export const CUPON_MONTO = "0.0000001";

/** Cuántas operaciones entran en una transacción de Stellar. */
export const TOPE_OPERACIONES = 100;

/** Cuántos integrantes se anotan por equipo, y cuántos hacen falta. */
export const MAX_INTEGRANTES = 5;
export const MIN_INTEGRANTES = 2;

/** Hasta dónde llega el nombre de un equipo y el de cada integrante. */
export const MAX_NOMBRE_EQUIPO = 40;
export const MAX_NOMBRE_INTEGRANTE = 30;

/**
 * Cómo se arma el registro:
 *  - `cupon`: el equipo queda anotado y recibe un cupón gratis (el de reserva, sin requisito);
 *  - `sorteo`: el equipo pide participar, quien organiza lo acepta, y para recibir el cupón tiene que haber
 *    hecho antes al menos un sorteo con Tinkazo desde su propia cuenta, en la misma red del evento.
 */
export type ModoEquipos = "cupon" | "sorteo";

/**
 * En qué punto está un equipo, de menos a más:
 *  - `solicitud`: pidió participar y quien organiza todavía no lo aceptó (solo en el modo `sorteo`);
 *  - `aceptado`: puede recibir su cupón (modo `cupon`), o tiene que hacer primero un sorteo con Tinkazo (modo `sorteo`);
 *  - `sorteo`: ya hizo un sorteo con su cuenta, y puede recibir su cupón;
 *  - `cupon`: ya recibió su cupón.
 */
export const ESTADOS = ["solicitud", "aceptado", "sorteo", "cupon"] as const;
export type EstadoEquipo = (typeof ESTADOS)[number];

export const esEstado = (x: unknown): x is EstadoEquipo => typeof x === "string" && (ESTADOS as readonly string[]).includes(x);

/** Dónde está `e` en la escalera de estados (para no volver nunca para atrás). */
export const rango = (e: EstadoEquipo): number => ESTADOS.indexOf(e);

/** La configuración del registro, tal como la guarda la sala (`workers/sala/src/logica.ts`). */
export interface ConfigEquipos {
  modo: ModoEquipos;
  /** El identificador corto del evento, sin espacios. */
  evento: string;
  /** La cuenta del evento: la que reparte los cupones. */
  cuenta: string;
}

/** Lo que se cifra de un equipo con la clave del QR: nunca llega a ningún servidor en claro. */
export interface DatosDeEquipo {
  nombre: string;
  integrantes: string[];
}

/** Un equipo tal como lo ve la pantalla de quien organiza. */
export interface Equipo extends DatosDeEquipo {
  /** El número que le dio la sala. */
  n: number;
  /** La cuenta que recibe el cupón y cobra el premio. */
  cuenta: string;
  /** El punto en que lo dejó la sala (lo que ve el celular del equipo). */
  guardado: EstadoEquipo;
  /** La versión de la sala en que cambió por última vez. */
  v: number;
  /** El nombre o algún integrante tiene algo que conviene mirar antes de mostrarlo: no sale hasta que quien organiza lo deja. */
  revisar: boolean;
  /** `true` si la cuenta existe en la red, `false` si todavía no está activa, `null` si no se sabe. */
  activa: boolean | null;
}

/** Una cuenta de Stellar: la letra G y 55 caracteres en base 32. */
export const ES_CUENTA = /^G[A-Z2-7]{55}$/;

export const esCuenta = (x: unknown): x is string => typeof x === "string" && ES_CUENTA.test(x);

/** Los bytes de un texto en UTF-8. */
export const bytesDe = (s: string): number => new TextEncoder().encode(s).length;

/** Un evento: minúsculas, números y guiones, de 3 caracteres a los que dejen la nota del cupón en 28 bytes. */
export function eventoValido(evento: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(evento) && evento.length >= 3 && bytesDe(memoCupon(evento)) <= MAX_NOTA_BYTES;
}

/**
 * La nota del cupón: `tk:cupon:<evento>`. Con el evento de Space Apps mide justo 28 bytes, el máximo que admite
 * una nota de texto de Stellar.
 */
export function memoCupon(evento: string): string {
  return `tk:cupon:${evento}`;
}

/** Una cuenta para mostrar sin ocupar media pantalla: `GABC…WXYZ`. */
export const cuentaCorta = (cuenta: string): string => (cuenta.length > 12 ? `${cuenta.slice(0, 4)}…${cuenta.slice(-4)}` : cuenta);

/**
 * La parte del registro que se parece a un nombre y viaja a la sala cifrada: el nombre del equipo y los de sus
 * integrantes, sin vacíos ni repetidos y con sus topes. Devuelve el motivo si no alcanza.
 */
export function limpiarEquipo(entrada: { nombre: string; integrantes: readonly string[] }): { ok: true; equipo: DatosDeEquipo } | { ok: false; motivo: "nombre" | "pocos" | "largo" } {
  const junta = (s: string): string => stripInvisibles(s.replace(/[\r\n\t]+/g, " ")).replace(/\s+/g, " ").trim();
  const nombre = junta(entrada.nombre);
  if (!nombre) return { ok: false, motivo: "nombre" };
  if (Array.from(nombre).length > MAX_NOMBRE_EQUIPO) return { ok: false, motivo: "largo" };
  const vistos = new Set<string>();
  const integrantes: string[] = [];
  for (const crudo of entrada.integrantes) {
    const n = junta(crudo);
    if (!n) continue;
    if (Array.from(n).length > MAX_NOMBRE_INTEGRANTE) return { ok: false, motivo: "largo" };
    const clave = n.toLocaleLowerCase();
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    integrantes.push(n);
  }
  if (integrantes.length < MIN_INTEGRANTES) return { ok: false, motivo: "pocos" };
  return { ok: true, equipo: { nombre, integrantes: integrantes.slice(0, MAX_INTEGRANTES) } };
}
