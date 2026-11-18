/**
 * Lo que el build comprueba del modo premios (`VITE_RAMPA=premios`, `cuenta-config.ts`) antes de armar el sitio. Lo lee
 * `vite.config.ts`, que no puede traer la configuración del navegador: importa solo la puerta de la venta
 * (`venta-piloto.ts`, que no importa nada).
 *
 * El modo premios deja ver el saldo y recibir, y nada más: Mandar se niega y la puerta del premio frena el sello y el
 * sorteo de una cuenta que puede guardar dinero (`wallet-pollar.ts`). Dos cosas de la venta lo contradicen, y las dos
 * firman con la misma cuenta y el mismo voto por hash de siempre:
 *
 * - pagar un paquete con el saldo de la cuenta (`pagarOrden`), que no pasa por la puerta del premio: la compra con QR
 *   carga dólares en la cuenta y los paga con ese pago, así que frenarlo rompería la compra;
 * - la compra con QR, que además prende la carga con bolivianos: trae dinero a una cuenta que el modo promete cuidar.
 *
 * Por eso el build no sale con el modo premios junto con alguna de las dos: obliga a elegir cuál va. No toca ninguna
 * bandera. Devuelve lo que está mal, en español y sin los valores de las variables (una dirección o una llave no se
 * escribe en la bitácora de un build). Vacío: el entorno está bien.
 */

import { banderasDeVenta } from "./venta-piloto";

/** El modo de la rampa que pide el entorno, escrito como lo lee `modoDeRampa` (`cuenta-config.ts`). */
const pideElModoPremios = (env: Record<string, string | undefined>): boolean => (env.VITE_RAMPA ?? "").trim().toLowerCase() === "premios";

export function problemasDePremios(env: Record<string, string | undefined>): string[] {
  if (!pideElModoPremios(env)) return [];
  const venta = banderasDeVenta(env);
  const problemas: string[] = [];
  if (venta.saldo) {
    problemas.push(
      "VITE_RAMPA=premios no va junto con VITE_PAGO_CON_SALDO=1: pagar con el saldo firma con la cuenta que guarda el premio y no pasa por la puerta del premio. Se elige cuál va en este sitio.",
    );
  }
  if (venta.qr) {
    problemas.push(
      "VITE_RAMPA=premios no va junto con VITE_COMPRA_QR=1: la compra con QR carga dólares en la cuenta y los paga con el saldo, y el modo premios solo deja recibir. Se elige cuál va en este sitio.",
    );
  }
  return problemas;
}
