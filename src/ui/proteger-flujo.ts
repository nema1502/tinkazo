/**
 * Lo que comparten el sello (`freeze.ts`) y el sorteo (`draw.ts`) cuando la cuenta de la red principal no puede firmar
 * todavía: saber si el error es ese y abrir «Dejá tu cuenta lista» (`cuenta-lista.ts`), la red de seguridad del paso.
 */

/**
 * El error es de la cuenta de Pollar, y el paso lo arregla: falta una forma de recuperarla
 * (`SDK_WALLET_RECOVERY_REQUIRED`), este navegador todavía no es de la cuenta (`SDK_COSIGN_DEVICE_NOT_ENROLLED`) o la
 * cuenta todavía no está activada. Solo en modo Oficial: en Prueba ninguno abre nada y el error se dice como cualquier otro.
 */
export async function pideProtegerLaCuenta(e: unknown): Promise<boolean> {
  try {
    const [{ errorKey }, { activeWallet }, { submitsItself }, { network }] = await Promise.all([
      import("../stellar/errores"),
      import("../stellar/wallet-lite"),
      import("../stellar/wallet-pollar"),
      import("../stellar/config"),
    ]);
    if (!submitsItself(activeWallet())) return false;
    const clave = errorKey(e);
    // Solo en modo Oficial: en Prueba el paso no existe, y abrir nada dejaba el error sin decir.
    return network.name === "mainnet" && (clave === "recoveryRequired" || clave === "deviceNotEnrolled" || clave === "accountNotReady");
  } catch {
    return false;
  }
}

/**
 * Abre el paso para el sello (`estadoId` es `"seal-status"`) o para el sorteo (`"draw-status"`). Devuelve `true` si la
 * persona dejó la cuenta lista y tocó el botón del final; `false` si salió o si no se pudo abrir. Antes de abrirlo suelta
 * siempre la pantalla completa: la sala no tiene que ver el paso en grande.
 *
 * `volverA` es el botón que sella o sortea: a esa altura ya está apagado y el foco cayó en la página, así que al cerrar el
 * paso hay que decirle a dónde volver.
 */
export async function protegerLaCuenta(volverA?: HTMLElement | null, estadoId?: string): Promise<boolean> {
  try {
    const para = estadoId === "draw-status" ? "sorteo" : "sello";
    const [{ soltarPantallaCompleta }, flujo] = await Promise.all([import("./pantalla-completa"), import("./cuenta-lista-flujo")]);
    if (!flujo.aplica()) return false;
    soltarPantallaCompleta();
    return await flujo.abrirParaElError(para, volverA ?? null);
  } catch (e) {
    console.warn("[tinkazo] no se pudo abrir el paso de la cuenta", e);
    return false;
  }
}
