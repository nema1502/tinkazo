import { ErrorPortero, type EstadoDelPatrocinio, type OpcionesDeEstado, estadoDelPatrocinio } from "./patrocinador";

/**
 * Antes de pedir una firma de una cuenta de Google o de correo en el modo Oficial (`cobro-oficial.ts`), con o sin el cobro
 * por uso prendido en el build, qué dice el portero de esta cuenta: el bloque `oficial` de `/cupo` (sección 9 del
 * diseño). Cada firma de esa cuenta le cuesta créditos a Tinkazo aunque el portero después la rechace, así que esto va
 * antes de la firma y no después.
 *
 * - Para el sello: acceso al modo Oficial y sorteos oficiales que alcancen (uno hasta 50 ganadores, dos de 51 a 300),
 *   y que no se haya llegado al tope de sellos del mes.
 * - Para el sorteo: solo el acceso. Sortear lo que ya está sellado no gasta sorteos oficiales.
 * - Sin respuesta, con una respuesta que no se entiende o sin el bloque `oficial`: cerrado. No se firma.
 *
 * No sabe nada de la pantalla: `ui/sin-sorteos.ts` lo dibuja, y `ui/envio-sdk.ts` lo vuelve a mirar como candado justo
 * antes de la firma.
 */

/** Hasta cuántos ganadores un sello gasta un sorteo oficial; de ahí al tope del contrato, dos (lo mismo que el portero). */
export const GANADORES_POR_SORTEO = 50;

/** Cuántos sorteos oficiales gasta un sello con estos ganadores. Lo que no se pueda leer cuenta como lo más caro. */
export function sorteosDelSello(ganadores: number | null | undefined): number {
  return typeof ganadores === "number" && Number.isInteger(ganadores) && ganadores >= 1 && ganadores <= GANADORES_POR_SORTEO ? 1 : 2;
}

/** Lo que se decide antes de la firma. */
export type Acceso =
  | { que: "sigue" }
  /** La cuenta no está en el libro del portero: le falta un cupón o su primer paquete. */
  | { que: "sin-acceso" }
  /** No le quedan sorteos oficiales que alcancen para este sello. */
  | { que: "sin-sorteos"; quedan: number; hacenFalta: number }
  /** Le quedan sorteos, pero llegó al tope de sellos del mes. */
  | { que: "tope-mes"; liberaEn?: number; max?: number }
  /** No se sabe: el portero no contestó, contestó algo raro o no mandó lo oficial. */
  | { que: "cerrado"; motivo: string };

/** La decisión, sin red: lo que dice `/cupo` (ya leído por `leerCupo`), para qué es la firma y cuántos ganan. */
export function decidirAcceso(estado: EstadoDelPatrocinio, para: "sello" | "sorteo", ganadores?: number): Acceso {
  if (estado.rige === "cerrado") return { que: "cerrado", motivo: estado.motivo };
  const oficial = estado.oficial;
  // Sin el bloque oficial el portero no está contando el acceso (o no hay portero): ante la duda, no se firma.
  if (!oficial) return { que: "cerrado", motivo: estado.rige === "pollar" && !estado.configurado ? "sin-portero" : "sin-oficial" };
  if (!oficial.acceso) return { que: "sin-acceso" };
  if (para === "sorteo") return { que: "sigue" };
  if (!oficial.sorteos) return { que: "cerrado", motivo: "sin-sorteos-que-contar" };
  const hacenFalta = sorteosDelSello(ganadores);
  if (oficial.sorteos.quedan < hacenFalta) return { que: "sin-sorteos", quedan: oficial.sorteos.quedan, hacenFalta };
  // Los sellos que quedan son lo menor entre el mes y los sorteos oficiales: con sorteos de sobra, cero es el tope del mes.
  if (estado.rige === "portero" && estado.cupo.sellos.quedan <= 0) {
    return { que: "tope-mes", ...(estado.cupo.liberaEn > 0 ? { liberaEn: estado.cupo.liberaEn } : {}), ...(estado.cupo.sellos.max > 0 ? { max: estado.cupo.sellos.max } : {}) };
  }
  return { que: "sigue" };
}

export interface OpcionesDeAcceso extends OpcionesDeEstado {
  /** Cómo se pregunta: por defecto, `estadoDelPatrocinio` (las pruebas pasan otro). */
  consultar?: (g: string, o: OpcionesDeEstado) => Promise<EstadoDelPatrocinio>;
}

/** Pregunta a `/cupo` y decide. Nunca lanza: lo que falle es `cerrado`. */
export async function consultarAcceso(g: string | null | undefined, para: "sello" | "sorteo", ganadores?: number, o: OpcionesDeAcceso = {}): Promise<Acceso> {
  if (!g) return { que: "cerrado", motivo: "sin-cuenta" };
  const { consultar = estadoDelPatrocinio, ...opciones } = o;
  try {
    return decidirAcceso(await consultar(g, opciones), para, ganadores);
  } catch {
    return { que: "cerrado", motivo: "sin-respuesta" };
  }
}

/** Lo que no deja seguir, como el error del portero que ya entienden la pantalla y `errorKey`. */
export function errorDelAcceso(a: Exclude<Acceso, { que: "sigue" }>): ErrorPortero {
  switch (a.que) {
    case "sin-acceso":
      return new ErrorPortero("sin-alta", 403);
    case "sin-sorteos":
      return new ErrorPortero("sin-sorteos", 402);
    case "tope-mes":
      return new ErrorPortero("cupo-cuenta", 429, { que: "sellos", liberaEn: a.liberaEn, max: a.max });
    case "cerrado":
      return new ErrorPortero("cerrado", 0, { detalle: a.motivo });
  }
}

/**
 * El candado de antes de la firma: lanza el error del portero si el acceso no deja seguir. Usa lo que se supo hace poco
 * (la compuerta de la pantalla acaba de preguntar), y si no hay nada, pregunta.
 */
export async function exigirAcceso(g: string | null | undefined, para: "sello" | "sorteo", ganadores?: number, o: OpcionesDeAcceso = {}): Promise<void> {
  const a = await consultarAcceso(g, para, ganadores, o);
  if (a.que !== "sigue") throw errorDelAcceso(a);
}
