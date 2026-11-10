import { cifrarNombre, descifrarNombre } from "../sala/cifra";
import { revisarNombre } from "../sala/filtro";
import { type DatosDeEquipo, MAX_INTEGRANTES } from "./modelo";

/**
 * Los datos de un equipo, cifrados con la clave del QR de la sala.
 *
 * Es el mismo cifrado de los nombres de la sala (`sala/cifra.ts`): una clave de 16 bytes que genera la pantalla de
 * quien organiza y viaja solo en el fragmento del enlace (`#clave`), que ningún navegador le manda a un servidor. Lo
 * que se manda a la sala es `[1][IV][cifrado]` en base64url: el servicio guarda bytes que no puede leer. El nombre
 * del equipo y los de sus integrantes nunca van a la cadena ni a un servidor en claro; en la cadena va solo la cuenta.
 */

/** El texto que se cifra: un JSON corto con el nombre del equipo y los integrantes. */
export const aTexto = (e: DatosDeEquipo): string => JSON.stringify({ n: e.nombre, i: e.integrantes });

export async function cifrarEquipo(clave: string, e: DatosDeEquipo): Promise<string> {
  return cifrarNombre(clave, aTexto(e));
}

/** El equipo, o `null` si no es de esta sala (otra clave o bytes rotos) o no tiene la forma esperada. */
export async function descifrarEquipo(clave: string, dato: string): Promise<DatosDeEquipo | null> {
  const claro = await descifrarNombre(clave, dato);
  if (claro === null) return null;
  try {
    const x = JSON.parse(claro) as { n?: unknown; i?: unknown };
    if (typeof x.n !== "string" || !Array.isArray(x.i) || x.i.length > MAX_INTEGRANTES || !x.i.every((s): s is string => typeof s === "string")) return null;
    return { nombre: x.n, integrantes: x.i };
  } catch {
    return null;
  }
}

/**
 * Lo que se revisa antes de poner un equipo en la pantalla grande: sin enlaces, y las palabras que conviene mirar
 * dejan al equipo en «Para revisar» hasta que quien organiza lo deja pasar. Devuelve `null` si hay que descartarlo.
 */
export function revisarEquipo(e: DatosDeEquipo): { equipo: DatosDeEquipo; revisar: boolean } | null {
  let revisar = false;
  const limpio = (s: string): string | null => {
    const v = revisarNombre(s);
    if (v.estado === "descartar") return null;
    if (v.estado === "revisar") revisar = true;
    return v.nombre;
  };
  const nombre = limpio(e.nombre);
  if (nombre === null) return null;
  const integrantes: string[] = [];
  for (const i of e.integrantes) {
    const n = limpio(i);
    if (n !== null) integrantes.push(n);
  }
  return { equipo: { nombre, integrantes }, revisar };
}
