/**
 * La bandera de los equipos con cupón: `VITE_EQUIPOS`. Apagada por defecto.
 *
 * Con la bandera apagada el sitio es el de siempre: la herramienta no ofrece el registro de equipos y la página de
 * registro (`equipos.html`) dice que todavía no está abierta. Se prende al construir (`VITE_EQUIPOS=1 pnpm build`).
 */
export function equiposActivo(valor: unknown = import.meta.env.VITE_EQUIPOS): boolean {
  return valor === "1" || valor === "true";
}
