/**
 * La huella de las bases de una campaña. El canon es el del depósito: el documento se escribe
 * como JSON canónico (claves ordenadas, sin espacios ni fin de línea, UTF-8) y de esos bytes sale
 * SHA-256, en 64 hexadecimales. Así el sitio, un guion y un Worker dan la misma cifra para las mismas
 * bases, sin importar el orden en que cada uno armó el objeto.
 *
 * Este archivo no toca la red ni el DOM: lo puede usar el navegador, un guion de Node y un Worker.
 */
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

/**
 * El texto canónico de un valor JSON: claves ordenadas (sin las que valen `undefined`), sin espacios
 * entre elementos, arreglos en su orden y números, booleanos, nulos y cadenas como los escribe JSON.
 * Lo que JSON no puede escribir lanza (funciones, bigint, NaN e infinitos): la huella de lo que no es JSON no existe.
 * Tampoco se acepta un objeto que no sea un registro simple (una fecha, un mapa, un conjunto, una dirección o una
 * instancia de clase), que se escribiría vacío y daría la misma huella que otro distinto, ni uno que se contiene a sí
 * mismo. Las claves se ordenan por unidades UTF-16, el orden de RFC 8785: con claves fuera del plano básico (un
 * emoji, por ejemplo) ese orden no coincide con el de los bytes UTF-8, y quien arme el canon desde otro lenguaje tiene
 * que ordenar igual.
 */
function canonico(x: unknown, ancestros: ReadonlySet<object> = new Set()): string {
  if (typeof x === "number" && !Number.isFinite(x)) throw new Error("huella: el valor no es JSON");
  if (x === null || typeof x === "boolean" || typeof x === "number" || typeof x === "string") {
    return JSON.stringify(x);
  }
  if (typeof x === "object") {
    if (ancestros.has(x)) throw new Error("huella: el valor se contiene a sí mismo");
    const dentro = new Set(ancestros).add(x);
    if (Array.isArray(x)) return `[${x.map((e) => canonico(e, dentro)).join(",")}]`;
    // Un registro simple tiene por prototipo el raíz de los objetos (de cualquier ventana) o ninguno.
    const prototipo: object | null = Object.getPrototypeOf(x);
    if (prototipo !== null && Object.getPrototypeOf(prototipo) !== null) throw new Error("huella: el valor no es un registro simple");
    const registro = x as Record<string, unknown>;
    const claves = Object.keys(registro)
      .filter((k) => registro[k] !== undefined)
      .sort();
    return `{${claves.map((k) => `${JSON.stringify(k)}:${canonico(registro[k], dentro)}`).join(",")}}`;
  }
  throw new Error("huella: el valor no es JSON");
}

/** La huella de las bases: SHA-256 en hexadecimal del JSON canónico del documento. */
export function huellaDeBases(bases: unknown): string {
  return bytesToHex(sha256(new TextEncoder().encode(canonico(bases))));
}
