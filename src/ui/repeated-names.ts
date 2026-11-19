import { textos, type Lang } from "../idioma";

/**
 * Los nombres de quienes salieron, juntos por persona: si una persona sale más de una vez, su nombre va una sola
 * vez, con su cuenta («Ana (2 veces)»), en el orden en que salió por primera vez. Sin repetidos, la lista queda
 * como estaba. Solo lo usa quien ya decidió que la lista se lee por persona; quien la lee por líneas no pasa por acá.
 *
 * Los textos salen de `textos(lang)`, sin el diccionario entero, para que lo pueda cargar la página de verificación.
 */

/** Reemplaza las marcas {así} en una sola pasada: lo que se pone no se vuelve a mirar. */
function rellenar(plantilla: string, datos: Record<string, string | number>): string {
  return plantilla.replace(/\{(\w+)\}/g, (marca, clave: string) => (clave in datos ? String(datos[clave]) : marca));
}

/** La lista con cada nombre una sola vez: quien se repite lleva su cuenta, y el orden es el de la primera salida. */
export function withRepeatCounts(lang: Lang, nombres: readonly string[]): string[] {
  const veces = new Map<string, number>();
  for (const nombre of nombres) veces.set(nombre, (veces.get(nombre) ?? 0) + 1);
  const plantilla = textos(lang)["repetidoVeces"];
  const conCuenta = (nombre: string, n: number): string =>
    typeof plantilla === "string" ? rellenar(plantilla, { nombre, n }) : `${nombre} (${n})`;
  const ya = new Set<string>();
  const out: string[] = [];
  for (const nombre of nombres) {
    if (ya.has(nombre)) continue;
    ya.add(nombre);
    const n = veces.get(nombre) ?? 1;
    out.push(n > 1 ? conCuenta(nombre, n) : nombre);
  }
  return out;
}
