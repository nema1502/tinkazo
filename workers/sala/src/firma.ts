/**
 * La firma de las campañas: Tinkazo firma el archivo de una campaña con una llave Ed25519 que vive fuera de todo Worker y de
 * todo repositorio, y la sala la comprueba con la llave pública escrita acá. Sin llave escrita, no se crea ninguna campaña.
 */
import { ed25519 } from "@noble/curves/ed25519.js";

/** La llave pública de las campañas, en hexadecimal (64 caracteres). La escribe el equipo cuando genera el par de llaves. */
export const LLAVE_CAMPANAS_HEX: string | null = "a167211f21b2e6a4b68cf094b4ea068ccf2ff70c4bab99422145069cd2c5d28c";

const ES_HEX_32 = /^[0-9a-f]{64}$/;
/** 64 bytes en base64url sin relleno. */
export const ES_FIRMA = /^[A-Za-z0-9_-]{86}$/;
/** 64 bytes en hexadecimal minúscula: la forma en que contesta la activación automática (`POST /v1/activar`). */
export const ES_FIRMA_HEX = /^[0-9a-f]{128}$/;

/** Convierte hexadecimal en bytes. La llave ya fue validada antes de llegar acá. */
export function deHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

/** Convierte base64url sin relleno en bytes, sin usar una API exclusiva de Node. */
export function deB64url(s: string): Uint8Array {
  const base64 = s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=");
  const texto = atob(base64);
  return Uint8Array.from(texto, (c) => c.charCodeAt(0));
}

/** Convierte bytes en base64url sin relleno. */
export function aB64url(bytes: Uint8Array): string {
  let texto = "";
  for (const b of bytes) texto += String.fromCharCode(b);
  return btoa(texto).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Los 64 bytes de una firma, o null si la cadena no es su forma canónica. Una firma de 64 bytes ocupa 86 caracteres y el
 * último trae 4 bits de sobra: `atob` los descarta y dos cadenas distintas daban los mismos bytes. Se exige que al
 * volver a codificar los bytes salga la misma cadena, así cada firma tiene una sola escritura. La otra escritura que vale
 * es la hexadecimal en minúscula (128 caracteres), que no tiene bits de sobra: es una sola por construcción.
 */
export function firmaCanonica(firma: string): Uint8Array | null {
  if (ES_FIRMA_HEX.test(firma)) return deHex(firma);
  if (!ES_FIRMA.test(firma)) return null;
  try {
    const bytes = deB64url(firma);
    return bytes.length === 64 && aB64url(bytes) === firma ? bytes : null;
  } catch {
    return null;
  }
}

/** Si `firma` es la firma Ed25519 de los bytes UTF-8 de `texto` con la llave `llaveHex`. Nunca lanza. */
export function verificarFirma(texto: string, firma: string, llaveHex: string | null): boolean {
  if (!llaveHex || !ES_HEX_32.test(llaveHex)) return false;
  const bytes = firmaCanonica(firma);
  if (bytes === null) return false;
  try {
    return ed25519.verify(bytes, new TextEncoder().encode(texto), deHex(llaveHex));
  } catch {
    return false;
  }
}

/** Las dos variables que, juntas, piden una llave de prueba. Solo existen en un Worker local. */
export interface VariablesDePrueba {
  VIDA_PRUEBA_MS?: string;
  LLAVE_CAMPANAS_PRUEBA?: string;
}

/** Si el pedido llegó al servidor de desarrollo de esta máquina: `localhost` o `127.0.0.1`, nada más. */
export function esPedidoLocal(direccion: string): boolean {
  try {
    const host = new URL(direccion).hostname;
    return host === "localhost" || host === "127.0.0.1";
  } catch {
    return false;
  }
}

/**
 * La llave pública que vale para este pedido. La de prueba reemplaza a la de Tinkazo solo si están puestas las dos
 * variables y además el pedido llegó a localhost o a 127.0.0.1: en un Worker desplegado, un valor olvidado en el panel
 * no puede abrirle la puerta a campañas firmadas por cualquiera. Ante la duda vale la de Tinkazo (o ninguna).
 */
export function llaveDeCampanas(
  env: VariablesDePrueba,
  direccion: string,
  oficial: string | null = LLAVE_CAMPANAS_HEX,
): string | null {
  if (env.VIDA_PRUEBA_MS && env.LLAVE_CAMPANAS_PRUEBA && esPedidoLocal(direccion)) return env.LLAVE_CAMPANAS_PRUEBA;
  return oficial;
}

/** La variable con la llave privada de la activación automática: 32 bytes en hexadecimal, que se carga como secreto. */
export interface VariablesDeLlaveAuto {
  CAMPANAS_LLAVE_AUTO?: string;
}

/** Los 32 bytes de la llave automática, o null si falta o no tiene la forma (así una llave mal pegada nunca firma nada). */
function secretoAuto(env: VariablesDeLlaveAuto): Uint8Array | null {
  const hex = env.CAMPANAS_LLAVE_AUTO;
  return typeof hex === "string" && ES_HEX_32.test(hex) ? deHex(hex) : null;
}

/** La llave pública (hexadecimal) que sale de la llave automática. No se escribe en ningún archivo: se deriva en el momento. */
export function llavePublicaAuto(env: VariablesDeLlaveAuto): string | null {
  const secreto = secretoAuto(env);
  if (secreto === null) return null;
  try {
    return Array.from(ed25519.getPublicKey(secreto), (b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return null;
  }
}

/**
 * La firma Ed25519 de los bytes UTF-8 de `texto` con la llave automática, en hexadecimal (128 caracteres). Ed25519 es
 * determinista: el mismo texto da siempre la misma firma, así repetir un pedido no cambia nada. Null si no hay llave.
 */
export function firmarConLlaveAuto(env: VariablesDeLlaveAuto, texto: string): string | null {
  const secreto = secretoAuto(env);
  if (secreto === null) return null;
  try {
    return Array.from(ed25519.sign(new TextEncoder().encode(texto), secreto), (b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return null;
  }
}
