import { campanasActivo } from "../campana/bandera";
import { sinGrabar } from "../ensayo-modo";
import { network } from "../stellar/config";
import { modoDeRampa } from "../stellar/cuenta-config";

/**
 * Esta página recibió la entrada de quien ganó (`?premio=1`) y puede atenderla: con las campañas en el build, en la red
 * principal, fuera de la demo, del ensayo y del stand, y con la ventana del saldo prendida (`VITE_RAMPA`). Es la única
 * condición: la usan quien arranca la entrada y el flujo de la cuenta (que no abre su paso solo mientras la dirección la
 * pide), así no quedan dos lecturas distintas de lo mismo. Sin DOM más que la dirección, y sin red.
 */
export function pideElPremioAqui(): boolean {
  if (!campanasActivo()) return false;
  if (network.name !== "mainnet" || sinGrabar() || modoDeRampa() === "apagada") return false;
  try {
    return new URLSearchParams(location.search).get("premio") === "1";
  } catch {
    return false;
  }
}
