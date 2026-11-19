import { t } from "../i18n";

/**
 * El paso «Dejá tu cuenta lista» no se pudo bajar (el wifi de un evento cortó justo esa descarga). Sin esto, en modo
 * Oficial el botón de sellar o de sortear quedaba callado: volvía a su texto y no pasaba nada. El navegador recuerda
 * una descarga fallida hasta recargar, así que tocar de nuevo no sirve: el aviso lo dice y ofrece volver a cargar.
 *
 * Vive aparte y sin otras dependencias que los textos: lo usan `cuenta-lista-flujo.ts`, `freeze.ts`, `draw.ts` y
 * `wallet-ui.ts`, también cuando lo que no bajó es el propio flujo.
 */
export const CLASE_NO_CARGO = "cl-no-cargo";

export function avisarQueNoCargo(recargar: () => void = () => location.reload()): void {
  if (typeof document === "undefined" || !document.body) return;
  document.querySelector(`.${CLASE_NO_CARGO}`)?.remove();
  const el = document.createElement("div");
  el.className = `wallet-notice bad ${CLASE_NO_CARGO}`;
  el.setAttribute("role", "alert");
  const frase = document.createElement("p");
  frase.textContent = t("clNoCargo");
  const acciones = document.createElement("div");
  acciones.className = "wallet-notice-acciones";
  const otraVez = document.createElement("button");
  otraVez.type = "button";
  otraVez.className = "mini ghost";
  otraVez.dataset.accion = "recargar";
  otraVez.textContent = t("loginRecargar");
  otraVez.addEventListener("click", () => recargar());
  const cerrar = document.createElement("button");
  cerrar.type = "button";
  cerrar.className = "mini ghost";
  cerrar.textContent = t("loginClose");
  cerrar.addEventListener("click", () => el.remove());
  acciones.append(otraVez, cerrar);
  el.append(frase, acciones);
  document.body.append(el);
}

/**
 * El flujo del paso no bajó: ¿hace falta frenar? Solo con una cuenta de Google o de correo (la que se activa y se
 * protege). Con billetera propia (Freighter) el paso nunca aplica y se sigue como siempre. Si ni eso se puede saber, se
 * frena con el aviso: en Oficial no se graba a ciegas.
 */
export async function frenarSinElPaso(): Promise<boolean> {
  let frenar = true;
  try {
    const { activeWallet } = await import("../stellar/wallet-lite");
    const w = activeWallet() as { submitsItself?: unknown } | null;
    frenar = !!w && w.submitsItself === true;
  } catch {
    frenar = true;
  }
  if (frenar) avisarQueNoCargo();
  return frenar;
}
