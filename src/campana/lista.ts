/**
 * La lista que se pasa al cuadro del sorteo en una campaña de empresa, y las etiquetas con que se ve en el show.
 *
 * Lo que se sella son solo las cuentas (o, en una campaña de personas, sus líneas), ordenadas con `listaDeLaCampana`: la
 * misma función que usa la sala al comprobar el sello. Los nombres son etiquetas locales de esta compu
 * (`equipos/etiquetas.ts`) y nunca entran en lo sellado.
 */
import { listaDeLaCampana } from "../../workers/sala/src/campana";
import { formaDeLista } from "./forma-de-lista";

/** Lo que el panel sabe de una anotada, además de su cuenta: su número en la sala, su nombre y si el filtro lo tapa. */
export interface DatosDeAnotada {
  n: number;
  /** El nombre descifrado, vacío si no vino o no se pudo leer. */
  nombre: string;
  /** El filtro lo marcó. */
  revisar: boolean;
  /** Quien organiza tocó Mostrar. */
  mostrar: boolean;
}

/**
 * Las líneas que se sellan y las etiquetas con que se ven. Las cuentas salen solo de `cuentasLeidas`, que es lo que
 * leyó `leerTodasLasAnotadas` de la sala: nunca de las filas del panel, que esconden a quien se está quitando. Es toda de
 * cuentas o toda de líneas de persona, y en las dos la etiqueta de quien no tiene nombre es Persona con su número.
 *
 * Un nombre vacío, o marcado por el filtro y sin mostrar, sale como Persona con su número de la sala. Los nombres
 * repetidos (sin mirar mayúsculas) llevan (2), (3) en el orden de la lista. Las marcadas entran a la lista igual: lo
 * tapado es el nombre, no la persona.
 *
 * `null` si alguna fila leída no tiene la forma de las demás (una cuenta mal formada, una mezcla de cuentas y líneas de
 * persona, o algo que no es ninguna de las dos): no se descarta en silencio, porque la lista sellada tiene que ser la que
 * la sala va a comparar.
 */
export function listaYEtiquetas(
  cuentasLeidas: readonly string[],
  porCuenta: ReadonlyMap<string, DatosDeAnotada>,
  persona: (n: number) => string,
): { lineas: string[]; etiquetas: Map<string, string> } | null {
  const forma = formaDeLista(cuentasLeidas);
  if (forma !== "cuenta" && forma !== "persona") return null;
  const lineas = listaDeLaCampana(cuentasLeidas);
  const vistas = new Map<string, number>();
  const etiquetas = new Map<string, string>();
  lineas.forEach((cuenta, lugar) => {
    const a = porCuenta.get(cuenta);
    const tapado = a === undefined || a.nombre.trim() === "" || (a.revisar && !a.mostrar);
    const base = a === undefined || tapado ? persona(a?.n ?? lugar + 1) : a.nombre.trim();
    const clave = base.toLocaleLowerCase();
    const veces = (vistas.get(clave) ?? 0) + 1;
    vistas.set(clave, veces);
    etiquetas.set(cuenta, veces === 1 ? base : `${base} (${veces})`);
  });
  return { lineas, etiquetas };
}
