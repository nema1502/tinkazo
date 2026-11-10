import type { TipoDeEvento } from "../../workers/cuenta/src/reglas";
import { pedirEvento } from "./cuenta-api";
import { urlDeCuenta } from "./cuenta-config";

/**
 * Cuenta un hecho para las monedas (`primer_sorteo`, `comprobar`) sin frenar nada: si las monedas están apagadas o el
 * Worker no contesta, no pasa nada. El Worker decide si suma (una vez por cuenta, o hasta su tope): acá solo se avisa.
 */
export function acreditarEnSegundoPlano(cuenta: string, tipo: TipoDeEvento, ref?: string): void {
  const base = urlDeCuenta();
  if (!base) return;
  void pedirEvento(base, cuenta, tipo, ref);
}
