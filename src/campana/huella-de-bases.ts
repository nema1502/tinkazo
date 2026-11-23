/**
 * La huella de las bases de una campaña (T1 de #182), compartida por la sala de pruebas y el DO del
 * servicio de campañas. El canon es el del depósito (el vector fijo de #170): el documento se escribe
 * como JSON canónico — claves ordenadas, sin espacios ni fin de línea, UTF-8 — y de esos bytes sale
 * SHA-256, en 64 hexadecimales. Así el sitio, el guion y el DO dan la misma cifra para las mismas
 * bases, sin importar el orden en que cada uno armó el objeto.
 *
 * Este archivo no toca la red ni el DOM: lo puede usar el navegador, un guion de Node y un Worker.
 */
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

/**
 * El texto canónico de un valor JSON: claves ordenadas (sin las que valen `undefined`), sin espacios
 * entre elementos, arreglos en su orden y números, booleanos, nulos y cadenas como los escribe JSON.
 * Lo que JSON no puede escribir lanza: la huella de lo que no es JSON no existe.
 */
function canonico(x: unknown): string {
  if (x === null || typeof x === "boolean" || typeof x === "number" || typeof x === "string") {
    return JSON.stringify(x);
  }
  if (Array.isArray(x)) return `[${x.map(canonico).join(",")}]`;
  if (typeof x === "object") {
    const registro = x as Record<string, unknown>;
    const claves = Object.keys(registro)
      .filter((k) => registro[k] !== undefined)
      .sort();
    return `{${claves.map((k) => `${JSON.stringify(k)}:${canonico(registro[k])}`).join(",")}}`;
  }
  throw new Error("huella: el valor no es JSON");
}

/** La huella de las bases: SHA-256 en hexadecimal del JSON canónico del documento. */
export function huellaDeBases(bases: unknown): string {
  return bytesToHex(sha256(new TextEncoder().encode(canonico(bases))));
}
