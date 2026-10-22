import { t } from "../i18n";
import { network } from "../stellar/config";
import { anchorErrorText } from "./anchor";

/**
 * El mensaje de un error, y el detalle para la próxima vez.
 *
 * El mensaje es para la sala: qué pasó y qué hacer, sin tecnicismos. El detalle
 * es para quien tenga que averiguar qué pasó: una línea con la hora, el paso, la
 * red, el tipo de cuenta, la categoría y el código técnico (`codigoTecnico`, sin
 * nombres, sin la lista y con las cuentas tapadas). Queda plegado debajo del
 * mensaje ("Ver detalle"), con un botón para copiarlo, y se guarda en este
 * navegador: los últimos cinco, por si quien sorteó lo cuenta después.
 *
 * Hasta el 21 de octubre de 2026 el error de verdad iba solo a la consola, que en
 * un celular nadie ve: "la red rechazó tu transacción" no dejaba rastro.
 */

/** Dónde quedan los últimos errores en este navegador. */
export const CLAVE_ERRORES = "tinkazo.errores";
const CUANTOS = 5;

/** Qué tipo de cuenta firmaba, sin decir cuál: Pollar, Freighter o la de prueba. */
async function tipoDeCuenta(): Promise<string> {
  try {
    const [{ activeWallet }, { submitsItself }] = await Promise.all([import("../stellar/wallet-lite"), import("../stellar/wallet-pollar")]);
    const w = activeWallet();
    if (!w) return "sin-cuenta";
    return submitsItself(w) ? "pollar" : w.kind === "guest" ? "prueba" : "freighter";
  } catch {
    return "?";
  }
}

/** La línea del detalle de un error. */
export async function lineaDelError(e: unknown, paso: "sello" | "sorteo"): Promise<string> {
  const { errorKey, codigoTecnico } = await import("../stellar/errores");
  const cuando = new Date().toISOString().slice(0, 19) + "Z";
  return [cuando, paso, network.name, await tipoDeCuenta(), errorKey(e), codigoTecnico(e)].join(" · ");
}

/** Guarda la línea entre los últimos errores de este navegador. Sin almacenamiento, no pasa nada. */
export function guardarError(linea: string): void {
  try {
    const previos = JSON.parse(localStorage.getItem(CLAVE_ERRORES) ?? "[]") as unknown;
    const lista = Array.isArray(previos) ? previos.filter((x): x is string => typeof x === "string") : [];
    localStorage.setItem(CLAVE_ERRORES, JSON.stringify([linea, ...lista].slice(0, CUANTOS)));
  } catch {
    /* ventana privada o almacenamiento lleno: el detalle igual se ve en la pantalla */
  }
}

/**
 * Escribe el mensaje del error en `status` y, debajo, el detalle plegado. El
 * detalle va al lado del mensaje y no adentro: el mensaje es lo que se lee (y lo
 * que miran los auditores), el detalle es para copiar.
 */
export async function mostrarError(status: HTMLElement, e: unknown, paso: "sello" | "sorteo"): Promise<void> {
  const [mensaje, linea] = await Promise.all([anchorErrorText(e), lineaDelError(e, paso)]);
  status.textContent = mensaje;
  guardarError(linea);
  ponerDetalle(status, linea);
}

/** El detalle plegado, justo después del mensaje. Uno por mensaje: el de antes se reemplaza. */
export function ponerDetalle(status: HTMLElement, linea: string): void {
  const id = `${status.id}-detalle`;
  document.getElementById(id)?.remove();
  const caja = document.createElement("details");
  caja.id = id;
  caja.className = "txdetalle";
  const resumen = document.createElement("summary");
  resumen.dataset.i = "errDetalle";
  resumen.textContent = t("errDetalle");
  const codigo = document.createElement("code");
  codigo.className = "mono";
  codigo.textContent = linea;
  const copiar = document.createElement("button");
  copiar.type = "button";
  copiar.className = "ghost mini";
  copiar.dataset.i = "errCopiar";
  copiar.textContent = t("errCopiar");
  copiar.addEventListener("click", () => {
    const escrito = navigator.clipboard?.writeText(linea) ?? Promise.reject(new Error("sin portapapeles"));
    void escrito
      .then(() => {
        copiar.textContent = t("errCopiado");
        setTimeout(() => (copiar.textContent = t("errCopiar")), 1600);
      })
      .catch(() => {
        // Sin permiso para el portapapeles: queda seleccionado, para copiarlo a mano.
        const rango = document.createRange();
        rango.selectNodeContents(codigo);
        const sel = getSelection();
        sel?.removeAllRanges();
        sel?.addRange(rango);
      });
  });
  caja.append(resumen, codigo, copiar);
  status.insertAdjacentElement("afterend", caja);
}
