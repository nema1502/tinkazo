/**
 * Lo que comparten el sello (`freeze.ts`) y el sorteo (`draw.ts`) cuando Pollar pide proteger la cuenta antes de firmar:
 * saber si el error es ese y abrir "Protegé tu cuenta" (`proteger-cuenta.ts`).
 */

/** El error es que Pollar pide una forma de recuperar la cuenta antes de firmar (`SDK_WALLET_RECOVERY_REQUIRED`), y la cuenta es de Pollar. */
export async function pideProtegerLaCuenta(e: unknown): Promise<boolean> {
  try {
    const [{ errorKey }, { activeWallet }, { submitsItself }] = await Promise.all([import("../stellar/errores"), import("../stellar/wallet-lite"), import("../stellar/wallet-pollar")]);
    return submitsItself(activeWallet()) && errorKey(e) === "recoveryRequired";
  } catch {
    return false;
  }
}

/** Abre "Protegé tu cuenta". Devuelve si la cuenta quedó protegida; si no se pudo abrir, que no. */
export async function protegerLaCuenta(): Promise<boolean> {
  try {
    const [{ protegerCuenta }, { pollarWallet }] = await Promise.all([import("./proteger-cuenta"), import("../stellar/wallet-pollar")]);
    return await protegerCuenta(pollarWallet);
  } catch (e) {
    console.warn("[tinkazo] no se pudo abrir la protección de la cuenta", e);
    return false;
  }
}
