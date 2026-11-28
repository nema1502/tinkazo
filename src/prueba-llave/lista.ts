import { canonicalList, listHash } from "../protocol/canonical";

/** La lista de ejemplo que se sella. Nombres de muestra: nada de personas reales. */
export const LISTA_DE_EJEMPLO: readonly string[] = ["Ana", "Nora", "Beto"];

/** Cuántas personas ganan en la prueba. */
export const GANADORES = 1;

export interface DatosDeLaLista {
  nombres: string[];
  /** La huella de la lista (SHA-256 de la lista canónica), la que se sella. */
  huella: Uint8Array;
  cantidad: number;
}

/** La lista de ejemplo ya canónica, con su huella. */
export function datosDeLaLista(): DatosDeLaLista {
  const nombres = canonicalList(LISTA_DE_EJEMPLO.join("\n"));
  return { nombres, huella: listHash(nombres), cantidad: nombres.length };
}
