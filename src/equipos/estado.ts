import { type Equipo, type EstadoEquipo, type ModoEquipos, rango } from "./modelo";

/**
 * Qué se sabe de un equipo y qué le toca, sin red ni DOM.
 *
 * Los equipos viven en la sala con el punto en que los dejó quien organiza (`guardado`), pero la verdad está en la
 * cadena: si el equipo ya tiene su cupón, o si ya hizo un sorteo con su cuenta. La pantalla las lee y de las dos
 * cosas sale el estado de ahora, que nunca vuelve para atrás.
 */

/** Lo que la cadena dice de una cuenta. */
export interface Evidencia {
  /** Ya selló un sorteo con esta cuenta como organizadora, en la red del evento (solo importa en el modo `sorteo`). */
  yaSorteo?: { id: string; contrato: string } | undefined;
  /** Ya recibió su cupón: `orden` sirve para ordenar la lista (el menor recibió primero) y `hash` para el enlace. */
  cupon?: { orden: bigint; hash: string } | undefined;
}

export type Evidencias = ReadonlyMap<string, Evidencia>;

const mayor = (a: EstadoEquipo, b: EstadoEquipo): EstadoEquipo => (rango(a) >= rango(b) ? a : b);

/**
 * El estado de ahora: lo que dejó la sala, subido por lo que dice la cadena.
 *  - con el cupón recibido, `cupon`;
 *  - en el modo `sorteo`, un equipo aceptado que ya sorteó pasa a `sorteo`; uno que todavía no fue aceptado sigue
 *    en `solicitud` aunque haya sorteado (primero lo acepta quien organiza).
 */
export function estadoEfectivo(modo: ModoEquipos, guardado: EstadoEquipo, ev: Evidencia | undefined): EstadoEquipo {
  if (ev?.cupon) return "cupon";
  if (modo === "sorteo" && ev?.yaSorteo && rango(guardado) >= rango("aceptado")) return mayor(guardado, "sorteo");
  return guardado;
}

/** Si a este equipo le toca recibir un cupón ahora. */
export function leToca(modo: ModoEquipos, e: Equipo, ev: Evidencia | undefined): boolean {
  if (e.revisar) return false;
  const estado = estadoEfectivo(modo, e.guardado, ev);
  if (estado === "cupon" || estado === "solicitud") return false;
  // En el modo de reserva basta con estar anotado; con el requisito, el equipo tiene que haber sorteado.
  return modo === "cupon" || estado === "sorteo";
}

/** Los equipos a los que hay que mandarles el cupón: los que les toca, y cuya cuenta ya existe en la red. */
export function paraDarCupon(modo: ModoEquipos, equipos: readonly Equipo[], evidencias: Evidencias): { listos: Equipo[]; inactivos: Equipo[] } {
  const listos: Equipo[] = [];
  const inactivos: Equipo[] = [];
  for (const e of equipos) {
    if (!leToca(modo, e, evidencias.get(e.cuenta))) continue;
    if (e.activa === false) inactivos.push(e);
    else listos.push(e);
  }
  return { listos, inactivos };
}

/** Los equipos con cupón, en el orden en que lo recibieron. */
export function conCupon(equipos: readonly Equipo[], evidencias: Evidencias): Equipo[] {
  return equipos
    .filter((e) => evidencias.get(e.cuenta)?.cupon)
    .sort((a, b) => {
      const x = evidencias.get(a.cuenta)?.cupon?.orden ?? 0n;
      const y = evidencias.get(b.cuenta)?.cupon?.orden ?? 0n;
      return x < y ? -1 : x > y ? 1 : a.n - b.n;
    });
}

/**
 * Los nombres con que se muestran los equipos en el show y en el resultado: el del equipo. Si dos equipos se llaman
 * igual, el segundo lleva "(2)" y así: las cuentas son distintas, pero en la pantalla no se distinguirían.
 */
export function etiquetasDeEquipos(equipos: readonly Equipo[]): Map<string, string> {
  const vistas = new Map<string, number>();
  const out = new Map<string, string>();
  for (const e of equipos) {
    const base = e.nombre;
    const clave = base.toLocaleLowerCase();
    const veces = (vistas.get(clave) ?? 0) + 1;
    vistas.set(clave, veces);
    out.set(e.cuenta, veces === 1 ? base : `${base} (${veces})`);
  }
  return out;
}

/**
 * La lista para sellar: las cuentas de los equipos con cupón, una por línea, en el orden en que recibieron el
 * cupón (protocolo §1: una entrada por línea, y el orden es el de entrada). Y la etiqueta de cada una, que queda
 * solo en este navegador para mostrar el nombre del equipo: la lista sellada y la cadena solo tienen cuentas.
 */
export function listaDesdeCupones(equipos: readonly Equipo[], evidencias: Evidencias): { lineas: string[]; etiquetas: Map<string, string> } {
  const ordenados = conCupon(equipos, evidencias);
  return { lineas: ordenados.map((e) => e.cuenta), etiquetas: etiquetasDeEquipos(ordenados) };
}

/** Cuántos equipos hay en cada punto. */
export function contarPorEstado(modo: ModoEquipos, equipos: readonly Equipo[], evidencias: Evidencias): Record<EstadoEquipo, number> {
  const out: Record<EstadoEquipo, number> = { solicitud: 0, aceptado: 0, sorteo: 0, cupon: 0 };
  for (const e of equipos) out[estadoEfectivo(modo, e.guardado, evidencias.get(e.cuenta))]++;
  return out;
}

/** Lo que conviene hacer ahora, para marcar un solo botón de la pantalla de quien organiza. */
export type Sugerida = "aceptar" | "cupones" | "lista" | "ninguna";

export function accionSugerida(modo: ModoEquipos, equipos: readonly Equipo[], evidencias: Evidencias): Sugerida {
  if (modo === "sorteo" && equipos.some((e) => e.guardado === "solicitud" && !e.revisar)) return "aceptar";
  if (paraDarCupon(modo, equipos, evidencias).listos.length > 0) return "cupones";
  if (conCupon(equipos, evidencias).length >= 2) return "lista";
  return "ninguna";
}
