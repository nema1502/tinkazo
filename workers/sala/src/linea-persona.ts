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

/** Cuántos códigos de cuatro cifras hay: ninguna lista de ganadoras puede ser más larga. */
const CODIGOS_POSIBLES = 10_000;
/** Cuántas vueltas se prueban para separar un código repetido. Con diez ganadoras la primera repetida casi nunca pasa de la segunda. */
const VUELTAS_MAXIMAS = 64;

/** Un código de la vuelta `vuelta`: los primeros 4 bytes del HMAC como entero sin signo, módulo 10.000, con ceros a la izquierda. */
async function codigoDeVuelta(clave: CryptoKey, vuelta: number, linea: string): Promise<string> {
  const mensaje = new TextEncoder().encode(`entrega:${vuelta}:${linea}`);
  const firma = new DataView(await crypto.subtle.sign("HMAC", clave, mensaje));
  return String(firma.getUint32(0) % CODIGOS_POSIBLES).padStart(4, "0");
}

/**
 * El código de entrega de cada ganadora, en el orden de su puesto: cuatro cifras que ve solo ella y quien organiza, para
 * comprobar en el stand que quien se presenta es quien ganó. Sale de la línea con la sal de la campaña (la misma clave de la línea
 * de persona, con otro texto) y no se guarda: se recalcula las veces que haga falta y da siempre lo mismo. Si el código de una
 * ganadora ya salió para otra de más adelante en el puesto, esa pasa a la vuelta siguiente: así no hay dos iguales en una lista.
 * Lanza si la sal no es hexadecimal, si alguna línea no tiene la forma de una línea de persona o si hay más ganadoras que códigos.
 * Los mensajes no repiten ninguna línea.
 */
export async function codigosDeEntrega(salHex: string, ganadoras: readonly string[]): Promise<string[]> {
  if (!ES_SAL_HEX.test(salHex)) throw new RangeError("La sal de la campaña no es hexadecimal.");
  if (ganadoras.length > CODIGOS_POSIBLES) throw new RangeError("Hay más ganadoras que códigos.");
  for (const linea of ganadoras) {
    if (!esLineaDePersona(linea)) throw new RangeError("Una ganadora no tiene la forma de una línea de persona.");
  }
  const sal = new Uint8Array(deHex(salHex));
  const clave = await crypto.subtle.importKey("raw", sal, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const usados = new Set<string>();
  const codigos: string[] = [];
  for (const linea of ganadoras) {
    let codigo = "";
    for (let vuelta = 0; vuelta < VUELTAS_MAXIMAS; vuelta++) {
      codigo = await codigoDeVuelta(clave, vuelta, linea);
      if (!usados.has(codigo)) break;
      codigo = "";
    }
    if (codigo === "") throw new RangeError("No se pudo separar el código de una ganadora.");
    usados.add(codigo);
    codigos.push(codigo);
  }
  return codigos;
}
