import { t } from "../i18n";
import { esDeRed } from "../stellar/errores";

/**
 * Los nombres con que el proveedor de cuentas (`@pollar/core`) dice «ese código no es» y «ese código venció» al verificar el
 * código de entrada. Existen los dos órdenes:
 * - `EMAIL_CODE_INVALID` y `EMAIL_CODE_EXPIRED` son los de su estado de error (`AUTH_ERROR_CODES`); `wallet-pollar.ts` los
 *   lanza como el mensaje del error.
 * - `INVALID_EMAIL_CODE` y `SDK_EMAIL_CODE_INVALID` (equivocado) y `SDK_EMAIL_CODE_EXPIRED` (vencido) son los que contesta
 *   su servicio, y el SDK los traduce a los anteriores.
 * El proveedor no define ningún `EXPIRED_EMAIL_CODE`: lo que no define no se acepta.
 */
const CODIGO_EQUIVOCADO: ReadonlySet<string> = new Set(["EMAIL_CODE_INVALID", "INVALID_EMAIL_CODE", "SDK_EMAIL_CODE_INVALID"]);
const CODIGO_VENCIDO: ReadonlySet<string> = new Set(["EMAIL_CODE_EXPIRED", "SDK_EMAIL_CODE_EXPIRED"]);

/** Los nombres con que un error dice qué le pasó: su mensaje y, si lo tiene, su `code`. */
function nombresDe(e: unknown): string[] {
  if (!(e instanceof Error)) return [];
  const code = (e as { code?: unknown }).code;
  return typeof code === "string" ? [e.message, code] : [e.message];
}

/** Solo los códigos confirmados atribuyen el fallo al código o a la conexión. */
export function errorDeCodigo(e: unknown, paso: "enviar" | "verificar"): string {
  const nombres = nombresDe(e);
  if (paso === "verificar" && nombres.some((n) => CODIGO_EQUIVOCADO.has(n))) return t("loginBadCode");
  if (paso === "verificar" && nombres.some((n) => CODIGO_VENCIDO.has(n))) return t("loginExpired");
  return t(esDeRed(e) ? "loginConexion" : paso === "enviar" ? "loginSendFailed" : "loginFailed");
}
