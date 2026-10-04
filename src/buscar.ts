/**
 * Buscarse en una lista.
 *
 * Es la defensa contra el ataque más común: inflar la lista antes de sellar,
 * metiendo a alguien dos veces o dejando afuera a otro. El sello impide
 * cambiarla después, no armarla mal; lo que sí lo descubre es que cada
 * persona se busque. Se compara sin tildes ni mayúsculas y con los espacios
 * juntos, que es como alguien escribe su nombre apurado en el celular.
 */

/** Un nombre como para compararlo: sin tildes, en minúsculas y con un solo espacio. */
export const normalizar = (s: string): string =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

/**
 * Dónde aparece algo en la lista: los puestos, desde 1, de los nombres que lo
 * contienen. Vacío si no se escribió nada.
 */
export function buscar(names: readonly string[], q: string): number[] {
  const k = normalizar(q);
  if (!k) return [];
  const out: number[] = [];
  names.forEach((n, i) => {
    if (normalizar(n).includes(k)) out.push(i + 1);
  });
  return out;
}

/**
 * Los puestos (desde cero) de los nombres que aparecen más de una vez,
 * comparados sin tildes ni mayúsculas: "Ana Quispe" y "ana quispe" son el
 * mismo nombre escrito dos veces.
 */
export function repetidos(names: readonly string[]): Set<number> {
  const por = new Map<string, number[]>();
  names.forEach((n, i) => {
    const k = normalizar(n);
    por.set(k, [...(por.get(k) ?? []), i]);
  });
  const out = new Set<number>();
  for (const idx of por.values()) if (idx.length > 1) for (const i of idx) out.add(i);
  return out;
}

/** Cuántas veces está exactamente ese nombre, comparado sin tildes ni mayúsculas. */
export function vecesExacto(names: readonly string[], nombre: string): number {
  const k = normalizar(nombre);
  return names.filter((n) => normalizar(n) === k).length;
}
