/**
 * Cuánto pone la empresa en total. Hoy solo son los premios: la comisión de Tinkazo, el día que se cobre, es un dato más
 * y se suma acá sin rehacer la página.
 */

export interface PremiosDeLaCampana {
  /** Dólares digitales que se lleva cada persona. */
  monto: number;
  ganan: number;
}

/** Lo que cobra Tinkazo por activar la campaña, en dólares digitales. Hoy no se cobra y va en null. */
export interface ComisionDeLaCampana {
  dolares: number;
}

export interface CostoDeLaCampana {
  premios: number;
  /** Null mientras no se cobre comisión: entonces no hay renglón. */
  comision: number | null;
  total: number;
}

/** Los renglones de lo que la empresa pone: los premios, la comisión si hay y el total. */
export function costoDeLaCampana(o: { premios: PremiosDeLaCampana; comision: ComisionDeLaCampana | null }): CostoDeLaCampana {
  const premios = o.premios.monto * o.premios.ganan;
  const comision = o.comision ? o.comision.dolares : null;
  return { premios, comision, total: premios + (comision ?? 0) };
}
