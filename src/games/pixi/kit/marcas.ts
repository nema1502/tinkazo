/**
 * Las marcas del plan (`data-arco`, `data-mitad`…) son para los auditores: solo
 * se anotan si la página lo pide con `?auditar=<algo>` (`marcas` basta). Anotadas
 * siempre, cualquiera con la consola leía el arco de la historia y el puesto de
 * la ganadora a mitad de carrera desde el segundo cero, antes de que pasara.
 * Puro, sin DOM: lo llama `crearJuego` con `S.mark`.
 */
export function anotarMarcas(
  auditar: string | null,
  plan: { arco: string; marcas?: Readonly<Record<string, string>> },
  marcar: (clave: string, valor: string) => void,
): void {
  if (!auditar) return;
  if (plan.marcas) for (const [clave, valor] of Object.entries(plan.marcas)) marcar(clave, valor);
  marcar("arco", plan.arco);
}
