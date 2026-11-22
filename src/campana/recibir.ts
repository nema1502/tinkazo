/**
 * A dónde lleva Recibir mi premio. Vive solo y sin importar nada: la página del celular, el correo de la sala y la pantalla
 * del premio de la herramienta lo usan, y ninguna tiene que cargar a las otras para saber una dirección.
 */

/** El destino de Recibir mi premio dentro de este sitio, según la red de esta página. */
export const destinoDeRecibir = (red: "mainnet" | "testnet"): string => (red === "mainnet" ? "/?red=oficial&premio=1" : "/?red=prueba&premio=1");

/**
 * El mismo destino como enlace entero, para mandarlo a otro navegador o a otra compu: la dirección del sitio de esta página
 * más el destino. Con un origen que no sirve (una vista sin dirección), queda el destino solo.
 */
export function enlaceParaMandar(red: "mainnet" | "testnet", origen: string): string {
  const destino = destinoDeRecibir(red);
  try {
    const url = new URL(origen);
    return url.protocol === "https:" || url.protocol === "http:" ? `${url.origin}${destino}` : destino;
  } catch {
    return destino;
  }
}
