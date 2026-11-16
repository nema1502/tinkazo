import { QUICKNET, roundTime } from "../protocol/quicknet";

/**
 * El reloj del celular del espectador, contra el de la ronda.
 *
 * La cuenta regresiva de la vista de espectador (`espectador.ts`) sale de la hora de la ronda y del reloj del teléfono.
 * Si ese reloj está corrido, la cuenta también: adelantado, el celular va a buscar un número que todavía no existe y se
 * queda reintentando; atrasado, el show sale tarde. La sala no tiene ese problema porque mira una sola pantalla.
 *
 * El número más nuevo que publicó la ronda dice qué hora es con un margen de tres segundos (sale uno cada tres): nació
 * a su hora y todavía no nació el siguiente. Con eso alcanza para que la cuenta del celular y la de la sala digan lo
 * mismo. Si el reloj del teléfono cae dentro de ese margen, más lo que tarda la respuesta, no se toca: un reloj sano no
 * se corrige con uno peor. Si no se puede preguntar, tampoco: se cuenta con el reloj del teléfono, como antes.
 */

/** Lo que se le tolera al reloj del teléfono, además de los tres segundos entre número y número. */
const TOLERANCIA_S = 1.5;
/** Cuánto se espera la respuesta de cada servicio del número antes de pasar al siguiente. */
const PLAZO_MS = 3_000;

/** El número más nuevo, de la respuesta de un servicio, o null si no la entiende. */
export function rondaDe(cuerpo: unknown): number | null {
  if (typeof cuerpo !== "object" || cuerpo === null) return null;
  const r = Number((cuerpo as { round?: unknown }).round);
  return Number.isSafeInteger(r) && r > 0 ? r : null;
}

/**
 * Cuántos segundos hay que sumarle al reloj del teléfono para que diga la hora de la ronda. Cero si el reloj está bien,
 * si nadie contestó o si la respuesta no se entiende.
 *
 * `antes` y `despues` son la hora del teléfono (en segundos) al preguntar y al recibir la respuesta: la ronda
 * `ronda` nació en algún momento de `[roundTime(ronda) - lo que tardó, roundTime(ronda) + 3]`.
 */
export function desfaseDe(ronda: number, antes: number, despues: number): number {
  const nacio = roundTime(ronda);
  const tardo = Math.max(0, despues - antes);
  // La hora de verdad al recibir la respuesta está entre `nacio` y `nacio + 3 + tardo`.
  const desde = nacio - TOLERANCIA_S;
  const hasta = nacio + QUICKNET.period + tardo + TOLERANCIA_S;
  if (despues >= desde && despues <= hasta) return 0;
  // Corrido: se lo lleva al medio de lo posible.
  return nacio + (QUICKNET.period + tardo) / 2 - despues;
}

/** Pregunta el número más nuevo a los servicios de la ronda, uno por vez, y devuelve el desfase del reloj (o cero). */
export async function desfaseDelReloj(fetchFn: typeof fetch = fetch, ahora: () => number = () => Date.now() / 1000): Promise<number> {
  for (const relay of QUICKNET.relays) {
    const ctl = new AbortController();
    const plazo = setTimeout(() => ctl.abort(), PLAZO_MS);
    try {
      const antes = ahora();
      const res = await fetchFn(`${relay}/${QUICKNET.chainHash}/public/latest`, { cache: "no-store", signal: ctl.signal });
      if (!res.ok) continue;
      const ronda = rondaDe(await res.json());
      const despues = ahora();
      if (ronda !== null) return desfaseDe(ronda, antes, despues);
    } catch {
      /* el siguiente */
    } finally {
      clearTimeout(plazo);
    }
  }
  return 0;
}
