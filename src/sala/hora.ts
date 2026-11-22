/**
 * La hora de la sala según la cabecera `Date` de lo que contesta, con un segundo de precisión. La sala la expone a los otros
 * orígenes. Sirve para saber cuánto adelanta o atrasa el reloj de este aparato, sin que la sala mande ningún campo más.
 *
 * Sin imports: lo usan la página del celular y la del panel.
 */

/** Lo único que se le pide a una respuesta: poder leer una cabecera. */
export interface ConCabeceras {
  headers: { get: (nombre: string) => string | null };
}

/** La hora en milisegundos de una cabecera `Date`, o null si no llegó o no se entiende. */
export function horaDeLaCabecera(crudo: string | null | undefined): number | null {
  const ms = crudo ? Date.parse(crudo) : Number.NaN;
  return Number.isFinite(ms) ? ms : null;
}

/** La hora de la sala según la cabecera `Date` de la respuesta, si el navegador la deja leer. */
export function horaDeLaSala(r: ConCabeceras | null): number | null {
  try {
    return horaDeLaCabecera(r?.headers.get("Date"));
  } catch {
    return null;
  }
}
