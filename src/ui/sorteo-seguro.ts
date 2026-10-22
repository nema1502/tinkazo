/**
 * Grabar el sorteo en la cadena con reintentos, frente a la sala.
 *
 * Reintentar el sorteo siempre es seguro: el contrato acepta uno solo por sello
 * (`AlreadyDrawn`), y el resultado no depende de quién ni de cuándo se manda,
 * solo de la ronda y de la lista sellada. Por eso, ante un corte de red, la red
 * ocupada o la ronda que la cadena todavía no ve (su hora va unos segundos
 * atrás del navegador), se vuelve a probar solo, con una espera que crece, y
 * antes de cada intento se mira si ya quedó registrado.
 *
 * No se reintenta lo que no se arregla esperando: la persona canceló en la
 * billetera, no hay saldo, la cuenta no está lista, el contrato no encuentra el
 * sorteo o no acepta la prueba de la ronda.
 *
 * Hasta el 21 de octubre de 2026 eran cuatro intentos cada cinco segundos, con
 * cualquier error: con Freighter, cancelar abría la ventana de aprobar otras tres
 * veces.
 */

/** Las esperas entre intentos: cinco intentos en total. */
export const ESPERAS_DEL_SORTEO_MS = [2000, 4000, 8000, 16000] as const;
/** Pasado este tiempo desde el primer intento no se espera más: la sala está mirando. */
export const PRESUPUESTO_DEL_SORTEO_MS = 90_000;

export interface PasosDelSorteo<T> {
  /** Un intento de grabarlo (`drawOnChain`). */
  intentar: () => Promise<T>;
  /** Si ya quedó registrado (por un intento cortado o por otra persona), lo que quedó (`readDraw`). */
  yaEsta: () => Promise<T | null>;
  /** Si con este error vale la pena volver a probar. */
  reintentable: (e: unknown) => boolean | Promise<boolean>;
  ahora?: () => number;
  dormir?: (ms: number) => Promise<void>;
  /** Antes de cada espera: el número del próximo intento, cuántos hay, y el error de recién. */
  alReintentar?: (proximo: number, total: number, e: unknown) => void;
}

export type FinDelSorteo<T> = { ok: true; valor: T; yaEstaba: boolean } | { ok: false; error: unknown };

export async function sortearConReintentos<T>(p: PasosDelSorteo<T>): Promise<FinDelSorteo<T>> {
  const ahora = p.ahora ?? Date.now;
  const dormir = p.dormir ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const inicio = ahora();
  const total = ESPERAS_DEL_SORTEO_MS.length + 1;
  for (let i = 0; ; i++) {
    try {
      return { ok: true, valor: await p.intentar(), yaEstaba: false };
    } catch (e) {
      // Si alguien más ya lo finalizó, o el intento cortado sí entró, el resultado es público.
      // Si la red tampoco contesta acá, se sigue: antes esto trababa el botón (QA, 16 de octubre de 2026).
      const ya = await p.yaEsta().catch(() => null);
      if (ya) return { ok: true, valor: ya, yaEstaba: true };
      const espera = ESPERAS_DEL_SORTEO_MS[i];
      if (espera === undefined || ahora() - inicio + espera > PRESUPUESTO_DEL_SORTEO_MS || !(await p.reintentable(e))) {
        return { ok: false, error: e };
      }
      p.alReintentar?.(i + 2, total, e);
      await dormir(espera);
    }
  }
}

/** Las claves de error (`errorKey`) con las que vale la pena volver a probar el sorteo. */
export const SORTEO_REINTENTABLE = new Set(["rpcDown", "offline", "busy", "unconfirmed", "roundNotReady", "unknown"]);

/**
 * La línea que ve la sala mientras se vuelve a probar, según lo que pasó (la
 * clave de i18n). Hasta el 21 de octubre de 2026 todo lo que no era la red caída
 * decía "la cadena todavía no ve esa ronda", también con la red ocupada.
 */
export function avisoDelReintento(clave: string): "drawTry" | "drawTryRed" | "drawTryOcupada" | "drawTryOtra" {
  if (clave === "roundNotReady") return "drawTry";
  if (clave === "rpcDown" || clave === "offline" || clave === "unconfirmed") return "drawTryRed";
  if (clave === "busy") return "drawTryOcupada";
  return "drawTryOtra";
}
