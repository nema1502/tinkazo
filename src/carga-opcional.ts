/**
 * Las cargas que el sitio hace por las dudas (el contador de visitas, una
 * precarga) y que pueden fallar sin consecuencias: con un bloqueador, con el
 * wifi flojo. Sin efectos al importarse: lo usan también módulos que corren en
 * las pruebas sin ventana.
 */

/** Los errores de las cargas opcionales, que no despiertan el aviso de versión nueva. */
const opcionales = new WeakSet<object>();

/**
 * Atrapa el error de una carga opcional, lo anota para que el aviso de versión
 * nueva no lo cuente y devuelve undefined. El ayudante de Vite manda
 * `vite:preloadError` antes de que el error llegue acá, así que el aviso lo
 * mira un turno después.
 */
export function cargaOpcional<T>(carga: Promise<T>): Promise<T | undefined> {
  return carga.catch((error: unknown) => {
    if (typeof error === "object" && error !== null) opcionales.add(error);
    return undefined;
  });
}

/** Si el error salió de una carga opcional. */
export const esDeCargaOpcional = (error: unknown): boolean =>
  typeof error === "object" && error !== null && opcionales.has(error);
