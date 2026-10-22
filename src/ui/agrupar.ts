/**
 * Los sorteos de un mismo evento, y la fecha con que se nombran.
 *
 * Funciones puras: sin DOM ni diccionario de textos, para que las pruebas las
 * recorran sin navegador y para que la página de evento las pueda importar sin
 * traerse el diccionario entero.
 */

/** Lo que hace falta de un sorteo para agruparlo: quién lo selló, cuándo y su enlace de comprobante. */
export interface Sorteado {
  organizer: string;
  sealedAt: number;
  proof?: string;
}

/** Una pausa de más de doce horas separa dos eventos. Con doce exactas, siguen siendo uno. */
export const PAUSA_EVENTO = 12 * 3600;

/**
 * ¿Trae comprobante? El enlace de verificación lleva el comprobante en el
 * fragmento. El enlace de la ronda de drand (el de respaldo) no lo trae, y ese
 * sorteo no entra en un evento.
 */
export function tieneComprobante(e: { proof?: string }): boolean {
  return !!e.proof && e.proof.includes("verificar.html#");
}

/**
 * Los eventos de la lista. Solo entran los sorteos con comprobante. Los de cada
 * cuenta, ordenados por el momento del sello, forman un evento mientras la
 * diferencia entre dos consecutivos sea de doce horas o menos. Las cuentas no
 * se mezclan nunca. Cada evento sale ordenado del más viejo al más nuevo.
 */
export function agrupar<T extends Sorteado>(sorteos: T[]): T[][] {
  const por = new Map<string, T[]>();
  for (const s of sorteos) {
    if (!tieneComprobante(s)) continue;
    const lista = por.get(s.organizer) ?? [];
    lista.push(s);
    por.set(s.organizer, lista);
  }
  const eventos: T[][] = [];
  for (const lista of por.values()) {
    const ordenados = [...lista].sort((a, b) => a.sealedAt - b.sealedAt);
    let actual: T[] = [];
    for (const s of ordenados) {
      const ultimo = actual[actual.length - 1];
      if (ultimo && s.sealedAt - ultimo.sealedAt > PAUSA_EVENTO) {
        eventos.push(actual);
        actual = [];
      }
      actual.push(s);
    }
    if (actual.length) eventos.push(actual);
  }
  return eventos;
}

/** Lo que hace falta de un sorteo para saber cuándo salió: su número en el contrato, la hora del sello y la ronda. */
export interface ConOrden {
  id?: string;
  contract?: string;
  sealedAt?: number;
  round?: number;
}

/**
 * Los sorteos de un evento en el orden en que salieron: por su número en el
 * contrato. Si alguno no tiene número, o vienen de contratos distintos (si el
 * contrato se vuelve a desplegar, los números arrancan de nuevo), por la hora
 * del sello y después por la ronda. No cambia la lista que recibe.
 *
 * Hasta el 21 de octubre de 2026 el mensaje y la foto del evento los contaban
 * en el orden en que se habían sumado: el mismo evento salía distinto si se
 * armaba con "Crear evento" o con "Ponerle nombre" (evaluación crítica de
 * experiencia, hallazgo 10).
 */
export function enOrdenDeSalida<T extends ConOrden>(sorteos: readonly T[]): T[] {
  const numero = (s: T): bigint | null => (s.id && /^\d+$/.test(s.id) ? BigInt(s.id) : null);
  const contratos = new Set(sorteos.map((s) => s.contract ?? ""));
  const porNumero = contratos.size <= 1 && sorteos.every((s) => numero(s) !== null);
  return [...sorteos].sort((a, b) => {
    if (porNumero) {
      const d = (numero(a) ?? 0n) - (numero(b) ?? 0n);
      if (d !== 0n) return d < 0n ? -1 : 1;
    }
    return (a.sealedAt ?? 0) - (b.sealedAt ?? 0) || (a.round ?? 0) - (b.round ?? 0);
  });
}

/** La fecha larga del sello, en el idioma de la página: "20 de octubre de 2026" o "October 20, 2026". */
export function fechaLarga(secs: number, lang: "es" | "en"): string {
  return new Date(secs * 1000).toLocaleDateString(lang === "es" ? "es-BO" : "en-US", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}
