/**
 * El cifrado de los nombres de la sala, del lado de la pantalla.
 *
 * Lo mismo que hace la página del celular (`CIFRA_JS` en workers/sala/src/pagina.ts):
 * AES-GCM con una clave de 16 bytes que genera el navegador de la pantalla y que
 * viaja solo en el fragmento del QR (`s.tinkazo.app/<id>#<clave>`), que ningún
 * navegador le manda a un servidor. Lo que se manda y se guarda es
 * `[1][IV de 12 bytes][cifrado]` en base64url: el servicio no puede leer los nombres.
 *
 * La huella que impide repetir un nombre también nace acá: HMAC-SHA-256 del nombre normalizado, con una llave
 * derivada de la clave del QR. El servicio solo compara esas huellas y, sin la clave, no puede probar candidatos.
 */

const VERSION = 1;

export const b64url = (bytes: Uint8Array): string => {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

export const deB64url = (s: string): Uint8Array<ArrayBuffer> => {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};

/** 16 bytes de `crypto.getRandomValues`, en base64url (22 caracteres). */
export function generarClave(): string {
  return b64url(crypto.getRandomValues(new Uint8Array(16)));
}

/** Los mismos caracteres que saca `limpiar` en la página del celular. */
const INVISIBLES_HUELLA = /[\u0000-\u001f\u007f-\u009f\u00ad\u034f\u061c\u115f\u1160\u17b4\u17b5\u180b-\u180f\u200b-\u200f\u2028-\u202f\u205f-\u206f\u3164\ufe00-\ufe0f\ufeff\uffa0\ufff9-\ufffb]/g;

/** La forma con que se compara un nombre: primero `limpiar`, después NFC, sin bordes y en minúsculas. */
export function normalizarNombreParaHuella(nombre: string): string {
  return nombre.replace(INVISIBLES_HUELLA, "").replace(/\s+/g, " ").trim().normalize("NFC").trim().toLowerCase();
}

const SEPARADOR_HUELLA = "Tinkazo/sala/huella-de-nombre/v1";

/** 32 bytes en base64url (43 caracteres). Cambia con la clave de cada sala y no revela el nombre sin esa clave. */
export async function huellaNombre(clave: string, texto: string): Promise<string> {
  const raw = deB64url(clave);
  if (raw.length !== 16) throw new Error("clave");
  const separador = new TextEncoder().encode(SEPARADOR_HUELLA);
  const material = new Uint8Array(separador.length + raw.length);
  material.set(separador);
  material.set(raw, separador.length);
  const derivada = new Uint8Array(await crypto.subtle.digest("SHA-256", material));
  const k = await crypto.subtle.importKey("raw", derivada, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const h = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(normalizarNombreParaHuella(texto)));
  return b64url(new Uint8Array(h));
}

async function importar(clave: string, uso: "encrypt" | "decrypt"): Promise<CryptoKey> {
  const raw = deB64url(clave);
  if (raw.length !== 16) throw new Error("clave");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, [uso]);
}

export async function cifrarNombre(clave: string, texto: string): Promise<string> {
  const k = await importar(clave, "encrypt");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, k, new TextEncoder().encode(texto)));
  const out = new Uint8Array(13 + ct.length);
  out[0] = VERSION;
  out.set(iv, 1);
  out.set(ct, 13);
  return b64url(out);
}

/** El nombre, o `null` si no es de esta sala (otra clave, otra versión o bytes rotos). */
export async function descifrarNombre(clave: string, dato: string): Promise<string | null> {
  try {
    const u = deB64url(dato);
    if (u[0] !== VERSION || u.length < 13 + 16) return null;
    const k = await importar(clave, "decrypt");
    const claro = await crypto.subtle.decrypt({ name: "AES-GCM", iv: u.subarray(1, 13) }, k, u.subarray(13));
    return new TextDecoder("utf-8", { fatal: true }).decode(claro);
  } catch {
    return null;
  }
}
