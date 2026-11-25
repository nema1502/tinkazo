/**
 * La línea de persona: lo que se sella en una campaña de personas en lugar de una cuenta. Para el sorteo es una línea más,
 * un texto que se ordena y se sella igual que una cuenta. No es un correo ni una cuenta y no deja adivinar quién es:
 * sale del usuario con la sal de la campaña, que es de la sala y desaparece con ella. La misma persona tiene otra línea
 * en otra campaña, así que nadie puede seguirla de una a otra.
 *
 * Forma: `p1:` y los primeros 16 bytes del HMAC-SHA256 del usuario con la sal, en base32 sin relleno y en minúsculas
 * (26 caracteres, 29 con el prefijo). La clave es la misma que usa `huellaDePersona` (los bytes de la sal de la campaña),
 * así que esta línea es el comienzo de esa huella. Los vectores están en `docs/vectors-persona.json`.
 */
import { deHex } from "./firma";

export const PREFIJO_DE_PERSONA = "p1:";

const ALFABETO = "abcdefghijklmnopqrstuvwxyz234567";
/**
 * 16 bytes son 128 bits y 26 letras de base32 son 130: la última letra lleva dos bits de sobra que tienen que ser cero.
 * Solo las letras que terminan en dos ceros dan una línea canónica, así cada persona tiene una sola escritura.
 */
const ES_LINEA_DE_PERSONA = /^p1:[a-z2-7]{25}[aeimquy4]$/;
const ES_SAL_HEX = /^(?:[0-9a-f]{2})+$/;

/** Si el texto tiene la forma de una línea de persona. No dice de quién es ni si está en alguna lista. */
export function esLineaDePersona(texto: unknown): texto is string {
  return typeof texto === "string" && ES_LINEA_DE_PERSONA.test(texto);
}

/** Base32 en minúsculas y sin relleno (RFC 4648). */
function aBase32(bytes: Uint8Array): string {
  let salida = "";
  let acumulado = 0;
  let bits = 0;
  for (const b of bytes) {
    acumulado = (acumulado << 8) | b;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      salida += ALFABETO[(acumulado >> bits) & 31];
    }
    acumulado &= (1 << bits) - 1;
  }
  if (bits > 0) salida += ALFABETO[(acumulado << (5 - bits)) & 31];
  return salida;
}

/**
 * La línea de la persona `usuario` en la campaña de la sal `salHex` (la que da `salDeCampana`, en hexadecimal minúscula).
 * Lanza si la sal o el usuario no sirven: es un error de quien llama, nunca un dato de la persona.
 */
export async function lineaDePersona(salHex: string, usuario: string): Promise<string> {
  if (!ES_SAL_HEX.test(salHex)) throw new RangeError("La sal de la campaña no es hexadecimal.");
  if (typeof usuario !== "string" || usuario === "") throw new RangeError("Falta el usuario.");
  // La copia de los bytes mantiene el tipo que pide WebCrypto y no altera la sal.
  const sal = new Uint8Array(deHex(salHex));
  const clave = await crypto.subtle.importKey("raw", sal, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const firma = new Uint8Array(await crypto.subtle.sign("HMAC", clave, new TextEncoder().encode(usuario)));
  return PREFIJO_DE_PERSONA + aBase32(firma.slice(0, 16));
}
