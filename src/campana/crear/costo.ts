import { DOLAR, comisionDe } from "../comision";
import { premiosDe } from "./armar";

/**
 * Cuánto pone la empresa en total: los premios, el servicio de Tinkazo y la suma. El servicio sale de la misma cuenta con que
 * el panel de la portada cobra (`comisionDe` sobre los premios que lleva la campaña), así el armado y el cobro nunca dicen
 * montos distintos.
 */

export interface PremiosDeLaCampana {
  /** Dólares digitales que se lleva cada persona. */
  monto: number;
  ganan: number;
}

/** Lo que cobra Tinkazo por activar la campaña, en dólares digitales. Sin el cobro configurado va en null. */
export interface ComisionDeLaCampana {
  dolares: number;
}

/** El porcentaje y el mínimo del cobro (`comisionDelBuild` de `src/stellar/comision-config.ts`). */
export interface ConfigDelCobro {
  pb: bigint;
  minimo: bigint;
}

/** Lo que cobra Tinkazo por unos premios, o `null` si todavía no hay premio elegido. */
export type ComisionDelArmado = (p: PremiosDeLaCampana) => ComisionDeLaCampana | null;

/**
 * El servicio de una campaña según sus premios, con la configuración del build: `null` sin cobro configurado. Los premios son
 * los mismos que van en la campaña (`premiosDe`), y el panel cobra `comisionDe` sobre ellos.
 */
export function comisionDelArmado(cfg: ConfigDelCobro | null): ComisionDelArmado | null {
  if (cfg === null) return null;
  return (p) => {
    if (!Number.isInteger(p.monto) || p.monto <= 0 || !Number.isInteger(p.ganan) || p.ganan < 1) return null;
    const comision = comisionDe(premiosDe(p.monto, p.ganan).map(BigInt), cfg.pb, cfg.minimo);
    return { dolares: Number(comision) / Number(DOLAR) };
  };
}

export interface CostoDeLaCampana {
  premios: number;
  /** Null sin cobro configurado: entonces no hay renglón. */
  comision: number | null;
  total: number;
}

/** Los renglones de lo que la empresa pone: los premios, la comisión si hay y el total. */
export function costoDeLaCampana(o: { premios: PremiosDeLaCampana; comision: ComisionDeLaCampana | null }): CostoDeLaCampana {
  const premios = o.premios.monto * o.premios.ganan;
  const comision = o.comision ? o.comision.dolares : null;
  return { premios, comision, total: premios + (comision ?? 0) };
}
