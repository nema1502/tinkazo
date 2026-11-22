/**
 * Las palabras del modo, sin nada más: las leen la dirección (`?red=`), la pestaña, el valor con el que se construye el
 * sitio (`VITE_STELLAR_NETWORK`) y los frenos del build (`alta-build.ts` y `alta-textos-con-cobro.ts`). Vive aparte de
 * `config.ts` porque este archivo no importa nada y lo puede leer `vite.config.ts`, que no puede traer la configuración
 * del navegador.
 */

export type NetworkName = "testnet" | "mainnet";

/** El valor de `?red=`, de la pestaña o del build, en la red que nombra, o `null` si no dice nada que se entienda. */
export function parseModeValue(raw: string | null | undefined): NetworkName | null {
  const value = String(raw ?? "").trim().toLowerCase();
  if (value === "oficial" || value === "live" || value === "mainnet") return "mainnet";
  if (value === "prueba" || value === "test" || value === "testnet") return "testnet";
  return null;
}
