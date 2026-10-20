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

/** La fecha larga del sello, en el idioma de la página: "20 de octubre de 2026" o "October 20, 2026". */
export function fechaLarga(secs: number, lang: "es" | "en"): string {
  return new Date(secs * 1000).toLocaleDateString(lang === "es" ? "es-BO" : "en-US", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}
