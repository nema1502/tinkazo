/**
 * El informe del evento y el pago a quien organizó. Es la parte del panel que
 * dice en qué quedó la inscripción y el sorteo de una campaña publicada, y la
 * que la empresa usa para pagarle con botones a quien organizó, sin escribir
 * números.
 *
 * Puro, como el resto de la pieza: lo que toca la red está en `deposito.ts`.
 */

export interface GanadoraDelInforme {
  cuenta: string;
  nombre: string;
  /* La de la lista que ganó un premio: en Tinkazo todas las ganadoras cobran, así que siempre yendo. */
  premia: boolean;
  pagada: boolean;
}

export interface ResultadosDeLaCampana {
  estado: string;
  anotadas: number;
  ganadoras: readonly GanadoraDelInforme[];
}

export type EstadoDelInforme =
  | { tipo: "sin-campana" }
  | { tipo: "parcial-abierto"; anotadas: number }
  | { tipo: "parcial-cerrado"; anotadas: number }
  | { tipo: "hecho"; anotadas: number; ganadoras: { cuenta: string; nombre: string; pagada: boolean }[] };

/** Qué muestra el informe, según lo que la campaña dice de sí misma. */
export function estadoDelInforme(c: ResultadosDeLaCampana | null): EstadoDelInforme {
  if (c === null) return { tipo: "sin-campana" };
  const ganado = c.estado === "sorteada" || c.estado === "terminada";
  if (!ganado) {
    if (c.estado === "borrador") return { tipo: "sin-campana" };
    return { tipo: c.estado === "abierta" ? "parcial-abierto" : "parcial-cerrado", anotadas: c.anotadas };
  }
  return {
    tipo: "hecho",
    anotadas: c.anotadas,
    ganadoras: c.ganadoras
      .filter((g) => g.premia)
      .slice(0, 10)
      .map((g) => ({ cuenta: g.cuenta, nombre: g.nombre, pagada: g.pagada })),
  };
}

/* ------------------------------------------------------------- el pago a quien organizó */

/** Los montos de la lista de botones, en dólares digitales enteros. */
export const MONTOS_DEL_PAGO = [5, 10, 20, 50] as const;

export interface PagoDelInforme {
  monto: number | null;
}

export const pagoInicialDelInforme = (): PagoDelInforme => ({ monto: null });

export type AccionDelPago =
  | { tipo: "fijo"; v: number }
  | { tipo: "mas" }
  | { tipo: "menos" };

/** Un solo gesto con los botones: elige un monto de la lista, o camina por ella. */
export function reducirPagoDelInforme(p: PagoDelInforme, accion: AccionDelPago): PagoDelInforme {
  const enLa = (m: number): number => (MONTOS_DEL_PAGO as readonly number[]).indexOf(m);
  const actual = p.monto !== null && enLa(p.monto) >= 0 ? enLa(p.monto) : null;
  switch (accion.tipo) {
    case "fijo":
      return { monto: (MONTOS_DEL_PAGO as readonly number[]).includes(accion.v) ? accion.v : p.monto };
    case "mas": {
      const siguiente = Math.min(actual === null ? 0 : actual + 1, MONTOS_DEL_PAGO.length - 1);
      return { monto: MONTOS_DEL_PAGO[siguiente] ?? p.monto };
    }
    case "menos":
      if (actual === null) return { ...p };
      return { monto: MONTOS_DEL_PAGO[Math.max(actual - 1, 0)] ?? p.monto };
  }
}
