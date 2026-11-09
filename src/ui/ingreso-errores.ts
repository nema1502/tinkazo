import { t } from "../i18n";
import { esDeRed } from "../stellar/errores";

/** Solo los códigos confirmados atribuyen el fallo al código o a la conexión. */
export function errorDeCodigo(e: unknown, paso: "enviar" | "verificar"): string {
  const causa = e instanceof Error ? e.message : "";
  if (paso === "verificar" && causa === "EMAIL_CODE_INVALID") return t("loginBadCode");
  if (paso === "verificar" && causa === "EMAIL_CODE_EXPIRED") return t("loginExpired");
  return t(esDeRed(e) ? "loginConexion" : paso === "enviar" ? "loginSendFailed" : "loginFailed");
}
