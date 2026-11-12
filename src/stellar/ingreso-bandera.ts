import { network } from "./config";

/**
 * La bandera del plan B del ingreso, `VITE_INGRESO_PLAN_B` (apagada por defecto). Es un archivo propio y mínimo a
 * propósito: la lee la billetera de Pollar (`wallet-pollar.ts`) y la pantalla (`src/ui/ingreso-plan-b.ts`), y ninguna
 * de las dos tiene que traer a la otra.
 *
 * Con 1 y en Prueba. Cualquier otro valor la deja apagada, y en Oficial nunca vale: ahí sin cuenta no se sortea. La
 * variable se lee en cada llamada y la red solo si la variable es 1, así apagada no depende de nada más.
 */
export function ingresoPlanB(env: Record<string, unknown> = import.meta.env, red?: string): boolean {
  if (!ingresoPlanBPrendida(env)) return false;
  return (red ?? network.name) === "testnet";
}

/**
 * Solo la variable del build, sin mirar la red: `VITE_INGRESO_PLAN_B=1`. Con ella apagada la herramienta no toca nada del
 * plan B, ni el almacenamiento de la pestaña. Prendida, limpiar lo que dejó el plan B vale en cualquier modo: en Oficial no se
 * ofrece ni se elige nada, pero una marca dejada en Prueba tiene que borrarse al entrar con una cuenta, y no revivir sola
 * al volver a Prueba.
 */
export function ingresoPlanBPrendida(env: Record<string, unknown> = import.meta.env): boolean {
  return env.VITE_INGRESO_PLAN_B === "1";
}
