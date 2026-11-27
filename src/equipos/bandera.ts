/**
 * La bandera de los equipos con cupón: `VITE_EQUIPOS`. **Prendida por defecto desde el cambio 7e414660**:
 * el registro de equipos es parte del producto, y una variable solo para apagarlo (`VITE_EQUIPOS=0` al construir)
 * queda para un repliegue de emergencia, como `VITE_FOTO_JUEGO` (src/ui/foto-juego-bandera.ts).
 *
 * Con la bandera apagada a propósito el sitio vuelve a ser el de siempre: la herramienta no ofrece el registro de
 * equipos y la página de registro (`equipos.html`) dice que todavía no está abierta.
 */
export function equiposActivo(valor: unknown = import.meta.env.VITE_EQUIPOS): boolean {
  return valor !== "0" && valor !== "false" && valor !== 0 && valor !== false;
}
