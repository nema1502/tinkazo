import { t } from "../i18n";
import { redPrincipalConPollar } from "../stellar/cobro-oficial";
import { network } from "../stellar/config";
import { esNoQueBloquea } from "../stellar/errores";
import { grifoDisponible } from "../stellar/grifo";
import type { AccionError } from "./error-accion";
import { currentSession } from "./wallet-ui";

/**
 * Con la lista ya sellada, el sorteo no puede quedarse sin salida porque el servicio que cubre la comisión no contesta,
 * no tiene fondo o ya no tiene cupo la cuenta. La primera acción sigue siendo reintentar; la segunda, si la cuenta
 * tiene con qué pagar la suya (o en testnet, el grifo se encarga), es "Sortear pagando con mi cuenta".
 *
 * El sorteo es el mismo y el ganador también: lo único que cambia es quién paga la comisión. Este archivo decide si se
 * ofrece y guarda la elección hasta el próximo intento (`draw.ts`). Con el cobro por uso del modo Oficial no se ofrece.
 */

/** La persona eligió pagar con su cuenta: vale para el próximo intento de sortear, una sola vez. */
let pagarConMiCuenta = false;

/** Se elige pagar con la propia cuenta para el próximo intento. */
export const elegirPagarConMiCuenta = (): void => {
  pagarConMiCuenta = true;
};

/** Lee y apaga la elección: el próximo sorteo ya no hereda lo que se eligió para este. */
export function tomarLaEleccion(): boolean {
  const eleccion = pagarConMiCuenta;
  pagarConMiCuenta = false;
  return eleccion;
}

/** Cuánto se espera el saldo para decidir si se ofrece la segunda salida. */
const TOPE_SALDO_MS = 3_000;

/**
 * Si, tras este error del portero, se puede ofrecer "Sortear pagando con mi cuenta": el error es de los que bloquean
 * (no es una comisión pedida de más ni una ventana vencida) y la cuenta puede pagar. En testnet con grifo siempre
 * puede: `conFondos` (anchor.ts) la carga antes de firmar.
 */
export async function sePuedeSortearPagando(e: unknown): Promise<boolean> {
  // En la red principal con una cuenta de Google o de correo no existe, con o sin banderas: cada firma de esa cuenta le
  // cuesta a Tinkazo, y sin el portero no hay quien la cuente (`cobro-oficial.ts`).
  if (redPrincipalConPollar()) return false;
  if (!esNoQueBloquea(e)) return false;
  const s = currentSession();
  if (!s) return false;
  if (network.name === "testnet" && grifoDisponible()) return true;
  try {
    const [{ umbralesDe }, { xlmBalance }] = await Promise.all([import("../stellar/chequeo-red"), import("../stellar/wallet-lite")]);
    const saldo = await Promise.race([xlmBalance(s.address), new Promise<number>((r) => setTimeout(() => r(-1), TOPE_SALDO_MS))]);
    const costo = network.name === "mainnet" ? 0.2 : 1;
    return saldo >= umbralesDe(network.name).comun.margenDeSaldo * costo;
  } catch {
    return false;
  }
}

/** La segunda acción del sorteo: deja elegido pagar con la cuenta; quien la muestra vuelve a sortear. */
export const accionDePagarConMiCuenta = (): AccionError => ({ texto: t("sortearPropio"), ejecutar: elegirPagarConMiCuenta });
